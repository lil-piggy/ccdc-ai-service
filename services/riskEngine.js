// 风险指标计算引擎：收益偏差、投标集中度、异常报价、流动性紧张
const db = require('../db');
const marketSimulator = require('./marketSimulator');

// 阈值配置
const THRESHOLDS = {
  yield_deviation: { red: 3.0, orange: 2.0, yellow: 1.0 },      // 百分比
  bid_concentration: { red: 60, orange: 50, yellow: 40 },       // CR5 百分比
  abnormal_quote: { red: 10, orange: 5, yellow: 2 },            // 异常报价占比百分比
  liquidity_stress: { red: 0.8, orange: 0.6, yellow: 0.4 }      // 综合指数 0-1
};

// 计算收益偏差：|发行利率 - 估值收益率| / 估值收益率
function calculateYieldDeviation(issueRate, valuationRate) {
  if (!valuationRate || valuationRate === 0) return 0;
  return Math.abs(issueRate - valuationRate) / valuationRate * 100;
}

// 计算投标集中度：前五大承销商投标金额占比（CR5）
function calculateBidConcentration(bids) {
  if (!bids || bids.length === 0) return 0;
  const sorted = [...bids].sort((a, b) => b.bid_amount - a.bid_amount);
  const top5 = sorted.slice(0, 5);
  const total = bids.reduce((sum, b) => sum + b.bid_amount, 0);
  if (total === 0) return 0;
  return top5.reduce((sum, b) => sum + b.bid_amount, 0) / total * 100;
}

// 计算异常报价：偏离全场平均利率 ±2σ 的笔数占比
function calculateAbnormalQuote(bids) {
  if (!bids || bids.length === 0) return 0;
  const rates = bids.map(b => b.bid_rate);
  const mean = rates.reduce((a, b) => a + b, 0) / rates.length;
  const variance = rates.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / rates.length;
  const stdDev = Math.sqrt(variance);
  if (stdDev === 0) return 0;

  const abnormalCount = rates.filter(r => Math.abs(r - mean) > 2 * stdDev).length;
  return abnormalCount / rates.length * 100;
}

// 计算流动性紧张指数（0-1）：基于利率波动、成交量变化、买卖价差模拟
function calculateLiquidityStress(yieldHistory, turnoverHistory) {
  if (!yieldHistory || yieldHistory.length < 2) return 0.3;

  // 利率波动率
  const changes = [];
  for (let i = 1; i < yieldHistory.length; i++) {
    changes.push(Math.abs(yieldHistory[i].value - yieldHistory[i - 1].value));
  }
  const avgChange = changes.reduce((a, b) => a + b, 0) / changes.length;
  const volatility = Math.min(avgChange / 0.1, 1); // 假设日变动 10bp 为极端

  // 成交量萎缩程度（如果 turnoverHistory 可用）
  let volumeStress = 0.3;
  if (turnoverHistory && turnoverHistory.length >= 2) {
    const recent = turnoverHistory.slice(-3).reduce((a, b) => a + b, 0) / 3;
    const previous = turnoverHistory.slice(-6, -3).reduce((a, b) => a + b, 0) / 3;
    if (previous > 0) {
      volumeStress = Math.max(0, Math.min(1, (previous - recent) / previous));
    }
  }

  // 买卖价差模拟（基于收益率水平，收益率越高流动性越差）
  const currentYield = yieldHistory[yieldHistory.length - 1].value;
  const spreadStress = Math.min(Math.max((currentYield - 2.0) / 1.5, 0), 1);

  return parseFloat((volatility * 0.4 + volumeStress * 0.3 + spreadStress * 0.3).toFixed(4));
}

// 获取风险等级
function getRiskLevel(value, type) {
  const t = THRESHOLDS[type];
  if (value >= t.red) return 'red';
  if (value >= t.orange) return 'orange';
  if (value >= t.yellow) return 'yellow';
  return 'green';
}

// 获取指标描述
function getIndicatorDescription(type, value, level) {
  const descriptions = {
    yield_deviation: {
      red: `收益偏差 ${value.toFixed(2)}%，严重偏离估值，存在重大定价错误风险`,
      orange: `收益偏差 ${value.toFixed(2)}%，显著偏离估值，需关注定价合理性`,
      yellow: `收益偏差 ${value.toFixed(2)}%，轻度偏离估值，建议持续监控`,
      green: `收益偏差 ${value.toFixed(2)}%，处于合理区间`
    },
    bid_concentration: {
      red: `投标集中度 ${value.toFixed(1)}%，前五大承销商占比过高，存在操纵风险`,
      orange: `投标集中度 ${value.toFixed(1)}%，集中度偏高，需关注承销商行为`,
      yellow: `投标集中度 ${value.toFixed(1)}%，集中度轻度偏高，建议关注`,
      green: `投标集中度 ${value.toFixed(1)}%，承销商分布均匀`
    },
    abnormal_quote: {
      red: `异常报价占比 ${value.toFixed(1)}%，大量报价偏离正常区间，存在异常交易嫌疑`,
      orange: `异常报价占比 ${value.toFixed(1)}%，部分报价偏离正常区间，需核查`,
      yellow: `异常报价占比 ${value.toFixed(1)}%，少量报价偏离，建议关注`,
      green: `异常报价占比 ${value.toFixed(1)}%，报价分布正常`
    },
    liquidity_stress: {
      red: `流动性紧张指数 ${value.toFixed(2)}，市场流动性严重不足，可能引发连锁反应`,
      orange: `流动性紧张指数 ${value.toFixed(2)}，流动性偏紧，需关注市场情绪`,
      yellow: `流动性紧张指数 ${value.toFixed(2)}，流动性轻度紧张，建议监控`,
      green: `流动性紧张指数 ${value.toFixed(2)}，市场流动性充裕`
    }
  };
  return descriptions[type][level] || descriptions[type].green;
}

// 计算所有风险指标
async function calculateAllIndicators(userId) {
  // 获取模拟数据
  const treasuryCurve = marketSimulator.generateYieldCurve('treasury');
  const policyCurve = marketSimulator.generateYieldCurve('policy');
  const macro = marketSimulator.generateMacroIndicators();
  const history = marketSimulator.generateHistory(30, 'treasury', '10Y');
  const biddingData = marketSimulator.generateBiddingData('SIM-001');

  // 计算四大指标
  const issueRate = 2.42; // 模拟发行利率
  const valuationRate = treasuryCurve['10Y']; // 使用 10Y 国债估值

  const yieldDeviation = calculateYieldDeviation(issueRate, valuationRate);
  const bidConcentration = calculateBidConcentration(biddingData.bids);
  const abnormalQuote = calculateAbnormalQuote(biddingData.bids);
  const liquidityStress = calculateLiquidityStress(history, [macro.turnover]);

  const indicators = [
    {
      type: 'yield_deviation',
      name: '收益偏差',
      value: parseFloat(yieldDeviation.toFixed(2)),
      unit: '%',
      level: getRiskLevel(yieldDeviation, 'yield_deviation'),
      threshold: THRESHOLDS.yield_deviation,
      description: getIndicatorDescription('yield_deviation', yieldDeviation, getRiskLevel(yieldDeviation, 'yield_deviation')),
      detail: { issue_rate: issueRate, valuation_rate: valuationRate }
    },
    {
      type: 'bid_concentration',
      name: '投标集中度',
      value: parseFloat(bidConcentration.toFixed(1)),
      unit: '%',
      level: getRiskLevel(bidConcentration, 'bid_concentration'),
      threshold: THRESHOLDS.bid_concentration,
      description: getIndicatorDescription('bid_concentration', bidConcentration, getRiskLevel(bidConcentration, 'bid_concentration')),
      detail: { total_bid_amount: biddingData.total_bid_amount, bid_count: biddingData.bid_count }
    },
    {
      type: 'abnormal_quote',
      name: '异常报价',
      value: parseFloat(abnormalQuote.toFixed(1)),
      unit: '%',
      level: getRiskLevel(abnormalQuote, 'abnormal_quote'),
      threshold: THRESHOLDS.abnormal_quote,
      description: getIndicatorDescription('abnormal_quote', abnormalQuote, getRiskLevel(abnormalQuote, 'abnormal_quote')),
      detail: { avg_bid_rate: biddingData.avg_bid_rate, total_bids: biddingData.bid_count }
    },
    {
      type: 'liquidity_stress',
      name: '流动性紧张',
      value: liquidityStress,
      unit: '',
      level: getRiskLevel(liquidityStress, 'liquidity_stress'),
      threshold: THRESHOLDS.liquidity_stress,
      description: getIndicatorDescription('liquidity_stress', liquidityStress, getRiskLevel(liquidityStress, 'liquidity_stress')),
      detail: { current_yield: treasuryCurve['10Y'], turnover: macro.turnover }
    }
  ];

  // 生成预警（仅黄色及以上）
  const alerts = [];
  for (const ind of indicators) {
    if (ind.level !== 'green') {
      alerts.push({
        user_id: userId,
        alert_type: ind.type,
        level: ind.level,
        title: `${ind.name}预警`,
        message: ind.description,
        metric_value: ind.value,
        threshold: ind.level === 'red' ? ind.threshold.red : ind.level === 'orange' ? ind.threshold.orange : ind.threshold.yellow
      });
    }
  }

  return {
    timestamp: new Date().toISOString(),
    market: {
      treasury_curve: treasuryCurve,
      policy_curve: policyCurve,
      macro: macro,
      history: history
    },
    indicators: indicators,
    alerts: alerts
  };
}

// 保存预警到数据库
async function saveAlerts(userId, alerts) {
  const saved = [];
  for (const alert of alerts) {
    const result = await db.createRiskAlert(alert);
    saved.push({ id: result.id, ...alert });
  }
  // 清理旧预警，保留最近 100 条
  await db.clearOldRiskAlerts(userId, 100);
  return saved;
}

module.exports = {
  calculateAllIndicators,
  saveAlerts,
  THRESHOLDS,
  getRiskLevel
};
