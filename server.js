require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'default-secret-change-me';

// Admin API config (统一配置)
const ADMIN_API_URL = process.env.ADMIN_API_URL || '';
const ADMIN_API_KEY = process.env.ADMIN_API_KEY || '';

// 支持多模型配置：环境变量 ADMIN_API_MODELS 格式为 model1|label1,model2|label2
// 例如：kimi-k2.6|Kimi K2.6,deepseek-v4-pro|DeepSeek V4 Pro
function parseAdminModels() {
  const modelsEnv = process.env.ADMIN_API_MODELS;
  if (modelsEnv) {
    return modelsEnv.split(',').map(pair => {
      const parts = pair.split('|');
      return {
        name: parts[0].trim(),
        label: parts[1] ? parts[1].trim() : parts[0].trim()
      };
    }).filter(m => m.name);
  }
  // 兼容旧版单模型配置，并自动追加 deepseek-v4-pro 作为第二个默认模型
  const models = [];
  if (process.env.ADMIN_API_MODEL) {
    models.push({
      name: process.env.ADMIN_API_MODEL,
      label: process.env.ADMIN_MODEL_LABEL || process.env.ADMIN_API_MODEL
    });
  } else {
    models.push({ name: 'kimi-k2.6', label: 'Kimi K2.6' });
  }
  // 确保默认包含 deepseek-v4-pro
  if (!models.find(m => m.name === 'deepseek-v4-pro')) {
    models.push({ name: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro' });
  }
  return models;
}

const ADMIN_MODELS = parseAdminModels();
const ADMIN_API_MODEL = ADMIN_MODELS[0]?.name || 'kimi-k2.6';
const ADMIN_MODEL_LABEL = ADMIN_MODELS[0]?.label || 'Kimi K2.6';

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// JWT middleware
function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: '未登录' });
  }
  const token = authHeader.slice(7);
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.userId;
    req.username = decoded.username;
    next();
  } catch {
    return res.status(401).json({ error: '登录已过期' });
  }
}

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// Register
app.post('/api/auth/register', async (req, res) => {
  const { username, password, passwordConfirm } = req.body;
  if (!username || !password || username.length < 3 || password.length < 6) {
    return res.status(400).json({ error: '用户名至少3位，密码至少6位' });
  }
  if (password !== passwordConfirm) {
    return res.status(400).json({ error: '两次输入的密码不一致' });
  }
  const existing = db.getUserByUsername(username);
  if (existing) {
    return res.status(409).json({ error: '用户名已存在' });
  }
  const hash = await bcrypt.hash(password, 10);
  const result = db.createUser(username, hash);
  const token = jwt.sign({ userId: result.lastInsertRowid, username }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, username });
});

// Login
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  const user = db.getUserByUsername(username);
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).json({ error: '用户名或密码错误' });
  }
  const token = jwt.sign({ userId: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, username: user.username });
});

// Me
app.get('/api/auth/me', authMiddleware, (req, res) => {
  const user = db.getUserById(req.userId);
  if (!user) return res.status(404).json({ error: '用户不存在' });
  res.json(user);
});

// Get history
app.get('/api/history', authMiddleware, (req, res) => {
  const rows = db.getChatsByUser(req.userId);
  const chats = rows.map(r => ({
    id: r.id,
    title: r.title,
    messages: JSON.parse(r.messages || '[]'),
    pinned: !!r.pinned,
    created_at: r.created_at,
    updated_at: r.updated_at
  }));
  res.json(chats);
});

// Save history (upsert)
app.post('/api/history', authMiddleware, (req, res) => {
  const { id, title, messages, pinned } = req.body;
  if (!Array.isArray(messages)) {
    return res.status(400).json({ error: 'messages 必须是数组' });
  }
  if (id) {
    const existing = db.getChatById(id, req.userId);
    if (existing) {
      db.updateChat(id, req.userId, title, messages);
      if (typeof pinned === 'boolean') db.togglePinChat(id, req.userId, pinned);
      return res.json({ id });
    }
  }
  const result = db.createChat(req.userId, title, messages);
  res.json({ id: result.lastInsertRowid });
});

// Delete history
app.delete('/api/history/:id', authMiddleware, (req, res) => {
  db.deleteChat(req.params.id, req.userId);
  res.json({ ok: true });
});

// Get config
app.get('/api/config', authMiddleware, (req, res) => {
  const cfg = db.getConfigByUser(req.userId);
  if (!cfg) {
    // Return default config with admin models
    return res.json({
      url: ADMIN_API_URL,
      models: ADMIN_MODELS,
      activeModelIndex: 0,
      theme: 'dark',
      personas: []
    });
  }
  res.json({
    url: cfg.api_url || ADMIN_API_URL,
    key: cfg.api_key || '',
    models: cfg.models ? JSON.parse(cfg.models) : ADMIN_MODELS,
    activeModelIndex: cfg.active_model_index || 0,
    theme: cfg.theme || 'dark',
    personas: cfg.personas ? JSON.parse(cfg.personas) : []
  });
});

// Save config
app.post('/api/config', authMiddleware, (req, res) => {
  db.setConfig(req.userId, req.body);
  res.json({ ok: true });
});

// KB upload
app.post('/api/kb', authMiddleware, (req, res) => {
  const { filename, content } = req.body;
  if (!filename || !content) return res.status(400).json({ error: '缺少文件名或内容' });
  const result = db.createKbDoc(req.userId, filename, content);
  res.json({ id: result.lastInsertRowid });
});

// KB list
app.get('/api/kb', authMiddleware, (req, res) => {
  const docs = db.getKbDocsByUser(req.userId);
  res.json(docs);
});

// KB delete
app.delete('/api/kb/:id', authMiddleware, (req, res) => {
  db.deleteKbDoc(req.params.id, req.userId);
  res.json({ ok: true });
});

// Chat SSE proxy
app.post('/api/chat', authMiddleware, async (req, res) => {
  const { messages, model, temperature, mode, userMessage } = req.body;

  if (!ADMIN_API_URL || !ADMIN_API_KEY) {
    return res.status(503).json({ error: '管理员未配置 API' });
  }

  // Knowledge base retrieval
  let kbContext = '';
  try {
    const kbDocs = db.getKbDocsByUser(req.userId);
    if (kbDocs && kbDocs.length > 0 && userMessage) {
      const qWords = userMessage.split(/\s+/).filter(w => w.length > 1);
      const segments = [];
      kbDocs.forEach(doc => {
        const chunks = doc.content.split(/[\n。！？]/).filter(s => s.trim().length > 10);
        chunks.forEach(chunk => {
          let score = 0;
          qWords.forEach(w => { if (chunk.includes(w)) score += 1; });
          if (score > 0) segments.push({ text: chunk.trim(), score, source: doc.filename });
        });
      });
      segments.sort((a, b) => b.score - a.score);
      const top = segments.slice(0, 3);
      if (top.length) {
        kbContext = '\n\n【知识库参考】\n' + top.map((s, i) => `[${i+1}] ${s.text} (来源: ${s.source})`).join('\n') + '\n';
      }
    }
  } catch (e) {
    console.error('KB search error:', e);
  }

  // Append KB context to last user message
  const finalMessages = [...messages];
  if (kbContext && finalMessages.length > 0) {
    const lastMsg = finalMessages[finalMessages.length - 1];
    if (lastMsg.role === 'user') {
      lastMsg.content = lastMsg.content + kbContext;
    }
  }

  try {
    const response = await fetch(ADMIN_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${ADMIN_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: model || ADMIN_API_MODEL,
        messages: finalMessages,
        temperature: temperature ?? 0.7,
        stream: true
      })
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '未知错误');
      return res.status(502).json({ error: `上游 API 错误: ${errText}` });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    let done = false;
    while (!done) {
      const { value, done: readerDone } = await reader.read();
      done = readerDone;
      if (value) {
        const chunk = decoder.decode(value, { stream: !done });
        res.write(chunk);
      }
    }
    res.end();
  } catch (err) {
    console.error('Proxy error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: '代理请求失败' });
    } else {
      res.end();
    }
  }
});

async function start() {
  await db.initDb();
  app.listen(PORT, () => {
    console.log(`CCDC AI Service running on port ${PORT}`);
    console.log(`Admin API Models: ${ADMIN_MODELS.map(m => m.label).join(', ')}`);
  });
}
start();
