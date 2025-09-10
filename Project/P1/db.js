const MongoClient = require('mongodb').MongoClient;

let client;
let db;

async function connectToDatabase(uri, dbName) {
    if (db) {
        return db;
    }
    client = new MongoClient(uri, { serverSelectionTimeoutMS:8000 });
    await client.connect();
    db = client.db(dbName);
    console.log(`Connected to database: ${dbName}`);
    return db;
}

function getCollection(name) {
    if (!db) {
        throw new Error("Database not connected. Call connectToDatabase first.");
    }
    return db.collection(name);
}

module.exports = {
    connectToDatabase,
    getCollection,
};  