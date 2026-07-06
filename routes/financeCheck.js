const express = require('express');
const multer = require('multer');
const db = require('../db');
const { extractText } = require('../services/fileParser');
const { callAI } = require('../services/aiService');

const router = express.Router();
const upload = multer({ dest: 'uploads/' });

const FINANCE_SYSTEM_PROMPT = `你是一名财务审计专家，擅长从债券申报材料中提取关键财务指标并进行跨文档一致性核查。
请从用户提供的多份文档文本中提取以下关键财务指标，并指出不同文档间的差异：
关键指标：总资产、总负债、资产负债率、净资产、营业收入、净利润、毛利率、净利率、经营活动现金流、投资活动现金流、筹资活动现金流、流动比率、速动比率、EBITDA、利息保障倍数、存量债券余额、本次发行规模。
对每个指标，输出：
- indicator: 指标名称
- unit: 单位（亿元/万元/元/%/倍/BP等）
- values: 对象，key 为文档类型（如募集说明书、审计报告、评级报告），value 为该文档中的数值（统一为亿元，缺失则为 null）
- status: 一致/轻微差异/中等差异/严重差异/来源缺失
- diff_rate: 最大差异率（0-1之间的小数）
- severity: low/medium/high

以 JSON 数组格式返回。`;

function normalizeUnit(value, unit) {
  if (value === null || value === undefined || isNaN(value)) return null;
  const v = parseFloat(value);
  if (unit && unit.includes('万亿')) return v * 10000;
  if (unit && unit.includes('亿')) return v;
  if (unit && unit.includes('万')) return v / 10000;
  if (unit && unit.includes('元') && !unit.includes('亿') && !unit.includes('万')) return v / 100000000;
  return v;
}

function calculateSeverity(values) {
  const nums = Object.values(values).filter(v => v !== null && !isNaN(v));
  if (nums.length < 2) return { status: '来源缺失', diffRate: 0, severity: 'low' };
  const max = Math.max(...nums);
  const min = Math.min(...nums);
  if (max === 0) return { status: '一致', diffRate: 0, severity: 'low' };
  const diffRate = (max - min) / max;
  if (diffRate < 0.01) return { status: '一致', diffRate, severity: 'low' };
  if (diffRate < 0.05) return { status: '轻微差异', diffRate, severity: 'low' };
  if (diffRate < 0.15) return { status: '中等差异', diffRate, severity: 'medium' };
  return { status: '严重差异', diffRate, severity: 'high' };
}

// POST /api/finance/check
router.post('/check', upload.array('files', 10), async (req, res) => {
  try {
    const files = req.files || [];
    if (files.length < 2) return res.status(400).json({ code: 400, message: '至少需要上传 2 份文档', data: null });

    const taskName = req.body.task_name || '财务勾稽核查任务';
    const taskId = `FC-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    await db.createFinanceCheckTask({
      user_id: req.userId,
      task_id: taskId,
      task_name: taskName,
      status: 'processing'
    });

    // 异步处理
    processFinanceCheck(taskId, req.userId, files, req.body.doc_types).catch(err => {
      console.error('Finance check async error:', err);
    });

    res.json({
      code: 200,
      message: 'success',
      data: { task_id: taskId, status: 'processing', estimated_seconds: 30 }
    });
  } catch (err) {
    console.error('Finance check route error:', err);
    res.status(500).json({ code: 500, message: err.message, data: null });
  }
});

async function processFinanceCheck(taskId, userId, files, docTypes) {
  try {
    const docs = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const docType = (docTypes && docTypes[i]) || '未知文档';
      const text = await extractText(file.path, file.mimetype);
      docs.push({ type: docType, file_name: file.originalname, text });

      await db.addFinanceCheckDocument(taskId, docType, file.originalname, file.path);
      await db.createUploadedFile({
        user_id: userId,
        task_type: 'finance_check',
        task_id: taskId,
        file_name: file.originalname,
        file_path: file.path,
        file_size: file.size,
        mime_type: file.mimetype,
        extracted_text: text
      });
    }

    // 拼接文档文本
    const promptText = docs.map(d => `【${d.type}】\n${d.text.slice(0, 8000)}`).join('\n\n---\n\n');

    const aiResult = await callAI(
      FINANCE_SYSTEM_PROMPT,
      `请对以下债券申报材料进行财务指标提取和跨文档一致性核查：\n\n${promptText}`,
      { jsonMode: true, temperature: 0.2, maxTokens: 4096 }
    );

    const indicators = Array.isArray(aiResult) ? aiResult : (aiResult.indicators || []);
    let consistentCount = 0;

    for (const item of indicators) {
      const values = {};
      if (item.values) {
        for (const [docType, val] of Object.entries(item.values)) {
          values[docType] = normalizeUnit(val, item.unit);
        }
      }
      const sev = calculateSeverity(values);
      await db.addFinanceCheckResult(
        taskId,
        item.indicator,
        item.unit,
        values,
        sev.status,
        sev.diffRate,
        sev.severity
      );
      if (sev.severity === 'low') consistentCount++;
    }

    const score = indicators.length ? Math.round((consistentCount / indicators.length) * 100) : 0;
    await db.completeFinanceCheckTask(taskId, userId, score / 100);
  } catch (err) {
    console.error('Finance check processing error:', err);
    await db.completeFinanceCheckTask(taskId, userId, 0);
  }
}

// GET /api/finance/check/:task_id
router.get('/check/:task_id', async (req, res) => {
  try {
    const task = await db.getFinanceCheckTask(req.params.task_id, req.userId);
    if (!task) return res.status(404).json({ code: 404, message: '任务不存在', data: null });

    const documents = await db.getFinanceCheckDocuments(req.params.task_id);
    const indicators = await db.getFinanceCheckResults(req.params.task_id);

    res.json({
      code: 200,
      message: 'success',
      data: {
        task_id: task.task_id,
        task_name: task.task_name,
        status: task.status,
        consistency_score: task.consistency_score,
        documents,
        indicators
      }
    });
  } catch (err) {
    console.error('Get finance check error:', err);
    res.status(500).json({ code: 500, message: err.message, data: null });
  }
});

// GET /api/finance/history
router.get('/history', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const pageSize = parseInt(req.query.page_size) || 20;
    const offset = (page - 1) * pageSize;
    const countResult = await db.pool.query('SELECT COUNT(*) FROM finance_check_tasks WHERE user_id = $1', [req.userId]);
    const rowsResult = await db.pool.query(
      'SELECT * FROM finance_check_tasks WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3',
      [req.userId, pageSize, offset]
    );
    res.json({
      code: 200,
      message: 'success',
      data: {
        total: parseInt(countResult.rows[0].count),
        page,
        page_size: pageSize,
        items: rowsResult.rows
      }
    });
  } catch (err) {
    console.error('Get finance history error:', err);
    res.status(500).json({ code: 500, message: err.message, data: null });
  }
});

module.exports = router;
