const express = require('express');
const db = require('../db');
const sandboxEngine = require('../services/sandboxEngine');

const router = express.Router();

// GET /api/sandbox/scenarios - 获取预置情景列表
router.get('/scenarios', async (req, res) => {
  try {
    // 返回预置情景（不依赖数据库，确保始终可用）
    const presets = sandboxEngine.PRESET_SCENARIOS.map((s, idx) => ({
      id: idx + 1,
      name: s.name,
      scenario_type: s.scenario_type,
      params: s.params,
      description: s.description,
      is_preset: true
    }));
    res.json({ scenarios: presets });
  } catch (err) {
    console.error('[Sandbox] scenarios error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/sandbox/run - 运行沙盘推演
router.post('/run', async (req, res) => {
  try {
    const { scenario_type, params, scenario_name } = req.body || {};

    if (!scenario_type || !params) {
      return res.status(400).json({ error: '缺少必要参数: scenario_type, params' });
    }

    // 验证情景类型
    const validTypes = ['rate_shock', 'credit_event', 'sentiment'];
    if (!validTypes.includes(scenario_type)) {
      return res.status(400).json({ error: `无效的情景类型，支持: ${validTypes.join(', ')}` });
    }

    // 运行推演
    const result = await sandboxEngine.runSandbox(req.userId, scenario_type, params, scenario_name);

    // 保存到数据库
    const saved = await db.createSandboxResult({
      user_id: req.userId,
      scenario_id: null,
      scenario_name: result.scenario_name,
      params: result.params,
      baseline_curve: result.baseline_curve,
      shocked_curve: result.shocked_curve,
      risk_transmission: result.risk_transmission,
      impact_summary: result.impact_summary,
      ai_report: result.ai_report
    });

    res.json({
      success: true,
      result_id: saved.id,
      ...result
    });
  } catch (err) {
    console.error('[Sandbox] run error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/sandbox/history - 获取历史推演记录
router.get('/history', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;
    const results = await db.getSandboxResults(req.userId, limit);
    res.json({ results: results, total: results.length });
  } catch (err) {
    console.error('[Sandbox] history error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/sandbox/:id - 获取单次推演详情
router.get('/:id', async (req, res) => {
  try {
    const result = await db.getSandboxResultById(parseInt(req.params.id), req.userId);
    if (!result) {
      return res.status(404).json({ error: '推演记录不存在' });
    }
    res.json(result);
  } catch (err) {
    console.error('[Sandbox] get result error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
