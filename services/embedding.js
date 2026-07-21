/**
 * Embedding 服务
 * 通过 OpenAI 兼容接口批量获取文本向量
 * 支持失败降级、维度校验
 */

require('dotenv').config();
const OpenAI = require('openai');

const EMBEDDING_API_URL = process.env.EMBEDDING_API_URL || process.env.ADMIN_API_URL || '';
const EMBEDDING_API_KEY = process.env.EMBEDDING_API_KEY || process.env.ADMIN_API_KEY || '';
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || 'text-embedding-3-small';
const EMBEDDING_DIMENSION = parseInt(process.env.EMBEDDING_DIMENSION || '1536', 10);
const EMBEDDING_BATCH_SIZE = parseInt(process.env.EMBEDDING_BATCH_SIZE || '50', 10);

const client = EMBEDDING_API_URL && EMBEDDING_API_KEY
  ? new OpenAI({ apiKey: EMBEDDING_API_KEY, baseURL: EMBEDDING_API_URL })
  : null;

function isEnabled() {
  return !!client;
}

/**
 * 获取单条文本的 embedding
 */
async function getEmbedding(text) {
  if (!client) throw new Error('Embedding API 未配置');
  const cleanText = String(text || '').slice(0, 8000);
  const res = await client.embeddings.create({
    model: EMBEDDING_MODEL,
    input: cleanText,
    encoding_format: 'float',
  });
  const vec = res.data[0].embedding;
  if (!Array.isArray(vec) || vec.length !== EMBEDDING_DIMENSION) {
    throw new Error(`Embedding 维度不匹配：期望 ${EMBEDDING_DIMENSION}，实际 ${vec?.length}`);
  }
  return vec;
}

/**
 * 批量获取 embedding
 * @param {string[]} texts
 * @returns {Array<number[]>}
 */
async function getEmbeddings(texts) {
  if (!client) throw new Error('Embedding API 未配置');
  if (!texts || texts.length === 0) return [];
  const results = [];
  for (let i = 0; i < texts.length; i += EMBEDDING_BATCH_SIZE) {
    const batch = texts.slice(i, i + EMBEDDING_BATCH_SIZE).map(t => String(t || '').slice(0, 8000));
    const res = await client.embeddings.create({
      model: EMBEDDING_MODEL,
      input: batch,
      encoding_format: 'float',
    });
    const vectors = res.data
      .sort((a, b) => a.index - b.index)
      .map(d => d.embedding);
    results.push(...vectors);
  }
  return results;
}

module.exports = {
  isEnabled,
  getEmbedding,
  getEmbeddings,
  EMBEDDING_DIMENSION,
  EMBEDDING_MODEL,
};
