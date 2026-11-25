/**
 * High-performance PDF slicing and extraction utility using pdf-lib
 * Ensures lightweight payloads (<1MB) for Gemini Multimodal API calls,
 * preventing network timeouts, proxy drops, and "TypeError: Failed to fetch".
 */

import { PDFDocument } from 'pdf-lib';

/**
 * Parses user or AI page ranges like "1-8", "15-22, 65-68", "1,2,3, 10-12"
 * Returns 0-indexed unique, sorted page indices.
 */
export function parsePageRangeString(rangeStr: string, maxPages: number): number[] {
  if (!rangeStr || !rangeStr.trim()) return [];

  const indices = new Set<number>();
  // Split on commas, semicolons, or 'ಮತ್ತು' / 'and'
  const parts = rangeStr.replace(/\band\b/gi, ',').replace(/ಮತ್ತು/g, ',').split(/[,;]+/);

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    // Check for range like "5-10" or "5 to 10" or "5 - 10"
    const rangeMatch = trimmed.match(/^(\d+)\s*(?:-|to|–|—)\s*(\d+)$/i);
    if (rangeMatch) {
      const start = parseInt(rangeMatch[1], 10);
      const end = parseInt(rangeMatch[2], 10);
      const min = Math.min(start, end);
      const max = Math.max(start, end);
      for (let p = min; p <= max; p++) {
        if (p >= 1 && p <= maxPages) {
          indices.add(p - 1);
        }
      }
    } else {
      // Single page number like "5"
      const singleMatch = trimmed.match(/^(\d+)$/);
      if (singleMatch) {
        const p = parseInt(singleMatch[1], 10);
        if (p >= 1 && p <= maxPages) {
          indices.add(p - 1);
        }
      }
    }
  }

  return Array.from(indices).sort((a, b) => a - b);
}

/**
 * Extracts a lightweight PDF containing only specified 0-indexed page numbers.
 * Returns clean base64 string suitable for Gemini API inlineData.
 */
export async function slicePdfPages(
  pdfBuffer: ArrayBuffer | Uint8Array,
  pageIndices: number[]
): Promise<{ base64: string; pageCount: number; byteSize: number }> {
  if (pageIndices.length === 0) {
    throw new Error('ಕನಿಷ್ಠ ಒಂದು ಪುಟವನ್ನು ಆಯ್ಕೆಮಾಡಿ (At least one page must be selected).');
  }

  const srcDoc = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true });
  const totalPages = srcDoc.getPageCount();

  const validIndices = pageIndices.filter(idx => idx >= 0 && idx < totalPages);
  if (validIndices.length === 0) {
    throw new Error(`ಆಯ್ಕೆಮಾಡಿದ ಪುಟಗಳು PDF ವ್ಯಾಪ್ತಿಯಲ್ಲಿಲ್ಲ (ಒಟ್ಟು ಪುಟಗಳು: ${totalPages}).`);
  }

  const newDoc = await PDFDocument.create();
  const copiedPages = await newDoc.copyPages(srcDoc, validIndices);
  for (const page of copiedPages) {
    newDoc.addPage(page);
  }

  const newBytes = await newDoc.save();
  const base64 = uint8ArrayToBase64(newBytes);

  return {
    base64,
    pageCount: validIndices.length,
    byteSize: newBytes.byteLength,
  };
}

/**
 * Slices the initial Table of Contents / Syllabus pages for Step 1 Scanning.
 * Usually pages 1 to 12 are more than enough to capture all chapters, learning outcomes, and index.
 */
export async function getTocSlice(
  pdfBuffer: ArrayBuffer,
  maxPagesToScan = 12
): Promise<{ base64: string; totalPages: number; scannedPages: number }> {
  const srcDoc = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true });
  const totalPages = srcDoc.getPageCount();
  const pagesCount = Math.min(maxPagesToScan, totalPages);

  const pageIndices: number[] = [];
  for (let i = 0; i < pagesCount; i++) {
    pageIndices.push(i);
  }

  // Also include the last 3 pages if document is large (often contains answer key index)
  if (totalPages > 20 && pagesCount < totalPages - 3) {
    for (let p = Math.max(totalPages - 3, pagesCount); p < totalPages; p++) {
      if (!pageIndices.includes(p)) {
        pageIndices.push(p);
      }
    }
  }

  const { base64, pageCount } = await slicePdfPages(pdfBuffer, pageIndices);
  return {
    base64,
    totalPages,
    scannedPages: pageCount,
  };
}

/**
 * Fast in-browser Uint8Array to base64 converter without stack overflow on chunks.
 */
export function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = '';
  const len = bytes.byteLength;
  const chunkSize = 8192;
  for (let i = 0; i < len; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, len));
    binary += String.fromCharCode.apply(null, Array.from(chunk));
  }
  return btoa(binary);
}
