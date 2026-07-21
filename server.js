require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const multer = require('multer');
const db = require('./db');
const { ingestKbDocument } = require('./services/kbIngestion');
const { isEnabled: embeddingEnabled, getEmbedding } = require('./services/embedding');
const { extractKeywords, hybridSearch, keywordFallbackSearch, formatKbContext } = require('./services/retrieval');

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

// Bond Codin — 中债系统编程大师 专用 System Prompt
const BOND_CODIN_PROMPT = `你是 Bond Codin（中债系统编程大师），一位拥有20年金融IT系统架构经验的技术专家。

【身份定位】
你同时是以下三种角色的融合体：
1. 中债中债金科企业级战略规划系统资深架构师 —— 精通Service/Logic/Mapper三层架构、AbstractBusinessService设计模式、sis.015~sis.042服务矩阵
2. 企业级代码审计专家 —— 擅长发现空指针、并发问题、SQL注入、事务边界、N+1查询、循环依赖、资源泄漏等缺陷
3. 分布式系统与云原生改造顾问 —— 精通微服务拆分、DDD限界上下文、事件驱动架构、Saga分布式事务、K8s容器化、服务网格

【核心知识体系】
- 中债金科企业级战略规划架构：Service层继承AbstractBusinessService重写doWork/doVerify；Logic层@Component业务逻辑；Mapper层MyBatis DAO
- Java企业开发：Spring生态、事务传播、并发编程、JVM调优、Maven模块化
- 金融系统特性：幂等性设计、审计留痕、数据安全、高并发峰值处理、T+0/T+1结算一致性
- 分布式架构：服务注册发现(Nacos/Eureka)、配置中心(Apollo/Nacos)、熔断降级(Sentinel/Hystrix)、链路追踪、分布式锁
- 云原生：K8s容器化、Istio服务网格、Prometheus监控、ELK日志、GitOps CI/CD

【回答规范】
1. 所有分析必须标注「风险等级」：🔴严重 / 🟠高危 / 🟡中危 / 🟢建议
2. 代码审计采用「问题定位→根因剖析→修复方案→架构影响」四段式结构
3. 涉及分布式改造时，必须给出：
   - 明确的拆分粒度建议（按领域/按功能/按数据）
   - 服务边界定义（DDD限界上下文图）
   - 数据一致性方案（Saga/TCC/最终一致）
   - 迁移路径（绞杀者模式/并行运行/直接替换/蓝绿发布）
4. 涉及性能优化时，必须给出：
   - 当前瓶颈量化分析（QPS/RT/CPU/内存）
   - 优化前后的预期指标对比
   - 具体的JVM/SQL/缓存/异步化改造方案
5. 使用中文回答，技术术语保留英文；涉及具体代码时，先给出修复后的代码块，再解释改动原因

【当前任务上下文】
用户可能提供以下类型的输入，请根据输入类型自动识别并采用相应分析策略：
- 代码片段审计：逐行扫描，标注每一行的潜在风险点
- 架构方案评审：从耦合度、扩展性、可维护性、金融合规四个维度打分
- 分布式改造咨询：输出改造蓝图（现状架构图→目标架构图→迁移路线图）
- 性能调优：输出火焰图分析思路、SQL执行计划优化、缓存策略设计
- 通用编程问题：结合中债业务场景给出最佳实践建议`;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// KB 上传配置（Render 免费版内存有限，限制 10MB）
const kbUpload = multer({
  dest: path.join(__dirname, 'uploads', 'kb_tmp'),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
});

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

// Health check（必须能在 DB 初始化失败时依然响应）
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    time: new Date().toISOString(),
    database: process.env.DATABASE_URL ? 'configured' : 'missing',
    jwt: process.env.JWT_SECRET ? 'configured' : 'missing',
    adminApi: process.env.ADMIN_API_URL ? 'configured' : 'missing',
    embeddingApi: process.env.EMBEDDING_API_URL ? 'configured' : 'missing'
  });
});

// 根路径健康检查（避免 Render 对 / 的请求导致 404/502）
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
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
  const existing = await db.getUserByUsername(username);
  if (existing) {
    return res.status(409).json({ error: '用户名已存在' });
  }
  const hash = await bcrypt.hash(password, 10);
  const result = await db.createUser(username, hash);
  const token = jwt.sign({ userId: result.lastInsertRowid, username }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, username });
});

// Login
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  const user = await db.getUserByUsername(username);
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).json({ error: '用户名或密码错误' });
  }
  const token = jwt.sign({ userId: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, username: user.username });
});

// Me
app.get('/api/auth/me', authMiddleware, async (req, res) => {
  const user = await db.getUserById(req.userId);
  if (!user) return res.status(404).json({ error: '用户不存在' });
  res.json(user);
});

// Get history
app.get('/api/history', authMiddleware, async (req, res) => {
  const rows = await db.getChatsByUser(req.userId);
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
app.post('/api/history', authMiddleware, async (req, res) => {
  const { id, title, messages, pinned } = req.body;
  if (!Array.isArray(messages)) {
    return res.status(400).json({ error: 'messages 必须是数组' });
  }
  if (id) {
    const existing = await db.getChatById(id, req.userId);
    if (existing) {
      await db.updateChat(id, req.userId, title, messages);
      if (typeof pinned === 'boolean') await db.togglePinChat(id, req.userId, pinned);
      return res.json({ id });
    }
  }
  const result = await db.createChat(req.userId, title, messages);
  res.json({ id: result.lastInsertRowid });
});

// Delete history
app.delete('/api/history/:id', authMiddleware, async (req, res) => {
  await db.deleteChat(req.params.id, req.userId);
  res.json({ ok: true });
});

// Get config
app.get('/api/config', authMiddleware, async (req, res) => {
  const cfg = await db.getConfigByUser(req.userId);
  if (!cfg) {
    // Return default config with admin models
    return res.json({
      url: ADMIN_API_URL,
      models: ADMIN_MODELS,
      activeModelIndex: 0,
      theme: 'light',
      personas: []
    });
  }
  res.json({
    url: cfg.api_url || ADMIN_API_URL,
    key: cfg.api_key || '',
    models: cfg.models ? JSON.parse(cfg.models) : ADMIN_MODELS,
    activeModelIndex: cfg.active_model_index || 0,
    theme: cfg.theme || 'light',
    personas: cfg.personas ? JSON.parse(cfg.personas) : []
  });
});

// Save config
app.post('/api/config', authMiddleware, async (req, res) => {
  await db.setConfig(req.userId, req.body);
  res.json({ ok: true });
});

// KB upload V2：后端统一解析原始文件（异步处理，立即返回，防止 Render 超时）
app.post('/api/kb/upload', authMiddleware, kbUpload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: '未选择文件' });
    // 修复 multer 对 UTF-8 文件名的 latin1 解码问题
    if (req.file.originalname) {
      req.file.originalname = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
    }
    const doc = await db.createKbDocV2(
      req.userId,
      req.file.originalname || req.file.filename,
      req.file.mimetype || 'application/octet-stream',
      req.file.size || 0,
      '',
      'processing'
    );
    // 后台异步处理，不阻塞响应
    ingestKbDocument(req.file, req.userId, {
      docId: doc.id,
      chunkSize: parseInt(req.body.chunkSize || process.env.KB_CHUNK_SIZE || '500', 10),
      overlap: parseInt(req.body.overlap || process.env.KB_CHUNK_OVERLAP || '100', 10),
    }).catch(err => {
      console.error('[KB Upload Background Error]', err.message);
      db.updateKbDocStatus(doc.id, req.userId, 'error', { errorMessage: err.message }).catch(() => {});
    });
    res.status(202).json({ id: doc.id, status: 'processing' });
  } catch (err) {
    console.error('[KB Upload]', err);
    res.status(500).json({ error: err.message || '上传处理失败' });
  }
});

// 兼容旧版：前端传已提取文本
app.post('/api/kb', authMiddleware, async (req, res) => {
  const { filename, content } = req.body;
  if (!filename || !content) return res.status(400).json({ error: '缺少文件名或内容' });
  const doc = await db.createKbDocV2(req.userId, filename, 'text/plain', content.length, content, 'ready');
  res.json({ id: doc.id });
});

// KB list
app.get('/api/kb', authMiddleware, async (req, res) => {
  const docs = await db.getKbDocsByUserV2(req.userId);
  res.json(docs);
});

// KB 文档详情
app.get('/api/kb/:id', authMiddleware, async (req, res) => {
  const doc = await db.getKbDocById(req.params.id, req.userId);
  if (!doc) return res.status(404).json({ error: '文档不存在' });
  const chunks = await db.getKbChunksByDoc(req.params.id, req.userId, 50);
  res.json({ doc, chunks });
});

// KB delete
app.delete('/api/kb/:id', authMiddleware, async (req, res) => {
  await db.deleteKbDocV2(req.params.id, req.userId);
  res.json({ ok: true });
});

// P0 routes
const announcementRoutes = require('./routes/announcements');
const financeCheckRoutes = require('./routes/financeCheck');
const complianceRoutes = require('./routes/compliance');
const localBondRoutes = require('./routes/localBond');
const taskRoutes = require('./routes/tasks');
const biddingResultRoutes = require('./routes/biddingResults');
const p1AdvancedRoutes = require('./routes/p1Advanced');
const p2AdvancedRoutes = require('./routes/p2Advanced');

app.use('/api/announcement', authMiddleware, announcementRoutes);
app.use('/api/finance', authMiddleware, financeCheckRoutes);
app.use('/api/compliance', authMiddleware, complianceRoutes);
app.use('/api/local-bond', authMiddleware, localBondRoutes);
app.use('/api/tasks', authMiddleware, taskRoutes);
app.use('/api/bidding-results', authMiddleware, biddingResultRoutes);
app.use('/api/p1', authMiddleware, p1AdvancedRoutes);
app.use('/api/p2', authMiddleware, p2AdvancedRoutes);

// Chat SSE proxy
app.post('/api/chat', authMiddleware, async (req, res) => {
  const { messages, model, temperature, mode, userMessage } = req.body;

  if (!ADMIN_API_URL || !ADMIN_API_KEY) {
    return res.status(503).json({ error: '管理员未配置 API' });
  }

  // Knowledge base retrieval (Hybrid Search)
  let kbContext = '';
  try {
    if (userMessage) {
      const topK = parseInt(process.env.KB_TOP_K || '5', 10);
      let results = [];
      if (embeddingEnabled()) {
        results = await hybridSearch(req.userId, userMessage, topK);
      } else {
        results = await keywordFallbackSearch(req.userId, userMessage, topK);
      }
      console.log('[KB] Matched chunks:', results.length, results.map(s => ({ source: s.meta?.source || s.meta?.filename, score: s.finalScore?.toFixed(3) })));
      if (results.length > 0) {
        kbContext = formatKbContext(results);
      }
    }
  } catch (e) {
    console.error('KB search error:', e);
  }

  // Bond Codin mode: replace/inject system prompt
  let finalMessages = [...messages];
  if (req.body.mode === 'bondcodin' && finalMessages.length > 0 && finalMessages[0].role === 'system') {
    finalMessages[0].content = BOND_CODIN_PROMPT;
  }

  // Append KB context to last user message
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
  console.log('========================================');
  console.log('[BOOT] CCDC AI Service starting...');
  console.log('[BOOT] Node version:', process.version);
  console.log('[BOOT] PORT:', PORT);
  console.log('[BOOT] DATABASE_URL:', process.env.DATABASE_URL ? 'SET (length=' + process.env.DATABASE_URL.length + ')' : 'MISSING');
  console.log('[BOOT] JWT_SECRET:', process.env.JWT_SECRET ? 'SET' : 'MISSING - USING INSECURE DEFAULT');
  console.log('[BOOT] ADMIN_API_URL:', process.env.ADMIN_API_URL ? 'SET' : 'MISSING');
  console.log('[BOOT] ADMIN_API_KEY:', process.env.ADMIN_API_KEY ? 'SET' : 'MISSING');
  console.log('[BOOT] EMBEDDING_API_URL:', process.env.EMBEDDING_API_URL ? 'SET' : 'MISSING');
  console.log('========================================');
  try {
    await db.initDb();
    console.log('[BOOT] Database initialized successfully');
  } catch (err) {
    console.error('[FATAL] Database initialization failed:', err.message);
    console.error('[FATAL] Stack:', err.stack);
    console.error('[FATAL] Service will start in degraded mode. KB and persistent features may not work.');
  }
  app.listen(PORT, '0.0.0.0', () => {
    console.log('========================================');
    console.log(`CCDC AI Service running on port ${PORT}`);
    console.log(`Admin API Models: ${ADMIN_MODELS.map(m => m.label).join(', ')}`);
    console.log(`DATABASE_URL set: ${process.env.DATABASE_URL ? 'Yes' : 'NO!'}`);
    console.log(`JWT_SECRET set: ${process.env.JWT_SECRET ? 'Yes (first 4 chars: ' + process.env.JWT_SECRET.slice(0,4) + '...)' : 'NO - USING DEFAULT!'}`);
    console.log('========================================');
  });
}
start().catch(err => {
  console.error('[FATAL] Startup failed:', err);
  process.exit(1);
});
