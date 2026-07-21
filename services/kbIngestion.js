/**
 * 知识库 Ingestion Pipeline
 * 上传 → 解析 → chunk → embedding → 入库
 */

const path = require('path');
const fs = require('fs');
const db = require('../db');
const { extractKbDocument } = require('./fileParser');
const { chunkDocument } = require('./chunker');
const { isEnabled: embeddingEnabled, getEmbeddings } = require('./embedding');

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads', 'kb');

// 确保上传目录存在
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

function makeSafeFilename(original) {
  return original.replace(/[^a-zA-Z0-9\.\-_\u4e00-\u9fa5]/g, '_');
}

/**
 * 处理单个知识库文档上传
 * @param {Object} file - multer 文件对象
 * @param {number} userId
 * @param {Object} options
 */
async function ingestKbDocument(file, userId, options = {}) {
  const docId = options.docId;
  let doc = null;

  try {
    const originalName = file.originalname || file.filename;
    const safeName = `${Date.now()}_${makeSafeFilename(originalName)}`;
    const destPath = path.join(UPLOAD_DIR, safeName);

    // multer 已把文件放到临时路径，移动到目标目录
    if (file.path && file.path !== destPath) {
      fs.renameSync(file.path, destPath);
    }

    const fileSize = file.size || fs.statSync(destPath).size;
    const mimeType = file.mimetype || 'application/octet-stream';

    // 1. 获取或创建文档记录
    if (docId) {
      doc = await db.getKbDocById(docId, userId);
      if (!doc) throw new Error('文档记录不存在');
    } else {
      doc = await db.createKbDocV2(userId, originalName, mimeType, fileSize, '', 'processing');
    }

    // 2. 记录原始文件
    await db.createKbFile(doc.id, userId, destPath, fileSize, mimeType);

    // 3. 解析文档
    const parsed = await extractKbDocument(destPath, mimeType);

    // 4. 更新文档内容/字符数
    const fullText = parsed.text || '';
    await db.updateKbDocStatus(doc.id, userId, 'processing', {
      content: fullText,
      totalChars: fullText.length,
    });

    // 5. 持久化 XLSX 结构化数据
    if (parsed.sheets && parsed.sheets.length > 0) {
      await db.createKbSheets(
        parsed.sheets.map(s => ({
          docId: doc.id,
          userId,
          sheetName: s.sheetName,
          sheetIndex: s.sheetIndex,
          headers: s.headers,
          rows: s.rows,
          markdown: s.markdown,
          rowCount: s.rowCount,
          colCount: s.colCount,
        }))
      );
    }

    // 6. Chunking
    const chunks = chunkDocument({
      filename: originalName,
      text: fullText,
      sheets: parsed.sheets || [],
      images: parsed.images || [],
    }, userId, doc.id, options);

    // 7. Embedding
    let finalChunks = chunks;
    if (embeddingEnabled() && chunks.length > 0) {
      try {
        const vectors = await getEmbeddings(chunks.map(c => c.content));
        finalChunks = chunks.map((c, i) => ({ ...c, embedding: vectors[i] }));
      } catch (e) {
        console.error('[KB Ingestion] Embedding failed, fallback to keyword-only:', e.message);
      }
    }

    // 8. 批量写入 chunks
    if (finalChunks.length > 0) {
      await db.createKbChunks(finalChunks);
    }

    // 9. 标记完成
    await db.updateKbDocStatus(doc.id, userId, 'ready', {
      chunkCount: finalChunks.length,
      totalChars: fullText.length,
    });

    return { success: true, docId: doc.id, chunkCount: finalChunks.length };
  } catch (err) {
    console.error('[KB Ingestion] Error:', err.message, err.stack);
    if (doc && doc.id) {
      try {
        await db.updateKbDocStatus(doc.id, userId, 'error', { errorMessage: err.message });
      } catch (dbErr) {
        console.error('[KB Ingestion] Failed to update error status:', dbErr.message);
      }
    }
    return { success: false, docId: doc ? doc.id : null, error: err.message };
  }
}

module.exports = {
  ingestKbDocument,
  UPLOAD_DIR,
};
