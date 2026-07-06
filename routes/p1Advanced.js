const express = require('express');
const multer = require('multer');
const db = require('../db');
const { extractText } = require('../services/fileParser');
const { callAI } = require('../services/aiService');

const router = express.Router();
const upload = multer({ dest: 'uploads/' });

// 通用异步任务处理器
async function runAiTask(taskType, userId, inputData, processor) {
  const taskId = `${taskType.toUpperCase()}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  await db.createAiTask({
    task_id: taskId,
    user_id: userId,
    task_type: taskType,
    status: 'processing',
    progress: 10
  });

  // 异步执行
  processor(taskId, userId, inputData).catch(err => {
    console.error(`[${taskType}] task error:`, err);
    db.updateAiTask(taskId, userId, {
      status: 'failed',
      error_message: err.message,
      completed_at: new Date().toISOString()
    });
  });

  return { task_id: taskId, status: 'processing', estimated_seconds: 15 };
}

// ==================== P1-2 定期报告生成 ====================
const REPORT_SYSTEM_PROMPT = `你是一名债券发行领域的资深分析师，擅长根据结构化数据生成专业的发行分析报告。
请根据用户提供的数据生成一份结构清晰、专业严谨的债券发行分析报告，以 Markdown 格式返回。
报告必须包含：
1. 报告摘要
2. 发行概况（规模、期限、类型分布）
3. 利率分析（中标利率区间、与基准比较）
4. 承销团分析（成员分布、中标集中度）
5. 风险提示与建议

注意：
- 所有数据必须基于用户提供的输入，不要编造。
- 如果数据不足，在相应位置说明"数据待补充"。
- 报告末尾必须标注："本报告由 AI 辅助生成，仅供参考，最终以人工审核为准。"`;

router.post('/reports/generate', async (req, res) => {
  try {
    const { report_type = 'weekly', start_date, end_date, data_scope = 'all' } = req.body || {};
    const task = await runAiTask('report', req.userId, { report_type, start_date, end_date, data_scope }, async (taskId, userId, input) => {
      // 拉取相关数据
      const announcements = await db.getAnnouncements(userId, {
        start_date: input.start_date,
        end_date: input.end_date
      }, 1, 200);
      const biddingResults = await db.getBiddingResults(userId, {
        start_date: input.start_date,
        end_date: input.end_date
      }, 1, 200);

      await db.updateAiTask(taskId, userId, { progress: 50 });

      const promptData = {
        report_type: input.report_type,
        start_date: input.start_date,
        end_date: input.end_date,
        announcement_count: announcements.total,
        announcements: announcements.rows,
        bidding_result_count: biddingResults.total,
        bidding_results: biddingResults.rows
      };

      const reportContent = await callAI(
        REPORT_SYSTEM_PROMPT,
        `请根据以下数据生成${input.report_type === 'daily' ? '日报' : input.report_type === 'weekly' ? '周报' : '月报'}：\n\n${JSON.stringify(promptData, null, 2).slice(0, 12000)}`,
        { temperature: 0.3, maxTokens: 4096 }
      );

      await db.updateAiTask(taskId, userId, {
        status: 'completed',
        progress: 100,
        result: {
          report_type: input.report_type,
          title: `债券发行${input.report_type === 'daily' ? '日报' : input.report_type === 'weekly' ? '周报' : '月报'} (${input.start_date || ''} ~ ${input.end_date || ''})`,
          content: reportContent,
          summary: `共 ${announcements.total} 条公告，${biddingResults.total} 条中标结果`,
          generated_at: new Date().toISOString()
        },
        completed_at: new Date().toISOString()
      });
    });

    res.json({ code: 200, message: 'success', data: task });
  } catch (err) {
    console.error('Generate report error:', err);
    res.status(500).json({ code: 500, message: err.message, data: null });
  }
});

// ==================== P1-3 边际中标利率预测 ====================
const RATE_PREDICTION_SYSTEM_PROMPT = `你是一名债券发行定价专家，擅长根据债券特征、市场环境和历史中标数据预测边际中标利率。
请根据用户提供的信息，预测该债券的边际中标利率，并以 JSON 格式返回。

返回字段：
- predicted_marginal_rate: 预测的边际中标利率（%）
- confidence: 预测置信度 0-1
- rate_range_low: 预测区间下限（%）
- rate_range_high: 预测区间上限（%）
- key_factors: 关键影响因素，字符串数组
- reasoning: 推理过程简述
- disclaimer: 固定返回 "本预测由 AI 辅助生成，仅供参考，不构成投资建议。"

必须返回合法 JSON，不要包含任何解释性文字。`;

router.post('/rate-prediction/predict', async (req, res) => {
  try {
    const {
      bond_type, region, term, issue_scale, issue_date,
      benchmark_rate, market_spread, historical_rates
    } = req.body || {};

    const task = await runAiTask('rate_prediction', req.userId, {
      bond_type, region, term, issue_scale, issue_date,
      benchmark_rate, market_spread, historical_rates
    }, async (taskId, userId, input) => {
      await db.updateAiTask(taskId, userId, { progress: 50 });

      // 拉取历史中标数据作为参考
      const history = await db.getBiddingResults(userId, { bond_type: input.bond_type }, 1, 50);

      const promptData = {
        target_bond: input,
        historical_similar_bonds: history.rows.slice(0, 20)
      };

      const prediction = await callAI(
        RATE_PREDICTION_SYSTEM_PROMPT,
        `请预测以下债券的边际中标利率：\n\n${JSON.stringify(promptData, null, 2).slice(0, 12000)}`,
        { jsonMode: true, temperature: 0.3 }
      );

      await db.updateAiTask(taskId, userId, {
        status: 'completed',
        progress: 100,
        result: {
          ...prediction,
          predicted_marginal_rate: prediction.predicted_marginal_rate ? parseFloat(prediction.predicted_marginal_rate) : null,
          rate_range_low: prediction.rate_range_low ? parseFloat(prediction.rate_range_low) : null,
          rate_range_high: prediction.rate_range_high ? parseFloat(prediction.rate_range_high) : null,
          confidence: prediction.confidence ? parseFloat(prediction.confidence) : 0.5,
          generated_at: new Date().toISOString()
        },
        completed_at: new Date().toISOString()
      });
    });

    res.json({ code: 200, message: 'success', data: task });
  } catch (err) {
    console.error('Rate prediction error:', err);
    res.status(500).json({ code: 500, message: err.message, data: null });
  }
});

// ==================== P1-4 舆情与条款监控 ====================
const MONITORING_SYSTEM_PROMPT = `你是一名债券发行风险监控专家，擅长从舆情文章、政策文件、监管通知中提取关键条款和风险信号。
请从用户提供的文本中提取以下信息，并以 JSON 格式返回：

- monitored_keywords: 监控关键词列表
- key_clauses: 关键条款数组，每项包含 title（条款标题）、content（条款内容）、risk_level（high/medium/low）
- risk_events: 风险事件数组，每项包含 event（事件描述）、impact（影响分析）、suggestion（应对建议）
- sentiment: 整体情感倾向，只能是：正面、中性、负面
- summary: 文本摘要
- confidence: 提取置信度 0-1

必须返回合法 JSON，不要包含任何解释性文字。`;

router.post('/monitoring/analyze', upload.array('files', 5), async (req, res) => {
  try {
    const { task_name, keywords, content } = req.body || {};
    const files = req.files || [];

    let extractedText = content || '';
    for (const file of files) {
      const text = await extractText(file.path, file.mimetype);
      extractedText += '\n\n' + text;
    }

    if (!extractedText.trim()) {
      return res.status(400).json({ code: 400, message: '缺少分析内容', data: null });
    }

    const task = await runAiTask('monitoring', req.userId, {
      task_name, keywords, extractedText
    }, async (taskId, userId, input) => {
      await db.updateAiTask(taskId, userId, { progress: 50 });

      const result = await callAI(
        MONITORING_SYSTEM_PROMPT,
        `请分析以下舆情/政策文本，监控关键词：${input.keywords || '无'}\n\n${input.extractedText.slice(0, 12000)}`,
        { jsonMode: true, temperature: 0.3 }
      );

      await db.updateAiTask(taskId, userId, {
        status: 'completed',
        progress: 100,
        result: {
          task_name: input.task_name || '舆情条款监控',
          keywords: input.keywords,
          ...result,
          confidence: result.confidence ? parseFloat(result.confidence) : 0.5,
          analyzed_at: new Date().toISOString()
        },
        completed_at: new Date().toISOString()
      });
    });

    res.json({ code: 200, message: 'success', data: task });
  } catch (err) {
    console.error('Monitoring analyze error:', err);
    res.status(500).json({ code: 500, message: err.message, data: null });
  }
});

// 通用任务查询
router.get('/tasks/:task_id', async (req, res) => {
  try {
    const task = await db.getAiTask(req.params.task_id, req.userId);
    if (!task) return res.status(404).json({ code: 404, message: '任务不存在', data: null });
    res.json({ code: 200, message: 'success', data: task });
  } catch (err) {
    console.error('Get task error:', err);
    res.status(500).json({ code: 500, message: err.message, data: null });
  }
});

module.exports = router;
