// 沙盘推演引擎：利率冲击、信用事件、情绪波动情景模拟
const marketSimulator = require('./marketSimulator');
const { callAI } = require('./aiService');

// 预置情景定义
const PRESET_SCENARIOS = [
  {
    name: '利率平行上移 50bp',
    scenario_type: 'rate_shock',
    params: { shock_type: 'parallel', magnitude: 50, direction: 'up', duration_days: 30 },
    description: '假设货币政策收紧，各期限收益率平行上移 50 个基点',
    is_preset: true
  },
  {
    name: '利率平行下移 30bp',
    scenario_type: 'rate_shock',
    params: { shock_type: 'parallel', magnitude: 30, direction: 'down', duration_days: 30 },
    description: '假设货币政策宽松，各期限收益率平行下移 30 个基点',
    is_preset: true
  },
  {
    name: '收益率曲线陡峭化',
    scenario_type: 'rate_shock',
    params: { shock_type: 'steepening', short_end: -10, long_end: 30, duration_days: 30 },
    description: '短端利率下行、长端利率上行，曲线陡峭化',
    is_preset: true
  },
  {
    name: '收益率曲线平坦化',
    scenario_type: 'rate_shock',
    params: { shock_type: 'flattening', short_end: 20, long_end: -10, duration_days: 30 },
    description: '短端利率上行、长端利率下行，曲线平坦化',
    is_preset: true
  },
  {
    name: '城投信用事件冲击',
    scenario_type: 'credit_event',
    params: { sector: '城投', spread_widening: 80, contagion: 0.6, duration_days: 60 },
    description: '某城投平台发生信用事件，信用利差走阔 80bp，传染效应 60%',
    is_preset: true
  },
  {
    name: '地产信用风险蔓延',
    scenario_type: 'credit_event',
    params: { sector: '房地产', spread_widening: 120, contagion: 0.8, duration_days: 90 },
    description: '房地产行业信用风险蔓延，利差大幅走阔，传染效应强',
    is_preset: true
  },
  {
    name: '市场情绪极度悲观',
    scenario_type: 'sentiment',
    params: { sentiment_score: -0.8, risk_aversion: 0.9, flight_to_quality: true, duration_days: 20 },
    description: '市场情绪极度悲观，投资者风险偏好骤降，资金涌向利率债',
    is_preset: true
  },
  {
    name: '市场情绪乐观',
    scenario_type: 'sentiment',
    params: { sentiment_score: 0.7, risk_aversion: 0.2, flight_to_quality: false, duration_days: 20 },
    description: '市场情绪乐观，投资者风险偏好上升，信用债受追捧',
    is_preset: true
  }
];

// 应用利率冲击到收益率曲线
function applyRateShock(baselineCurve, params) {
  const shocked = { ...baselineCurve };
  const { shock_type, magnitude, direction, short_end, long_end } = params;

  if (shock_type === 'parallel') {
    const shift = (direction === 'up' ? 1 : -1) * magnitude / 100; // bp 转百分比
    Object.keys(shocked).forEach(term => {
      shocked[term] = parseFloat((shocked[term] + shift).toFixed(4));
    });
  } else if (shock_type === 'steepening') {
    // 短端下行、长端上行
    const shortShift = short_end / 100;
    const longShift = long_end / 100;
    const terms = Object.keys(shocked);
    terms.forEach((term, idx) => {
      const ratio = idx / (terms.length - 1); // 0 = 短端, 1 = 长端
      const shift = shortShift + (longShift - shortShift) * ratio;
      shocked[term] = parseFloat((shocked[term] + shift).toFixed(4));
    });
  } else if (shock_type === 'flattening') {
    // 短端上行、长端下行
    const shortShift = short_end / 100;
    const longShift = long_end / 100;
    const terms = Object.keys(shocked);
    terms.forEach((term, idx) => {
      const ratio = idx / (terms.length - 1);
      const shift = shortShift + (longShift - shortShift) * ratio;
      shocked[term] = parseFloat((shocked[term] + shift).toFixed(4));
    });
  }

  return shocked;
}

// 应用信用事件冲击
function applyCreditEvent(baselineCurve, params) {
  const shocked = { ...baselineCurve };
  const { spread_widening, contagion } = params;
  const spreadShift = spread_widening / 100;

  // 信用利差主要影响中长端
  const terms = Object.keys(shocked);
  terms.forEach((term, idx) => {
    const duration = [1, 3, 5, 7, 10, 30][idx];
    const durationFactor = Math.min(duration / 10, 1); // 久期越长影响越大
    const shift = spreadShift * durationFactor * (0.5 + contagion * 0.5);
    shocked[term] = parseFloat((shocked[term] + shift).toFixed(4));
  });

  return shocked;
}

// 应用情绪波动冲击
function applySentimentShock(baselineCurve, params) {
  const shocked = { ...baselineCurve };
  const { sentiment_score, risk_aversion, flight_to_quality } = params;

  // 避险情绪上升时，利率债收益率下行（价格上涨），信用债收益率上行
  if (flight_to_quality) {
    const terms = Object.keys(shocked);
    terms.forEach((term, idx) => {
      const duration = [1, 3, 5, 7, 10, 30][idx];
      // 利率债：避险买入，收益率下行，中长端更明显
      const rateShift = -risk_aversion * 0.3 * (duration / 10);
      shocked[term] = parseFloat((shocked[term] + rateShift).toFixed(4));
    });
  } else {
    // 乐观情绪：风险偏好上升，信用利差收窄
    const terms = Object.keys(shocked);
    terms.forEach((term, idx) => {
      const duration = [1, 3, 5, 7, 10, 30][idx];
      const spreadShift = -sentiment_score * 0.2 * (duration / 10);
      shocked[term] = parseFloat((shocked[term] + spreadShift).toFixed(4));
    });
  }

  return shocked;
}

// 生成风险传导路径
function generateRiskTransmission(scenarioType, params, baselineCurve, shockedCurve) {
  const transmissions = {
    rate_shock: [
      { step: 1, stage: '冲击源', description: `货币政策${params.direction === 'up' ? '收紧' : '宽松'}，${params.magnitude}bp ${params.shock_type === 'parallel' ? '平行' : params.shock_type}冲击` },
      { step: 2, stage: '市场反应', description: '债券价格全面下跌，估值收益率上移，持有机构浮亏扩大' },
      { step: 3, stage: '机构行为', description: '商业银行赎回压力增加，保险机构配置需求下降，交易盘止损抛售' },
      { step: 4, stage: '流动性传导', description: '买卖价差扩大，成交量萎缩，流动性溢价上升' },
      { step: 5, stage: '发行影响', description: '新债发行利率上移，认购倍数下降，发行难度加大' }
    ],
    credit_event: [
      { step: 1, stage: '冲击源', description: `${params.sector}领域发生信用事件，利差走阔 ${params.spread_widening}bp` },
      { step: 2, stage: '市场反应', description: '同类型债券遭遇抛售，信用利差全面走阔，风险偏好骤降' },
      { step: 3, stage: '机构行为', description: '投资者收紧信用风险敞口，要求更高风险溢价，部分机构暂停申购' },
      { step: 4, stage: '流动性传导', description: '信用债流动性枯竭，利率债与信用债走势分化，传染效应显现' },
      { step: 5, stage: '发行影响', description: '信用债发行利率大幅上移，弱资质主体融资困难，可能引发连锁违约' }
    ],
    sentiment: [
      { step: 1, stage: '冲击源', description: `市场情绪${params.sentiment_score > 0 ? '乐观' : '悲观'}，风险偏好${params.risk_aversion > 0.5 ? '骤降' : '上升'}` },
      { step: 2, stage: '市场反应', description: params.flight_to_quality ? '资金涌向利率债避险，信用债遭抛售' : '投资者追逐高收益资产，信用债受追捧' },
      { step: 3, stage: '机构行为', description: params.flight_to_quality ? '风险偏好骤降，机构降低杠杆、缩短久期' : '风险偏好上升，机构加杠杆、拉长久期' },
      { step: 4, stage: '流动性传导', description: '市场波动率上升，交易活跃度分化，部分券种流动性承压' },
      { step: 5, stage: '发行影响', description: params.flight_to_quality ? '利率债发行顺畅，信用债发行困难' : '信用债发行利率下行，认购倍数上升' }
    ]
  };

  return transmissions[scenarioType] || transmissions.rate_shock;
}

// 计算影响摘要
function calculateImpactSummary(baselineCurve, shockedCurve, scenarioType, params) {
  const terms = Object.keys(baselineCurve);
  const changes = {};
  terms.forEach(term => {
    changes[term] = parseFloat(((shockedCurve[term] - baselineCurve[term]) * 100).toFixed(2)); // bp
  });

  const avgChange = Object.values(changes).reduce((a, b) => a + b, 0) / terms.length;
  const maxChange = Math.max(...Object.values(changes));
  const minChange = Math.min(...Object.values(changes));

  // 估算发行利率变化（假设新发行 10Y）
  const issueRateChange = changes['10Y'] || avgChange;

  // 估算认购倍数变化（利率上行 → 认购倍数下降）
  let subscriptionChange = 0;
  if (scenarioType === 'rate_shock') {
    subscriptionChange = -issueRateChange / 10; // 每上行 10bp，认购倍数约下降 1
  } else if (scenarioType === 'credit_event') {
    subscriptionChange = -params.contagion * 3; // 信用事件传染效应越强，认购下降越多
  } else if (scenarioType === 'sentiment') {
    subscriptionChange = params.flight_to_quality ? -2 : 2;
  }

  // 估算风险指标变化
  const riskIndicators = {
    yield_deviation: parseFloat((Math.random() * 2 + Math.abs(avgChange) / 50).toFixed(2)),
    bid_concentration: parseFloat((45 + Math.random() * 20 + (scenarioType === 'credit_event' ? 10 : 0)).toFixed(1)),
    abnormal_quote: parseFloat((Math.random() * 8 + Math.abs(avgChange) / 20).toFixed(1)),
    liquidity_stress: parseFloat((0.3 + Math.abs(avgChange) / 100 + (scenarioType === 'credit_event' ? 0.2 : 0)).toFixed(2))
  };

  return {
    curve_changes: changes,
    avg_change_bp: parseFloat(avgChange.toFixed(2)),
    max_change_bp: maxChange,
    min_change_bp: minChange,
    issue_rate_change_bp: parseFloat(issueRateChange.toFixed(2)),
    subscription_multiple_change: parseFloat(subscriptionChange.toFixed(2)),
    risk_indicators: riskIndicators,
    severity: Math.abs(avgChange) > 30 ? 'high' : Math.abs(avgChange) > 15 ? 'medium' : 'low'
  };
}

// AI 生成推演报告
async function generateAiReport(scenarioName, scenarioType, params, baselineCurve, shockedCurve, transmission, impact) {
  const prompt = `你是一名债券市场风险管理专家，请根据以下沙盘推演数据生成一份专业、简洁的推演报告。

【情景名称】${scenarioName}
【情景类型】${scenarioType}
【参数】${JSON.stringify(params, null, 2)}

【基准收益率曲线】${JSON.stringify(baselineCurve, null, 2)}
【推演后收益率曲线】${JSON.stringify(shockedCurve, null, 2)}

【风险传导路径】
${transmission.map(t => `${t.step}. ${t.stage}: ${t.description}`).join('\n')}

【影响摘要】
- 平均变动: ${impact.avg_change_bp}bp
- 最大变动: ${impact.max_change_bp}bp
- 发行利率变化: ${impact.issue_rate_change_bp}bp
- 认购倍数变化: ${impact.subscription_multiple_change}
- 风险等级: ${impact.severity}

请从以下角度撰写报告（300-500字）：
1. 情景概述与核心假设
2. 市场影响分析（收益率、流动性、投资者行为）
3. 风险传导路径解读
4. 对发行人与监管机构的建议
5. 结论

要求：专业、客观、有数据支撑，避免过于技术化的术语，适合向管理层汇报。`;

  try {
    const report = await callAI(
      '你是一名债券市场风险管理专家，擅长将复杂的金融模型结果转化为清晰的管理层报告。',
      prompt,
      { temperature: 0.4, maxTokens: 1500 }
    );
    return report;
  } catch (err) {
    console.error('[SandboxEngine] AI report error:', err);
    return `【推演报告】\n\n情景：${scenarioName}\n\n本情景模拟了${scenarioType === 'rate_shock' ? '利率冲击' : scenarioType === 'credit_event' ? '信用事件' : '市场情绪波动'}对债券市场的影响。推演结果显示，收益率曲线平均变动 ${impact.avg_change_bp}bp，其中 10Y 期变动 ${impact.issue_rate_change_bp}bp。\n\n风险传导路径表明，冲击将依次影响市场定价、机构行为、流动性和最终发行结果。预计新债发行利率将${impact.issue_rate_change_bp > 0 ? '上移' : '下移'} ${Math.abs(impact.issue_rate_change_bp)}bp，认购倍数预计${impact.subscription_multiple_change > 0 ? '上升' : '下降'} ${Math.abs(impact.subscription_multiple_change)}。\n\n建议发行人密切关注市场变化，合理选择发行窗口；建议监管机构加强流动性监测，防范系统性风险。`;
  }
}

// 运行沙盘推演
async function runSandbox(userId, scenarioType, params, scenarioName = null) {
  // 获取基准曲线
  const baselineCurve = marketSimulator.generateYieldCurve('treasury');

  // 应用冲击
  let shockedCurve;
  if (scenarioType === 'rate_shock') {
    shockedCurve = applyRateShock(baselineCurve, params);
  } else if (scenarioType === 'credit_event') {
    shockedCurve = applyCreditEvent(baselineCurve, params);
  } else if (scenarioType === 'sentiment') {
    shockedCurve = applySentimentShock(baselineCurve, params);
  } else {
    throw new Error(`未知情景类型: ${scenarioType}`);
  }

  // 生成风险传导路径
  const transmission = generateRiskTransmission(scenarioType, params, baselineCurve, shockedCurve);

  // 计算影响摘要
  const impact = calculateImpactSummary(baselineCurve, shockedCurve, scenarioType, params);

  // 生成 AI 报告
  const aiReport = await generateAiReport(
    scenarioName || `${scenarioType} 自定义情景`,
    scenarioType,
    params,
    baselineCurve,
    shockedCurve,
    transmission,
    impact
  );

  return {
    scenario_name: scenarioName || `${scenarioType} 自定义情景`,
    scenario_type: scenarioType,
    params: params,
    baseline_curve: baselineCurve,
    shocked_curve: shockedCurve,
    risk_transmission: transmission,
    impact_summary: impact,
    ai_report: aiReport,
    created_at: new Date().toISOString()
  };
}

module.exports = {
  runSandbox,
  PRESET_SCENARIOS,
  applyRateShock,
  applyCreditEvent,
  applySentimentShock
};
