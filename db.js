const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('render.com') ? { rejectUnauthorized: false } : false
});

async function initDb() {
  console.log('[DB] Connecting to PostgreSQL...');
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS chats (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        title TEXT,
        messages TEXT NOT NULL,
        pinned INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS configs (
        id SERIAL PRIMARY KEY,
        user_id INTEGER UNIQUE NOT NULL,
        api_url TEXT,
        api_key TEXT,
        models TEXT,
        active_model_index INTEGER DEFAULT 0,
        theme TEXT DEFAULT 'dark',
        personas TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS kb_docs (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        filename TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('[DB] PostgreSQL tables initialized successfully.');
  } catch (err) {
    console.error('[DB] Init error:', err.message);
    throw err;
  } finally {
    client.release();
  }
}

// Users
async function createUser(username, passwordHash) {
  const result = await pool.query(
    'INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id',
    [username, passwordHash]
  );
  return { lastInsertRowid: result.rows[0].id };
}

async function getUserByUsername(username) {
  const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
  return result.rows[0] || null;
}

async function getUserById(id) {
  const result = await pool.query('SELECT id, username, created_at FROM users WHERE id = $1', [id]);
  return result.rows[0] || null;
}

// Chats
async function getChatsByUser(userId) {
  const result = await pool.query(
    'SELECT id, user_id, title, messages, pinned, created_at, updated_at FROM chats WHERE user_id = $1 ORDER BY pinned DESC, updated_at DESC',
    [userId]
  );
  return result.rows;
}

async function getChatById(id, userId) {
  const result = await pool.query('SELECT * FROM chats WHERE id = $1 AND user_id = $2', [id, userId]);
  return result.rows[0] || null;
}

async function createChat(userId, title, messages) {
  const result = await pool.query(
    'INSERT INTO chats (user_id, title, messages) VALUES ($1, $2, $3) RETURNING id',
    [userId, title, JSON.stringify(messages)]
  );
  return { lastInsertRowid: result.rows[0].id };
}

async function updateChat(id, userId, title, messages) {
  await pool.query(
    'UPDATE chats SET title = $1, messages = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3 AND user_id = $4',
    [title, JSON.stringify(messages), id, userId]
  );
}

async function deleteChat(id, userId) {
  await pool.query('DELETE FROM chats WHERE id = $1 AND user_id = $2', [id, userId]);
}

async function togglePinChat(id, userId, pinned) {
  await pool.query('UPDATE chats SET pinned = $1 WHERE id = $2 AND user_id = $3', [pinned ? 1 : 0, id, userId]);
}

// Configs
async function getConfigByUser(userId) {
  const result = await pool.query('SELECT * FROM configs WHERE user_id = $1', [userId]);
  return result.rows[0] || null;
}

async function setConfig(userId, cfg) {
  const result = await pool.query(
    `INSERT INTO configs (user_id, api_url, api_key, models, active_model_index, theme, personas)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (user_id) DO UPDATE SET
       api_url = EXCLUDED.api_url,
       api_key = EXCLUDED.api_key,
       models = EXCLUDED.models,
       active_model_index = EXCLUDED.active_model_index,
       theme = EXCLUDED.theme,
       personas = EXCLUDED.personas,
       updated_at = CURRENT_TIMESTAMP
     RETURNING id`,
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
  return result.rows[0].id;
}

// KB Docs
async function getKbDocsByUser(userId) {
  const result = await pool.query(
    'SELECT id, user_id, filename, content, created_at FROM kb_docs WHERE user_id = $1 ORDER BY created_at DESC',
    [userId]
  );
  return result.rows;
}

async function createKbDoc(userId, filename, content) {
  const result = await pool.query(
    'INSERT INTO kb_docs (user_id, filename, content) VALUES ($1, $2, $3) RETURNING id',
    [userId, filename, content]
  );
  return { lastInsertRowid: result.rows[0].id };
}

async function deleteKbDoc(id, userId) {
  await pool.query('DELETE FROM kb_docs WHERE id = $1 AND user_id = $2', [id, userId]);
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
