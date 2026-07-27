// 模拟行情生成器：基于时间种子生成伪随机但合理的债券市场行情
// 使用均值回归 + 随机游走模型，确保数据符合债券市场常识

const BASE_YIELDS = {
  treasury: { '1Y': 1.65, '3Y': 1.85, '5Y': 2.05, '7Y': 2.20, '10Y': 2.35, '30Y': 2.65 },
  policy: { '1Y': 1.75, '3Y': 1.95, '5Y': 2.15, '7Y': 2.30, '10Y': 2.45, '30Y': 2.75 },
  local: { '1Y': 1.80, '3Y': 2.00, '5Y': 2.20, '7Y': 2.35, '10Y': 2.50, '30Y': 2.80 }
};

const MACRO_BASE = {
  custody: 128.5,        // 托管量（万亿）
  investors: 42186,      // 投资者数量（户）
  turnover: 4850,        // 日成交额（亿）
  repo_rate: 1.85        // 回购利率 DR007
};

// 基于时间种子的伪随机数生成器（保证同一分钟内数据一致）
function seededRandom(seed) {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

// 生成正态分布随机数（Box-Muller）
function normalRandom(seed) {
  const u1 = seededRandom(seed);
  const u2 = seededRandom(seed + 1);
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

// 均值回归随机游走
function meanRevertingWalk(base, seed, volatility = 0.02, meanReversion = 0.1) {
  const shock = normalRandom(seed) * volatility;
  const deviation = (seededRandom(seed + 2) - 0.5) * 0.1;
  return base * (1 + shock - meanReversion * deviation);
}

// 生成收益率曲线
function generateYieldCurve(bondType = 'treasury') {
  const now = new Date();
  const seed = now.getHours() * 60 + now.getMinutes();
  const base = BASE_YIELDS[bondType] || BASE_YIELDS.treasury;
  const curve = {};
  const terms = ['1Y', '3Y', '5Y', '7Y', '10Y', '30Y'];

  terms.forEach((term, idx) => {
    curve[term] = parseFloat(meanRevertingWalk(base[term], seed + idx * 7, 0.015, 0.08).toFixed(4));
  });

  // 确保曲线基本单调递增（允许轻微倒挂）
  const sorted = terms.map(t => curve[t]);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] < sorted[i - 1] - 0.15) {
      curve[terms[i]] = parseFloat((sorted[i - 1] - 0.05).toFixed(4));
    }
  }

  return curve;
}

// 生成宏观指标
function generateMacroIndicators() {
  const now = new Date();
  const seed = now.getHours() * 60 + now.getMinutes();
  return {
    custody: parseFloat(meanRevertingWalk(MACRO_BASE.custody, seed + 100, 0.005, 0.02).toFixed(2)),
    investors: Math.floor(meanRevertingWalk(MACRO_BASE.investors, seed + 200, 0.003, 0.01)),
    turnover: parseFloat(meanRevertingWalk(MACRO_BASE.turnover, seed + 300, 0.03, 0.05).toFixed(0)),
    repo_rate: parseFloat(meanRevertingWalk(MACRO_BASE.repo_rate, seed + 400, 0.02, 0.05).toFixed(4)),
    timestamp: now.toISOString()
  };
}

// 生成历史行情序列（用于图表展示）
function generateHistory(days = 30, bondType = 'treasury', term = '10Y') {
  const base = BASE_YIELDS[bondType]?.[term] || 2.35;
  const history = [];
  const now = new Date();

  for (let i = days; i >= 0; i--) {
    const date = new Date(now);
    date.setDate(date.getDate() - i);
    const seed = date.getDate() + date.getMonth() * 31 + i * 13;
    history.push({
      date: date.toISOString().split('T')[0],
      value: parseFloat(meanRevertingWalk(base, seed, 0.02, 0.05).toFixed(4))
    });
  }
  return history;
}

// 生成当日发行日历（模拟）
function generateIssueCalendar() {
  const now = new Date();
  const seed = now.getDate() + now.getMonth() * 31;
  const issuers = ['财政部', '国家开发银行', '农业发展银行', '进出口银行', '北京市政府', '江苏省政府'];
  const types = ['国债', '政策性金融债', '地方政府债'];
  const count = 2 + Math.floor(seededRandom(seed) * 4);

  const calendar = [];
  for (let i = 0; i < count; i++) {
    const s = seed + i * 17;
    calendar.push({
      bond_name: `${issuers[Math.floor(seededRandom(s) * issuers.length)]}${2024 + Math.floor(seededRandom(s + 1) * 2)}年${types[Math.floor(seededRandom(s + 2) * types.length)]}(${Math.floor(seededRandom(s + 3) * 20) + 1}期)`,
      issuer: issuers[Math.floor(seededRandom(s + 4) * issuers.length)],
      bond_type: types[Math.floor(seededRandom(s + 5) * types.length)],
      issue_scale: parseFloat((10 + seededRandom(s + 6) * 90).toFixed(1)),
      term: ['1Y', '3Y', '5Y', '7Y', '10Y', '30Y'][Math.floor(seededRandom(s + 7) * 6)],
      bidding_time: `${9 + Math.floor(seededRandom(s + 8) * 3)}:${['00', '30'][Math.floor(seededRandom(s + 9) * 2)]}`,
      status: seededRandom(s + 10) > 0.5 ? 'pending' : 'completed'
    });
  }
  return calendar;
}

// 生成投标数据（用于计算风险指标）
function generateBiddingData(bondCode) {
  const now = new Date();
  const seed = now.getHours() * 60 + now.getMinutes() + bondCode.length;
  const underwriters = [
    '工商银行', '建设银行', '农业银行', '中国银行', '交通银行',
    '招商银行', '浦发银行', '中信银行', '民生银行', '兴业银行',
    '中信证券', '中金公司', '国泰君安', '华泰证券', '招商证券'
  ];

  const bidCount = 15 + Math.floor(seededRandom(seed) * 20);
  const avgRate = 2.3 + seededRandom(seed + 1) * 0.4;
  const bids = [];

  for (let i = 0; i < bidCount; i++) {
    const s = seed + i * 11;
    bids.push({
      member_name: underwriters[Math.floor(seededRandom(s) * underwriters.length)],
      bid_amount: parseFloat((1 + seededRandom(s + 1) * 20).toFixed(2)),
      bid_rate: parseFloat((avgRate + (seededRandom(s + 2) - 0.5) * 0.3).toFixed(4))
    });
  }

  return {
    bond_code: bondCode,
    total_bid_amount: parseFloat(bids.reduce((sum, b) => sum + b.bid_amount, 0).toFixed(2)),
    avg_bid_rate: parseFloat((bids.reduce((sum, b) => sum + b.bid_rate, 0) / bids.length).toFixed(4)),
    bid_count: bids.length,
    bids: bids
  };
}

module.exports = {
  generateYieldCurve,
  generateMacroIndicators,
  generateHistory,
  generateIssueCalendar,
  generateBiddingData,
  BASE_YIELDS
};
