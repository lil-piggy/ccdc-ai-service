const fs = require('fs');
const path = require('path');
const mammoth = require('mammoth');
const { PDFParse } = require('pdf-parse');
const { pdf } = require('pdf-to-img');
const Tesseract = require('tesseract.js');

const IMAGE_MIME_REGEX = /^image\/(png|jpe?g|gif|webp|bmp)$/;

/**
 * 用 Tesseract.js 识别图片 Buffer 中的文字
 * @param {Buffer} imageBuffer
 */
async function ocrImageBuffer(imageBuffer) {
  const result = await Tesseract.recognize(imageBuffer, 'chi_sim+eng', {
    logger: m => console.log('[OCR]', m.status, m.progress ? m.progress.toFixed(2) : '')
  });
  return result.data.text || '';
}

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
    let text = '';
    try {
      const parser = new PDFParse({ data: buffer });
      const result = await parser.getText();
      text = result.text || '';
    } catch (pdfErr) {
      console.error('[PDF parse error]', pdfErr.message);
      throw new Error(`PDF 解析失败: ${pdfErr.message}`);
    }

    // 如果 PDF 没有可提取文本（扫描件/图片 PDF），尝试 OCR
    if (!text || text.trim().length < 50) {
      console.log('[PDF] 文本内容为空或过少，尝试 OCR 识别扫描件...');
      try {
        const document = await pdf(filePath, { scale: 2.0 });
        const pageTexts = [];
        let pageIndex = 0;
        for await (const image of document) {
          pageIndex++;
          console.log(`[OCR] 识别 PDF 第 ${pageIndex} 页...`);
          const pageText = await ocrImageBuffer(image);
          pageTexts.push(pageText);
        }
        text = pageTexts.join('\n\n');
      } catch (ocrErr) {
        console.error('[PDF OCR error]', ocrErr.message);
        throw new Error('该 PDF 为扫描件/图片格式，后端 OCR 识别失败。请使用「发行智能助手 → 工具 → 扫描件 PDF OCR」功能先进行本地 OCR 识别。');
      }
    }

    return text;
  }

  if (ext === '.txt' || ext === '.md' || mimeType === 'text/plain') {
    return buffer.toString('utf-8');
  }

  if (IMAGE_MIME_REGEX.test(mimeType) || ['.png','.jpg','.jpeg','.gif','.webp','.bmp'].includes(ext)) {
    return await ocrImageBuffer(buffer);
  }

  throw new Error(`不支持的文件类型: ${ext || mimeType}`);
}

module.exports = { extractText, IMAGE_MIME_REGEX };
