require('dotenv').config();

const ADMIN_API_URL = process.env.ADMIN_API_URL || '';
const ADMIN_API_KEY = process.env.ADMIN_API_KEY || '';

function parseAdminModels() {
  const modelsEnv = process.env.ADMIN_API_MODELS;
  if (modelsEnv) {
    return modelsEnv.split(',').map(pair => {
      const parts = pair.split('|');
      return { name: parts[0].trim(), label: parts[1] ? parts[1].trim() : parts[0].trim() };
    }).filter(m => m.name);
  }
  const models = [];
  if (process.env.ADMIN_API_MODEL) {
    models.push({ name: process.env.ADMIN_API_MODEL, label: process.env.ADMIN_MODEL_LABEL || process.env.ADMIN_API_MODEL });
  } else {
    models.push({ name: 'kimi-k2.6', label: 'Kimi K2.6' });
  }
  if (!models.find(m => m.name === 'deepseek-v4-pro')) {
    models.push({ name: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro' });
  }
  return models;
}

const ADMIN_MODELS = parseAdminModels();
const ADMIN_API_MODEL = ADMIN_MODELS[0]?.name || 'kimi-k2.6';

/**
 * 调用大模型进行非流式结构化输出
 * @param {string} systemPrompt - system 提示词
 * @param {string} userPrompt - user 提示词
 * @param {object} options - 选项 { model, temperature, maxTokens }
 */
async function callAI(systemPrompt, userPrompt, options = {}) {
  if (!ADMIN_API_URL || !ADMIN_API_KEY) {
    throw new Error('管理员未配置 API');
  }

  const messages = [];
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
  messages.push({ role: 'user', content: userPrompt });

  const response = await fetch(ADMIN_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${ADMIN_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: options.model || ADMIN_API_MODEL,
      messages,
      temperature: options.temperature ?? 0.3,
      max_tokens: options.maxTokens || 4096,
      response_format: options.jsonMode ? { type: 'json_object' } : undefined
    })
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '未知错误');
    throw new Error(`上游 API 错误: ${errText}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || '';

  if (options.jsonMode) {
    try {
      return JSON.parse(content);
    } catch (e) {
      // 尝试从文本中提取 JSON
      const match = content.match(/```json\s*([\s\S]*?)```/) || content.match(/\{[\s\S]*\}/);
      if (match) {
        return JSON.parse(match[1] || match[0]);
      }
      throw new Error('AI 返回结果无法解析为 JSON: ' + content.slice(0, 200));
    }
  }

  return content;
}

module.exports = { callAI, ADMIN_MODELS, ADMIN_API_MODEL };
