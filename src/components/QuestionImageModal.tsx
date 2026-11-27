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
  Ban,
  Maximize2,
  Plus,
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
  imageUrl2?: string;
  diagramSvg?: string;
  answerImageUrl?: string;
  answerImageUrl2?: string;
  answerDiagramSvg?: string;
  hasDiagram: boolean;
  needsImage?: boolean;
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
  initialSlot?: 'question' | 'question2' | 'answer' | 'answer2';
  onSave: (update: QuestionImageUpdate) => void | Promise<void>;
  onMarkImageNotRequired?: () => void | Promise<void>;
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

type TargetSlot = 'question' | 'question2' | 'answer' | 'answer2';
type InputMode = 'pdf' | 'upload' | 'url';
type PdfViewMode = 'fit-page' | 'fit-width' | 'custom';

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
  onMarkImageNotRequired,
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

  // Current edited values for all 4 slots (Question 1 & 2, Answer 1 & 2 — only short URLs or SVG, NEVER Base64!)
  const [questionImageUrl, setQuestionImageUrl] = useState<string>(question.imageUrl || '');
  const [questionImageUrl2, setQuestionImageUrl2] = useState<string>(question.imageUrl2 || '');
  const [questionDiagramSvg, setQuestionDiagramSvg] = useState<string>(question.diagramSvg || '');
  const [questionDesc, setQuestionDesc] = useState<string>(question.diagramDescription || '');

  const [answerImageUrl, setAnswerImageUrl] = useState<string>(question.answerImageUrl || '');
  const [answerImageUrl2, setAnswerImageUrl2] = useState<string>(question.answerImageUrl2 || '');
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

  // Local PDF state — defaults to 'fit-page' so the ENTIRE full PDF page is visible on open!
  const [localPdfBuffer, setLocalPdfBuffer] = useState<ArrayBuffer | null>(pdfBuffer || null);
  const [localPdfName, setLocalPdfName] = useState<string>(pdfFileName || '');
  const [pdfDoc, setPdfDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [pdfNumPages, setPdfNumPages] = useState<number>(0);
  const [currentPage, setCurrentPage] = useState<number>(
    Math.max(
      1,
      initialSlot === 'answer' || initialSlot === 'answer2' ? initialAnswerPage : initialQuestionPage
    )
  );
  const [pageInputText, setPageInputText] = useState<string>(
    String(
      Math.max(
        1,
        initialSlot === 'answer' || initialSlot === 'answer2' ? initialAnswerPage : initialQuestionPage
      )
    )
  );
  const [pdfViewMode, setPdfViewMode] = useState<PdfViewMode>('fit-page');
  const [zoom, setZoom] = useState<number>(1.0);
  const [stageSize, setStageSize] = useState<{ width: number; height: number }>({ width: 920, height: 680 });
  const [pageBaseSize, setPageBaseSize] = useState<{ width: number; height: number }>({ width: 595, height: 842 });
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
  const [isMarkingNotRequired, setIsMarkingNotRequired] = useState<boolean>(false);
  const [isNavigatingQuestion, setIsNavigatingQuestion] = useState<boolean>(false);
  const [statusNotice, setStatusNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [brokenPreviewSlots, setBrokenPreviewSlots] = useState<Record<string, boolean>>({});

  const isAnswerSlot = (slot: TargetSlot) => slot === 'answer' || slot === 'answer2';

  const slotDisplayLabel = (slot: TargetSlot) => {
    switch (slot) {
      case 'question':
        return 'ಪ್ರಶ್ನೆ ಚಿತ್ರ 1';
      case 'question2':
        return 'ಪ್ರಶ್ನೆ ಚಿತ್ರ 2';
      case 'answer':
        return 'ಉತ್ತರ ಚಿತ್ರ 1';
      case 'answer2':
        return 'ಉತ್ತರ ಚಿತ್ರ 2';
    }
  };

  // Live ResizeObserver on the PDF viewport container so Fit Page / Fit Width always fill the full window cleanly
  useEffect(() => {
    if (!isOpen || inputMode !== 'pdf') return;
    const el = pdfScrollContainerRef.current;
    if (!el) return;

    const updateSize = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 120 && rect.height > 120) {
        setStageSize(prev =>
          Math.abs(prev.width - rect.width) > 4 || Math.abs(prev.height - rect.height) > 4
            ? { width: Math.floor(rect.width), height: Math.floor(rect.height) }
            : prev
        );
      }
    };

    updateSize();
    const ro = new ResizeObserver(updateSize);
    ro.observe(el);
    return () => ro.disconnect();
  }, [isOpen, inputMode, localPdfBuffer, isQuestionBoxExpanded]);

  // Compute exact display scale & pixel dimensions for the PDF page canvas
  const effectiveScale = (() => {
    const baseW = Math.max(100, pageBaseSize.width);
    const baseH = Math.max(100, pageBaseSize.height);
    if (pdfViewMode === 'fit-page') {
      const availW = Math.max(220, stageSize.width - 28);
      const availH = Math.max(220, stageSize.height - 28);
      return Math.max(0.25, Math.min(2.5, Math.min(availW / baseW, availH / baseH)));
    }
    if (pdfViewMode === 'fit-width') {
      const availW = Math.max(220, stageSize.width - 36);
      return Math.max(0.3, Math.min(2.5, availW / baseW));
    }
    return Math.max(0.3, Math.min(3.0, zoom));
  })();

  const displayCanvasWidth = Math.max(140, Math.round(pageBaseSize.width * effectiveScale));
  const displayCanvasHeight = Math.max(140, Math.round(pageBaseSize.height * effectiveScale));

  const handleZoomOut = () => {
    const nextZoom = Math.max(0.3, +(effectiveScale - 0.2).toFixed(2));
    setPdfViewMode('custom');
    setZoom(nextZoom);
  };

  const handleZoomIn = () => {
    const nextZoom = Math.min(3.0, +(effectiveScale + 0.25).toFixed(2));
    setPdfViewMode('custom');
    setZoom(nextZoom);
  };

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
    setQuestionImageUrl2(question.imageUrl2 || '');
    setQuestionDiagramSvg(question.diagramSvg || '');
    setQuestionDesc(question.diagramDescription || '');
    setAnswerImageUrl(question.answerImageUrl || '');
    setAnswerImageUrl2(question.answerImageUrl2 || '');
    setAnswerDiagramSvg(question.answerDiagramSvg || '');
    setAnswerDesc(question.answerDiagramDescription || '');
    setActiveSlot(initialSlot);
    setStatusNotice(null);
    setCropRect(null);
    setPendingCanvas(null);
    setPendingPreview(null);
    setBrokenPreviewSlots({});
    // Always open in full-page fit mode so large images & full PDF page are visible immediately
    setPdfViewMode('fit-page');

    const exactSavedPg =
      initialSlot === 'answer' || initialSlot === 'answer2'
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
    } else if (activeSlot === 'question2') {
      setManualUrlInput(questionImageUrl2);
      setManualSvgInput('');
    } else if (activeSlot === 'answer') {
      setManualUrlInput(answerImageUrl);
      setManualSvgInput(answerDiagramSvg);
    } else {
      setManualUrlInput(answerImageUrl2);
      setManualSvgInput('');
    }
  }, [
    activeSlot,
    questionImageUrl,
    questionImageUrl2,
    questionDiagramSvg,
    answerImageUrl,
    answerImageUrl2,
    answerDiagramSvg,
  ]);

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

      const isAns = slot === 'answer' || slot === 'answer2';
      const rangeStr = isAns ? chapterAnswerPages : chapterQuestionPages;
      const primaryPages: number[] = [];
      if (rangeStr) {
        const zeroBased = parsePageRangeString(rangeStr, total);
        zeroBased.forEach(idx => primaryPages.push(idx + 1));
      }

      const storedPageRaw = isAns ? question.answerPage : question.sourcePage;
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
        isAns && question.answer && question.answer.length > 6
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
              : isAns
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

  // Render active PDF page onto canvas at crisp 2.0x bitmap resolution (no re-render flicker on zoom!)
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

        // Capture intrinsic 1.0x page dimensions so Fit Page / Fit Width / Zoom compute exact CSS display size
        const baseViewport = page.getViewport({ scale: 1.0 });
        setPageBaseSize({
          width: Math.max(100, Math.round(baseViewport.width)),
          height: Math.max(100, Math.round(baseViewport.height)),
        });

        // Render high-resolution internal bitmap (2.0x) so cropped diagrams stay razor-sharp even in Fit Page mode
        const renderScale = 2.0;
        const viewport = page.getViewport({ scale: renderScale });
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
  }, [isOpen, inputMode, pdfDoc, currentPage]);

  // Apply exact display width & height to the PDF canvas whenever Fit Page / Fit Width / Zoom changes (instant, 0ms lag!)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.style.width = `${displayCanvasWidth}px`;
    canvas.style.height = `${displayCanvasHeight}px`;
  }, [displayCanvasWidth, displayCanvasHeight, isOpen, inputMode, pdfDoc, currentPage]);

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
        const previousUrl =
          slot === 'question'
            ? questionImageUrl
            : slot === 'question2'
              ? questionImageUrl2
              : slot === 'answer'
                ? answerImageUrl
                : answerImageUrl2;
        const previousId = extractImageIdFromUrl(previousUrl);
        const firebaseRole: 'question' | 'answer' = isAnswerSlot(slot) ? 'answer' : 'question';
        const firebaseQuestionId =
          slot === 'question2' || slot === 'answer2'
            ? `${question.id || 'q1'}_2`
            : question.id || 'q1';

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
          questionId: firebaseQuestionId,
          role: firebaseRole,
        });

        // 2. Prime server disk cache so `/api/question-image/{imageId}` serves instantly everywhere
        fetch('/api/upload-question-image', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            imageId: saved.imageId,
            imageBase64: preview.dataUrl,
            gradeKey,
            subjectCode,
            chapterId: question.chapterId || `ch${question.chapterNumber || 1}`,
            questionId: firebaseQuestionId,
            role: firebaseRole,
          }),
        }).catch(err => console.warn('Local cache warm skipped:', err));

        // 3. Keep immediate local preview so user sees the cropped image with zero latency
        setLocalPreviewMap(prev => ({ ...prev, [saved.imageUrl]: preview.dataUrl }));
        setSlotMetaKB(prev => ({ ...prev, [saved.imageUrl]: saved.sizeKB }));

        if (slot === 'question') {
          setQuestionImageUrl(saved.imageUrl);
          setQuestionDiagramSvg('');
          setBrokenPreviewSlots(prev => ({ ...prev, question: false }));
        } else if (slot === 'question2') {
          setQuestionImageUrl2(saved.imageUrl);
          setBrokenPreviewSlots(prev => ({ ...prev, question2: false }));
        } else if (slot === 'answer') {
          setAnswerImageUrl(saved.imageUrl);
          setAnswerDiagramSvg('');
          setBrokenPreviewSlots(prev => ({ ...prev, answer: false }));
        } else {
          setAnswerImageUrl2(saved.imageUrl);
          setBrokenPreviewSlots(prev => ({ ...prev, answer2: false }));
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
          text: `${slotDisplayLabel(slot)} Firebase ಗೆ ಉಳಿಸಲಾಗಿದೆ (${saved.sizeKB} KB) — JSON ನಲ್ಲಿ URL ಮಾತ್ರ ಸೇರುತ್ತದೆ.`,
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
      answerImageUrl2,
      gradeKey,
      question.chapterId,
      question.chapterNumber,
      question.id,
      questionImageUrl,
      questionImageUrl2,
      subjectCode,
    ]
  );

  // Delete an image from any of the 4 slots + Firebase + server cache
  const handleDeleteSlotImage = async (slot: TargetSlot) => {
    setIsDeletingSlot(slot);
    setStatusNotice(null);
    try {
      const currentUrl =
        slot === 'question'
          ? questionImageUrl
          : slot === 'question2'
            ? questionImageUrl2
            : slot === 'answer'
              ? answerImageUrl
              : answerImageUrl2;
      const imageId = extractImageIdFromUrl(currentUrl);
      if (imageId) {
        await deleteQuestionImageFromFirebase(imageId);
        fetch(`/api/question-image/${imageId}`, { method: 'DELETE' }).catch(() => {});
      }

      if (slot === 'question') {
        setQuestionImageUrl('');
        setQuestionDiagramSvg('');
        setBrokenPreviewSlots(prev => ({ ...prev, question: false }));
      } else if (slot === 'question2') {
        setQuestionImageUrl2('');
        setBrokenPreviewSlots(prev => ({ ...prev, question2: false }));
      } else if (slot === 'answer') {
        setAnswerImageUrl('');
        setAnswerDiagramSvg('');
        setBrokenPreviewSlots(prev => ({ ...prev, answer: false }));
      } else {
        setAnswerImageUrl2('');
        setBrokenPreviewSlots(prev => ({ ...prev, answer2: false }));
      }

      setStatusNotice({
        type: 'success',
        text: `${slotDisplayLabel(slot)} ಡಿಲೀಟ್ ಮಾಡಲಾಗಿದೆ (Firebase ನಿಂದಲೂ ತೆರವುಗೊಂಡಿದೆ).`,
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

  // Start replacing or adding an image for any of the 4 slots
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
      text: `${slotDisplayLabel(slot)} ಕ್ರಾಪ್ ಮಾಡಲು ಎಡಭಾಗದ PDF ಪುಟದಲ್ಲಿ ಮೌಸ್ ಎಳೆಯಿರಿ ಅಥವಾ ಚಿತ್ರ ಅಪ್‌ಲೋಡ್ ಮಾಡಿ.`,
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
      setPdfViewMode('fit-page');

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
      setPdfViewMode('fit-page');
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
    } else if (activeSlot === 'question2') {
      setQuestionImageUrl2(cleanUrl);
      setBrokenPreviewSlots(prev => ({ ...prev, question2: false }));
    } else if (activeSlot === 'answer') {
      setAnswerImageUrl(cleanUrl);
      setAnswerDiagramSvg(cleanUrl ? '' : cleanSvg);
      setBrokenPreviewSlots(prev => ({ ...prev, answer: false }));
    } else {
      setAnswerImageUrl2(cleanUrl);
      setBrokenPreviewSlots(prev => ({ ...prev, answer2: false }));
    }

    setStatusNotice({
      type: 'success',
      text: `${slotDisplayLabel(activeSlot)} ನವೀಕರಿಸಲಾಗಿದೆ.`,
    });
  };

  const hasUnsavedChanges =
    Boolean(pendingPreview) ||
    questionImageUrl.trim() !== (question.imageUrl || '').trim() ||
    questionImageUrl2.trim() !== (question.imageUrl2 || '').trim() ||
    questionDiagramSvg.trim() !== (question.diagramSvg || '').trim() ||
    answerImageUrl.trim() !== (question.answerImageUrl || '').trim() ||
    answerImageUrl2.trim() !== (question.answerImageUrl2 || '').trim() ||
    answerDiagramSvg.trim() !== (question.answerDiagramSvg || '').trim() ||
    questionDesc.trim() !== (question.diagramDescription || '').trim() ||
    answerDesc.trim() !== (question.answerDiagramDescription || '').trim();

  // Shared commit routine (uploads any staged pending crop to Firebase & calls onSave)
  const commitCurrentChanges = useCallback(async (): Promise<boolean> => {
    let finalQuestionUrl = questionImageUrl.trim();
    let finalQuestionUrl2 = questionImageUrl2.trim();
    let finalQuestionSvg = questionDiagramSvg.trim();
    let finalAnswerUrl = answerImageUrl.trim();
    let finalAnswerUrl2 = answerImageUrl2.trim();
    let finalAnswerSvg = answerDiagramSvg.trim();

    if (pendingPreview) {
      const firebaseRole: 'question' | 'answer' = isAnswerSlot(activeSlot) ? 'answer' : 'question';
      const firebaseQuestionId =
        activeSlot === 'question2' || activeSlot === 'answer2'
          ? `${question.id || 'q1'}_2`
          : question.id || 'q1';

      const saved = await saveQuestionImageToFirebase({
        dataUrl: pendingPreview.dataUrl,
        mimeType: pendingPreview.mimeType,
        sizeKB: pendingPreview.sizeKB,
        width: pendingPreview.width,
        height: pendingPreview.height,
        gradeKey,
        subjectCode,
        chapterId: question.chapterId || `ch${question.chapterNumber || 1}`,
        questionId: firebaseQuestionId,
        role: firebaseRole,
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
          questionId: firebaseQuestionId,
          role: firebaseRole,
        }),
      }).catch(() => {});

      setLocalPreviewMap(prev => ({ ...prev, [saved.imageUrl]: pendingPreview.dataUrl }));
      setSlotMetaKB(prev => ({ ...prev, [saved.imageUrl]: saved.sizeKB }));

      if (activeSlot === 'question') {
        finalQuestionUrl = saved.imageUrl;
        finalQuestionSvg = '';
      } else if (activeSlot === 'question2') {
        finalQuestionUrl2 = saved.imageUrl;
      } else if (activeSlot === 'answer') {
        finalAnswerUrl = saved.imageUrl;
        finalAnswerSvg = '';
      } else {
        finalAnswerUrl2 = saved.imageUrl;
      }
    }

    const hasAnyDiagram = Boolean(
      finalQuestionUrl ||
        finalQuestionUrl2 ||
        finalQuestionSvg ||
        finalAnswerUrl ||
        finalAnswerUrl2 ||
        finalAnswerSvg
    );

    await onSave({
      imageUrl: finalQuestionUrl || undefined,
      imageUrl2: finalQuestionUrl2 || undefined,
      diagramSvg: finalQuestionSvg || undefined,
      answerImageUrl: finalAnswerUrl || undefined,
      answerImageUrl2: finalAnswerUrl2 || undefined,
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
    answerImageUrl2,
    gradeKey,
    onSave,
    pendingPreview,
    question.chapterId,
    question.chapterNumber,
    question.id,
    questionDesc,
    questionDiagramSvg,
    questionImageUrl,
    questionImageUrl2,
    subjectCode,
  ]);

  // Mark this question as "Image Not Required" right from inside the modal!
  const handleMarkImageNotRequired = async () => {
    if (isSavingFinal || isUploading || isNavigatingQuestion || isMarkingNotRequired) return;
    setIsMarkingNotRequired(true);
    setStatusNotice(null);
    try {
      // Remove any attached images for this question from Firebase & cache in background
      const urlsToClean = [questionImageUrl, questionImageUrl2, answerImageUrl, answerImageUrl2];
      for (const u of urlsToClean) {
        const imgId = extractImageIdFromUrl(u);
        if (imgId) {
          deleteQuestionImageFromFirebase(imgId).catch(() => {});
          fetch(`/api/question-image/${imgId}`, { method: 'DELETE' }).catch(() => {});
        }
      }

      setQuestionImageUrl('');
      setQuestionImageUrl2('');
      setQuestionDiagramSvg('');
      setAnswerImageUrl('');
      setAnswerImageUrl2('');
      setAnswerDiagramSvg('');
      setPendingCanvas(null);
      setPendingPreview(null);
      setCropRect(null);

      if (onMarkImageNotRequired) {
        await onMarkImageNotRequired();
      } else {
        await onSave({
          imageUrl: undefined,
          imageUrl2: undefined,
          diagramSvg: undefined,
          answerImageUrl: undefined,
          answerImageUrl2: undefined,
          answerDiagramSvg: undefined,
          hasDiagram: false,
          needsImage: false,
          diagramDescription: undefined,
          answerDiagramDescription: undefined,
        });
      }

      if (hasNextQuestion && onNavigateNext) {
        onNavigateNext();
      } else {
        onClose();
      }
    } catch (err: any) {
      setStatusNotice({
        type: 'error',
        text: err?.message || '"ಚಿತ್ರ ಅಗತ್ಯವಿಲ್ಲ" ಎಂದು ಗುರುತಿಸಲು ಸಾಧ್ಯವಾಗಲಿಲ್ಲ.',
      });
    } finally {
      setIsMarkingNotRequired(false);
    }
  };

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
  const handleMoveQuestion = useCallback(
    async (direction: 'prev' | 'next', forceCommit: boolean = false) => {
      if (isSavingFinal || isUploading || isNavigatingQuestion || isMarkingNotRequired) return;
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
      isMarkingNotRequired,
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

  // Calculate percentage overlay box for crop rectangle on top of scaled canvas
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
  const resolvedQuestionSrc2 = localPreviewMap[questionImageUrl2] || questionImageUrl2;
  const resolvedAnswerSrc = localPreviewMap[answerImageUrl] || answerImageUrl;
  const resolvedAnswerSrc2 = localPreviewMap[answerImageUrl2] || answerImageUrl2;

  const busyAction = isSavingFinal || isUploading || isNavigatingQuestion || isMarkingNotRequired;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-1 sm:p-2 bg-slate-900/70 backdrop-blur-xs font-kannada"
      role="dialog"
      aria-modal="true"
      aria-label="ಚಿತ್ರ ಜೋಡಣೆ ಮತ್ತು PDF ಕ್ರಾಪ್ ಸ್ಟುಡಿಯೋ"
    >
      <div className="bg-white rounded-xl border border-slate-200 shadow-2xl w-[99vw] max-w-[1840px] h-[97vh] flex flex-col overflow-hidden">
        {/* Top Modal Header */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2 border-b border-slate-200 bg-slate-50/95 shrink-0">
          <div className="min-w-0 flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
              <ImageIcon className="w-4 h-4 text-indigo-600 shrink-0" />
              <span>ಚಿತ್ರ ಕ್ರಾಪ್ ಸ್ಟುಡಿಯೋ</span>
            </h3>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-indigo-600 text-white text-xs font-extrabold tabular-nums shadow-2xs">
              #{question.printedSerial || question.questionNumber || questionIndex || 1}
              {totalChapterQuestions ? ` / ${totalChapterQuestions}` : ''}
            </span>
            {questionIndex &&
              (question.printedSerial || question.questionNumber) &&
              String(question.printedSerial || question.questionNumber) !== String(questionIndex) && (
                <span className="inline-flex items-center px-1.5 py-0.5 rounded-md bg-slate-200 text-slate-800 text-2xs font-bold tabular-nums">
                  ಕ್ರಮ: #{questionIndex}
                </span>
              )}
            <span className="text-2xs font-semibold text-slate-600 truncate max-w-[200px]">
              {question.chapterName} · {question.marks} ಅಂಕ
            </span>
          </div>

          <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
            {/* Image Not Required Button right in Header */}
            <button
              type="button"
              disabled={busyAction}
              onClick={handleMarkImageNotRequired}
              className="px-2.5 py-1.5 rounded-lg border border-rose-300 bg-rose-50 hover:bg-rose-100 text-rose-700 text-2xs font-bold flex items-center gap-1 cursor-pointer whitespace-nowrap disabled:opacity-45 transition-colors"
              title="ಈ ಪ್ರಶ್ನೆಗೆ ಯಾವುದೇ ಚಿತ್ರ ಅಗತ್ಯವಿಲ್ಲ ಎಂದು ಗುರುತಿಸಿ"
            >
              {isMarkingNotRequired ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Ban className="w-3.5 h-3.5" />
              )}
              <span>ಚಿತ್ರ ಅಗತ್ಯವಿಲ್ಲ (No Image)</span>
            </button>

            {/* In-Modal Previous / Next Question Navigator */}
            {(onNavigatePrev || onNavigateNext) && (
              <div
                className="flex items-center gap-0.5 bg-white border border-slate-300 rounded-lg p-0.5 shadow-2xs"
                title={navQueueLabel ? `${navQueueLabel} (Alt+← / Alt+→)` : 'ಪ್ರಶ್ನೆ ಬದಲಿಸಿ (Alt+← / Alt+→)'}
              >
                <button
                  type="button"
                  disabled={!hasPrevQuestion || busyAction}
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
                  disabled={!hasNextQuestion || busyAction}
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
              className="px-2 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-2xs font-bold text-slate-700 cursor-pointer whitespace-nowrap"
            >
              {isQuestionBoxExpanded ? 'ಪ್ರಶ್ನೆ ಮರೆಮಾಡಿ ▲' : 'ಪ್ರಶ್ನೆ ತೋರಿಸಿ ▼'}
            </button>

            {/* 4-Slot Target Switcher (Question 1, Question 2, Answer 1, Answer 2) */}
            <div className="flex items-center gap-0.5 p-0.5 bg-slate-200/80 rounded-lg text-2xs">
              <button
                type="button"
                onClick={() => handleSwitchSlot('question')}
                className={`px-2 py-1.5 rounded-md font-bold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  activeSlot === 'question'
                    ? 'bg-white text-indigo-700 shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                ಪ್ರಶ್ನೆ 1 {questionImageUrl || questionDiagramSvg ? '✓' : ''}
              </button>
              <button
                type="button"
                onClick={() => handleSwitchSlot('question2')}
                className={`px-2 py-1.5 rounded-md font-bold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  activeSlot === 'question2'
                    ? 'bg-white text-indigo-700 shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
                title="ಪ್ರಶ್ನೆಗೆ 2ನೇ ಚಿತ್ರ (ಪಕ್ಕಪಕ್ಕದಲ್ಲಿ ಕಾಣಿಸುತ್ತದೆ)"
              >
                ಪ್ರಶ್ನೆ 2 {questionImageUrl2 ? '✓' : '+'}
              </button>
              <button
                type="button"
                onClick={() => handleSwitchSlot('answer')}
                className={`px-2 py-1.5 rounded-md font-bold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  activeSlot === 'answer'
                    ? 'bg-white text-emerald-700 shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                ಉತ್ತರ 1 {answerImageUrl || answerDiagramSvg ? '✓' : ''}
              </button>
              <button
                type="button"
                onClick={() => handleSwitchSlot('answer2')}
                className={`px-2 py-1.5 rounded-md font-bold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  activeSlot === 'answer2'
                    ? 'bg-white text-emerald-700 shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
                title="ಉತ್ತರಕ್ಕೆ 2ನೇ ಚಿತ್ರ (ಪಕ್ಕಪಕ್ಕದಲ್ಲಿ ಕಾಣಿಸುತ್ತದೆ)"
              >
                ಉತ್ತರ 2 {answerImageUrl2 ? '✓' : '+'}
              </button>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-slate-500 hover:text-slate-900 hover:bg-slate-200/70 rounded-lg transition-colors cursor-pointer"
              aria-label="ಮುಚ್ಚಿ"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Compact Collapsible Question & Serial Number Banner (maximizes PDF viewport height) */}
        {isQuestionBoxExpanded && (
          <div className="px-4 py-1.5 bg-indigo-50/75 border-b border-indigo-200/80 shrink-0 max-h-24 overflow-y-auto">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="flex-1 min-w-0 space-y-1">
                <div className="text-xs font-bold text-slate-900 whitespace-pre-line leading-snug">
                  <span className="text-indigo-700 font-extrabold mr-1.5">
                    {question.printedSerial || question.questionNumber || questionIndex || 1}.
                  </span>
                  <MathText text={question.question} />
                </div>

                {Array.isArray(question.options) && question.options.length > 0 && (
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-2xs font-medium text-slate-700">
                    {question.options.map((opt, idx) => (
                      <span key={idx} className="bg-white/85 px-1.5 py-0.5 rounded border border-indigo-100">
                        <MathText text={opt} />
                      </span>
                    ))}
                  </div>
                )}

                {isAnswerSlot(activeSlot) && question.answer && (
                  <div className="text-2xs text-emerald-900 bg-emerald-50 border border-emerald-200 rounded-md px-2 py-0.5 whitespace-pre-line">
                    <span className="font-bold mr-1">ಉತ್ತರ:</span>
                    <MathText text={question.answer} />
                  </div>
                )}
              </div>

              {(question.diagramDescription || question.answerDiagramDescription) && (
                <div className="text-2xs text-amber-900 bg-amber-50 border border-amber-200 rounded-md px-2 py-0.5 max-w-xs shrink-0">
                  <span className="font-bold mr-1">ಸುಳಿವು:</span>
                  <span>
                    {isAnswerSlot(activeSlot)
                      ? question.answerDiagramDescription || question.diagramDescription
                      : question.diagramDescription}
                  </span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Two-Zone Studio Workspace: Extra-Wide Left PDF Cropper + Right Preview & Dual Slots */}
        <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12 overflow-hidden">
          {/* LEFT ZONE (~75% on desktop): Full-Page Interactive PDF Cropper / File Uploader / URL-SVG */}
          <div className="lg:col-span-8 xl:col-span-9 flex flex-col min-h-0 border-b lg:border-b-0 lg:border-r border-slate-200 bg-slate-50/40">
            {/* Input Mode Tabs & Print Filter Bar */}
            <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-1.5 border-b border-slate-200 bg-white shrink-0">
              <div className="flex items-center gap-1 p-0.5 bg-slate-100 rounded-lg text-xs">
                <button
                  type="button"
                  onClick={() => setInputMode('pdf')}
                  className={`px-2.5 py-1 rounded-md font-semibold transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer ${
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
                  className={`px-2.5 py-1 rounded-md font-semibold transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer ${
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
                  className={`px-2.5 py-1 rounded-md font-semibold transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer ${
                    inputMode === 'url'
                      ? 'bg-white text-slate-900 shadow-2xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <Link2 className="w-3.5 h-3.5 text-slate-600" />
                  <span>URL / SVG</span>
                </button>
              </div>

              <div className="flex items-center gap-3 flex-wrap">
                <span className="text-2xs font-bold px-2 py-0.5 rounded bg-indigo-50 text-indigo-800 border border-indigo-200 whitespace-nowrap">
                  ಕ್ರಾಪ್ ಗುರಿ: {slotDisplayLabel(activeSlot)}
                </span>

                {/* High-Contrast B&W Print Filter Toggle */}
                {inputMode !== 'url' && (
                  <label className="flex items-center gap-1.5 text-xs font-medium text-slate-700 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={highContrastBW}
                      onChange={e => setHighContrastBW(e.target.checked)}
                      className="w-3.5 h-3.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    <Contrast className="w-3.5 h-3.5 text-slate-600" />
                    <span className="whitespace-nowrap">B&amp;W Print</span>
                  </label>
                )}
              </div>
            </div>

            {/* Status / Error Banner inside Stage */}
            {statusNotice && (
              <div
                className={`mx-3.5 mt-2 px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-2 shrink-0 border ${
                  statusNotice.type === 'success'
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                    : 'bg-rose-50 border-rose-200 text-rose-900'
                }`}
              >
                {statusNotice.type === 'success' ? (
                  <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                ) : (
                  <AlertTriangle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                )}
                <span className="flex-1">{statusNotice.text}</span>
              </div>
            )}

            {/* MODE 1: FULL-PAGE PDF CROPPER */}
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
                    {/* PDF Navigation, Fit Page / Fit Width & Working Zoom Toolbar */}
                    <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-1.5 bg-slate-100/90 border-b border-slate-200 text-xs shrink-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
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
                        <div className="flex items-center gap-1 bg-white border border-slate-300 rounded-md px-2 py-0.5">
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
                            className="w-9 text-center font-mono font-bold text-slate-900 tabular-nums focus:outline-hidden"
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

                        {/* Working Zoom In / Zoom Out + Fit Full Page / Fit Width */}
                        <div className="flex items-center gap-1 ml-1 border-l border-slate-300 pl-1.5">
                          <button
                            type="button"
                            onClick={handleZoomOut}
                            disabled={effectiveScale <= 0.32}
                            className="p-1.5 bg-white border border-slate-300 rounded-md hover:bg-slate-50 disabled:opacity-40 cursor-pointer"
                            title="Zoom Out (ಚಿಕ್ಕದು ಮಾಡಿ)"
                          >
                            <ZoomOut className="w-3.5 h-3.5 text-slate-800" />
                          </button>
                          <span className="text-2xs font-mono font-bold text-slate-800 w-11 text-center tabular-nums">
                            {Math.round(effectiveScale * 100)}%
                          </span>
                          <button
                            type="button"
                            onClick={handleZoomIn}
                            disabled={effectiveScale >= 2.95}
                            className="p-1.5 bg-white border border-slate-300 rounded-md hover:bg-slate-50 disabled:opacity-40 cursor-pointer"
                            title="Zoom In (ದೊಡ್ಡದು ಮಾಡಿ)"
                          >
                            <ZoomIn className="w-3.5 h-3.5 text-slate-800" />
                          </button>

                          <button
                            type="button"
                            onClick={() => setPdfViewMode('fit-page')}
                            className={`px-2 py-1 rounded-md text-2xs font-bold border flex items-center gap-1 cursor-pointer whitespace-nowrap transition-colors ${
                              pdfViewMode === 'fit-page'
                                ? 'bg-indigo-600 text-white border-indigo-600'
                                : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                            }`}
                            title="ಪೂರ್ಣ PDF ಪುಟವನ್ನು ಪರದೆಗೆ ಹೊಂದಿಸಿ (Fit Full Page)"
                          >
                            <Maximize2 className="w-3 h-3" />
                            <span>ಪೂರ್ಣ ಪುಟ</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => setPdfViewMode('fit-width')}
                            className={`px-2 py-1 rounded-md text-2xs font-bold border cursor-pointer whitespace-nowrap transition-colors ${
                              pdfViewMode === 'fit-width'
                                ? 'bg-indigo-600 text-white border-indigo-600'
                                : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                            }`}
                            title="ಪುಟದ ಅಗಲಕ್ಕೆ ಹೊಂದಿಸಿ (Fit Width)"
                          >
                            ಅಗಲ
                          </button>
                        </div>

                        {/* Auto-Find Exact Question Page Button & Indicator */}
                        <button
                          type="button"
                          disabled={isAutoFindingPage || !pdfDoc}
                          onClick={() => pdfDoc && locateExactPageInPdf(pdfDoc, activeSlot, true)}
                          className="ml-0.5 px-2 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 rounded-md text-2xs font-bold flex items-center gap-1 cursor-pointer whitespace-nowrap disabled:opacity-50"
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
                          <span className="px-1.5 py-0.5 rounded bg-emerald-50 border border-emerald-200 text-emerald-800 text-3xs font-bold whitespace-nowrap">
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
                            className="bg-white border border-slate-300 rounded-md px-2 py-1 text-2xs font-semibold text-slate-700 max-w-[130px] truncate cursor-pointer"
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

                        <label className="text-2xs font-semibold text-indigo-700 hover:underline cursor-pointer whitespace-nowrap">
                          ಹೊಸ PDF
                          <input
                            type="file"
                            accept=".pdf,application/pdf"
                            onChange={handlePickPdf}
                            className="hidden"
                          />
                        </label>
                      </div>

                      <div className="flex items-center gap-1.5">
                        {cropRect && cropRect.w > 10 && cropRect.h > 10 && (
                          <button
                            type="button"
                            onClick={() => {
                              setCropRect(null);
                              setPendingCanvas(null);
                              setPendingPreview(null);
                            }}
                            className="px-2 py-1 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-md text-2xs font-semibold cursor-pointer whitespace-nowrap"
                          >
                            ಆಯ್ಕೆ ತೆರವು
                          </button>
                        )}
                        {pendingPreview && (
                          <button
                            type="button"
                            disabled={isUploading}
                            onClick={() => saveCompressedPreviewToFirebase(pendingPreview, activeSlot)}
                            className="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-45 text-white rounded-md text-2xs font-bold transition-colors flex items-center gap-1 cursor-pointer whitespace-nowrap"
                          >
                            {isUploading ? (
                              <RefreshCw className="w-3 h-3 animate-spin" />
                            ) : (
                              <Cloud className="w-3 h-3" />
                            )}
                            <span>
                              {isUploading
                                ? 'ಉಳಿಸಲಾಗುತ್ತಿದೆ...'
                                : `${slotDisplayLabel(activeSlot)} ಉಳಿಸಿ (${pendingPreview.sizeKB} KB)`}
                            </span>
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Interactive Full-Page PDF Canvas Stage (zero max-w-full clamping — Zoom & Fit Page work cleanly!) */}
                    <div
                      ref={pdfScrollContainerRef}
                      className="flex-1 min-h-0 overflow-auto p-2 bg-slate-200/80 flex"
                    >
                      <div className="relative m-auto shrink-0 shadow-md border border-slate-300 bg-white select-none">
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
                          className="block cursor-crosshair touch-none"
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
                      {slotDisplayLabel(activeSlot)} ಅಪ್‌ಲೋಡ್ ಮಾಡಿ
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
                      ಚಿತ್ರದ URL ({slotDisplayLabel(activeSlot)})
                    </label>
                    <input
                      type="text"
                      value={manualUrlInput}
                      onChange={e => setManualUrlInput(e.target.value)}
                      placeholder="/api/question-image/img_... ಅಥವಾ https://..."
                      className="w-full px-3 py-2 text-xs font-mono bg-slate-50 border border-slate-300 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>

                  {(activeSlot === 'question' || activeSlot === 'answer') && (
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
                  )}

                  <button
                    type="button"
                    onClick={handleApplyManualUrlOrSvg}
                    className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-lg transition-colors cursor-pointer whitespace-nowrap"
                  >
                    ಅನ್ವಯಿಸಿ ({slotDisplayLabel(activeSlot)})
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* RIGHT ZONE (~25-33%): Live Cropped Preview + KB Optimizer + Dual Question & Dual Answer Side-by-Side Slots */}
          <div className="lg:col-span-4 xl:col-span-3 flex flex-col min-h-0 bg-white">
            <div className="flex-1 overflow-y-auto p-3 space-y-3">
              {/* LIVE CROPPED / STAGED PREVIEW & KB SIZE CONTROL */}
              <div
                className={`rounded-xl border-2 p-3 space-y-2.5 transition-colors ${
                  pendingPreview
                    ? 'border-indigo-500 bg-indigo-50/40'
                    : 'border-slate-200 bg-slate-50/70'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-slate-900">
                    <SlidersHorizontal className="w-3.5 h-3.5 text-indigo-600" />
                    <span>ಕ್ರಾಪ್ ಪ್ರಿವ್ಯೂ &amp; KB</span>
                  </div>
                  <span className="text-2xs font-mono font-bold text-indigo-700 tabular-nums">
                    ಗುರಿ: {targetSizeKB} KB
                  </span>
                </div>

                {/* Preset KB Buttons */}
                <div className="flex flex-wrap items-center gap-1">
                  {SIZE_PRESETS_KB.map(kb => (
                    <button
                      key={kb}
                      type="button"
                      onClick={() => setTargetSizeKB(kb)}
                      className={`px-2 py-0.5 rounded-md text-2xs font-bold tabular-nums transition-colors cursor-pointer border whitespace-nowrap ${
                        targetSizeKB === kb
                          ? 'bg-indigo-600 text-white border-indigo-600'
                          : 'bg-white text-slate-700 border-slate-300 hover:border-indigo-400'
                      }`}
                    >
                      {kb} KB
                    </button>
                  ))}
                </div>

                {/* Continuous KB Slider */}
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

                {/* Instant Cropped Image Live Preview */}
                {pendingPreview ? (
                  <div className="space-y-2 pt-2 border-t border-indigo-200/70">
                    <div className="flex items-center justify-between text-2xs">
                      <span className="font-bold text-indigo-900">
                        {slotDisplayLabel(activeSlot)}:
                      </span>
                      <span className="font-mono font-bold text-emerald-700 tabular-nums">
                        {pendingPreview.sizeKB} KB · {pendingPreview.width}×{pendingPreview.height}
                      </span>
                    </div>

                    <div className="rounded-lg border border-indigo-300 bg-white p-1.5 flex items-center justify-center min-h-24 max-h-40 overflow-hidden">
                      <img
                        src={pendingPreview.dataUrl}
                        alt="ಕ್ರಾಪ್ ಮಾಡಿದ ಚಿತ್ರದ ಪ್ರಿವ್ಯೂ"
                        className="max-h-36 max-w-full object-contain"
                      />
                    </div>

                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        disabled={isUploading}
                        onClick={() => saveCompressedPreviewToFirebase(pendingPreview, activeSlot)}
                        className="flex-1 py-1.5 px-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-lg text-2xs font-bold transition-colors flex items-center justify-center gap-1 cursor-pointer whitespace-nowrap"
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
                        className="py-1.5 px-2 bg-white hover:bg-rose-50 text-rose-700 border border-rose-300 rounded-lg text-2xs font-bold transition-colors cursor-pointer whitespace-nowrap"
                      >
                        ರದ್ದು
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="text-2xs text-slate-500 leading-snug border-t border-slate-200/80 pt-1.5">
                    ಎಡಭಾಗದ ಪೂರ್ಣ PDF ಪುಟದಲ್ಲಿ ಚಿತ್ರದ ಮೇಲೆ ಮೌಸ್ ಎಳೆದು (Drag) ಕ್ರಾಪ್ ಮಾಡಿ — <strong className="text-slate-700">{slotDisplayLabel(activeSlot)}</strong> ಗೆ ಸೇರುತ್ತದೆ.
                  </p>
                )}
              </div>

              {/* SECTION 1: Question Paper Images (1 & 2 Side-by-Side) */}
              <div
                className={`rounded-xl border p-2.5 space-y-2 transition-colors ${
                  activeSlot === 'question' || activeSlot === 'question2'
                    ? 'border-indigo-400 bg-indigo-50/20'
                    : 'border-slate-200 bg-slate-50/40'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold text-slate-900">
                    ೧. ಪ್ರಶ್ನೆ ಚಿತ್ರಗಳು (ಪಕ್ಕಪಕ್ಕದಲ್ಲಿ)
                  </span>
                  <button
                    type="button"
                    onClick={() => handleReplaceSlotImage('question2')}
                    className={`px-2 py-0.5 rounded-md text-3xs font-bold border flex items-center gap-0.5 cursor-pointer whitespace-nowrap transition-colors ${
                      activeSlot === 'question2'
                        ? 'bg-indigo-600 text-white border-indigo-600'
                        : 'bg-white text-indigo-700 border-indigo-300 hover:bg-indigo-50'
                    }`}
                    title="ಪ್ರಶ್ನೆಗೆ 2ನೇ ಗ್ರಾಫ್ / ಚಿತ್ರ ಕ್ರಾಪ್ ಮಾಡಿ (ಪಕ್ಕಪಕ್ಕದಲ್ಲಿ ಫಿಟ್ ಆಗುತ್ತದೆ)"
                  >
                    <Plus className="w-3 h-3" />
                    <span>{questionImageUrl2 ? '2ನೇ ಚಿತ್ರ ಬದಲಿಸಿ' : '2ನೇ ಚಿತ್ರ ಕ್ರಾಪ್'}</span>
                  </button>
                </div>

                {/* Dual Side-by-Side Grid for Question Image 1 & Question Image 2 */}
                <div className="grid grid-cols-2 gap-2">
                  {/* Question Image 1 */}
                  <div
                    className={`rounded-lg border p-1.5 space-y-1.5 bg-white ${
                      activeSlot === 'question' ? 'border-indigo-500 ring-1 ring-indigo-300' : 'border-slate-200'
                    }`}
                  >
                    <div className="flex items-center justify-between text-3xs font-bold text-slate-700">
                      <button
                        type="button"
                        onClick={() => handleSwitchSlot('question')}
                        className="hover:text-indigo-700 cursor-pointer"
                      >
                        ಚಿತ್ರ 1
                      </button>
                      {questionImageUrl && slotMetaKB[questionImageUrl] && (
                        <span className="font-mono text-emerald-700">{slotMetaKB[questionImageUrl]}KB</span>
                      )}
                    </div>

                    {questionImageUrl ? (
                      <>
                        {brokenPreviewSlots.question ? (
                          <div className="h-20 rounded border border-slate-200 bg-slate-100 flex items-center justify-center text-3xs text-slate-500 text-center p-1">
                            ಲೋಡ್ ಆಗಲಿಲ್ಲ
                          </div>
                        ) : (
                          <div className="h-24 rounded border border-slate-100 bg-slate-50/50 p-1 flex items-center justify-center">
                            <img
                              src={resolvedQuestionSrc}
                              alt={questionDesc || 'ಪ್ರಶ್ನೆ ಚಿತ್ರ 1'}
                              referrerPolicy="no-referrer"
                              onError={() => handlePreviewImageError('question', questionImageUrl)}
                              className="max-h-full max-w-full object-contain"
                            />
                          </div>
                        )}
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => handleReplaceSlotImage('question')}
                            className="flex-1 py-1 bg-white hover:bg-indigo-50 text-indigo-700 border border-indigo-200 rounded text-3xs font-bold flex items-center justify-center gap-0.5 cursor-pointer"
                            title="ಚಿತ್ರ 1 ಬದಲಿಸಿ"
                          >
                            <Replace className="w-3 h-3" />
                            <span>ಬದಲಿಸಿ</span>
                          </button>
                          <button
                            type="button"
                            disabled={isDeletingSlot === 'question'}
                            onClick={() => handleDeleteSlotImage('question')}
                            className="p-1 bg-white hover:bg-rose-50 text-rose-700 border border-rose-200 rounded cursor-pointer disabled:opacity-50"
                            title="ಚಿತ್ರ 1 ಡಿಲೀಟ್"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      </>
                    ) : questionDiagramSvg ? (
                      <>
                        <div
                          className="h-24 overflow-hidden rounded border border-slate-100 bg-white p-1 flex items-center justify-center"
                          dangerouslySetInnerHTML={{ __html: questionDiagramSvg }}
                        />
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => handleReplaceSlotImage('question')}
                            className="flex-1 py-1 bg-white hover:bg-indigo-50 text-indigo-700 border border-indigo-200 rounded text-3xs font-bold cursor-pointer"
                          >
                            ಬದಲಿಸಿ
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteSlotImage('question')}
                            className="p-1 bg-white hover:bg-rose-50 text-rose-700 border border-rose-200 rounded cursor-pointer"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleReplaceSlotImage('question')}
                        className="w-full h-24 rounded border border-dashed border-slate-300 hover:border-indigo-400 hover:bg-indigo-50/40 flex flex-col items-center justify-center gap-1 text-3xs text-slate-500 cursor-pointer transition-colors"
                      >
                        <Crop className="w-3.5 h-3.5 text-indigo-500" />
                        <span>ಚಿತ್ರ 1 ಕ್ರಾಪ್</span>
                      </button>
                    )}
                  </div>

                  {/* Question Image 2 (Side-by-Side) */}
                  <div
                    className={`rounded-lg border p-1.5 space-y-1.5 bg-white ${
                      activeSlot === 'question2' ? 'border-indigo-500 ring-1 ring-indigo-300' : 'border-slate-200'
                    }`}
                  >
                    <div className="flex items-center justify-between text-3xs font-bold text-slate-700">
                      <button
                        type="button"
                        onClick={() => handleSwitchSlot('question2')}
                        className="hover:text-indigo-700 cursor-pointer"
                      >
                        ಚಿತ್ರ 2 (ಪಕ್ಕ)
                      </button>
                      {questionImageUrl2 && slotMetaKB[questionImageUrl2] && (
                        <span className="font-mono text-emerald-700">{slotMetaKB[questionImageUrl2]}KB</span>
                      )}
                    </div>

                    {questionImageUrl2 ? (
                      <>
                        {brokenPreviewSlots.question2 ? (
                          <div className="h-20 rounded border border-slate-200 bg-slate-100 flex items-center justify-center text-3xs text-slate-500 text-center p-1">
                            ಲೋಡ್ ಆಗಲಿಲ್ಲ
                          </div>
                        ) : (
                          <div className="h-24 rounded border border-slate-100 bg-slate-50/50 p-1 flex items-center justify-center">
                            <img
                              src={resolvedQuestionSrc2}
                              alt="ಪ್ರಶ್ನೆ ಚಿತ್ರ 2"
                              referrerPolicy="no-referrer"
                              onError={() => handlePreviewImageError('question2', questionImageUrl2)}
                              className="max-h-full max-w-full object-contain"
                            />
                          </div>
                        )}
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => handleReplaceSlotImage('question2')}
                            className="flex-1 py-1 bg-white hover:bg-indigo-50 text-indigo-700 border border-indigo-200 rounded text-3xs font-bold flex items-center justify-center gap-0.5 cursor-pointer"
                            title="ಚಿತ್ರ 2 ಬದಲಿಸಿ"
                          >
                            <Replace className="w-3 h-3" />
                            <span>ಬದಲಿಸಿ</span>
                          </button>
                          <button
                            type="button"
                            disabled={isDeletingSlot === 'question2'}
                            onClick={() => handleDeleteSlotImage('question2')}
                            className="p-1 bg-white hover:bg-rose-50 text-rose-700 border border-rose-200 rounded cursor-pointer disabled:opacity-50"
                            title="ಚಿತ್ರ 2 ಡಿಲೀಟ್"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleReplaceSlotImage('question2')}
                        className="w-full h-24 rounded border border-dashed border-slate-300 hover:border-indigo-400 hover:bg-indigo-50/40 flex flex-col items-center justify-center gap-1 text-3xs text-slate-500 cursor-pointer transition-colors"
                      >
                        <Plus className="w-3.5 h-3.5 text-indigo-500" />
                        <span>+ 2ನೇ ಚಿತ್ರ</span>
                      </button>
                    )}
                  </div>
                </div>

                <input
                  type="text"
                  value={questionDesc}
                  onChange={e => setQuestionDesc(e.target.value)}
                  placeholder="ಪ್ರಶ್ನೆ ಚಿತ್ರದ ವಿವರಣೆ / Alt Text (ಐಚ್ಛಿಕ)"
                  className="w-full px-2 py-1 text-2xs bg-white border border-slate-200 rounded-lg focus:outline-hidden focus:ring-1 focus:ring-indigo-500"
                />
              </div>

              {/* SECTION 2: Answer Key Images (1 & 2 Side-by-Side) */}
              <div
                className={`rounded-xl border p-2.5 space-y-2 transition-colors ${
                  activeSlot === 'answer' || activeSlot === 'answer2'
                    ? 'border-emerald-500 bg-emerald-50/20'
                    : 'border-slate-200 bg-slate-50/40'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold text-slate-900">
                    ೨. ಉತ್ತರ ಚಿತ್ರಗಳು (ಪಕ್ಕಪಕ್ಕದಲ್ಲಿ)
                  </span>
                  <button
                    type="button"
                    onClick={() => handleReplaceSlotImage('answer2')}
                    className={`px-2 py-0.5 rounded-md text-3xs font-bold border flex items-center gap-0.5 cursor-pointer whitespace-nowrap transition-colors ${
                      activeSlot === 'answer2'
                        ? 'bg-emerald-600 text-white border-emerald-600'
                        : 'bg-white text-emerald-700 border-emerald-300 hover:bg-emerald-50'
                    }`}
                    title="ಉತ್ತರಕ್ಕೆ 2ನೇ ಗ್ರಾಫ್ / ಚಿತ್ರ ಕ್ರಾಪ್ ಮಾಡಿ (ಪಕ್ಕಪಕ್ಕದಲ್ಲಿ ಫಿಟ್ ಆಗುತ್ತದೆ)"
                  >
                    <Plus className="w-3 h-3" />
                    <span>{answerImageUrl2 ? '2ನೇ ಚಿತ್ರ ಬದಲಿಸಿ' : '2ನೇ ಚಿತ್ರ ಕ್ರಾಪ್'}</span>
                  </button>
                </div>

                {/* Dual Side-by-Side Grid for Answer Image 1 & Answer Image 2 */}
                <div className="grid grid-cols-2 gap-2">
                  {/* Answer Image 1 */}
                  <div
                    className={`rounded-lg border p-1.5 space-y-1.5 bg-white ${
                      activeSlot === 'answer' ? 'border-emerald-500 ring-1 ring-emerald-300' : 'border-slate-200'
                    }`}
                  >
                    <div className="flex items-center justify-between text-3xs font-bold text-slate-700">
                      <button
                        type="button"
                        onClick={() => handleSwitchSlot('answer')}
                        className="hover:text-emerald-700 cursor-pointer"
                      >
                        ಉತ್ತರ 1
                      </button>
                      {answerImageUrl && slotMetaKB[answerImageUrl] && (
                        <span className="font-mono text-emerald-700">{slotMetaKB[answerImageUrl]}KB</span>
                      )}
                    </div>

                    {answerImageUrl ? (
                      <>
                        {brokenPreviewSlots.answer ? (
                          <div className="h-20 rounded border border-slate-200 bg-slate-100 flex items-center justify-center text-3xs text-slate-500 text-center p-1">
                            ಲೋಡ್ ಆಗಲಿಲ್ಲ
                          </div>
                        ) : (
                          <div className="h-24 rounded border border-emerald-100 bg-emerald-50/30 p-1 flex items-center justify-center">
                            <img
                              src={resolvedAnswerSrc}
                              alt={answerDesc || 'ಉತ್ತರ ಚಿತ್ರ 1'}
                              referrerPolicy="no-referrer"
                              onError={() => handlePreviewImageError('answer', answerImageUrl)}
                              className="max-h-full max-w-full object-contain"
                            />
                          </div>
                        )}
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => handleReplaceSlotImage('answer')}
                            className="flex-1 py-1 bg-white hover:bg-emerald-50 text-emerald-700 border border-emerald-200 rounded text-3xs font-bold flex items-center justify-center gap-0.5 cursor-pointer"
                            title="ಉತ್ತರ ಚಿತ್ರ 1 ಬದಲಿಸಿ"
                          >
                            <Replace className="w-3 h-3" />
                            <span>ಬದಲಿಸಿ</span>
                          </button>
                          <button
                            type="button"
                            disabled={isDeletingSlot === 'answer'}
                            onClick={() => handleDeleteSlotImage('answer')}
                            className="p-1 bg-white hover:bg-rose-50 text-rose-700 border border-rose-200 rounded cursor-pointer disabled:opacity-50"
                            title="ಉತ್ತರ ಚಿತ್ರ 1 ಡಿಲೀಟ್"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      </>
                    ) : answerDiagramSvg ? (
                      <>
                        <div
                          className="h-24 overflow-hidden rounded border border-emerald-100 bg-white p-1 flex items-center justify-center"
                          dangerouslySetInnerHTML={{ __html: answerDiagramSvg }}
                        />
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => handleReplaceSlotImage('answer')}
                            className="flex-1 py-1 bg-white hover:bg-emerald-50 text-emerald-700 border border-emerald-200 rounded text-3xs font-bold cursor-pointer"
                          >
                            ಬದಲಿಸಿ
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteSlotImage('answer')}
                            className="p-1 bg-white hover:bg-rose-50 text-rose-700 border border-rose-200 rounded cursor-pointer"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleReplaceSlotImage('answer')}
                        className="w-full h-24 rounded border border-dashed border-slate-300 hover:border-emerald-400 hover:bg-emerald-50/40 flex flex-col items-center justify-center gap-1 text-3xs text-slate-500 cursor-pointer transition-colors"
                      >
                        <Crop className="w-3.5 h-3.5 text-emerald-600" />
                        <span>ಉತ್ತರ 1 ಕ್ರಾಪ್</span>
                      </button>
                    )}
                  </div>

                  {/* Answer Image 2 (Side-by-Side) */}
                  <div
                    className={`rounded-lg border p-1.5 space-y-1.5 bg-white ${
                      activeSlot === 'answer2' ? 'border-emerald-500 ring-1 ring-emerald-300' : 'border-slate-200'
                    }`}
                  >
                    <div className="flex items-center justify-between text-3xs font-bold text-slate-700">
                      <button
                        type="button"
                        onClick={() => handleSwitchSlot('answer2')}
                        className="hover:text-emerald-700 cursor-pointer"
                      >
                        ಉತ್ತರ 2 (ಪಕ್ಕ)
                      </button>
                      {answerImageUrl2 && slotMetaKB[answerImageUrl2] && (
                        <span className="font-mono text-emerald-700">{slotMetaKB[answerImageUrl2]}KB</span>
                      )}
                    </div>

                    {answerImageUrl2 ? (
                      <>
                        {brokenPreviewSlots.answer2 ? (
                          <div className="h-20 rounded border border-slate-200 bg-slate-100 flex items-center justify-center text-3xs text-slate-500 text-center p-1">
                            ಲೋಡ್ ಆಗಲಿಲ್ಲ
                          </div>
                        ) : (
                          <div className="h-24 rounded border border-emerald-100 bg-emerald-50/30 p-1 flex items-center justify-center">
                            <img
                              src={resolvedAnswerSrc2}
                              alt="ಉತ್ತರ ಚಿತ್ರ 2"
                              referrerPolicy="no-referrer"
                              onError={() => handlePreviewImageError('answer2', answerImageUrl2)}
                              className="max-h-full max-w-full object-contain"
                            />
                          </div>
                        )}
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => handleReplaceSlotImage('answer2')}
                            className="flex-1 py-1 bg-white hover:bg-emerald-50 text-emerald-700 border border-emerald-200 rounded text-3xs font-bold flex items-center justify-center gap-0.5 cursor-pointer"
                            title="ಉತ್ತರ ಚಿತ್ರ 2 ಬದಲಿಸಿ"
                          >
                            <Replace className="w-3 h-3" />
                            <span>ಬದಲಿಸಿ</span>
                          </button>
                          <button
                            type="button"
                            disabled={isDeletingSlot === 'answer2'}
                            onClick={() => handleDeleteSlotImage('answer2')}
                            className="p-1 bg-white hover:bg-rose-50 text-rose-700 border border-rose-200 rounded cursor-pointer disabled:opacity-50"
                            title="ಉತ್ತರ ಚಿತ್ರ 2 ಡಿಲೀಟ್"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleReplaceSlotImage('answer2')}
                        className="w-full h-24 rounded border border-dashed border-slate-300 hover:border-emerald-400 hover:bg-emerald-50/40 flex flex-col items-center justify-center gap-1 text-3xs text-slate-500 cursor-pointer transition-colors"
                      >
                        <Plus className="w-3.5 h-3.5 text-emerald-600" />
                        <span>+ 2ನೇ ಚಿತ್ರ</span>
                      </button>
                    )}
                  </div>
                </div>

                <input
                  type="text"
                  value={answerDesc}
                  onChange={e => setAnswerDesc(e.target.value)}
                  placeholder="ಉತ್ತರ ಚಿತ್ರದ ವಿವರಣೆ (ಐಚ್ಛಿಕ)"
                  className="w-full px-2 py-1 text-2xs bg-white border border-slate-200 rounded-lg focus:outline-hidden focus:ring-1 focus:ring-emerald-500"
                />
              </div>
            </div>

            {/* Bottom Save, No-Image & Next Footer */}
            <div className="p-2.5 border-t border-slate-200 bg-slate-50/95 space-y-2 shrink-0">
              <div className="flex items-center justify-between gap-1.5">
                <button
                  type="button"
                  disabled={busyAction}
                  onClick={handleMarkImageNotRequired}
                  className="px-2.5 py-1.5 text-2xs font-bold text-rose-700 bg-rose-50 border border-rose-300 hover:bg-rose-100 rounded-lg transition-colors flex items-center gap-1 cursor-pointer whitespace-nowrap disabled:opacity-45"
                >
                  <Ban className="w-3 h-3" />
                  <span>ಚಿತ್ರ ಅಗತ್ಯವಿಲ್ಲ</span>
                </button>

                <button
                  type="button"
                  onClick={onClose}
                  className="px-2.5 py-1.5 text-2xs font-semibold text-slate-600 hover:bg-slate-200/70 rounded-lg transition-colors cursor-pointer whitespace-nowrap"
                >
                  ಮುಚ್ಚಿ
                </button>
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  disabled={busyAction}
                  onClick={handleFinalSave}
                  className={`flex-1 py-2 px-2.5 text-xs font-bold rounded-lg transition-colors flex items-center justify-center gap-1 cursor-pointer whitespace-nowrap disabled:opacity-50 ${
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
                    disabled={busyAction}
                    onClick={() => handleMoveQuestion('next', hasUnsavedChanges)}
                    className="flex-1 py-2 px-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-bold rounded-lg shadow-xs transition-colors flex items-center justify-center gap-1 cursor-pointer whitespace-nowrap"
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
                          : 'ಮುಂದಿನ →'}
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

