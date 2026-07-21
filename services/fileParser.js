const fs = require('fs');
const path = require('path');
const mammoth = require('mammoth');
const { PDFParse } = require('pdf-parse');
const { pdf } = require('pdf-to-img');
const Tesseract = require('tesseract.js');
const XLSX = require('xlsx');

const IMAGE_MIME_REGEX = /^image\/(png|jpe?g|gif|webp|bmp|tiff?)$/;
const MAX_SHEET_ROWS = 1000;
const MAX_SHEET_PREVIEW_ROWS = 50;

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
 * 解析 XLSX/XLS/CSV，返回文本和结构化 sheet 数据
 */
function parseSpreadsheet(filePath, mimeType) {
  const workbook = XLSX.readFile(filePath, { type: 'file' });
  const fullTextParts = [];
  const sheets = [];

  workbook.SheetNames.forEach((sheetName, index) => {
    const worksheet = workbook.Sheets[sheetName];
    const json = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });
    if (!json || json.length === 0) return;

    const headers = json[0] || [];
    const allRows = json.slice(1).filter(r => r.some(c => String(c).trim() !== ''));
    const previewRows = allRows.slice(0, MAX_SHEET_PREVIEW_ROWS);
    const isLarge = allRows.length > MAX_SHEET_ROWS;
    const summaryRows = isLarge ? allRows.slice(0, MAX_SHEET_ROWS) : allRows;

    // Markdown 表格
    const mdHeader = '| ' + headers.map(h => String(h || '').trim()).join(' | ') + ' |';
    const mdSep = '| ' + headers.map(() => '---').join(' | ') + ' |';
    const mdBody = previewRows.map(r => '| ' + r.map(c => String(c || '').trim()).join(' | ') + ' |').join('\n');
    const markdown = [mdHeader, mdSep, mdBody].join('\n');

    fullTextParts.push(`\n--- Sheet: ${sheetName} ---\n${markdown}\n`);

    sheets.push({
      sheetName,
      sheetIndex: index,
      headers,
      rows: summaryRows,
      markdown,
      rowCount: allRows.length,
      colCount: headers.length,
    });
  });

  return {
    text: fullTextParts.join('\n'),
    sheets,
  };
}

/**
 * 简单解析 PPTX：解压缩后读取所有 slide 的文本节点
 * 注意：不处理复杂排版，仅提取可搜索文本
 */
async function parsePptx(filePath) {
  const AdmZip = require('adm-zip');
  const zip = new AdmZip(filePath);
  const entries = zip.getEntries();
  const slideTexts = [];
  const parser = new (require('xml2js').Parser)({ explicitArray: false });

  for (const entry of entries) {
    if (entry.entryName.startsWith('ppt/slides/slide') && entry.entryName.endsWith('.xml')) {
      const xml = entry.getData().toString('utf-8');
      const obj = await parser.parseStringPromise(xml);
      const texts = [];
      function collectText(node) {
        if (typeof node === 'string') {
          texts.push(node);
          return;
        }
        if (Array.isArray(node)) {
          node.forEach(collectText);
          return;
        }
        if (node && typeof node === 'object') {
          Object.values(node).forEach(collectText);
        }
      }
      collectText(obj);
      const slideText = texts.join(' ').replace(/\s+/g, ' ').trim();
      if (slideText) slideTexts.push(slideText);
    }
  }
  return { text: slideTexts.join('\n\n') };
}

/**
 * 提取文件文本内容（兼容旧接口）
 * @param {string} filePath - 文件路径
 * @param {string} mimeType - MIME 类型
 */
async function extractText(filePath, mimeType) {
  const result = await extractKbDocument(filePath, mimeType);
  return result.text || '';
}

/**
 * 知识库专用：解析文档，返回 {text, sheets, images}
 * @param {string} filePath
 * @param {string} mimeType
 */
async function extractKbDocument(filePath, mimeType) {
  const ext = path.extname(filePath).toLowerCase();
  const buffer = fs.readFileSync(filePath);

  // DOCX
  if (ext === '.docx' || mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    const result = await mammoth.extractRawText({ buffer });
    return { text: result.value || '', sheets: [], images: [] };
  }

  // PDF
  if (ext === '.pdf' || mimeType === 'application/pdf') {
    let text = '';
    const images = [];
    try {
      const parser = new PDFParse({ data: buffer });
      const result = await parser.getText();
      text = result.text || '';
    } catch (pdfErr) {
      console.error('[PDF parse error]', pdfErr.message);
    }

    // 如果 PDF 没有可提取文本（扫描件/图片 PDF），尝试 OCR
    if (!text || text.trim().length < 50) {
      console.log('[PDF] 文本内容为空或过少，尝试 OCR 识别扫描件...');
      try {
        const document = await pdf(filePath, { scale: 2.0 });
        let pageIndex = 0;
        for await (const image of document) {
          pageIndex++;
          console.log(`[OCR] 识别 PDF 第 ${pageIndex} 页...`);
          const pageText = await ocrImageBuffer(image);
          images.push({ page: pageIndex, text: pageText });
        }
        text = images.map(i => i.text).join('\n\n');
      } catch (ocrErr) {
        console.error('[PDF OCR error]', ocrErr.message);
        throw new Error('该 PDF 为扫描件/图片格式，OCR 识别失败。');
      }
    }
    return { text, sheets: [], images };
  }

  // XLSX / XLS / CSV
  if (['.xlsx', '.xls', '.csv'].includes(ext) ||
      mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      mimeType === 'application/vnd.ms-excel' ||
      mimeType === 'text/csv') {
    return parseSpreadsheet(filePath, mimeType);
  }

  // PPTX
  if (ext === '.pptx' || mimeType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation') {
    return { ...(await parsePptx(filePath)), sheets: [], images: [] };
  }

  // TXT / MD / JSON / CSV
  if (['.txt', '.md', '.json', '.csv'].includes(ext) || mimeType === 'text/plain') {
    return { text: buffer.toString('utf-8'), sheets: [], images: [] };
  }

  // 图片 OCR
  if (IMAGE_MIME_REGEX.test(mimeType) || ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.tiff', '.tif'].includes(ext)) {
    const imgText = await ocrImageBuffer(buffer);
    return { text: imgText, sheets: [], images: [{ page: 1, text: imgText }] };
  }

  throw new Error(`不支持的文件类型: ${ext || mimeType}`);
}

module.exports = {
  extractText,
  extractKbDocument,
  ocrImageBuffer,
  IMAGE_MIME_REGEX,
};
