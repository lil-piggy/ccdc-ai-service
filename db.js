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

    // P0: 招标公告结构化提取
    await client.query(`
      CREATE TABLE IF NOT EXISTS bond_announcements (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        file_name VARCHAR(255),
        file_path TEXT,
        source VARCHAR(50),
        doc_type VARCHAR(50) DEFAULT 'announcement',
        bond_code VARCHAR(50),
        bond_name VARCHAR(255),
        issuer VARCHAR(255),
        bond_type VARCHAR(50),
        issue_date DATE,
        issue_scale DECIMAL(18,4),
        term VARCHAR(20),
        bidding_method VARCHAR(50),
        benchmark_rate DECIMAL(10,4),
        basic_spread DECIMAL(10,4),
        is_reissue BOOLEAN DEFAULT FALSE,
        lead_underwriter VARCHAR(255),
        underwriters TEXT,
        raw_extracted JSONB,
        status VARCHAR(50) DEFAULT 'pending',
        confidence DECIMAL(3,2),
        extracted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    // 兼容旧表：补充 doc_type 和 raw_extracted 字段
    try {
      await client.query(`ALTER TABLE bond_announcements ADD COLUMN IF NOT EXISTS doc_type VARCHAR(50) DEFAULT 'announcement'`);
      await client.query(`ALTER TABLE bond_announcements ADD COLUMN IF NOT EXISTS raw_extracted JSONB`);
    } catch (e) {
      console.log('[DB] bond_announcements columns already exist or alter failed:', e.message);
    }

    // P0: 跨文档财务勾稽核查
    await client.query(`
      CREATE TABLE IF NOT EXISTS finance_check_tasks (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        task_id VARCHAR(50) UNIQUE,
        task_name VARCHAR(255),
        status VARCHAR(50) DEFAULT 'processing',
        consistency_score DECIMAL(3,2),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        completed_at TIMESTAMP
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS finance_check_documents (
        id SERIAL PRIMARY KEY,
        task_id VARCHAR(50) REFERENCES finance_check_tasks(task_id),
        doc_type VARCHAR(50),
        file_name VARCHAR(255),
        file_path TEXT
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS finance_check_results (
        id SERIAL PRIMARY KEY,
        task_id VARCHAR(50) REFERENCES finance_check_tasks(task_id),
        indicator VARCHAR(100),
        unit VARCHAR(20),
        doc_values JSONB,
        status VARCHAR(50),
        diff_rate DECIMAL(10,4),
        severity VARCHAR(20)
      )
    `);

    // P0: 负面清单/合规红线初审
    await client.query(`
      CREATE TABLE IF NOT EXISTS compliance_rules (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        bond_type VARCHAR(50),
        rule_category VARCHAR(100),
        rule_title VARCHAR(255),
        rule_content TEXT,
        reference VARCHAR(255),
        effective_date DATE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS compliance_check_tasks (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        task_id VARCHAR(50) UNIQUE,
        bond_type VARCHAR(50),
        overall_score INTEGER,
        conclusion VARCHAR(100),
        status VARCHAR(50) DEFAULT 'processing',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        completed_at TIMESTAMP
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS compliance_check_risks (
        id SERIAL PRIMARY KEY,
        task_id VARCHAR(50) REFERENCES compliance_check_tasks(task_id),
        level VARCHAR(20),
        category VARCHAR(100),
        description TEXT,
        source_text TEXT,
        rule_reference VARCHAR(255),
        suggestion TEXT
      )
    `);

    // P0: 地方债合规预检
    await client.query(`
      CREATE TABLE IF NOT EXISTS local_bond_check_tasks (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        task_id VARCHAR(50) UNIQUE,
        project_name VARCHAR(255),
        project_type VARCHAR(50),
        conclusion VARCHAR(50),
        score INTEGER,
        status VARCHAR(50) DEFAULT 'processing',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        completed_at TIMESTAMP
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS local_bond_check_items (
        id SERIAL PRIMARY KEY,
        task_id VARCHAR(50) REFERENCES local_bond_check_tasks(task_id),
        item_name VARCHAR(100),
        result VARCHAR(50),
        evidence TEXT,
        reference VARCHAR(255),
        suggestion TEXT
      )
    `);

    // 公共：上传文件记录
    await client.query(`
      CREATE TABLE IF NOT EXISTS uploaded_files (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        task_type VARCHAR(50),
        task_id VARCHAR(50),
        file_name VARCHAR(255),
        file_path TEXT,
        file_size BIGINT,
        mime_type VARCHAR(100),
        extracted_text TEXT,
        uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 公共：异步任务队列
    await client.query(`
      CREATE TABLE IF NOT EXISTS ai_tasks (
        id SERIAL PRIMARY KEY,
        task_id VARCHAR(50) UNIQUE,
        user_id INTEGER REFERENCES users(id),
        task_type VARCHAR(50),
        status VARCHAR(50) DEFAULT 'pending',
        progress INTEGER DEFAULT 0,
        result JSONB,
        error_message TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        completed_at TIMESTAMP
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

// ==================== P0: 招标公告 ====================
async function createAnnouncement(data) {
  const result = await pool.query(
    `INSERT INTO bond_announcements
     (user_id, file_name, file_path, source, doc_type, bond_code, bond_name, issuer, bond_type,
      issue_date, issue_scale, term, bidding_method, benchmark_rate, basic_spread,
      is_reissue, lead_underwriter, underwriters, raw_extracted, status, confidence)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
     RETURNING id`,
    [data.user_id, data.file_name, data.file_path, data.source, data.doc_type || 'announcement',
     data.bond_code, data.bond_name, data.issuer, data.bond_type, data.issue_date, data.issue_scale,
     data.term, data.bidding_method, data.benchmark_rate, data.basic_spread,
     data.is_reissue, data.lead_underwriter, data.underwriters,
     data.raw_extracted ? JSON.stringify(data.raw_extracted) : null,
     data.status, data.confidence]
  );
  return result.rows[0];
}

async function getAnnouncements(userId, filters = {}, page = 1, pageSize = 20) {
  const conditions = ['user_id = $1'];
  const params = [userId];
  let idx = 2;
  if (filters.start_date) { conditions.push(`issue_date >= $${idx++}`); params.push(filters.start_date); }
  if (filters.end_date) { conditions.push(`issue_date <= $${idx++}`); params.push(filters.end_date); }
  if (filters.bond_type) { conditions.push(`bond_type = $${idx++}`); params.push(filters.bond_type); }
  if (filters.status) { conditions.push(`status = $${idx++}`); params.push(filters.status); }
  const where = conditions.join(' AND ');
  const offset = (page - 1) * pageSize;
  const countResult = await pool.query(`SELECT COUNT(*) FROM bond_announcements WHERE ${where}`, params);
  const rowsResult = await pool.query(
    `SELECT * FROM bond_announcements WHERE ${where} ORDER BY issue_date DESC LIMIT $${idx++} OFFSET $${idx++}`,
    [...params, pageSize, offset]
  );
  return { total: parseInt(countResult.rows[0].count), rows: rowsResult.rows };
}

async function getAnnouncementById(id, userId) {
  const result = await pool.query('SELECT * FROM bond_announcements WHERE id = $1 AND user_id = $2', [id, userId]);
  return result.rows[0] || null;
}

async function updateAnnouncement(id, userId, data) {
  const fields = [];
  const params = [];
  let idx = 1;
  const allowed = ['bond_code','bond_name','issuer','bond_type','issue_date','issue_scale','term','bidding_method','benchmark_rate','basic_spread','is_reissue','lead_underwriter','underwriters','status','confidence'];
  allowed.forEach(key => {
    if (data[key] !== undefined) {
      fields.push(`${key} = $${idx++}`);
      params.push(data[key]);
    }
  });
  if (fields.length === 0) return;
  params.push(id, userId);
  await pool.query(
    `UPDATE bond_announcements SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = $${idx++} AND user_id = $${idx++}`,
    params
  );
}

// ==================== P0: 财务勾稽核查 ====================
async function createFinanceCheckTask(data) {
  const result = await pool.query(
    'INSERT INTO finance_check_tasks (user_id, task_id, task_name, status) VALUES ($1,$2,$3,$4) RETURNING id',
    [data.user_id, data.task_id, data.task_name, data.status]
  );
  return result.rows[0];
}

async function getFinanceCheckTask(taskId, userId) {
  const result = await pool.query(
    'SELECT * FROM finance_check_tasks WHERE task_id = $1 AND user_id = $2',
    [taskId, userId]
  );
  return result.rows[0] || null;
}

async function addFinanceCheckDocument(taskId, docType, fileName, filePath) {
  await pool.query(
    'INSERT INTO finance_check_documents (task_id, doc_type, file_name, file_path) VALUES ($1,$2,$3,$4)',
    [taskId, docType, fileName, filePath]
  );
}

async function addFinanceCheckResult(taskId, indicator, unit, docValues, status, diffRate, severity) {
  await pool.query(
    'INSERT INTO finance_check_results (task_id, indicator, unit, doc_values, status, diff_rate, severity) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [taskId, indicator, unit, JSON.stringify(docValues), status, diffRate, severity]
  );
}

async function completeFinanceCheckTask(taskId, userId, score) {
  await pool.query(
    'UPDATE finance_check_tasks SET status = $1, consistency_score = $2, completed_at = CURRENT_TIMESTAMP WHERE task_id = $3 AND user_id = $4',
    ['completed', score, taskId, userId]
  );
}

async function getFinanceCheckDocuments(taskId) {
  const result = await pool.query('SELECT * FROM finance_check_documents WHERE task_id = $1', [taskId]);
  return result.rows;
}

async function getFinanceCheckResults(taskId) {
  const result = await pool.query('SELECT * FROM finance_check_results WHERE task_id = $1', [taskId]);
  return result.rows;
}

// ==================== P0: 合规初审 ====================
async function createComplianceRule(data) {
  const result = await pool.query(
    'INSERT INTO compliance_rules (user_id, bond_type, rule_category, rule_title, rule_content, reference, effective_date) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id',
    [data.user_id, data.bond_type, data.rule_category, data.rule_title, data.rule_content, data.reference, data.effective_date]
  );
  return result.rows[0];
}

async function getComplianceRules(userId, filters = {}) {
  const conditions = ['user_id = $1'];
  const params = [userId];
  let idx = 2;
  if (filters.bond_type) { conditions.push(`bond_type = $${idx++}`); params.push(filters.bond_type); }
  if (filters.keyword) { conditions.push(`(rule_title ILIKE $${idx} OR rule_content ILIKE $${idx})`); params.push(`%${filters.keyword}%`); idx++; }
  const where = conditions.join(' AND ');
  const result = await pool.query(`SELECT * FROM compliance_rules WHERE ${where} ORDER BY created_at DESC`, params);
  return result.rows;
}

async function createComplianceCheckTask(data) {
  const result = await pool.query(
    'INSERT INTO compliance_check_tasks (user_id, task_id, bond_type, status) VALUES ($1,$2,$3,$4) RETURNING id',
    [data.user_id, data.task_id, data.bond_type, data.status]
  );
  return result.rows[0];
}

async function getComplianceCheckTask(taskId, userId) {
  const result = await pool.query('SELECT * FROM compliance_check_tasks WHERE task_id = $1 AND user_id = $2', [taskId, userId]);
  return result.rows[0] || null;
}

async function addComplianceCheckRisk(taskId, level, category, description, sourceText, ruleReference, suggestion) {
  await pool.query(
    'INSERT INTO compliance_check_risks (task_id, level, category, description, source_text, rule_reference, suggestion) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [taskId, level, category, description, sourceText, ruleReference, suggestion]
  );
}

async function completeComplianceCheckTask(taskId, userId, score, conclusion) {
  await pool.query(
    'UPDATE compliance_check_tasks SET status = $1, overall_score = $2, conclusion = $3, completed_at = CURRENT_TIMESTAMP WHERE task_id = $4 AND user_id = $5',
    ['completed', score, conclusion, taskId, userId]
  );
}

async function getComplianceCheckRisks(taskId) {
  const result = await pool.query('SELECT * FROM compliance_check_risks WHERE task_id = $1 ORDER BY level', [taskId]);
  return result.rows;
}

// ==================== P0: 地方债合规预检 ====================
async function createLocalBondCheckTask(data) {
  const result = await pool.query(
    'INSERT INTO local_bond_check_tasks (user_id, task_id, project_name, project_type, status) VALUES ($1,$2,$3,$4,$5) RETURNING id',
    [data.user_id, data.task_id, data.project_name, data.project_type, data.status]
  );
  return result.rows[0];
}

async function getLocalBondCheckTask(taskId, userId) {
  const result = await pool.query('SELECT * FROM local_bond_check_tasks WHERE task_id = $1 AND user_id = $2', [taskId, userId]);
  return result.rows[0] || null;
}

async function addLocalBondCheckItem(taskId, itemName, result, evidence, reference, suggestion) {
  await pool.query(
    'INSERT INTO local_bond_check_items (task_id, item_name, result, evidence, reference, suggestion) VALUES ($1,$2,$3,$4,$5,$6)',
    [taskId, itemName, result, evidence, reference, suggestion]
  );
}

async function completeLocalBondCheckTask(taskId, userId, score, conclusion) {
  await pool.query(
    'UPDATE local_bond_check_tasks SET status = $1, score = $2, conclusion = $3, completed_at = CURRENT_TIMESTAMP WHERE task_id = $4 AND user_id = $5',
    ['completed', score, conclusion, taskId, userId]
  );
}

async function getLocalBondCheckItems(taskId) {
  const result = await pool.query('SELECT * FROM local_bond_check_items WHERE task_id = $1', [taskId]);
  return result.rows;
}

async function getLocalBondCheckTasks(userId, filters = {}, page = 1, pageSize = 20) {
  const conditions = ['user_id = $1'];
  const params = [userId];
  let idx = 2;
  if (filters.project_name) { conditions.push(`project_name ILIKE $${idx++}`); params.push(`%${filters.project_name}%`); }
  if (filters.conclusion) { conditions.push(`conclusion = $${idx++}`); params.push(filters.conclusion); }
  const where = conditions.join(' AND ');
  const offset = (page - 1) * pageSize;
  const countResult = await pool.query(`SELECT COUNT(*) FROM local_bond_check_tasks WHERE ${where}`, params);
  const rowsResult = await pool.query(
    `SELECT * FROM local_bond_check_tasks WHERE ${where} ORDER BY created_at DESC LIMIT $${idx++} OFFSET $${idx++}`,
    [...params, pageSize, offset]
  );
  return { total: parseInt(countResult.rows[0].count), rows: rowsResult.rows };
}

// ==================== 公共：文件与任务 ====================
async function createUploadedFile(data) {
  const result = await pool.query(
    'INSERT INTO uploaded_files (user_id, task_type, task_id, file_name, file_path, file_size, mime_type, extracted_text) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id',
    [data.user_id, data.task_type, data.task_id, data.file_name, data.file_path, data.file_size, data.mime_type, data.extracted_text]
  );
  return result.rows[0];
}

async function createAiTask(data) {
  const result = await pool.query(
    'INSERT INTO ai_tasks (task_id, user_id, task_type, status, progress) VALUES ($1,$2,$3,$4,$5) RETURNING id',
    [data.task_id, data.user_id, data.task_type, data.status || 'pending', data.progress || 0]
  );
  return result.rows[0];
}

async function getAiTask(taskId, userId) {
  const result = await pool.query('SELECT * FROM ai_tasks WHERE task_id = $1 AND user_id = $2', [taskId, userId]);
  return result.rows[0] || null;
}

async function updateAiTask(taskId, userId, updates) {
  const fields = [];
  const params = [];
  let idx = 1;
  ['status','progress','result','error_message','completed_at'].forEach(key => {
    if (updates[key] !== undefined) {
      fields.push(`${key} = $${idx++}`);
      params.push(updates[key]);
    }
  });
  if (fields.length === 0) return;
  params.push(taskId, userId);
  await pool.query(
    `UPDATE ai_tasks SET ${fields.join(', ')} WHERE task_id = $${idx++} AND user_id = $${idx++}`,
    params
  );
}

module.exports = {
  pool,
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
  deleteKbDoc,
  // P0
  createAnnouncement,
  getAnnouncements,
  getAnnouncementById,
  updateAnnouncement,
  createFinanceCheckTask,
  getFinanceCheckTask,
  addFinanceCheckDocument,
  addFinanceCheckResult,
  completeFinanceCheckTask,
  getFinanceCheckDocuments,
  getFinanceCheckResults,
  createComplianceRule,
  getComplianceRules,
  createComplianceCheckTask,
  getComplianceCheckTask,
  addComplianceCheckRisk,
  completeComplianceCheckTask,
  getComplianceCheckRisks,
  createLocalBondCheckTask,
  getLocalBondCheckTask,
  addLocalBondCheckItem,
  completeLocalBondCheckTask,
  getLocalBondCheckItems,
  getLocalBondCheckTasks,
  createUploadedFile,
  createAiTask,
  getAiTask,
  updateAiTask
};
