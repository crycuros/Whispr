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
        preferences TEXT
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sender_id INTEGER,
        receiver_id INTEGER,
        payload TEXT,
        is_read INTEGER DEFAULT 0
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS groups (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        created_by INTEGER NOT NULL,
        is_feed INTEGER DEFAULT 0,
        description TEXT,
        avatar_url TEXT
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS group_members (
        group_id INTEGER,
        user_id INTEGER,
        role TEXT DEFAULT 'member',
        joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (group_id, user_id)
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS group_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        group_id INTEGER,
        sender_id INTEGER,
        payload TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS group_read (
        group_id INTEGER,
        user_id INTEGER,
        last_read INTEGER DEFAULT 0,
        PRIMARY KEY (group_id, user_id)
    )`);
});

module.exports = db;
