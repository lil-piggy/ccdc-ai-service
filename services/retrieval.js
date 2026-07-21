/**
 * 知识库检索服务
 * 混合检索：向量相似度 + 关键词匹配
 */

const db = require('../db');
const { isEnabled: embeddingEnabled, getEmbedding } = require('./embedding');

const DEFAULT_TOP_K = parseInt(process.env.KB_TOP_K || '5', 10);
const VECTOR_WEIGHT = 0.6;
const KEYWORD_WEIGHT = 0.4;

const STOP_CHARS = new Set('的了吗呢吧啊哦嗯嗯在是和与或及而但为以被把从到对于关于由于随着通过作为之其这那有可以需要请一下一个一些是否怎么什么如何为什么哪些什么谁'.split(''));

function extractKeywords(text) {
  if (!text) return [];
  const words = [];
  // 英文单词（2字母以上）
  const en = (text.match(/[a-zA-Z0-9]{2,}/g) || []).map(w => w.toLowerCase());
  words.push(...en);
  // 中文字符（排除常见停用字）
  const zh = text.match(/[\u4e00-\u9fa5]/g) || [];
  zh.forEach(ch => { if (!STOP_CHARS.has(ch)) words.push(ch); });
  return [...new Set(words)];
}

function normalizeScore(items, scoreKey = 'score', desc = true) {
  if (!items || items.length === 0) return [];
  const values = items.map(i => i[scoreKey]).filter(v => typeof v === 'number' && !isNaN(v));
  if (values.length === 0) return items.map(i => ({ ...i, normScore: 0 }));
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  return items.map(i => {
    let norm = 0;
    if (typeof i[scoreKey] === 'number' && !isNaN(i[scoreKey])) {
      norm = desc ? (i[scoreKey] - min) / range : 1 - (i[scoreKey] - min) / range;
    }
    return { ...i, normScore: norm };
  });
}

function dedupeByKey(items, keyFn) {
  const seen = new Set();
  return items.filter(i => {
    const k = keyFn(i);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * 混合检索：向量 + 关键词
 */
async function hybridSearch(userId, query, topK = DEFAULT_TOP_K) {
  const keywords = extractKeywords(query);
  const all = [];

  // 1. 向量检索
  if (embeddingEnabled() && keywords.length > 0) {
    try {
      const vector = await getEmbedding(query);
      const vecResults = await db.searchKbChunksByVector(userId, vector, topK * 2);
      normalizeScore(vecResults, 'score', true).forEach(r => {
        all.push({ ...r, vecScore: r.normScore, kwScore: 0, source: 'vector' });
      });
    } catch (e) {
      console.error('[KB Retrieval] Vector search failed:', e.message);
    }
  }

  // 2. 关键词检索
  if (keywords.length > 0) {
    try {
      const kwResults = await db.searchKbChunksByKeywords(userId, keywords, topK * 2);
      normalizeScore(kwResults, 'score', true).forEach(r => {
        const existing = all.find(x => x.id === r.id);
        if (existing) {
          existing.kwScore = r.normScore;
        } else {
          all.push({ ...r, vecScore: 0, kwScore: r.normScore, source: 'keyword' });
        }
      });
    } catch (e) {
      console.error('[KB Retrieval] Keyword search failed:', e.message);
    }
  }

  // 3. 重排融合
  const scored = all.map(r => ({
    ...r,
    finalScore: VECTOR_WEIGHT * (r.vecScore || 0) + KEYWORD_WEIGHT * (r.kwScore || 0),
  }));

  // 4. 去重并取 Top-K
  const deduped = dedupeByKey(scored, r => `${r.doc_id}::${r.content.slice(0, 80)}`);
  deduped.sort((a, b) => b.finalScore - a.finalScore);
  return deduped.slice(0, topK);
}

/**
 * 降级检索：当无 embedding 配置或失败时，仅关键词
 */
async function keywordFallbackSearch(userId, query, topK = DEFAULT_TOP_K) {
  const keywords = extractKeywords(query);
  if (keywords.length === 0) return [];
  const results = await db.searchKbChunksByKeywords(userId, keywords, topK);
  return results.map(r => ({ ...r, finalScore: r.score || 0, source: 'keyword' }));
}

function formatKbContext(results) {
  if (!results || results.length === 0) return '';
  return '\n\n【知识库参考】\n' +
    results.map((r, i) => {
      const meta = typeof r.meta === 'string' ? JSON.parse(r.meta || '{}') : (r.meta || {});
      const source = meta.source || meta.filename || '未知来源';
      return `[${i + 1}] ${r.content}\n（来源: ${source}）`;
    }).join('\n\n') + '\n';
}

module.exports = {
  extractKeywords,
  hybridSearch,
  keywordFallbackSearch,
  formatKbContext,
  DEFAULT_TOP_K,
};
