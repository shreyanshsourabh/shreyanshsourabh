require('dotenv').config();
const path = require('path');
const http = require('http');
const express = require('express');
const WebSocketServer = require('ws');
const { connectToDatabase, getCollection } = require('./db');
const { v4: uuidv4 } = require('uuid');
const { url } = require('inspector');
const { version } = require('os');
const { ReturnDocument } = require('mongodb');

const PORT = process.env.PORT || 3000;
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

//API endpoint to fetch all documents from a collection
app.post('/api/docs', async (req, res) => {
    try {
        const  title  = (req.body && req.body.title) || 'Untitled';
        const docID = uuidv4();
        const document = getCollection('documents');
        const newDoc = { _id: docID, title, content: '' };
        await document.insertOne(newDoc);
        res.json({id: docID, url: `/doc.html?id=${docID}`});
    
    } catch (error) {
        console.error("Error fetching documents:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

//API endpoint to fetch a specific document by ID
app.get('/api/docs/:id', async (req, res) => {
    try {
        const docID = req.params.id;
        const document = getCollection('documents');
        let doc = await document.findOne({ _id: docID });
        if (!doc) {
            // doc = { _id: docID, title: "Untitled", content: "" };
            // await document.insertOne(doc);
            throw new Error("Document not found");
        }
        res.json(doc);
    } catch (error) {
        console.error("Error fetching document:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

// Create HTTP server
const server = http.createServer(app);

const rooms = new Map();

function joinRoom(roomID, ws) {
    if (!rooms.has(roomID)) 
        rooms.set(roomID, new Set());
        rooms.get(roomID).add(ws);
}
function leaveRoom(roomID, ws) {
    const set = rooms.get(roomID);
    if (!set) return
    set.delete(ws);
    if (set.size === 0) 
        rooms.delete(roomID);
}


// Set up WebSocket server
const wss = new WebSocketServer.Server({ noServer: true });

wss.on('connection', async (ws, req) => {
    const searchParams = new URL(req.url, `http://${req.headers.host}`).searchParams;
    const docId = searchParams.get('docId');
    const clientId = searchParams.get('clientId') || 'unknown';

    if (!docId) {
        ws.close(1008, "docId required ");
        return;
    }

    joinRoom(docId, ws);
    ws._meta = { docId, clientId,isAlive: true };

    //Send current content to new client
    const document = getCollection('documents');
    const doc = await document.findOne({ _id: docId });
    ws.send(JSON.stringify({ type: 'init', content: (doc && doc.content) || '', version: (doc && doc.version) || 0 }));
    ws.on('message', async (message) => {
        try {
            const msg = JSON.parse(message);
            // console.log(`[WS] Received from ${clientId}:`, msg);
            if (msg.type === 'change') {
                const content = String(msg.content);
                const now = Date.now();
                let latestDoc = await document.findOne({ _id: docId });
                const newVersion = (latestDoc && latestDoc.version ? latestDoc.version : 0) + 1;
                const result = await document.findOneAndUpdate(
                    { _id: docId },
                    { $set: { content, version: newVersion, updatedAt: now } },
                    { upsert: true, returnDocument: ReturnDocument.AFTER }
                );

                let updatedDoc = result.value;
                if (!updatedDoc) {
                    updatedDoc = await document.findOne({ _id: docId });
                }

                const payload = {
                    type: 'change',
                    from: clientId,
                    content: (updatedDoc && updatedDoc.content) || '',
                    version: (updatedDoc && updatedDoc.version) || newVersion,
                    updatedAt: (updatedDoc && updatedDoc.updatedAt) || now
                };
                
                //Broadcasr to other
                const room = rooms.get(docId) || new Set();
                for (const client of room) {
                    if (client !== ws && client.readyState === 1) {
                        client.send(JSON.stringify(payload));
                    }
                } 
                console.log(`[WS] Broadcasting to room ${docId}:`, payload);  

            } else if(msg.type === 'cursor') {
                const room = rooms.get(docId) || new Set();
                for (const client of room) {
                    if (client !== ws && client.readyState === 1) {
                        client.send(JSON.stringify({type:'cursor', from:clientId, cursor: msg.cursor || null}));
                    }
                }   
            }
        } catch (error) {
            console.error("Error processing WS message:", error);
        }
    });

    ws.on('pong', () => {
        ws._meta.isAlive = true;
    });

    ws.on('close', () => {
        leaveRoom(docId, ws);
    });
});

// Handle upgrade requests for WebSocket
server.on('upgrade', (request, socket, head) => {
    const pathname = new URL(request.url, `http://${request.headers.host}`).pathname;
    if (pathname === '/ws') {
        wss.handleUpgrade(request, socket, head, (ws) => {
            wss.emit('connection', ws, request);
        });
    } else {    
        socket.destroy();
    }
});

async function start(){
    await
    connectToDatabase(process.env.MONGODB_URI, process.env.DB_NAME || 'collab');
    server.listen(PORT, () => {
        console.log(`Server is listening on http://localhost:${PORT}`);
    });
}

start().catch((err) => {
    console.error("Failed to start server:", err);
    process.exit(1);
});





