const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Initialize SQLite DB
const dbPath = path.join(__dirname, '..', '..', 'whispr.db');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE,
        password TEXT,
        avatar_url TEXT,
        bio TEXT,
        theme_color TEXT,
        preferences TEXT,
        session_token TEXT,
        last_seen INTEGER
    )`);
    db.all(`PRAGMA table_info(users)`, (err, cols) => {
        if (!err && cols && !cols.some(c => c.name === 'last_seen')) {
            db.run(`ALTER TABLE users ADD COLUMN last_seen INTEGER`);
        }
    });
    db.all(`PRAGMA table_info(users)`, (err, cols) => {
        if (!err && cols && !cols.some(c => c.name === 'identity_public_key')) {
            db.run(`ALTER TABLE users ADD COLUMN identity_public_key TEXT`);
        }
    });
    db.run(`CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sender_id INTEGER,
        receiver_id INTEGER,
        payload TEXT,
        is_read INTEGER DEFAULT 0
    )`);
    db.all(`PRAGMA table_info(messages)`, (err, cols) => {
        if (!err && cols && !cols.some(c => c.name === 'sent_at')) {
            db.run(`ALTER TABLE messages ADD COLUMN sent_at INTEGER DEFAULT 0`);
        }
    });
    db.run(`CREATE TABLE IF NOT EXISTS groups (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        created_by INTEGER NOT NULL,
        is_feed INTEGER DEFAULT 0,
        created_at INTEGER DEFAULT (strftime('%s','now')),
        description TEXT,
        avatar_url TEXT
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS group_members (
        group_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        role TEXT DEFAULT 'member',
        joined_at INTEGER DEFAULT (strftime('%s','now')),
        PRIMARY KEY (group_id, user_id)
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS group_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        group_id INTEGER NOT NULL,
        sender_id INTEGER NOT NULL,
        text TEXT NOT NULL,
        sent_at INTEGER DEFAULT (strftime('%s','now'))
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS group_read (
        group_id INTEGER,
        user_id INTEGER,
        last_read INTEGER DEFAULT 0,
        PRIMARY KEY (group_id, user_id)
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS group_keys (
        group_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        wrapped_key TEXT NOT NULL,
        iv TEXT NOT NULL,
        PRIMARY KEY (group_id, user_id)
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS friend_requests (
        user_id INTEGER,
        target_id INTEGER,
        status TEXT DEFAULT 'pending',
        note TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, target_id)
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS file_vault (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        filename_enc TEXT,
        mime_enc TEXT,
        size_enc TEXT,
        blob_data BLOB,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS voice_clips (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        owner_id INTEGER NOT NULL,
        mime TEXT,
        duration REAL DEFAULT 0,
        clip_data BLOB,
        created_at INTEGER DEFAULT (strftime('%s','now'))
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS saved_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        msg_type TEXT NOT NULL,
        content_enc TEXT,
        meta_enc TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    db.all(`PRAGMA table_info(saved_messages)`, (err, cols) => {
        if (!err && cols && !cols.some(c => c.name === 'category_id')) {
            db.run(`ALTER TABLE saved_messages ADD COLUMN category_id INTEGER`);
        }
    });
    db.run(`CREATE TABLE IF NOT EXISTS vault_categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        name_enc TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    db.all(`PRAGMA table_info(users)`, (err, cols) => {
        if (!err && cols && !cols.some(c => c.name === 'premium_until')) {
            db.run(`ALTER TABLE users ADD COLUMN premium_until INTEGER DEFAULT 0`);
        }
    });
    db.run(`CREATE TABLE IF NOT EXISTS files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        owner_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        mime TEXT,
        size INTEGER DEFAULT 0,
        total_chunks INTEGER DEFAULT 0,
        chunk_size INTEGER DEFAULT 0,
        base_iv TEXT,
        meta TEXT,
        stored_path TEXT,
        created_at INTEGER DEFAULT (strftime('%s','now'))
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS premium_purchases (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        plan TEXT NOT NULL,
        amount REAL NOT NULL,
        transaction_id TEXT UNIQUE,
        receipt TEXT,
        created_at INTEGER DEFAULT (strftime('%s','now'))
    )`);

});

module.exports = db;
