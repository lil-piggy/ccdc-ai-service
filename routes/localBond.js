const express = require('express');
const multer = require('multer');
const db = require('../db');
const { extractText } = require('../services/fileParser');
const { callAI } = require('../services/aiService');

const router = express.Router();
const upload = multer({ dest: 'uploads/' });

const LOCAL_BOND_SYSTEM_PROMPT = `你是一名地方政府专项债合规审查专家，熟悉财预〔2017〕89号等政策文件。
请根据用户提供的项目申报书和可行性研究报告，对以下检查项逐项审查：
1. 项目公益性：是否属于有一定收益的公益性项目
2. 收益覆盖倍数：项目收益/本息是否达到要求
3. 资金投向合规：是否用于禁止领域
4. 项目成熟度：前期手续是否完备
5. 还款来源：是否明确、可持续

每项输出：
- item: 检查项名称
- result: 通过/有风险/不通过
- evidence: 判断依据
- reference: 政策文件依据
- suggestion: 补充建议（如有）

最后输出总体结论：通过/有条件通过/不通过，以及 overall_score（0-100）。
返回 JSON 格式：{ "checks": [...], "conclusion": "...", "overall_score": 80 }`;

// POST /api/local-bond/check
router.post('/check', upload.array('files', 10), async (req, res) => {
  try {
    const files = req.files || [];
    if (!files.length) return res.status(400).json({ code: 400, message: '缺少项目文件', data: null });

    const projectName = req.body.project_name;
    if (!projectName) return res.status(400).json({ code: 400, message: '缺少项目名称', data: null });

    const projectType = req.body.project_type || '其他';
    const taskId = `LB-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    await db.createLocalBondCheckTask({
      user_id: req.userId,
      task_id: taskId,
      project_name: projectName,
      project_type: projectType,
      status: 'processing'
    });

    processLocalBondCheck(taskId, req.userId, files, projectName, projectType).catch(err => {
      console.error('Local bond check async error:', err);
    });

    res.json({
      code: 200,
      message: 'success',
      data: { task_id: taskId, status: 'processing', estimated_seconds: 30 }
    });
  } catch (err) {
    console.error('Local bond check route error:', err);
    res.status(500).json({ code: 500, message: err.message, data: null });
  }
});

async function processLocalBondCheck(taskId, userId, files, projectName, projectType) {
  try {
    let docText = '';
    for (const file of files) {
      const text = await extractText(file.path, file.mimetype);
      docText += `\n\n【${file.originalname}】\n${text.slice(0, 8000)}`;
      await db.createUploadedFile({
        user_id: userId,
        task_type: 'local_bond_check',
        task_id: taskId,
        file_name: file.originalname,
        file_path: file.path,
        file_size: file.size,
        mime_type: file.mimetype,
        extracted_text: text
      });
    }

    const prompt = `项目名称：${projectName}\n项目类型：${projectType}\n\n申报材料：\n${docText}`;
    const aiResult = await callAI(
      LOCAL_BOND_SYSTEM_PROMPT,
      prompt,
      { jsonMode: true, temperature: 0.2, maxTokens: 4096 }
    );

    const checks = aiResult.checks || [];
    let score = aiResult.overall_score || 0;
    let conclusion = aiResult.conclusion || '有条件通过';

    // 如果任一检查项不通过，总体结论强制为不通过
    if (checks.some(c => c.result === '不通过')) {
      conclusion = '不通过';
    }

    for (const check of checks) {
      await db.addLocalBondCheckItem(
        taskId,
        check.item,
        check.result,
        check.evidence || '',
        check.reference || '',
        check.suggestion || ''
      );
    }

    await db.completeLocalBondCheckTask(taskId, userId, score, conclusion);
  } catch (err) {
    console.error('Local bond check processing error:', err);
    await db.completeLocalBondCheckTask(taskId, userId, 0, '处理失败');
  }
}

// GET /api/local-bond/check/:task_id
router.get('/check/:task_id', async (req, res) => {
  try {
    const task = await db.getLocalBondCheckTask(req.params.task_id, req.userId);
    if (!task) return res.status(404).json({ code: 404, message: '任务不存在', data: null });

    const items = await db.getLocalBondCheckItems(req.params.task_id);

    res.json({
      code: 200,
      message: 'success',
      data: {
        task_id: task.task_id,
        project_name: task.project_name,
        project_type: task.project_type,
        status: task.status,
        conclusion: task.conclusion,
        score: task.score,
        checks: items
      }
    });
  } catch (err) {
    console.error('Get local bond check error:', err);
    res.status(500).json({ code: 500, message: err.message, data: null });
  }
});

// GET /api/local-bond/check
router.get('/check', async (req, res) => {
  try {
    const { project_name, conclusion, page = 1, page_size = 20 } = req.query;
    const { total, rows } = await db.getLocalBondCheckTasks(req.userId, {
      project_name,
      conclusion
    }, parseInt(page), parseInt(page_size));

    res.json({
      code: 200,
      message: 'success',
      data: {
        total,
        page: parseInt(page),
        page_size: parseInt(page_size),
        items: rows
      }
    });
  } catch (err) {
    console.error('List local bond checks error:', err);
    res.status(500).json({ code: 500, message: err.message, data: null });
  }
});

module.exports = router;
