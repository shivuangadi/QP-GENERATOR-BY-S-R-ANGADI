/**
 * Interactive Question & Answer Diagram Studio Modal
 * Supports:
 *  1. Direct PDF Page Viewer & Drag-to-Crop (via pdfjs-dist) with Instant Live Cropped Preview
 *  2. Configurable Target Image Size in KB (10 KB, 20 KB, 35 KB, 50 KB, 100 KB presets + slider)
 *  3. Firebase Cloud Storage (Firestore `question_images/{imageId}`) + local server cache so Question Bank JSON
 *     NEVER stores Base64 data — only short `/api/question-image/{imageId}` URLs
 *  4. Explicit Replace (ಬದಲಾಯಿಸಿ) & Delete (ಡಿಲೀಟ್) controls for both Question & Answer Key images
 *  5. Local Image Upload (PNG / JPG / WebP / SVG), Clipboard Paste (Ctrl+V), & Direct URL / Inline SVG
 *  6. Print-Ready High-Contrast B&W filter for monochrome school printers
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import {
  X,
  Crop,
  Upload,
  Link2,
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  Trash2,
  Check,
  Image as ImageIcon,
  FileText,
  RefreshCw,
  AlertTriangle,
  Contrast,
  Clipboard,
  Cloud,
  SlidersHorizontal,
  Replace,
  Search,
} from 'lucide-react';
import { QuestionItem } from '../types/questionBank.ts';
import {
  saveQuestionImageToFirebase,
  getQuestionImageFromFirebase,
  deleteQuestionImageFromFirebase,
  extractImageIdFromUrl,
} from '../services/firebase.ts';
import {
  SavedPdfEntry,
  savePdfPermanently,
  loadPdfBufferPermanently,
} from '../services/pdfVault.ts';
import { parsePageRangeString } from '../utils/pdfHelper.ts';
import { MathText } from './MathText.tsx';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export interface QuestionImageUpdate {
  imageUrl?: string;
  diagramSvg?: string;
  answerImageUrl?: string;
  answerDiagramSvg?: string;
  hasDiagram: boolean;
  diagramDescription?: string;
  answerDiagramDescription?: string;
}

interface QuestionImageModalProps {
  isOpen: boolean;
  onClose: () => void;
  question: QuestionItem;
  questionIndex?: number;
  totalChapterQuestions?: number;
  chapterQuestionPages?: string;
  chapterAnswerPages?: string;
  gradeKey?: string;
  subjectCode?: string;
  pdfBuffer?: ArrayBuffer | null;
  pdfFileName?: string;
  savedPdfs?: SavedPdfEntry[];
  activePdfId?: string | null;
  onPdfLoaded?: (buffer: ArrayBuffer, fileName: string, savedEntry?: SavedPdfEntry) => void;
  onSelectSavedPdf?: (pdf: SavedPdfEntry) => Promise<void> | void;
  initialQuestionPage?: number;
  initialAnswerPage?: number;
  initialSlot?: 'question' | 'answer';
  onSave: (update: QuestionImageUpdate) => void | Promise<void>;
  onNavigatePrev?: () => void;
  onNavigateNext?: () => void;
  hasPrevQuestion?: boolean;
  hasNextQuestion?: boolean;
  navPositionIndex?: number;
  navTotalCount?: number;
  navQueueLabel?: string;
}

interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface CompressedPreview {
  dataUrl: string;
  mimeType: string;
  sizeKB: number;
  width: number;
  height: number;
  isSvg?: boolean;
}

type TargetSlot = 'question' | 'answer';
type InputMode = 'pdf' | 'upload' | 'url';

const SIZE_PRESETS_KB = [10, 20, 35, 50, 100];

let cachedWebpSupport: boolean | null = null;
function supportsWebpEncoding(): boolean {
  if (cachedWebpSupport !== null) return cachedWebpSupport;
  try {
    const c = document.createElement('canvas');
    c.width = 2;
    c.height = 2;
    cachedWebpSupport = c.toDataURL('image/webp', 0.8).startsWith('data:image/webp');
  } catch {
    cachedWebpSupport = false;
  }
  return cachedWebpSupport;
}

function estimateDataUrlKB(dataUrl: string): number {
  const commaIdx = dataUrl.indexOf(',');
  const b64Len = commaIdx >= 0 ? dataUrl.length - commaIdx - 1 : dataUrl.length;
  const padding = dataUrl.endsWith('==') ? 2 : dataUrl.endsWith('=') ? 1 : 0;
  const bytes = Math.max(1, Math.floor((b64Len * 3) / 4) - padding);
  return +(bytes / 1024).toFixed(1);
}

/**
 * Apply high-contrast B&W filter onto a 2D canvas context so scanned textbook diagrams
 * print crisply on white paper without gray background smudges.
 */
function applyHighContrastBW(ctx: CanvasRenderingContext2D, width: number, height: number) {
  const imgData = ctx.getImageData(0, 0, width, height);
  const data = imgData.data;
  for (let i = 0; i < data.length; i += 4) {
    const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    let val: number;
    if (lum >= 205) {
      val = 255;
    } else if (lum <= 75) {
      val = 0;
    } else {
      val = Math.round(((lum - 75) / 130) * 255);
    }
    data[i] = val;
    data[i + 1] = val;
    data[i + 2] = val;
  }
  ctx.putImageData(imgData, 0, 0);
}

/**
 * Compress a source canvas accurately to fit under `targetKB` using WebP (or JPEG fallback),
 * binary-searching quality and progressively downscaling dimensions only when needed.
 */
function compressCanvasToTargetKB(
  sourceCanvas: HTMLCanvasElement,
  targetKB: number,
  highContrastBW: boolean
): CompressedPreview {
  const mimeType = supportsWebpEncoding() ? 'image/webp' : 'image/jpeg';
  const safeTargetKB = Math.max(5, Math.min(200, targetKB));
  const initialMaxDim = safeTargetKB <= 15 ? 640 : safeTargetKB <= 35 ? 820 : 1024;
  const baseScale = Math.min(
    1,
    initialMaxDim / Math.max(sourceCanvas.width, sourceCanvas.height, 1)
  );
  const scaleFactors = [1.0, 0.85, 0.72, 0.6, 0.48, 0.38, 0.3, 0.22];

  let smallestFallback: CompressedPreview | null = null;

  for (let sIdx = 0; sIdx < scaleFactors.length; sIdx++) {
    const totalScale = baseScale * scaleFactors[sIdx];
    const outW = Math.max(32, Math.round(sourceCanvas.width * totalScale));
    const outH = Math.max(32, Math.round(sourceCanvas.height * totalScale));

    const outCanvas = document.createElement('canvas');
    outCanvas.width = outW;
    outCanvas.height = outH;
    const ctx = outCanvas.getContext('2d');
    if (!ctx) break;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, outW, outH);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(sourceCanvas, 0, 0, outW, outH);

    if (highContrastBW) {
      applyHighContrastBW(ctx, outW, outH);
    }

    // Quick check at high quality first
    const highDataUrl = outCanvas.toDataURL(mimeType, 0.9);
    const highKB = estimateDataUrlKB(highDataUrl);
    if (highKB <= safeTargetKB) {
      return { dataUrl: highDataUrl, mimeType, sizeKB: highKB, width: outW, height: outH };
    }

    // Check minimum acceptable quality at this scale
    const minQ = sIdx === scaleFactors.length - 1 ? 0.12 : 0.34;
    const lowDataUrl = outCanvas.toDataURL(mimeType, minQ);
    const lowKB = estimateDataUrlKB(lowDataUrl);

    if (!smallestFallback || lowKB < smallestFallback.sizeKB) {
      smallestFallback = { dataUrl: lowDataUrl, mimeType, sizeKB: lowKB, width: outW, height: outH };
    }

    if (lowKB > safeTargetKB) {
      // Need a smaller resolution to maintain crispness under targetKB
      continue;
    }

    // Binary search quality between minQ and 0.90 to get maximum visual clarity <= targetKB
    let lo = minQ;
    let hi = 0.9;
    let bestUrl = lowDataUrl;
    let bestKB = lowKB;

    for (let iter = 0; iter < 6; iter++) {
      const mid = (lo + hi) / 2;
      const candidateUrl = outCanvas.toDataURL(mimeType, mid);
      const candidateKB = estimateDataUrlKB(candidateUrl);
      if (candidateKB <= safeTargetKB) {
        bestUrl = candidateUrl;
        bestKB = candidateKB;
        lo = mid;
      } else {
        hi = mid;
      }
    }

    return {
      dataUrl: bestUrl,
      mimeType,
      sizeKB: bestKB,
      width: outW,
      height: outH,
    };
  }

  if (smallestFallback) return smallestFallback;

  const fallbackUrl = sourceCanvas.toDataURL(mimeType, 0.7);
  return {
    dataUrl: fallbackUrl,
    mimeType,
    sizeKB: estimateDataUrlKB(fallbackUrl),
    width: sourceCanvas.width,
    height: sourceCanvas.height,
  };
}

export const QuestionImageModal: React.FC<QuestionImageModalProps> = ({
  isOpen,
  onClose,
  question,
  questionIndex,
  totalChapterQuestions,
  chapterQuestionPages,
  chapterAnswerPages,
  gradeKey = '7',
  subjectCode = 'gen',
  pdfBuffer,
  pdfFileName,
  savedPdfs = [],
  activePdfId,
  onPdfLoaded,
  onSelectSavedPdf,
  initialQuestionPage = 1,
  initialAnswerPage = 1,
  initialSlot = 'question',
  onSave,
  onNavigatePrev,
  onNavigateNext,
  hasPrevQuestion = false,
  hasNextQuestion = false,
  navPositionIndex,
  navTotalCount,
  navQueueLabel,
}) => {
  const [activeSlot, setActiveSlot] = useState<TargetSlot>(initialSlot);
  const [inputMode, setInputMode] = useState<InputMode>(
    pdfBuffer || savedPdfs.some(p => p.hasLocalCache || p.hasServerFile) ? 'pdf' : 'upload'
  );
  const [isLoadingSavedPdf, setIsLoadingSavedPdf] = useState<boolean>(false);

  // Current edited values for both slots (only short URLs or SVG, NEVER raw Base64 in JSON!)
  const [questionImageUrl, setQuestionImageUrl] = useState<string>(question.imageUrl || '');
  const [questionDiagramSvg, setQuestionDiagramSvg] = useState<string>(question.diagramSvg || '');
  const [questionDesc, setQuestionDesc] = useState<string>(question.diagramDescription || '');

  const [answerImageUrl, setAnswerImageUrl] = useState<string>(question.answerImageUrl || '');
  const [answerDiagramSvg, setAnswerDiagramSvg] = useState<string>(question.answerDiagramSvg || '');
  const [answerDesc, setAnswerDesc] = useState<string>(question.answerDiagramDescription || '');

  // Local immediate preview map (imageUrl -> dataUrl) so previews ALWAYS render instantly even before network round-trip
  const [localPreviewMap, setLocalPreviewMap] = useState<Record<string, string>>({});
  const [slotMetaKB, setSlotMetaKB] = useState<Record<string, number>>({});

  // Pending cropped/uploaded canvas & live compressed preview before saving to Firebase
  const [pendingCanvas, setPendingCanvas] = useState<HTMLCanvasElement | null>(null);
  const [pendingPreview, setPendingPreview] = useState<CompressedPreview | null>(null);
  const [targetSizeKB, setTargetSizeKB] = useState<number>(20);
  const [highContrastBW, setHighContrastBW] = useState<boolean>(false);

  // URL / SVG tab input fields
  const [manualUrlInput, setManualUrlInput] = useState<string>('');
  const [manualSvgInput, setManualSvgInput] = useState<string>('');

  // Local PDF state
  const [localPdfBuffer, setLocalPdfBuffer] = useState<ArrayBuffer | null>(pdfBuffer || null);
  const [localPdfName, setLocalPdfName] = useState<string>(pdfFileName || '');
  const [pdfDoc, setPdfDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [pdfNumPages, setPdfNumPages] = useState<number>(0);
  const [currentPage, setCurrentPage] = useState<number>(
    Math.max(1, initialSlot === 'answer' ? initialAnswerPage : initialQuestionPage)
  );
  const [pageInputText, setPageInputText] = useState<string>(
    String(Math.max(1, initialSlot === 'answer' ? initialAnswerPage : initialQuestionPage))
  );
  const [zoom, setZoom] = useState<number>(1.0);
  const [isRenderingPage, setIsRenderingPage] = useState<boolean>(false);
  const [isAutoFindingPage, setIsAutoFindingPage] = useState<boolean>(false);
  const [autoPageBadge, setAutoPageBadge] = useState<string | null>(null);
  const [isQuestionBoxExpanded, setIsQuestionBoxExpanded] = useState<boolean>(true);
  const pageTextCacheRef = useRef<Map<number, string>>(new Map());
  const locateRunIdRef = useRef<number>(0);
  const autoLoadedPdfIdRef = useRef<string | null>(null);
  const pdfScrollContainerRef = useRef<HTMLDivElement | null>(null);

  // Drag-to-crop state in canvas pixel coordinates
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const renderTaskRef = useRef<any>(null);
  const [cropRect, setCropRect] = useState<CropRect | null>(null);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);

  // Upload / delete / final save state
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [isDeletingSlot, setIsDeletingSlot] = useState<TargetSlot | null>(null);
  const [isSavingFinal, setIsSavingFinal] = useState<boolean>(false);
  const [isNavigatingQuestion, setIsNavigatingQuestion] = useState<boolean>(false);
  const [statusNotice, setStatusNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [brokenPreviewSlots, setBrokenPreviewSlots] = useState<Record<string, boolean>>({});

  // Sync incoming pdfBuffer prop separately so late async PDF loading never wipes user edits or slot state
  useEffect(() => {
    if (pdfBuffer) {
      setLocalPdfBuffer(pdfBuffer);
      setLocalPdfName(pdfFileName || 'Uploaded LBA PDF');
      setInputMode('pdf');
    }
  }, [pdfBuffer, pdfFileName]);

  // Reset question-specific form state whenever modal opens or navigates to a different question
  useEffect(() => {
    if (!isOpen) return;
    setQuestionImageUrl(question.imageUrl || '');
    setQuestionDiagramSvg(question.diagramSvg || '');
    setQuestionDesc(question.diagramDescription || '');
    setAnswerImageUrl(question.answerImageUrl || '');
    setAnswerDiagramSvg(question.answerDiagramSvg || '');
    setAnswerDesc(question.answerDiagramDescription || '');
    setActiveSlot(initialSlot);
    setStatusNotice(null);
    setCropRect(null);
    setPendingCanvas(null);
    setPendingPreview(null);
    setBrokenPreviewSlots({});

    const exactSavedPg =
      initialSlot === 'answer'
        ? question.answerPage || initialAnswerPage || initialQuestionPage || 1
        : question.sourcePage || initialQuestionPage || 1;
    const startPg = Math.max(1, exactSavedPg);
    setCurrentPage(startPg);
    setPageInputText(String(startPg));
    setAutoPageBadge(null);
    setIsQuestionBoxExpanded(true);
  }, [isOpen, question.id, initialSlot, initialQuestionPage, initialAnswerPage]);

  // Live re-compress whenever pendingCanvas, targetSizeKB, or highContrastBW changes
  useEffect(() => {
    if (!pendingCanvas) return;
    const compressed = compressCanvasToTargetKB(pendingCanvas, targetSizeKB, highContrastBW);
    setPendingPreview(compressed);
  }, [pendingCanvas, targetSizeKB, highContrastBW]);

  // Keep manual URL/SVG inputs synced with active slot
  useEffect(() => {
    if (activeSlot === 'question') {
      setManualUrlInput(questionImageUrl);
      setManualSvgInput(questionDiagramSvg);
    } else {
      setManualUrlInput(answerImageUrl);
      setManualSvgInput(answerDiagramSvg);
    }
  }, [activeSlot, questionImageUrl, questionDiagramSvg, answerImageUrl, answerDiagramSvg]);

  // Smart exact-page locator inside the loaded PDF:
  // Validates stored sourcePage/answerPage against chapter page bounds + PDF text layer,
  // supports English, Kannada, printedSerial, superscript-normalized equations, chapter-heading fallback,
  // and proportional page interpolation for scanned / non-Unicode Kannada PDFs.
  const locateExactPageInPdf = useCallback(
    async (doc: pdfjsLib.PDFDocumentProxy, slot: TargetSlot, forceScan: boolean = false) => {
      const total = doc.numPages;
      if (!total) return;

      const runId = ++locateRunIdRef.current;
      const isStale = () => locateRunIdRef.current !== runId;

      const knToAsciiDigits = (s: string): string =>
        s.replace(/[೦-೯]/g, ch => String('೦೧೨೩೪೫೬೭೮೯'.indexOf(ch)));
      const asciiToKnDigits = (s: string): string =>
        s.replace(/[0-9]/g, ch => '೦೧೨೩೪೫೬೭೮೯'[Number(ch)] ?? ch);
      const foldSuperSub = (s: string): string =>
        s
          .replace(/⁰/g, '0').replace(/¹/g, '1').replace(/²/g, '2').replace(/³/g, '3').replace(/⁴/g, '4')
          .replace(/⁵/g, '5').replace(/⁶/g, '6').replace(/⁷/g, '7').replace(/⁸/g, '8').replace(/⁹/g, '9')
          .replace(/₀/g, '0').replace(/₁/g, '1').replace(/₂/g, '2').replace(/₃/g, '3').replace(/₄/g, '4')
          .replace(/₅/g, '5').replace(/₆/g, '6').replace(/₇/g, '7').replace(/₈/g, '8').replace(/₉/g, '9')
          .replace(/°|º|˚/g, '');

      const normalizeForSearch = (raw: string): string =>
        knToAsciiDigits(foldSuperSub(raw || ''))
          .replace(/[.,;:?!()[\]{}"'“”‘’/\\|–—^_+=<>-]+/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .toLowerCase();

      const getPageText = async (pageNum: number): Promise<string> => {
        const cached = pageTextCacheRef.current.get(pageNum);
        if (cached !== undefined) return cached;
        try {
          const pg = await doc.getPage(pageNum);
          const tc = await pg.getTextContent();
          const rawTxt = (tc.items || [])
            .map((it: any) => (typeof it?.str === 'string' ? it.str : ''))
            .join(' ');
          const txt = normalizeForSearch(rawTxt);
          pageTextCacheRef.current.set(pageNum, txt);
          return txt;
        } catch {
          return '';
        }
      };

      const rangeStr = slot === 'answer' ? chapterAnswerPages : chapterQuestionPages;
      const primaryPages: number[] = [];
      if (rangeStr) {
        const zeroBased = parsePageRangeString(rangeStr, total);
        zeroBased.forEach(idx => primaryPages.push(idx + 1));
      }

      const storedPageRaw = slot === 'answer' ? question.answerPage : question.sourcePage;
      const storedPage =
        typeof storedPageRaw === 'number' && storedPageRaw >= 1 && storedPageRaw <= total
          ? storedPageRaw
          : undefined;

      // Check whether storedPage is plausibly inside the chapter's physical page range
      // (catches stale extractions where Gemini mistakenly stored slice page 1 or 2 instead of physical page 54!)
      const isStoredPageInChapterBounds = (() => {
        if (!storedPage) return false;
        if (primaryPages.length === 0) return true;
        const minP = Math.min(...primaryPages);
        const maxP = Math.max(...primaryPages);
        return storedPage >= Math.max(1, minP - 2) && storedPage <= Math.min(total, maxP + 2);
      })();

      // Build matching signals from the question / answer / printedSerial
      const targetRawText =
        slot === 'answer' && question.answer && question.answer.length > 6
          ? `${question.answer} ${question.question || ''}`
          : `${question.question || ''} ${(question.options || []).slice(0, 2).join(' ')}`;

      const stopWords = new Set([
        'the', 'and', 'for', 'that', 'with', 'from', 'this', 'what', 'which', 'find', 'given',
        'figure', 'value', 'following', 'each', 'into', 'are', 'is', 'in', 'of', 'to', 'on', 'at',
        'prove', 'show', 'that', 'calculate', 'write', 'draw', 'name', 'state', 'answer',
        'ಮತ್ತು', 'ಈ', 'ಒಂದು', 'ಎಂದು', 'ಆಗಿದೆ', 'ಇದರ', 'ಕೆಳಗಿನ', 'ಚಿತ್ರದಲ್ಲಿ', 'ಬರೆಯಿರಿ', 'ತಿಳಿಸಿ', 'ಕಂಡುಹಿಡಿಯಿರಿ',
      ]);

      const normalizedTarget = normalizeForSearch(targetRawText);
      const compactTarget = normalizedTarget.replace(/\s+/g, '');

      const tokens = Array.from(
        new Set(
          normalizedTarget
            .split(' ')
            .map(w => w.trim())
            .filter(w => w.length >= 3 && !stopWords.has(w))
        )
      ).slice(0, 20);

      // Distinctive numeric/angle/geometry tokens (e.g., 60, 120, 180, 45, abc, pqr, x2)
      const specialTokens = Array.from(
        new Set(
          (knToAsciiDigits(foldSuperSub(targetRawText)).match(/(?:\b\d{2,4}\b|\b[A-Z]{2,4}\b|\b[a-z]\d\b)/g) || [])
            .map(t => t.toLowerCase())
        )
      ).slice(0, 10);

      // Build distinctive 3-word phrases for high-confidence substring matches
      const rawWords = normalizedTarget.split(' ').filter(w => w.length >= 2);
      const phrases: string[] = [];
      for (let i = 0; i + 2 < rawWords.length && phrases.length < 5; i += 2) {
        const ph = rawWords.slice(i, i + 3).join(' ');
        if (ph.length >= 9) phrases.push(ph);
      }

      // Match exact printedSerial (e.g. "42", "12(a)") OR questionNumber (ASCII + Kannada digits)
      const serialBase = String(
        question.printedSerial || question.questionNumber || questionIndex || ''
      ).trim();
      const serialDigitsOnly = knToAsciiDigits(serialBase).replace(/[^0-9]/g, '');
      const serialRegex = serialDigitsOnly
        ? new RegExp(`(?:^|\\s)(?:q\\s*)?(?:${serialDigitsOnly}|${asciiToKnDigits(serialDigitsOnly)})(?:\\s|$)`, 'i')
        : null;

      const scorePageText = (txt: string): number => {
        if (!txt) return 0;
        let score = 0;
        for (const ph of phrases) {
          if (txt.includes(ph)) score += 14;
        }
        // Compact check catches PDF text where pdf.js inserted spaces inside equations like "x 2 + 3 x"
        if (compactTarget.length >= 16) {
          const compactTxt = txt.replace(/\s+/g, '');
          const slice1 = compactTarget.slice(0, 18);
          const slice2 = compactTarget.length > 30 ? compactTarget.slice(14, 32) : '';
          if (slice1.length >= 12 && compactTxt.includes(slice1)) score += 16;
          if (slice2.length >= 12 && compactTxt.includes(slice2)) score += 14;
        }
        for (const tok of tokens) {
          if (txt.includes(tok)) score += tok.length >= 6 ? 4.5 : 2.5;
        }
        for (const st of specialTokens) {
          if (txt.includes(st)) score += 3.5;
        }
        if (serialRegex && serialRegex.test(txt)) {
          score += 5;
        }
        return score;
      };

      const applyTargetPage = (pageNum: number, badge: string) => {
        if (isStale()) return;
        const safeTarget = Math.min(Math.max(1, pageNum), total);
        setCurrentPage(safeTarget);
        setPageInputText(String(safeTarget));
        setAutoPageBadge(badge);
        if (pdfScrollContainerRef.current) {
          pdfScrollContainerRef.current.scrollTop = 0;
        }
      };

      // FAST PATH: If storedPage is valid & inside chapter bounds and not forcing rescan, verify it quickly!
      if (!forceScan && storedPage && isStoredPageInChapterBounds) {
        const storedTxt = await getPageText(storedPage);
        if (isStale()) return;
        // If scanned PDF (no text layer) OR strong text match on storedPage, jump immediately!
        if (storedTxt.length < 15 || scorePageText(storedTxt) >= 8) {
          applyTargetPage(storedPage, `ಪುಟ ${storedPage} ಸ್ವಯಂ ತೆರೆಯಲಾಗಿದೆ`);
          return;
        }
      }

      setIsAutoFindingPage(true);
      try {
        const fallbackStart = Math.max(
          1,
          Math.min(
            total,
            primaryPages.length > 0
              ? primaryPages[0]
              : slot === 'answer'
                ? initialAnswerPage || 1
                : initialQuestionPage || 1
          )
        );

        // Build prioritized search list
        const searchList: number[] = [];
        const addPage = (p: number) => {
          if (p >= 1 && p <= total && !searchList.includes(p)) searchList.push(p);
        };

        // 1. Stored page first (if valid)
        if (storedPage && isStoredPageInChapterBounds) addPage(storedPage);
        // 2. All pages inside chapter range
        primaryPages.forEach(addPage);
        // 3. Nearby pages around fallbackStart
        const nearEnd = Math.min(total, fallbackStart + 16);
        for (let p = Math.max(1, fallbackStart - 2); p <= nearEnd; p++) {
          addPage(p);
        }

        let bestPage = fallbackStart;
        let bestScore = 0;
        let readablePagesCount = 0;

        for (const pNum of searchList) {
          if (isStale()) return;
          const txt = await getPageText(pNum);
          if (txt.length >= 15) readablePagesCount++;
          const sc = scorePageText(txt);
          if (sc > bestScore) {
            bestScore = sc;
            bestPage = pNum;
          }
          if (sc >= 30 && primaryPages.includes(pNum)) {
            break;
          }
        }

        // If score is still weak (e.g., old JSON without chapterQuestionPages, or shifted page range),
        // expand search across the whole PDF (prioritizing pages that mention the chapter name!)
        if (bestScore < 10 && total <= 300) {
          const searched = new Set(searchList);
          const chNameNorm = normalizeForSearch(question.chapterName || '');
          const chWords = chNameNorm
            .split(' ')
            .filter(w => w.length >= 4 && !stopWords.has(w))
            .slice(0, 4);

          let chapterHintPage: number | null = null;

          for (let pNum = 1; pNum <= total; pNum++) {
            if (isStale()) return;
            if (searched.has(pNum)) continue;
            const txt = await getPageText(pNum);
            if (txt.length >= 15) readablePagesCount++;
            let sc = scorePageText(txt);
            // Small boost if page also mentions chapter title
            if (chWords.length > 0 && chWords.some(w => txt.includes(w))) {
              sc += 3;
              if (chapterHintPage === null && pNum > 3) {
                chapterHintPage = pNum;
              }
            }
            if (sc > bestScore) {
              bestScore = sc;
              bestPage = pNum;
            }
            if (sc >= 30) break;
          }

          // If question text didn't match (e.g., legacy font) but chapter heading was found, jump to chapter start
          if (bestScore < 6 && chapterHintPage !== null && primaryPages.length === 0) {
            bestPage = chapterHintPage;
          }
        }

        if (isStale()) return;

        // Strong text match found!
        if (bestScore >= 6) {
          applyTargetPage(bestPage, `ಪುಟ ${bestPage} ಸ್ವಯಂ ಗುರುತಿಸಲಾಗಿದೆ`);
          return;
        }

        // Scanned / non-Unicode PDF fallback:
        // 1) Prefer storedPage if inside chapter bounds
        if (storedPage && isStoredPageInChapterBounds) {
          applyTargetPage(storedPage, `ಪುಟ ${storedPage} ಸ್ವಯಂ ತೆರೆಯಲಾಗಿದೆ`);
          return;
        }
        // 2) Proportional position inside chapter's page range (e.g., Q 55 of 81 in pages 54–66 -> page 62!)
        if (
          primaryPages.length > 1 &&
          questionIndex &&
          totalChapterQuestions &&
          totalChapterQuestions > 1
        ) {
          const ratio = Math.min(
            1,
            Math.max(0, (questionIndex - 1) / Math.max(1, totalChapterQuestions - 1))
          );
          const interpIdx = Math.min(
            primaryPages.length - 1,
            Math.round(ratio * (primaryPages.length - 1))
          );
          const estPage = primaryPages[interpIdx];
          applyTargetPage(
            estPage,
            readablePagesCount === 0
              ? `ಅಂದಾಜು ಪುಟ ${estPage} (ಸ್ಕ್ಯಾನ್ PDF)`
              : `ಅಧ್ಯಾಯದ ಪುಟ ${estPage}`
          );
          return;
        }
        // 3) Stored page (even if chapter range wasn't available)
        if (storedPage) {
          applyTargetPage(storedPage, `ಪುಟ ${storedPage} ಸ್ವಯಂ ತೆರೆಯಲಾಗಿದೆ`);
          return;
        }
        // 4) Chapter start fallback
        applyTargetPage(fallbackStart, `ಅಧ್ಯಾಯದ ಪುಟ ${fallbackStart}`);
      } catch (err) {
        console.warn('Auto page locate skipped:', err);
      } finally {
        if (!isStale()) {
          setIsAutoFindingPage(false);
        }
      }
    },
    [
      chapterAnswerPages,
      chapterQuestionPages,
      initialAnswerPage,
      initialQuestionPage,
      question.answer,
      question.answerPage,
      question.chapterName,
      question.options,
      question.printedSerial,
      question.question,
      question.questionNumber,
      question.sourcePage,
      questionIndex,
      totalChapterQuestions,
    ]
  );

  // Load PDFDocumentProxy whenever localPdfBuffer changes (always clone ArrayBuffer)
  useEffect(() => {
    if (!isOpen || !localPdfBuffer) {
      setPdfDoc(null);
      setPdfNumPages(0);
      pageTextCacheRef.current.clear();
      return;
    }

    let cancelled = false;
    let loadingTask: pdfjsLib.PDFDocumentLoadingTask | null = null;
    pageTextCacheRef.current.clear();

    (async () => {
      try {
        const cloned = new Uint8Array(localPdfBuffer.slice(0));
        loadingTask = pdfjsLib.getDocument({ data: cloned });
        const loadedDoc = await loadingTask.promise;
        if (cancelled) {
          loadingTask.destroy().catch(() => {});
          return;
        }
        setPdfDoc(loadedDoc);
        setPdfNumPages(loadedDoc.numPages);
      } catch (err: any) {
        if (!cancelled) {
          setStatusNotice({
            type: 'error',
            text: `PDF ಪುಟಗಳನ್ನು ಲೋಡ್ ಮಾಡಲು ಸಾಧ್ಯವಾಗಲಿಲ್ಲ: ${err?.message || 'ದೋಷ'}`,
          });
        }
      }
    })();

    return () => {
      cancelled = true;
      if (loadingTask) {
        loadingTask.destroy().catch(() => {});
      }
    };
  }, [isOpen, localPdfBuffer]);

  // Automatically jump to the exact PDF page for the open question & slot as soon as pdfDoc is ready!
  useEffect(() => {
    if (!isOpen || !pdfDoc) return;
    locateExactPageInPdf(pdfDoc, activeSlot, false);
  }, [isOpen, pdfDoc, question.id, activeSlot, locateExactPageInPdf]);

  // Auto-load active or matching saved PDF if modal opened without a preloaded buffer
  useEffect(() => {
    if (!isOpen || localPdfBuffer || pdfBuffer || isLoadingSavedPdf) return;
    const available = savedPdfs.filter(p => p.hasLocalCache || p.hasServerFile);
    if (available.length === 0) return;

    const preferred =
      (activePdfId && available.find(p => p.id === activePdfId)) ||
      available.find(
        p =>
          p.gradeKey &&
          p.subjectCode &&
          String(p.gradeKey) === String(gradeKey) &&
          String(p.subjectCode).toLowerCase() === String(subjectCode).toLowerCase()
      ) ||
      (available.length === 1 ? available[0] : null);

    if (!preferred || autoLoadedPdfIdRef.current === preferred.id) return;
    autoLoadedPdfIdRef.current = preferred.id;

    let cancelled = false;
    setIsLoadingSavedPdf(true);
    loadPdfBufferPermanently(preferred.id, preferred.serverPdfUrl)
      .then(buf => {
        if (cancelled || !buf) return;
        setLocalPdfBuffer(buf);
        setLocalPdfName(preferred.fileName);
        setInputMode('pdf');
        if (onPdfLoaded) {
          onPdfLoaded(buf, preferred.fileName, preferred);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setIsLoadingSavedPdf(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen, localPdfBuffer, pdfBuffer, isLoadingSavedPdf, savedPdfs, activePdfId, gradeKey, subjectCode, onPdfLoaded]);

  // Render active PDF page onto canvas
  useEffect(() => {
    if (!isOpen || inputMode !== 'pdf' || !pdfDoc || !canvasRef.current) return;

    let cancelled = false;
    setIsRenderingPage(true);
    setCropRect(null);

    (async () => {
      try {
        if (renderTaskRef.current) {
          try {
            renderTaskRef.current.cancel();
          } catch {
            // ignore
          }
        }
        const safePage = Math.min(Math.max(1, currentPage), pdfDoc.numPages);
        const page = await pdfDoc.getPage(safePage);
        if (cancelled) return;

        const viewport = page.getViewport({ scale: 1.6 * zoom });
        const canvas = canvasRef.current;
        if (!canvas) return;

        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        const renderTask = page.render({
          canvasContext: ctx,
          viewport,
          canvas,
        });
        renderTaskRef.current = renderTask;
        await renderTask.promise;
      } catch (err: any) {
        if (!cancelled && err?.name !== 'RenderingCancelledException') {
          console.warn('PDF page render error:', err);
        }
      } finally {
        if (!cancelled) {
          setIsRenderingPage(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isOpen, inputMode, pdfDoc, currentPage, zoom]);

  // Self-healing fallback: if an existing /api/question-image/{id} fails to load via HTTP, read directly from Firebase Firestore
  const handlePreviewImageError = useCallback(
    async (slot: TargetSlot, url: string) => {
      const imageId = extractImageIdFromUrl(url);
      if (imageId && !localPreviewMap[url]) {
        try {
          const rec = await getQuestionImageFromFirebase(imageId);
          if (rec?.dataUrl) {
            setLocalPreviewMap(prev => ({ ...prev, [url]: rec.dataUrl }));
            setSlotMetaKB(prev => ({ ...prev, [url]: rec.sizeKB }));
            setBrokenPreviewSlots(prev => ({ ...prev, [slot]: false }));
            return;
          }
        } catch {
          // fall through to broken indicator
        }
      }
      setBrokenPreviewSlots(prev => ({ ...prev, [slot]: true }));
    },
    [localPreviewMap]
  );

  // Save compressed image directly to Firebase Firestore `question_images/{imageId}` + prime server disk cache
  const saveCompressedPreviewToFirebase = useCallback(
    async (preview: CompressedPreview, slot: TargetSlot) => {
      setIsUploading(true);
      setStatusNotice(null);
      try {
        const previousUrl = slot === 'question' ? questionImageUrl : answerImageUrl;
        const previousId = extractImageIdFromUrl(previousUrl);

        // 1. Primary cloud persistence in Firebase Firestore (`question_images/{imageId}`)
        const saved = await saveQuestionImageToFirebase({
          dataUrl: preview.dataUrl,
          mimeType: preview.mimeType,
          sizeKB: preview.sizeKB,
          width: preview.width,
          height: preview.height,
          gradeKey,
          subjectCode,
          chapterId: question.chapterId || `ch${question.chapterNumber || 1}`,
          questionId: question.id || 'q1',
          role: slot,
        });

        // 2. Prime server disk cache so `/api/question-image/{imageId}` serves instantly everywhere (Question Paper, Explorer, Print)
        fetch('/api/upload-question-image', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            imageId: saved.imageId,
            imageBase64: preview.dataUrl,
            gradeKey,
            subjectCode,
            chapterId: question.chapterId || `ch${question.chapterNumber || 1}`,
            questionId: question.id || 'q1',
            role: slot,
          }),
        }).catch(err => console.warn('Local cache warm skipped:', err));

        // 3. Keep immediate local preview so user sees the cropped image with zero latency
        setLocalPreviewMap(prev => ({ ...prev, [saved.imageUrl]: preview.dataUrl }));
        setSlotMetaKB(prev => ({ ...prev, [saved.imageUrl]: saved.sizeKB }));

        if (slot === 'question') {
          setQuestionImageUrl(saved.imageUrl);
          setQuestionDiagramSvg('');
          setBrokenPreviewSlots(prev => ({ ...prev, question: false }));
        } else {
          setAnswerImageUrl(saved.imageUrl);
          setAnswerDiagramSvg('');
          setBrokenPreviewSlots(prev => ({ ...prev, answer: false }));
        }

        // Clean up replaced previous Firebase image in background
        if (previousId && previousId !== saved.imageId) {
          deleteQuestionImageFromFirebase(previousId).catch(() => {});
          fetch(`/api/question-image/${previousId}`, { method: 'DELETE' }).catch(() => {});
        }

        // Clear pending crop staging
        setPendingCanvas(null);
        setPendingPreview(null);
        setCropRect(null);

        setStatusNotice({
          type: 'success',
          text: `${slot === 'question' ? 'ಪ್ರಶ್ನೆ ಚಿತ್ರ' : 'ಉತ್ತರ ಚಿತ್ರ'} Firebase ಗೆ ಉಳಿಸಲಾಗಿದೆ (${saved.sizeKB} KB) — JSON ನಲ್ಲಿ URL ಮಾತ್ರ ಸೇರುತ್ತದೆ.`,
        });
      } catch (err: any) {
        setStatusNotice({
          type: 'error',
          text: err?.message || 'Firebase ಗೆ ಚಿತ್ರ ಉಳಿಸಲು ವಿಫಲವಾಗಿದೆ.',
        });
      } finally {
        setIsUploading(false);
      }
    },
    [
      answerImageUrl,
      gradeKey,
      question.chapterId,
      question.chapterNumber,
      question.id,
      questionImageUrl,
      subjectCode,
    ]
  );

  // Delete an image from slot + Firebase + server cache
  const handleDeleteSlotImage = async (slot: TargetSlot) => {
    setIsDeletingSlot(slot);
    setStatusNotice(null);
    try {
      const currentUrl = slot === 'question' ? questionImageUrl : answerImageUrl;
      const imageId = extractImageIdFromUrl(currentUrl);
      if (imageId) {
        await deleteQuestionImageFromFirebase(imageId);
        fetch(`/api/question-image/${imageId}`, { method: 'DELETE' }).catch(() => {});
      }

      if (slot === 'question') {
        setQuestionImageUrl('');
        setQuestionDiagramSvg('');
        setBrokenPreviewSlots(prev => ({ ...prev, question: false }));
      } else {
        setAnswerImageUrl('');
        setAnswerDiagramSvg('');
        setBrokenPreviewSlots(prev => ({ ...prev, answer: false }));
      }

      setStatusNotice({
        type: 'success',
        text: `${slot === 'question' ? 'ಪ್ರಶ್ನೆ ಚಿತ್ರ' : 'ಉತ್ತರ ಚಿತ್ರ'} ಡಿಲೀಟ್ ಮಾಡಲಾಗಿದೆ (Firebase ನಿಂದಲೂ ತೆರವುಗೊಂಡಿದೆ).`,
      });
    } catch (err: any) {
      setStatusNotice({
        type: 'error',
        text: err?.message || 'ಚಿತ್ರ ಡಿಲೀಟ್ ಮಾಡಲು ಸಾಧ್ಯವಾಗಲಿಲ್ಲ.',
      });
    } finally {
      setIsDeletingSlot(null);
    }
  };

  // Start replacing an existing slot image
  const handleReplaceSlotImage = (slot: TargetSlot) => {
    handleSwitchSlot(slot);
    setPendingCanvas(null);
    setPendingPreview(null);
    setCropRect(null);
    if (localPdfBuffer) {
      setInputMode('pdf');
    } else {
      setInputMode('upload');
    }
    setStatusNotice({
      type: 'success',
      text: `${slot === 'question' ? 'ಪ್ರಶ್ನೆ ಚಿತ್ರ' : 'ಉತ್ತರ ಚಿತ್ರ'} ಬದಲಾಯಿಸಲು ಎಡಭಾಗದಿಂದ ಹೊಸ ಚಿತ್ರ ಕ್ರಾಪ್ ಮಾಡಿ ಅಥವಾ ಅಪ್‌ಲೋಡ್ ಮಾಡಿ.`,
    });
  };

  // Process an uploaded or pasted image File/Blob -> stage into live preview with KB control
  const processImageFile = useCallback(async (file: File) => {
    setStatusNotice(null);
    const isSvg = file.type === 'image/svg+xml' || file.name.toLowerCase().endsWith('.svg');

    if (isSvg) {
      try {
        const text = await file.text();
        const b64 = btoa(unescape(encodeURIComponent(text)));
        const dataUrl = `data:image/svg+xml;base64,${b64}`;
        const sizeKB = estimateDataUrlKB(dataUrl);
        setPendingCanvas(null);
        setPendingPreview({
          dataUrl,
          mimeType: 'image/svg+xml',
          sizeKB,
          width: 400,
          height: 300,
          isSvg: true,
        });
      } catch (err: any) {
        setStatusNotice({ type: 'error', text: err?.message || 'SVG ಓದಲು ಸಾಧ್ಯವಾಗಲಿಲ್ಲ.' });
      }
      return;
    }

    if (!file.type.startsWith('image/')) {
      setStatusNotice({
        type: 'error',
        text: 'ದಯವಿಟ್ಟು ಕೇವಲ ಚಿತ್ರದ ಫೈಲ್ (PNG, JPG, WebP, SVG) ಆಯ್ಕೆಮಾಡಿ.',
      });
      return;
    }

    const imgUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const c = document.createElement('canvas');
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        const ctx = c.getContext('2d');
        if (!ctx) throw new Error('Canvas unavailable');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(img, 0, 0);
        setPendingCanvas(c);
      } catch (err: any) {
        setStatusNotice({ type: 'error', text: err?.message || 'ಚಿತ್ರ ಸಂಸ್ಕರಣೆ ವಿಫಲವಾಗಿದೆ.' });
      } finally {
        URL.revokeObjectURL(imgUrl);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(imgUrl);
      setStatusNotice({ type: 'error', text: 'ಚಿತ್ರವನ್ನು ಓದಲು ಸಾಧ್ಯವಾಗಲಿಲ್ಲ.' });
    };
    img.src = imgUrl;
  }, []);

  // Global clipboard paste support (Ctrl+V) while modal is open
  useEffect(() => {
    if (!isOpen) return;
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.startsWith('image/')) {
          const file = items[i].getAsFile();
          if (file) {
            e.preventDefault();
            processImageFile(file);
            return;
          }
        }
      }
    };
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [isOpen, processImageFile]);

  // Handle PDF file upload directly inside modal (saves permanently to PDF Vault!)
  const handlePickPdf = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsLoadingSavedPdf(true);
    try {
      const buf = await file.arrayBuffer();
      setLocalPdfBuffer(buf);
      setLocalPdfName(file.name);
      setCurrentPage(1);
      setPageInputText('1');

      let numPages = 0;
      try {
        const { PDFDocument } = await import('pdf-lib');
        const doc = await PDFDocument.load(buf.slice(0), { ignoreEncryption: true });
        numPages = doc.getPageCount();
      } catch {
        numPages = 0;
      }

      const savedEntry = await savePdfPermanently({
        buffer: buf,
        fileName: file.name,
        totalPages: numPages,
        gradeKey,
        subjectCode,
      });

      if (onPdfLoaded) {
        onPdfLoaded(buf, file.name, savedEntry);
      }
      setStatusNotice({
        type: 'success',
        text: `"${file.name}" PDF ಶಾಶ್ವತವಾಗಿ ಉಳಿಸಲಾಗಿದೆ. ಚಿತ್ರದ ಮೇಲೆ ಮೌಸ್ ಎಳೆದು ಕ್ರಾಪ್ ಮಾಡಿ.`,
      });
    } catch (err: any) {
      setStatusNotice({ type: 'error', text: `PDF ಲೋಡ್ ದೋಷ: ${err?.message || 'ದೋಷ'}` });
    } finally {
      setIsLoadingSavedPdf(false);
    }
    e.target.value = '';
  };

  // Load a permanently saved PDF from the PDF Vault without re-uploading
  const handleChooseSavedPdf = async (pdf: SavedPdfEntry) => {
    setIsLoadingSavedPdf(true);
    setStatusNotice(null);
    try {
      const buf = await loadPdfBufferPermanently(pdf.id, pdf.serverPdfUrl);
      if (!buf) {
        setStatusNotice({
          type: 'error',
          text: `"${pdf.fileName}" ಫೈಲ್ ಲಭ್ಯವಾಗಿಲ್ಲ. ದಯವಿಟ್ಟು ಒಮ್ಮೆ PDF ಅಪ್‌ಲೋಡ್ ಮಾಡಿ.`,
        });
        return;
      }
      setLocalPdfBuffer(buf);
      setLocalPdfName(pdf.fileName);
      if (onSelectSavedPdf) {
        await onSelectSavedPdf(pdf);
      } else if (onPdfLoaded) {
        onPdfLoaded(buf, pdf.fileName, pdf);
      }
      setStatusNotice({
        type: 'success',
        text: `"${pdf.fileName}" ಉಳಿಸಿದ PDF ಲೋಡ್ ಆಗಿದೆ. ಚಿತ್ರದ ಮೇಲೆ ಮೌಸ್ ಎಳೆದು ಕ್ರಾಪ್ ಮಾಡಿ.`,
      });
    } catch (err: any) {
      setStatusNotice({ type: 'error', text: `PDF ಲೋಡ್ ದೋಷ: ${err?.message || 'ದೋಷ'}` });
    } finally {
      setIsLoadingSavedPdf(false);
    }
  };

  // Switch target slot — locateExactPageInPdf automatically jumps to the exact question/answer page!
  const handleSwitchSlot = (slot: TargetSlot) => {
    setActiveSlot(slot);
    setCropRect(null);
  };

  // Pointer coordinates converted from display rect to exact internal canvas pixels
  const getCanvasPoint = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: Math.max(0, Math.min(canvas.width, (e.clientX - rect.left) * scaleX)),
      y: Math.max(0, Math.min(canvas.height, (e.clientY - rect.top) * scaleY)),
    };
  };

  // Capture the dragged rectangle into `pendingCanvas` so live preview shows immediately!
  const captureCropPreview = useCallback((rect: CropRect) => {
    const canvas = canvasRef.current;
    if (!canvas || rect.w < 12 || rect.h < 12) return;
    const sx = Math.floor(rect.x);
    const sy = Math.floor(rect.y);
    const sw = Math.floor(rect.w);
    const sh = Math.floor(rect.h);
    if (sw < 12 || sh < 12) return;

    const cropCanvas = document.createElement('canvas');
    cropCanvas.width = sw;
    cropCanvas.height = sh;
    const ctx = cropCanvas.getContext('2d');
    if (!ctx) return;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, sw, sh);
    ctx.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);
    setPendingCanvas(cropCanvas);
    setStatusNotice(null);
  }, []);

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!canvasRef.current || isRenderingPage) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const pt = getCanvasPoint(e);
    dragStartRef.current = pt;
    setIsDragging(true);
    setCropRect({ x: pt.x, y: pt.y, w: 0, h: 0 });
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDragging || !dragStartRef.current) return;
    const pt = getCanvasPoint(e);
    const start = dragStartRef.current;
    setCropRect({
      x: Math.min(start.x, pt.x),
      y: Math.min(start.y, pt.y),
      w: Math.abs(pt.x - start.x),
      h: Math.abs(pt.y - start.y),
    });
  };

  const handlePointerUp = () => {
    setIsDragging(false);
    dragStartRef.current = null;
    if (cropRect && cropRect.w >= 12 && cropRect.h >= 12) {
      captureCropPreview(cropRect);
    }
  };

  // Apply manual URL or Inline SVG to active slot
  const handleApplyManualUrlOrSvg = () => {
    const cleanUrl = manualUrlInput.trim();
    const cleanSvg = manualSvgInput.trim();

    if (cleanUrl.startsWith('data:image/')) {
      setStatusNotice({
        type: 'error',
        text: 'Base64 ಡೇಟಾವನ್ನು ನೇರವಾಗಿ JSON ನಲ್ಲಿ ಉಳಿಸಬೇಡಿ. ದಯವಿಟ್ಟು "ಫೈಲ್ ಅಪ್‌ಲೋಡ್ / ಪೇಸ್ಟ್" ಬಳಸಿ Firebase ಗೆ ಉಳಿಸಿ.',
      });
      return;
    }

    if (cleanSvg && !cleanSvg.includes('<svg')) {
      setStatusNotice({
        type: 'error',
        text: 'ಅಮಾನ್ಯ SVG ಕೋಡ್. <svg ...>...</svg> ಟ್ಯಾಗ್ ಇರಬೇಕು.',
      });
      return;
    }

    if (activeSlot === 'question') {
      setQuestionImageUrl(cleanUrl);
      setQuestionDiagramSvg(cleanUrl ? '' : cleanSvg);
      setBrokenPreviewSlots(prev => ({ ...prev, question: false }));
    } else {
      setAnswerImageUrl(cleanUrl);
      setAnswerDiagramSvg(cleanUrl ? '' : cleanSvg);
      setBrokenPreviewSlots(prev => ({ ...prev, answer: false }));
    }

    setStatusNotice({
      type: 'success',
      text: `${activeSlot === 'question' ? 'ಪ್ರಶ್ನೆ ಚಿತ್ರ' : 'ಉತ್ತರ ಚಿತ್ರ'} ನವೀಕರಿಸಲಾಗಿದೆ.`,
    });
  };

  const hasUnsavedChanges =
    Boolean(pendingPreview) ||
    questionImageUrl.trim() !== (question.imageUrl || '').trim() ||
    questionDiagramSvg.trim() !== (question.diagramSvg || '').trim() ||
    answerImageUrl.trim() !== (question.answerImageUrl || '').trim() ||
    answerDiagramSvg.trim() !== (question.answerDiagramSvg || '').trim() ||
    questionDesc.trim() !== (question.diagramDescription || '').trim() ||
    answerDesc.trim() !== (question.answerDiagramDescription || '').trim();

  // Shared commit routine (uploads any staged pending crop to Firebase & calls onSave)
  const commitCurrentChanges = useCallback(async (): Promise<boolean> => {
    let finalQuestionUrl = questionImageUrl.trim();
    let finalQuestionSvg = questionDiagramSvg.trim();
    let finalAnswerUrl = answerImageUrl.trim();
    let finalAnswerSvg = answerDiagramSvg.trim();

    if (pendingPreview) {
      const saved = await saveQuestionImageToFirebase({
        dataUrl: pendingPreview.dataUrl,
        mimeType: pendingPreview.mimeType,
        sizeKB: pendingPreview.sizeKB,
        width: pendingPreview.width,
        height: pendingPreview.height,
        gradeKey,
        subjectCode,
        chapterId: question.chapterId || `ch${question.chapterNumber || 1}`,
        questionId: question.id || 'q1',
        role: activeSlot,
      });

      fetch('/api/upload-question-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageId: saved.imageId,
          imageBase64: pendingPreview.dataUrl,
          gradeKey,
          subjectCode,
          chapterId: question.chapterId || `ch${question.chapterNumber || 1}`,
          questionId: question.id || 'q1',
          role: activeSlot,
        }),
      }).catch(() => {});

      setLocalPreviewMap(prev => ({ ...prev, [saved.imageUrl]: pendingPreview.dataUrl }));
      setSlotMetaKB(prev => ({ ...prev, [saved.imageUrl]: saved.sizeKB }));

      if (activeSlot === 'question') {
        finalQuestionUrl = saved.imageUrl;
        finalQuestionSvg = '';
      } else {
        finalAnswerUrl = saved.imageUrl;
        finalAnswerSvg = '';
      }
    }

    const hasAnyDiagram = Boolean(
      finalQuestionUrl || finalQuestionSvg || finalAnswerUrl || finalAnswerSvg
    );

    await onSave({
      imageUrl: finalQuestionUrl || undefined,
      diagramSvg: finalQuestionSvg || undefined,
      answerImageUrl: finalAnswerUrl || undefined,
      answerDiagramSvg: finalAnswerSvg || undefined,
      hasDiagram: hasAnyDiagram,
      diagramDescription: questionDesc.trim() || undefined,
      answerDiagramDescription: answerDesc.trim() || undefined,
    });
    return true;
  }, [
    activeSlot,
    answerDesc,
    answerDiagramSvg,
    answerImageUrl,
    gradeKey,
    onSave,
    pendingPreview,
    question.chapterId,
    question.chapterNumber,
    question.id,
    questionDesc,
    questionDiagramSvg,
    questionImageUrl,
    subjectCode,
  ]);

  // Save and close modal
  const handleFinalSave = async () => {
    setIsSavingFinal(true);
    try {
      await commitCurrentChanges();
      onClose();
    } catch (err: any) {
      setStatusNotice({
        type: 'error',
        text: err?.message || 'ಬದಲಾವಣೆಗಳನ್ನು ಉಳಿಸುವಲ್ಲಿ ದೋಷ ಸಂಭವಿಸಿದೆ.',
      });
    } finally {
      setIsSavingFinal(false);
    }
  };

  // Navigate to Previous or Next question right from inside the modal!
  // Auto-commits unsaved cropped/uploaded changes before moving so nothing is ever lost.
  const handleMoveQuestion = useCallback(
    async (direction: 'prev' | 'next', forceCommit: boolean = false) => {
      if (isSavingFinal || isUploading || isNavigatingQuestion) return;
      const moveFn = direction === 'next' ? onNavigateNext : onNavigatePrev;
      const canMove = direction === 'next' ? hasNextQuestion : hasPrevQuestion;
      if (!moveFn || !canMove) return;

      if (forceCommit || hasUnsavedChanges) {
        setIsNavigatingQuestion(true);
        try {
          await commitCurrentChanges();
          moveFn();
        } catch (err: any) {
          setStatusNotice({
            type: 'error',
            text: err?.message || 'ಚಿತ್ರ ಉಳಿಸಿ ಮುಂದಿನ ಪ್ರಶ್ನೆಗೆ ಹೋಗುವಲ್ಲಿ ದೋಷ ಸಂಭವಿಸಿದೆ.',
          });
        } finally {
          setIsNavigatingQuestion(false);
        }
      } else {
        moveFn();
      }
    },
    [
      commitCurrentChanges,
      hasNextQuestion,
      hasPrevQuestion,
      hasUnsavedChanges,
      isNavigatingQuestion,
      isSavingFinal,
      isUploading,
      onNavigateNext,
      onNavigatePrev,
    ]
  );

  // Keyboard shortcut: Alt + ArrowLeft / Alt + ArrowRight to move between questions inside modal
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!e.altKey) return;
      const tag = (e.target as HTMLElement | null)?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      if (e.key === 'ArrowRight' && hasNextQuestion && onNavigateNext) {
        e.preventDefault();
        handleMoveQuestion('next', false);
      } else if (e.key === 'ArrowLeft' && hasPrevQuestion && onNavigatePrev) {
        e.preventDefault();
        handleMoveQuestion('prev', false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, hasNextQuestion, hasPrevQuestion, onNavigateNext, onNavigatePrev, handleMoveQuestion]);

  // Calculate percentage overlay box for crop rectangle on top of responsive canvas
  const overlayStyle = (() => {
    const canvas = canvasRef.current;
    if (!canvas || !cropRect || canvas.width === 0 || canvas.height === 0) return null;
    return {
      left: `${(cropRect.x / canvas.width) * 100}%`,
      top: `${(cropRect.y / canvas.height) * 100}%`,
      width: `${(cropRect.w / canvas.width) * 100}%`,
      height: `${(cropRect.h / canvas.height) * 100}%`,
    };
  })();

  if (!isOpen) return null;

  const resolvedQuestionSrc = localPreviewMap[questionImageUrl] || questionImageUrl;
  const resolvedAnswerSrc = localPreviewMap[answerImageUrl] || answerImageUrl;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-2.5 sm:p-4 bg-slate-900/65 backdrop-blur-xs font-kannada"
      role="dialog"
      aria-modal="true"
      aria-label="ಚಿತ್ರ ಜೋಡಣೆ ಮತ್ತು PDF ಕ್ರಾಪ್ ಸ್ಟುಡಿಯೋ"
    >
      <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-6xl max-h-[94vh] flex flex-col overflow-hidden">
        {/* Top Modal Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-2.5 border-b border-slate-200 bg-slate-50/90 shrink-0">
          <div className="min-w-0 flex items-center gap-2.5 flex-wrap">
            <h3 className="text-sm sm:text-base font-bold text-slate-900 flex items-center gap-2">
              <ImageIcon className="w-4 h-4 text-indigo-600 shrink-0" />
              <span>ಚಿತ್ರ ಕ್ರಾಪ್ &amp; Firebase ಸ್ಟುಡಿಯೋ</span>
            </h3>
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md bg-indigo-600 text-white text-xs font-extrabold tabular-nums shadow-2xs">
              ಪ್ರಶ್ನೆ ಕ್ರಮ ಸಂಖ್ಯೆ: #{question.printedSerial || question.questionNumber || questionIndex || 1}
              {totalChapterQuestions ? ` / ${totalChapterQuestions}` : ''}
            </span>
            {questionIndex &&
              (question.printedSerial || question.questionNumber) &&
              String(question.printedSerial || question.questionNumber) !== String(questionIndex) && (
                <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-slate-200 text-slate-800 text-2xs font-bold tabular-nums">
                  ಪಟ್ಟಿಯಲ್ಲಿ ಕ್ರಮ: #{questionIndex}
                </span>
              )}
            <span className="text-2xs font-semibold text-slate-600">
              {question.chapterName} · {question.marks} ಅಂಕ
            </span>
          </div>

          <div className="flex items-center gap-2 shrink-0 flex-wrap">
            {/* In-Modal Previous / Next Question Navigator */}
            {(onNavigatePrev || onNavigateNext) && (
              <div
                className="flex items-center gap-1 bg-white border border-slate-300 rounded-lg p-0.5 shadow-2xs"
                title={navQueueLabel ? `${navQueueLabel} (Alt+← / Alt+→)` : 'ಪ್ರಶ್ನೆ ಬದಲಿಸಿ (Alt+← / Alt+→)'}
              >
                <button
                  type="button"
                  disabled={!hasPrevQuestion || isSavingFinal || isUploading || isNavigatingQuestion}
                  onClick={() => handleMoveQuestion('prev', false)}
                  className="px-2 py-1 rounded-md text-2xs font-bold text-slate-700 hover:bg-indigo-50 hover:text-indigo-700 disabled:opacity-35 disabled:cursor-not-allowed flex items-center gap-0.5 cursor-pointer whitespace-nowrap transition-colors"
                  title="ಹಿಂದಿನ ಪ್ರಶ್ನೆಗೆ ಹೋಗಿ (Alt + ←)"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                  <span>ಹಿಂದಿನ</span>
                </button>
                {navPositionIndex && navTotalCount && (
                  <span className="px-1.5 text-2xs font-mono font-extrabold text-indigo-700 tabular-nums border-x border-slate-200">
                    {navPositionIndex}/{navTotalCount}
                  </span>
                )}
                <button
                  type="button"
                  disabled={!hasNextQuestion || isSavingFinal || isUploading || isNavigatingQuestion}
                  onClick={() => handleMoveQuestion('next', false)}
                  className="px-2 py-1 rounded-md text-2xs font-bold text-indigo-700 bg-indigo-50/80 hover:bg-indigo-100 disabled:opacity-35 disabled:cursor-not-allowed flex items-center gap-0.5 cursor-pointer whitespace-nowrap transition-colors"
                  title="ಮುಂದಿನ ಪ್ರಶ್ನೆಗೆ ಹೋಗಿ (Alt + →)"
                >
                  <span>ಮುಂದಿನ</span>
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            <button
              type="button"
              onClick={() => setIsQuestionBoxExpanded(prev => !prev)}
              className="px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-2xs font-bold text-slate-700 cursor-pointer whitespace-nowrap"
            >
              {isQuestionBoxExpanded ? 'ಪ್ರಶ್ನೆ ಮರೆಮಾಡಿ ▲' : 'ಸಂಪೂರ್ಣ ಪ್ರಶ್ನೆ ತೋರಿಸಿ ▼'}
            </button>

            {/* Target Slot Segmented Switch */}
            <div className="flex items-center gap-1 p-1 bg-slate-200/80 rounded-lg text-xs">
              <button
                type="button"
                onClick={() => handleSwitchSlot('question')}
                className={`px-3 py-1.5 rounded-md font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  activeSlot === 'question'
                    ? 'bg-white text-indigo-700 shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                ಪ್ರಶ್ನೆ ಚಿತ್ರ {questionImageUrl || questionDiagramSvg ? '✓' : ''}
              </button>
              <button
                type="button"
                onClick={() => handleSwitchSlot('answer')}
                className={`px-3 py-1.5 rounded-md font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  activeSlot === 'answer'
                    ? 'bg-white text-emerald-700 shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                ಉತ್ತರ ಚಿತ್ರ {answerImageUrl || answerDiagramSvg ? '✓' : ''}
              </button>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="p-2 text-slate-500 hover:text-slate-900 hover:bg-slate-200/70 rounded-lg transition-colors cursor-pointer"
              aria-label="ಮುಚ್ಚಿ"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Full Untruncated Question & Serial Number Display Banner */}
        {isQuestionBoxExpanded && (
          <div className="px-5 py-2.5 bg-indigo-50/70 border-b border-indigo-200/80 shrink-0 max-h-40 overflow-y-auto">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="flex-1 min-w-0 space-y-1.5">
                <div className="text-xs sm:text-sm font-bold text-slate-900 whitespace-pre-line leading-relaxed">
                  <span className="text-indigo-700 font-extrabold mr-1.5">
                    {question.printedSerial || question.questionNumber || questionIndex || 1}.
                  </span>
                  <MathText text={question.question} />
                </div>

                {Array.isArray(question.options) && question.options.length > 0 && (
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-2xs font-medium text-slate-700 pt-0.5">
                    {question.options.map((opt, idx) => (
                      <span key={idx} className="bg-white/85 px-2 py-0.5 rounded border border-indigo-100">
                        <MathText text={opt} />
                      </span>
                    ))}
                  </div>
                )}

                {activeSlot === 'answer' && question.answer && (
                  <div className="text-2xs text-emerald-900 bg-emerald-50 border border-emerald-200 rounded-md px-2.5 py-1 whitespace-pre-line">
                    <span className="font-bold mr-1">ಉತ್ತರ:</span>
                    <MathText text={question.answer} />
                  </div>
                )}
              </div>

              {(question.diagramDescription || question.answerDiagramDescription) && (
                <div className="text-2xs text-amber-900 bg-amber-50 border border-amber-200 rounded-md px-2.5 py-1 max-w-xs shrink-0">
                  <span className="font-bold block">ಚಿತ್ರದ ಸುಳಿವು:</span>
                  <span>
                    {activeSlot === 'answer'
                      ? question.answerDiagramDescription || question.diagramDescription
                      : question.diagramDescription}
                  </span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Two-Zone Studio Workspace */}
        <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12 overflow-hidden">
          {/* LEFT ZONE (~62%): Interactive PDF Cropper / File Uploader / URL-SVG */}
          <div className="lg:col-span-7 xl:col-span-8 flex flex-col min-h-0 border-b lg:border-b-0 lg:border-r border-slate-200 bg-slate-50/40">
            {/* Input Mode Tabs & Print Filter Bar */}
            <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 border-b border-slate-200 bg-white shrink-0">
              <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg text-xs">
                <button
                  type="button"
                  onClick={() => setInputMode('pdf')}
                  className={`px-2.5 py-1.5 rounded-md font-semibold transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer ${
                    inputMode === 'pdf'
                      ? 'bg-white text-slate-900 shadow-2xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <Crop className="w-3.5 h-3.5 text-indigo-600" />
                  <span>PDF ಕ್ರಾಪ್</span>
                </button>
                <button
                  type="button"
                  onClick={() => setInputMode('upload')}
                  className={`px-2.5 py-1.5 rounded-md font-semibold transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer ${
                    inputMode === 'upload'
                      ? 'bg-white text-slate-900 shadow-2xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <Upload className="w-3.5 h-3.5 text-emerald-600" />
                  <span>ಅಪ್‌ಲೋಡ್ / Ctrl+V</span>
                </button>
                <button
                  type="button"
                  onClick={() => setInputMode('url')}
                  className={`px-2.5 py-1.5 rounded-md font-semibold transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer ${
                    inputMode === 'url'
                      ? 'bg-white text-slate-900 shadow-2xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <Link2 className="w-3.5 h-3.5 text-slate-600" />
                  <span>URL / SVG</span>
                </button>
              </div>

              {/* High-Contrast B&W Print Filter Toggle */}
              {inputMode !== 'url' && (
                <label className="flex items-center gap-1.5 text-xs font-medium text-slate-700 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={highContrastBW}
                    onChange={e => setHighContrastBW(e.target.checked)}
                    className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  <Contrast className="w-3.5 h-3.5 text-slate-600" />
                  <span className="whitespace-nowrap">ಕಪ್ಪು-ಬಿಳುಪು (B&amp;W Print)</span>
                </label>
              )}
            </div>

            {/* Status / Error Banner inside Stage */}
            {statusNotice && (
              <div
                className={`mx-4 mt-2.5 px-3.5 py-2 rounded-lg text-xs font-medium flex items-center gap-2 shrink-0 border ${
                  statusNotice.type === 'success'
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                    : 'bg-rose-50 border-rose-200 text-rose-900'
                }`}
              >
                {statusNotice.type === 'success' ? (
                  <Check className="w-4 h-4 text-emerald-600 shrink-0" />
                ) : (
                  <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                )}
                <span className="flex-1">{statusNotice.text}</span>
              </div>
            )}

            {/* MODE 1: PDF PAGE CROPPER */}
            {inputMode === 'pdf' && (
              <div className="flex-1 min-h-0 flex flex-col">
                {!localPdfBuffer ? (
                  <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
                    <div className="max-w-md w-full bg-white border border-dashed border-slate-300 rounded-xl p-7 space-y-4">
                      <FileText className="w-10 h-10 text-indigo-600 mx-auto" />
                      <div className="space-y-1">
                        <h4 className="text-sm font-bold text-slate-900">
                          ಪಠ್ಯಪುಸ್ತಕ / LBA PDF ಆಯ್ಕೆಮಾಡಿ (Load PDF to Crop Diagrams)
                        </h4>
                        <p className="text-xs text-slate-500 leading-relaxed">
                          ಈ ಹಿಂದೆ ಸೇವ್ ಮಾಡಿದ PDF ಅನ್ನು ಒಂದೇ ಕ್ಲಿಕ್‌ನಲ್ಲಿ ತೆರೆಯಿರಿ ಅಥವಾ ಹೊಸ PDF ಒಮ್ಮೆ ಅಪ್‌ಲೋಡ್ ಮಾಡಿ (ಶಾಶ್ವತವಾಗಿ ಉಳಿಯುತ್ತದೆ).
                        </p>
                      </div>

                      {savedPdfs.some(p => p.hasLocalCache || p.hasServerFile) && (
                        <div className="space-y-1.5 text-left">
                          <label className="text-2xs font-bold text-slate-700 block">
                            ಶಾಶ್ವತವಾಗಿ ಉಳಿಸಿದ PDF ಆಯ್ಕೆಮಾಡಿ (Saved PDFs):
                          </label>
                          <select
                            defaultValue=""
                            disabled={isLoadingSavedPdf}
                            onChange={e => {
                              const found = savedPdfs.find(p => p.id === e.target.value);
                              if (found) handleChooseSavedPdf(found);
                            }}
                            className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 text-xs font-semibold text-slate-800 cursor-pointer"
                          >
                            <option value="" disabled>
                              -- ಉಳಿಸಿದ PDF ಆಯ್ಕೆಮಾಡಿ --
                            </option>
                            {savedPdfs
                              .filter(p => p.hasLocalCache || p.hasServerFile)
                              .map(p => (
                                <option key={p.id} value={p.id}>
                                  {p.fileName} {p.totalPages > 0 ? `(${p.totalPages} ಪುಟ)` : ''}
                                </option>
                              ))}
                          </select>
                        </div>
                      )}

                      <label className="inline-flex items-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg transition-colors cursor-pointer whitespace-nowrap">
                        {isLoadingSavedPdf ? (
                          <RefreshCw className="w-4 h-4 animate-spin" />
                        ) : (
                          <Upload className="w-4 h-4" />
                        )}
                        <span>
                          {isLoadingSavedPdf ? 'ಲೋಡ್ ಆಗುತ್ತಿದೆ...' : 'ಹೊಸ PDF ಅಪ್‌ಲೋಡ್ & ಶಾಶ್ವತ ಉಳಿಸಿ'}
                        </span>
                        <input
                          type="file"
                          accept=".pdf,application/pdf"
                          onChange={handlePickPdf}
                          className="hidden"
                        />
                      </label>
                    </div>
                  </div>
                ) : (
                  <>
                    {/* PDF Navigation Bar */}
                    <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 bg-slate-100/80 border-b border-slate-200 text-xs shrink-0">
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          disabled={currentPage <= 1}
                          onClick={() => {
                            const next = Math.max(1, currentPage - 1);
                            setCurrentPage(next);
                            setPageInputText(String(next));
                          }}
                          className="p-1.5 bg-white border border-slate-300 rounded-md hover:bg-slate-50 disabled:opacity-40 cursor-pointer"
                          title="ಹಿಂದಿನ ಪುಟ"
                        >
                          <ChevronLeft className="w-3.5 h-3.5" />
                        </button>
                        <div className="flex items-center gap-1 bg-white border border-slate-300 rounded-md px-2 py-1">
                          <span className="text-2xs text-slate-500">ಪುಟ</span>
                          <input
                            type="text"
                            value={pageInputText}
                            onChange={e => setPageInputText(e.target.value)}
                            onKeyDown={e => {
                              if (e.key === 'Enter') {
                                const n = parseInt(pageInputText, 10);
                                if (!isNaN(n) && n >= 1 && n <= pdfNumPages) {
                                  setCurrentPage(n);
                                }
                              }
                            }}
                            onBlur={() => {
                              const n = parseInt(pageInputText, 10);
                              if (!isNaN(n) && n >= 1 && n <= pdfNumPages) {
                                setCurrentPage(n);
                              } else {
                                setPageInputText(String(currentPage));
                              }
                            }}
                            className="w-10 text-center font-mono font-bold text-slate-900 tabular-nums focus:outline-hidden"
                          />
                          <span className="text-2xs text-slate-500 tabular-nums">/ {pdfNumPages || '...'}</span>
                        </div>
                        <button
                          type="button"
                          disabled={currentPage >= pdfNumPages}
                          onClick={() => {
                            const next = Math.min(pdfNumPages, currentPage + 1);
                            setCurrentPage(next);
                            setPageInputText(String(next));
                          }}
                          className="p-1.5 bg-white border border-slate-300 rounded-md hover:bg-slate-50 disabled:opacity-40 cursor-pointer"
                          title="ಮುಂದಿನ ಪುಟ"
                        >
                          <ChevronRight className="w-3.5 h-3.5" />
                        </button>

                        {/* Zoom */}
                        <div className="flex items-center gap-1 ml-1.5 border-l border-slate-300 pl-1.5">
                          <button
                            type="button"
                            onClick={() => setZoom(z => Math.max(0.75, +(z - 0.25).toFixed(2)))}
                            className="p-1.5 bg-white border border-slate-300 rounded-md hover:bg-slate-50 cursor-pointer"
                            title="Zoom Out"
                          >
                            <ZoomOut className="w-3.5 h-3.5" />
                          </button>
                          <span className="text-2xs font-mono font-semibold text-slate-700 w-10 text-center tabular-nums">
                            {Math.round(zoom * 100)}%
                          </span>
                          <button
                            type="button"
                            onClick={() => setZoom(z => Math.min(2.0, +(z + 0.25).toFixed(2)))}
                            className="p-1.5 bg-white border border-slate-300 rounded-md hover:bg-slate-50 cursor-pointer"
                            title="Zoom In"
                          >
                            <ZoomIn className="w-3.5 h-3.5" />
                          </button>
                        </div>

                        {/* Auto-Find Exact Question Page Button & Indicator */}
                        <button
                          type="button"
                          disabled={isAutoFindingPage || !pdfDoc}
                          onClick={() => pdfDoc && locateExactPageInPdf(pdfDoc, activeSlot, true)}
                          className="ml-1 px-2 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 rounded-md text-2xs font-bold flex items-center gap-1 cursor-pointer whitespace-nowrap disabled:opacity-50"
                          title="ಈ ಪ್ರಶ್ನೆ ಇರುವ ನಿಖರವಾದ PDF ಪುಟವನ್ನು ಸ್ವಯಂಚಾಲಿತವಾಗಿ ಹುಡುಕಿ"
                        >
                          {isAutoFindingPage ? (
                            <RefreshCw className="w-3 h-3 animate-spin" />
                          ) : (
                            <Search className="w-3 h-3" />
                          )}
                          <span>{isAutoFindingPage ? 'ಹುಡುಕುತ್ತಿದೆ...' : 'ಪುಟ ಹುಡುಕಿ'}</span>
                        </button>

                        {autoPageBadge && !isAutoFindingPage && (
                          <span className="px-2 py-0.5 rounded bg-emerald-50 border border-emerald-200 text-emerald-800 text-3xs font-bold whitespace-nowrap">
                            📄 {autoPageBadge}
                          </span>
                        )}

                        {savedPdfs.filter(p => p.hasLocalCache || p.hasServerFile).length > 1 && (
                          <select
                            value={activePdfId || ''}
                            onChange={e => {
                              const found = savedPdfs.find(p => p.id === e.target.value);
                              if (found) handleChooseSavedPdf(found);
                            }}
                            className="ml-1 bg-white border border-slate-300 rounded-md px-2 py-1 text-2xs font-semibold text-slate-700 max-w-[140px] truncate cursor-pointer"
                            title="ಉಳಿಸಿದ ಬೇರೆ PDF ಗೆ ಬದಲಿಸಿ"
                          >
                            <option value="">ಉಳಿಸಿದ PDF...</option>
                            {savedPdfs
                              .filter(p => p.hasLocalCache || p.hasServerFile)
                              .map(p => (
                                <option key={p.id} value={p.id}>
                                  {p.fileName}
                                </option>
                              ))}
                          </select>
                        )}

                        <label className="ml-1.5 text-2xs font-semibold text-indigo-700 hover:underline cursor-pointer whitespace-nowrap">
                          ಹೊಸ PDF
                          <input
                            type="file"
                            accept=".pdf,application/pdf"
                            onChange={handlePickPdf}
                            className="hidden"
                          />
                        </label>
                      </div>

                      <div className="flex items-center gap-2">
                        {cropRect && cropRect.w > 10 && cropRect.h > 10 && (
                          <button
                            type="button"
                            onClick={() => {
                              setCropRect(null);
                              setPendingCanvas(null);
                              setPendingPreview(null);
                            }}
                            className="px-2.5 py-1 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-md text-2xs font-semibold cursor-pointer whitespace-nowrap"
                          >
                            ಆಯ್ಕೆ ತೆರವು (Clear)
                          </button>
                        )}
                        {pendingPreview && (
                          <button
                            type="button"
                            disabled={isUploading}
                            onClick={() => saveCompressedPreviewToFirebase(pendingPreview, activeSlot)}
                            className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-45 text-white rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                          >
                            {isUploading ? (
                              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Cloud className="w-3.5 h-3.5" />
                            )}
                            <span>
                              {isUploading
                                ? 'Firebase ಗೆ ಉಳಿಸಲಾಗುತ್ತಿದೆ...'
                                : `Firebase ಗೆ ಉಳಿಸಿ (${pendingPreview.sizeKB} KB)`}
                            </span>
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Interactive PDF Canvas Stage */}
                    <div
                      ref={pdfScrollContainerRef}
                      className="flex-1 min-h-0 overflow-auto p-4 flex flex-col items-center bg-slate-200/70"
                    >
                      <div className="text-2xs text-slate-600 mb-2 flex items-center gap-2">
                        <span className="font-medium truncate max-w-xs">{localPdfName}</span>
                        <span aria-hidden="true">·</span>
                        <span>ಚಿತ್ರದ ಮೇಲೆ ಕ್ಲಿಕ್ ಮಾಡಿ ಎಳೆಯಿರಿ — ಬಲಭಾಗದಲ್ಲಿ ತಕ್ಷಣ ಕ್ರಾಪ್ ಪ್ರಿವ್ಯೂ ಕಾಣಿಸುತ್ತದೆ</span>
                      </div>

                      <div className="relative inline-block shadow-md border border-slate-300 bg-white select-none">
                        {isRenderingPage && (
                          <div className="absolute inset-0 z-20 bg-white/75 flex items-center justify-center gap-2 text-xs font-semibold text-indigo-700">
                            <RefreshCw className="w-4 h-4 animate-spin" />
                            <span>ಪುಟ {currentPage} ಲೋಡ್ ಆಗುತ್ತಿದೆ...</span>
                          </div>
                        )}
                        <canvas
                          ref={canvasRef}
                          onPointerDown={handlePointerDown}
                          onPointerMove={handlePointerMove}
                          onPointerUp={handlePointerUp}
                          className="block max-w-full h-auto cursor-crosshair touch-none"
                        />
                        {overlayStyle && cropRect && cropRect.w > 4 && cropRect.h > 4 && (
                          <div
                            style={overlayStyle}
                            className="absolute pointer-events-none border-2 border-indigo-600 bg-indigo-500/15 shadow-[0_0_0_9999px_rgba(15,23,42,0.38)]"
                          >
                            <span className="absolute -top-6 left-0 bg-indigo-600 text-white text-3xs font-mono px-1.5 py-0.5 rounded tabular-nums whitespace-nowrap">
                              {Math.round(cropRect.w)}×{Math.round(cropRect.h)} px
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* MODE 2: UPLOAD FILE OR CLIPBOARD PASTE */}
            {inputMode === 'upload' && (
              <div className="flex-1 flex flex-col items-center justify-center p-6 sm:p-8">
                <div className="max-w-lg w-full bg-white border border-dashed border-slate-300 rounded-xl p-8 text-center space-y-5">
                  <div className="w-12 h-12 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center mx-auto">
                    <Upload className="w-6 h-6" />
                  </div>
                  <div className="space-y-1.5">
                    <h4 className="text-sm font-bold text-slate-900">
                      {activeSlot === 'question'
                        ? 'ಪ್ರಶ್ನೆ ಚಿತ್ರ ಅಪ್‌ಲೋಡ್ ಮಾಡಿ (Upload Question Diagram)'
                        : 'ಉತ್ತರ ಚಿತ್ರ ಅಪ್‌ಲೋಡ್ ಮಾಡಿ (Upload Answer Key Diagram)'}
                    </h4>
                    <p className="text-xs text-slate-500 leading-relaxed">
                      PNG, JPG, WebP ಅಥವಾ SVG ಆಯ್ಕೆಮಾಡಿ. ಬಲಭಾಗದಲ್ಲಿ ಪ್ರಿವ್ಯೂ ಮತ್ತು KB ಗಾತ್ರ (10 KB / 20 KB / 50 KB) ಹೊಂದಿಸಿ Firebase ಗೆ ಉಳಿಸಬಹುದು — JSON ನಲ್ಲಿ URL ಮಾತ್ರ ಸೇರುತ್ತದೆ.
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center justify-center gap-3">
                    <label className="inline-flex items-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg transition-colors cursor-pointer whitespace-nowrap">
                      <Upload className="w-4 h-4" />
                      <span>ಚಿತ್ರ ಆಯ್ಕೆಮಾಡಿ (Choose Image)</span>
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp,image/svg+xml,.svg"
                        disabled={isUploading}
                        onChange={e => {
                          const f = e.target.files?.[0];
                          if (f) processImageFile(f);
                          e.target.value = '';
                        }}
                        className="hidden"
                      />
                    </label>
                  </div>

                  <div className="pt-3 border-t border-slate-100 flex items-center justify-center gap-2 text-2xs text-slate-500">
                    <Clipboard className="w-3.5 h-3.5 text-slate-400" />
                    <span>
                      ಸ್ಕ್ರೀನ್‌ಶಾಟ್ ತೆಗೆದು ನೇರವಾಗಿ{' '}
                      <kbd className="px-1.5 py-0.5 bg-slate-100 border border-slate-300 rounded font-mono text-slate-700">
                        Ctrl + V
                      </kbd>{' '}
                      ಒತ್ತಿ ಪೇಸ್ಟ್ ಮಾಡಬಹುದು.
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* MODE 3: DIRECT URL OR INLINE SVG */}
            {inputMode === 'url' && (
              <div className="flex-1 overflow-y-auto p-5 space-y-5">
                <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
                  <div className="space-y-1.5">
                    <label className="block text-xs font-bold text-slate-800">
                      ಚಿತ್ರದ URL ({activeSlot === 'question' ? 'imageUrl' : 'answerImageUrl'})
                    </label>
                    <input
                      type="text"
                      value={manualUrlInput}
                      onChange={e => setManualUrlInput(e.target.value)}
                      placeholder="/api/question-image/img_... ಅಥವಾ https://..."
                      className="w-full px-3 py-2 text-xs font-mono bg-slate-50 border border-slate-300 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="block text-xs font-bold text-slate-800">
                      ಅಥವಾ ಗಣಿತ / ರೇಖಾಗಣಿತ SVG ಕೋಡ್ ({activeSlot === 'question' ? 'diagramSvg' : 'answerDiagramSvg'})
                    </label>
                    <textarea
                      value={manualSvgInput}
                      onChange={e => setManualSvgInput(e.target.value)}
                      rows={6}
                      placeholder="<svg viewBox='0 0 200 140' width='180'>...</svg>"
                      className="w-full px-3 py-2 text-xs font-mono bg-slate-50 border border-slate-300 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>

                  <button
                    type="button"
                    onClick={handleApplyManualUrlOrSvg}
                    className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-lg transition-colors cursor-pointer whitespace-nowrap"
                  >
                    ಅನ್ವಯಿಸಿ (Apply to {activeSlot === 'question' ? 'Question' : 'Answer Key'})
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* RIGHT ZONE (~38%): Live Cropped Preview + KB Optimizer + Attached Question/Answer Slots */}
          <div className="lg:col-span-5 xl:col-span-4 flex flex-col min-h-0 bg-white">
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {/* LIVE CROPPED / STAGED PREVIEW & KB SIZE CONTROL */}
              <div
                className={`rounded-xl border-2 p-3.5 space-y-3 transition-colors ${
                  pendingPreview
                    ? 'border-indigo-500 bg-indigo-50/40'
                    : 'border-slate-200 bg-slate-50/70'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-slate-900">
                    <SlidersHorizontal className="w-3.5 h-3.5 text-indigo-600" />
                    <span>ಚಿತ್ರದ ಗಾತ್ರ (KB) &amp; ಕ್ರಾಪ್ ಪ್ರಿವ್ಯೂ</span>
                  </div>
                  <span className="text-2xs font-mono font-bold text-indigo-700 tabular-nums">
                    ಗುರಿ: {targetSizeKB} KB
                  </span>
                </div>

                {/* Preset KB Buttons (10 KB, 20 KB, 35 KB, 50 KB, 100 KB) */}
                <div className="flex flex-wrap items-center gap-1.5">
                  {SIZE_PRESETS_KB.map(kb => (
                    <button
                      key={kb}
                      type="button"
                      onClick={() => setTargetSizeKB(kb)}
                      className={`px-2 py-1 rounded-md text-2xs font-bold tabular-nums transition-colors cursor-pointer border whitespace-nowrap ${
                        targetSizeKB === kb
                          ? 'bg-indigo-600 text-white border-indigo-600'
                          : 'bg-white text-slate-700 border-slate-300 hover:border-indigo-400'
                      }`}
                    >
                      {kb} KB
                    </button>
                  ))}
                </div>

                {/* Continuous KB Slider (5 KB to 150 KB) */}
                <div className="space-y-1">
                  <input
                    type="range"
                    min={5}
                    max={150}
                    step={5}
                    value={targetSizeKB}
                    onChange={e => setTargetSizeKB(Number(e.target.value))}
                    className="w-full accent-indigo-600 cursor-pointer"
                    aria-label="ಚಿತ್ರದ ಗರಿಷ್ಠ ಗಾತ್ರ (KB)"
                  />
                  <div className="flex justify-between text-3xs text-slate-500 font-mono tabular-nums">
                    <span>5 KB (ಅತಿ ಚಿಕ್ಕದು)</span>
                    <span>20 KB (ಶಿಫಾರಸು)</span>
                    <span>150 KB (ಹೆಚ್ಚು ಸ್ಪಷ್ಟ)</span>
                  </div>
                </div>

                {/* Instant Cropped Image Live Preview */}
                {pendingPreview ? (
                  <div className="space-y-2.5 pt-2 border-t border-indigo-200/70">
                    <div className="flex items-center justify-between text-2xs">
                      <span className="font-bold text-indigo-900">
                        ಕ್ರಾಪ್ ಮಾಡಿದ ಪ್ರಿವ್ಯೂ ({activeSlot === 'question' ? 'ಪ್ರಶ್ನೆ' : 'ಉತ್ತರ'}):
                      </span>
                      <span className="font-mono font-bold text-emerald-700 tabular-nums">
                        {pendingPreview.sizeKB} KB · {pendingPreview.width}×{pendingPreview.height}
                      </span>
                    </div>

                    <div className="rounded-lg border border-indigo-300 bg-white p-2 flex items-center justify-center min-h-28 max-h-48 overflow-hidden">
                      <img
                        src={pendingPreview.dataUrl}
                        alt="ಕ್ರಾಪ್ ಮಾಡಿದ ಚಿತ್ರದ ಪ್ರಿವ್ಯೂ"
                        className="max-h-44 max-w-full object-contain"
                      />
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={isUploading}
                        onClick={() => saveCompressedPreviewToFirebase(pendingPreview, activeSlot)}
                        className="flex-1 py-2 px-3 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-lg text-xs font-bold transition-colors flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap"
                      >
                        {isUploading ? (
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Cloud className="w-3.5 h-3.5" />
                        )}
                        <span>
                          {isUploading
                            ? 'ಉಳಿಸಲಾಗುತ್ತಿದೆ...'
                            : `Firebase ಗೆ ಉಳಿಸಿ (${pendingPreview.sizeKB} KB)`}
                        </span>
                      </button>

                      <button
                        type="button"
                        disabled={isUploading}
                        onClick={() => {
                          setPendingCanvas(null);
                          setPendingPreview(null);
                          setCropRect(null);
                        }}
                        className="py-2 px-2.5 bg-white hover:bg-rose-50 text-rose-700 border border-rose-300 rounded-lg text-xs font-bold transition-colors cursor-pointer whitespace-nowrap"
                        title="ಈ ಕ್ರಾಪ್ ರದ್ದುಗೊಳಿಸಿ ಮತ್ತೆ ಆಯ್ಕೆಮಾಡಿ"
                      >
                        ರದ್ದು
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="text-2xs text-slate-500 leading-relaxed border-t border-slate-200/80 pt-2">
                    ಎಡಭಾಗದ PDF ಪುಟದಲ್ಲಿ ಚಿತ್ರದ ಮೇಲೆ ಎಳೆದು (Drag) ಕ್ರಾಪ್ ಮಾಡಿದ ತಕ್ಷಣ ಅದರ ಪ್ರಿವ್ಯೂ ಮತ್ತು ನಿಖರ KB ಗಾತ್ರ ಇಲ್ಲಿ ಕಾಣಿಸುತ್ತದೆ.
                  </p>
                )}
              </div>

              {/* Slot 1: Attached Question Paper Image Preview */}
              <div
                className={`rounded-xl border p-3.5 space-y-2.5 transition-colors ${
                  activeSlot === 'question'
                    ? 'border-indigo-400 bg-indigo-50/20'
                    : 'border-slate-200 bg-slate-50/40'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => handleSwitchSlot('question')}
                    className="text-xs font-bold text-slate-900 hover:text-indigo-700 cursor-pointer text-left"
                  >
                    ೧. ಪ್ರಶ್ನೆ ಚಿತ್ರ (Question Image)
                  </button>
                  {questionImageUrl && slotMetaKB[questionImageUrl] && (
                    <span className="text-3xs font-mono font-bold text-emerald-700 tabular-nums">
                      {slotMetaKB[questionImageUrl]} KB · Firebase
                    </span>
                  )}
                </div>

                {questionImageUrl ? (
                  <div className="space-y-2">
                    {brokenPreviewSlots.question ? (
                      <div className="h-28 rounded-lg border border-slate-200 bg-slate-100 flex flex-col items-center justify-center text-2xs text-slate-500 p-2 text-center">
                        <ImageIcon className="w-5 h-5 mb-1 text-slate-400" />
                        <span>ಚಿತ್ರ ಲೋಡ್ ಆಗಲಿಲ್ಲ — ಬದಲಾಯಿಸಿ ಅಥವಾ ಮರು-ಕ್ರಾಪ್ ಮಾಡಿ</span>
                      </div>
                    ) : (
                      <div className="rounded-lg border border-slate-200 bg-white p-1.5 flex items-center justify-center">
                        <img
                          src={resolvedQuestionSrc}
                          alt={questionDesc || 'ಪ್ರಶ್ನೆ ಚಿತ್ರ'}
                          referrerPolicy="no-referrer"
                          onError={() => handlePreviewImageError('question', questionImageUrl)}
                          className="max-h-36 max-w-full object-contain"
                        />
                      </div>
                    )}

                    <div className="text-3xs font-mono text-slate-500 truncate" title={questionImageUrl}>
                      URL: {questionImageUrl}
                    </div>

                    {/* Explicit Replace & Delete Buttons */}
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleReplaceSlotImage('question')}
                        className="flex-1 py-1.5 px-2.5 bg-white hover:bg-indigo-50 text-indigo-700 border border-indigo-300 rounded-lg text-2xs font-bold flex items-center justify-center gap-1 cursor-pointer whitespace-nowrap"
                      >
                        <Replace className="w-3.5 h-3.5" />
                        <span>ಬದಲಾಯಿಸಿ (Replace)</span>
                      </button>
                      <button
                        type="button"
                        disabled={isDeletingSlot === 'question'}
                        onClick={() => handleDeleteSlotImage('question')}
                        className="flex-1 py-1.5 px-2.5 bg-white hover:bg-rose-50 text-rose-700 border border-rose-300 rounded-lg text-2xs font-bold flex items-center justify-center gap-1 cursor-pointer whitespace-nowrap disabled:opacity-50"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>{isDeletingSlot === 'question' ? 'ಅಳಿಸಲಾಗುತ್ತಿದೆ...' : 'ಡಿಲೀಟ್ (Delete)'}</span>
                      </button>
                    </div>
                  </div>
                ) : questionDiagramSvg ? (
                  <div className="space-y-2">
                    <div
                      className="w-full max-h-36 overflow-hidden rounded-lg border border-slate-200 bg-white p-2 flex items-center justify-center"
                      dangerouslySetInnerHTML={{ __html: questionDiagramSvg }}
                    />
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleReplaceSlotImage('question')}
                        className="flex-1 py-1.5 px-2.5 bg-white hover:bg-indigo-50 text-indigo-700 border border-indigo-300 rounded-lg text-2xs font-bold flex items-center justify-center gap-1 cursor-pointer whitespace-nowrap"
                      >
                        <Replace className="w-3.5 h-3.5" />
                        <span>ಬದಲಾಯಿಸಿ</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteSlotImage('question')}
                        className="flex-1 py-1.5 px-2.5 bg-white hover:bg-rose-50 text-rose-700 border border-rose-300 rounded-lg text-2xs font-bold flex items-center justify-center gap-1 cursor-pointer whitespace-nowrap"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>ಡಿಲೀಟ್</span>
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="h-20 rounded-lg border border-dashed border-slate-300 bg-white flex flex-col items-center justify-center text-2xs text-slate-400 text-center px-3">
                    <span>ಪ್ರಶ್ನೆ ಚಿತ್ರ ಜೋಡಿಸಿಲ್ಲ</span>
                  </div>
                )}

                <input
                  type="text"
                  value={questionDesc}
                  onChange={e => setQuestionDesc(e.target.value)}
                  placeholder="ಪ್ರಶ್ನೆ ಚಿತ್ರದ ವಿವರಣೆ / Alt Text (ಐಚ್ಛಿಕ)"
                  className="w-full px-2.5 py-1.5 text-2xs bg-white border border-slate-200 rounded-lg focus:outline-hidden focus:ring-1 focus:ring-indigo-500"
                />
              </div>

              {/* Slot 2: Separate Answer Key Image Preview */}
              <div
                className={`rounded-xl border p-3.5 space-y-2.5 transition-colors ${
                  activeSlot === 'answer'
                    ? 'border-emerald-500 bg-emerald-50/20'
                    : 'border-slate-200 bg-slate-50/40'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => handleSwitchSlot('answer')}
                    className="text-xs font-bold text-slate-900 hover:text-emerald-700 cursor-pointer text-left"
                  >
                    ೨. ಉತ್ತರ ಪತ್ರಿಕೆ ಚಿತ್ರ (Answer Key Image)
                  </button>
                  {answerImageUrl && slotMetaKB[answerImageUrl] && (
                    <span className="text-3xs font-mono font-bold text-emerald-700 tabular-nums">
                      {slotMetaKB[answerImageUrl]} KB · Firebase
                    </span>
                  )}
                </div>

                {answerImageUrl ? (
                  <div className="space-y-2">
                    {brokenPreviewSlots.answer ? (
                      <div className="h-28 rounded-lg border border-slate-200 bg-slate-100 flex flex-col items-center justify-center text-2xs text-slate-500 p-2 text-center">
                        <ImageIcon className="w-5 h-5 mb-1 text-slate-400" />
                        <span>ಉತ್ತರ ಚಿತ್ರ ಲೋಡ್ ಆಗಲಿಲ್ಲ</span>
                      </div>
                    ) : (
                      <div className="rounded-lg border border-emerald-200 bg-white p-1.5 flex items-center justify-center">
                        <img
                          src={resolvedAnswerSrc}
                          alt={answerDesc || 'ಉತ್ತರ ಚಿತ್ರ'}
                          referrerPolicy="no-referrer"
                          onError={() => handlePreviewImageError('answer', answerImageUrl)}
                          className="max-h-36 max-w-full object-contain"
                        />
                      </div>
                    )}

                    <div className="text-3xs font-mono text-slate-500 truncate" title={answerImageUrl}>
                      URL: {answerImageUrl}
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleReplaceSlotImage('answer')}
                        className="flex-1 py-1.5 px-2.5 bg-white hover:bg-emerald-50 text-emerald-700 border border-emerald-300 rounded-lg text-2xs font-bold flex items-center justify-center gap-1 cursor-pointer whitespace-nowrap"
                      >
                        <Replace className="w-3.5 h-3.5" />
                        <span>ಬದಲಾಯಿಸಿ (Replace)</span>
                      </button>
                      <button
                        type="button"
                        disabled={isDeletingSlot === 'answer'}
                        onClick={() => handleDeleteSlotImage('answer')}
                        className="flex-1 py-1.5 px-2.5 bg-white hover:bg-rose-50 text-rose-700 border border-rose-300 rounded-lg text-2xs font-bold flex items-center justify-center gap-1 cursor-pointer whitespace-nowrap disabled:opacity-50"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>{isDeletingSlot === 'answer' ? 'ಅಳಿಸಲಾಗುತ್ತಿದೆ...' : 'ಡಿಲೀಟ್ (Delete)'}</span>
                      </button>
                    </div>
                  </div>
                ) : answerDiagramSvg ? (
                  <div className="space-y-2">
                    <div
                      className="w-full max-h-36 overflow-hidden rounded-lg border border-emerald-200 bg-white p-2 flex items-center justify-center"
                      dangerouslySetInnerHTML={{ __html: answerDiagramSvg }}
                    />
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleReplaceSlotImage('answer')}
                        className="flex-1 py-1.5 px-2.5 bg-white hover:bg-emerald-50 text-emerald-700 border border-emerald-300 rounded-lg text-2xs font-bold flex items-center justify-center gap-1 cursor-pointer whitespace-nowrap"
                      >
                        <Replace className="w-3.5 h-3.5" />
                        <span>ಬದಲಾಯಿಸಿ</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteSlotImage('answer')}
                        className="flex-1 py-1.5 px-2.5 bg-white hover:bg-rose-50 text-rose-700 border border-rose-300 rounded-lg text-2xs font-bold flex items-center justify-center gap-1 cursor-pointer whitespace-nowrap"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>ಡಿಲೀಟ್</span>
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="h-16 rounded-lg border border-dashed border-slate-300 bg-white flex items-center justify-center text-2xs text-slate-400 text-center px-3">
                    ಪ್ರತ್ಯೇಕ ಉತ್ತರ ಚಿತ್ರ ಜೋಡಿಸಿಲ್ಲ (ಐಚ್ಛಿಕ)
                  </div>
                )}

                <input
                  type="text"
                  value={answerDesc}
                  onChange={e => setAnswerDesc(e.target.value)}
                  placeholder="ಉತ್ತರ ಚಿತ್ರದ ವಿವರಣೆ (ಐಚ್ಛಿಕ)"
                  className="w-full px-2.5 py-1.5 text-2xs bg-white border border-slate-200 rounded-lg focus:outline-hidden focus:ring-1 focus:ring-emerald-500"
                />
              </div>
            </div>

            {/* Bottom Save & Next Footer */}
            <div className="p-3 border-t border-slate-200 bg-slate-50/90 flex flex-wrap items-center justify-between gap-2 shrink-0">
              <div className="flex items-center gap-1.5">
                {onNavigatePrev && (
                  <button
                    type="button"
                    disabled={!hasPrevQuestion || isSavingFinal || isUploading || isNavigatingQuestion}
                    onClick={() => handleMoveQuestion('prev', false)}
                    className="px-2.5 py-2 text-xs font-bold text-slate-700 bg-white border border-slate-300 hover:bg-slate-100 disabled:opacity-40 rounded-lg transition-colors flex items-center gap-1 cursor-pointer whitespace-nowrap"
                    title="ಹಿಂದಿನ ಪ್ರಶ್ನೆ (Alt + ←)"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                    <span>ಹಿಂದಿನ</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={onClose}
                  className="px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-200/70 rounded-lg transition-colors cursor-pointer whitespace-nowrap"
                >
                  ಮುಚ್ಚಿ
                </button>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  disabled={isSavingFinal || isUploading || isNavigatingQuestion}
                  onClick={handleFinalSave}
                  className={`px-3.5 py-2 text-xs font-semibold rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap disabled:opacity-50 ${
                    hasNextQuestion && onNavigateNext
                      ? 'bg-white border border-indigo-300 text-indigo-700 hover:bg-indigo-50'
                      : 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-xs'
                  }`}
                >
                  {isSavingFinal ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Check className="w-3.5 h-3.5" />
                  )}
                  <span>{isSavingFinal ? 'ಉಳಿಸಲಾಗುತ್ತಿದೆ...' : 'ಉಳಿಸಿ & ಮುಚ್ಚಿ'}</span>
                </button>

                {hasNextQuestion && onNavigateNext && (
                  <button
                    type="button"
                    disabled={isSavingFinal || isUploading || isNavigatingQuestion}
                    onClick={() => handleMoveQuestion('next', hasUnsavedChanges)}
                    className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-bold rounded-lg shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                    title="ಈ ಪ್ರಶ್ನೆಯ ಬದಲಾವಣೆ ಉಳಿಸಿ ನೇರವಾಗಿ ಮುಂದಿನ ಪ್ರಶ್ನೆಗೆ ಹೋಗಿ (Alt + →)"
                  >
                    {isNavigatingQuestion ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    ) : null}
                    <span>
                      {isNavigatingQuestion
                        ? 'ಉಳಿಸಲಾಗುತ್ತಿದೆ...'
                        : hasUnsavedChanges
                          ? 'ಉಳಿಸಿ & ಮುಂದಿನ →'
                          : 'ಮುಂದಿನ ಪ್ರಶ್ನೆ →'}
                    </span>
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
