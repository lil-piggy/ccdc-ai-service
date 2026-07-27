const express = require('express');
const db = require('../db');
const riskEngine = require('../services/riskEngine');
const marketSimulator = require('../services/marketSimulator');

const router = express.Router();

// GET /api/risk-monitor/indicators - 获取当前实时行情与风险指标
router.get('/indicators', async (req, res) => {
  try {
    const result = await riskEngine.calculateAllIndicators(req.userId);
    // 自动保存黄色及以上预警
    if (result.alerts.length > 0) {
      await riskEngine.saveAlerts(req.userId, result.alerts);
    }
    res.json(result);
  } catch (err) {
    console.error('[RiskMonitor] indicators error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/risk-monitor/market - 获取市场行情数据（轻量）
router.get('/market', async (req, res) => {
  try {
    const treasuryCurve = marketSimulator.generateYieldCurve('treasury');
    const policyCurve = marketSimulator.generateYieldCurve('policy');
    const macro = marketSimulator.generateMacroIndicators();
    const history = marketSimulator.generateHistory(30, 'treasury', '10Y');
    const calendar = marketSimulator.generateIssueCalendar();

    res.json({
      timestamp: new Date().toISOString(),
      treasury_curve: treasuryCurve,
      policy_curve: policyCurve,
      macro: macro,
      history: history,
      calendar: calendar
    });
  } catch (err) {
    console.error('[RiskMonitor] market error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/risk-monitor/alerts - 获取预警列表
router.get('/alerts', async (req, res) => {
  try {
    const status = req.query.status || null;
    const limit = parseInt(req.query.limit) || 50;
    const alerts = await db.getRiskAlerts(req.userId, status, limit);
    res.json({ alerts: alerts, total: alerts.length });
  } catch (err) {
    console.error('[RiskMonitor] alerts error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/risk-monitor/alerts/:id/ack - 确认预警
router.post('/alerts/:id/ack', async (req, res) => {
  try {
    await db.updateRiskAlertStatus(parseInt(req.params.id), req.userId, 'acked');
    res.json({ success: true, message: '预警已确认' });
  } catch (err) {
    console.error('[RiskMonitor] ack alert error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/risk-monitor/alerts/:id/ignore - 忽略预警
router.post('/alerts/:id/ignore', async (req, res) => {
  try {
    await db.updateRiskAlertStatus(parseInt(req.params.id), req.userId, 'ignored');
    res.json({ success: true, message: '预警已忽略' });
  } catch (err) {
    console.error('[RiskMonitor] ignore alert error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/risk-monitor/simulate - 手动触发一次模拟数据更新（演示用）
router.post('/simulate', async (req, res) => {
  try {
    const result = await riskEngine.calculateAllIndicators(req.userId);
    if (result.alerts.length > 0) {
      await riskEngine.saveAlerts(req.userId, result.alerts);
    }
    res.json({
      success: true,
      message: '模拟数据已更新',
      indicators: result.indicators,
      new_alerts: result.alerts.length
    });
  } catch (err) {
    console.error('[RiskMonitor] simulate error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
