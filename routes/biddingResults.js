const express = require('express');
const multer = require('multer');
const db = require('../db');
const { extractText } = require('../services/fileParser');
const { callAI } = require('../services/aiService');

const router = express.Router();
const upload = multer({ dest: 'uploads/' });

// 中标结果结构化提取 prompt
const BIDDING_RESULT_SYSTEM_PROMPT = `你是一名债券发行领域的专家，擅长从债券发行结果公告中提取中标数据。
请从用户提供的发行结果公告文本中提取以下字段，并以 JSON 格式返回。如果某个字段无法识别，请返回 null。

字段说明：
- bond_code: 债券代码
- bond_name: 债券名称
- issuer: 发行人/发行机构
- bond_type: 债券类型，只能是：国债、地方债、政金债、信用债、专项债、一般债、再融资债
- issue_date: 发行日期，格式 yyyy-MM-dd
- total_issue_scale: 发行总额，单位亿元，数字
- total_bid_amount: 投标总额，单位亿元，数字
- winning_rate: 中标利率(%)
- marginal_rate: 边际中标利率(%)
- avg_rate: 平均中标利率(%)
- weighted_rate: 加权平均中标利率(%)
- members: 中标承销团成员数组，每项包含：
  - member_name: 成员名称
  - bid_amount: 投标金额，单位亿元
  - bid_rate: 投标利率(%)
  - winning_amount: 中标金额，单位亿元
  - category: 类别，如"银行类"、"券商类"、"其他"
- confidence: 提取置信度 0-1

必须返回合法 JSON，不要包含任何解释性文字。`;

// 生成 SQL
function generateInsertSQL(record, details) {
  const resultSQL = `INSERT INTO bidding_results
    (user_id, file_name, bond_code, bond_name, issuer, bond_type, issue_date,
     total_issue_scale, total_bid_amount, winning_rate, marginal_rate, avg_rate, weighted_rate, status, confidence)
  VALUES
    (${record.user_id}, '${record.file_name.replace(/'/g, "''")}', '${(record.bond_code || '').replace(/'/g, "''")}',
     '${(record.bond_name || '').replace(/'/g, "''")}', '${(record.issuer || '').replace(/'/g, "''")}',
     '${(record.bond_type || '').replace(/'/g, "''")}', '${record.issue_date || null}',
     ${record.total_issue_scale || 'NULL'}, ${record.total_bid_amount || 'NULL'},
     ${record.winning_rate || 'NULL'}, ${record.marginal_rate || 'NULL'},
     ${record.avg_rate || 'NULL'}, ${record.weighted_rate || 'NULL'},
     '${record.status || 'pending'}', ${record.confidence || 0.5});`;

  let detailsSQL = '';
  if (details && details.length) {
    detailsSQL = details.map(d => `INSERT INTO bidding_result_details
      (bidding_result_id, member_name, bid_amount, bid_rate, winning_amount, category)
    VALUES
      (@result_id, '${(d.member_name || '').replace(/'/g, "''")}', ${d.bid_amount || 'NULL'},
       ${d.bid_rate || 'NULL'}, ${d.winning_amount || 'NULL'}, '${(d.category || '').replace(/'/g, "''")}');`).join('\n');
  }

  return { resultSQL, detailsSQL, fullSQL: resultSQL + '\n' + detailsSQL };
}

// 单个文件提取
async function extractBiddingResult(file, userId) {
  const taskId = `BID-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const extractedText = await extractText(file.path, file.mimetype);

  await db.createUploadedFile({
    user_id: userId,
    task_type: 'bidding_result',
    task_id: taskId,
    file_name: file.originalname,
    file_path: file.path,
    file_size: file.size,
    mime_type: file.mimetype,
    extracted_text: extractedText
  });

  const result = await callAI(
    BIDDING_RESULT_SYSTEM_PROMPT,
    `请从以下债券发行结果公告中提取中标数据：\n\n${extractedText.slice(0, 12000)}`,
    { jsonMode: true, temperature: 0.2 }
  );

  const members = Array.isArray(result.members) ? result.members : [];
  const data = {
    user_id: userId,
    file_name: file.originalname,
    file_path: file.path,
    bond_code: result.bond_code || null,
    bond_name: result.bond_name || null,
    issuer: result.issuer || null,
    bond_type: result.bond_type || null,
    issue_date: result.issue_date || null,
    total_issue_scale: result.total_issue_scale ? parseFloat(result.total_issue_scale) : null,
    total_bid_amount: result.total_bid_amount ? parseFloat(result.total_bid_amount) : null,
    winning_rate: result.winning_rate ? parseFloat(result.winning_rate) : null,
    marginal_rate: result.marginal_rate ? parseFloat(result.marginal_rate) : null,
    avg_rate: result.avg_rate ? parseFloat(result.avg_rate) : null,
    weighted_rate: result.weighted_rate ? parseFloat(result.weighted_rate) : null,
    status: 'pending',
    confidence: result.confidence ? parseFloat(result.confidence) : 0.5,
    raw_extracted: result
  };

  if (!data.bond_name || !data.issue_date) {
    data.status = 'failed';
  }

  const record = await db.createBiddingResult(data);

  // 保存明细
  for (const member of members) {
    await db.createBiddingResultDetail(record.id, {
      member_name: member.member_name || null,
      bid_amount: member.bid_amount ? parseFloat(member.bid_amount) : null,
      bid_rate: member.bid_rate ? parseFloat(member.bid_rate) : null,
      winning_amount: member.winning_amount ? parseFloat(member.winning_amount) : null,
      category: member.category || null
    });
  }

  const sql = generateInsertSQL(data, members);

  return {
    file_name: file.originalname,
    status: data.status === 'failed' ? 'extract_failed' : 'extracted',
    extracted: {
      id: record.id,
      ...data,
      members
    },
    sql
  };
}

// POST /api/bidding-results/extract
router.post('/extract', upload.array('files', 10), async (req, res) => {
  try {
    const files = req.files || [];
    if (!files.length) return res.status(400).json({ code: 400, message: '缺少文件', data: null });

    const results = [];
    for (const file of files) {
      try {
        const result = await extractBiddingResult(file, req.userId);
        results.push(result);
      } catch (err) {
        console.error('Extract bidding result error:', err);
        results.push({ file_name: file.originalname, status: 'failed', error: err.message });
      }
    }

    res.json({
      code: 200,
      message: 'success',
      data: {
        total: files.length,
        success: results.filter(r => r.status === 'extracted').length,
        failed: results.filter(r => r.status !== 'extracted').length,
        results
      }
    });
  } catch (err) {
    console.error('Bidding result extract route error:', err);
    res.status(500).json({ code: 500, message: err.message, data: null });
  }
});

// GET /api/bidding-results
router.get('/', async (req, res) => {
  try {
    const { start_date, end_date, bond_type, page = 1, page_size = 20 } = req.query;
    const { total, rows } = await db.getBiddingResults(req.userId, {
      start_date,
      end_date,
      bond_type
    }, parseInt(page), parseInt(page_size));

    res.json({
      code: 200,
      message: 'success',
      data: { total, page: parseInt(page), page_size: parseInt(page_size), items: rows }
    });
  } catch (err) {
    console.error('Get bidding results error:', err);
    res.status(500).json({ code: 500, message: err.message, data: null });
  }
});

// GET /api/bidding-results/:id
router.get('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const item = await db.getBiddingResultById(id, req.userId);
    if (!item) return res.status(404).json({ code: 404, message: '记录不存在', data: null });
    const details = await db.getBiddingResultDetails(id);
    res.json({ code: 200, message: 'success', data: { ...item, details } });
  } catch (err) {
    console.error('Get bidding result error:', err);
    res.status(500).json({ code: 500, message: err.message, data: null });
  }
});

module.exports = router;
