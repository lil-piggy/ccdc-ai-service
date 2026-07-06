const express = require('express');
const multer = require('multer');
const db = require('../db');
const { extractText } = require('../services/fileParser');
const { callAI } = require('../services/aiService');

const router = express.Router();
const upload = multer({ dest: 'uploads/' });

const COMPLIANCE_SYSTEM_PROMPT = `你是一名债券合规审查专家，熟悉证监会、交易所、发改委、交易商协会等机构的监管规则。
请根据用户提供的监管规则和待审核材料，识别是否触发负面清单或合规红线。
每条风险点必须包含：
- level: 风险等级，只能是 high/medium/low/suggestion
- category: 风险类别（如募集资金用途、地方政府债务、信息披露、发行条件等）
- description: 风险描述
- source_text: 原文引用
- rule_reference: 对应监管条款
- suggestion: 修改建议

以 JSON 数组格式返回所有风险点。如果没有发现风险，返回空数组。`;

// POST /api/compliance/rules 上传规则文件
router.post('/rules', upload.array('files', 10), async (req, res) => {
  try {
    const files = req.files || [];
    const { bond_type, effective_date } = req.body;
    if (!files.length) return res.status(400).json({ code: 400, message: '缺少规则文件', data: null });

    const createdIds = [];
    for (const file of files) {
      const text = await extractText(file.path, file.mimetype);
      // 简单按段落拆分，每段作为一条规则
      const paragraphs = text.split(/\n{2,}/).filter(p => p.trim().length > 20);
      for (const para of paragraphs) {
        const result = await db.createComplianceRule({
          user_id: req.userId,
          bond_type: bond_type || '通用',
          rule_category: '监管规则',
          rule_title: para.slice(0, 80),
          rule_content: para,
          reference: file.originalname,
          effective_date: effective_date || null
        });
        createdIds.push(result.id);
      }
    }

    res.json({ code: 200, message: 'success', data: { created_count: createdIds.length } });
  } catch (err) {
    console.error('Upload compliance rules error:', err);
    res.status(500).json({ code: 500, message: err.message, data: null });
  }
});

// GET /api/compliance/rules
router.get('/rules', async (req, res) => {
  try {
    const { bond_type, keyword } = req.query;
    const rules = await db.getComplianceRules(req.userId, { bond_type, keyword });
    res.json({ code: 200, message: 'success', data: { items: rules } });
  } catch (err) {
    console.error('Get compliance rules error:', err);
    res.status(500).json({ code: 500, message: err.message, data: null });
  }
});

// POST /api/compliance/check
router.post('/check', upload.array('files', 10), async (req, res) => {
  try {
    const files = req.files || [];
    if (!files.length) return res.status(400).json({ code: 400, message: '缺少待审核文件', data: null });

    const bondType = req.body.bond_type || '通用';
    const taskId = `CP-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    await db.createComplianceCheckTask({
      user_id: req.userId,
      task_id: taskId,
      bond_type: bondType,
      status: 'processing'
    });

    processComplianceCheck(taskId, req.userId, files, bondType).catch(err => {
      console.error('Compliance check async error:', err);
    });

    res.json({
      code: 200,
      message: 'success',
      data: { task_id: taskId, status: 'processing', estimated_seconds: 30 }
    });
  } catch (err) {
    console.error('Compliance check route error:', err);
    res.status(500).json({ code: 500, message: err.message, data: null });
  }
});

async function processComplianceCheck(taskId, userId, files, bondType) {
  try {
    // 获取相关规则
    const rules = await db.getComplianceRules(userId, { bond_type: bondType });
    const rulesText = rules.slice(0, 30).map(r => `【${r.rule_category}】${r.rule_content}`).join('\n\n');

    // 提取待审核文本
    let docText = '';
    for (const file of files) {
      const text = await extractText(file.path, file.mimetype);
      docText += `\n\n【${file.originalname}】\n${text.slice(0, 6000)}`;
      await db.createUploadedFile({
        user_id: userId,
        task_type: 'compliance_check',
        task_id: taskId,
        file_name: file.originalname,
        file_path: file.path,
        file_size: file.size,
        mime_type: file.mimetype,
        extracted_text: text
      });
    }

    const prompt = `监管规则：\n${rulesText}\n\n待审核材料：\n${docText}`;
    const aiResult = await callAI(
      COMPLIANCE_SYSTEM_PROMPT,
      prompt,
      { jsonMode: true, temperature: 0.2, maxTokens: 4096 }
    );

    const risks = Array.isArray(aiResult) ? aiResult : (aiResult.risks || []);
    let highCount = 0;
    let mediumCount = 0;

    for (const risk of risks) {
      await db.addComplianceCheckRisk(
        taskId,
        risk.level || 'low',
        risk.category || '其他',
        risk.description || '',
        risk.source_text || '',
        risk.rule_reference || '',
        risk.suggestion || ''
      );
      if (risk.level === 'high') highCount++;
      if (risk.level === 'medium') mediumCount++;
    }

    const score = Math.max(0, 100 - highCount * 25 - mediumCount * 10);
    const conclusion = highCount > 0 ? '存在严重问题，需修改' : (mediumCount > 0 ? '存在中等问题，建议修改' : '通过');
    await db.completeComplianceCheckTask(taskId, userId, score, conclusion);
  } catch (err) {
    console.error('Compliance check processing error:', err);
    await db.completeComplianceCheckTask(taskId, userId, 0, '处理失败');
  }
}

// GET /api/compliance/check/:task_id
router.get('/check/:task_id', async (req, res) => {
  try {
    const task = await db.getComplianceCheckTask(req.params.task_id, req.userId);
    if (!task) return res.status(404).json({ code: 404, message: '任务不存在', data: null });

    const risks = await db.getComplianceCheckRisks(req.params.task_id);

    res.json({
      code: 200,
      message: 'success',
      data: {
        task_id: task.task_id,
        bond_type: task.bond_type,
        status: task.status,
        overall_score: task.overall_score,
        conclusion: task.conclusion,
        risks
      }
    });
  } catch (err) {
    console.error('Get compliance check error:', err);
    res.status(500).json({ code: 500, message: err.message, data: null });
  }
});

// GET /api/compliance/history
router.get('/history', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const pageSize = parseInt(req.query.page_size) || 20;
    const offset = (page - 1) * pageSize;
    const countResult = await db.pool.query('SELECT COUNT(*) FROM compliance_check_tasks WHERE user_id = $1', [req.userId]);
    const rowsResult = await db.pool.query(
      'SELECT * FROM compliance_check_tasks WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3',
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
    console.error('Get compliance history error:', err);
    res.status(500).json({ code: 500, message: err.message, data: null });
  }
});

module.exports = router;
