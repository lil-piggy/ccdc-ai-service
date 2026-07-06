const express = require('express');
const multer = require('multer');
const db = require('../db');
const { extractText } = require('../services/fileParser');
const { callAI } = require('../services/aiService');

const router = express.Router();
const upload = multer({ dest: 'uploads/' });

// 文档类型到中文说明的映射
const DOC_TYPE_LABELS = {
  announcement: '招标公告',
  issuance_plan: '发行计划表',
  issuance_result: '发行结果公告',
  interest_payment: '付息兑付公告',
  other: '其他债券文档'
};

// 通用债券文档结构化提取 prompt
const ANNOUNCEMENT_SYSTEM_PROMPT = `你是一名债券发行领域的专家，擅长从各类债券发行相关文档中提取结构化信息。

请先从文本判断文档类型，然后从文档中提取所有可识别的字段，并以 JSON 格式返回。如果某个字段无法识别，请返回 null。

文档类型（doc_type）：announcement（招标公告）、issuance_plan（发行计划表）、issuance_result（发行结果公告）、interest_payment（付息兑付公告）、other（其他）

通用字段：
- doc_type: 文档类型，从上面枚举中选择
- region: 地区/省份（如"黑龙江省"）
- bond_code: 债券代码
- bond_name: 债券名称
- issuer: 发行人/承销机构
- bond_type: 债券类型，只能是：国债、地方债、政金债、信用债、专项债、一般债
- issue_date: 发行/招标日期，格式 yyyy-MM-dd
- issue_scale: 发行规模，单位亿元，数字
- term: 期限，如"7Y"、"10年"
- bidding_method: 招标方式，只能是：荷兰式、美国式、混合式
- benchmark_rate: 基准利率(%)
- basic_spread: 基本利差(BP)
- is_reissue: 是否续发，true/false
- lead_underwriter: 主承销商
- underwriters: 承销团成员，字符串数组
- payment_date: 兑付/付息日期，格式 yyyy-MM-dd
- coupon_rate: 票面利率(%)
- total_plan_scale: 计划发行总额（亿元），发行计划表专用
- plan_period: 计划期间，如"2026年三季度"
- project_list: 项目清单（地方债计划表），每项包含 project_name、scale、term、purpose
- confidence: 提取置信度 0-1

针对发行计划表，重点提取：
- region、plan_period、total_plan_scale
- 表格中的债券明细列表 bonds（数组），每项包含 bond_name、bond_type、issue_date、issue_scale、term、purpose

必须返回合法 JSON，不要包含任何解释性文字。`;

// 单个文件提取
async function extractAnnouncement(file, userId, docType) {
  const taskId = `ANN-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const extractedText = await extractText(file.path, file.mimetype);

  await db.createUploadedFile({
    user_id: userId,
    task_type: 'announcement',
    task_id: taskId,
    file_name: file.originalname,
    file_path: file.path,
    file_size: file.size,
    mime_type: file.mimetype,
    extracted_text: extractedText
  });

  const result = await callAI(
    ANNOUNCEMENT_SYSTEM_PROMPT,
    `请从以下债券文档中提取结构化信息：\n\n${extractedText.slice(0, 12000)}`,
    { jsonMode: true, temperature: 0.2 }
  );

  const data = {
    user_id: userId,
    file_name: file.originalname,
    file_path: file.path,
    source: 'manual',
    doc_type: result.doc_type || docType || 'other',
    bond_code: result.bond_code || null,
    bond_name: result.bond_name || null,
    issuer: result.issuer || null,
    bond_type: result.bond_type || null,
    issue_date: result.issue_date || null,
    issue_scale: result.issue_scale ? parseFloat(result.issue_scale) : null,
    term: result.term || null,
    bidding_method: result.bidding_method || null,
    benchmark_rate: result.benchmark_rate ? parseFloat(result.benchmark_rate) : null,
    basic_spread: result.basic_spread ? parseFloat(result.basic_spread) : null,
    is_reissue: result.is_reissue === true || result.is_reissue === 'true',
    lead_underwriter: result.lead_underwriter || null,
    underwriters: Array.isArray(result.underwriters) ? result.underwriters.join(',') : (result.underwriters || null),
    raw_extracted: result,
    status: 'pending',
    confidence: result.confidence ? parseFloat(result.confidence) : 0.5
  };

  // 关键字段缺失时降低状态
  if (!data.bond_name && !data.plan_period && !data.total_plan_scale) {
    data.status = 'failed';
  }

  const record = await db.createAnnouncement(data);
  return {
    file_name: file.originalname,
    status: data.status === 'failed' ? 'extract_failed' : 'extracted',
    extracted: {
      id: record.id,
      ...data,
      underwriters: data.underwriters ? data.underwriters.split(',') : [],
      doc_type_label: DOC_TYPE_LABELS[data.doc_type] || data.doc_type
    }
  };
}

// POST /api/announcement/extract
router.post('/extract', upload.array('files', 10), async (req, res) => {
  try {
    const files = req.files || [];
    if (!files.length) return res.status(400).json({ code: 400, message: '缺少文件', data: null });

    const docType = req.body.doc_type || 'announcement';
    const results = [];

    for (const file of files) {
      try {
        const result = await extractAnnouncement(file, req.userId, docType);
        results.push(result);
      } catch (err) {
        console.error('Extract announcement error:', err);
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
    console.error('Announcement extract route error:', err);
    res.status(500).json({ code: 500, message: err.message, data: null });
  }
});

// GET /api/announcement/calendar
router.get('/calendar', async (req, res) => {
  try {
    const { start_date, end_date, bond_type, status, page = 1, page_size = 20 } = req.query;
    const { total, rows } = await db.getAnnouncements(req.userId, {
      start_date,
      end_date,
      bond_type,
      status
    }, parseInt(page), parseInt(page_size));

    res.json({
      code: 200,
      message: 'success',
      data: {
        total,
        page: parseInt(page),
        page_size: parseInt(page_size),
        items: rows.map(r => ({
          ...r,
          underwriters: r.underwriters ? r.underwriters.split(',') : [],
          raw_extracted: r.raw_extracted,
          doc_type_label: DOC_TYPE_LABELS[r.doc_type] || r.doc_type
        }))
      }
    });
  } catch (err) {
    console.error('Announcement calendar error:', err);
    res.status(500).json({ code: 500, message: err.message, data: null });
  }
});

// GET /api/announcement/:id
router.get('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const item = await db.getAnnouncementById(id, req.userId);
    if (!item) return res.status(404).json({ code: 404, message: '公告不存在', data: null });
    res.json({
      code: 200,
      message: 'success',
      data: {
        ...item,
        underwriters: item.underwriters ? item.underwriters.split(',') : [],
        raw_extracted: item.raw_extracted,
        doc_type_label: DOC_TYPE_LABELS[item.doc_type] || item.doc_type
      }
    });
  } catch (err) {
    console.error('Get announcement error:', err);
    res.status(500).json({ code: 500, message: err.message, data: null });
  }
});

// PUT /api/announcement/:id
router.put('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const existing = await db.getAnnouncementById(id, req.userId);
    if (!existing) return res.status(404).json({ code: 404, message: '公告不存在', data: null });

    await db.updateAnnouncement(id, req.userId, req.body);
    res.json({ code: 200, message: 'success', data: { id } });
  } catch (err) {
    console.error('Update announcement error:', err);
    res.status(500).json({ code: 500, message: err.message, data: null });
  }
});

module.exports = router;
