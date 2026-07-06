const express = require('express');
const db = require('../db');
const { callAI } = require('../services/aiService');

const router = express.Router();

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

// ==================== P2-1 企业发债缺口预测 ====================
const FUNDING_GAP_PROMPT = `你是一名企业融资规划专家，擅长根据企业财务数据和债务结构预测未来发债缺口。
请根据用户提供的企业信息，预测未来 1-3 年的发债融资缺口，并以 JSON 格式返回：

- company_name: 企业名称
- total_debt_due_1y: 1年内到期债务（亿元）
- total_debt_due_2y: 2年内到期债务（亿元）
- total_debt_due_3y: 3年内到期债务（亿元）
- projected_funding_gap_1y: 1年发债缺口（亿元）
- projected_funding_gap_2y: 2年发债缺口（亿元）
- projected_funding_gap_3y: 3年发债缺口（亿元）
- recommended_bond_types: 推荐发债品种，字符串数组
- key_risks: 关键风险点，字符串数组
- reasoning: 推理过程
- disclaimer: 固定返回 "本预测由 AI 辅助生成，仅供参考，不构成投资建议。"

必须返回合法 JSON，不要包含任何解释性文字。`;

router.post('/funding-gap/predict', async (req, res) => {
  try {
    const { company_name, total_assets, total_liabilities, annual_revenue, net_profit,
            existing_bonds, bank_loans, credit_rating, industry } = req.body || {};

    const task = await runAiTask('funding_gap', req.userId, req.body, async (taskId, userId, input) => {
      await db.updateAiTask(taskId, userId, { progress: 50 });

      const result = await callAI(
        FUNDING_GAP_PROMPT,
        `请预测以下企业的发债缺口：\n\n${JSON.stringify(input, null, 2).slice(0, 12000)}`,
        { jsonMode: true, temperature: 0.3 }
      );

      await db.updateAiTask(taskId, userId, {
        status: 'completed',
        progress: 100,
        result: {
          ...result,
          company_name: input.company_name || result.company_name,
          generated_at: new Date().toISOString()
        },
        completed_at: new Date().toISOString()
      });
    });

    res.json({ code: 200, message: 'success', data: task });
  } catch (err) {
    console.error('Funding gap prediction error:', err);
    res.status(500).json({ code: 500, message: err.message, data: null });
  }
});

// ==================== P2-2 智能投标阶梯生成 ====================
const BID_LADDER_PROMPT = `你是一名债券投标策略专家，擅长根据债券特征、市场利率和竞争对手行为设计投标利率阶梯。
请根据用户提供的债券信息，生成推荐的投标利率阶梯方案，并以 JSON 格式返回：

- recommended_ladder: 投标阶梯数组，每项包含：
  - tier: 档位序号
  - bid_rate: 投标利率（%）
  - bid_amount: 建议投标金额（亿元）
  - probability: 预计中标概率
  - rationale: 该档位理由
- optimal_rate: 最优投标利率（%）
- optimal_amount: 最优投标金额（亿元）
- risk_warning: 风险提示
- disclaimer: 固定返回 "本方案由 AI 辅助生成，仅供参考，不构成投资建议。"

必须返回合法 JSON，不要包含任何解释性文字。`;

router.post('/bid-ladder/generate', async (req, res) => {
  try {
    const { bond_type, bond_name, issue_scale, term, benchmark_rate, market_marginal_rate,
            competitive_intensity, our_quota } = req.body || {};

    const task = await runAiTask('bid_ladder', req.userId, req.body, async (taskId, userId, input) => {
      await db.updateAiTask(taskId, userId, { progress: 50 });

      // 拉取历史中标数据参考
      const history = await db.getBiddingResults(userId, { bond_type: input.bond_type }, 1, 30);

      const result = await callAI(
        BID_LADDER_PROMPT,
        `请为以下债券生成投标阶梯方案。历史参考数据：${JSON.stringify(history.rows.slice(0, 10))}\n\n目标债券：${JSON.stringify(input, null, 2).slice(0, 8000)}`,
        { jsonMode: true, temperature: 0.3 }
      );

      await db.updateAiTask(taskId, userId, {
        status: 'completed',
        progress: 100,
        result: {
          ...result,
          generated_at: new Date().toISOString()
        },
        completed_at: new Date().toISOString()
      });
    });

    res.json({ code: 200, message: 'success', data: task });
  } catch (err) {
    console.error('Bid ladder generation error:', err);
    res.status(500).json({ code: 500, message: err.message, data: null });
  }
});

// ==================== P2-3 投标 Alpha 自动回溯 ====================
const ALPHA_BACKTEST_PROMPT = `你是一名债券投资绩效分析专家，擅长根据历史投标记录进行收益归因和策略回溯。
请根据用户提供的历史投标记录，进行 Alpha 回溯分析，并以 JSON 格式返回：

- total_invested: 累计投资金额（亿元）
- total_return: 累计收益（亿元）
- annualized_return: 年化收益率（%）
- win_rate: 中标胜率（%）
- avg_bid_rate: 平均投标利率（%）
- avg_winning_rate: 平均中标利率（%）
- alpha_vs_benchmark: 相对基准的超额收益（%）
- key_insights: 关键洞察，字符串数组
- improvement_suggestions: 改进建议，字符串数组
- disclaimer: 固定返回 "本分析由 AI 辅助生成，仅供参考，不构成投资建议。"

必须返回合法 JSON，不要包含任何解释性文字。`;

router.post('/alpha-backtest/run', async (req, res) => {
  try {
    const { strategy_name, records } = req.body || {};
    if (!Array.isArray(records) || !records.length) {
      return res.status(400).json({ code: 400, message: '缺少历史投标记录', data: null });
    }

    const task = await runAiTask('alpha_backtest', req.userId, req.body, async (taskId, userId, input) => {
      await db.updateAiTask(taskId, userId, { progress: 50 });

      const result = await callAI(
        ALPHA_BACKTEST_PROMPT,
        `请对以下投标策略进行 Alpha 回溯分析：\n\n策略名称：${input.strategy_name || '未命名'}\n\n历史记录：\n${JSON.stringify(input.records, null, 2).slice(0, 12000)}`,
        { jsonMode: true, temperature: 0.3 }
      );

      await db.updateAiTask(taskId, userId, {
        status: 'completed',
        progress: 100,
        result: {
          ...result,
          strategy_name: input.strategy_name,
          record_count: input.records.length,
          generated_at: new Date().toISOString()
        },
        completed_at: new Date().toISOString()
      });
    });

    res.json({ code: 200, message: 'success', data: task });
  } catch (err) {
    console.error('Alpha backtest error:', err);
    res.status(500).json({ code: 500, message: err.message, data: null });
  }
});

// ==================== P2-4 不同券种专属 Agent 模式 ====================
const BOND_AGENT_PROMPT = `你是一名债券发行领域的专属 AI Agent，精通各类债券的发行规则、市场特点和操作实务。
请根据用户选择的券种，以该券种专家的身份回答用户问题或分析用户提供的材料。

当前券种：{bondType}

要求：
1. 使用专业术语，体现该券种的特殊性
2. 结合监管政策、市场惯例进行分析
3. 如果用户提供材料，先提取关键信息再回答
4. 结尾标注："本分析由 AI 辅助生成，仅供参考。"

请直接给出专业回复。`;

router.post('/bond-agent/chat', async (req, res) => {
  try {
    const { bond_type = 'general', question, content } = req.body || {};

    const task = await runAiTask('bond_agent', req.userId, req.body, async (taskId, userId, input) => {
      await db.updateAiTask(taskId, userId, { progress: 50 });

      const bondTypeMap = {
        treasury: '国债',
        local: '地方债',
        policy: '政金债',
        credit: '信用债'
      };
      const bondTypeLabel = bondTypeMap[input.bond_type] || '通用债券';

      const systemPrompt = BOND_AGENT_PROMPT.replace('{bondType}', bondTypeLabel);
      const userPrompt = `用户问题/指令：${input.question || '请分析以下材料'}\n\n${input.content || ''}`.slice(0, 12000);

      const answer = await callAI(systemPrompt, userPrompt, { temperature: 0.3, maxTokens: 4096 });

      await db.updateAiTask(taskId, userId, {
        status: 'completed',
        progress: 100,
        result: {
          bond_type: input.bond_type,
          bond_type_label: bondTypeLabel,
          question: input.question,
          answer: answer,
          generated_at: new Date().toISOString()
        },
        completed_at: new Date().toISOString()
      });
    });

    res.json({ code: 200, message: 'success', data: task });
  } catch (err) {
    console.error('Bond agent error:', err);
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
    console.error('Get P2 task error:', err);
    res.status(500).json({ code: 500, message: err.message, data: null });
  }
});

module.exports = router;
