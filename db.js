const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const dbPath = process.env.DB_PATH || path.join(__dirname, 'data.sqlite');

let SQL, db;

async function initDb() {
  SQL = await initSqlJs();
  if (fs.existsSync(dbPath)) {
    const filebuffer = fs.readFileSync(dbPath);
    db = new SQL.Database(filebuffer);
  } else {
    db = new SQL.Database();
  }
  initTables();
}

function saveDb() {
  try {
    const data = db.export();
    fs.writeFileSync(dbPath, Buffer.from(data));
  } catch (err) {
    console.error('DB save error:', err);
  }
}

function run(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  stmt.step();
  stmt.free();
  const idRow = getOne('SELECT last_insert_rowid() as id');
  saveDb();
  return { lastID: idRow ? idRow.id : null };
}

function getOne(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const result = stmt.step() ? stmt.getAsObject() : null;
  stmt.free();
  return result;
}

function getAll(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const results = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject());
  }
  stmt.free();
  return results;
}

function lastId() {
  const row = getOne('SELECT last_insert_rowid() as id');
  return row ? row.id : null;
}

function initTables() {
  run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );`);

  run(`CREATE TABLE IF NOT EXISTS chats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    title TEXT,
    messages TEXT NOT NULL,
    pinned INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );`);

  run(`CREATE TABLE IF NOT EXISTS configs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER UNIQUE NOT NULL,
    api_url TEXT,
    api_key TEXT,
    models TEXT,
    active_model_index INTEGER DEFAULT 0,
    theme TEXT DEFAULT 'dark',
    personas TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );`);

  run(`CREATE TABLE IF NOT EXISTS kb_docs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    filename TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );`);
}

// Users
function createUser(username, passwordHash) {
  const result = run('INSERT INTO users (username, password_hash) VALUES (?, ?)', [username, passwordHash]);
  return { lastInsertRowid: result.lastID };
}

function getUserByUsername(username) {
  return getOne('SELECT * FROM users WHERE username = ?', [username]);
}

function getUserById(id) {
  return getOne('SELECT id, username, created_at FROM users WHERE id = ?', [id]);
}

// Chats
function getChatsByUser(userId) {
  return getAll(
    'SELECT id, user_id, title, messages, pinned, created_at, updated_at FROM chats WHERE user_id = ? ORDER BY pinned DESC, updated_at DESC',
    [userId]
  );
}

function getChatById(id, userId) {
  return getOne('SELECT * FROM chats WHERE id = ? AND user_id = ?', [id, userId]);
}

function createChat(userId, title, messages) {
  const result = run('INSERT INTO chats (user_id, title, messages) VALUES (?, ?, ?)', [userId, title, JSON.stringify(messages)]);
  return { lastInsertRowid: result.lastID };
}

function updateChat(id, userId, title, messages) {
  run('UPDATE chats SET title = ?, messages = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?', [title, JSON.stringify(messages), id, userId]);
}

function deleteChat(id, userId) {
  run('DELETE FROM chats WHERE id = ? AND user_id = ?', [id, userId]);
}

function togglePinChat(id, userId, pinned) {
  run('UPDATE chats SET pinned = ? WHERE id = ? AND user_id = ?', [pinned ? 1 : 0, id, userId]);
}

// Configs
function getConfigByUser(userId) {
  return getOne('SELECT * FROM configs WHERE user_id = ?', [userId]);
}

function setConfig(userId, cfg) {
  const existing = getConfigByUser(userId);
  if (existing) {
    run(
      'UPDATE configs SET api_url = ?, api_key = ?, models = ?, active_model_index = ?, theme = ?, personas = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?',
      [
        cfg.api_url || null,
        cfg.api_key || null,
        cfg.models ? JSON.stringify(cfg.models) : null,
        cfg.active_model_index ?? 0,
        cfg.theme || 'dark',
        cfg.personas ? JSON.stringify(cfg.personas) : null,
        userId
      ]
    );
    return existing.id;
  } else {
    run(
      'INSERT INTO configs (user_id, api_url, api_key, models, active_model_index, theme, personas) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [
        userId,
        cfg.api_url || null,
        cfg.api_key || null,
        cfg.models ? JSON.stringify(cfg.models) : null,
        cfg.active_model_index ?? 0,
        cfg.theme || 'dark',
        cfg.personas ? JSON.stringify(cfg.personas) : null
      ]
    );
    return lastId();
  }
}

// KB Docs
function getKbDocsByUser(userId) {
  return getAll('SELECT id, user_id, filename, content, created_at FROM kb_docs WHERE user_id = ? ORDER BY created_at DESC', [userId]);
}

function createKbDoc(userId, filename, content) {
  const result = run('INSERT INTO kb_docs (user_id, filename, content) VALUES (?, ?, ?)', [userId, filename, content]);
  return { lastInsertRowid: result.lastID };
}

function deleteKbDoc(id, userId) {
  run('DELETE FROM kb_docs WHERE id = ? AND user_id = ?', [id, userId]);
}

module.exports = {
  initDb,
  createUser,
  getUserByUsername,
  getUserById,
  getChatsByUser,
  getChatById,
  createChat,
  updateChat,
  deleteChat,
  togglePinChat,
  getConfigByUser,
  setConfig,
  getKbDocsByUser,
  createKbDoc,
  deleteKbDoc
};
