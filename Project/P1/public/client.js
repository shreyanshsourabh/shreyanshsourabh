(function() {
    const params = new URLSearchParams(window.location.search);
    const docId = params.get('id');
    const editor = document.getElementById('editor');
    const versionE1 = document.getElementById('version');
    const statusE1 = document.getElementById('status');
    const docIdView = document.getElementById('docIdView');
    const userCountE1 = document.getElementById('userCount');

    function getEditorContent() {
        let html = editor.innerHTML;
        html = html.replace(/<div>/gi, '\n').replace(/<\/div>/gi, '').replace(/<br\s*\/?>/gi, '\n');
        const temp = document.createElement('div');
        temp.innerHTML = html;
        return temp.textContent;
    }

    
    function setEditorContent(text) {
        // Replace \n with <br>
        editor.innerHTML = text.replace(/\n/g, '<br>');
    }



    if (!docId) {
        alert("Document ID is required in URL as ?id=DOC_ID");
        location.href = "/";
        return;
    }
    docIdView.textContent = docId;

    //Simple unique client ID
    const clientId = (self.crypto && crypto.randomUUID) ? crypto.randomUUID() : Math.random().toString(36).substring(2, 15);

    // Load initial doc via REST
    fetch(`/api/docs/${encodeURI(docId)}`)
        .then(res => res.json())
        .then(doc => {
            setEditorContent(doc.content || "");
            versionE1.textContent = doc.version || 0;
    }).catch(() => {});

    //build WS URL
    function makeWSUrl() {
        const proto = (location.protocol === 'https:') ? 'wss:' : 'ws:';
        return `${proto}//${location.host}/ws?docId=${encodeURIComponent(docId)}&clientId=${encodeURIComponent(clientId)}`;
    }

    let ws;
    let pingInterval;
    let userCountApprox = 1;

    function connect() {
        ws = new WebSocket(makeWSUrl());

        ws.addEventListener('open', () => {
            statusE1.textContent = "Connected";
            userCountE1.textContent = String(++userCountApprox);
            pingInterval = setInterval(() => {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ type: 'ping' }));
                }
            }, 15000);
        });
        
        ws.addEventListener('close', () => {
            statusE1.textContent = "Disconnected. Reconnecting...";
            userCountE1.textContent = String(Math.max(1,--userCountApprox));
            clearInterval(pingInterval);
            setTimeout(connect, 2000);
        });

        ws.addEventListener('message', (ev) => {
            const msg = JSON.parse(ev.data);
            // console.log('[WS] Received:', msg); 
            if (msg.type === 'init') {
                if (getEditorContent() !== msg.content) {
                    setEditorContent(msg.content);
                }
                versionE1.textContent = msg.version || 0;
            } else if (msg.type === 'change') {
                if (msg.from !== clientId && getEditorContent() !== msg.content) {
                    const sel = saveSelection();
                    setEditorContent(msg.content);
                    restoreSelection(sel);
                    versionE1.textContent = msg.version;
                }
            } else if (msg.type === 'cursor') {
                // Placeholder for presence rendering
            }
        });
    }

    connect();

    //Debounce helper
    function debounce(fn, ms) {
        let t;
        return function (...args) {
            clearTimeout(t);
            t = setTimeout(() => fn.apply(this, args), ms);
        };
    }

    const sendChange = debounce(() => {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: 'change',
                from: clientId,
                content: getEditorContent()
            }));
        }
    }, 400);

    editor.addEventListener('input', () => {
        sendChange();
    });

    //keep cursor position when applying remote changes
    function saveSelection() {
        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0) return null;
        const range = sel.getRangeAt(0);
        return {
            start: getTextOffset(editor, range.startContainer, range.startOffset),
            end: getTextOffset(editor, range.endContainer, range.endOffset)
        };
    }

    function restoreSelection(pos) {
        if (!pos) return;
        const range = document.createRange();
        const start = findNodeByOffset(editor, pos.start);
        const end = findNodeByOffset(editor, pos.end);
        if (start && end) {
            range.setStart(start.node, start.offset);
            range.setEnd(end.node, end.offset);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
        }
    }

    function getTextOffset(root, node, offset) {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
        let count = 0;
        while (walker.nextNode()) {
            const n = walker.currentNode;
            if (n === node) {
                return count + offset;
            }
            count += n.textContent.length;
        }
        return count;
    }

    function findNodeByOffset(root, offset) {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
        let count = 0;
        while (walker.nextNode()) {
            const n = walker.currentNode;
            const len = n.textContent.length;
            if (count + len >= offset) {
                return { node: n, offset: offset - count };
            }
            count += len;
        }
        return null;
    }

})();
