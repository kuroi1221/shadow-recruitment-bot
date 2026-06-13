const Database = require("better-sqlite3");

const db = new Database("database.db");
db.pragma("journal_mode = WAL");

// recruiters table
db.prepare(`
CREATE TABLE IF NOT EXISTS recruiters (
    userId TEXT PRIMARY KEY,
    verified INTEGER DEFAULT 0,
    pending INTEGER DEFAULT 0,
    lost INTEGER DEFAULT 0
)
`).run();

// pending recruits
db.prepare(`
CREATE TABLE IF NOT EXISTS pending_recruits (
    memberId TEXT PRIMARY KEY,
    recruiterId TEXT,
    joinedAt INTEGER
)
`).run();

// settings
db.prepare(`
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
)
`).run();

// verified recruits
db.prepare(`
CREATE TABLE IF NOT EXISTS verified_recruits (
    memberId TEXT PRIMARY KEY,
    recruiterId TEXT,
    verifiedAt INTEGER
)

`).run();

module.exports = db;

