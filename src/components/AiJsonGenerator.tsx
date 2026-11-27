/**
 * AI-Powered JSON Question Bank Generator Component
 * Extracts Kannada text, questions, and answers from Karnataka DSERT LBA PDFs using Gemini multimodal OCR.
 * Author: S R Angadi / M I Nilaji
 */

import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  Upload,
  FileText,
  FileJson,
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  Download,
  Database,
  ArrowRight,
  RefreshCw,
  Search,
  Filter,
  Eye,
  EyeOff,
  Code,
  Check,
  ChevronDown,
  ChevronUp,
  Sliders,
  Layers,
  BookOpen,
  Cpu,
  Cloud,
  RotateCcw,
  Crop,
  Trash2,
  Replace,
  FolderOpen,
  Pause,
  Play,
  Square,
  Clock,
  Edit3,
} from 'lucide-react';
import { QuestionBank, Chapter, QuestionItem, IndexEntry } from '../types/questionBank.ts';
import {
  saveQuestionBankToFirebase,
  saveUploadedPdfToFirebase,
  deleteQuestionImageFromFirebase,
  extractImageIdFromUrl,
} from '../services/firebase.ts';
import {
  SavedPdfEntry,
  SavedBankSummary,
  savePdfPermanently,
  loadPdfBufferPermanently,
  listSavedPdfsCombined,
  deleteSavedPdfPermanently,
  findMatchingSavedPdf,
  listAllSavedQuestionBanks,
  loadSavedQuestionBank,
  deleteSavedQuestionBankPermanently,
} from '../services/pdfVault.ts';
import {
  ImageFilterMode,
  detectImageRequirement,
  matchesImageFilter,
  computeBankImageAudit,
} from '../utils/diagramDetector.ts';
import {
  parsePageRangeString,
  slicePdfPages,
  getTocSlice,
} from '../utils/pdfHelper.ts';
import { QuestionImageModal, QuestionImageUpdate } from './QuestionImageModal.tsx';
import { DiagramAuditPanel } from './DiagramAuditPanel.tsx';
import { SavedJsonBanksTable } from './SavedJsonBanksTable.tsx';
import { QuestionEditModal, QuestionTextUpdate } from './QuestionEditModal.tsx';
import {
  ensureUniqueQuestionIds,
  extractGradeKey,
  deduceSubjectCode,
  canonicalGradeLabel,
} from '../services/dataLoader.ts';
import {
  sanitizeQuestionMathText,
  sanitizeBankMathText,
} from '../utils/mathTextSanitizer.ts';
import {
  smartMergeQuestionBanks,
  isAnswerMissing,
  isAnswerMissingOrIncomplete,
  normalizeQuestionFingerprint,
  areQuestionsDuplicates,
  deduplicateQuestionBank,
  hasRepeatingOrRestartingSerials,
  parseUploadedJsonToQuestionBank,
  pickBestMatchingBankCandidate,
  formatMergeSummaryKannada,
  SmartMergeStats,
} from '../utils/bankMerger.ts';
import { MathText } from './MathText.tsx';

export interface RebuildTargetInfo {
  gradeKey: string;
  grade: string;
  subject: string;
  subjectCode: string;
}

interface AiJsonGeneratorProps {
  onBackToApp: () => void;
  onLoadGeneratedBank: (bank: QuestionBank, entry: IndexEntry, navigateToSetup?: boolean) => void;
  onDeleteSavedBank?: (deletedId: string) => void;
  rebuildTarget?: RebuildTargetInfo | null;
  onClearRebuildTarget?: () => void;
  onOpenInImageExplorer?: (bank: QuestionBank, entry: IndexEntry) => void;
}

interface DetectedChapter {
  chapterNumber: number;
  chapterId: string;
  chapterName: string;
  sectionType?: string;
  semester?: number;
  printedPages?: string;
  printedAnswerPages?: string;
  questionPages: string;
  answerPages: string;
  status: 'pending' | 'processing' | 'done' | 'error';
  extractedCount?: number;
  errorMessage?: string;
}

interface DetectedDoc {
  metadata: {
    title: string;
    grade: string;
    gradeKey: string;
    subject: string;
    subjectCode: string;
    medium: string;
    academicYear: string;
    department: string;
    institution: string;
    prelimOffset?: number;
    printedGlobalAnswerPages?: string;
    globalAnswerPages?: string;
  };
  learningOutcomes: Array<{ code: string; title: string }>;
  chapters: DetectedChapter[];
}

/**
 * Shift every page number in a range string like "1-6" or "85, 88-90" by `offset`,
 * clamping safely to [1, maxPage].
 */
function shiftPageRangeString(rangeStr: string | undefined, offset: number, maxPage?: number): string {
  if (!rangeStr || !rangeStr.trim()) return '';
  return rangeStr.replace(/\b(\d+)\b/g, m => {
    const n = parseInt(m, 10);
    let shifted = Math.max(1, n + offset);
    if (maxPage && maxPage > 0) {
      shifted = Math.min(maxPage, shifted);
    }
    return String(shifted);
  });
}

/**
 * Extract numeric start/end bounds from a simple range string ("12" or "12-18").
 */
function parseSimpleBounds(rangeStr: string | undefined): { start: number; end: number; isSingle: boolean } | null {
  if (!rangeStr || !rangeStr.trim()) return null;
  const nums = rangeStr.match(/\d+/g);
  if (!nums || nums.length === 0) return null;
  const start = parseInt(nums[0], 10);
  const end = nums.length >= 2 ? parseInt(nums[nums.length - 1], 10) : start;
  if (isNaN(start) || isNaN(end)) return null;
  return { start, end: Math.max(start, end), isSingle: nums.length === 1 };
}

/**
 * When a TOC only prints start pages (e.g. "1", "7", "14"), deterministically derive
 * each chapter's end page as (nextStart - 1), and cap the last chapter with `fallbackEnd`.
 */
function fillMissingEndPages(rawRanges: string[], fallbackEnd?: number): string[] {
  const parsed = rawRanges.map(r => parseSimpleBounds(r));
  return rawRanges.map((raw, idx) => {
    const cur = parsed[idx];
    if (!cur) return raw;
    if (!cur.isSingle) return `${cur.start}-${cur.end}`;

    // Find next chapter with a higher start page
    let nextStart: number | null = null;
    for (let j = idx + 1; j < parsed.length; j++) {
      if (parsed[j] && parsed[j]!.start > cur.start) {
        nextStart = parsed[j]!.start;
        break;
      }
    }

    if (nextStart !== null) {
      const end = Math.max(cur.start, nextStart - 1);
      return end > cur.start ? `${cur.start}-${end}` : String(cur.start);
    }
    if (fallbackEnd && fallbackEnd >= cur.start) {
      return fallbackEnd > cur.start ? `${cur.start}-${fallbackEnd}` : String(cur.start);
    }
    return String(cur.start);
  });
}

/**
 * When chapters don't have individual TOC answer page numbers, derive proportional per-chapter
 * answer page windows (with ±1 page overlap) from the book's global answer key range.
 */
function deriveProportionalAnswerPages(
  chapters: DetectedChapter[],
  globalAnsRange: string,
  maxPage: number
): DetectedChapter[] {
  const globalBounds = parseSimpleBounds(globalAnsRange);
  if (!globalBounds || chapters.length === 0) return chapters;

  const gStart = Math.max(1, globalBounds.start);
  const gEnd = maxPage > 0 ? Math.min(maxPage, Math.max(gStart, globalBounds.end)) : globalBounds.end;
  const totalAnsSpan = Math.max(1, gEnd - gStart + 1);

  // Weight each chapter proportionally by its question page count
  const weights = chapters.map(ch => {
    const b = parseSimpleBounds(ch.questionPages || ch.printedPages);
    return b ? Math.max(1, b.end - b.start + 1) : 1;
  });
  const totalWeight = weights.reduce((a, b) => a + b, 0) || chapters.length;

  let cumulative = 0;
  return chapters.map((ch, idx) => {
    const startFrac = cumulative / totalWeight;
    cumulative += weights[idx];
    const endFrac = cumulative / totalWeight;

    // Keep explicit per-chapter answer pages if already present
    if (ch.answerPages && ch.answerPages.trim()) {
      return ch;
    }

    const rawStart = gStart + Math.floor(startFrac * totalAnsSpan);
    const rawEnd = gStart + Math.ceil(endFrac * totalAnsSpan) - 1;
    // Add ±1 page safety margin so boundary answers are never missed
    const safeStart = Math.max(gStart, rawStart - 1);
    const safeEnd = Math.min(gEnd, Math.max(safeStart, rawEnd + 1));

    return {
      ...ch,
      answerPages: safeEnd > safeStart ? `${safeStart}-${safeEnd}` : String(safeStart),
    };
  });
}

export const AiJsonGenerator: React.FC<AiJsonGeneratorProps> = ({
  onBackToApp,
  onLoadGeneratedBank,
  onDeleteSavedBank,
  rebuildTarget = null,
  onClearRebuildTarget,
  onOpenInImageExplorer,
}) => {
  // Wizard steps: 1: upload & scan, 2: chapters & process, 3: verify & download
  const [step, setStep] = useState<1 | 2 | 3>(1);

  // Fresh Replace Mode (prevents merging flawed built-in Class 6 questions back in during rebuild)
  const [replaceExistingMode, setReplaceExistingMode] = useState<boolean>(false);
  const [activeRebuildTarget, setActiveRebuildTarget] = useState<RebuildTargetInfo | null>(null);

  // File state
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileBuffer, setFileBuffer] = useState<ArrayBuffer | null>(null);
  const [totalPages, setTotalPages] = useState<number>(0);
  const [scanPageRange, setScanPageRange] = useState<string>('1-16');
  const [fileName, setFileName] = useState<string>('');
  const [fileSizeMB, setFileSizeMB] = useState<string>('0');

  // Scanning & Extraction state
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [detectedDoc, setDetectedDoc] = useState<DetectedDoc | null>(null);

  // Physical PDF Page Offset & Global Answer Key
  const [pageOffset, setPageOffset] = useState<number>(0);
  const [globalAnswerKeyRange, setGlobalAnswerKeyRange] = useState<string>('');

  // Chapter Execution Mode: 'single' (recommended chapter-by-chapter) or 'batch' (table view)
  const [activeChapterMode, setActiveChapterMode] = useState<'single' | 'batch'>('single');
  const [selectedSingleChapterId, setSelectedSingleChapterId] = useState<string>('');

  // Chapter processing state & live Pause / Cancel / Restart controls
  const [isExtracting, setIsExtracting] = useState<boolean>(false);
  const [activeExtractionChapterId, setActiveExtractionChapterId] = useState<string | null>(null);
  const [isExtractionPaused, setIsExtractionPaused] = useState<boolean>(false);
  const [extractionElapsedSec, setExtractionElapsedSec] = useState<number>(0);
  const [extractionChunkProgress, setExtractionChunkProgress] = useState<{
    current: number;
    total: number;
    label: string;
  } | null>(null);
  const [extractionLog, setExtractionLog] = useState<string[]>([]);
  const [currentProcessingChapter, setCurrentProcessingChapter] = useState<string>('');

  const extractionAbortRef = useRef<AbortController | null>(null);
  const extractionPausedRef = useRef<boolean>(false);
  const extractionCancelledRef = useRef<boolean>(false);
  const extractionRunIdRef = useRef<number>(0);
  const pauseResolversRef = useRef<Array<() => void>>([]);
  const lastExtractionJobRef = useRef<
    | { mode: 'single'; chapterId: string }
    | { mode: 'batch'; onlyFailed: boolean }
    | null
  >(null);

  const isAnyExtractionRunning = isExtracting || activeExtractionChapterId !== null;

  useEffect(() => {
    if (!isAnyExtractionRunning || isExtractionPaused) return;
    const interval = window.setInterval(() => {
      setExtractionElapsedSec(prev => prev + 1);
    }, 1000);
    return () => window.clearInterval(interval);
  }, [isAnyExtractionRunning, isExtractionPaused]);

  useEffect(() => {
    return () => {
      extractionCancelledRef.current = true;
      extractionAbortRef.current?.abort();
      const waiters = pauseResolversRef.current.splice(0);
      waiters.forEach(resolve => resolve());
    };
  }, []);

  const formatElapsedMMSS = (sec: number): string => {
    const mins = Math.floor(sec / 60);
    const secs = sec % 60;
    return `${mins}:${String(secs).padStart(2, '0')}`;
  };

  const createExtractionAbortError = () => {
    const err = new Error('EXTRACTION_CANCELLED');
    err.name = 'AbortError';
    return err;
  };

  const isExtractionAbortError = (err: any, signal?: AbortSignal): boolean =>
    Boolean(
      signal?.aborted ||
        err?.name === 'AbortError' ||
        err?.message === 'EXTRACTION_CANCELLED'
    );

  const wakePauseWaiters = () => {
    const waiters = pauseResolversRef.current.splice(0);
    waiters.forEach(resolve => resolve());
  };

  const waitIfPausedOrCancelled = async (runId: number, signal?: AbortSignal): Promise<void> => {
    if (
      extractionCancelledRef.current ||
      extractionRunIdRef.current !== runId ||
      signal?.aborted
    ) {
      throw createExtractionAbortError();
    }
    while (extractionPausedRef.current) {
      await new Promise<void>(resolve => {
        pauseResolversRef.current.push(resolve);
      });
      if (
        extractionCancelledRef.current ||
        extractionRunIdRef.current !== runId ||
        signal?.aborted
      ) {
        throw createExtractionAbortError();
      }
    }
  };

  const abortableSleep = (ms: number, signal?: AbortSignal): Promise<void> =>
    new Promise<void>((resolve, reject) => {
      if (signal?.aborted) {
        reject(createExtractionAbortError());
        return;
      }
      const timer = window.setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      const onAbort = () => {
        window.clearTimeout(timer);
        reject(createExtractionAbortError());
      };
      signal?.addEventListener('abort', onAbort, { once: true });
    });

  // Final Generated Bank
  const [generatedBank, setGeneratedBank] = useState<QuestionBank | null>(null);
  const [rawJsonString, setRawJsonString] = useState<string>('');
  const [activeTab, setActiveTab] = useState<'preview' | 'json' | 'stats'>('preview');

  // Preview filtering
  const [previewChapterFilter, setPreviewChapterFilter] = useState<string>('all');
  const [previewFormatFilter, setPreviewFormatFilter] = useState<string>('all');
  const [previewImageFilter, setPreviewImageFilter] = useState<ImageFilterMode>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [expandedQuestionId, setExpandedQuestionId] = useState<string | null>(null);

  // Saving & UI error state
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [saveSuccessMessage, setSaveSuccessMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const showErrorNotice = (msg: string) => {
    setActionError(msg);
    setTimeout(() => setActionError(prev => (prev === msg ? null : prev)), 8000);
  };

  // Safe JSON response parser that detects HTML proxy/fallback pages cleanly
  const parseJsonResponse = async (response: Response, fallbackMsg: string) => {
    const rawText = await response.text();
    const trimmed = rawText.trim();
    if (trimmed.startsWith('<!') || trimmed.toLowerCase().startsWith('<html')) {
      const err: any = new Error(
        `ಸರ್ವರ್ ಪ್ರತಿಕ್ರಿಯೆ ಸಮಯ ಮೀರಿದೆ (HTTP ${response.status}). ಪುನಃ ಪ್ರಯತ್ನಿಸಲಾಗುತ್ತಿದೆ...`
      );
      err.isRetryableProxy = true;
      throw err;
    }
    let parsed: any = null;
    try {
      parsed = JSON.parse(trimmed || '{}');
    } catch {
      const err: any = new Error(fallbackMsg || `ಅಮಾನ್ಯ ಸರ್ವರ್ ಪ್ರತಿಕ್ರಿಯೆ (HTTP ${response.status})`);
      err.isRetryableProxy = response.status >= 500;
      throw err;
    }
    if (!response.ok) {
      const err: any = new Error(parsed?.error || `HTTP Error ${response.status}: ${response.statusText}`);
      err.quotaExhausted = Boolean(parsed?.quotaExhausted);
      err.isRetryableProxy = !parsed?.quotaExhausted && response.status >= 500;
      throw err;
    }
    return parsed;
  };

  // Extracted Chapters Cache (preserves chapters already completed)
  const [extractedChaptersCache, setExtractedChaptersCache] = useState<Record<string, Chapter>>({});

  // Reset confirmation modal state
  const [showResetConfirmModal, setShowResetConfirmModal] = useState<boolean>(false);

  // Image / PDF Cropper Modal target question + stable Prev/Next queue snapshot
  const [editingImageTarget, setEditingImageTarget] = useState<{
    chapterId: string;
    question: QuestionItem;
    initialSlot?: 'question' | 'question2' | 'answer' | 'answer2';
    queue?: Array<{ chapterId: string; questionId: string; defaultSlot: 'question' | 'question2' | 'answer' | 'answer2' }>;
    queueIndex?: number;
    queueLabel?: string;
  } | null>(null);

  // Permanently Saved PDFs (IndexedDB + Server + Firebase) & Saved JSON Question Banks
  const [savedPdfs, setSavedPdfs] = useState<SavedPdfEntry[]>([]);
  const [activePdfId, setActivePdfId] = useState<string | null>(null);
  const [isLoadingSavedPdf, setIsLoadingSavedPdf] = useState<boolean>(false);
  const [savedBanks, setSavedBanks] = useState<SavedBankSummary[]>([]);
  const [isLoadingSavedBank, setIsLoadingSavedBank] = useState<boolean>(false);
  const [deletingBankId, setDeletingBankId] = useState<string | null>(null);

  const refreshSavedPdfs = async () => {
    try {
      const list = await listSavedPdfsCombined();
      setSavedPdfs(list);
      return list;
    } catch (err) {
      console.warn('Could not fetch saved PDFs:', err);
      return [];
    }
  };

  const refreshSavedBanks = async () => {
    try {
      const list = await listAllSavedQuestionBanks();
      setSavedBanks(list);
      return list;
    } catch (err) {
      console.warn('Could not fetch saved question banks:', err);
      return [];
    }
  };

  // Load Saved PDFs, Saved JSON Banks, and auto-restore draft + permanent PDF buffer on mount
  React.useEffect(() => {
    let restoredPdfId: string | null = null;
    let restoredPdfUrl: string | undefined;
    let restoredFileName: string | undefined;
    let restoredBankObj: QuestionBank | null = null;

    // Restore draft and extracted chapters if available
    try {
      const savedDraft = localStorage.getItem('ai_json_gen_draft');
      if (savedDraft) {
        const parsed = JSON.parse(savedDraft);
        if (parsed.detectedDoc) {
          setDetectedDoc(parsed.detectedDoc);
          if (parsed.step) setStep(parsed.step);
          if (parsed.fileName) {
            setFileName(parsed.fileName);
            restoredFileName = parsed.fileName;
          }
          if (parsed.totalPages) setTotalPages(parsed.totalPages);
          if (parsed.fileSizeMB) setFileSizeMB(parsed.fileSizeMB);
          if (parsed.pageOffset) setPageOffset(parsed.pageOffset);
          if (parsed.globalAnswerKeyRange) setGlobalAnswerKeyRange(parsed.globalAnswerKeyRange);
          if (parsed.activePdfId) {
            setActivePdfId(parsed.activePdfId);
            restoredPdfId = parsed.activePdfId;
          }
          if (parsed.activePdfUrl) {
            restoredPdfUrl = parsed.activePdfUrl;
          }
        }
      }

      const savedCache = localStorage.getItem('ai_json_gen_extracted_cache');
      if (savedCache) {
        const parsedCache = JSON.parse(savedCache);
        if (parsedCache && typeof parsedCache === 'object' && Object.keys(parsedCache).length > 0) {
          setExtractedChaptersCache(parsedCache);
        }
      }

      const savedBank = localStorage.getItem('ai_json_gen_bank');
      if (savedBank) {
        const parsedBank = JSON.parse(savedBank);
        if (parsedBank && parsedBank.metadata && parsedBank.chapters) {
          const sanitizedBank = ensureUniqueQuestionIds(parsedBank);
          setGeneratedBank(sanitizedBank);
          setRawJsonString(JSON.stringify(sanitizedBank, null, 2));
          restoredBankObj = sanitizedBank;
        }
      }
    } catch {
      // ignore
    }

    // Fetch saved PDFs & saved JSON banks in parallel, and auto-restore the PDF binary!
    Promise.all([refreshSavedPdfs(), refreshSavedBanks()]).then(async ([pdfs]) => {
      const candidatePdfId =
        restoredPdfId ||
        restoredBankObj?.metadata?.sourcePdfId ||
        (restoredBankObj ? findMatchingSavedPdf(pdfs, restoredBankObj)?.id : null) ||
        (restoredFileName
          ? pdfs.find(p => p.fileName.toLowerCase() === restoredFileName!.toLowerCase())?.id
          : null);

      if (candidatePdfId) {
        const entry = pdfs.find(p => p.id === candidatePdfId);
        setIsLoadingSavedPdf(true);
        try {
          const buf = await loadPdfBufferPermanently(
            candidatePdfId,
            entry?.serverPdfUrl || restoredPdfUrl || restoredBankObj?.metadata?.sourcePdfUrl
          );
          if (buf) {
            setFileBuffer(buf);
            setActivePdfId(candidatePdfId);
            if (entry?.fileName) setFileName(entry.fileName);
            if (entry?.totalPages) setTotalPages(entry.totalPages);
            if (entry?.fileSizeMB) setFileSizeMB(entry.fileSizeMB);
          }
        } finally {
          setIsLoadingSavedPdf(false);
        }
      }
    });
  }, []);

  // Start a clean Fresh Rebuild for a Class 6 (or any) subject from LBA PDF
  const startFreshRebuildWorkflow = React.useCallback((target: RebuildTargetInfo) => {
    setActiveRebuildTarget(target);
    setReplaceExistingMode(true);
    setStep(1);
    setSelectedFile(null);
    setFileBuffer(null);
    setActivePdfId(null);
    setFileName('');
    setTotalPages(0);
    setFileSizeMB('0');
    setDetectedDoc(null);
    setGeneratedBank(null);
    setRawJsonString('');
    setExtractedChaptersCache({});
    setScanError(null);
    setSaveSuccessMessage(null);
    try {
      localStorage.removeItem('ai_json_gen_draft');
      localStorage.removeItem('ai_json_gen_extracted_cache');
      localStorage.removeItem('ai_json_gen_bank');
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (rebuildTarget) {
      startFreshRebuildWorkflow(rebuildTarget);
    }
  }, [rebuildTarget, startFreshRebuildWorkflow]);

  const handleStartRebuildForBank = (bank: SavedBankSummary) => {
    startFreshRebuildWorkflow({
      gradeKey: bank.gradeKey || '6',
      grade: bank.grade || canonicalGradeLabel(bank.gradeKey || '6'),
      subject: bank.subject,
      subjectCode: bank.subjectCode || deduceSubjectCode(undefined, bank.subject),
    });
  };

  // Persist draft (including permanent activePdfId) to localStorage on changes
  React.useEffect(() => {
    if (detectedDoc) {
      try {
        localStorage.setItem(
          'ai_json_gen_draft',
          JSON.stringify({
            step,
            detectedDoc,
            fileName,
            totalPages,
            fileSizeMB,
            pageOffset,
            globalAnswerKeyRange,
            activePdfId,
            activePdfUrl: activePdfId ? `/api/uploaded-pdf/${activePdfId}` : undefined,
          })
        );
      } catch {
        // ignore quota
      }
    }
  }, [step, detectedDoc, fileName, totalPages, fileSizeMB, pageOffset, globalAnswerKeyRange, activePdfId]);

  // Persist extracted chapters cache whenever chapters are added or updated
  React.useEffect(() => {
    if (extractedChaptersCache && Object.keys(extractedChaptersCache).length > 0) {
      try {
        localStorage.setItem(
          'ai_json_gen_extracted_cache',
          JSON.stringify(extractedChaptersCache)
        );
      } catch {
        // ignore quota
      }
    }
  }, [extractedChaptersCache]);

  // Persist generatedBank whenever ready
  React.useEffect(() => {
    if (generatedBank) {
      try {
        localStorage.setItem('ai_json_gen_bank', JSON.stringify(generatedBank));
      } catch {
        // ignore quota
      }
    }
  }, [generatedBank]);

  // Helper: save a PDF File permanently (IndexedDB + Server + Firebase) and bind it to current session
  const persistPdfFileAndBind = async (
    file: File,
    options?: { reuseActiveId?: boolean; showToast?: boolean }
  ) => {
    setSelectedFile(file);
    setFileName(file.name);
    setFileSizeMB((file.size / (1024 * 1024)).toFixed(2));
    setScanError(null);

    const buffer = await file.arrayBuffer();
    setFileBuffer(buffer);

    let pages = 0;
    try {
      const { PDFDocument } = await import('pdf-lib');
      const doc = await PDFDocument.load(buffer, { ignoreEncryption: true });
      pages = doc.getPageCount();
      setTotalPages(pages);
      setScanPageRange(`1-${Math.min(16, pages)}`);
    } catch (err) {
      console.warn('Could not inspect PDF page count:', err);
      setTotalPages(0);
    }

    const saved = await savePdfPermanently({
      pdfId: options?.reuseActiveId && activePdfId ? activePdfId : undefined,
      buffer,
      fileName: file.name,
      totalPages: pages,
      grade: detectedDoc?.metadata?.grade,
      gradeKey: detectedDoc?.metadata?.gradeKey,
      subject: detectedDoc?.metadata?.subject,
      subjectCode: detectedDoc?.metadata?.subjectCode,
      detectedDoc: detectedDoc || undefined,
    });
    setActivePdfId(saved.id);

    // Link sourcePdfId onto active generatedBank if present
    setGeneratedBank(prev => {
      if (!prev) return prev;
      const updated: QuestionBank = {
        ...prev,
        metadata: {
          ...prev.metadata,
          source_pdf: saved.fileName,
          sourcePdfId: saved.id,
          sourcePdfUrl: saved.serverPdfUrl,
        },
      };
      setRawJsonString(JSON.stringify(updated, null, 2));
      return updated;
    });

    await refreshSavedPdfs();
    if (options?.showToast) {
      setSaveSuccessMessage(
        `✅ "${saved.fileName}" ಶಾಶ್ವತವಾಗಿ ಉಳಿಸಲಾಗಿದೆ (${saved.totalPages || pages} ಪುಟಗಳು). ಮುಂದಿನ ಬಾರಿ ಪದೇ ಪದೇ ಅಪ್‌ಲೋಡ್ ಮಾಡುವ ಅಗತ್ಯವಿಲ್ಲ!`
      );
      setTimeout(() => setSaveSuccessMessage(null), 5000);
    }
    return saved;
  };

  // 1. Handle PDF Selection (Step 1)
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.toLowerCase().endsWith('.pdf') && file.type !== 'application/pdf') {
      showErrorNotice('ದಯವಿಟ್ಟು ಕೇವಲ PDF ಫೈಲ್ ಆಯ್ಕೆಮಾಡಿ (Please upload a valid PDF file).');
      return;
    }

    try {
      await persistPdfFileAndBind(file, { reuseActiveId: false, showToast: true });
    } catch (err: any) {
      console.warn('Could not persist PDF:', err);
    }
  };

  // Select a permanently saved PDF from Vault (loads binary automatically; jumps to Step 2 if called from Step 1 with detectedDoc)
  const handleSelectSavedPdf = async (
    pdf: SavedPdfEntry,
    options?: { openStep2IfScanned?: boolean }
  ) => {
    setIsLoadingSavedPdf(true);
    setScanError(null);
    try {
      const buf = await loadPdfBufferPermanently(pdf.id, pdf.serverPdfUrl);
      setActivePdfId(pdf.id);
      setFileName(pdf.fileName);
      if (pdf.totalPages) setTotalPages(pdf.totalPages);
      if (pdf.fileSizeMB) setFileSizeMB(pdf.fileSizeMB);

      if (buf) {
        setFileBuffer(buf);
      } else {
        setFileBuffer(null);
      }

      // Attach PDF metadata to currently open generatedBank in Step 3
      setGeneratedBank(prev => {
        if (!prev) return prev;
        const updated: QuestionBank = {
          ...prev,
          metadata: {
            ...prev.metadata,
            source_pdf: pdf.fileName,
            sourcePdfId: pdf.id,
            sourcePdfUrl: pdf.serverPdfUrl,
          },
        };
        setRawJsonString(JSON.stringify(updated, null, 2));
        return updated;
      });

      if (options?.openStep2IfScanned && pdf.detectedDoc) {
        setDetectedDoc(pdf.detectedDoc);
        if (pdf.detectedDoc.metadata?.prelimOffset) {
          setPageOffset(pdf.detectedDoc.metadata.prelimOffset);
        }
        if (pdf.detectedDoc.metadata?.globalAnswerPages) {
          setGlobalAnswerKeyRange(pdf.detectedDoc.metadata.globalAnswerPages);
        }
        setStep(2);
      }

      if (buf) {
        setSaveSuccessMessage(`✅ ಉಳಿಸಿದ PDF "${pdf.fileName}" ತಕ್ಷಣ ಲೋಡ್ ಆಗಿದೆ — ಮರು-ಅಪ್‌ಲೋಡ್ ಅಗತ್ಯವಿಲ್ಲ!`);
        setTimeout(() => setSaveSuccessMessage(null), 4000);
      } else {
        showErrorNotice(
          `"${pdf.fileName}" ನ ಮೆಟಾಡೇಟಾ ಲಭ್ಯವಿದೆ, ಆದರೆ PDF ಫೈಲ್ ಹಿಂದಿನ ಆವೃತ್ತಿಯಲ್ಲಿ ಉಳಿಸಿದ್ದರಿಂದ ಒಮ್ಮೆ ಮಾತ್ರ ಮರು-ಅಪ್‌ಲೋಡ್ ಮಾಡಿ (ನಂತರ ಶಾಶ್ವತವಾಗಿ ಉಳಿಯುತ್ತದೆ).`
        );
      }
    } finally {
      setIsLoadingSavedPdf(false);
    }
  };

  // Delete a permanently saved PDF from Vault
  const handleDeleteSavedPdf = async (pdfId: string) => {
    await deleteSavedPdfPermanently(pdfId);
    if (activePdfId === pdfId) {
      setActivePdfId(null);
    }
    await refreshSavedPdfs();
  };

  // Helper: Open a loaded QuestionBank inside Step 3 (for image upload, filtering, editing, and re-saving)
  const openBankInStep3 = async (
    rawBank: QuestionBank,
    displayLabel?: string,
    customSuccessMessage?: string
  ) => {
    const dedupRes = deduplicateQuestionBank(ensureUniqueQuestionIds(rawBank));
    const bank = dedupRes.cleanedBank;
    const newCache: Record<string, Chapter> = {};
    bank.chapters.forEach(ch => {
      newCache[ch.chapterId] = ch;
    });
    setExtractedChaptersCache(newCache);

    // If duplicates were automatically removed from an already-saved bank, sync cleaned version back to Server + Firebase
    if (dedupRes.removedDuplicates > 0 && bank.metadata?.id) {
      const syncedBank: QuestionBank = {
        ...bank,
        metadata: {
          ...bank.metadata,
          updatedAt: new Date().toISOString(),
        },
      };
      fetch('/api/save-question-bank', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questionBank: syncedBank }),
      }).catch(() => {});
      saveQuestionBankToFirebase(syncedBank)
        .then(() => refreshSavedBanks())
        .catch(() => {});
    }

    const resolvedGradeKey = extractGradeKey(
      bank.metadata.gradeKey ? String(bank.metadata.gradeKey) : bank.metadata.grade
    );
    const resolvedSubjectCode = deduceSubjectCode(
      bank.metadata.subjectCode ? String(bank.metadata.subjectCode) : undefined,
      bank.metadata.subject
    );

    setDetectedDoc({
      metadata: {
        title: bank.metadata.title || displayLabel || `${bank.metadata.grade} ${bank.metadata.subject}`,
        grade: bank.metadata.grade || canonicalGradeLabel(resolvedGradeKey),
        gradeKey: resolvedGradeKey,
        subject: bank.metadata.subject || 'ವಿಷಯ',
        subjectCode: resolvedSubjectCode,
        medium: bank.metadata.medium || 'ಕನ್ನಡ ಮಾಧ್ಯಮ (State Syllabus)',
        academicYear: String(bank.metadata.academicYear || '2026-27'),
        department:
          typeof bank.metadata.department === 'string' && bank.metadata.department
            ? bank.metadata.department
            : 'ಕರ್ನಾಟಕ ಸರ್ಕಾರ, ಶಾಲಾ ಶಿಕ್ಷಣ ಮತ್ತು ಸಾಕ್ಷರತಾ ಇಲಾಖೆ',
        institution:
          typeof bank.metadata.institution === 'string' && bank.metadata.institution
            ? bank.metadata.institution
            : 'DSERT ಬೆಂಗಳೂರು',
      },
      learningOutcomes: [],
      chapters: bank.chapters.map((ch, idx) => ({
        chapterNumber: ch.chapterNumber || idx + 1,
        chapterId: ch.chapterId || `ch-${idx + 1}`,
        chapterName: ch.chapterName,
        semester: ch.semester || 1,
        questionPages: '',
        answerPages: '',
        status: 'done' as const,
        extractedCount: ch.questions?.length || 0,
      })),
    });

    setGeneratedBank(bank);
    setRawJsonString(JSON.stringify(bank, null, 2));
    setPreviewChapterFilter('all');
    setPreviewFormatFilter('all');
    setSearchQuery('');
    setActiveTab('preview');

    // Auto-switch to Pending Images filter if there are pending diagram questions!
    const audit = computeBankImageAudit(bank);
    setPreviewImageFilter(audit.totalPending > 0 ? 'pending' : 'all');
    setStep(3);

    // Auto-match and load permanently saved PDF for effortless cropping
    const currentPdfs = savedPdfs.length > 0 ? savedPdfs : await refreshSavedPdfs();
    const matchedPdf = findMatchingSavedPdf(currentPdfs, bank);
    if (matchedPdf) {
      setIsLoadingSavedPdf(true);
      try {
        const buf = await loadPdfBufferPermanently(matchedPdf.id, matchedPdf.serverPdfUrl);
        if (buf) {
          setFileBuffer(buf);
          setActivePdfId(matchedPdf.id);
          setFileName(matchedPdf.fileName);
          if (matchedPdf.totalPages) setTotalPages(matchedPdf.totalPages);
          if (matchedPdf.fileSizeMB) setFileSizeMB(matchedPdf.fileSizeMB);
        }
      } finally {
        setIsLoadingSavedPdf(false);
      }
    }

    const autoDedupSuffix =
      dedupRes.removedDuplicates > 0
        ? ` · ✅ ${dedupRes.removedDuplicates} ಡುಪ್ಲಿಕೇಟ್ ಪ್ರಶ್ನೆಗಳನ್ನು ಸ್ವಯಂಚಾಲಿತವಾಗಿ ತೆಗೆದುಹಾಕಿ ಉಳಿಸಲಾಗಿದೆ (ಎಲ್ಲಾ ಚಿತ್ರಗಳು ಸುರಕ್ಷಿತವಾಗಿವೆ)!`
        : '';

    setSaveSuccessMessage(
      customSuccessMessage
        ? `${customSuccessMessage}${autoDedupSuffix}`
        : audit.totalPending > 0
        ? `"${displayLabel || bank.metadata.subject}" ತೆರೆಯಲಾಗಿದೆ · ${audit.totalPending} ಪ್ರಶ್ನೆಗಳಿಗೆ ಚಿತ್ರ ಅಪ್ಲೋಡ್ ಬಾಕಿ ಇದೆ (ಫಿಲ್ಟರ್ ಮಾಡಲಾಗಿದೆ).${autoDedupSuffix}`
        : `"${displayLabel || bank.metadata.subject}" ಪ್ರಶ್ನೆಕೋಶ ಯಶಸ್ವಿಯಾಗಿ ತೆರೆಯಲಾಗಿದೆ (${bank.chapters.length} ಘಟಕಗಳು).${autoDedupSuffix}`
    );
    setTimeout(() => setSaveSuccessMessage(null), customSuccessMessage || dedupRes.removedDuplicates > 0 ? 8000 : 6000);
  };

  // Re-open any previously saved JSON Question Bank (Firebase or Server) directly into Step 3
  const handleOpenSavedBankInGenerator = async (summary: SavedBankSummary) => {
    setIsLoadingSavedBank(true);
    try {
      const loaded = await loadSavedQuestionBank(summary);
      if (!loaded) {
        showErrorNotice('ಉಳಿಸಿದ JSON ಪ್ರಶ್ನೆಕೋಶವನ್ನು ಲೋಡ್ ಮಾಡಲು ಸಾಧ್ಯವಾಗಲಿಲ್ಲ.');
        return;
      }
      await openBankInStep3(loaded, `${summary.grade} · ${summary.subject}`);
    } catch (err: any) {
      showErrorNotice('JSON ಲೋಡ್ ದೋಷ: ' + (err.message || String(err)));
    } finally {
      setIsLoadingSavedBank(false);
    }
  };

  // Permanently delete a saved or duplicate JSON Question Bank (Firebase + Server Disk)
  const handleDeleteSavedBankInGenerator = async (summary: SavedBankSummary) => {
    setDeletingBankId(summary.id);
    try {
      await deleteSavedQuestionBankPermanently(summary);
      setSavedBanks(prev => prev.filter(b => !(b.id === summary.id && b.source === summary.source)));
      if (generatedBank?.metadata?.id === summary.id) {
        setGeneratedBank(null);
        setRawJsonString('');
      }
      if (onDeleteSavedBank) {
        onDeleteSavedBank(summary.id);
      }
      setSaveSuccessMessage(
        `✅ "${summary.grade} · ${summary.subject}" JSON ಫೈಲ್ ಶಾಶ್ವತವಾಗಿ ಅಳಿಸಲಾಗಿದೆ (Deleted).`
      );
      setTimeout(() => setSaveSuccessMessage(null), 5000);
      await refreshSavedBanks();
    } catch (err: any) {
      showErrorNotice('JSON ಫೈಲ್ ಅಳಿಸುವಲ್ಲಿ ದೋಷ: ' + (err?.message || String(err)));
    } finally {
      setDeletingBankId(null);
    }
  };

  // Direct JSON Bank File Loader (supports single-unit OR full-book JSON and auto-merges into previous all-units file!)
  const handleDirectJsonUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const text = reader.result as string;
        const parsed = JSON.parse(text);
        const fallbackMeta = generatedBank?.metadata || detectedDoc?.metadata;
        const {
          bank: incomingBank,
          gradeKey: gKey,
          subjectCode: sCode,
          subject: cleanSubject,
        } = parseUploadedJsonToQuestionBank(parsed, file.name, fallbackMeta);

        let finalBank: QuestionBank = incomingBank;
        let mergeBanner: string | undefined;
        let mergedIntoExisting = false;

        // Search all NON-builtin saved banks (Firebase + Server Disk) AND currently open bank
        // (NEVER merge flawed built-in Class 6 questions, and skip merge in Fresh Replace Mode!)
        try {
          if (!replaceExistingMode) {
            const allSaved = await listAllSavedQuestionBanks();
            const nonBuiltinSaved = allSaved.filter(sb => sb.source !== 'builtin');
            const candidateList: Array<{
              id?: string;
              grade?: string;
              gradeKey?: string;
              subject?: string;
              subjectCode?: string;
              medium?: string;
              totalChapters?: number;
              totalQuestions?: number;
              summary?: SavedBankSummary;
              inMemoryBank?: QuestionBank;
            }> = nonBuiltinSaved.map(sb => ({
              id: sb.id,
              grade: sb.grade,
              gradeKey: sb.gradeKey,
              subject: sb.subject,
              subjectCode: sb.subjectCode,
              medium: sb.medium,
              totalChapters: sb.totalChapters,
              totalQuestions: sb.totalQuestions,
              summary: sb,
            }));

            if (generatedBank && generatedBank.chapters && generatedBank.chapters.length > 0) {
              candidateList.push({
                id: generatedBank.metadata.id,
                grade: generatedBank.metadata.grade,
                gradeKey: generatedBank.metadata.gradeKey ? String(generatedBank.metadata.gradeKey) : undefined,
                subject: generatedBank.metadata.subject,
                subjectCode: generatedBank.metadata.subjectCode,
                medium: generatedBank.metadata.medium,
                totalChapters: generatedBank.chapters.length,
                totalQuestions: generatedBank.chapters.reduce((s, c) => s + (c.questions?.length || 0), 0),
                inMemoryBank: generatedBank,
              });
            }

            const bestMatch = pickBestMatchingBankCandidate(candidateList, incomingBank);
            let existingFullBank: QuestionBank | null = null;
            if (bestMatch?.summary) {
              existingFullBank = await loadSavedQuestionBank(bestMatch.summary);
            } else if (bestMatch?.inMemoryBank) {
              existingFullBank = bestMatch.inMemoryBank;
            }

            if (existingFullBank && existingFullBank.chapters && existingFullBank.chapters.length > 0) {
              const { mergedBank, stats } = smartMergeQuestionBanks(existingFullBank, incomingBank);
              finalBank = ensureUniqueQuestionIds({
                ...mergedBank,
                metadata: {
                  ...mergedBank.metadata,
                  id: existingFullBank.metadata.id || bestMatch?.id || incomingBank.metadata.id,
                  grade: canonicalGradeLabel(gKey),
                  gradeKey: gKey,
                  subjectCode: sCode,
                  subject: existingFullBank.metadata.subject || cleanSubject,
                },
              });
              mergedIntoExisting = true;
              mergeBanner = formatMergeSummaryKannada(stats);
            }
          }
        } catch (mergeErr) {
          console.warn('Direct JSON upload smart merge lookup skipped:', mergeErr);
        }

        // Persist the merged all-units bank automatically so previous units + newly uploaded unit are immediately saved!
        if (mergedIntoExisting) {
          try {
            const saveRes = await fetch('/api/save-question-bank', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ questionBank: finalBank }),
            });
            if (saveRes.ok) {
              const resData = await saveRes.json().catch(() => null);
              if (resData?.entry?.id) {
                finalBank = {
                  ...finalBank,
                  metadata: { ...finalBank.metadata, id: resData.entry.id },
                };
              }
              if (resData?.entry) {
                onLoadGeneratedBank(finalBank, resData.entry, false);
              }
            }
          } catch (serverSaveErr) {
            console.warn('Server persistence after single-unit JSON merge failed:', serverSaveErr);
          }
          try {
            await saveQuestionBankToFirebase(finalBank);
          } catch (fbErr) {
            console.warn('Firebase persistence after single-unit JSON merge failed:', fbErr);
          }
          refreshSavedBanks();
        }

        await openBankInStep3(
          finalBank,
          `${canonicalGradeLabel(gKey)} · ${finalBank.metadata.subject}`,
          mergeBanner
        );
      } catch (err: any) {
        showErrorNotice('JSON ಫೈಲ್ ಓದುವಲ್ಲಿ ದೋಷ: ' + (err.message || 'ದೋಷ ಕಂಡುಬಂದಿದೆ'));
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  // Upload Another PDF / Reset and Start Again
  const handleResetAndStartNewPdf = () => {
    const hasProgress = Boolean(detectedDoc || generatedBank || Object.keys(extractedChaptersCache).length > 0 || selectedFile);
    if (hasProgress) {
      setShowResetConfirmModal(true);
      return;
    }
    executeResetAndStartNewPdf();
  };

  const executeResetAndStartNewPdf = () => {
    handleCancelExtraction(true);
    setShowResetConfirmModal(false);
    setSelectedFile(null);
    setFileBuffer(null);
    setActivePdfId(null);
    setDetectedDoc(null);
    setExtractedChaptersCache({});
    setGeneratedBank(null);
    setRawJsonString('');
    setFileName('');
    setTotalPages(0);
    setFileSizeMB('0');
    setScanError(null);
    setExtractionLog([]);
    setPreviewImageFilter('all');
    setStep(1);
    try {
      localStorage.removeItem('ai_json_gen_draft');
      localStorage.removeItem('ai_json_gen_extracted_cache');
      localStorage.removeItem('ai_json_gen_bank');
    } catch {
      // ignore
    }
  };

  // Re-attach PDF buffer (saves permanently to IndexedDB + Server + Firebase so it never asks again)
  const handleReattachPdf = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      await persistPdfFileAndBind(file, { reuseActiveId: true, showToast: true });
    } catch (err: any) {
      setScanError('PDF ಲೋಡ್ ಮಾಡುವಲ್ಲಿ ದೋಷ: ' + err.message);
    }
    e.target.value = '';
  };

  // 2. Scan PDF Structure with Gemini (Lightweight TOC Slice + Deterministic Page/Answer Alignment)
  const handleScanPdf = async () => {
    if (!selectedFile && !fileBuffer) {
      showErrorNotice('ದಯವಿಟ್ಟು ಮೊದಲು PDF ಫೈಲ್ ಆಯ್ಕೆಮಾಡಿ.');
      return;
    }

    setIsScanning(true);
    setScanError(null);

    try {
      let buffer = fileBuffer;
      if (!buffer && selectedFile) {
        buffer = await selectedFile.arrayBuffer();
        setFileBuffer(buffer);
      }

      if (!buffer) {
        throw new Error('PDF ಡೇಟಾ ಲೋಡ್ ಮಾಡಲು ಸಾಧ್ಯವಾಗಲಿಲ್ಲ.');
      }

      // Inspect total page count if not yet known
      let knownTotalPages = totalPages;
      if (knownTotalPages <= 0) {
        try {
          const { PDFDocument } = await import('pdf-lib');
          const pdfDocObj = await PDFDocument.load(buffer, { ignoreEncryption: true });
          knownTotalPages = pdfDocObj.getPageCount();
          setTotalPages(knownTotalPages);
        } catch {
          // ignore
        }
      }

      // Generate lightweight slice of Table of Contents / Syllabus
      let sliceBase64 = '';
      if (knownTotalPages > 0) {
        const pageIndices = parsePageRangeString(scanPageRange, knownTotalPages);
        if (pageIndices.length > 0) {
          const sliceRes = await slicePdfPages(buffer, pageIndices);
          sliceBase64 = sliceRes.base64;
        } else {
          const toc = await getTocSlice(buffer, 16);
          sliceBase64 = toc.base64;
        }
      } else {
        const toc = await getTocSlice(buffer, 16);
        sliceBase64 = toc.base64;
      }

      const response = await fetch('/api/ai/scan-lba-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          base64Pdf: sliceBase64,
          fileName,
          totalPages: knownTotalPages,
          scannedPageNumbers: scanPageRange,
        }),
      });

      const resData = await parseJsonResponse(response, 'PDF ಸ್ಕ್ಯಾನ್ ಮಾಡುವಲ್ಲಿ ವಿಫಲವಾಗಿದೆ.');
      if (!resData.success) {
        throw new Error(resData.error || 'PDF ಸ್ಕ್ಯಾನ್ ಮಾಡುವಲ್ಲಿ ವಿಫಲವಾಗಿದೆ.');
      }

      const scanned = resData.data;
      const detectedOffset =
        typeof scanned.metadata?.prelimOffset === 'number' && !isNaN(scanned.metadata.prelimOffset)
          ? Math.max(0, Math.round(scanned.metadata.prelimOffset))
          : 0;

      // Determine printed and physical global answer key range
      const rawPrintedGlobalAns = String(scanned.metadata?.printedGlobalAnswerPages || '').trim();
      const rawGlobalAns = String(scanned.metadata?.globalAnswerPages || '').trim();
      let physicalGlobalAns = '';
      if (rawPrintedGlobalAns) {
        const bounds = parseSimpleBounds(rawPrintedGlobalAns);
        if (bounds && bounds.isSingle && knownTotalPages > 0) {
          const startPhys = Math.min(knownTotalPages, Math.max(1, bounds.start + detectedOffset));
          physicalGlobalAns = `${startPhys}-${knownTotalPages}`;
        } else {
          physicalGlobalAns = shiftPageRangeString(rawPrintedGlobalAns, detectedOffset, knownTotalPages);
        }
      } else if (rawGlobalAns) {
        const bounds = parseSimpleBounds(rawGlobalAns);
        if (bounds && bounds.isSingle && knownTotalPages > 0) {
          physicalGlobalAns = `${Math.min(knownTotalPages, bounds.start)}-${knownTotalPages}`;
        } else {
          physicalGlobalAns = rawGlobalAns;
        }
      }

      const rawChapters = Array.isArray(scanned.chapters) ? scanned.chapters : [];

      // Deterministically derive missing end pages for printed question & printed answer pages
      const globalAnsPrintedBounds = parseSimpleBounds(rawPrintedGlobalAns);
      const qFallbackPrintedEnd =
        globalAnsPrintedBounds && globalAnsPrintedBounds.start > 1
          ? globalAnsPrintedBounds.start - 1
          : knownTotalPages > 0
          ? Math.max(1, knownTotalPages - detectedOffset)
          : undefined;
      const aFallbackPrintedEnd =
        knownTotalPages > 0 ? Math.max(1, knownTotalPages - detectedOffset) : undefined;

      const rawPrintedQList = rawChapters.map((c: any) =>
        String(c.printedPages || c.printedQuestionPages || c.questionPages || '').trim()
      );
      const filledPrintedQList = fillMissingEndPages(rawPrintedQList, qFallbackPrintedEnd);

      const rawPrintedAList = rawChapters.map((c: any) =>
        String(c.printedAnswerPages || '').trim()
      );
      const hasAnyPrintedAns = rawPrintedAList.some(Boolean);
      const filledPrintedAList = hasAnyPrintedAns
        ? fillMissingEndPages(rawPrintedAList, aFallbackPrintedEnd)
        : rawPrintedAList;

      // Also handle when Gemini populated physical `answerPages` directly without `printedAnswerPages`
      const rawPhysicalAList = rawChapters.map((c: any) => String(c.answerPages || '').trim());
      const hasAnyPhysicalAns = rawPhysicalAList.some(Boolean);
      const filledPhysicalAList = hasAnyPhysicalAns
        ? fillMissingEndPages(rawPhysicalAList, knownTotalPages > 0 ? knownTotalPages : undefined)
        : rawPhysicalAList;

      let chs: DetectedChapter[] = rawChapters.map((c: any, idx: number) => {
        const printedQ = filledPrintedQList[idx] || '';
        const printedA = filledPrintedAList[idx] || '';

        // Always compute physical PDF pages deterministically from printed TOC pages + prelimOffset when available
        const physicalQ = printedQ
          ? shiftPageRangeString(printedQ, detectedOffset, knownTotalPages)
          : String(c.questionPages || '').trim();

        const physicalA = printedA
          ? shiftPageRangeString(printedA, detectedOffset, knownTotalPages)
          : filledPhysicalAList[idx] || '';

        return {
          chapterNumber: c.chapterNumber || idx + 1,
          chapterId: c.chapterId || `ch-${idx + 1}`,
          chapterName: c.chapterName || `ಅಧ್ಯಾಯ ${idx + 1}`,
          sectionType: c.sectionType || 'ಸಾಮಾನ್ಯ',
          semester: c.semester || (idx + 1 > Math.ceil(rawChapters.length / 2) ? 2 : 1),
          printedPages: printedQ,
          printedAnswerPages: printedA,
          questionPages: physicalQ,
          answerPages: physicalA,
          status: 'pending',
        };
      });

      // If no per-chapter answer pages were printed in the TOC, auto-derive from globalAnswerPages!
      if (!chs.some(c => c.answerPages.trim()) && physicalGlobalAns) {
        chs = deriveProportionalAnswerPages(chs, physicalGlobalAns, knownTotalPages);
      }

      setPageOffset(detectedOffset);
      setGlobalAnswerKeyRange(physicalGlobalAns);

      if (chs.length > 0) {
        setSelectedSingleChapterId(chs[0].chapterId);
      }

      const doc: DetectedDoc = {
        metadata: {
          title: scanned.metadata?.title || 'ಕಲಿಕಾಫಲ ಆಧಾರಿತ ಮೌಲ್ಯಾಂಕನ ಪ್ರಶ್ನೋತ್ತರ ಬ್ಯಾಂಕ್',
          grade: scanned.metadata?.grade || '6ನೇ ತರಗತಿ (Class 6)',
          gradeKey: scanned.metadata?.gradeKey || '6',
          subject: scanned.metadata?.subject || 'ವಿಷಯ',
          subjectCode: scanned.metadata?.subjectCode || 'GEN',
          medium: scanned.metadata?.medium || 'ಕನ್ನಡ ಮಾಧ್ಯಮ (State Syllabus)',
          academicYear: scanned.metadata?.academicYear || '2026-27',
          department: scanned.metadata?.department || 'ಕರ್ನಾಟಕ ಸರ್ಕಾರ, ಶಾಲಾ ಶಿಕ್ಷಣ ಮತ್ತು ಸಾಕ್ಷರತಾ ಇಲಾಖೆ',
          institution: scanned.metadata?.institution || 'DSERT ಬೆಂಗಳೂರು',
          prelimOffset: detectedOffset,
          printedGlobalAnswerPages: rawPrintedGlobalAns || undefined,
          globalAnswerPages: physicalGlobalAns,
        },
        learningOutcomes: scanned.learningOutcomes || [],
        chapters: chs,
      };

      setDetectedDoc(doc);
      setStep(2);

      // Update the permanently saved PDF record in Firebase with detectedDoc + grade/subject (no duplicates)
      const resolvedPdfId = activePdfId || `pdf_${Date.now()}`;
      if (!activePdfId) {
        setActivePdfId(resolvedPdfId);
        // Ensure binary is also permanently saved if it was loaded before persistPdfFileAndBind
        savePdfPermanently({
          pdfId: resolvedPdfId,
          buffer,
          fileName: fileName || 'uploaded_lba.pdf',
          totalPages: knownTotalPages,
          grade: doc.metadata.grade,
          gradeKey: doc.metadata.gradeKey,
          subject: doc.metadata.subject,
          subjectCode: doc.metadata.subjectCode,
          detectedDoc: doc,
        })
          .then(() => refreshSavedPdfs())
          .catch(() => {});
      } else {
        saveUploadedPdfToFirebase({
          id: resolvedPdfId,
          fileName: fileName || 'uploaded_lba.pdf',
          fileSizeMB: fileSizeMB,
          totalPages: knownTotalPages,
          grade: doc.metadata.grade,
          gradeKey: doc.metadata.gradeKey,
          subject: doc.metadata.subject,
          subjectCode: doc.metadata.subjectCode,
          serverPdfUrl: `/api/uploaded-pdf/${resolvedPdfId}`,
          detectedDoc: doc,
          uploadedAt: new Date().toISOString(),
        })
          .then(() => refreshSavedPdfs())
          .catch(e => console.warn('Could not update PDF record in Firestore:', e));
      }
    } catch (err: any) {
      console.error('Scan error:', err);
      const isFetchErr = err.name === 'TypeError' || String(err).includes('Failed to fetch');
      const msg = isFetchErr
        ? 'ಸರ್ವರ್ ಸಂಪರ್ಕ ವಿಫಲವಾಗಿದೆ (Connection/Fetch Failed). ದಯವಿಟ್ಟು ಸ್ಕ್ಯಾನ್ ಪುಟ ವ್ಯಾಪ್ತಿಯನ್ನು (ಉದಾ. 1-10) ಚಿಕ್ಕದಾಗಿಸಿ ಪುನಃ ಪ್ರಯತ್ನಿಸಿ.'
        : err.message || 'PDF ವಿಶ್ಲೇಷಣೆಯಲ್ಲಿ ದೋಷ ಸಂಭವಿಸಿದೆ.';
      setScanError(msg);
    } finally {
      setIsScanning(false);
    }
  };

  // Update chapter page numbers manually
  const handleUpdateChapterPages = (
    chapterId: string,
    field: 'questionPages' | 'answerPages',
    val: string
  ) => {
    if (!detectedDoc) return;
    const chapters = detectedDoc.chapters.map(c =>
      c.chapterId === chapterId ? { ...c, [field]: val } : c
    );
    setDetectedDoc({ ...detectedDoc, chapters });
  };

  // Shift printed question pages, printed answer pages, AND global answer key by offset
  const handleApplyOffsetToAll = (offsetToAdd: number) => {
    if (!detectedDoc) return;
    const safeOffset = Math.max(0, offsetToAdd);

    // 1. Shift global answer key from printedGlobalAnswerPages (if available)
    let updatedGlobalAns = globalAnswerKeyRange;
    const printedGlobal = detectedDoc.metadata.printedGlobalAnswerPages;
    if (printedGlobal) {
      const b = parseSimpleBounds(printedGlobal);
      if (b && b.isSingle && totalPages > 0) {
        const s = Math.min(totalPages, Math.max(1, b.start + safeOffset));
        updatedGlobalAns = `${s}-${totalPages}`;
      } else {
        updatedGlobalAns = shiftPageRangeString(printedGlobal, safeOffset, totalPages);
      }
      setGlobalAnswerKeyRange(updatedGlobalAns);
    }

    // 2. Shift every chapter's question pages & printed answer pages
    const hasPrintedAns = detectedDoc.chapters.some(c => Boolean(c.printedAnswerPages?.trim()));
    let chapters = detectedDoc.chapters.map(c => {
      const baseQ = c.printedPages || c.questionPages;
      const shiftedQ = shiftPageRangeString(baseQ, safeOffset, totalPages);
      const shiftedA = c.printedAnswerPages?.trim()
        ? shiftPageRangeString(c.printedAnswerPages, safeOffset, totalPages)
        : hasPrintedAns
        ? c.answerPages
        : '';
      return {
        ...c,
        questionPages: shiftedQ,
        answerPages: shiftedA,
      };
    });

    // 3. If per-chapter printed answer pages weren't present, re-derive proportional answer windows from shifted global key
    if (!hasPrintedAns && updatedGlobalAns) {
      chapters = deriveProportionalAnswerPages(chapters, updatedGlobalAns, totalPages);
    }

    setDetectedDoc({
      ...detectedDoc,
      metadata: {
        ...detectedDoc.metadata,
        prelimOffset: safeOffset,
        globalAnswerPages: updatedGlobalAns,
      },
      chapters,
    });
  };

  // Helper: normalize raw Gemini question objects into QuestionItem[]
  const normalizeRawQuestions = (
    rawQuestions: any[],
    ch: DetectedChapter,
    startIndexOffset: number,
    fallbackSourcePage?: number,
    allowedQuestionPages?: number[],
    allowedAnswerPages?: number[],
    combinedSlicePages?: number[]
  ): QuestionItem[] => {
    const out: QuestionItem[] = [];
    const subjectHint = [
      detectedDoc?.metadata.subject || '',
      detectedDoc?.metadata.subjectCode || '',
      detectedDoc?.metadata.title || '',
      ch.chapterName || '',
    ].join(' ');

    const parsePositiveInt = (val: any): number | undefined => {
      const n = typeof val === 'number' ? val : parseInt(String(val ?? ''), 10);
      return !isNaN(n) && n > 0 ? Math.floor(n) : undefined;
    };

    const extractSerialAndCleanText = (
      rawQuestionText: string,
      rawPrintedSerial: any,
      rawQNum: any
    ): { printedSerial?: string; questionNumber?: number; cleanedText: string } => {
      let text = String(rawQuestionText || '').trim();
      let serialStr =
        rawPrintedSerial !== undefined && rawPrintedSerial !== null && String(rawPrintedSerial).trim() !== ''
          ? String(rawPrintedSerial).trim().replace(/[.)]+$/, '')
          : undefined;
      let qNum = parsePositiveInt(rawQNum);

      // If text begins with an explicit printed serial number like "42. Find..." or "12(a) Prove...", extract it
      const leadMatch = text.match(/^(?:Q\.?\s*)?(\d{1,3}(?:\s*\([a-zA-Z0-9ivx]+\))?)\s*[.)]\s+(.+)$/s);
      if (leadMatch) {
        const leadSerial = leadMatch[1].replace(/\s+/g, '');
        const leadNum = parsePositiveInt(leadSerial);
        if (!serialStr) serialStr = leadSerial;
        if (!qNum && leadNum) qNum = leadNum;
        text = leadMatch[2].trim();
      }

      if (!serialStr && qNum) serialStr = String(qNum);
      if (!qNum && serialStr) qNum = parsePositiveInt(serialStr);

      return { printedSerial: serialStr, questionNumber: qNum, cleanedText: text };
    };

    rawQuestions.forEach((q: any, localIdx: number) => {
      const qIdx = startIndexOffset + localIdx;
      const rawItems = Array.isArray(q.items) ? q.items : undefined;
      const serialMeta = extractSerialAndCleanText(
        q.question || '',
        q.printedSerial ?? q.serial_number,
        q.question_number ?? q.questionNumber
      );
      const parsedQNum = serialMeta.questionNumber;
      const parsedSerial = serialMeta.printedSerial;
      // Validate & remap physical PDF sourcePage / answerPage (prevents Gemini returning slice page 1/2 instead of actual PDF page 54/55!)
      const rawSrcPg = parsePositiveInt(q.sourcePage);
      let parsedSourcePage: number | undefined = rawSrcPg;
      if (allowedQuestionPages && allowedQuestionPages.length > 0) {
        if (rawSrcPg && allowedQuestionPages.includes(rawSrcPg)) {
          parsedSourcePage = rawSrcPg;
        } else if (rawSrcPg && rawSrcPg >= 1 && rawSrcPg <= allowedQuestionPages.length) {
          // Gemini returned 1-based slice index instead of original PDF page -> remap!
          parsedSourcePage = allowedQuestionPages[rawSrcPg - 1];
        } else if (
          rawSrcPg &&
          combinedSlicePages &&
          rawSrcPg >= 1 &&
          rawSrcPg <= combinedSlicePages.length &&
          allowedQuestionPages.includes(combinedSlicePages[rawSrcPg - 1])
        ) {
          parsedSourcePage = combinedSlicePages[rawSrcPg - 1];
        } else {
          // Estimate proportionally within the chunk's physical pages (e.g. 2-page chunk)
          const posIdx = Math.min(
            allowedQuestionPages.length - 1,
            Math.floor((localIdx / Math.max(1, rawQuestions.length)) * allowedQuestionPages.length)
          );
          parsedSourcePage = allowedQuestionPages[posIdx] ?? fallbackSourcePage;
        }
      } else {
        parsedSourcePage = rawSrcPg ?? fallbackSourcePage;
      }

      const rawAnsPg = parsePositiveInt(q.answerPage);
      let parsedAnswerPage: number | undefined = rawAnsPg;
      if (rawAnsPg && allowedAnswerPages && allowedAnswerPages.length > 0) {
        if (allowedAnswerPages.includes(rawAnsPg)) {
          parsedAnswerPage = rawAnsPg;
        } else if (
          combinedSlicePages &&
          rawAnsPg >= 1 &&
          rawAnsPg <= combinedSlicePages.length &&
          allowedAnswerPages.includes(combinedSlicePages[rawAnsPg - 1])
        ) {
          parsedAnswerPage = combinedSlicePages[rawAnsPg - 1];
        } else if (rawAnsPg >= 1 && rawAnsPg <= allowedAnswerPages.length && allowedAnswerPages[0] > allowedAnswerPages.length) {
          parsedAnswerPage = allowedAnswerPages[rawAnsPg - 1];
        } else {
          parsedAnswerPage = undefined;
        }
      }

      const isMatch =
        q.formatCategoryId === 'match' ||
        q.type === 'match' ||
        (rawItems && rawItems.length >= 2);

      if (isMatch) {
        const itmCount = rawItems ? rawItems.length : q.marks || 4;
        out.push(
          sanitizeQuestionMathText(
            {
              id: `q-${ch.chapterNumber}-${qIdx + 1}`,
              question: serialMeta.cleanedText || 'ಹೊಂದಿಸಿ ಬರೆಯಿರಿ :',
              answer: q.answer || '',
              questionType: q.questionType || 'ಹೊಂದಿಸಿ ಬರೆಯಿರಿ',
              formatCategoryId: 'match',
              formatCategoryName: `೫. ಹೊಂದಿಸಿ ಬರೆಯಿರಿ (${itmCount}M)`,
              marks: Math.max(3, itmCount),
              difficulty: q.difficulty || 'ಸಾಧಾರಣ',
              objective: q.objective || 'ಜ್ಞಾನ',
              objectiveName: q.objective || 'ಜ್ಞಾನ',
              learningOutcome: q.learning_outcome || q.learningOutcome || `LO ${ch.chapterNumber}`,
              options: undefined,
              items: rawItems,
              hasDiagram: Boolean(q.hasDiagram),
              diagramDescription: q.diagramDescription || undefined,
              chapterId: ch.chapterId,
              chapterName: ch.chapterName,
              chapterNumber: ch.chapterNumber,
              questionNumber: parsedQNum,
              printedSerial: parsedSerial,
              sourcePage: parsedSourcePage,
              answerPage: parsedAnswerPage,
            },
            subjectHint
          )
        );
        return;
      }

      // Unbundle numbered sub-questions if Gemini combined them into a single text block
      const qText = String(q.question || '').trim();
      const ansText = String(q.answer || '').trim();
      const numRegex = /(?:^|\n)\s*(\d{1,2})[\.\)]\s*/g;
      const qMatches = [...qText.matchAll(numRegex)];

      if (qMatches.length >= 3 && !q.options?.length) {
        const pattern = /(?:^|\n)\s*(\d{1,2})[\.\)]\s*/;
        const qParts = qText.split(pattern);
        const mainHeader = qParts[0].trim();
        const aParts = ansText.split(pattern);
        const aMap: Record<string, string> = {};
        for (let i = 1; i < aParts.length; i += 2) {
          aMap[aParts[i]] = (aParts[i + 1] || '').trim();
        }

        for (let i = 1; i < qParts.length; i += 2) {
          const subNum = qParts[i];
          const subBody = (qParts[i + 1] || '').trim();
          if (!subBody) continue;
          out.push(
            sanitizeQuestionMathText(
              {
                id: `q-${ch.chapterNumber}-${qIdx + 1}_sub${subNum}`,
                question: subBody,
                answer: aMap[subNum] || ansText || 'ಉತ್ತರವನ್ನು ಪರಿಶೀಲಿಸಿ',
                questionType: mainHeader || 'ಒಂದು ವಾಕ್ಯದಲ್ಲಿ ಉತ್ತರಿಸಿ',
                formatCategoryId: 'one_sentence',
                formatCategoryName: '೧. ಒಂದು ವಾಕ್ಯದ ಪ್ರಶ್ನೆ (1M)',
                marks: 1,
                difficulty: q.difficulty || 'ಸುಲಭ',
                objective: q.objective || 'ಜ್ಞಾನ',
                objectiveName: q.objective || 'ಜ್ಞಾನ',
                learningOutcome: q.learning_outcome || q.learningOutcome || `LO ${ch.chapterNumber}`,
                options: undefined,
                items: undefined,
                chapterId: ch.chapterId,
                chapterName: ch.chapterName,
                chapterNumber: ch.chapterNumber,
                questionNumber: parsePositiveInt(subNum) ?? parsedQNum,
                printedSerial: subNum,
                sourcePage: parsedSourcePage,
                answerPage: parsedAnswerPage,
              },
              subjectHint
            )
          );
        }
        return;
      }

      out.push(
        sanitizeQuestionMathText(
          {
            id: `q-${ch.chapterNumber}-${qIdx + 1}`,
            question: serialMeta.cleanedText || q.question || '',
            answer: q.answer || 'ಉತ್ತರವನ್ನು ಪರಿಶೀಲಿಸಿ',
            questionType: q.questionType || q.type || 'ಸಾಮಾನ್ಯ ಪ್ರಶ್ನೆ',
            formatCategoryId: q.formatCategoryId || 'one_sentence',
            formatCategoryName: q.formatCategoryName || '೧. ಒಂದು ವಾಕ್ಯದ ಪ್ರಶ್ನೆ (1M)',
            marks: q.marks || 1,
            difficulty: q.difficulty || 'ಸಾಧಾರಣ',
            objective:
              q.objective ||
              (qIdx % 4 === 0 ? 'ಜ್ಞಾನ' : qIdx % 4 === 1 ? 'ತಿಳುವಳಿಕೆ' : qIdx % 4 === 2 ? 'ಅನ್ವಯ' : 'ಕೌಶಲ'),
            objectiveName:
              q.objective ||
              (qIdx % 4 === 0 ? 'ಜ್ಞಾನ' : qIdx % 4 === 1 ? 'ತಿಳುವಳಿಕೆ' : qIdx % 4 === 2 ? 'ಅನ್ವಯ' : 'ಕೌಶಲ'),
            learningOutcome: q.learning_outcome || q.learningOutcome || `LO ${ch.chapterNumber}`,
            options: q.options || undefined,
            items: q.items || undefined,
            hasDiagram: Boolean(q.hasDiagram),
            diagramDescription: q.diagramDescription || undefined,
            chapterId: ch.chapterId,
            chapterName: ch.chapterName,
            chapterNumber: ch.chapterNumber,
            questionNumber: parsedQNum,
            printedSerial: parsedSerial,
            sourcePage: parsedSourcePage,
            answerPage: parsedAnswerPage,
          },
          subjectHint
        )
      );
    });
    return out;
  };

  // Cooperative Pause / Resume / Cancel / Restart controls for active extraction
  const handlePauseResumeExtraction = () => {
    if (!isAnyExtractionRunning) return;
    if (extractionPausedRef.current) {
      extractionPausedRef.current = false;
      setIsExtractionPaused(false);
      wakePauseWaiters();
      setExtractionLog(prev => [...prev, '▶ ಪ್ರಕ್ರಿಯೆಯನ್ನು ಮುಂದುವರಿಸಲಾಗಿದೆ (Extraction Resumed).']);
    } else {
      extractionPausedRef.current = true;
      setIsExtractionPaused(true);
      setExtractionLog(prev => [
        ...prev,
        '⏸ ಪ್ರಕ್ರಿಯೆಯನ್ನು ವಿರಾಮಗೊಳಿಸಲಾಗಿದೆ (Paused) — ಪ್ರಸ್ತುತ ಭಾಗ ಮುಗಿದ ನಂತರ ವಿರಾಮದಲ್ಲಿರುತ್ತದೆ.',
      ]);
    }
  };

  const handleCancelExtraction = (silent = false) => {
    const hadActive = isAnyExtractionRunning || Boolean(extractionAbortRef.current);
    extractionRunIdRef.current += 1;
    extractionCancelledRef.current = true;
    extractionPausedRef.current = false;
    setIsExtractionPaused(false);
    wakePauseWaiters();
    if (extractionAbortRef.current) {
      extractionAbortRef.current.abort();
      extractionAbortRef.current = null;
    }
    setIsExtracting(false);
    setActiveExtractionChapterId(null);
    setCurrentProcessingChapter('');
    setExtractionChunkProgress(null);

    setDetectedDoc(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        chapters: prev.chapters.map(c =>
          c.status === 'processing'
            ? {
                ...c,
                status: extractedChaptersCache[c.chapterId] ? ('done' as const) : ('pending' as const),
              }
            : c
        ),
      };
    });

    if (!silent && hadActive) {
      setExtractionLog(prev => [...prev, '🛑 ಪ್ರಕ್ರಿಯೆಯನ್ನು ರದ್ದುಗೊಳಿಸಲಾಗಿದೆ (Extraction Cancelled).']);
    }
  };

  const handleRestartExtraction = (overrideChapter?: DetectedChapter) => {
    const job = lastExtractionJobRef.current;
    const chapterToRestart =
      overrideChapter ||
      (job?.mode === 'single'
        ? detectedDoc?.chapters.find(c => c.chapterId === job.chapterId)
        : undefined);
    const batchOnlyFailed = job?.mode === 'batch' ? job.onlyFailed : false;

    handleCancelExtraction(true);
    setExtractionLog(prev => [
      ...prev,
      '🔄 ಹೊರತೆಗೆಯುವ ಪ್ರಕ್ರಿಯೆಯನ್ನು ಮರುಪ್ರಾರಂಭಿಸಲಾಗುತ್ತಿದೆ (Restarting Extraction)...',
    ]);

    window.setTimeout(() => {
      if (chapterToRestart) {
        handleExtractSingleChapter(chapterToRestart);
      } else if (job?.mode === 'batch') {
        handleStartExtraction(batchOnlyFailed);
      }
    }, 120);
  };

  // Safe base64 ceiling (~5.5 MB PDF -> ~7.5 MB JSON) so scanned LBA PDFs never trigger Cloud Run payload/proxy drops
  const MAX_SAFE_BASE64_CHARS = 7_500_000;

  // Submit a long-running Gemini extraction task as a non-blocking async server job and poll until completion.
  // Eliminates 60s reverse-proxy HTTP timeouts ("TypeError: Failed to fetch") and tolerates brief network blips!
  const runAsyncAiJob = async (
    startUrl: string,
    payloadJson: string,
    signal: AbortSignal,
    fallbackMsg: string
  ): Promise<any> => {
    const startRes = await fetch(startUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payloadJson,
      signal,
    });
    const startData = await parseJsonResponse(startRes, fallbackMsg);
    if (startData.immediate) {
      return startData;
    }
    if (!startData.success || !startData.jobId) {
      throw new Error(startData.error || fallbackMsg);
    }

    const jobId = String(startData.jobId);
    const onAbortCancelJob = () => {
      void fetch(`/api/ai/job/${encodeURIComponent(jobId)}/cancel`, {
        method: 'POST',
        keepalive: true,
      }).catch(() => {});
    };
    signal.addEventListener('abort', onAbortCancelJob, { once: true });

    try {
      let consecutivePollBlips = 0;
      const maxWaitMs = 6 * 60 * 1000; // 6 minutes ceiling per single chunk
      const startedAt = Date.now();

      while (Date.now() - startedAt < maxWaitMs) {
        await abortableSleep(1800, signal);

        try {
          const pollRes = await fetch(`/api/ai/job/${encodeURIComponent(jobId)}`, {
            method: 'GET',
            cache: 'no-store',
            signal,
          });
          const pollData = await parseJsonResponse(pollRes, fallbackMsg);
          consecutivePollBlips = 0;

          if (pollData.status === 'done') {
            return pollData;
          }
          if (pollData.status === 'cancelled') {
            throw createExtractionAbortError();
          }
          if (pollData.status === 'error' || pollData.status === 'not_found') {
            const err: any = new Error(pollData.error || fallbackMsg);
            err.quotaExhausted = Boolean(pollData.quotaExhausted);
            throw err;
          }
        } catch (pollErr: any) {
          if (isExtractionAbortError(pollErr, signal)) {
            throw pollErr;
          }
          const isTransient =
            pollErr?.name === 'TypeError' ||
            pollErr?.isRetryableProxy ||
            String(pollErr).includes('Failed to fetch');
          if (isTransient && consecutivePollBlips < 6) {
            consecutivePollBlips += 1;
            await abortableSleep(1500 * consecutivePollBlips, signal);
            continue;
          }
          throw pollErr;
        }
      }

      throw new Error('ಅಧ್ಯಾಯ ಹೊರತೆಗೆಯಲು ಹೆಚ್ಚು ಸಮಯ ತೆಗೆದುಕೊಳ್ಳುತ್ತಿದೆ (Timeout). ದಯವಿಟ್ಟು "ಮರುಪ್ರಾರಂಭಿಸಿ (Restart)" ಕ್ಲಿಕ್ ಮಾಡಿ.');
    } finally {
      signal.removeEventListener('abort', onAbortCancelJob);
    }
  };

  // Helper: extract 100% of questions & answers for a single chapter using fine-grained chunks,
  // adaptive payload sizing, non-blocking async server jobs, exact physical PDF page mapping,
  // automatic missing-answer recovery pass, and Pause/Cancel/Restart support!
  const extractSingleChapterCore = async (
    ch: DetectedChapter,
    buffer: ArrayBuffer,
    runId: number,
    signal: AbortSignal
  ): Promise<Chapter> => {
    const explicitAnsPages = ch.answerPages?.trim();
    const effectiveAnswerPages = explicitAnsPages || globalAnswerKeyRange.trim();

    let qIndices: number[] = [];
    let aIndices: number[] = [];

    if (totalPages > 0) {
      qIndices = parsePageRangeString(ch.questionPages || '', totalPages);
      aIndices = parsePageRangeString(effectiveAnswerPages, totalPages);

      // If no per-chapter answer pages and global key is huge, narrow to generous proportional window (max 12 pages)
      if (!explicitAnsPages && aIndices.length > 12 && detectedDoc?.chapters?.length) {
        const totalCh = Math.max(1, detectedDoc.chapters.length);
        const chPos = Math.max(0, (ch.chapterNumber || 1) - 1);
        const startIdx = Math.max(0, Math.floor((chPos / totalCh) * aIndices.length) - 2);
        aIndices = aIndices.slice(startIdx, startIdx + 12);
      }
    }

    // Fallback page window only if question pages were completely empty
    if (qIndices.length === 0) {
      qIndices = Array.from({ length: Math.min(6, totalPages || 6) }, (_, idx) =>
        Math.min((ch.chapterNumber - 1) * 6 + idx, Math.max(0, (totalPages || 10) - 1))
      );
    }

    // Use small 2-page question chunks (3 pages only if chapter > 16 pages) so dense 80+ question
    // Maths/Science chapters NEVER hit model output truncation!
    const CHUNK_SIZE = qIndices.length > 16 ? 3 : 2;
    const qChunks: number[][] = [];
    for (let i = 0; i < qIndices.length; i += CHUNK_SIZE) {
      qChunks.push(qIndices.slice(i, i + CHUNK_SIZE));
    }

    const allRawQList: QuestionItem[] = [];
    let lastError: any = null;

    for (let cIdx = 0; cIdx < qChunks.length; cIdx++) {
      await waitIfPausedOrCancelled(runId, signal);

      const qChunk = qChunks[cIdx];
      const chunkStartPage = qChunk[0] + 1;
      const chunkEndPage = qChunk[qChunk.length - 1] + 1;
      const chunkPageLabel =
        chunkEndPage > chunkStartPage ? `${chunkStartPage}-${chunkEndPage}` : String(chunkStartPage);

      setExtractionChunkProgress({
        current: cIdx + 1,
        total: qChunks.length,
        label: `ಪುಟ ${chunkPageLabel}`,
      });

      // Pair this question chunk with chapter answer key pages (adaptive size-capped so upload never stalls/drops)
      let chunkAnsIndices = aIndices;
      if (aIndices.length > 8) {
        const startA = Math.max(0, Math.floor((cIdx / qChunks.length) * aIndices.length) - 1);
        chunkAnsIndices = aIndices.slice(startA, startA + 8);
      }

      let combinedIndices = Array.from(new Set([...qChunk, ...chunkAnsIndices])).sort((a, b) => a - b);
      let slice = await slicePdfPages(buffer, combinedIndices);

      // Adaptive payload size guard: shrink attached answer pages if scanned PDF slice is too large
      if (slice.base64.length > MAX_SAFE_BASE64_CHARS && chunkAnsIndices.length > 4) {
        const startA = Math.max(0, Math.floor((cIdx / qChunks.length) * aIndices.length));
        chunkAnsIndices = aIndices.slice(startA, startA + 4);
        combinedIndices = Array.from(new Set([...qChunk, ...chunkAnsIndices])).sort((a, b) => a - b);
        slice = await slicePdfPages(buffer, combinedIndices);
      }
      if (slice.base64.length > MAX_SAFE_BASE64_CHARS && chunkAnsIndices.length > 0) {
        // Send question pages cleanly first; the dedicated answer-recovery pass below will attach all answers!
        chunkAnsIndices = [];
        combinedIndices = [...qChunk].sort((a, b) => a - b);
        slice = await slicePdfPages(buffer, combinedIndices);
      }
      if (slice.base64.length > MAX_SAFE_BASE64_CHARS && qChunk.length > 1) {
        // Ultra-high-DPI scanned textbook: split this chunk into single pages dynamically
        const singlePages = qChunk.map(p => [p]);
        qChunks.splice(cIdx, 1, ...singlePages);
        cIdx -= 1;
        continue;
      }

      const qSet = new Set(qChunk);
      const aSet = new Set(chunkAnsIndices);

      await waitIfPausedOrCancelled(runId, signal);

      // Build explicit physical page mapping so Gemini records accurate `sourcePage` and `answerPage`
      const slicePageMap = combinedIndices
        .map((origIdx, slicePos) => {
          const origPage = origIdx + 1;
          const roles: string[] = [];
          if (qSet.has(origIdx)) roles.push('QUESTIONS');
          if (aSet.has(origIdx)) roles.push('ANSWER KEY');
          return `Slice page ${slicePos + 1} = Original PDF page ${origPage} (${roles.join(' + ')})`;
        })
        .join('\n');

      const ansLabel =
        chunkAnsIndices.length > 0
          ? `${chunkAnsIndices[0] + 1}-${chunkAnsIndices[chunkAnsIndices.length - 1] + 1}`
          : effectiveAnswerPages;

      const chunkInfo =
        qChunks.length > 1
          ? `Part ${cIdx + 1} of ${qChunks.length} (PDF pages ${chunkPageLabel})`
          : `PDF pages ${chunkPageLabel}`;

      const payload = JSON.stringify({
        base64Pdf: slice.base64,
        chapterName: ch.chapterName,
        chapterNumber: ch.chapterNumber,
        questionPages: chunkPageLabel,
        answerPages: ansLabel,
        slicePageMap,
        chunkInfo,
        metadata: detectedDoc?.metadata,
      });

      let chunkSucceeded = false;
      for (let attempt = 1; attempt <= 3; attempt++) {
        await waitIfPausedOrCancelled(runId, signal);
        try {
          const resData = await runAsyncAiJob(
            '/api/ai/extract-chapter-job',
            payload,
            signal,
            'ಅಧ್ಯಾಯದ ಪ್ರಶ್ನೆಗಳನ್ನು ಹೊರತೆಗೆಯಲು ಸಾಧ್ಯವಾಗಲಿಲ್ಲ.'
          );

          const chData = resData.data;
          const normalized = normalizeRawQuestions(
            Array.isArray(chData?.questions) ? chData.questions : [],
            ch,
            allRawQList.length,
            chunkStartPage,
            qChunk.map(idx => idx + 1),
            chunkAnsIndices.map(idx => idx + 1),
            combinedIndices.map(idx => idx + 1)
          );
          allRawQList.push(...normalized);

          if (qChunks.length > 1) {
            setExtractionLog(prev => [
              ...prev,
              `  📄 ಅಧ್ಯಾಯ ${ch.chapterNumber} — ಭಾಗ ${cIdx + 1}/${qChunks.length} (ಪುಟ ${chunkPageLabel}): ${normalized.length} ಪ್ರಶ್ನೆಗಳು`,
            ]);
          }

          chunkSucceeded = true;
          break;
        } catch (err: any) {
          if (isExtractionAbortError(err, signal)) {
            throw err;
          }
          lastError = err;
          const isFetchErr =
            err.name === 'TypeError' ||
            err.isRetryableProxy ||
            String(err).includes('Failed to fetch') ||
            String(err).includes('Unexpected token');
          if (isFetchErr && attempt < 3) {
            console.log(
              `Retryable error on chapter ${ch.chapterNumber} chunk ${cIdx + 1}/${qChunks.length} (attempt ${attempt}), retrying...`
            );
            setExtractionLog(prev => [
              ...prev,
              `  ⚠️ ಭಾಗ ${cIdx + 1}/${qChunks.length} ನೆಟ್‌ವರ್ಕ್ ಅಡಚಣೆ — ಮರುಪ್ರಯತ್ನಿಸಲಾಗುತ್ತಿದೆ (${attempt}/3)...`,
            ]);
            await abortableSleep(attempt * 2500, signal);
            continue;
          }
          break;
        }
      }

      if (!chunkSucceeded) {
        const rawMsg = String(lastError?.message || '');
        if (rawMsg.includes('Failed to fetch') || lastError?.name === 'TypeError') {
          throw new Error(
            `ಅಧ್ಯಾಯ ${ch.chapterNumber} (ಪುಟ ${chunkPageLabel}): ಸರ್ವರ್ ಸಂಪರ್ಕ ತಾತ್ಕಾಲಿಕವಾಗಿ ಕಡಿತಗೊಂಡಿದೆ (Network/Server unreachable). ದಯವಿಟ್ಟು "ಮರುಪ್ರಾರಂಭಿಸಿ (Restart)" ಕ್ಲಿಕ್ ಮಾಡಿ.`
          );
        }
        throw lastError || new Error(`ಅಧ್ಯಾಯ ${ch.chapterNumber} ಭಾಗ ${cIdx + 1} ಹೊರತೆಗೆಯಲು ವಿಫಲವಾಗಿದೆ.`);
      }

      // Short pause between chunks to keep API smooth
      if (cIdx < qChunks.length - 1) {
        await abortableSleep(500, signal);
      }
    }

    await waitIfPausedOrCancelled(runId, signal);

    // Deduplicate across chunks using generic-stem-safe & PUA-glyph-safe matching while preserving order & unique IDs
    const qList: QuestionItem[] = [];
    const safeChPrefix = String(ch.chapterId || `ch-${ch.chapterNumber}`).replace(/[^a-zA-Z0-9_-]/g, '_');
    for (const item of allRawQList) {
      const fp = normalizeQuestionFingerprint(item.question);
      if (!fp) continue;
      const existingIdx = qList.findIndex(existing => areQuestionsDuplicates(existing, item));
      if (existingIdx >= 0) {
        // If duplicate appears in overlapping chunk with a better/fuller answer or valid questionNumber, upgrade it
        const ex = qList[existingIdx];
        const betterAnswer =
          (isAnswerMissingOrIncomplete(ex) && !isAnswerMissing(item.answer)) ||
          (!isAnswerMissing(item.answer) && String(item.answer || '').trim().length > String(ex.answer || '').trim().length + 25);
        qList[existingIdx] = {
          ...ex,
          answer: betterAnswer ? item.answer : ex.answer,
          answerPage: item.answerPage ?? ex.answerPage,
          sourcePage: ex.sourcePage ?? item.sourcePage,
          questionNumber: ex.questionNumber ?? item.questionNumber,
          printedSerial: ex.printedSerial ?? item.printedSerial,
          imageUrl: ex.imageUrl || item.imageUrl,
          answerImageUrl: ex.answerImageUrl || item.answerImageUrl,
        };
        continue;
      }
      qList.push({
        ...item,
        id: `${safeChPrefix}-q-${qList.length + 1}`,
      });
    }

    // Automatic Missing OR Summarized-Stub Answer Recovery Pass:
    // If any questions lack answers OR only have 1-line stubs like "Proof: Using incidence and reflection laws.",
    // run a dedicated pass against the chapter's answer key pages to transcribe the COMPLETE verbatim answer!
    const missingAnsItems = qList.filter(q => isAnswerMissingOrIncomplete(q));
    if (missingAnsItems.length > 0 && aIndices.length > 0) {
      await waitIfPausedOrCancelled(runId, signal);
      try {
        setExtractionLog(prev => [
          ...prev,
          `  🔍 ಅಧ್ಯಾಯ ${ch.chapterNumber}: ಬಾಕಿ/ಸಂಕ್ಷಿಪ್ತ ${missingAnsItems.length} ಪ್ರಶ್ನೆಗಳಿಗೆ ಸಂಪೂರ್ಣ ವಿವರವಾದ ಉತ್ತರಗಳನ್ನು ಹೊಂದಿಸಲಾಗುತ್ತಿದೆ...`,
        ]);

        // Size-bounded answer slice so heavy scanned answer keys never exceed upload limit
        let ansSliceIndices = aIndices.slice(0, 12);
        let ansSlice = await slicePdfPages(buffer, ansSliceIndices);
        while (ansSlice.base64.length > MAX_SAFE_BASE64_CHARS && ansSliceIndices.length > 2) {
          ansSliceIndices = ansSliceIndices.slice(0, Math.max(2, Math.floor(ansSliceIndices.length / 2)));
          ansSlice = await slicePdfPages(buffer, ansSliceIndices);
        }
        const answerPageMap = ansSliceIndices
          .map((origIdx, sPos) => `Slice page ${sPos + 1} = Original PDF page ${origIdx + 1}`)
          .join('\n');

        let totalRecovered = 0;
        const BATCH_SIZE = 20;
        const totalBatches = Math.ceil(missingAnsItems.length / BATCH_SIZE);
        for (let b = 0; b < missingAnsItems.length; b += BATCH_SIZE) {
          await waitIfPausedOrCancelled(runId, signal);
          setExtractionChunkProgress({
            current: Math.floor(b / BATCH_SIZE) + 1,
            total: totalBatches,
            label: 'ಉತ್ತರ ಹೊಂದಾಣಿಕೆ',
          });
          const batch = missingAnsItems.slice(b, b + BATCH_SIZE);
          const matchPayload = JSON.stringify({
            base64Pdf: ansSlice.base64,
            chapterName: ch.chapterName,
            chapterNumber: ch.chapterNumber,
            missingQuestions: batch.map((mq, idx) => {
              const foundPos = qList.findIndex(x => x.id === mq.id);
              return {
                id: mq.id,
                questionNumber: mq.questionNumber ?? (foundPos >= 0 ? foundPos + 1 : idx + 1),
                printedSerial: mq.printedSerial,
                marks: mq.marks,
                question: mq.question,
                options: mq.options,
              };
            }),
            answerPageMap,
            metadata: detectedDoc?.metadata,
          });

          const matchData = await runAsyncAiJob(
            '/api/ai/match-missing-answers-job',
            matchPayload,
            signal,
            'ಉತ್ತರ ಹೊಂದಾಣಿಕೆ ವಿಫಲವಾಗಿದೆ.'
          ).catch((e: any) => {
            if (isExtractionAbortError(e, signal)) throw e;
            return null;
          });

          if (matchData?.success && Array.isArray(matchData.answers)) {
            const ansById = new Map<string, { answer: string; answerPage?: number }>();
            for (const a of matchData.answers) {
              if (a?.id && a?.answer && !isAnswerMissing(a.answer)) {
                ansById.set(String(a.id), { answer: a.answer, answerPage: a.answerPage });
              }
            }
            for (let qi = 0; qi < qList.length; qi++) {
              const found = ansById.get(qList[qi].id);
              if (
                found &&
                (isAnswerMissing(qList[qi].answer) ||
                  (isAnswerMissingOrIncomplete(qList[qi]) &&
                    found.answer.trim().length > String(qList[qi].answer || '').trim().length + 15))
              ) {
                qList[qi] = {
                  ...qList[qi],
                  answer: found.answer,
                  answerPage: found.answerPage ?? qList[qi].answerPage,
                };
                totalRecovered += 1;
              }
            }
          }
        }

        if (totalRecovered > 0) {
          setExtractionLog(prev => [
            ...prev,
            `  ✅ ಅಧ್ಯಾಯ ${ch.chapterNumber}: ${totalRecovered}/${missingAnsItems.length} ಪ್ರಶ್ನೆಗಳಿಗೆ ಸಂಪೂರ್ಣ ವಿವರವಾದ ಉತ್ತರಗಳನ್ನು ಜೋಡಿಸಲಾಗಿದೆ!`,
          ]);
        }
      } catch (ansErr: any) {
        if (isExtractionAbortError(ansErr, signal)) {
          throw ansErr;
        }
        console.warn('Missing-answer recovery pass skipped:', ansErr);
      }
    }

    // If serial numbers restart across main sections (e.g., Prose #1, Grammar #1, Poem #1),
    // assign continuous 1..N serial numbers while preserving exact PDF top-to-bottom order.
    const finalQList = hasRepeatingOrRestartingSerials(qList)
      ? qList.map((item, idx) => ({
          ...item,
          questionNumber: idx + 1,
          printedSerial: String(idx + 1),
        }))
      : qList;

    return {
      chapterId: ch.chapterId,
      chapterNumber: ch.chapterNumber,
      chapterName: ch.chapterName,
      semester: (ch.semester as 1 | 2) || (ch.chapterNumber > 5 ? 2 : 1),
      printedPages: ch.printedPages,
      questionPages: ch.questionPages,
      answerPages: ch.answerPages || effectiveAnswerPages || undefined,
      questions: finalQList,
    };
  };

  // Extract or Retry a single chapter (with Pause / Resume / Cancel / Restart support)
  const handleExtractSingleChapter = async (targetCh: DetectedChapter) => {
    if (!detectedDoc) return;

    let buffer = fileBuffer;
    if (!buffer && selectedFile) {
      buffer = await selectedFile.arrayBuffer();
      setFileBuffer(buffer);
    }
    if (!buffer) {
      showErrorNotice(
        'PDF ಫೈಲ್ ಮೆಮೊರಿಯಿಂದ ತೆರವುಗೊಂಡಿದೆ (ಪುಟ ರೀಲೋಡ್ ಆದ ಕಾರಣ). ದಯವಿಟ್ಟು ಮೇಲೆ ಕಾಣುವ "ಅದೇ PDF ಫೈಲ್ ಮರು-ಆಯ್ಕೆಮಾಡಿ" ಬಟನ್ ಮೂಲಕ ನಿಮ್ಮ PDF ಅನ್ನು ಆಯ್ಕೆ ಮಾಡಿ.'
      );
      return;
    }

    const runId = ++extractionRunIdRef.current;
    extractionCancelledRef.current = false;
    extractionPausedRef.current = false;
    setIsExtractionPaused(false);
    setExtractionElapsedSec(0);
    setExtractionChunkProgress(null);
    if (extractionAbortRef.current) {
      extractionAbortRef.current.abort();
    }
    const controller = new AbortController();
    extractionAbortRef.current = controller;
    lastExtractionJobRef.current = { mode: 'single', chapterId: targetCh.chapterId };
    setActiveExtractionChapterId(targetCh.chapterId);

    setDetectedDoc(prev =>
      prev
        ? {
            ...prev,
            chapters: prev.chapters.map(c =>
              c.chapterId === targetCh.chapterId
                ? { ...c, status: 'processing' as const, errorMessage: undefined }
                : c
            ),
          }
        : prev
    );
    setCurrentProcessingChapter(`ಅಧ್ಯಾಯ ${targetCh.chapterNumber}: ${targetCh.chapterName}`);

    setExtractionLog(prev => [
      ...prev,
      `⏳ ಅಧ್ಯಾಯ ${targetCh.chapterNumber}: "${targetCh.chapterName}" ನ ಪ್ರಶ್ನೋತ್ತರ ಹೊರತೆಗೆಯಲಾಗುತ್ತಿದೆ...`,
    ]);

    try {
      const extractedCh = await extractSingleChapterCore(targetCh, buffer, runId, controller.signal);
      if (extractionRunIdRef.current !== runId) return;

      setExtractedChaptersCache(prev => ({ ...prev, [targetCh.chapterId]: extractedCh }));

      setDetectedDoc(prev =>
        prev
          ? {
              ...prev,
              chapters: prev.chapters.map(c =>
                c.chapterId === targetCh.chapterId
                  ? { ...c, status: 'done' as const, extractedCount: extractedCh.questions.length }
                  : c
              ),
            }
          : prev
      );

      setExtractionLog(prev => [
        ...prev,
        `✅ ಅಧ್ಯಾಯ ${targetCh.chapterNumber} ಪೂರ್ಣಗೊಂಡಿದೆ: ${extractedCh.questions.length} ಪ್ರಶ್ನೆಗಳು ಸೇರ್ಪಡೆಯಾಗಿವೆ.`,
      ]);
    } catch (err: any) {
      if (isExtractionAbortError(err, controller.signal) || extractionRunIdRef.current !== runId) {
        return;
      }
      console.error(`Error in chapter ${targetCh.chapterNumber}:`, err);
      setDetectedDoc(prev =>
        prev
          ? {
              ...prev,
              chapters: prev.chapters.map(c =>
                c.chapterId === targetCh.chapterId
                  ? { ...c, status: 'error' as const, errorMessage: err.message || 'ದೋಷ ಕಂಡುಬಂದಿದೆ' }
                  : c
              ),
            }
          : prev
      );
      setExtractionLog(prev => [
        ...prev,
        `❌ ಅಧ್ಯಾಯ ${targetCh.chapterNumber} ದೋಷ: ${err.message || 'ದೋಷ ಸಂಭವಿಸಿದೆ'}`,
      ]);
    } finally {
      if (extractionRunIdRef.current === runId) {
        setActiveExtractionChapterId(null);
        setCurrentProcessingChapter('');
        setExtractionChunkProgress(null);
        setIsExtractionPaused(false);
        extractionPausedRef.current = false;
        extractionAbortRef.current = null;
      }
    }
  };

  // 3. Process All (or remaining) Chapters Step-by-Step with Safe Delays + Pause / Cancel / Restart support
  const handleStartExtraction = async (onlyFailed = false) => {
    if (!detectedDoc) return;

    let buffer = fileBuffer;
    if (!buffer && selectedFile) {
      buffer = await selectedFile.arrayBuffer();
      setFileBuffer(buffer);
    }
    if (!buffer) {
      showErrorNotice(
        'PDF ಫೈಲ್ ಮೆಮೊರಿಯಿಂದ ತೆರವುಗೊಂಡಿದೆ (ಪುಟ ರೀಲೋಡ್ ಆದ ಕಾರಣ). ದಯವಿಟ್ಟು ಮೇಲೆ ಕಾಣುವ "ಅದೇ PDF ಫೈಲ್ ಮರು-ಆಯ್ಕೆಮಾಡಿ" ಬಟನ್ ಮೂಲಕ ನಿಮ್ಮ PDF ಅನ್ನು ಆಯ್ಕೆ ಮಾಡಿ.'
      );
      return;
    }

    const runId = ++extractionRunIdRef.current;
    extractionCancelledRef.current = false;
    extractionPausedRef.current = false;
    setIsExtractionPaused(false);
    setExtractionElapsedSec(0);
    setExtractionChunkProgress(null);
    if (extractionAbortRef.current) {
      extractionAbortRef.current.abort();
    }
    const controller = new AbortController();
    extractionAbortRef.current = controller;
    lastExtractionJobRef.current = { mode: 'batch', onlyFailed };

    setIsExtracting(true);
    setExtractionLog([]);

    const chapters = detectedDoc.chapters.map(c => ({ ...c }));
    const newCache = { ...extractedChaptersCache };

    try {
      for (let i = 0; i < chapters.length; i++) {
        await waitIfPausedOrCancelled(runId, controller.signal);
        const ch = chapters[i];

        // If only retrying failed, skip non-failed
        if (onlyFailed && ch.status !== 'error') {
          continue;
        }

        // If already done, preserve and skip
        if (!onlyFailed && ch.status === 'done' && newCache[ch.chapterId]) {
          continue;
        }

        setActiveExtractionChapterId(ch.chapterId);
        setCurrentProcessingChapter(`ಅಧ್ಯಾಯ ${ch.chapterNumber}: ${ch.chapterName}`);
        ch.status = 'processing';
        setDetectedDoc(prev => (prev ? { ...prev, chapters: chapters.map(c => ({ ...c })) } : prev));

        setExtractionLog(prev => [
          ...prev,
          `⏳ ಅಧ್ಯಾಯ ${ch.chapterNumber}: "${ch.chapterName}" (ಪುಟಗಳು: ${ch.questionPages || 'ಸ್ವಯಂ'})`,
        ]);

        try {
          const extractedCh = await extractSingleChapterCore(ch, buffer, runId, controller.signal);
          if (extractionRunIdRef.current !== runId) return;

          newCache[ch.chapterId] = extractedCh;
          setExtractedChaptersCache({ ...newCache });

          ch.status = 'done';
          ch.extractedCount = extractedCh.questions.length;
          ch.errorMessage = undefined;

          setExtractionLog(prev => [
            ...prev,
            `✅ ಅಧ್ಯಾಯ ${ch.chapterNumber} ಪೂರ್ಣಗೊಂಡಿದೆ: ${extractedCh.questions.length} ಪ್ರಶ್ನೆಗಳು ಮತ್ತು ಅಧಿಕೃತ ಉತ್ತರಗಳು ಹೊಂದಿಕೆಯಾಗಿವೆ.`,
          ]);
        } catch (err: any) {
          if (isExtractionAbortError(err, controller.signal) || extractionRunIdRef.current !== runId) {
            ch.status = newCache[ch.chapterId] ? 'done' : 'pending';
            return;
          }
          console.error(`Error in chapter ${ch.chapterNumber}:`, err);
          ch.status = 'error';
          ch.errorMessage = err.message || 'ಪ್ರಕ್ರಿಯೆಯಲ್ಲಿ ದೋಷ';
          setExtractionLog(prev => [
            ...prev,
            `❌ ಅಧ್ಯಾಯ ${ch.chapterNumber} ದೋಷ: ${err.message || 'ದೋಷ ಸಂಭವಿಸಿದೆ'}`,
          ]);
        }

        setDetectedDoc(prev => (prev ? { ...prev, chapters: chapters.map(c => ({ ...c })) } : prev));

        // Polite pause between chapters to prevent rate-limit bursts
        await abortableSleep(1200, controller.signal);
      }
    } catch (err: any) {
      if (!isExtractionAbortError(err, controller.signal)) {
        console.error('Batch extraction error:', err);
      }
    } finally {
      if (extractionRunIdRef.current === runId) {
        setIsExtracting(false);
        setActiveExtractionChapterId(null);
        setCurrentProcessingChapter('');
        setExtractionChunkProgress(null);
        setIsExtractionPaused(false);
        extractionPausedRef.current = false;
        extractionAbortRef.current = null;

        // Check if at least some chapters succeeded
        const completedList = Object.values(newCache);
        if (completedList.length > 0) {
          assembleFinalBank(completedList);
        }
      }
    }
  };

  // Assemble complete QuestionBank JSON
  const assembleFinalBank = (chapterList: Chapter[]) => {
    if (!detectedDoc) return;

    const totalQuestionsCount = chapterList.reduce((sum, c) => sum + (c.questions?.length || 0), 0);
    const totalChapters = chapterList.length;
    const allSameSemester =
      totalChapters > 1 && chapterList.every(c => c.semester === chapterList[0]?.semester);

    const sortedChapters = chapterList
      .sort((a, b) => (a.chapterNumber ?? 0) - (b.chapterNumber ?? 0))
      .map((ch, idx) => {
        let sem: 1 | 2 = ch.semester as 1 | 2;
        if (allSameSemester || !sem) {
          const chNum = ch.chapterNumber ?? idx + 1;
          sem = chNum <= Math.ceil(totalChapters / 2) ? 1 : 2;
        }
        return {
          ...ch,
          semester: sem,
        };
      });

    const finalBank: QuestionBank = {
      metadata: {
        ...(generatedBank?.metadata?.id ? { id: generatedBank.metadata.id } : {}),
        title: detectedDoc.metadata.title,
        grade: detectedDoc.metadata.grade,
        gradeKey: detectedDoc.metadata.gradeKey,
        subject: detectedDoc.metadata.subject,
        subjectCode: detectedDoc.metadata.subjectCode,
        medium: detectedDoc.metadata.medium,
        academicYear: detectedDoc.metadata.academicYear,
        department: detectedDoc.metadata.department,
        institution: detectedDoc.metadata.institution,
        totalChapters: sortedChapters.length,
        totalQuestions: totalQuestionsCount,
        verified: true,
        no_ai_generated_questions: true,
        source_pdf: fileName || generatedBank?.metadata?.source_pdf,
        ...(activePdfId
          ? {
              sourcePdfId: activePdfId,
              sourcePdfUrl: `/api/uploaded-pdf/${activePdfId}`,
            }
          : generatedBank?.metadata?.sourcePdfId
            ? {
                sourcePdfId: generatedBank.metadata.sourcePdfId,
                sourcePdfUrl: generatedBank.metadata.sourcePdfUrl,
              }
            : {}),
      },
      chapters: sortedChapters,
    };

    const sanitizedFinalBank = ensureUniqueQuestionIds(finalBank);
    setGeneratedBank(sanitizedFinalBank);
    setRawJsonString(JSON.stringify(sanitizedFinalBank, null, 2));
  };

  // Move directly to review step with completed chapters
  const handleProceedToReview = () => {
    const completedList = Object.values(extractedChaptersCache);
    if (completedList.length === 0) {
      showErrorNotice('ದಯವಿಟ್ಟು ಕನಿಷ್ಠ ಒಂದು ಅಧ್ಯಾಯದ ಪ್ರಶ್ನೆಗಳನ್ನು ಹೊರತೆಗೆಯಿರಿ.');
      return;
    }
    assembleFinalBank(completedList);
    setStep(3);
  };

  // Save an individual chapter directly (downloads unit JSON locally AND smart-merges into previous all-units bank in Server + Firebase!)
  const handleSaveSingleChapter = async (chapterId: string) => {
    const ch = extractedChaptersCache[chapterId];
    if (!ch) {
      showErrorNotice('ಈ ಪಾಠದ ಪ್ರಶ್ನೋತ್ತರಗಳನ್ನು ಮೊದಲು ಹೊರತೆಗೆಯಿರಿ.');
      return;
    }

    const singleBank: QuestionBank = {
      metadata: {
        title: `${detectedDoc?.metadata.title || 'LBA Bank'} - ${ch.chapterName}`,
        grade: detectedDoc?.metadata.grade || '6 ನೇ ತರಗತಿ',
        gradeKey: detectedDoc?.metadata.gradeKey || '6',
        subject: detectedDoc?.metadata.subject || 'ವಿಷಯ',
        subjectCode: detectedDoc?.metadata.subjectCode || 'GEN',
        medium: detectedDoc?.metadata.medium || 'ಕನ್ನಡ ಮಾಧ್ಯಮ (State Syllabus)',
        academicYear: detectedDoc?.metadata.academicYear || '2026-27',
        totalChapters: 1,
        totalQuestions: ch.questions.length,
        verified: true,
        source_pdf: fileName,
      },
      chapters: [ch],
    };

    // Download JSON for this single chapter
    const jsonBlob = new Blob([JSON.stringify(singleBank, null, 2)], {
      type: 'application/json;charset=utf-8',
    });
    const downloadUrl = URL.createObjectURL(jsonBlob);
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = `${ch.chapterName.replace(/\s+/g, '_')}_QA_Bank.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(downloadUrl);

    // Smart-Merge into the existing all-units bank before persisting to Server & Firebase!
    let mergeNote = '';
    try {
      const { bankToSave, mergeStats, mergedIntoExisting } = await prepareSmartMergedBank(singleBank);
      let persistedBank = bankToSave;

      try {
        const response = await fetch('/api/save-question-bank', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ questionBank: bankToSave }),
        });
        if (response.ok) {
          const resData = await response.json().catch(() => null);
          if (resData?.entry?.id) {
            persistedBank = {
              ...bankToSave,
              metadata: { ...bankToSave.metadata, id: resData.entry.id },
            };
          }
          if (resData?.entry) {
            onLoadGeneratedBank(persistedBank, resData.entry, false);
          }
        }
      } catch (srvErr) {
        console.warn('Server single-chapter smart merge save error:', srvErr);
      }

      try {
        await saveQuestionBankToFirebase(persistedBank);
      } catch (fbErr) {
        console.warn('Firebase single chapter save error:', fbErr);
      }

      if (mergedIntoExisting && mergeStats) {
        mergeNote = `\n${formatMergeSummaryKannada(mergeStats)}`;
      }
      refreshSavedBanks();
    } catch (mergeErr) {
      console.warn('Single chapter smart merge failed:', mergeErr);
    }

    setSaveSuccessMessage(
      `"${ch.chapterName}" ಪಾಠವನ್ನು JSON ಆಗಿ ಡೌನ್‌ಲೋಡ್ ಮಾಡಲಾಗಿದೆ ಮತ್ತು ಎಲ್ಲಾ ಘಟಕಗಳ ಫೈಲ್‌ನೊಂದಿಗೆ ಉಳಿಸಲಾಗಿದೆ!${mergeNote}`
    );
    setTimeout(() => setSaveSuccessMessage(null), 7000);
  };

  // Extract the first physical page number from a range string like "15-22"
  const getFirstPageNumber = (rangeStr?: string): number => {
    if (!rangeStr) return 1;
    const m = rangeStr.match(/\d+/);
    return m ? Math.max(1, parseInt(m[0], 10)) : 1;
  };

  // Open Image/Crop Modal with a stable navigable queue snapshot so teacher can move Prev/Next from inside modal
  const openAiImageModal = (
    chapterId: string,
    question: QuestionItem,
    queueSource: QuestionItem[],
    explicitSlot?: 'question' | 'question2' | 'answer' | 'answer2',
    queueLabel?: string
  ) => {
    const list =
      queueSource.length > 0 && queueSource.some(item => item.id === question.id)
        ? queueSource
        : [question];
    const snapshot = list.map(item => {
      const req = detectImageRequirement(item);
      const slot: 'question' | 'answer' = req.suggestedSlot === 'answer' ? 'answer' : 'question';
      return {
        chapterId: item.chapterId || chapterId,
        questionId: item.id,
        defaultSlot: slot,
      };
    });
    const startIdx = Math.max(
      0,
      snapshot.findIndex(
        item => item.questionId === question.id && item.chapterId === (question.chapterId || chapterId)
      )
    );
    setEditingImageTarget({
      chapterId: question.chapterId || chapterId,
      question,
      initialSlot: explicitSlot || snapshot[startIdx]?.defaultSlot || 'question',
      queue: snapshot,
      queueIndex: startIdx,
      queueLabel,
    });
  };

  // Navigate Prev/Next question right inside the open AI Generator Image/Crop Modal
  const handleNavigateAiModalQuestion = (delta: -1 | 1) => {
    if (!editingImageTarget?.queue || editingImageTarget.queueIndex === undefined) return;
    const nextIdx = editingImageTarget.queueIndex + delta;
    if (nextIdx < 0 || nextIdx >= editingImageTarget.queue.length) return;
    const nextEntry = editingImageTarget.queue[nextIdx];
    const nextCh =
      generatedBank?.chapters.find(c => c.chapterId === nextEntry.chapterId) ||
      extractedChaptersCache[nextEntry.chapterId];
    const nextQ = nextCh?.questions.find(q => q.id === nextEntry.questionId);
    if (!nextQ) return;
    setEditingImageTarget({
      ...editingImageTarget,
      chapterId: nextEntry.chapterId,
      question: nextQ,
      initialSlot: nextEntry.defaultSlot,
      queueIndex: nextIdx,
    });
  };

  // Save attached/cropped question & answer images into cache, generatedBank & rawJsonString
  const handleSaveAiQuestionImage = (update: QuestionImageUpdate) => {
    if (!editingImageTarget) return;
    const { chapterId, question: targetQ } = editingImageTarget;

    const applyUpdate = (q: QuestionItem): QuestionItem =>
      q.id === targetQ.id
        ? {
            ...q,
            imageUrl: update.imageUrl,
            imageUrl2: update.imageUrl2,
            diagramSvg: update.diagramSvg,
            answerImageUrl: update.answerImageUrl,
            answerImageUrl2: update.answerImageUrl2,
            answerDiagramSvg: update.answerDiagramSvg,
            hasDiagram: update.hasDiagram,
            needsImage:
              update.needsImage !== undefined
                ? update.needsImage
                : update.hasDiagram
                  ? true
                  : q.needsImage,
            diagramDescription: update.diagramDescription,
            answerDiagramDescription: update.answerDiagramDescription,
            objective: update.hasDiagram && !q.objective ? 'ಕೌಶಲ' : q.objective,
          }
        : q;

    setExtractedChaptersCache(prev => {
      const ch = prev[chapterId];
      if (!ch) return prev;
      return {
        ...prev,
        [chapterId]: {
          ...ch,
          questions: ch.questions.map(applyUpdate),
        },
      };
    });

    setGeneratedBank(prev => {
      if (!prev) return prev;
      const updatedBank: QuestionBank = {
        ...prev,
        chapters: prev.chapters.map(ch =>
          ch.chapterId === chapterId
            ? { ...ch, questions: ch.questions.map(applyUpdate) }
            : ch
        ),
      };
      setRawJsonString(JSON.stringify(updatedBank, null, 2));
      return updatedBank;
    });

    setSaveSuccessMessage(
      update.needsImage === false
        ? 'ಈ ಪ್ರಶ್ನೆಗೆ "ಚಿತ್ರ ಅಗತ್ಯವಿಲ್ಲ" ಎಂದು ಗುರುತಿಸಲಾಗಿದೆ.'
        : 'ಚಿತ್ರವನ್ನು Firebase ನಲ್ಲಿ ಉಳಿಸಿ, URL ಅನ್ನು ಪ್ರಶ್ನೆಗೆ ಜೋಡಿಸಲಾಗಿದೆ!'
    );
    setTimeout(() => setSaveSuccessMessage(null), 4000);
  };

  // Delete an attached question or answer image inline (cleans Firebase + server cache + JSON state)
  const handleDeleteAiQuestionImage = async (
    chapterId: string,
    questionItem: QuestionItem,
    slot: 'question' | 'question2' | 'answer' | 'answer2'
  ) => {
    const urlToRemove =
      slot === 'question'
        ? questionItem.imageUrl
        : slot === 'question2'
          ? questionItem.imageUrl2
          : slot === 'answer'
            ? questionItem.answerImageUrl
            : questionItem.answerImageUrl2;
    const imageId = extractImageIdFromUrl(urlToRemove);
    if (imageId) {
      deleteQuestionImageFromFirebase(imageId).catch(() => {});
      fetch(`/api/question-image/${imageId}`, { method: 'DELETE' }).catch(() => {});
    }

    const clearSlot = (q: QuestionItem): QuestionItem => {
      if (q.id !== questionItem.id) return q;
      const next: QuestionItem = {
        ...q,
        imageUrl: slot === 'question' ? undefined : q.imageUrl,
        imageUrl2: slot === 'question2' ? undefined : q.imageUrl2,
        diagramSvg: slot === 'question' ? undefined : q.diagramSvg,
        answerImageUrl: slot === 'answer' ? undefined : q.answerImageUrl,
        answerImageUrl2: slot === 'answer2' ? undefined : q.answerImageUrl2,
        answerDiagramSvg: slot === 'answer' ? undefined : q.answerDiagramSvg,
      };
      next.hasDiagram = Boolean(
        next.imageUrl ||
          next.imageUrl2 ||
          next.diagramSvg ||
          next.answerImageUrl ||
          next.answerImageUrl2 ||
          next.answerDiagramSvg
      );
      return next;
    };

    setExtractedChaptersCache(prev => {
      const ch = prev[chapterId];
      if (!ch) return prev;
      return {
        ...prev,
        [chapterId]: {
          ...ch,
          questions: ch.questions.map(clearSlot),
        },
      };
    });

    setGeneratedBank(prev => {
      if (!prev) return prev;
      const updatedBank: QuestionBank = {
        ...prev,
        chapters: prev.chapters.map(ch =>
          ch.chapterId === chapterId
            ? { ...ch, questions: ch.questions.map(clearSlot) }
            : ch
        ),
      };
      setRawJsonString(JSON.stringify(updatedBank, null, 2));
      return updatedBank;
    });

    setSaveSuccessMessage(
      `${slot === 'question' ? 'ಪ್ರಶ್ನೆ ಚಿತ್ರ' : 'ಉತ್ತರ ಚಿತ್ರ'} ಡಿಲೀಟ್ ಮಾಡಲಾಗಿದೆ (Firebase ನಿಂದಲೂ ತೆರವುಗೊಂಡಿದೆ).`
    );
    setTimeout(() => setSaveSuccessMessage(null), 4000);
  };

  // Mark / dismiss whether a question requires an image (for false positives in Step 3)
  const handleToggleAiQuestionNeedsImage = (
    chapterId: string,
    questionItem: QuestionItem,
    needs: boolean
  ) => {
    const applyFlag = (q: QuestionItem): QuestionItem =>
      q.id === questionItem.id
        ? { ...q, needsImage: needs, ...(needs ? {} : { hasDiagram: false }) }
        : q;

    setExtractedChaptersCache(prev => {
      const ch = prev[chapterId];
      if (!ch) return prev;
      return {
        ...prev,
        [chapterId]: { ...ch, questions: ch.questions.map(applyFlag) },
      };
    });

    setGeneratedBank(prev => {
      if (!prev) return prev;
      const updatedBank: QuestionBank = {
        ...prev,
        chapters: prev.chapters.map(ch =>
          ch.chapterId === chapterId
            ? { ...ch, questions: ch.questions.map(applyFlag) }
            : ch
        ),
      };
      setRawJsonString(JSON.stringify(updatedBank, null, 2));
      return updatedBank;
    });
  };

  // 4. Download Actual .json File
  const handleDownloadJson = () => {
    if (!generatedBank) return;

    const jsonBlob = new Blob([rawJsonString], { type: 'application/json;charset=utf-8' });
    const downloadUrl = URL.createObjectURL(jsonBlob);
    const link = document.createElement('a');

    const sub = (generatedBank.metadata.subject || 'Subject').replace(/\s+/g, '_');
    const gr = (generatedBank.metadata.grade || 'Class').replace(/\s+/g, '_');
    link.href = downloadUrl;
    link.download = `${gr}_${sub}_LBA_Question_Bank.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(downloadUrl);
  };

  // Smart-Merge Helper: automatically detects an existing saved bank for the same Class + Subject + Medium,
  // merges newly extracted questions in while PRESERVING ALL previously uploaded images & preventing duplicates!
  const prepareSmartMergedBank = async (
    rawBank: QuestionBank
  ): Promise<{
    bankToSave: QuestionBank;
    mergeStats: SmartMergeStats | null;
    mergedIntoExisting: boolean;
  }> => {
    const resolvedGradeKey = extractGradeKey(
      rawBank.metadata.gradeKey ? String(rawBank.metadata.gradeKey) : rawBank.metadata.grade
    );
    const resolvedSubjectCode = deduceSubjectCode(
      rawBank.metadata.subjectCode ? String(rawBank.metadata.subjectCode) : undefined,
      rawBank.metadata.subject
    );

    const preparedIncoming: QuestionBank = sanitizeBankMathText({
      ...rawBank,
      metadata: {
        ...rawBank.metadata,
        grade: canonicalGradeLabel(resolvedGradeKey),
        gradeKey: resolvedGradeKey,
        subjectCode: resolvedSubjectCode,
        source_pdf: fileName || rawBank.metadata.source_pdf,
        ...(activePdfId
          ? {
              sourcePdfId: activePdfId,
              sourcePdfUrl: `/api/uploaded-pdf/${activePdfId}`,
            }
          : {}),
      },
    });

    try {
      // NEVER smart-merge into flawed built-in Class 6 files, and skip merge completely in Fresh Replace Mode!
      if (!replaceExistingMode) {
        const allSaved = await listAllSavedQuestionBanks();
        const nonBuiltinSaved = allSaved.filter(sb => sb.source !== 'builtin');
        const matchingSummary = pickBestMatchingBankCandidate(nonBuiltinSaved, preparedIncoming);

        if (matchingSummary) {
          const existingFullBank = await loadSavedQuestionBank(matchingSummary);
          if (existingFullBank && existingFullBank.chapters && existingFullBank.chapters.length > 0) {
            const { mergedBank, stats } = smartMergeQuestionBanks(existingFullBank, preparedIncoming);
            const ensured = ensureUniqueQuestionIds({
              ...mergedBank,
              metadata: {
                ...mergedBank.metadata,
                id: existingFullBank.metadata.id || matchingSummary.id,
                grade: canonicalGradeLabel(resolvedGradeKey),
                gradeKey: resolvedGradeKey,
                subjectCode: resolvedSubjectCode,
              },
            });
            return {
              bankToSave: ensured,
              mergeStats: stats,
              mergedIntoExisting: true,
            };
          }
        }
      }
    } catch (mergeCheckErr) {
      console.warn('Smart merge check skipped (saving directly):', mergeCheckErr);
    }

    const freshId =
      typeof preparedIncoming.metadata.id === 'string' &&
      preparedIncoming.metadata.id.trim() &&
      !preparedIncoming.metadata.id.endsWith('_class6')
        ? preparedIncoming.metadata.id
        : `rebuilt_class${resolvedGradeKey}_${resolvedSubjectCode.toLowerCase()}_${Date.now()}`;

    return {
      bankToSave: ensureUniqueQuestionIds({
        ...preparedIncoming,
        metadata: {
          ...preparedIncoming.metadata,
          id: freshId,
        },
      }),
      mergeStats: null,
      mergedIntoExisting: false,
    };
  };

  // 5. Save to Server Database & Firebase Cloud (auto-merges with existing same Class+Subject bank preserving all images!)
  const handleSaveToDatabase = async () => {
    if (!generatedBank) return;

    setIsSaving(true);
    setSaveSuccessMessage(null);

    try {
      const { bankToSave, mergeStats, mergedIntoExisting } = await prepareSmartMergedBank(generatedBank);

      const response = await fetch('/api/save-question-bank', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questionBank: bankToSave }),
      });

      const resData = await parseJsonResponse(response, 'ಉಳಿಸಲು ವಿಫಲವಾಗಿದೆ.');
      if (!resData.success) {
        throw new Error(resData.error || 'ಉಳಿಸಲು ವಿಫಲವಾಗಿದೆ.');
      }

      const persistedId = resData.entry?.id || bankToSave.metadata.id;
      const bankWithId: QuestionBank = {
        ...bankToSave,
        metadata: {
          ...bankToSave.metadata,
          ...(persistedId ? { id: persistedId } : {}),
        },
      };
      setGeneratedBank(bankWithId);
      setRawJsonString(JSON.stringify(bankWithId, null, 2));

      // Keep extractedChaptersCache in sync with merged chapters so UI shows preserved images + new questions immediately
      const syncedCache: Record<string, Chapter> = {};
      bankWithId.chapters.forEach(ch => {
        syncedCache[ch.chapterId] = ch;
      });
      setExtractedChaptersCache(syncedCache);

      const mergeLine = mergedIntoExisting && mergeStats ? `\n${formatMergeSummaryKannada(mergeStats)}` : '';

      // Also sync to Firebase Firestore
      try {
        await saveQuestionBankToFirebase(bankWithId);
        setSaveSuccessMessage(
          `✅ ಪ್ರಶ್ನೆ ಬ್ಯಾಂಕ್ ಶಾಶ್ವತವಾಗಿ ಸರ್ವರ್ ಮತ್ತು Firebase ಕ್ಲೌಡ್‌ಗೆ ಉಳಿಸಲಾಗಿದೆ!${mergeLine}`
        );
      } catch (fbErr: any) {
        console.error('Firebase cloud sync failed while saving question bank:', fbErr);
        setSaveSuccessMessage(
          `⚠️ ಸರ್ವರ್ ಡೇಟಾಬೇಸ್‌ಗೆ ಉಳಿಸಲಾಗಿದೆ, ಆದರೆ Firebase ಕ್ಲೌಡ್ ಸಿಂಕ್ ವಿಫಲವಾಗಿದೆ (${fbErr?.message || 'Cloud error'}).${mergeLine}`
        );
      }

      // Register in App state WITHOUT leaving Step 3!
      if (resData.entry) {
        onLoadGeneratedBank(bankWithId, resData.entry, false);
      }
      refreshSavedBanks();
    } catch (err: any) {
      showErrorNotice(err.message || 'ಡೇಟಾಬೇಸ್‌ಗೆ ಉಳಿಸುವಲ್ಲಿ ದೋಷ ಕಂಡುಬಂದಿದೆ.');
    } finally {
      setIsSaving(false);
    }
  };

  // Save to Firebase Firestore Cloud (also applies Smart Merge preserving existing images!)
  const handleSaveToFirebaseOnly = async () => {
    if (!generatedBank) return;

    setIsSaving(true);
    setSaveSuccessMessage(null);

    try {
      const { bankToSave, mergeStats, mergedIntoExisting } = await prepareSmartMergedBank(generatedBank);
      const bankId = await saveQuestionBankToFirebase(bankToSave);

      const bankWithId: QuestionBank = {
        ...bankToSave,
        metadata: {
          ...bankToSave.metadata,
          id: bankId,
        },
      };
      setGeneratedBank(bankWithId);
      setRawJsonString(JSON.stringify(bankWithId, null, 2));

      const mergeLine = mergedIntoExisting && mergeStats ? `\n${formatMergeSummaryKannada(mergeStats)}` : '';
      setSaveSuccessMessage(
        `✅ ಪ್ರಶ್ನೆ ಬ್ಯಾಂಕ್ Firebase Firestore ಕ್ಲೌಡ್‌ಗೆ ಯಶಸ್ವಿಯಾಗಿ ಉಳಿಸಲಾಗಿದೆ!${mergeLine}`
      );

      const resolvedGradeKey = extractGradeKey(
        bankWithId.metadata.gradeKey ? String(bankWithId.metadata.gradeKey) : bankWithId.metadata.grade
      );
      const resolvedSubjectCode = deduceSubjectCode(
        bankWithId.metadata.subjectCode ? String(bankWithId.metadata.subjectCode) : undefined,
        bankWithId.metadata.subject
      );

      const entry: IndexEntry = {
        id: bankId,
        path: `firebase://${bankId}`,
        grade: canonicalGradeLabel(resolvedGradeKey),
        gradeKey: resolvedGradeKey,
        subject: bankWithId.metadata.subject,
        subjectCode: resolvedSubjectCode,
        medium: bankWithId.metadata.medium || 'ಕನ್ನಡ ಮಾಧ್ಯಮ (State Syllabus)',
        academicYear: String(bankWithId.metadata.academicYear || '2026-27'),
        totalChapters: bankWithId.chapters.length,
        totalQuestions: bankWithId.chapters.reduce((sum, ch) => sum + (ch.questions?.length || 0), 0),
        isUserGenerated: true,
      };

      onLoadGeneratedBank(bankWithId, entry, false);
      refreshSavedBanks();
    } catch (err: any) {
      showErrorNotice('Firebase ಗೆ ಉಳಿಸುವಲ್ಲಿ ದೋಷ: ' + (err.message || String(err)));
    } finally {
      setIsSaving(false);
    }
  };

  // 6. Open Immediately in Question Paper Generator
  const handleLoadInQPGenerator = () => {
    if (!generatedBank) return;

    const resolvedGradeKey = extractGradeKey(
      generatedBank.metadata.gradeKey
        ? String(generatedBank.metadata.gradeKey)
        : generatedBank.metadata.grade
    );
    const resolvedSubjectCode = deduceSubjectCode(
      generatedBank.metadata.subjectCode ? String(generatedBank.metadata.subjectCode) : undefined,
      generatedBank.metadata.subject
    );

    const entry: IndexEntry = {
      id: (generatedBank.metadata.id as string) || `generated_${Date.now()}`,
      path: '',
      grade: canonicalGradeLabel(resolvedGradeKey),
      gradeKey: resolvedGradeKey,
      subject: generatedBank.metadata.subject,
      subjectCode: resolvedSubjectCode,
      medium: generatedBank.metadata.medium,
      academicYear: String(generatedBank.metadata.academicYear || '2026-27'),
      isUserGenerated: true,
    };

    onLoadGeneratedBank(generatedBank, entry, true);
    onBackToApp();
  };

  // 6b. Open Immediately in Question Bank Explorer / Image Upload Manager
  const handleOpenInExplorerForImages = () => {
    if (!generatedBank) return;
    const resolvedGradeKey = extractGradeKey(
      generatedBank.metadata.gradeKey
        ? String(generatedBank.metadata.gradeKey)
        : generatedBank.metadata.grade
    );
    const resolvedSubjectCode = deduceSubjectCode(
      generatedBank.metadata.subjectCode ? String(generatedBank.metadata.subjectCode) : undefined,
      generatedBank.metadata.subject
    );
    const bankId =
      (typeof generatedBank.metadata.id === 'string' && generatedBank.metadata.id) ||
      `rebuilt_class${resolvedGradeKey}_${resolvedSubjectCode.toLowerCase()}_${Date.now()}`;
    const entry: IndexEntry = {
      id: bankId,
      path: `firebase://${bankId}`,
      grade: canonicalGradeLabel(resolvedGradeKey),
      gradeKey: resolvedGradeKey,
      subject: generatedBank.metadata.subject,
      subjectCode: resolvedSubjectCode,
      medium: generatedBank.metadata.medium || 'ಕನ್ನಡ ಮಾಧ್ಯಮ (State Syllabus)',
      academicYear: String(generatedBank.metadata.academicYear || '2026-27'),
      totalChapters: generatedBank.chapters.length,
      totalQuestions: generatedBank.chapters.reduce((sum, ch) => sum + (ch.questions?.length || 0), 0),
      isUserGenerated: true,
    };
    if (onOpenInImageExplorer) {
      onOpenInImageExplorer(generatedBank, entry);
    } else {
      onLoadGeneratedBank(generatedBank, entry, false);
    }
  };

  // Chapter-wise Diagram Audit & Duplicate Audit for Step 3
  const step3Audit = useMemo(() => computeBankImageAudit(generatedBank), [generatedBank]);
  const step3DuplicateAudit = useMemo(
    () => (generatedBank ? deduplicateQuestionBank(generatedBank) : null),
    [generatedBank]
  );

  // One-click Remove Duplicates & Save in Step 3 (preserves 100% of uploaded images!)
  const handleRemoveDuplicatesInStep3 = async () => {
    if (!generatedBank) return;
    const res = deduplicateQuestionBank(generatedBank);
    if (res.removedDuplicates === 0) {
      setSaveSuccessMessage('✅ ಯಾವುದೇ ಡುಪ್ಲಿಕೇಟ್ ಪ್ರಶ್ನೆಗಳು ಕಂಡುಬಂದಿಲ್ಲ — ಎಲ್ಲಾ ಪ್ರಶ್ನೆಗಳು ಅನನ್ಯವಾಗಿವೆ (0 Duplicates)!');
      setTimeout(() => setSaveSuccessMessage(null), 5000);
      return;
    }

    setIsSaving(true);
    setSaveSuccessMessage(null);
    try {
      const cleanedBank: QuestionBank = {
        ...res.cleanedBank,
        metadata: {
          ...res.cleanedBank.metadata,
          updatedAt: new Date().toISOString(),
        },
      };
      setGeneratedBank(cleanedBank);
      setRawJsonString(JSON.stringify(cleanedBank, null, 2));
      const syncedCache: Record<string, Chapter> = {};
      cleanedBank.chapters.forEach(ch => {
        syncedCache[ch.chapterId] = ch;
      });
      setExtractedChaptersCache(syncedCache);

      const [serverRes] = await Promise.allSettled([
        fetch('/api/save-question-bank', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ questionBank: cleanedBank }),
        }).then(r => (r.ok ? r.json() : null)),
        saveQuestionBankToFirebase(cleanedBank),
      ]);

      if (serverRes.status === 'fulfilled' && serverRes.value?.entry) {
        onLoadGeneratedBank(cleanedBank, serverRes.value.entry, false);
      }
      refreshSavedBanks();

      setSaveSuccessMessage(
        `✅ ${res.removedDuplicates} ಡುಪ್ಲಿಕೇಟ್ ಪ್ರಶ್ನೆಗಳನ್ನು (${res.chaptersAffected} ಅಧ್ಯಾಯಗಳಲ್ಲಿ) ತೆಗೆದುಹಾಕಿ ಶಾಶ್ವತವಾಗಿ ಉಳಿಸಲಾಗಿದೆ (${res.totalQuestionsBefore} → ${res.totalQuestionsAfter} ಪ್ರಶ್ನೆಗಳು · ಎಲ್ಲಾ ಚಿತ್ರಗಳು ಸುರಕ್ಷಿತವಾಗಿವೆ)!`
      );
      setTimeout(() => setSaveSuccessMessage(null), 8000);
    } catch (err: any) {
      showErrorNotice(`ಡುಪ್ಲಿಕೇಟ್ ತೆಗೆದುಹಾಕುವಲ್ಲಿ ದೋಷ: ${err?.message || 'ದೋಷ'}`);
    } finally {
      setIsSaving(false);
    }
  };

  // Filtered Questions for Preview (includes 4-mode Image Filter + Incomplete Answer Filter)
  const [showShortAnswersOnly, setShowShortAnswersOnly] = useState<boolean>(false);
  const [editingTextQueue, setEditingTextQueue] = useState<
    Array<{ chapterId: string; questionId: string }>
  >([]);
  const [editingTextIndex, setEditingTextIndex] = useState<number>(-1);
  const [confirmDeleteStep3Key, setConfirmDeleteStep3Key] = useState<string | null>(null);

  const isStep3BriefAnswer = (q: QuestionItem): boolean => {
    if (isAnswerMissingOrIncomplete(q)) return true;
    const marks = Number(q.marks || 1);
    const ansLen = String(q.answer || '').trim().length;
    return marks >= 2 && ansLen < 75 && !q.answerImageUrl && !q.answerDiagramSvg;
  };

  const allQuestions = generatedBank?.chapters.flatMap(c => c.questions) || [];
  const step3ShortAnswerCount = allQuestions.filter(q => {
    if (previewChapterFilter !== 'all' && q.chapterId !== previewChapterFilter) return false;
    return isStep3BriefAnswer(q);
  }).length;

  const filteredQuestions = allQuestions.filter(q => {
    if (previewChapterFilter !== 'all' && q.chapterId !== previewChapterFilter) return false;
    if (previewFormatFilter !== 'all' && q.formatCategoryId !== previewFormatFilter) return false;
    if (!matchesImageFilter(q, previewImageFilter)) return false;
    if (showShortAnswersOnly && !isStep3BriefAnswer(q)) return false;
    if (searchQuery.trim()) {
      const sq = searchQuery.toLowerCase();
      return (
        q.question.toLowerCase().includes(sq) ||
        q.answer.toLowerCase().includes(sq) ||
        (q.options && q.options.some(o => o.toLowerCase().includes(sq)))
      );
    }
    return true;
  });

  const activeStep3EditQuestion = useMemo(() => {
    if (!generatedBank || editingTextIndex < 0 || editingTextIndex >= editingTextQueue.length) {
      return null;
    }
    const target = editingTextQueue[editingTextIndex];
    const ch = generatedBank.chapters.find(c => c.chapterId === target.chapterId);
    return ch?.questions.find(q => q.id === target.questionId) || null;
  }, [generatedBank, editingTextQueue, editingTextIndex]);

  const openStep3TextEditModal = (q: QuestionItem) => {
    const list = filteredQuestions.some(item => item.id === q.id && item.chapterId === q.chapterId)
      ? filteredQuestions
      : allQuestions;
    const snapshot = list.map(item => ({ chapterId: item.chapterId, questionId: item.id }));
    const startIdx = Math.max(
      0,
      snapshot.findIndex(item => item.questionId === q.id && item.chapterId === q.chapterId)
    );
    setEditingTextQueue(snapshot);
    setEditingTextIndex(startIdx);
  };

  const handleSaveStep3QuestionText = async (update: QuestionTextUpdate) => {
    if (!generatedBank || !activeStep3EditQuestion) return;
    const targetId = activeStep3EditQuestion.id;
    const targetChId = activeStep3EditQuestion.chapterId;

    const updatedChapters = generatedBank.chapters.map(ch => {
      if (ch.chapterId !== targetChId) return ch;
      return {
        ...ch,
        questions: ch.questions.map(q =>
          q.id === targetId
            ? {
                ...q,
                question: update.question,
                answer: update.answer,
                marks: update.marks,
                difficulty: update.difficulty,
                questionNumber: update.questionNumber,
                printedSerial: update.printedSerial,
                options: update.options,
                ...(update.answerPage ? { answerPage: update.answerPage } : {}),
              }
            : q
        ),
      };
    });

    const updatedBank: QuestionBank = {
      ...generatedBank,
      metadata: {
        ...generatedBank.metadata,
        updatedAt: new Date().toISOString(),
      },
      chapters: updatedChapters,
    };

    setGeneratedBank(updatedBank);
    setRawJsonString(JSON.stringify(updatedBank, null, 2));
    const nextCache: Record<string, Chapter> = {};
    updatedChapters.forEach(c => {
      nextCache[c.chapterId] = c;
    });
    setExtractedChaptersCache(nextCache);

    const [serverRes] = await Promise.allSettled([
      fetch('/api/save-question-bank', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questionBank: updatedBank }),
      }).then(r => (r.ok ? r.json() : null)),
      saveQuestionBankToFirebase(updatedBank),
    ]);

    if (serverRes.status === 'fulfilled' && serverRes.value?.entry) {
      onLoadGeneratedBank(updatedBank, serverRes.value.entry, false);
    }
    setSaveSuccessMessage(
      '✅ ಪ್ರಶ್ನೆ ಮತ್ತು ವಿವರವಾದ ಉತ್ತರವನ್ನು JSON & Firebase ಕ್ಲೌಡ್‌ನಲ್ಲಿ ಶಾಶ್ವತವಾಗಿ ಉಳಿಸಲಾಗಿದೆ!'
    );
    setTimeout(() => setSaveSuccessMessage(null), 5000);
  };

  const handleDeleteStep3Question = async (qItem: QuestionItem) => {
    if (!generatedBank) return;

    const qImgId = extractImageIdFromUrl(qItem.imageUrl);
    if (qImgId) {
      deleteQuestionImageFromFirebase(qImgId).catch(() => {});
      fetch(`/api/question-image/${qImgId}`, { method: 'DELETE' }).catch(() => {});
    }
    const aImgId = extractImageIdFromUrl(qItem.answerImageUrl);
    if (aImgId) {
      deleteQuestionImageFromFirebase(aImgId).catch(() => {});
      fetch(`/api/question-image/${aImgId}`, { method: 'DELETE' }).catch(() => {});
    }

    const updatedChapters = generatedBank.chapters.map(ch => {
      if (ch.chapterId !== qItem.chapterId) return ch;
      const remaining = ch.questions.filter(q => q.id !== qItem.id);
      return {
        ...ch,
        questions: remaining,
        questionCount: remaining.length,
      };
    });

    const updatedBank: QuestionBank = {
      ...generatedBank,
      metadata: {
        ...generatedBank.metadata,
        updatedAt: new Date().toISOString(),
      },
      chapters: updatedChapters,
    };

    setConfirmDeleteStep3Key(null);
    setGeneratedBank(updatedBank);
    setRawJsonString(JSON.stringify(updatedBank, null, 2));
    const nextCache: Record<string, Chapter> = {};
    updatedChapters.forEach(c => {
      nextCache[c.chapterId] = c;
    });
    setExtractedChaptersCache(nextCache);

    if (editingTextQueue.length > 0) {
      const nextQueue = editingTextQueue.filter(
        item => !(item.chapterId === qItem.chapterId && item.questionId === qItem.id)
      );
      setEditingTextQueue(nextQueue);
      if (nextQueue.length === 0) {
        setEditingTextIndex(-1);
      } else {
        setEditingTextIndex(prev => Math.min(prev, nextQueue.length - 1));
      }
    }

    const [serverRes] = await Promise.allSettled([
      fetch('/api/save-question-bank', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questionBank: updatedBank }),
      }).then(r => (r.ok ? r.json() : null)),
      saveQuestionBankToFirebase(updatedBank),
    ]);

    if (serverRes.status === 'fulfilled' && serverRes.value?.entry) {
      onLoadGeneratedBank(updatedBank, serverRes.value.entry, false);
    }
    const serialLabel = qItem.printedSerial || qItem.questionNumber;
    setSaveSuccessMessage(
      `✅ ಪ್ರಶ್ನೆ ${serialLabel ? `#${serialLabel} ` : ''}ಶಾಶ್ವತವಾಗಿ ಡಿಲೀಟ್ ಮಾಡಿ JSON & Firebase ಕ್ಲೌಡ್‌ನಲ್ಲಿ ನವೀಕರಿಸಲಾಗಿದೆ!`
    );
    setTimeout(() => setSaveSuccessMessage(null), 5000);
  };

  return (
    <div className="space-y-6 font-kannada">
      
      {/* Top Header Card */}
      <div className="bg-white rounded-2xl border border-slate-200/90 p-5 sm:p-6 shadow-xs flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-linear-to-tr from-purple-600 via-indigo-600 to-blue-600 text-white flex items-center justify-center shadow-md">
            <Cpu className="w-6 h-6 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg sm:text-xl font-black text-slate-900 tracking-tight">
                AI ಪ್ರಶ್ನೆ ಬ್ಯಾಂಕ್ ಜನರೇಟರ್ (AI JSON Question Bank Generator)
              </h1>
              <span className="px-2.5 py-0.5 rounded-full text-2xs font-extrabold bg-purple-100 text-purple-800 border border-purple-200">
                Gemini OCR
              </span>
            </div>
            <p className="text-xs text-slate-500 font-medium mt-0.5">
              ಕರ್ನಾಟಕ DSERT LBA ಪಿಡಿಎಫ್‌ಗಳಿಂದ ಪ್ರಶ್ನೋತ್ತರಗಳನ್ನು ಅಕ್ಷರಶಃ ಹೊರತೆಗೆದು ಅಧಿಕೃತ QPG JSON ಮಾದರಿಯನ್ನು ರಚಿಸಿ.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Start New PDF / Reset Button */}
          {(step > 1 || selectedFile || detectedDoc || generatedBank) && (
            <button
              type="button"
              onClick={handleResetAndStartNewPdf}
              className="px-3.5 py-2 bg-rose-50 hover:bg-rose-100 text-rose-800 border border-rose-300 font-extrabold text-xs rounded-xl transition-all cursor-pointer flex items-center gap-1.5 shadow-2xs"
              title="ಹೊಸ PDF ಅಪ್‌ಲೋಡ್ ಮಾಡಿ ಅಥವಾ ಮೊದಲಿನಿಂದ ಪ್ರಾರಂಭಿಸಿ"
            >
              <RotateCcw className="w-3.5 h-3.5 text-rose-600" />
              <span>ಹೊಸ PDF / ಮೊದಲಿನಿಂದ ಪ್ರಾರಂಭಿಸಿ</span>
            </button>
          )}

          {/* Quick JSON Bank Uploader */}
          <div className="relative">
            <input
              type="file"
              accept=".json,application/json"
              onChange={handleDirectJsonUpload}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
            />
            <button
              type="button"
              className="px-3.5 py-2 bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-300 font-extrabold text-xs rounded-xl transition-all cursor-pointer flex items-center gap-1.5 shadow-2xs"
              title="ಸಿದ್ಧವಿರುವ JSON ಪ್ರಶ್ನೆಕೋಶ ಅಪ್‌ಲೋಡ್ ಮಾಡಿ"
            >
              <FileJson className="w-3.5 h-3.5 text-amber-700" />
              <span>JSON ಅಪ್‌ಲೋಡ್ (.json)</span>
            </button>
          </div>

          <button
            type="button"
            onClick={onBackToApp}
            className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-xs rounded-xl transition-colors cursor-pointer flex items-center gap-1.5"
          >
            <span>← ಪ್ರಶ್ನೆ ಪತ್ರಿಕೆ ರಚನಾ ಸಾಧನ</span>
          </button>
        </div>
      </div>

      {actionError && (
        <div className="bg-rose-50 border border-rose-200 text-rose-900 rounded-xl px-4 py-3 flex items-center justify-between gap-3 text-xs font-bold shadow-xs">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{actionError}</span>
          </div>
          <button
            type="button"
            onClick={() => setActionError(null)}
            className="text-rose-700 hover:text-rose-950 font-black px-2 py-0.5 rounded-lg hover:bg-rose-100 cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

      {/* Step Stepper Indicator */}
      <div className="grid grid-cols-3 gap-3">
        <div
          className={`p-3 rounded-xl border flex items-center gap-2.5 transition-all ${
            step === 1
              ? 'bg-white border-indigo-600 shadow-xs ring-1 ring-indigo-500/30'
              : step > 1
              ? 'bg-emerald-50 border-emerald-300 text-emerald-900'
              : 'bg-white border-slate-200 text-slate-400'
          }`}
        >
          <div
            className={`w-6 h-6 rounded-full font-black text-xs flex items-center justify-center ${
              step === 1
                ? 'bg-indigo-600 text-white'
                : step > 1
                ? 'bg-emerald-600 text-white'
                : 'bg-slate-200 text-slate-600'
            }`}
          >
            {step > 1 ? <Check className="w-3.5 h-3.5" /> : '1'}
          </div>
          <div>
            <span className="text-xs font-black block">ಹಂತ ೧: PDF ಅಥವಾ JSON ಆಯ್ಕೆ</span>
            <span className="text-2xs text-slate-500">ಪಿಡಿಎಫ್ ಸ್ಕ್ಯಾನ್ / JSON ಅಪ್‌ಲೋಡ್</span>
          </div>
        </div>

        <div
          className={`p-3 rounded-xl border flex items-center gap-2.5 transition-all ${
            step === 2
              ? 'bg-white border-indigo-600 shadow-xs ring-1 ring-indigo-500/30'
              : step > 2
              ? 'bg-emerald-50 border-emerald-300 text-emerald-900'
              : 'bg-white border-slate-200 text-slate-400'
          }`}
        >
          <div
            className={`w-6 h-6 rounded-full font-black text-xs flex items-center justify-center ${
              step === 2
                ? 'bg-indigo-600 text-white'
                : step > 2
                ? 'bg-emerald-600 text-white'
                : 'bg-slate-200 text-slate-600'
            }`}
          >
            {step > 2 ? <Check className="w-3.5 h-3.5" /> : '2'}
          </div>
          <div>
            <span className="text-xs font-black block">ಹಂತ ೨: ಅಧ್ಯಾಯವಾರು ಸಂಸ್ಕರಣೆ</span>
            <span className="text-2xs text-slate-500">ಪ್ರಶ್ನೆ & ಉತ್ತರ ಹೊಂದಾಣಿಕೆ</span>
          </div>
        </div>

        <div
          className={`p-3 rounded-xl border flex items-center gap-2.5 transition-all ${
            step === 3
              ? 'bg-white border-indigo-600 shadow-xs ring-1 ring-indigo-500/30'
              : 'bg-white border-slate-200 text-slate-400'
          }`}
        >
          <div
            className={`w-6 h-6 rounded-full font-black text-xs flex items-center justify-center ${
              step === 3 ? 'bg-indigo-600 text-white' : 'bg-slate-200 text-slate-600'
            }`}
          >
            3
          </div>
          <div>
            <span className="text-xs font-black block">ಹಂತ ೩: ಪರಿಶೀಲನೆ & ಉಳಿಸುವಿಕೆ</span>
            <span className="text-2xs text-slate-500">Firebase & Database ಸಂಗ್ರಹ</span>
          </div>
        </div>
      </div>

      {/* STEP 1: Two Clear Options: (A) Upload PDF or (B) Upload JSON */}
      {step === 1 && (
        <div className="space-y-6">
          {saveSuccessMessage && (
            <div className="p-3 bg-emerald-50 text-emerald-900 border border-emerald-200 rounded-xl text-xs font-bold flex items-center justify-between gap-2">
              <span>{saveSuccessMessage}</span>
              <button
                type="button"
                onClick={() => setSaveSuccessMessage(null)}
                className="text-emerald-700 hover:text-emerald-950 font-black px-2 py-0.5 rounded cursor-pointer"
              >
                ✕
              </button>
            </div>
          )}

          {/* Active Class 6 / Subject Fresh Rebuild Banner */}
          {activeRebuildTarget && (
            <div className="p-4 rounded-2xl bg-gradient-to-r from-orange-50 via-amber-50 to-orange-50 border-2 border-orange-300 shadow-xs flex flex-wrap items-center justify-between gap-3">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="px-2.5 py-0.5 rounded-md bg-orange-600 text-white text-[11px] font-extrabold">
                    Fresh Rebuild Mode (ಹಳೆಯ ಇನ್‌ಬಿಲ್ಟ್ ಬದಲಾವಣೆ)
                  </span>
                  <span className="text-sm font-black text-orange-950">
                    {activeRebuildTarget.grade} · {activeRebuildTarget.subject}
                  </span>
                </div>
                <p className="text-xs text-orange-900 font-medium leading-relaxed">
                  ಈಗ ಕೆಳಗಿನ <strong>PDF ಅಪ್‌ಲೋಡ್</strong> ಬಾಕ್ಸ್‌ನಲ್ಲಿ <strong>{activeRebuildTarget.grade} {activeRebuildTarget.subject}</strong> LBA PDF ಫೈಲ್ ಅಪ್‌ಲೋಡ್ ಮಾಡಿ. AI ಹೊಸದಾಗಿ ಸರಿಯಾದ ಪ್ರಶ್ನೆಗಳನ್ನು ಹೊರತೆಗೆದು ಹಳೆಯ ಇನ್‌ಬಿಲ್ಟ್ ಬದಲಾಯಿಸಿ ಉಳಿಸುತ್ತದೆ — ನಂತರ ನೇರವಾಗಿ ಚಿತ್ರಗಳನ್ನು ಅಪ್‌ಲೋಡ್/ಕ್ರಾಪ್ ಮಾಡಬಹುದು!
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setActiveRebuildTarget(null);
                  setReplaceExistingMode(false);
                  onClearRebuildTarget?.();
                }}
                className="px-3 py-1.5 rounded-lg bg-white hover:bg-orange-100 border border-orange-300 text-orange-900 text-xs font-bold cursor-pointer whitespace-nowrap"
              >
                ಮರುರಚನೆ ರದ್ದು
              </button>
            </div>
          )}

          {/* Permanently Saved JSON Question Banks — Classwise & Subjectwise Table with Duplicate Delete & Class 6 Rebuild */}
          {savedBanks.length > 0 && (
            <SavedJsonBanksTable
              banks={savedBanks}
              activeBankId={typeof generatedBank?.metadata?.id === 'string' ? generatedBank.metadata.id : null}
              isLoadingOpen={isLoadingSavedBank}
              deletingBankId={deletingBankId}
              openButtonLabel="ತೆರೆಯಿರಿ & ಚಿತ್ರ ಅಪ್‌ಲೋಡ್"
              onOpenBank={handleOpenSavedBankInGenerator}
              onDeleteBank={handleDeleteSavedBankInGenerator}
              onRebuildBank={handleStartRebuildForBank}
            />
          )}

          {/* Permanently Saved PDFs Vault (No Repeated Re-uploading!) */}
          {savedPdfs.length > 0 && (
            <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Database className="w-4 h-4 text-indigo-600 shrink-0" />
                  <h3 className="text-xs sm:text-sm font-extrabold text-slate-900">
                    ಶಾಶ್ವತವಾಗಿ ಉಳಿಸಿದ PDF ಫೈಲ್‌ಗಳು (Saved PDF Vault · {savedPdfs.length})
                  </h3>
                </div>
                <span className="text-2xs text-slate-500">
                  ಒಮ್ಮೆ ಅಪ್‌ಲೋಡ್ ಮಾಡಿದ PDF ಇಲ್ಲಿ ಶಾಶ್ವತವಾಗಿ ಉಳಿಯುತ್ತದೆ — ಮತ್ತೆ ಅಪ್‌ಲೋಡ್ ಮಾಡುವ ಅಗತ್ಯವಿಲ್ಲ
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {savedPdfs.map(p => {
                  const isReady = p.hasLocalCache || p.hasServerFile;
                  const isActive = activePdfId === p.id && Boolean(fileBuffer);
                  return (
                    <div
                      key={p.id}
                      className={`p-3 rounded-xl border flex items-center justify-between gap-3 ${
                        isActive
                          ? 'bg-emerald-50/70 border-emerald-300'
                          : 'bg-slate-50/70 border-slate-200'
                      }`}
                    >
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-slate-900 truncate">{p.fileName}</p>
                        <p className="text-3xs text-slate-500 tabular-nums">
                          {p.grade || ''} {p.subject ? `· ${p.subject}` : ''} · {p.totalPages || '?'} ಪುಟಗಳು ·{' '}
                          {isReady ? '✓ ಶಾಶ್ವತವಾಗಿ ಉಳಿಸಲಾಗಿದೆ (Ready)' : 'ಮೆಟಾಡೇಟಾ ಮಾತ್ರ'}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          disabled={isLoadingSavedPdf}
                          onClick={() => handleSelectSavedPdf(p, { openStep2IfScanned: Boolean(p.detectedDoc) })}
                          className="px-2.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-2xs font-bold rounded-lg transition-colors cursor-pointer whitespace-nowrap"
                        >
                          {p.detectedDoc ? 'ತೆರೆಯಿರಿ (Step 2)' : 'ಲೋಡ್ ಮಾಡಿ'}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteSavedPdf(p.id)}
                          title="ಈ PDF ತೆಗೆದುಹಾಕಿ"
                          className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* DUAL OPTIONS CARDS: Card 1 (PDF) & Card 2 (Direct JSON) */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            
            {/* Card 1: Upload Karnataka LBA / Textbook PDF */}
            <div className="bg-white rounded-2xl border border-indigo-200 p-6 shadow-xs flex flex-col justify-between space-y-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="px-3 py-1 rounded-full text-2xs font-extrabold bg-indigo-100 text-indigo-800 border border-indigo-200">
                    ಆಯ್ಕೆ ೧: PDF ನಿಂದ ಪ್ರಶ್ನೆಕೋಶ ರಚನೆ
                  </span>
                  <span className="text-2xs font-bold text-indigo-600 flex items-center gap-1">
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>Gemini AI OCR</span>
                  </span>
                </div>
                <h2 className="text-base font-extrabold text-slate-900 flex items-center gap-2">
                  <FileText className="w-5 h-5 text-indigo-600" />
                  <span>Karnataka LBA / Textbook PDF ಅಪ್‌ಲೋಡ್</span>
                </h2>
                <p className="text-xs text-slate-500 leading-relaxed">
                  6ನೇ, 7ನೇ, 8ನೇ, 9ನೇ ಅಥವಾ 10ನೇ ತರಗತಿಯ DSERT LBA ಪಿಡಿಎಫ್ ಅಪ್‌ಲೋಡ್ ಮಾಡಿ, ಜೆಮಿನಿ AI ಮೂಲಕ ಪಾಠಗಳು & ಅಧಿಕೃತ ಪ್ರಶ್ನೋತ್ತರಗಳನ್ನು ಸ್ವಯಂಚಾಲಿತವಾಗಿ ಹೊರತೆಗೆಯಿರಿ.
                </p>
              </div>

              {/* Upload Dropzone */}
              <div className="border-2 border-dashed border-indigo-300 hover:border-indigo-600 rounded-2xl p-6 bg-indigo-50/20 text-center transition-all cursor-pointer relative">
                <input
                  type="file"
                  accept=".pdf,application/pdf"
                  onChange={handleFileChange}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                />
                <div className="space-y-2">
                  <div className="w-12 h-12 mx-auto rounded-xl bg-indigo-100 text-indigo-700 flex items-center justify-center">
                    <Upload className="w-6 h-6" />
                  </div>
                  <span className="text-xs font-extrabold text-slate-800 block">
                    {selectedFile?.name || (fileBuffer && fileName) || 'PDF ಆಯ್ಕೆಮಾಡಿ ಅಥವಾ ಇಲ್ಲಿಗೆ ಎಳೆಯಿರಿ'}
                  </span>
                  <span className="text-3xs text-slate-400">
                    {selectedFile || fileBuffer
                      ? `${fileSizeMB} MB · ${totalPages > 0 ? `${totalPages} ಪುಟಗಳು` : 'ಲೋಡ್ ಆಗಿದೆ'} · ಶಾಶ್ವತವಾಗಿ ಉಳಿಸಲಾಗಿದೆ`
                      : 'ಕರ್ನಾಟಕ DSERT LBA PDF (ಗರಿಷ್ಠ 80MB · ಒಮ್ಮೆ ಅಪ್‌ಲೋಡ್ ಮಾಡಿದರೆ ಶಾಶ್ವತವಾಗಿ ಉಳಿಯುತ್ತದೆ)'}
                  </span>
                </div>
              </div>

              {/* TOC Scan Range if PDF file or saved PDF buffer is ready */}
              {(selectedFile || fileBuffer) && (
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between gap-2 text-xs">
                  <span className="font-bold text-slate-700">ಪರಿವಿಡಿ ಸ್ಕ್ಯಾನ್ ಪುಟ ವ್ಯಾಪ್ತಿ:</span>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="text"
                      value={scanPageRange}
                      onChange={e => setScanPageRange(e.target.value)}
                      placeholder="1-12"
                      className="w-20 px-2 py-1 bg-white border border-slate-300 rounded font-mono font-bold text-center text-xs"
                    />
                    <span className="text-3xs text-slate-400">/ {totalPages || '..'}</span>
                  </div>
                </div>
              )}

              {scanError && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-xs font-medium">
                  {scanError}
                </div>
              )}

              <button
                type="button"
                disabled={(!selectedFile && !fileBuffer) || isScanning}
                onClick={handleScanPdf}
                className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 disabled:opacity-50 text-white font-extrabold text-xs rounded-xl shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                {isScanning ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>AI ಮೂಲಕ PDF ಪರಿಶೀಲಿಸಲಾಗುತ್ತಿದೆ...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
                    <span>PDF ಸ್ಕ್ಯಾನ್ ಮಾಡಿ & ಅಧ್ಯಾಯಗಳನ್ನು ಗುರುತಿಸಿ</span>
                  </>
                )}
              </button>
            </div>

            {/* Card 2: Direct Upload of Existing JSON Question Bank */}
            <div className="bg-white rounded-2xl border border-amber-300 p-6 shadow-xs flex flex-col justify-between space-y-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="px-3 py-1 rounded-full text-2xs font-extrabold bg-amber-100 text-amber-900 border border-amber-300">
                    ಆಯ್ಕೆ ೨: ಸಿದ್ಧವಿರುವ JSON ಅಪ್‌ಲೋಡ್
                  </span>
                  <span className="text-2xs font-bold text-emerald-700 bg-emerald-50 px-2.5 py-0.5 rounded-full border border-emerald-200">
                    ⚡ ನೇರ ಪ್ರವೇಶ
                  </span>
                </div>
                <h2 className="text-base font-extrabold text-slate-900 flex items-center gap-2">
                  <FileJson className="w-5 h-5 text-amber-600" />
                  <span>ಸಿದ್ಧವಿರುವ JSON ಪ್ರಶ್ನೆಕೋಶ ಅಪ್‌ಲೋಡ್ ಮಾಡಿ (.json)</span>
                </h2>
                <p className="text-xs text-slate-500 leading-relaxed">
                  ಈ ಹಿಂದೆ ಸೇವ್ ಮಾಡಿದ ಅಥವಾ ನಿಮ್ಮ ಬಳಿ ಇರುವ ಪ್ರಶ್ನೆ ಬ್ಯಾಂಕ್ JSON ಫೈಲ್ ಅನ್ನು ನೇರವಾಗಿ ಅಪ್‌ಲೋಡ್ ಮಾಡಿ. ಪ್ರಶ್ನೆಗಳು, ಉತ್ತರಗಳು, ಅಂಕಗಳು ಮತ್ತು ಉದ್ದಿಷ್ಟಗಳನ್ನು ವೀಕ್ಷಿಸಿ ಮತ್ತು Firebase ಗೆ ಉಳಿಸಿ.
                </p>
              </div>

              {/* Direct JSON Upload Dropzone */}
              <div className="border-2 border-dashed border-amber-300 hover:border-amber-500 rounded-2xl p-6 bg-amber-50/20 text-center transition-all cursor-pointer relative">
                <input
                  type="file"
                  accept=".json,application/json"
                  onChange={handleDirectJsonUpload}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                />
                <div className="space-y-2">
                  <div className="w-12 h-12 mx-auto rounded-xl bg-amber-100 text-amber-800 flex items-center justify-center">
                    <FileJson className="w-6 h-6 text-amber-700" />
                  </div>
                  <span className="text-xs font-extrabold text-slate-800 block">
                    JSON ಫೈಲ್ (.json) ಆಯ್ಕೆಮಾಡಿ ಅಥವಾ ಇಲ್ಲಿಗೆ ಎಳೆಯಿರಿ
                  </span>
                  <span className="text-3xs text-slate-400">
                    Question Bank JSON ಫೈಲ್
                  </span>
                </div>
              </div>

              <div className="p-3 bg-amber-50/80 rounded-xl border border-amber-200/80 text-2xs text-amber-900 space-y-1">
                <span className="font-bold block">💡 ಮುಖ್ಯ ವೈಶಿಷ್ಟ್ಯಗಳು:</span>
                <ul className="list-disc list-inside text-amber-800 space-y-0.5">
                  <li>ನಕಲಿ (Duplicate) ಪ್ರಶ್ನೆಗಳನ್ನು ಸ್ವಯಂಚಾಲಿತವಾಗಿ ತೆಗೆದುಹಾಕಲಾಗುತ್ತದೆ.</li>
                  <li>ಜ್ಞಾನ, ತಿಳುವಳಿಕೆ, ಅನ್ವಯ, ಕೌಶಲ ಉದ್ದೇಶಗಳು ಲಭ್ಯವಿರುತ್ತವೆ.</li>
                  <li>ನೇರವಾಗಿ Firebase ಮತ್ತು ಶಾಶ್ವತ ಡೇಟಾಬೇಸ್‌ಗೆ ಉಳಿಸಬಹುದು.</li>
                </ul>
              </div>

              <div className="relative">
                <input
                  type="file"
                  accept=".json,application/json"
                  onChange={handleDirectJsonUpload}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                />
                <button
                  type="button"
                  className="w-full py-3 bg-amber-600 hover:bg-amber-700 active:bg-amber-800 text-white font-extrabold text-xs rounded-xl shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer"
                >
                  <Upload className="w-4 h-4" />
                  <span>JSON ಫೈಲ್ ಆಯ್ಕೆಮಾಡಿ & ಪರಿಶೀಲನೆಗೆ ತೆರಳಿ</span>
                </button>
              </div>
            </div>

          </div>
        </div>
      )}

      {/* STEP 2: Review Chapters & Step-by-Step Batch Extraction */}
      {step === 2 && detectedDoc && (
        <div className="space-y-6">
          {/* Auto-Restoring Saved PDF Indicator OR Permanent Re-Attach Banner */}
          {isLoadingSavedPdf && (
            <div className="p-4 bg-indigo-50 border border-indigo-200 rounded-2xl flex items-center gap-3 text-indigo-900 text-xs font-bold">
              <RefreshCw className="w-4 h-4 animate-spin text-indigo-600 shrink-0" />
              <span>ಶಾಶ್ವತವಾಗಿ ಉಳಿಸಿದ PDF ಫೈಲ್ ಸ್ವಯಂಚಾಲಿತವಾಗಿ ಲೋಡ್ ಆಗುತ್ತಿದೆ...</span>
            </div>
          )}

          {!fileBuffer && !selectedFile && !isLoadingSavedPdf && (
            <div className="p-4 bg-amber-50 border border-amber-300 rounded-2xl flex flex-wrap items-center justify-between gap-4 text-amber-950">
              <div className="flex items-center gap-3">
                <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />
                <div>
                  <h4 className="text-xs font-black text-amber-900">
                    PDF ಫೈಲ್ ಜೋಡಿಸಿ (ಒಮ್ಮೆ ಅಪ್‌ಲೋಡ್ ಮಾಡಿದರೆ ಶಾಶ್ವತವಾಗಿ ಉಳಿಯುತ್ತದೆ)
                  </h4>
                  <p className="text-2xs text-amber-800 mt-0.5">
                    ಈಗಾಗಲೇ ಹೊರತೆಗೆಯಲಾದ {Object.keys(extractedChaptersCache).length} ಅಧ್ಯಾಯಗಳು ಸುರಕ್ಷಿತವಾಗಿವೆ. ಉಳಿಸಿದ PDF ಆಯ್ಕೆಮಾಡಿ ಅಥವಾ ಒಮ್ಮೆ ಅಪ್‌ಲೋಡ್ ಮಾಡಿ — ಮುಂದೆ ಪದೇ ಪದೇ ಕೇಳುವುದಿಲ್ಲ.
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {savedPdfs.some(p => p.hasLocalCache || p.hasServerFile) && (
                  <select
                    defaultValue=""
                    onChange={e => {
                      const found = savedPdfs.find(p => p.id === e.target.value);
                      if (found) handleSelectSavedPdf(found);
                    }}
                    className="bg-white border border-amber-300 rounded-xl px-3 py-2 text-xs font-bold text-slate-800 max-w-xs cursor-pointer"
                  >
                    <option value="" disabled>
                      -- ಉಳಿಸಿದ PDF ಆರಿಸಿ --
                    </option>
                    {savedPdfs
                      .filter(p => p.hasLocalCache || p.hasServerFile)
                      .map(p => (
                        <option key={p.id} value={p.id}>
                          {p.fileName} ({p.totalPages || '?'} ಪುಟ)
                        </option>
                      ))}
                  </select>
                )}
                <div className="relative">
                  <input
                    type="file"
                    accept=".pdf,application/pdf"
                    onChange={handleReattachPdf}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                  />
                  <button
                    type="button"
                    className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white font-extrabold text-xs rounded-xl transition-colors flex items-center gap-1.5 cursor-pointer"
                  >
                    <Upload className="w-4 h-4" />
                    <span>PDF ಒಮ್ಮೆ ಅಪ್‌ಲೋಡ್ & ಶಾಶ್ವತ ಸೇವ್</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Metadata Card with Quick Action Buttons */}
          <div className="bg-white rounded-2xl border border-slate-200/90 p-5 shadow-xs space-y-3">
            <div className="flex flex-wrap items-center justify-between border-b border-slate-100 pb-2.5 gap-2">
              <div>
                <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <span>📘 ದಾಖಲೆಯ ವಿವರಗಳು (Detected Document Metadata)</span>
                </h2>
                <span className="text-2xs font-bold text-slate-500">
                  ಒಟ್ಟು {detectedDoc.chapters.length} ಅಧ್ಯಾಯಗಳು ಪತ್ತೆಯಾಗಿವೆ ({Object.keys(extractedChaptersCache).length} ಪೂರ್ಣಗೊಂಡಿವೆ)
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {Object.keys(extractedChaptersCache).length > 0 && (
                  <button
                    type="button"
                    onClick={handleProceedToReview}
                    className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs rounded-xl shadow-xs transition-all flex items-center gap-1.5 cursor-pointer"
                    title="ಈಗಾಗಲೇ ತಯಾರಾದ ಅಧ್ಯಾಯಗಳನ್ನು ವೀಕ್ಷಿಸಿ ಮತ್ತು Firebase ಗೆ ಉಳಿಸಿ"
                  >
                    <span>💾 ಸಿದ್ಧವಿರುವ {Object.keys(extractedChaptersCache).length} ಪಾಠಗಳನ್ನು ಉಳಿಸಿ</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                )}

                <button
                  type="button"
                  onClick={handleResetAndStartNewPdf}
                  className="px-3.5 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-800 border border-rose-300 font-extrabold text-xs rounded-xl transition-all cursor-pointer flex items-center gap-1.5 shadow-2xs"
                  title="ಬೇರೆ PDF ಅಪ್‌ಲೋಡ್ ಮಾಡಿ ಮೊದಲಿನಿಂದ ಪ್ರಾರಂಭಿಸಿ"
                >
                  <RotateCcw className="w-3.5 h-3.5 text-rose-600" />
                  <span>ಹೊಸ PDF ಅಪ್‌ಲೋಡ್ ಮಾಡಿ</span>
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div className="p-2.5 bg-slate-50 rounded-xl border border-slate-200/60">
                <span className="text-2xs text-slate-500 font-bold block uppercase">ತರಗತಿ</span>
                <span className="font-extrabold text-slate-900">{detectedDoc.metadata.grade}</span>
              </div>
              <div className="p-2.5 bg-slate-50 rounded-xl border border-slate-200/60">
                <span className="text-2xs text-slate-500 font-bold block uppercase">ವಿಷಯ</span>
                <span className="font-extrabold text-indigo-700">{detectedDoc.metadata.subject}</span>
              </div>
              <div className="p-2.5 bg-slate-50 rounded-xl border border-slate-200/60">
                <span className="text-2xs text-slate-500 font-bold block uppercase">ಬೋಧನಾ ಮಾಧ್ಯಮ</span>
                <span className="font-extrabold text-slate-900">{detectedDoc.metadata.medium}</span>
              </div>
              <div className="p-2.5 bg-slate-50 rounded-xl border border-slate-200/60">
                <span className="text-2xs text-slate-500 font-bold block uppercase">ಶೈಕ್ಷಣಿಕ ವರ್ಷ</span>
                <span className="font-extrabold text-slate-900">{detectedDoc.metadata.academicYear}</span>
              </div>
            </div>
          </div>

          {/* Page Number Offset & Global Answer Key Configuration */}
          <div className="bg-white rounded-2xl border border-indigo-100 p-5 shadow-xs space-y-4">
            <div className="border-b border-slate-100 pb-2.5 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Sliders className="w-4 h-4 text-indigo-600" />
                <h3 className="text-xs font-extrabold text-slate-900">
                  ಪುಟ ಸಂಖ್ಯೆ ಹೊಂದಾಣಿಕೆ & ಉತ್ತರ ಸೂಚಿ (Page Offset & Answer Key Auto-Detection)
                </h3>
              </div>
              <span className="text-3xs font-bold text-indigo-800 bg-indigo-50 px-2.5 py-0.5 rounded-full border border-indigo-200">
                PDF ಒಟ್ಟು: {totalPages} ಪುಟಗಳು
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              {/* Printed to Physical Page Offset */}
              <div className="p-3 bg-slate-50/80 rounded-xl border border-slate-200/70 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-extrabold text-slate-800">
                    ಪುಸ್ತಕದ ಮುದ್ರಿತ ಪುಟ ಸಂಖ್ಯೆ → PDF ಭೌತಿಕ ಪುಟ ಆಫ್‌ಸೆಟ್:
                  </span>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setPageOffset(prev => Math.max(0, prev - 1))}
                      className="w-6 h-6 rounded bg-slate-200 hover:bg-slate-300 font-bold text-slate-700 flex items-center justify-center cursor-pointer"
                    >
                      -
                    </button>
                    <input
                      type="number"
                      value={pageOffset}
                      onChange={e => setPageOffset(parseInt(e.target.value, 10) || 0)}
                      className="w-14 px-2 py-1 bg-white border border-slate-300 rounded text-center font-mono font-bold text-xs"
                    />
                    <button
                      type="button"
                      onClick={() => setPageOffset(prev => prev + 1)}
                      className="w-6 h-6 rounded bg-slate-200 hover:bg-slate-300 font-bold text-slate-700 flex items-center justify-center cursor-pointer"
                    >
                      +
                    </button>
                    <button
                      type="button"
                      onClick={() => handleApplyOffsetToAll(pageOffset)}
                      className="ml-1 px-3 py-1 bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-2xs rounded-lg transition-colors cursor-pointer"
                      title="ಎಲ್ಲಾ ಪಾಠಗಳಿಗೂ ಈ ಆಫ್‌ಸೆಟ್ ಅನ್ವಯಿಸಿ"
                    >
                      ಅನ್ವಯಿಸಿ
                    </button>
                  </div>
                </div>
                <p className="text-3xs text-slate-500 leading-relaxed">
                  ಪುಸ್ತಕದ ಪರಿವಿಡಿಯಲ್ಲಿ ಮುದ್ರಿತ ಪುಟ ಸಂಖ್ಯೆ (ಪುಟ 1) ಮತ್ತು PDF ವೀಕ್ಷಕದ ಭೌತಿಕ ಪುಟ ಸಂಖ್ಯೆ (ಪುಟ {1 + pageOffset}) ನಡುವಿನ ವ್ಯತ್ಯಾಸ.
                </p>
              </div>

              {/* Global Answer Key Range */}
              <div className="p-3 bg-slate-50/80 rounded-xl border border-slate-200/70 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-extrabold text-slate-800">
                    ಜಾಗತಿಕ ಉತ್ತರ ಸೂಚಿ ಪುಟ ವ್ಯಾಪ್ತಿ (Global Answer Pages):
                  </span>
                  <input
                    type="text"
                    value={globalAnswerKeyRange}
                    onChange={e => setGlobalAnswerKeyRange(e.target.value)}
                    placeholder="ಉದಾ: 85-110"
                    className="w-32 px-3 py-1 bg-white border border-slate-300 rounded-lg text-center font-mono font-bold text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-hidden"
                  />
                </div>
                <p className="text-3xs text-slate-500 leading-relaxed">
                  ಪುಸ್ತಕದ ಕೊನೆಯಲ್ಲಿರುವ ಅಧಿಕೃತ ಉತ್ತರ ಸೂಚಿ ಪುಟಗಳು. ಪ್ರತ್ಯೇಕ ಅಧ್ಯಾಯದಲ್ಲಿ ಉತ್ತರ ಪುಟ ನಮೂದಿಸದಿದ್ದರೆ ಈ ಪುಟಗಳಿಂದ ಉತ್ತರ ಹೊಂದಾಣಿಕೆ ಮಾಡಲಾಗುತ್ತದೆ.
                </p>
              </div>
            </div>
          </div>

          {/* Mode Switcher Tabs */}
          <div className="flex items-center justify-between gap-3 border-b border-slate-200 pb-1">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setActiveChapterMode('single')}
                className={`px-4 py-2 font-extrabold text-xs rounded-xl transition-all cursor-pointer flex items-center gap-2 ${
                  activeChapterMode === 'single'
                    ? 'bg-indigo-600 text-white shadow-xs'
                    : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200'
                }`}
              >
                <span>🎯 ಒಂದೊಂದೇ ಅಧ್ಯಾಯ ಹೊರತೆಗೆಯಿರಿ (Chapter-by-Chapter Mode)</span>
                <span className="px-1.5 py-0.2 rounded-full text-3xs bg-indigo-500/30 text-white">
                  ಶಿಫಾರಸು
                </span>
              </button>

              <button
                type="button"
                onClick={() => setActiveChapterMode('batch')}
                className={`px-4 py-2 font-extrabold text-xs rounded-xl transition-all cursor-pointer flex items-center gap-2 ${
                  activeChapterMode === 'batch'
                    ? 'bg-indigo-600 text-white shadow-xs'
                    : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200'
                }`}
              >
                <span>📋 ಎಲ್ಲಾ ಅಧ್ಯಾಯಗಳ ಕೋಷ್ಟಕ (Batch Table View)</span>
              </button>
            </div>

            {detectedDoc.chapters.some(c => c.status === 'done') && (
              <button
                type="button"
                onClick={handleProceedToReview}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs rounded-xl shadow-xs transition-all flex items-center gap-1.5 cursor-pointer"
              >
                <span>
                  ಪೂರ್ಣಗೊಂಡ {detectedDoc.chapters.filter(c => c.status === 'done').length} ಅಧ್ಯಾಯಗಳೊಂದಿಗೆ ಮುಂದುವರಿಯಿರಿ
                </span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* MODE 1: Dedicated Chapter-by-Chapter Extraction Workspace */}
          {activeChapterMode === 'single' && (
            <div className="space-y-4">
              {(() => {
                const currentCh =
                  detectedDoc.chapters.find(c => c.chapterId === selectedSingleChapterId) ||
                  detectedDoc.chapters[0];
                if (!currentCh) return null;
                const currentChIndex = detectedDoc.chapters.findIndex(c => c.chapterId === currentCh.chapterId);
                const cachedCh = extractedChaptersCache[currentCh.chapterId];

                return (
                  <div className="bg-white rounded-2xl border border-slate-200/90 p-5 sm:p-6 shadow-xs space-y-5">
                    {/* Chapter Carousel Selector Header */}
                    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          disabled={currentChIndex <= 0}
                          onClick={() => setSelectedSingleChapterId(detectedDoc.chapters[currentChIndex - 1].chapterId)}
                          className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 disabled:opacity-40 text-slate-800 text-xs font-bold rounded-lg transition-colors cursor-pointer"
                        >
                          ← ಹಿಂದಿನ ಅಧ್ಯಾಯ
                        </button>
                        <select
                          value={currentCh.chapterId}
                          onChange={e => setSelectedSingleChapterId(e.target.value)}
                          className="px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-bold text-slate-800 cursor-pointer focus:ring-2 focus:ring-indigo-500 focus:outline-hidden"
                        >
                          {detectedDoc.chapters.map(ch => (
                            <option key={ch.chapterId} value={ch.chapterId}>
                              ಅಧ್ಯಾಯ {ch.chapterNumber}: {ch.chapterName} {ch.status === 'done' ? '✓' : ''}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          disabled={currentChIndex >= detectedDoc.chapters.length - 1}
                          onClick={() => setSelectedSingleChapterId(detectedDoc.chapters[currentChIndex + 1].chapterId)}
                          className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 disabled:opacity-40 text-slate-800 text-xs font-bold rounded-lg transition-colors cursor-pointer"
                        >
                          ಮುಂದಿನ ಅಧ್ಯಾಯ →
                        </button>
                      </div>

                      <div className="flex items-center gap-2">
                        {currentCh.status === 'done' && (
                          <div className="flex items-center gap-2">
                            <span className="px-3 py-1 rounded-full text-xs font-extrabold bg-emerald-100 text-emerald-800 flex items-center gap-1.5">
                              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                              <span>ಹೊರತೆಗೆಯಲಾಗಿದೆ ({currentCh.extractedCount} ಪ್ರಶ್ನೆಗಳು)</span>
                            </span>
                            <button
                              type="button"
                              onClick={() => handleSaveSingleChapter(currentCh.chapterId)}
                              className="px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs rounded-xl transition-all shadow-xs flex items-center gap-1.5 cursor-pointer"
                              title="ಈ ಪಾಠದ ಪ್ರಶ್ನೆಗಳನ್ನು ಪ್ರತ್ಯೇಕವಾಗಿ ಡೌನ್‌ಲೋಡ್ / ಸೇವ್ ಮಾಡಿ"
                            >
                              <Download className="w-3.5 h-3.5" />
                              <span>💾 ಈ ಪಾಠ ಉಳಿಸಿ (Save Chapter)</span>
                            </button>
                          </div>
                        )}
                        {currentCh.status === 'processing' && (
                          <span className="px-3 py-1 rounded-full text-xs font-extrabold bg-indigo-100 text-indigo-800 flex items-center gap-1.5 animate-pulse">
                            <RefreshCw className="w-4 h-4 animate-spin text-indigo-600" />
                            <span>ಸಂಸ್ಕರಿಸಲಾಗುತ್ತಿದೆ...</span>
                          </span>
                        )}
                        {currentCh.status === 'error' && (
                          <span className="px-3 py-1 rounded-full text-xs font-extrabold bg-rose-100 text-rose-800 flex items-center gap-1.5">
                            <AlertTriangle className="w-4 h-4 text-rose-600" />
                            <span>ದೋಷ ಕಂಡುಬಂದಿದೆ</span>
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Chapter Page Controls & Extraction Button */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 bg-slate-50/70 p-4 rounded-xl border border-slate-200/80">
                      <div>
                        <label className="text-2xs font-extrabold text-slate-700 block uppercase mb-1">
                          ಪ್ರಶ್ನೆಗಳ PDF ಪುಟ ವ್ಯಾಪ್ತಿ (Question Pages):
                        </label>
                        <input
                          type="text"
                          value={currentCh.questionPages}
                          onChange={e => handleUpdateChapterPages(currentCh.chapterId, 'questionPages', e.target.value)}
                          placeholder="ಉದಾ: 7-14"
                          className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs font-mono font-bold text-slate-900 focus:ring-2 focus:ring-indigo-500 focus:outline-hidden"
                        />
                        <span className="text-3xs text-slate-400 mt-1 block">
                          ಮುದ್ರಿತ ಪುಟ: {currentCh.printedPages || currentCh.questionPages || '-'}
                        </span>
                      </div>

                      <div>
                        <label className="text-2xs font-extrabold text-slate-700 block uppercase mb-1">
                          ಉತ್ತರ ಸೂಚಿ PDF ಪುಟ ವ್ಯಾಪ್ತಿ (Answer Pages):
                        </label>
                        <input
                          type="text"
                          value={currentCh.answerPages}
                          onChange={e => handleUpdateChapterPages(currentCh.chapterId, 'answerPages', e.target.value)}
                          placeholder={globalAnswerKeyRange ? `${globalAnswerKeyRange} (ಜಾಗತಿಕ)` : 'ಉದಾ: 85-88'}
                          className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs font-mono font-bold text-slate-900 focus:ring-2 focus:ring-indigo-500 focus:outline-hidden"
                        />
                        <span className="text-3xs text-slate-400 mt-1 block">
                          {currentCh.printedAnswerPages
                            ? `ಮುದ್ರಿತ ಉತ್ತರ ಪುಟ: ${currentCh.printedAnswerPages}`
                            : currentCh.answerPages
                            ? 'ಸ್ವಯಂ ಗುರುತಿಸಿದ ಉತ್ತರ ಪುಟಗಳು'
                            : `ಜಾಗತಿಕ ಉತ್ತರ ಸೂಚಿ (${globalAnswerKeyRange || 'ಸ್ವಯಂ'})`}
                        </span>
                      </div>

                      <div className="flex items-end">
                        <button
                          type="button"
                          disabled={isAnyExtractionRunning || currentCh.status === 'processing'}
                          onClick={() => handleExtractSingleChapter(currentCh)}
                          className="w-full py-2.5 px-4 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 disabled:opacity-50 text-white font-extrabold text-xs rounded-xl shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer"
                        >
                          {currentCh.status === 'processing' ? (
                            <>
                              {isExtractionPaused ? (
                                <Pause className="w-3.5 h-3.5" />
                              ) : (
                                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                              )}
                              <span>{isExtractionPaused ? 'ವಿರಾಮದಲ್ಲಿದೆ (Paused)' : 'ಹೊರತೆಗೆಯಲಾಗುತ್ತಿದೆ...'}</span>
                            </>
                          ) : (
                            <>
                              <Sparkles className="w-3.5 h-3.5" />
                              <span>ಈ ಅಧ್ಯಾಯ {currentCh.chapterNumber} ರ ಪ್ರಶ್ನೋತ್ತರ ಹೊರತೆಗೆಯಿರಿ</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>

                    {/* Live Pause / Cancel / Restart Control Panel when extracting this unit */}
                    {(activeExtractionChapterId === currentCh.chapterId || currentCh.status === 'processing') && (
                      <div
                        className={`p-3.5 rounded-xl border space-y-2.5 transition-colors ${
                          isExtractionPaused
                            ? 'bg-amber-50 border-amber-300'
                            : 'bg-indigo-50/90 border-indigo-200'
                        }`}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-bold">
                          <span className="flex items-center gap-2 text-slate-900">
                            {isExtractionPaused ? (
                              <Pause className="w-4 h-4 text-amber-600" />
                            ) : (
                              <RefreshCw className="w-4 h-4 animate-spin text-indigo-600" />
                            )}
                            <span>
                              {isExtractionPaused
                                ? `⏸ ವಿರಾಮದಲ್ಲಿದೆ (Paused) — ಅಧ್ಯಾಯ ${currentCh.chapterNumber}`
                                : `ಅಧ್ಯಾಯ ${currentCh.chapterNumber} ಹೊರತೆಗೆಯಲಾಗುತ್ತಿದೆ...`}
                            </span>
                          </span>

                          <div className="flex flex-wrap items-center gap-2 text-2xs">
                            {extractionChunkProgress && (
                              <span className="px-2 py-0.5 rounded-md bg-white border border-indigo-200 text-indigo-800 font-bold tabular-nums">
                                ಭಾಗ {extractionChunkProgress.current}/{extractionChunkProgress.total} ({extractionChunkProgress.label})
                              </span>
                            )}
                            <span className="px-2 py-0.5 rounded-md bg-white border border-slate-200 text-slate-700 font-mono font-bold flex items-center gap-1 tabular-nums">
                              <Clock className="w-3 h-3 text-slate-500" />
                              <span>{formatElapsedMMSS(extractionElapsedSec)}</span>
                            </span>
                          </div>
                        </div>

                        <div className="w-full bg-white/80 h-2 rounded-full overflow-hidden border border-slate-200/70">
                          <div
                            className={`h-full transition-all duration-300 ${
                              isExtractionPaused ? 'bg-amber-500' : 'bg-indigo-600'
                            }`}
                            style={{
                              width: `${
                                extractionChunkProgress
                                  ? Math.max(
                                      10,
                                      Math.round((extractionChunkProgress.current / extractionChunkProgress.total) * 100)
                                    )
                                  : 18
                              }%`,
                            }}
                          />
                        </div>

                        <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
                          <span className="text-3xs text-slate-600 font-medium">
                            ಹೆಚ್ಚು ಸಮಯ ತೆಗೆದುಕೊಳ್ಳುತ್ತಿದ್ದರೆ ವಿರಾಮ, ರದ್ದು ಅಥವಾ ಮರುಪ್ರಾರಂಭಿಸಿ:
                          </span>
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              onClick={handlePauseResumeExtraction}
                              className={`px-3 py-1.5 rounded-lg text-2xs font-extrabold transition-all cursor-pointer inline-flex items-center gap-1.5 shadow-2xs ${
                                isExtractionPaused
                                  ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                                  : 'bg-amber-500 hover:bg-amber-600 text-white'
                              }`}
                            >
                              {isExtractionPaused ? (
                                <>
                                  <Play className="w-3.5 h-3.5 fill-white" />
                                  <span>ಮುಂದುವರಿಸಿ (Resume)</span>
                                </>
                              ) : (
                                <>
                                  <Pause className="w-3.5 h-3.5" />
                                  <span>ವಿರಾಮ (Pause)</span>
                                </>
                              )}
                            </button>

                            <button
                              type="button"
                              onClick={() => handleRestartExtraction(currentCh)}
                              className="px-3 py-1.5 bg-white hover:bg-indigo-50 text-indigo-700 border border-indigo-300 rounded-lg text-2xs font-extrabold transition-all cursor-pointer inline-flex items-center gap-1.5 shadow-2xs"
                            >
                              <RotateCcw className="w-3.5 h-3.5" />
                              <span>ಮರುಪ್ರಾರಂಭಿಸಿ (Restart)</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => handleCancelExtraction(false)}
                              className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-2xs font-extrabold transition-all cursor-pointer inline-flex items-center gap-1.5 shadow-2xs"
                            >
                              <Square className="w-3 h-3 fill-white" />
                              <span>ರದ್ದುಮಾಡಿ (Cancel)</span>
                            </button>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Extracted Questions Live Preview for this Chapter */}
                    {cachedCh && cachedCh.questions && cachedCh.questions.length > 0 && (
                      <div className="space-y-3 pt-2">
                        <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                          <h4 className="text-xs font-black text-slate-900 flex items-center gap-2">
                            <span>✅ ಹೊರತೆಗೆದ ಪ್ರಶ್ನೋತ್ತರಗಳ ಮುನ್ನೋಟ ({cachedCh.questions.length} ಪ್ರಶ್ನೆಗಳು)</span>
                          </h4>
                          {currentChIndex < detectedDoc.chapters.length - 1 && (
                            <button
                              type="button"
                              onClick={() => setSelectedSingleChapterId(detectedDoc.chapters[currentChIndex + 1].chapterId)}
                              className="px-3 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-extrabold text-2xs rounded-lg transition-colors cursor-pointer flex items-center gap-1"
                            >
                              <span>ಮುಂದಿನ ಅಧ್ಯಾಯಕ್ಕೆ ತೆರಳಿ</span>
                              <ArrowRight className="w-3 h-3" />
                            </button>
                          )}
                        </div>

                        <div className="space-y-2.5 max-h-96 overflow-y-auto pr-1">
                          {cachedCh.questions.map((q, idx) => {
                            const hasAnyImg = Boolean(
                              q.imageUrl || q.diagramSvg || q.answerImageUrl || q.answerDiagramSvg
                            );
                            return (
                              <div
                                key={`${cachedCh.chapterId}_${q.id || 'q'}_${idx}`}
                                className="p-3.5 bg-slate-50/80 rounded-xl border border-slate-200/70 text-xs space-y-2"
                              >
                                <div className="flex flex-wrap items-center justify-between gap-2 text-2xs">
                                  <div className="flex items-center gap-1.5">
                                    <span
                                      className="min-w-6 h-5 px-1.5 rounded-md bg-indigo-600 text-white font-black flex items-center justify-center tabular-nums"
                                      title="PDF ಕ್ರಮ ಸಂಖ್ಯೆ (PDF Question Number)"
                                    >
                                      {q.printedSerial || q.questionNumber || idx + 1}
                                    </span>
                                    <span className="px-2 py-0.5 rounded-md bg-indigo-100 text-indigo-800 font-bold">
                                      {q.formatCategoryName || q.questionType}
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <button
                                      type="button"
                                      onClick={() =>
                                        openAiImageModal(
                                          cachedCh.chapterId,
                                          q,
                                          cachedCh.questions,
                                          undefined,
                                          `${cachedCh.chapterName} ಪ್ರಶ್ನೆಗಳು`
                                        )
                                      }
                                      className={`px-2 py-0.5 rounded-md border font-semibold transition-colors flex items-center gap-1 cursor-pointer whitespace-nowrap ${
                                        hasAnyImg
                                          ? 'bg-indigo-50 text-indigo-800 border-indigo-300 hover:bg-indigo-100'
                                          : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
                                      }`}
                                    >
                                      <Crop className="w-3 h-3 text-indigo-600" />
                                      <span>{hasAnyImg ? 'ಚಿತ್ರ ಬದಲಿಸಿ' : 'ಚಿತ್ರ ಜೋಡಿಸಿ / ಕ್ರಾಪ್'}</span>
                                    </button>
                                    <span className="px-2 py-0.5 rounded-md bg-amber-100 text-amber-900 font-black tabular-nums">
                                      {q.marks} ಅಂಕ ({q.marks}M)
                                    </span>
                                  </div>
                                </div>

                                <p className="font-extrabold text-slate-900 text-xs leading-relaxed whitespace-pre-line">
                                  <MathText text={q.question} />
                                </p>

                                {(q.imageUrl || q.imageUrl2 || q.diagramSvg) && (
                                  <div className="space-y-1.5 pt-1">
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                      <span className="text-3xs font-bold text-slate-500">
                                        ಪ್ರಶ್ನೆ ಚಿತ್ರಗಳು ({q.imageUrl && q.imageUrl2 ? '2 Side-by-Side' : 'Firebase URL'}):
                                      </span>
                                      <div className="flex items-center gap-1.5 flex-wrap">
                                        <button
                                          type="button"
                                          onClick={() =>
                                            openAiImageModal(
                                              cachedCh.chapterId,
                                              q,
                                              cachedCh.questions,
                                              'question',
                                              `${cachedCh.chapterName} ಪ್ರಶ್ನೆಗಳು`
                                            )
                                          }
                                          className="px-2 py-0.5 bg-white hover:bg-indigo-50 text-indigo-700 border border-indigo-200 rounded text-3xs font-bold flex items-center gap-1 cursor-pointer whitespace-nowrap"
                                        >
                                          <Replace className="w-3 h-3" />
                                          <span>ಚಿತ್ರ 1</span>
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() =>
                                            openAiImageModal(
                                              cachedCh.chapterId,
                                              q,
                                              cachedCh.questions,
                                              'question2',
                                              `${cachedCh.chapterName} ಪ್ರಶ್ನೆಗಳು`
                                            )
                                          }
                                          className="px-2 py-0.5 bg-white hover:bg-indigo-50 text-indigo-700 border border-indigo-200 rounded text-3xs font-bold flex items-center gap-1 cursor-pointer whitespace-nowrap"
                                        >
                                          <Replace className="w-3 h-3" />
                                          <span>{q.imageUrl2 ? 'ಚಿತ್ರ 2' : '+ 2ನೇ ಚಿತ್ರ'}</span>
                                        </button>
                                        {q.imageUrl && (
                                          <button
                                            type="button"
                                            onClick={() =>
                                              handleDeleteAiQuestionImage(cachedCh.chapterId, q, 'question')
                                            }
                                            className="px-2 py-0.5 bg-white hover:bg-rose-50 text-rose-700 border border-rose-200 rounded text-3xs font-bold flex items-center gap-1 cursor-pointer whitespace-nowrap"
                                          >
                                            <Trash2 className="w-3 h-3" />
                                            <span>1 ಡಿಲೀಟ್</span>
                                          </button>
                                        )}
                                        {q.imageUrl2 && (
                                          <button
                                            type="button"
                                            onClick={() =>
                                              handleDeleteAiQuestionImage(cachedCh.chapterId, q, 'question2')
                                            }
                                            className="px-2 py-0.5 bg-white hover:bg-rose-50 text-rose-700 border border-rose-200 rounded text-3xs font-bold flex items-center gap-1 cursor-pointer whitespace-nowrap"
                                          >
                                            <Trash2 className="w-3 h-3" />
                                            <span>2 ಡಿಲೀಟ್</span>
                                          </button>
                                        )}
                                      </div>
                                    </div>
                                    {q.imageUrl && q.imageUrl2 ? (
                                      <div className="grid grid-cols-2 gap-2 max-w-xl items-center">
                                        <img
                                          src={q.imageUrl}
                                          alt={q.diagramDescription || 'ಪ್ರಶ್ನೆ ಚಿತ್ರ 1'}
                                          referrerPolicy="no-referrer"
                                          className="max-h-36 w-full rounded-lg border border-slate-200 bg-white p-1 object-contain"
                                        />
                                        <img
                                          src={q.imageUrl2}
                                          alt="ಪ್ರಶ್ನೆ ಚಿತ್ರ 2"
                                          referrerPolicy="no-referrer"
                                          className="max-h-36 w-full rounded-lg border border-slate-200 bg-white p-1 object-contain"
                                        />
                                      </div>
                                    ) : q.imageUrl || q.imageUrl2 ? (
                                      <img
                                        src={q.imageUrl || q.imageUrl2}
                                        alt={q.diagramDescription || 'ಪ್ರಶ್ನೆ ಚಿತ್ರ'}
                                        referrerPolicy="no-referrer"
                                        className="max-h-36 rounded-lg border border-slate-200 bg-white p-1 object-contain"
                                      />
                                    ) : (
                                      <div
                                        className="max-w-xs rounded-lg border border-slate-200 bg-white p-1"
                                        dangerouslySetInnerHTML={{ __html: q.diagramSvg || '' }}
                                      />
                                    )}
                                  </div>
                                )}

                                {q.options && q.options.length > 0 && (
                                  <div className="grid grid-cols-2 gap-1.5 pt-1">
                                    {q.options.map((opt, oIdx) => (
                                        <div
                                        key={oIdx}
                                        className={`p-2 rounded-lg text-2xs font-medium border ${
                                          q.answer && q.answer.includes(opt.slice(0, 2))
                                            ? 'bg-emerald-50 border-emerald-300 font-bold text-emerald-900'
                                            : 'bg-white border-slate-200 text-slate-700'
                                        }`}
                                      >
                                        <MathText text={opt} />
                                      </div>
                                    ))}
                                  </div>
                                )}

                                <div className="p-2.5 bg-emerald-50/90 border border-emerald-200 rounded-lg text-2xs flex items-start gap-1.5">
                                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
                                  <div className="space-y-1.5 flex-1">
                                    <div>
                                      <span className="font-bold text-emerald-950 block">ಅಧಿಕೃತ ಉತ್ತರ:</span>
                                      <span className="text-emerald-900 font-medium whitespace-pre-line">
                                        <MathText text={q.answer} />
                                      </span>
                                    </div>
                                    {(q.answerImageUrl || q.answerImageUrl2 || q.answerDiagramSvg) && (
                                      <div className="pt-1 border-t border-emerald-200/70 space-y-1.5">
                                        <div className="flex flex-wrap items-center justify-between gap-2">
                                          <span className="text-3xs font-bold text-emerald-800">
                                            ಉತ್ತರ ಚಿತ್ರಗಳು ({q.answerImageUrl && q.answerImageUrl2 ? '2 Side-by-Side' : 'Answer Key'}):
                                          </span>
                                          <div className="flex items-center gap-1.5 flex-wrap">
                                            <button
                                              type="button"
                                              onClick={() =>
                                                openAiImageModal(
                                                  cachedCh.chapterId,
                                                  q,
                                                  cachedCh.questions,
                                                  'answer',
                                                  `${cachedCh.chapterName} ಪ್ರಶ್ನೆಗಳು`
                                                )
                                              }
                                              className="px-2 py-0.5 bg-white hover:bg-emerald-50 text-emerald-700 border border-emerald-300 rounded text-3xs font-bold flex items-center gap-1 cursor-pointer whitespace-nowrap"
                                            >
                                              <Replace className="w-3 h-3" />
                                              <span>ಉತ್ತರ 1</span>
                                            </button>
                                            <button
                                              type="button"
                                              onClick={() =>
                                                openAiImageModal(
                                                  cachedCh.chapterId,
                                                  q,
                                                  cachedCh.questions,
                                                  'answer2',
                                                  `${cachedCh.chapterName} ಪ್ರಶ್ನೆಗಳು`
                                                )
                                              }
                                              className="px-2 py-0.5 bg-white hover:bg-emerald-50 text-emerald-700 border border-emerald-300 rounded text-3xs font-bold flex items-center gap-1 cursor-pointer whitespace-nowrap"
                                            >
                                              <Replace className="w-3 h-3" />
                                              <span>{q.answerImageUrl2 ? 'ಉತ್ತರ 2' : '+ 2ನೇ ಚಿತ್ರ'}</span>
                                            </button>
                                            {q.answerImageUrl && (
                                              <button
                                                type="button"
                                                onClick={() =>
                                                  handleDeleteAiQuestionImage(cachedCh.chapterId, q, 'answer')
                                                }
                                                className="px-2 py-0.5 bg-white hover:bg-rose-50 text-rose-700 border border-rose-200 rounded text-3xs font-bold flex items-center gap-1 cursor-pointer whitespace-nowrap"
                                              >
                                                <Trash2 className="w-3 h-3" />
                                                <span>1 ಡಿಲೀಟ್</span>
                                              </button>
                                            )}
                                            {q.answerImageUrl2 && (
                                              <button
                                                type="button"
                                                onClick={() =>
                                                  handleDeleteAiQuestionImage(cachedCh.chapterId, q, 'answer2')
                                                }
                                                className="px-2 py-0.5 bg-white hover:bg-rose-50 text-rose-700 border border-rose-200 rounded text-3xs font-bold flex items-center gap-1 cursor-pointer whitespace-nowrap"
                                              >
                                                <Trash2 className="w-3 h-3" />
                                                <span>2 ಡಿಲೀಟ್</span>
                                              </button>
                                            )}
                                          </div>
                                        </div>
                                        {q.answerImageUrl && q.answerImageUrl2 ? (
                                          <div className="grid grid-cols-2 gap-2 max-w-xl items-center">
                                            <img
                                              src={q.answerImageUrl}
                                              alt={q.answerDiagramDescription || 'ಉತ್ತರ ಚಿತ್ರ 1'}
                                              referrerPolicy="no-referrer"
                                              className="max-h-36 w-full rounded border border-emerald-300 bg-white p-1 object-contain"
                                            />
                                            <img
                                              src={q.answerImageUrl2}
                                              alt="ಉತ್ತರ ಚಿತ್ರ 2"
                                              referrerPolicy="no-referrer"
                                              className="max-h-36 w-full rounded border border-emerald-300 bg-white p-1 object-contain"
                                            />
                                          </div>
                                        ) : q.answerImageUrl || q.answerImageUrl2 ? (
                                          <img
                                            src={q.answerImageUrl || q.answerImageUrl2}
                                            alt={q.answerDiagramDescription || 'ಉತ್ತರ ಚಿತ್ರ'}
                                            referrerPolicy="no-referrer"
                                            className="max-h-36 rounded border border-emerald-300 bg-white p-1 object-contain"
                                          />
                                        ) : (
                                          <div
                                            className="max-w-xs rounded border border-emerald-300 bg-white p-1"
                                            dangerouslySetInnerHTML={{ __html: q.answerDiagramSvg || '' }}
                                          />
                                        )}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          )}

          {/* MODE 2: All Chapters Batch Table View with Inline Editable Pages */}
          {activeChapterMode === 'batch' && (
            <div className="bg-white rounded-2xl border border-slate-200/90 p-5 shadow-xs space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    ೨. ಎಲ್ಲಾ ಅಧ್ಯಾಯಗಳ ಕೋಷ್ಟಕ (All Chapters Batch Table)
                  </h3>
                  <p className="text-2xs text-slate-500">
                    ಪುಟ ಸಂಖ್ಯೆಗಳನ್ನು ನೇರವಾಗಿ ಟೈಪ್ ಮಾಡಿ ತಿದ್ದಬಹುದು. &apos;ಹೊರತೆಗೆಯಿರಿ&apos; ಕ್ಲಿಕ್ ಮಾಡಿ ಆಯಾ ಅಧ್ಯಾಯದ ಪ್ರಶ್ನೆಗಳನ್ನು ಪಡೆಯಿರಿ.
                  </p>
                </div>

                {!isAnyExtractionRunning && (
                  <div className="flex flex-wrap items-center gap-2">
                    {detectedDoc.chapters.some(c => c.status === 'error') && (
                      <button
                        type="button"
                        onClick={() => handleStartExtraction(true)}
                        className="px-4 py-2 bg-amber-600 hover:bg-amber-700 active:bg-amber-800 text-white font-extrabold text-xs rounded-xl shadow-xs transition-all flex items-center gap-1.5 cursor-pointer"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        <span>
                          ವಿಫಲವಾದ {detectedDoc.chapters.filter(c => c.status === 'error').length} ಅಧ್ಯಾಯಗಳನ್ನು ಪುನಃ ಪ್ರಯತ್ನಿಸಿ
                        </span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => handleStartExtraction(false)}
                      className="px-4 py-2 bg-[#009b5a] hover:bg-[#00874e] text-white font-extrabold text-xs rounded-xl shadow-md transition-all flex items-center gap-1.5 cursor-pointer"
                    >
                      <Cpu className="w-3.5 h-3.5 fill-white" />
                      <span>ಎಲ್ಲಾ ಅಧ್ಯಾಯಗಳ ಪ್ರಶ್ನೋತ್ತರ ಹೊರತೆಗೆಯಿರಿ</span>
                    </button>
                  </div>
                )}
              </div>

              {/* Processing Banner with Live Timer + Pause / Cancel / Restart */}
              {isAnyExtractionRunning && (
                <div
                  className={`p-4 rounded-xl border space-y-3 transition-colors ${
                    isExtractionPaused
                      ? 'bg-amber-50 border-amber-300'
                      : 'bg-indigo-50 border-indigo-200'
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-bold text-indigo-950">
                    <span className="flex items-center gap-2">
                      {isExtractionPaused ? (
                        <Pause className="w-4 h-4 text-amber-600" />
                      ) : (
                        <RefreshCw className="w-4 h-4 animate-spin text-indigo-600" />
                      )}
                      <span>{currentProcessingChapter || 'ಪ್ರಕ್ರಿಯೆ ನಡೆಯುತ್ತಿದೆ...'}</span>
                    </span>

                    <div className="flex flex-wrap items-center gap-2 text-2xs">
                      {extractionChunkProgress && (
                        <span className="px-2 py-0.5 rounded-md bg-white border border-indigo-200 text-indigo-800 font-bold tabular-nums">
                          ಭಾಗ {extractionChunkProgress.current}/{extractionChunkProgress.total} ({extractionChunkProgress.label})
                        </span>
                      )}
                      <span className="px-2 py-0.5 rounded-md bg-white border border-slate-200 text-slate-700 font-mono font-bold flex items-center gap-1 tabular-nums">
                        <Clock className="w-3 h-3 text-slate-500" />
                        <span>{formatElapsedMMSS(extractionElapsedSec)}</span>
                      </span>
                      <span className={isExtractionPaused ? 'text-amber-800' : 'text-indigo-800'}>
                        {isExtractionPaused ? '⏸ ವಿರಾಮದಲ್ಲಿದೆ' : 'ಪ್ರಕ್ರಿಯೆ ಪ್ರಗತಿಯಲ್ಲಿದೆ...'}
                      </span>
                    </div>
                  </div>

                  <div className="w-full bg-white/80 h-2 rounded-full overflow-hidden border border-slate-200/70">
                    <div
                      className={`h-full transition-all duration-300 ${
                        isExtractionPaused ? 'bg-amber-500' : 'bg-indigo-600'
                      }`}
                      style={{
                        width: `${Math.max(
                          6,
                          isExtracting
                            ? (detectedDoc.chapters.filter(c => c.status === 'done').length /
                                Math.max(1, detectedDoc.chapters.length)) *
                                100
                            : extractionChunkProgress
                              ? (extractionChunkProgress.current / extractionChunkProgress.total) * 100
                              : 15
                        )}%`,
                      }}
                    />
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-3xs text-slate-600 font-medium">
                      ಪ್ರಕ್ರಿಯೆ ನಿಧಾನವಾಗಿದ್ದರೆ ವಿರಾಮ, ಮರುಪ್ರಾರಂಭ ಅಥವಾ ರದ್ದು ಮಾಡಬಹುದು:
                    </span>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={handlePauseResumeExtraction}
                        className={`px-3 py-1.5 rounded-lg text-2xs font-extrabold transition-all cursor-pointer inline-flex items-center gap-1.5 shadow-2xs ${
                          isExtractionPaused
                            ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                            : 'bg-amber-500 hover:bg-amber-600 text-white'
                        }`}
                      >
                        {isExtractionPaused ? (
                          <>
                            <Play className="w-3.5 h-3.5 fill-white" />
                            <span>ಮುಂದುವರಿಸಿ (Resume)</span>
                          </>
                        ) : (
                          <>
                            <Pause className="w-3.5 h-3.5" />
                            <span>ವಿರಾಮ (Pause)</span>
                          </>
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={() => handleRestartExtraction()}
                        className="px-3 py-1.5 bg-white hover:bg-indigo-50 text-indigo-700 border border-indigo-300 rounded-lg text-2xs font-extrabold transition-all cursor-pointer inline-flex items-center gap-1.5 shadow-2xs"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        <span>ಮರುಪ್ರಾರಂಭಿಸಿ (Restart)</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleCancelExtraction(false)}
                        className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-2xs font-extrabold transition-all cursor-pointer inline-flex items-center gap-1.5 shadow-2xs"
                      >
                        <Square className="w-3 h-3 fill-white" />
                        <span>ರದ್ದುಮಾಡಿ (Cancel)</span>
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Editable Chapters Table */}
              <div className="overflow-x-auto border border-slate-200 rounded-xl">
                <table className="w-full text-xs text-left border-collapse">
                  <thead className="bg-slate-100 text-slate-800 font-bold border-b border-slate-200">
                    <tr>
                      <th className="py-2.5 px-3 w-12 text-center">ಕ್ರ.ಸಂ.</th>
                      <th className="py-2.5 px-3">ಪಾಠದ ಹೆಸರು</th>
                      <th className="py-2.5 px-3">ವಿಭಾಗ</th>
                      <th className="py-2.5 px-3">ಪ್ರಶ್ನೆಗಳ PDF ಪುಟ (Editable)</th>
                      <th className="py-2.5 px-3">ಉತ್ತರಗಳ PDF ಪುಟ (Editable)</th>
                      <th className="py-2.5 px-3 text-center">ಸ್ಥಿತಿ (Status)</th>
                      <th className="py-2.5 px-3 text-center">ಪ್ರಶ್ನೆಗಳು</th>
                      <th className="py-2.5 px-3 text-center">ಕ್ರಿಯೆ (Action)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-medium">
                    {detectedDoc.chapters.map(ch => (
                      <tr key={ch.chapterId} className="hover:bg-slate-50/80">
                        <td className="py-2.5 px-3 text-center font-bold text-slate-600">
                          {ch.chapterNumber}
                        </td>
                        <td className="py-2.5 px-3 font-bold text-slate-900">{ch.chapterName}</td>
                        <td className="py-2.5 px-3 text-slate-600">{ch.sectionType || '-'}</td>
                        <td className="py-2.5 px-3">
                          <div className="space-y-1">
                            <input
                              type="text"
                              value={ch.questionPages}
                              onChange={e => handleUpdateChapterPages(ch.chapterId, 'questionPages', e.target.value)}
                              placeholder="ಉದಾ: 7-12"
                              className="w-24 px-2.5 py-1 bg-white border border-slate-300 rounded-lg text-xs font-mono font-bold text-slate-800 focus:ring-2 focus:ring-indigo-500 focus:outline-hidden"
                              title="PDF ವೀಕ್ಷಕದಲ್ಲಿ ಈ ಪಾಠದ ಪ್ರಶ್ನೆಗಳಿರುವ ಪುಟ ಸಂಖ್ಯೆ"
                            />
                            {ch.questionPages ? (
                              <span className="text-3xs text-emerald-700 font-bold block">✓ ಸ್ವಯಂ ಪತ್ತೆಯಾಗಿದೆ</span>
                            ) : (
                              <span className="text-3xs text-amber-700 font-bold block">⚠️ ಪುಟ ನಮೂದಿಸಿ</span>
                            )}
                          </div>
                        </td>
                        <td className="py-2.5 px-3">
                          <div className="space-y-1">
                            <input
                              type="text"
                              value={ch.answerPages}
                              onChange={e => handleUpdateChapterPages(ch.chapterId, 'answerPages', e.target.value)}
                              placeholder={globalAnswerKeyRange || 'ಜಾಗತಿಕ'}
                              className="w-24 px-2.5 py-1 bg-white border border-slate-300 rounded-lg text-xs font-mono font-bold text-slate-800 focus:ring-2 focus:ring-indigo-500 focus:outline-hidden"
                              title="PDF ವೀಕ್ಷಕದಲ್ಲಿ ಈ ಪಾಠದ ಉತ್ತರಗಳಿರುವ ಪುಟ ಸಂಖ್ಯೆ"
                            />
                            <span className="text-3xs text-slate-400 block">
                              {ch.answerPages ? 'ಪ್ರತ್ಯೇಕ' : 'ಜಾಗತಿಕ ಕೀ'}
                            </span>
                          </div>
                        </td>
                        <td className="py-2.5 px-3 text-center">
                          {ch.status === 'pending' && (
                            <span className="px-2 py-0.5 rounded-full text-2xs font-bold bg-slate-100 text-slate-600">
                              ನಿರೀಕ್ಷೆಯಲ್ಲಿದೆ
                            </span>
                          )}
                          {ch.status === 'processing' && (
                            <span className="px-2 py-0.5 rounded-full text-2xs font-bold bg-indigo-100 text-indigo-700 animate-pulse flex items-center gap-1 justify-center">
                              <RefreshCw className="w-3 h-3 animate-spin" />
                              <span>ಹೊರತೆಗೆಯಲಾಗುತ್ತಿದೆ</span>
                            </span>
                          )}
                          {ch.status === 'done' && (
                            <span className="px-2 py-0.5 rounded-full text-2xs font-bold bg-emerald-100 text-emerald-800 flex items-center gap-1 justify-center">
                              <CheckCircle2 className="w-3 h-3" />
                              <span>ಪೂರ್ಣಗೊಂಡಿದೆ</span>
                            </span>
                          )}
                          {ch.status === 'error' && (
                            <div className="flex flex-col items-center gap-0.5">
                              <span className="px-2 py-0.5 rounded-full text-2xs font-bold bg-rose-100 text-rose-800">
                                ❌ ದೋಷ
                              </span>
                              {ch.errorMessage && (
                                <span className="text-3xs text-rose-600 max-w-xs truncate" title={ch.errorMessage}>
                                  {ch.errorMessage}
                                </span>
                              )}
                            </div>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-center font-black text-indigo-700">
                          {ch.extractedCount !== undefined ? `${ch.extractedCount} ಪ್ರಶ್ನೆಗಳು` : '-'}
                        </td>
                        <td className="py-2.5 px-3 text-center">
                          <div className="flex items-center justify-center gap-1.5">
                            {ch.status === 'processing' ? (
                              <>
                                <button
                                  type="button"
                                  onClick={handlePauseResumeExtraction}
                                  className={`px-2 py-1 rounded-lg text-2xs font-extrabold transition-all cursor-pointer inline-flex items-center gap-1 ${
                                    isExtractionPaused
                                      ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                                      : 'bg-amber-500 hover:bg-amber-600 text-white'
                                  }`}
                                  title={isExtractionPaused ? 'ಮುಂದುವರಿಸಿ (Resume)' : 'ವಿರಾಮ (Pause)'}
                                >
                                  {isExtractionPaused ? (
                                    <Play className="w-2.5 h-2.5 fill-white" />
                                  ) : (
                                    <Pause className="w-2.5 h-2.5" />
                                  )}
                                  <span>{isExtractionPaused ? 'ಮುಂದುವರಿಸಿ' : 'ವಿರಾಮ'}</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleRestartExtraction(ch)}
                                  className="px-2 py-1 bg-white hover:bg-indigo-50 text-indigo-700 border border-indigo-300 rounded-lg text-2xs font-extrabold transition-all cursor-pointer inline-flex items-center gap-1"
                                  title="ಮರುಪ್ರಾರಂಭಿಸಿ (Restart)"
                                >
                                  <RotateCcw className="w-2.5 h-2.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleCancelExtraction(false)}
                                  className="px-2 py-1 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-2xs font-extrabold transition-all cursor-pointer inline-flex items-center gap-1"
                                  title="ರದ್ದುಮಾಡಿ (Cancel)"
                                >
                                  <Square className="w-2.5 h-2.5 fill-white" />
                                </button>
                              </>
                            ) : (
                              <>
                                {ch.status === 'done' && (
                                  <button
                                    type="button"
                                    onClick={() => handleSaveSingleChapter(ch.chapterId)}
                                    className="px-2.5 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-300 rounded-lg text-2xs font-extrabold transition-all cursor-pointer inline-flex items-center gap-1 shadow-2xs"
                                    title="ಈ ಪಾಠದ ಪ್ರಶ್ನೆಗಳನ್ನು ಪ್ರತ್ಯೇಕವಾಗಿ ಡೌನ್‌ಲೋಡ್ / ಸೇವ್ ಮಾಡಿ (ಎಲ್ಲಾ ಘಟಕಗಳ ಫೈಲ್‌ಗೆ ಮರ್ಜ್ ಆಗುತ್ತದೆ)"
                                  >
                                    <Download className="w-3 h-3 text-emerald-600" />
                                    <span>ಉಳಿಸಿ</span>
                                  </button>
                                )}
                                <button
                                  type="button"
                                  disabled={isAnyExtractionRunning}
                                  onClick={() => handleExtractSingleChapter(ch)}
                                  className={`px-2.5 py-1 rounded-lg text-2xs font-extrabold transition-all cursor-pointer inline-flex items-center gap-1 disabled:opacity-50 ${
                                    ch.status === 'error'
                                      ? 'bg-amber-600 hover:bg-amber-700 text-white shadow-xs'
                                      : ch.status === 'done'
                                      ? 'bg-slate-100 hover:bg-indigo-50 text-indigo-700 border border-slate-200'
                                      : 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-xs'
                                  }`}
                                  title="ಈ ಅಧ್ಯಾಯದ ಪ್ರಶ್ನೋತ್ತರಗಳನ್ನು ಹೊರತೆಗೆಯಿರಿ ಅಥವಾ ಪುನಃ ಪ್ರಯತ್ನಿಸಿ"
                                >
                                  <RefreshCw className="w-2.5 h-2.5" />
                                  <span>{ch.status === 'done' ? 'ಮರುಹೊರತೆಗೆಯಿರಿ' : ch.status === 'error' ? 'ಪುನಃ ಪ್ರಯತ್ನಿಸಿ' : 'ಹೊರತೆಗೆಯಿರಿ'}</span>
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
            {/* Live Progress Logs Console */}
            {extractionLog.length > 0 && (
              <div className="bg-slate-900 text-slate-200 p-4 rounded-xl font-mono text-2xs max-h-48 overflow-y-auto space-y-1">
                {extractionLog.map((log, i) => (
                  <div key={i} className="leading-relaxed">
                    {log}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

      {/* STEP 3: Verification, Validation Dashboard & Download JSON */}
      {step === 3 && generatedBank && (
        <div className="space-y-6">
          {/* Success Banner */}
          <div className="p-4 bg-emerald-50 border border-emerald-300 rounded-2xl flex flex-wrap items-center justify-between gap-3 text-emerald-900">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-600 text-white flex items-center justify-center">
                <CheckCircle2 className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-sm font-black">
                  🎉 ಅಧಿಕೃತ JSON ಪ್ರಶ್ನೆ ಬ್ಯಾಂಕ್ ಯಶಸ್ವಿಯಾಗಿ ರಚನೆಯಾಗಿದೆ!
                </h3>
                <p className="text-2xs text-emerald-800 font-medium">
                  {generatedBank.chapters.length} ಅಧ್ಯಾಯಗಳು · {String(generatedBank.metadata.totalQuestions || allQuestions.length)} ಪ್ರಶ್ನೆಗಳು ಹಾಗೂ ಅಧಿಕೃತ ಉತ್ತರಗಳು ಸಿದ್ಧವಾಗಿವೆ.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleRemoveDuplicatesInStep3}
                disabled={isSaving}
                className={`px-3.5 py-2 font-extrabold text-xs rounded-xl transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50 ${
                  step3DuplicateAudit && step3DuplicateAudit.removedDuplicates > 0
                    ? 'bg-amber-600 hover:bg-amber-700 text-white shadow-sm'
                    : 'bg-white hover:bg-slate-50 text-slate-700 border border-slate-300'
                }`}
                title="ಅಪ್ಲೋಡ್ ಮಾಡಿದ ಎಲ್ಲಾ ಚಿತ್ರಗಳನ್ನು ಉಳಿಸಿಕೊಂಡು ಡುಪ್ಲಿಕೇಟ್ ಪ್ರಶ್ನೆಗಳನ್ನು ತೆಗೆದುಹಾಕಿ"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>
                  {step3DuplicateAudit && step3DuplicateAudit.removedDuplicates > 0
                    ? `ಡುಪ್ಲಿಕೇಟ್ ತೆಗೆದುಹಾಕಿ (${step3DuplicateAudit.removedDuplicates})`
                    : 'ಡುಪ್ಲಿಕೇಟ್ ಪರಿಶೀಲಿಸಿ'}
                </span>
              </button>

              <button
                type="button"
                onClick={handleSaveToDatabase}
                disabled={isSaving}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white font-extrabold text-xs rounded-xl shadow-md transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                title="Firebase Firestore ಕ್ಲೌಡ್ ಮತ್ತು ಸರ್ವರ್ ಡೇಟಾಬೇಸ್‌ಗೆ ಖಾಯಂ ಆಗಿ ಉಳಿಸಿ"
              >
                <Cloud className="w-4 h-4" />
                <span>{isSaving ? 'ಉಳಿಸಲಾಗುತ್ತಿದೆ...' : '🔥 Firebase & Database ಗೆ ಖಾಯಂ ಉಳಿಸಿ'}</span>
              </button>

              <button
                type="button"
                onClick={handleDownloadJson}
                className="px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white font-extrabold text-xs rounded-xl shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer"
                title="JSON ಫೈಲ್ ಅನ್ನು ನಿಮ್ಮ ಸಾಧನಕ್ಕೆ ಡೌನ್‌ಲೋಡ್ ಮಾಡಿ"
              >
                <Download className="w-4 h-4" />
                <span>ಡೌನ್‌ಲೋಡ್ JSON ಫೈಲ್ (.json)</span>
              </button>

              <button
                type="button"
                onClick={handleOpenInExplorerForImages}
                className="px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white font-extrabold text-xs rounded-xl shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer"
                title="ಪ್ರಶ್ನೆ ಭಂಡಾರದಲ್ಲಿ ತೆರೆದು ಚಿತ್ರಗಳನ್ನು ಅಪ್‌ಲೋಡ್ / ಕ್ರಾಪ್ ಮಾಡಿ"
              >
                <Crop className="w-4 h-4" />
                <span>ಚಿತ್ರಗಳನ್ನು ಅಪ್‌ಲೋಡ್ ಮಾಡಿ</span>
              </button>

              <button
                type="button"
                onClick={handleLoadInQPGenerator}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs rounded-xl shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer"
                title="ಈಗಲೇ ಪ್ರಶ್ನೆ ಪತ್ರಿಕೆ ರಚಿಸಲು ಮುಂದುವರಿಯಿರಿ"
              >
                <BookOpen className="w-4 h-4" />
                <span>ಪ್ರಶ್ನೆ ಪತ್ರಿಕೆ ರಚನೆಯಲ್ಲಿ ಬಳಸಿ</span>
              </button>

              <button
                type="button"
                onClick={handleResetAndStartNewPdf}
                className="px-3.5 py-2 bg-rose-50 hover:bg-rose-100 text-rose-800 border border-rose-300 font-extrabold text-xs rounded-xl transition-all cursor-pointer flex items-center gap-1.5"
                title="ಬೇರೆ PDF ಅಪ್‌ಲೋಡ್ ಮಾಡಿ ಹೊಸದಾಗಿ ಪ್ರಾರಂಭಿಸಿ"
              >
                <RotateCcw className="w-3.5 h-3.5 text-rose-600" />
                <span>ಹೊಸ PDF ಅಪ್‌ಲೋಡ್ ಮಾಡಿ</span>
              </button>
            </div>
          </div>

          {/* Fresh Replace Mode Toggle (Especially for Rebuilding Built-in Class 6 Subjects Cleanly) */}
          <div className="px-4 py-3 rounded-xl bg-orange-50/80 border border-orange-200 flex flex-wrap items-center justify-between gap-3 text-xs">
            <label className="inline-flex items-start gap-2.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={replaceExistingMode}
                onChange={e => setReplaceExistingMode(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-orange-400 text-orange-600 focus:ring-orange-500"
              />
              <div>
                <span className="font-extrabold text-orange-950 block">
                  ಹಳೆಯ ಇನ್‌ಬಿಲ್ಟ್ / ದೋಷಯುಕ್ತ JSON ಸಂಪೂರ್ಣ ಬದಲಾಯಿಸಿ ಹೊಸದಾಗಿ ಉಳಿಸಿ (Fresh Replace Mode)
                </span>
                <span className="text-2xs text-orange-800">
                  6ನೇ ತರಗತಿಯ ಇನ್‌ಬಿಲ್ಟ್ ವಿಷಯಗಳನ್ನು LBA PDF ನಿಂದ ಹೊಸದಾಗಿ ಸರಿಪಡಿಸಿ ಉಳಿಸುವಾಗ ಇದನ್ನು ಆನ್ ಇಡಿ (ಹಳೆಯ ತಪ್ಪು ಪ್ರಶ್ನೆಗಳು ಸೇರಿಕೊಳ್ಳುವುದಿಲ್ಲ; ನಂತರ ಕೆಳಗೆ ಅಥವಾ ಚಿತ್ರ ನಿರ್ವಹಣೆಯಲ್ಲಿ ಚಿತ್ರಗಳನ್ನು ಅಪ್‌ಲೋಡ್ ಮಾಡಿ).
                </span>
              </div>
            </label>
          </div>

          {saveSuccessMessage && (
            <div className="p-3 bg-emerald-100 text-emerald-900 border border-emerald-300 rounded-xl text-xs font-bold flex flex-wrap items-center justify-between gap-2">
              <span className="whitespace-pre-line">{saveSuccessMessage}</span>
              <button
                type="button"
                onClick={handleOpenInExplorerForImages}
                className="px-3 py-1.5 rounded-lg bg-orange-600 hover:bg-orange-700 text-white text-xs font-extrabold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
              >
                <Crop className="w-3.5 h-3.5" />
                <span>ಈಗ ಚಿತ್ರಗಳನ್ನು ಅಪ್‌ಲೋಡ್ ಮಾಡಿ</span>
              </button>
            </div>
          )}

          {step3DuplicateAudit && step3DuplicateAudit.removedDuplicates > 0 && (
            <div className="px-4 py-3 rounded-xl border border-amber-300 bg-amber-50 text-amber-950 flex flex-wrap items-center justify-between gap-3 text-xs">
              <div className="flex items-start gap-2.5">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold">
                    {step3DuplicateAudit.removedDuplicates} ಡುಪ್ಲಿಕೇಟ್ ಪ್ರಶ್ನೆಗಳು ಪತ್ತೆಯಾಗಿವೆ ({step3DuplicateAudit.chaptersAffected} ಅಧ್ಯಾಯಗಳಲ್ಲಿ · {step3DuplicateAudit.totalQuestionsBefore} → {step3DuplicateAudit.totalQuestionsAfter} ಪ್ರಶ್ನೆಗಳು)
                  </p>
                  <p className="text-2xs text-amber-800 mt-0.5">
                    ಅಪ್ಲೋಡ್ ಮಾಡಿದ ಎಲ್ಲಾ ಚಿತ್ರಗಳನ್ನು ಸುರಕ್ಷಿತವಾಗಿ ಉಳಿಸಿಕೊಂಡು ಡುಪ್ಲಿಕೇಟ್ ಪ್ರಶ್ನೆಗಳನ್ನು ಒಂದೇ ಕ್ಲಿಕ್‌ನಲ್ಲಿ ತೆಗೆದುಹಾಕಿ.
                  </p>
                </div>
              </div>
              <button
                type="button"
                disabled={isSaving}
                onClick={handleRemoveDuplicatesInStep3}
                className="px-3.5 py-1.5 bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap disabled:opacity-50"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>{isSaving ? 'ತೆಗೆದುಹಾಕಲಾಗುತ್ತಿದೆ...' : 'ಡುಪ್ಲಿಕೇಟ್ ತೆಗೆದುಹಾಕಿ & ಉಳಿಸಿ'}</span>
              </button>
            </div>
          )}

          {/* Chapter-wise Diagram Audit, Pending Image Filter & Permanently Saved PDF Vault */}
          <DiagramAuditPanel
            audit={step3Audit}
            imageFilter={previewImageFilter}
            onChangeImageFilter={mode => {
              setPreviewImageFilter(mode);
              setActiveTab('preview');
            }}
            selectedChapterId={previewChapterFilter}
            onSelectChapterAndFilter={(chId, mode) => {
              setPreviewChapterFilter(chId);
              setPreviewImageFilter(mode);
              setActiveTab('preview');
            }}
            savedPdfs={savedPdfs}
            activePdfId={activePdfId}
            activePdfName={fileName}
            hasActivePdfBuffer={Boolean(fileBuffer)}
            isLoadingPdf={isLoadingSavedPdf}
            onSelectSavedPdf={pdf => handleSelectSavedPdf(pdf)}
            onUploadNewPdf={async file => {
              await persistPdfFileAndBind(file, { reuseActiveId: false, showToast: true });
            }}
            defaultExpandedTable={step3Audit.totalNeeded > 0}
          />

          {/* Verification Navigation Tabs */}
          <div className="bg-white rounded-2xl border border-slate-200/90 p-5 shadow-xs space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setActiveTab('preview')}
                  className={`px-4 py-1.5 rounded-xl font-bold text-xs transition-all cursor-pointer ${
                    activeTab === 'preview'
                      ? 'bg-indigo-600 text-white shadow-xs'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  <Eye className="w-3.5 h-3.5 inline mr-1" />
                  <span>ಪ್ರಶ್ನೆ & ಉತ್ತರಗಳ ಪರಿಶೀಲನೆ ({allQuestions.length})</span>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveTab('json')}
                  className={`px-4 py-1.5 rounded-xl font-bold text-xs transition-all cursor-pointer ${
                    activeTab === 'json'
                      ? 'bg-indigo-600 text-white shadow-xs'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  <Code className="w-3.5 h-3.5 inline mr-1" />
                  <span>ಕಚ್ಚಾ JSON ವೀಕ್ಷಣೆ (Raw JSON)</span>
                </button>
              </div>

              {/* Filters for Preview */}
              {activeTab === 'preview' && (
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowShortAnswersOnly(prev => !prev)}
                    className={`px-2.5 py-1.5 rounded-lg border text-2xs font-bold transition-colors flex items-center gap-1 cursor-pointer whitespace-nowrap ${
                      showShortAnswersOnly
                        ? 'bg-emerald-600 text-white border-emerald-700'
                        : step3ShortAnswerCount > 0
                        ? 'bg-amber-50 hover:bg-amber-100 text-amber-900 border-amber-300'
                        : 'bg-white hover:bg-slate-50 text-slate-600 border-slate-300'
                    }`}
                    title="ವಿವರವಾದ ಉತ್ತರ ಇಲ್ಲದ ಅಥವಾ ಸಂಕ್ಷಿಪ್ತ ಉತ್ತರ ಇರುವ ಪ್ರಶ್ನೆಗಳನ್ನು ಮಾತ್ರ ತೋರಿಸಿ"
                  >
                    <Edit3 className="w-3 h-3" />
                    <span>ಸಂಕ್ಷಿಪ್ತ ಉತ್ತರಗಳು ({step3ShortAnswerCount})</span>
                  </button>

                  <select
                    value={previewChapterFilter}
                    onChange={e => setPreviewChapterFilter(e.target.value)}
                    className="text-xs font-bold bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-hidden"
                  >
                    <option value="all">ಎಲ್ಲಾ ಅಧ್ಯಾಯಗಳು</option>
                    {generatedBank.chapters.map(c => (
                      <option key={c.chapterId} value={c.chapterId}>
                        {c.chapterNumber}. {c.chapterName} ({c.questions.length})
                      </option>
                    ))}
                  </select>

                  <div className="relative">
                    <input
                      type="text"
                      placeholder="ಪ್ರಶ್ನೆ ಹುಡುಕಿ..."
                      value={searchQuery}
                      onChange={e => setSearchQuery(e.target.value)}
                      className="text-xs bg-slate-50 border border-slate-200 rounded-lg pl-7 pr-2.5 py-1.5 focus:outline-hidden w-44"
                    />
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2 top-2 pointer-events-none" />
                  </div>
                </div>
              )}
            </div>

            {/* TAB 1: Verified Questions & Answers Card View */}
            {activeTab === 'preview' && (
              <div className="space-y-3">
                <div className="text-2xs font-bold text-slate-500">
                  ತೋರಿಸಲಾಗುತ್ತಿರುವ ಪ್ರಶ್ನೆಗಳು: {filteredQuestions.length} / {allQuestions.length}
                </div>

                <div className="space-y-2.5 max-h-[600px] overflow-y-auto pr-1">
                  {filteredQuestions.length === 0 ? (
                    <div className="p-8 text-center bg-slate-50 border border-slate-200 rounded-xl space-y-2">
                      <p className="text-xs font-bold text-slate-700">
                        {previewImageFilter === 'pending'
                          ? '🎉 ಆಯ್ಕೆಮಾಡಿದ ಘಟಕದಲ್ಲಿ ಚಿತ್ರ ಅಪ್‌ಲೋಡ್ ಬಾಕಿ ಇರುವ ಪ್ರಶ್ನೆಗಳು ಇಲ್ಲ!'
                          : 'ಆಯ್ಕೆಮಾಡಿದ ಫಿಲ್ಟರ್‌ಗೆ ಹೊಂದುವ ಪ್ರಶ್ನೆಗಳು ಲಭ್ಯವಿಲ್ಲ.'}
                      </p>
                      {previewImageFilter !== 'all' && (
                        <button
                          type="button"
                          onClick={() => {
                            setPreviewImageFilter('all');
                            setPreviewChapterFilter('all');
                          }}
                          className="px-3 py-1.5 bg-white border border-slate-300 hover:bg-slate-100 text-slate-700 text-2xs font-bold rounded-lg cursor-pointer"
                        >
                          ಎಲ್ಲಾ ಪ್ರಶ್ನೆಗಳನ್ನು ತೋರಿಸಿ
                        </button>
                      )}
                    </div>
                  ) : (
                    filteredQuestions.map((q, idx) => {
                    const isExpanded = expandedQuestionId === q.id;
                    const hasAnyImg = Boolean(
                      q.imageUrl || q.diagramSvg || q.answerImageUrl || q.answerDiagramSvg
                    );
                    const imgReq = detectImageRequirement(q);
                    const isPendingImg = imgReq.needsImage && !hasAnyImg;
                    const preferredSlot: 'question' | 'answer' =
                      imgReq.suggestedSlot === 'answer' ? 'answer' : 'question';

                    return (
                      <div
                        key={`${q.chapterId || 'ch'}_${q.id || 'q'}_${idx}`}
                        className={`p-3.5 rounded-xl border transition-all space-y-2 text-xs ${
                          isPendingImg
                            ? 'bg-amber-50/40 border-amber-300 hover:border-amber-400'
                            : 'bg-slate-50 border-slate-200 hover:border-indigo-300'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-start gap-2.5 flex-1">
                            <span
                              className="min-w-7 h-6 px-1.5 rounded-md bg-indigo-100 text-indigo-900 font-black text-2xs flex items-center justify-center shrink-0 mt-0.5 tabular-nums"
                              title="PDF ಕ್ರಮ ಸಂಖ್ಯೆ (PDF Serial Number)"
                            >
                              {q.printedSerial || q.questionNumber || idx + 1}
                            </span>
                            <div className="space-y-1 flex-1">
                              <div className="flex flex-wrap items-center gap-1.5 text-2xs">
                                <span className="font-bold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded-md border border-indigo-200/60">
                                  {q.chapterName}
                                </span>
                                <span className="font-medium text-slate-600 bg-white px-2 py-0.5 rounded-md border border-slate-200">
                                  {q.formatCategoryName}
                                </span>
                                <span className="font-bold text-amber-800 bg-amber-50 px-1.5 py-0.5 rounded-md border border-amber-200 tabular-nums">
                                  {q.marks} ಅಂಕ
                                </span>
                                {isPendingImg && (
                                  <span className="inline-flex items-center gap-1 font-extrabold text-amber-800 bg-amber-100 px-2 py-0.5 rounded-md border border-amber-300">
                                    <AlertCircle className="w-3 h-3" />
                                    <span>ಚಿತ್ರ ಅಪ್‌ಲೋಡ್ ಬಾಕಿ ({imgReq.suggestedSlot === 'answer' ? 'ಉತ್ತರ' : 'ಪ್ರಶ್ನೆ'})</span>
                                  </span>
                                )}
                                {hasAnyImg && (
                                  <span className="inline-flex items-center gap-1 font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200">
                                    <CheckCircle2 className="w-3 h-3" />
                                    <span>ಚಿತ್ರ ಸಿದ್ಧ</span>
                                  </span>
                                )}
                              </div>
                              <p className="font-bold text-slate-900 leading-relaxed text-xs sm:text-sm whitespace-pre-line">
                                <MathText text={q.question} />
                              </p>
                            </div>
                          </div>

                          <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                            <button
                              type="button"
                              onClick={() => openStep3TextEditModal(q)}
                              className="px-2.5 py-1 rounded-lg border border-emerald-300 bg-emerald-50 hover:bg-emerald-100 text-emerald-900 text-2xs font-bold transition-colors flex items-center gap-1 cursor-pointer whitespace-nowrap"
                              title="ಪ್ರಶ್ನೆ ಅಥವಾ ವಿವರವಾದ ಉತ್ತರವನ್ನು ತಿದ್ದುಪಡಿ ಮಾಡಿ JSON ಗೆ ಉಳಿಸಿ"
                            >
                              <Edit3 className="w-3 h-3" />
                              <span>ತಿದ್ದುಪಡಿ (Edit)</span>
                            </button>

                            {confirmDeleteStep3Key === `${q.chapterId}::${q.id}` ? (
                              <div className="inline-flex items-center gap-1 bg-rose-50 border border-rose-300 rounded-lg px-2 py-0.5">
                                <button
                                  type="button"
                                  onClick={() => handleDeleteStep3Question(q)}
                                  className="px-2 py-0.5 rounded bg-rose-600 hover:bg-rose-700 text-white text-3xs font-bold cursor-pointer whitespace-nowrap"
                                >
                                  ಖಚಿತವಾಗಿ ಡಿಲೀಟ್
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setConfirmDeleteStep3Key(null)}
                                  className="px-1.5 py-0.5 rounded bg-white hover:bg-slate-100 border border-slate-300 text-slate-700 text-3xs font-semibold cursor-pointer whitespace-nowrap"
                                >
                                  ರದ್ದು
                                </button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteStep3Key(`${q.chapterId}::${q.id}`)}
                                className="px-2 py-1 rounded-lg border border-rose-200 bg-rose-50/70 hover:bg-rose-100 text-rose-800 text-2xs font-bold transition-colors flex items-center gap-1 cursor-pointer whitespace-nowrap"
                                title="ಈ ಪ್ರಶ್ನೆ ಡುಪ್ಲಿಕೇಟ್ ಆಗಿದ್ದರೆ ಶಾಶ್ವತವಾಗಿ ಡಿಲೀಟ್ ಮಾಡಿ"
                              >
                                <Trash2 className="w-3 h-3" />
                                <span>ಡಿಲೀಟ್</span>
                              </button>
                            )}

                            <button
                              type="button"
                              onClick={() =>
                                openAiImageModal(
                                  q.chapterId,
                                  q,
                                  filteredQuestions,
                                  preferredSlot,
                                  previewImageFilter === 'pending'
                                    ? 'ಚಿತ್ರ ಬಾಕಿ ಇರುವ ಪ್ರಶ್ನೆಗಳು'
                                    : 'ಫಿಲ್ಟರ್ ಮಾಡಿದ ಪ್ರಶ್ನೆಗಳು'
                                )
                              }
                              className={`px-2.5 py-1 rounded-lg border text-2xs font-bold transition-colors flex items-center gap-1 cursor-pointer whitespace-nowrap ${
                                isPendingImg
                                  ? 'bg-amber-600 text-white border-amber-700 hover:bg-amber-700'
                                  : hasAnyImg
                                    ? 'bg-indigo-50 text-indigo-800 border-indigo-300 hover:bg-indigo-100'
                                    : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
                              }`}
                              title="ಪ್ರಶ್ನೆ ಅಥವಾ ಉತ್ತರಕ್ಕೆ ಚಿತ್ರ ಜೋಡಿಸಿ / PDF ನಿಂದ ಕ್ರಾಪ್ ಮಾಡಿ"
                            >
                              <Crop className={`w-3 h-3 ${isPendingImg ? 'text-white' : 'text-indigo-600'}`} />
                              <span>
                                {isPendingImg
                                  ? 'ಚಿತ್ರ ಅಪ್‌ಲೋಡ್ / ಕ್ರಾಪ್'
                                  : hasAnyImg
                                    ? 'ಚಿತ್ರ ಬದಲಿಸಿ'
                                    : 'ಚಿತ್ರ ಜೋಡಿಸಿ'}
                              </span>
                            </button>

                            {isPendingImg && (
                              <button
                                type="button"
                                onClick={() => handleToggleAiQuestionNeedsImage(q.chapterId, q, false)}
                                title="ಈ ಪ್ರಶ್ನೆಗೆ ಚಿತ್ರದ ಅಗತ್ಯವಿಲ್ಲವೆಂದು ಗುರುತಿಸಿ"
                                className="px-2 py-1 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-slate-600 text-3xs font-bold flex items-center gap-1 cursor-pointer whitespace-nowrap"
                              >
                                <EyeOff className="w-3 h-3" />
                                <span>ಚಿತ್ರ ಬೇಡ</span>
                              </button>
                            )}

                            <button
                              type="button"
                              onClick={() => setExpandedQuestionId(isExpanded ? null : q.id)}
                              className="text-slate-400 hover:text-slate-700 p-1"
                            >
                              {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                            </button>
                          </div>
                        </div>

                        {/* Question Diagram Preview (1 or 2 Side-by-Side) with Replace & Delete */}
                        {(q.imageUrl || q.imageUrl2 || q.diagramSvg) && (
                          <div className="pl-8 pt-1 space-y-1.5">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span className="text-2xs font-semibold text-slate-500">
                                ಪ್ರಶ್ನೆ ಚಿತ್ರಗಳು ({q.imageUrl && q.imageUrl2 ? '2 Side-by-Side' : 'Question Image'}):
                              </span>
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <button
                                  type="button"
                                  onClick={() =>
                                    openAiImageModal(
                                      q.chapterId,
                                      q,
                                      filteredQuestions,
                                      'question',
                                      previewImageFilter === 'pending'
                                        ? 'ಚಿತ್ರ ಬಾಕಿ ಇರುವ ಪ್ರಶ್ನೆಗಳು'
                                        : 'ಫಿಲ್ಟರ್ ಮಾಡಿದ ಪ್ರಶ್ನೆಗಳು'
                                    )
                                  }
                                  className="px-2 py-0.5 bg-white hover:bg-indigo-50 text-indigo-700 border border-indigo-200 rounded text-3xs font-bold flex items-center gap-1 cursor-pointer whitespace-nowrap"
                                >
                                  <Replace className="w-3 h-3" />
                                  <span>ಚಿತ್ರ 1</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    openAiImageModal(
                                      q.chapterId,
                                      q,
                                      filteredQuestions,
                                      'question2',
                                      previewImageFilter === 'pending'
                                        ? 'ಚಿತ್ರ ಬಾಕಿ ಇರುವ ಪ್ರಶ್ನೆಗಳು'
                                        : 'ಫಿಲ್ಟರ್ ಮಾಡಿದ ಪ್ರಶ್ನೆಗಳು'
                                    )
                                  }
                                  className="px-2 py-0.5 bg-white hover:bg-indigo-50 text-indigo-700 border border-indigo-200 rounded text-3xs font-bold flex items-center gap-1 cursor-pointer whitespace-nowrap"
                                >
                                  <Replace className="w-3 h-3" />
                                  <span>{q.imageUrl2 ? 'ಚಿತ್ರ 2' : '+ 2ನೇ ಚಿತ್ರ'}</span>
                                </button>
                                {q.imageUrl && (
                                  <button
                                    type="button"
                                    onClick={() => handleDeleteAiQuestionImage(q.chapterId, q, 'question')}
                                    className="px-2 py-0.5 bg-white hover:bg-rose-50 text-rose-700 border border-rose-200 rounded text-3xs font-bold flex items-center gap-1 cursor-pointer whitespace-nowrap"
                                  >
                                    <Trash2 className="w-3 h-3" />
                                    <span>1 ಡಿಲೀಟ್</span>
                                  </button>
                                )}
                                {q.imageUrl2 && (
                                  <button
                                    type="button"
                                    onClick={() => handleDeleteAiQuestionImage(q.chapterId, q, 'question2')}
                                    className="px-2 py-0.5 bg-white hover:bg-rose-50 text-rose-700 border border-rose-200 rounded text-3xs font-bold flex items-center gap-1 cursor-pointer whitespace-nowrap"
                                  >
                                    <Trash2 className="w-3 h-3" />
                                    <span>2 ಡಿಲೀಟ್</span>
                                  </button>
                                )}
                              </div>
                            </div>
                            {q.imageUrl && q.imageUrl2 ? (
                              <div className="grid grid-cols-2 gap-2.5 max-w-2xl items-center">
                                <img
                                  src={q.imageUrl}
                                  alt={q.diagramDescription || 'ಪ್ರಶ್ನೆ ಚಿತ್ರ 1'}
                                  referrerPolicy="no-referrer"
                                  className="max-h-40 w-full rounded-lg border border-slate-200 bg-white p-1 object-contain"
                                />
                                <img
                                  src={q.imageUrl2}
                                  alt="ಪ್ರಶ್ನೆ ಚಿತ್ರ 2"
                                  referrerPolicy="no-referrer"
                                  className="max-h-40 w-full rounded-lg border border-slate-200 bg-white p-1 object-contain"
                                />
                              </div>
                            ) : q.imageUrl || q.imageUrl2 ? (
                              <img
                                src={q.imageUrl || q.imageUrl2}
                                alt={q.diagramDescription || 'ಪ್ರಶ್ನೆ ಚಿತ್ರ'}
                                referrerPolicy="no-referrer"
                                className="max-h-40 rounded-lg border border-slate-200 bg-white p-1 object-contain"
                              />
                            ) : (
                              <div
                                className="max-w-xs rounded-lg border border-slate-200 bg-white p-1"
                                dangerouslySetInnerHTML={{ __html: q.diagramSvg || '' }}
                              />
                            )}
                          </div>
                        )}

                        {/* Options if MCQ */}
                        {q.options && q.options.length > 0 && (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 pl-8 pt-1">
                            {q.options.map((opt, oIdx) => (
                              <div
                                key={oIdx}
                                className="bg-white px-2.5 py-1.5 rounded-lg border border-slate-200 text-2xs text-slate-700 font-medium"
                              >
                                <MathText text={opt} />
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Matched Answer Key */}
                        <div className="pl-8 pt-1">
                          <div className="p-2.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-950 text-xs space-y-2">
                            <div>
                              <div className="flex items-center justify-between gap-2 mb-0.5">
                                <span className="font-extrabold text-emerald-800 text-2xs uppercase">
                                  ✓ ಅಧಿಕೃತ ಉತ್ತರ (Matched Answer):
                                </span>
                                <button
                                  type="button"
                                  onClick={() => openStep3TextEditModal(q)}
                                  className="px-2 py-0.5 bg-white hover:bg-emerald-100 text-emerald-800 border border-emerald-300 rounded text-3xs font-bold flex items-center gap-1 cursor-pointer whitespace-nowrap"
                                >
                                  <Edit3 className="w-3 h-3" />
                                  <span>ಉತ್ತರ ತಿದ್ದುಪಡಿ (Edit Answer)</span>
                                </button>
                              </div>
                              <div className="font-semibold leading-relaxed whitespace-pre-line">
                                <MathText text={q.answer} />
                              </div>
                            </div>

                            {(q.answerImageUrl || q.answerImageUrl2 || q.answerDiagramSvg) && (
                              <div className="pt-1 border-t border-emerald-200/70 space-y-1.5">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <span className="text-2xs font-bold text-emerald-800">
                                    ಉತ್ತರ ಚಿತ್ರಗಳು ({q.answerImageUrl && q.answerImageUrl2 ? '2 Side-by-Side' : 'Answer Key Image'}):
                                  </span>
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <button
                                      type="button"
                                      onClick={() =>
                                        openAiImageModal(
                                          q.chapterId,
                                          q,
                                          filteredQuestions,
                                          'answer',
                                          previewImageFilter === 'pending'
                                            ? 'ಚಿತ್ರ ಬಾಕಿ ಇರುವ ಪ್ರಶ್ನೆಗಳು'
                                            : 'ಫಿಲ್ಟರ್ ಮಾಡಿದ ಪ್ರಶ್ನೆಗಳು'
                                        )
                                      }
                                      className="px-2 py-0.5 bg-white hover:bg-emerald-50 text-emerald-700 border border-emerald-300 rounded text-3xs font-bold flex items-center gap-1 cursor-pointer whitespace-nowrap"
                                    >
                                      <Replace className="w-3 h-3" />
                                      <span>ಉತ್ತರ 1</span>
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        openAiImageModal(
                                          q.chapterId,
                                          q,
                                          filteredQuestions,
                                          'answer2',
                                          previewImageFilter === 'pending'
                                            ? 'ಚಿತ್ರ ಬಾಕಿ ಇರುವ ಪ್ರಶ್ನೆಗಳು'
                                            : 'ಫಿಲ್ಟರ್ ಮಾಡಿದ ಪ್ರಶ್ನೆಗಳು'
                                        )
                                      }
                                      className="px-2 py-0.5 bg-white hover:bg-emerald-50 text-emerald-700 border border-emerald-300 rounded text-3xs font-bold flex items-center gap-1 cursor-pointer whitespace-nowrap"
                                    >
                                      <Replace className="w-3 h-3" />
                                      <span>{q.answerImageUrl2 ? 'ಉತ್ತರ 2' : '+ 2ನೇ ಚಿತ್ರ'}</span>
                                    </button>
                                    {q.answerImageUrl && (
                                      <button
                                        type="button"
                                        onClick={() => handleDeleteAiQuestionImage(q.chapterId, q, 'answer')}
                                        className="px-2 py-0.5 bg-white hover:bg-rose-50 text-rose-700 border border-rose-200 rounded text-3xs font-bold flex items-center gap-1 cursor-pointer whitespace-nowrap"
                                      >
                                        <Trash2 className="w-3 h-3" />
                                        <span>1 ಡಿಲೀಟ್</span>
                                      </button>
                                    )}
                                    {q.answerImageUrl2 && (
                                      <button
                                        type="button"
                                        onClick={() => handleDeleteAiQuestionImage(q.chapterId, q, 'answer2')}
                                        className="px-2 py-0.5 bg-white hover:bg-rose-50 text-rose-700 border border-rose-200 rounded text-3xs font-bold flex items-center gap-1 cursor-pointer whitespace-nowrap"
                                      >
                                        <Trash2 className="w-3 h-3" />
                                        <span>2 ಡಿಲೀಟ್</span>
                                      </button>
                                    )}
                                  </div>
                                </div>
                                {q.answerImageUrl && q.answerImageUrl2 ? (
                                  <div className="grid grid-cols-2 gap-2.5 max-w-2xl items-center">
                                    <img
                                      src={q.answerImageUrl}
                                      alt={q.answerDiagramDescription || 'ಉತ್ತರ ಚಿತ್ರ 1'}
                                      referrerPolicy="no-referrer"
                                      className="max-h-40 w-full rounded border border-emerald-300 bg-white p-1 object-contain"
                                    />
                                    <img
                                      src={q.answerImageUrl2}
                                      alt="ಉತ್ತರ ಚಿತ್ರ 2"
                                      referrerPolicy="no-referrer"
                                      className="max-h-40 w-full rounded border border-emerald-300 bg-white p-1 object-contain"
                                    />
                                  </div>
                                ) : q.answerImageUrl || q.answerImageUrl2 ? (
                                  <img
                                    src={q.answerImageUrl || q.answerImageUrl2}
                                    alt={q.answerDiagramDescription || 'ಉತ್ತರ ಚಿತ್ರ'}
                                    referrerPolicy="no-referrer"
                                    className="max-h-40 rounded border border-emerald-300 bg-white p-1 object-contain"
                                  />
                                ) : (
                                  <div
                                    className="max-w-xs rounded border border-emerald-300 bg-white p-1"
                                    dangerouslySetInnerHTML={{ __html: q.answerDiagramSvg || '' }}
                                  />
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })
                  )}
                </div>
              </div>
            )}

            {/* TAB 2: Raw JSON Preview */}
            {activeTab === 'json' && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-2xs font-bold text-slate-500">
                    QPG Standard Schema JSON (UTF-8 Kannada Unicode)
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(rawJsonString);
                      setSaveSuccessMessage('✅ JSON ಕ್ಲಿಪ್‌ಬೋರ್ಡ್‌ಗೆ ನಕಲಿಸಲಾಗಿದೆ (Copied to Clipboard)!');
                      setTimeout(() => setSaveSuccessMessage(null), 3000);
                    }}
                    className="px-3 py-1 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold rounded-lg transition-colors cursor-pointer"
                  >
                    ನಕಲಿಸಿ (Copy JSON)
                  </button>
                </div>
                <pre className="bg-slate-900 text-emerald-400 p-4 rounded-xl font-mono text-2xs max-h-[500px] overflow-y-auto leading-relaxed selection:bg-emerald-800">
                  {rawJsonString}
                </pre>
              </div>
            )}
          </div>
        </div>
      )}

      {/* In-App Confirmation Modal for "Upload Another PDF / Reset and Start Over" */}
      {showResetConfirmModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center gap-3 text-rose-600 mb-3">
              <div className="w-10 h-10 rounded-full bg-rose-50 flex items-center justify-center shrink-0">
                <RotateCcw className="w-5 h-5" />
              </div>
              <h3 className="text-base font-extrabold text-slate-900">
                ಹೊಸ PDF / ಮೊದಲಿನಿಂದ ಪ್ರಾರಂಭಿಸಿ?
              </h3>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed mb-6">
              ಹೊಸ PDF ಅಪ್‌ಲೋಡ್ ಮಾಡಲು ಅಥವಾ ಮೊದಲಿನಿಂದ ಪ್ರಾರಂಭಿಸಲು ಬಯಸುವಿರಾ? ಈಗಾಗಲೇ ಸಿದ್ಧಪಡಿಸಿದ ಪ್ರಶ್ನೆಗಳು ತೆರವುಗೊಳ್ಳುತ್ತವೆ (ಅಗತ್ಯವಿದ್ದರೆ ಮೊದಲು JSON ಡೌನ್‌ಲೋಡ್ ಮಾಡಿ ಅಥವಾ ಸೇವ್ ಮಾಡಿಕೊಳ್ಳಿ).
            </p>
            <div className="flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowResetConfirmModal(false)}
                className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer"
              >
                ರದ್ದುಗೊಳಿಸಿ (Cancel)
              </button>
              <button
                type="button"
                onClick={executeResetAndStartNewPdf}
                className="px-4 py-2 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 active:bg-rose-800 rounded-xl shadow-md transition-all cursor-pointer flex items-center gap-1.5"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>ಹೌದು, ಮೊದಲಿನಿಂದ ಪ್ರಾರಂಭಿಸಿ</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Interactive Image Upload & PDF Cropper Modal with In-Modal Prev/Next Question Navigation */}
      {editingImageTarget && (() => {
        const targetDetCh = detectedDoc?.chapters.find(
          c => c.chapterId === editingImageTarget.chapterId
        );
        const targetBankCh =
          generatedBank?.chapters.find(c => c.chapterId === editingImageTarget.chapterId) ||
          extractedChaptersCache[editingImageTarget.chapterId];
        const chQuestions = targetBankCh?.questions || [];
        // Always resolve latest saved QuestionItem from live state so Prev/Next shows freshly saved images
        const liveQuestion =
          chQuestions.find(item => item.id === editingImageTarget.question.id) ||
          editingImageTarget.question;
        const qIndexInChapter = Math.max(
          0,
          chQuestions.findIndex(item => item.id === liveQuestion.id)
        );
        const qPagesStr = targetDetCh?.questionPages || targetBankCh?.questionPages;
        const aPagesStr = targetDetCh?.answerPages || targetBankCh?.answerPages || globalAnswerKeyRange;
        const startQPage = liveQuestion.sourcePage || getFirstPageNumber(qPagesStr);
        const startAPage = liveQuestion.answerPage || getFirstPageNumber(aPagesStr);
        const navQueue = editingImageTarget.queue || [];
        const navIdx = editingImageTarget.queueIndex ?? 0;

        return (
          <QuestionImageModal
            isOpen={Boolean(editingImageTarget)}
            onClose={() => setEditingImageTarget(null)}
            question={liveQuestion}
            questionIndex={qIndexInChapter + 1}
            totalChapterQuestions={chQuestions.length}
            chapterQuestionPages={qPagesStr}
            chapterAnswerPages={aPagesStr}
            gradeKey={detectedDoc?.metadata.gradeKey || generatedBank?.metadata.gradeKey || '7'}
            subjectCode={detectedDoc?.metadata.subjectCode || generatedBank?.metadata.subjectCode || 'gen'}
            pdfBuffer={fileBuffer}
            pdfFileName={fileName}
            savedPdfs={savedPdfs}
            activePdfId={activePdfId}
            onNavigatePrev={
              navQueue.length > 1 ? () => handleNavigateAiModalQuestion(-1) : undefined
            }
            onNavigateNext={
              navQueue.length > 1 ? () => handleNavigateAiModalQuestion(1) : undefined
            }
            hasPrevQuestion={navIdx > 0}
            hasNextQuestion={navIdx < navQueue.length - 1}
            navPositionIndex={navQueue.length > 1 ? navIdx + 1 : undefined}
            navTotalCount={navQueue.length > 1 ? navQueue.length : undefined}
            navQueueLabel={editingImageTarget.queueLabel}
            onSelectSavedPdf={pdf => handleSelectSavedPdf(pdf)}
            onPdfLoaded={(buf, name, savedEntry) => {
              setFileBuffer(buf);
              setFileName(name);
              if (savedEntry) {
                setActivePdfId(savedEntry.id);
                if (savedEntry.totalPages) setTotalPages(savedEntry.totalPages);
                refreshSavedPdfs();
              }
            }}
            initialQuestionPage={startQPage}
            initialAnswerPage={startAPage}
            initialSlot={editingImageTarget.initialSlot || 'question'}
            onSave={handleSaveAiQuestionImage}
            onMarkImageNotRequired={() =>
              handleSaveAiQuestionImage({
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
              })
            }
          />
        );
      })()}

      {/* Direct Question & Detailed Answer Editor Modal for Step 3 (with Pull Answer from Uploaded PDF) */}
      {activeStep3EditQuestion && (
        <QuestionEditModal
          isOpen={Boolean(activeStep3EditQuestion)}
          onClose={() => {
            setEditingTextIndex(-1);
            setEditingTextQueue([]);
          }}
          question={activeStep3EditQuestion}
          chapterName={activeStep3EditQuestion.chapterName}
          onSave={handleSaveStep3QuestionText}
          onDelete={() => handleDeleteStep3Question(activeStep3EditQuestion)}
          onNavigatePrev={
            editingTextQueue.length > 1
              ? () => setEditingTextIndex(prev => Math.max(0, prev - 1))
              : undefined
          }
          onNavigateNext={
            editingTextQueue.length > 1
              ? () => setEditingTextIndex(prev => Math.min(editingTextQueue.length - 1, prev + 1))
              : undefined
          }
          hasPrev={editingTextIndex > 0}
          hasNext={editingTextIndex < editingTextQueue.length - 1}
          navIndex={editingTextQueue.length > 1 ? editingTextIndex + 1 : undefined}
          navTotal={editingTextQueue.length > 1 ? editingTextQueue.length : undefined}
          pdfBuffer={fileBuffer}
          pdfFileName={fileName}
          savedPdfs={savedPdfs}
          activePdfId={activePdfId}
          onSelectSavedPdf={pdf => handleSelectSavedPdf(pdf)}
          onPdfLoaded={(buf, name, savedEntry) => {
            setFileBuffer(buf);
            setFileName(name);
            if (savedEntry) {
              setActivePdfId(savedEntry.id);
              if (savedEntry.totalPages) setTotalPages(savedEntry.totalPages);
              refreshSavedPdfs();
            }
          }}
          chapters={(generatedBank?.chapters || []).map(c => ({
            chapterId: c.chapterId,
            chapterNumber: c.chapterNumber,
            chapterName: c.chapterName,
            questionPages: c.questionPages,
            answerPages: c.answerPages,
          }))}
          initialAnswerPage={activeStep3EditQuestion.answerPage}
          grade={generatedBank?.metadata.grade || detectedDoc?.metadata.grade}
          gradeKey={generatedBank?.metadata.gradeKey || detectedDoc?.metadata.gradeKey}
          subject={generatedBank?.metadata.subject || detectedDoc?.metadata.subject}
          subjectCode={generatedBank?.metadata.subjectCode || detectedDoc?.metadata.subjectCode}
          medium={generatedBank?.metadata.medium || detectedDoc?.metadata.medium}
        />
      )}
    </div>
  );
};
