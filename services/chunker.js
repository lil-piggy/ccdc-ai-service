/**
 * 知识库文本切分服务
 * 支持中文语义切分：按段落/句子切分，可配置 chunk_size 与 overlap
 */

const DEFAULT_CHUNK_SIZE = 500;
const DEFAULT_OVERLAP = 100;
const MIN_CHUNK_LEN = 20;

function isSentenceEnd(ch) {
  return /[。！？；;!?.]/.test(ch);
}

/**
 * 按字数上限 + 句子边界切分长文本
 * @param {string} text
 * @param {number} chunkSize
 * @param {number} overlap
 */
function splitText(text, chunkSize = DEFAULT_CHUNK_SIZE, overlap = DEFAULT_OVERLAP) {
  if (!text || text.length <= chunkSize) {
    return text.length >= MIN_CHUNK_LEN ? [text] : [];
  }
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + chunkSize, text.length);
    // 尽量在句子边界截断
    if (end < text.length) {
      let probe = end;
      while (probe > start + chunkSize * 0.6 && !isSentenceEnd(text[probe])) probe--;
      if (probe > start + chunkSize * 0.6) end = probe + 1;
    }
    const chunk = text.slice(start, end).trim();
    if (chunk.length >= MIN_CHUNK_LEN) chunks.push(chunk);
    start = end - overlap;
    if (start >= end) start = end;
  }
  return chunks;
}

/**
 * 对文档内容做 chunking
 * @param {Object} doc
 * @param {number} userId
 * @param {number} docId
 * @param {Object} options
 * @returns {Array<{docId, userId, content, meta}>}
 */
function chunkDocument(doc, userId, docId, options = {}) {
  const chunkSize = options.chunkSize || DEFAULT_CHUNK_SIZE;
  const overlap = options.overlap || DEFAULT_OVERLAP;
  const chunks = [];
  const filename = doc.filename || 'unknown';

  // 1. 普通文本段落
  if (doc.text && doc.text.trim()) {
    const textChunks = splitText(doc.text.trim(), chunkSize, overlap);
    textChunks.forEach((content, idx) => {
      chunks.push({
        docId,
        userId,
        content,
        meta: {
          filename,
          type: 'text',
          chunk_index: idx,
          total_chunks: textChunks.length,
          source: filename,
        },
      });
    });
  }

  // 2. 表格（每个 sheet 作为一个 chunk，附加表头信息）
  if (doc.sheets && doc.sheets.length > 0) {
    doc.sheets.forEach((sheet, sIdx) => {
      const content = sheet.markdown && sheet.markdown.trim()
        ? sheet.markdown.trim()
        : `表格 ${sheet.sheetName || sIdx}\n${JSON.stringify(sheet.headers || [])}\n${(sheet.rows || []).slice(0, 30).map(r => JSON.stringify(r)).join('\n')}`;
      if (content.length < MIN_CHUNK_LEN) return;
      chunks.push({
        docId,
        userId,
        content,
        meta: {
          filename,
          type: 'sheet',
          sheet_name: sheet.sheetName,
          sheet_index: sheet.sheetIndex,
          row_count: sheet.rowCount,
          col_count: sheet.colCount,
          source: `${filename} / ${sheet.sheetName || 'Sheet' + (sIdx + 1)}`,
        },
      });
    });
  }

  // 3. 图片 OCR 文本（通常来自扫描 PDF 页面）
  if (doc.images && doc.images.length > 0) {
    doc.images.forEach((img, i) => {
      const imgChunks = splitText(img.text.trim(), chunkSize, overlap);
      imgChunks.forEach((content, idx) => {
        chunks.push({
          docId,
          userId,
          content,
          meta: {
            filename,
            type: 'image_ocr',
            page: img.page || i + 1,
            chunk_index: idx,
            source: `${filename} / 第${img.page || i + 1}页`,
          },
        });
      });
    });
  }

  return chunks;
}

module.exports = {
  splitText,
  chunkDocument,
  DEFAULT_CHUNK_SIZE,
  DEFAULT_OVERLAP,
};
