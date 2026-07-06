const fs = require('fs');
const path = require('path');
const mammoth = require('mammoth');
const pdfParse = require('pdf-parse');
const Tesseract = require('tesseract.js');

const IMAGE_MIME_REGEX = /^image\/(png|jpe?g|gif|webp|bmp)$/;

/**
 * 提取文件文本内容
 * @param {string} filePath - 文件路径
 * @param {string} mimeType - MIME 类型
 */
async function extractText(filePath, mimeType) {
  const ext = path.extname(filePath).toLowerCase();
  const buffer = fs.readFileSync(filePath);

  if (ext === '.docx' || mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    const result = await mammoth.extractRawText({ buffer });
    return result.value || '';
  }

  if (ext === '.pdf' || mimeType === 'application/pdf') {
    const result = await pdfParse(buffer);
    return result.text || '';
  }

  if (ext === '.txt' || ext === '.md' || mimeType === 'text/plain') {
    return buffer.toString('utf-8');
  }

  if (IMAGE_MIME_REGEX.test(mimeType) || ['.png','.jpg','.jpeg','.gif','.webp','.bmp'].includes(ext)) {
    const result = await Tesseract.recognize(filePath, 'chi_sim+eng', {
      logger: m => console.log('[OCR]', m.status, m.progress ? m.progress.toFixed(2) : '')
    });
    return result.data.text || '';
  }

  throw new Error(`不支持的文件类型: ${ext || mimeType}`);
}

module.exports = { extractText, IMAGE_MIME_REGEX };
