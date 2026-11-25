/**
 * Question & Detailed Answer Editor Modal
 * Allows teachers to directly edit question text, detailed step-by-step answers,
 * MCQ options, marks, and PDF serial numbers — AND automatically pull verbatim
 * detailed answers (with textbook stacked fractions \frac{num}{den}) directly from
 * the uploaded PDF by selecting Chapter, Question No., and PDF Page No.
 * Saves immediately to the JSON Question Bank (Server Disk + Firebase Firestore)
 * while preserving 100% of uploaded images.
 */

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { PDFDocument } from 'pdf-lib';
import { QuestionItem } from '../types/questionBank.ts';
import { SavedPdfEntry, savePdfPermanently } from '../services/pdfVault.ts';
import { MathText } from './MathText.tsx';
import {
  X,
  Save,
  ChevronLeft,
  ChevronRight,
  Edit3,
  CheckCircle2,
  Eye,
  Plus,
  Trash2,
  FileText,
  Sparkles,
  Upload,
  Loader2,
  AlertTriangle,
  Minus,
} from 'lucide-react';

export interface QuestionTextUpdate {
  question: string;
  answer: string;
  marks: number;
  difficulty: string;
  questionNumber?: number;
  printedSerial?: string;
  options?: string[];
  answerPage?: number;
}

export interface EditModalChapterOption {
  chapterId: string;
  chapterNumber?: number;
  chapterName: string;
  questionPages?: string;
  answerPages?: string;
}

interface QuestionEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  question: QuestionItem;
  chapterName?: string;
  onSave: (update: QuestionTextUpdate) => Promise<void> | void;
  onDelete?: () => Promise<void> | void;
  isPossibleDuplicate?: boolean;
  onNavigatePrev?: () => void;
  onNavigateNext?: () => void;
  hasPrev?: boolean;
  hasNext?: boolean;
  navIndex?: number;
  navTotal?: number;
  // Uploaded PDF Vault & Chapter context for one-click Pull Answer from PDF
  pdfBuffer?: ArrayBuffer | null;
  pdfFileName?: string;
  savedPdfs?: SavedPdfEntry[];
  activePdfId?: string | null;
  onSelectSavedPdf?: (pdf: SavedPdfEntry) => Promise<void> | void;
  onPdfLoaded?: (buffer: ArrayBuffer, fileName: string, savedEntry?: SavedPdfEntry) => void;
  chapters?: EditModalChapterOption[];
  initialAnswerPage?: number;
  grade?: string;
  gradeKey?: string;
  subject?: string;
  subjectCode?: string;
  medium?: string;
}

const MATH_SYMBOLS = [
  '°',
  '∠',
  '∥',
  '⊥',
  'Δ',
  '≅',
  '∼',
  '√',
  '²',
  '³',
  'π',
  '×',
  '÷',
  '±',
  '≤',
  '≥',
  '≠',
  '∴',
  '∵',
  '⇒',
  '½',
  '⅓',
  '¼',
  '₹',
];

function parseFirstPageFromRange(rangeStr?: string): number | undefined {
  if (!rangeStr) return undefined;
  const m = String(rangeStr).match(/\d+/);
  if (!m) return undefined;
  const n = parseInt(m[0], 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/**
 * Parse a user page input like "84" or "84-85" or "84, 85" into 1-based physical PDF page numbers.
 * Capped at 4 pages for fast, accurate single-answer OCR.
 */
function parsePageSelection(
  input: string,
  includeNextPage: boolean,
  totalPdfPages: number | null
): number[] {
  const cleaned = input.trim();
  if (!cleaned) return [];

  const pages = new Set<number>();
  const rangeMatch = cleaned.match(/^(\d+)\s*[-–to]+\s*(\d+)$/i);
  if (rangeMatch) {
    const start = Math.max(1, parseInt(rangeMatch[1], 10));
    const end = Math.max(start, parseInt(rangeMatch[2], 10));
    const maxEnd = Math.min(end, start + 3); // cap to max 4 pages
    for (let p = start; p <= maxEnd; p++) {
      if (!totalPdfPages || p <= totalPdfPages) pages.add(p);
    }
  } else {
    const parts = cleaned.split(/[,\s]+/).filter(Boolean);
    for (const part of parts) {
      const n = parseInt(part, 10);
      if (Number.isFinite(n) && n >= 1) {
        if (!totalPdfPages || n <= totalPdfPages) {
          pages.add(n);
        }
      }
      if (pages.size >= 4) break;
    }
    if (parts.length === 1 && pages.size === 1 && includeNextPage) {
      const first = Array.from(pages)[0];
      const next = first + 1;
      if (!totalPdfPages || next <= totalPdfPages) {
        pages.add(next);
      }
    }
  }

  return Array.from(pages).sort((a, b) => a - b);
}

/**
 * Convert Uint8Array to base64 safely in chunks without call-stack overflow.
 */
function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const sub = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    binary += String.fromCharCode(...sub);
  }
  return btoa(binary);
}

export const QuestionEditModal: React.FC<QuestionEditModalProps> = ({
  isOpen,
  onClose,
  question,
  chapterName,
  onSave,
  onDelete,
  isPossibleDuplicate = false,
  onNavigatePrev,
  onNavigateNext,
  hasPrev = false,
  hasNext = false,
  navIndex,
  navTotal,
  pdfBuffer = null,
  pdfFileName = '',
  savedPdfs = [],
  activePdfId = null,
  onSelectSavedPdf,
  onPdfLoaded,
  chapters = [],
  initialAnswerPage,
  grade,
  gradeKey,
  subject,
  subjectCode,
  medium,
}) => {
  const [qText, setQText] = useState<string>(question.question || '');
  const [ansText, setAnsText] = useState<string>(question.answer || '');
  const [marks, setMarks] = useState<number>(Number(question.marks) || 1);
  const [difficulty, setDifficulty] = useState<string>(question.difficulty || 'ಸಾಧಾರಣ');
  const [serialStr, setSerialStr] = useState<string>(
    question.questionNumber ? String(question.questionNumber) : ''
  );
  const [options, setOptions] = useState<string[]>(
    Array.isArray(question.options) ? [...question.options] : []
  );
  const [activeField, setActiveField] = useState<'question' | 'answer'>('answer');
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);
  const [confirmDelete, setConfirmDelete] = useState<boolean>(false);
  const [savedFeedback, setSavedFeedback] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Pull-from-PDF state
  const [localPdfBuffer, setLocalPdfBuffer] = useState<ArrayBuffer | null>(pdfBuffer);
  const [localPdfName, setLocalPdfName] = useState<string>(pdfFileName);
  const [totalPdfPages, setTotalPdfPages] = useState<number | null>(null);
  const [selectedPullChapterId, setSelectedPullChapterId] = useState<string>(
    question.chapterId || ''
  );
  const [pullQNo, setPullQNo] = useState<string>(
    question.questionNumber ? String(question.questionNumber) : ''
  );
  const [pullPageStr, setPullPageStr] = useState<string>('');
  const [includeNextPage, setIncludeNextPage] = useState<boolean>(true);
  const [pullQuestionToo, setPullQuestionToo] = useState<boolean>(false);
  const [pulledAnswerPage, setPulledAnswerPage] = useState<number | undefined>(
    question.answerPage
  );
  const [isPullingFromPdf, setIsPullingFromPdf] = useState<boolean>(false);
  const [isUploadingPdf, setIsUploadingPdf] = useState<boolean>(false);
  const [pullNotice, setPullNotice] = useState<{
    type: 'success' | 'warning' | 'error';
    text: string;
  } | null>(null);

  const questionRef = useRef<HTMLTextAreaElement | null>(null);
  const answerRef = useRef<HTMLTextAreaElement | null>(null);

  // Sync incoming PDF buffer/name from parent vault
  useEffect(() => {
    if (pdfBuffer) {
      setLocalPdfBuffer(pdfBuffer);
      setLocalPdfName(pdfFileName || 'Uploaded.pdf');
    }
  }, [pdfBuffer, pdfFileName]);

  // Read total page count of active PDF once loaded
  useEffect(() => {
    let cancelled = false;
    if (!localPdfBuffer) {
      setTotalPdfPages(null);
      return;
    }
    PDFDocument.load(localPdfBuffer.slice(0), { ignoreEncryption: true })
      .then(doc => {
        if (!cancelled) setTotalPdfPages(doc.getPageCount());
      })
      .catch(() => {
        if (!cancelled) setTotalPdfPages(null);
      });
    return () => {
      cancelled = true;
    };
  }, [localPdfBuffer]);

  // Selected chapter metadata for Pull-from-PDF
  const selectedPullChapter = useMemo(() => {
    if (chapters.length === 0) return null;
    return (
      chapters.find(c => c.chapterId === selectedPullChapterId) ||
      chapters.find(c => c.chapterId === question.chapterId) ||
      chapters[0]
    );
  }, [chapters, selectedPullChapterId, question.chapterId]);

  // Sync form state whenever user switches to another question (via Prev/Next or opening another card)
  useEffect(() => {
    setQText(question.question || '');
    setAnsText(question.answer || '');
    setMarks(Number(question.marks) || 1);
    setDifficulty(question.difficulty || 'ಸಾಧಾರಣ');
    const qNumStr = question.questionNumber ? String(question.questionNumber) : '';
    setSerialStr(qNumStr);
    setPullQNo(qNumStr);
    setOptions(Array.isArray(question.options) ? [...question.options] : []);
    setActiveField('answer');
    setSavedFeedback(false);
    setConfirmDelete(false);
    setErrorMsg(null);
    setPullNotice(null);
    setSelectedPullChapterId(question.chapterId || '');
    setPulledAnswerPage(question.answerPage);

    const chOpt = chapters.find(c => c.chapterId === question.chapterId);
    const defaultPage =
      question.answerPage ||
      initialAnswerPage ||
      parseFirstPageFromRange(chOpt?.answerPages) ||
      question.sourcePage ||
      parseFirstPageFromRange(chOpt?.questionPages);
    setPullPageStr(defaultPage ? String(defaultPage) : '');
  }, [
    question.id,
    question.chapterId,
    question.question,
    question.answer,
    question.marks,
    question.difficulty,
    question.questionNumber,
    question.options,
    question.answerPage,
    question.sourcePage,
    initialAnswerPage,
    chapters,
  ]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isPullingFromPdf) onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose, isPullingFromPdf]);

  if (!isOpen) return null;

  const insertSymbol = (sym: string, cursorOffsetBack: number = 0) => {
    const targetRef = activeField === 'question' ? questionRef.current : answerRef.current;
    const currentVal = activeField === 'question' ? qText : ansText;
    const setter = activeField === 'question' ? setQText : setAnsText;

    if (targetRef) {
      const start = targetRef.selectionStart ?? currentVal.length;
      const end = targetRef.selectionEnd ?? currentVal.length;
      const next = currentVal.slice(0, start) + sym + currentVal.slice(end);
      setter(next);
      const cursorPos = Math.max(0, start + sym.length - cursorOffsetBack);
      requestAnimationFrame(() => {
        targetRef.focus();
        targetRef.setSelectionRange(cursorPos, cursorPos);
      });
    } else {
      setter(currentVal + sym);
    }
    setSavedFeedback(false);
  };

  const nudgePullPage = (delta: number) => {
    const first = parseFirstPageFromRange(pullPageStr) || 1;
    const next = Math.max(1, totalPdfPages ? Math.min(totalPdfPages, first + delta) : first + delta);
    setPullPageStr(String(next));
    setPullNotice(null);
  };

  const handleUploadPdfInline = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setIsUploadingPdf(true);
    setPullNotice(null);
    try {
      const buf = await file.arrayBuffer();
      const doc = await PDFDocument.load(buf.slice(0), { ignoreEncryption: true });
      const pageCount = doc.getPageCount();
      setLocalPdfBuffer(buf);
      setLocalPdfName(file.name);
      setTotalPdfPages(pageCount);

      let savedEntry: SavedPdfEntry | undefined;
      try {
        savedEntry = await savePdfPermanently({
          buffer: buf.slice(0),
          fileName: file.name,
          totalPages: pageCount,
          grade,
          gradeKey,
          subject,
          subjectCode,
        });
      } catch {
        // Local in-memory buffer still works immediately even if background vault save is offline
      }

      if (onPdfLoaded) {
        onPdfLoaded(buf, file.name, savedEntry);
      }

      setPullNotice({
        type: 'success',
        text: `PDF "${file.name}" (${pageCount} ಪುಟಗಳು) ಲೋಡ್ ಆಗಿದೆ! ಈಗ ಪುಟ ಸಂಖ್ಯೆ ನಮೂದಿಸಿ "PDF ನಿಂದ ಉತ್ತರ ಎಳೆದುಕೊಳ್ಳಿ" ಒತ್ತಿ.`,
      });
    } catch (err: any) {
      setPullNotice({
        type: 'error',
        text: `PDF ಲೋಡ್ ಮಾಡುವಲ್ಲಿ ದೋಷ: ${err?.message || 'ಮಾನ್ಯವಾದ PDF ಫೈಲ್ ಆಯ್ಕೆಮಾಡಿ.'}`,
      });
    } finally {
      setIsUploadingPdf(false);
    }
  };

  const handlePullAnswerFromPdf = async () => {
    if (!localPdfBuffer) {
      setPullNotice({
        type: 'error',
        text: 'ಮೊದಲು PDF ಫೈಲ್ ಅನ್ನು ಆಯ್ಕೆಮಾಡಿ ಅಥವಾ ಅಪ್‌ಲೋಡ್ ಮಾಡಿ (Please select or upload the LBA PDF first).',
      });
      return;
    }

    const pagesToSlice = parsePageSelection(pullPageStr, includeNextPage, totalPdfPages);
    if (pagesToSlice.length === 0) {
      setPullNotice({
        type: 'error',
        text: 'ದಯವಿಟ್ಟು ಸರಿಯಾದ PDF ಪುಟ ಸಂಖ್ಯೆಯನ್ನು ನಮೂದಿಸಿ (ಉದಾ: 84 ಅಥವಾ 84-85).',
      });
      return;
    }

    setIsPullingFromPdf(true);
    setPullNotice(null);
    setErrorMsg(null);

    try {
      const srcDoc = await PDFDocument.load(localPdfBuffer.slice(0), { ignoreEncryption: true });
      const maxPages = srcDoc.getPageCount();
      const validZeroBased = pagesToSlice
        .map(p => p - 1)
        .filter(idx => idx >= 0 && idx < maxPages);

      if (validZeroBased.length === 0) {
        setPullNotice({
          type: 'error',
          text: `ಪುಟ ಸಂಖ್ಯೆ 1 ರಿಂದ ${maxPages} ರ ಒಳಗಿರಬೇಕು (This PDF has ${maxPages} pages).`,
        });
        return;
      }

      const sliceDoc = await PDFDocument.create();
      const copiedPages = await sliceDoc.copyPages(srcDoc, validZeroBased);
      copiedPages.forEach(p => sliceDoc.addPage(p));
      const sliceBytes = await sliceDoc.save();
      const base64Pdf = uint8ArrayToBase64(sliceBytes);

      const physicalPages = validZeroBased.map(idx => idx + 1);
      const pageRangeLabel =
        physicalPages.length === 1
          ? `Page ${physicalPages[0]}`
          : `Pages ${physicalPages[0]}-${physicalPages[physicalPages.length - 1]}`;

      const targetChapterNum =
        selectedPullChapter?.chapterNumber ?? question.chapterNumber ?? '';
      const targetChapterName =
        selectedPullChapter?.chapterName || chapterName || question.chapterName || '';

      const resp = await fetch('/api/ai/pull-single-answer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          base64Pdf,
          pageRangeLabel,
          physicalPages,
          chapterNumber: targetChapterNum,
          chapterName: targetChapterName,
          questionNumber: pullQNo.trim() || serialStr.trim(),
          questionText: qText.trim(),
          marks,
          subject: subject || 'Mathematics',
          medium: medium || '',
          pullQuestionToo,
        }),
      });

      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        throw new Error(data?.error || `ಸರ್ವರ್ ದೋಷ (${resp.status})`);
      }

      if (data.found && data.answer) {
        setAnsText(data.answer);
        if (pullQuestionToo && data.question) {
          setQText(data.question);
        }
        if (pullQuestionToo && Array.isArray(data.options) && data.options.length > 0) {
          setOptions(data.options);
        }
        if (typeof data.pageFound === 'number' && data.pageFound > 0) {
          setPulledAnswerPage(data.pageFound);
        } else {
          setPulledAnswerPage(physicalPages[0]);
        }
        setSavedFeedback(false);
        const qLabel = data.matchedQuestionNumber || pullQNo || serialStr || '';
        const pLabel = data.pageFound || physicalPages[0];
        setPullNotice({
          type: 'success',
          text: `PDF ಪುಟ #${pLabel} ರಿಂದ ಪ್ರಶ್ನೆ ${qLabel ? `#${qLabel} ರ ` : ''}ಸಂಪೂರ್ಣ ವಿವರವಾದ ಉತ್ತರ (ಭಿನ್ನರಾಶಿಗಳ ಸಹಿತ) ಯಶಸ್ವಿಯಾಗಿ ಎಳೆದುಕೊಳ್ಳಲಾಗಿದೆ! ಕೆಳಗಿನ ಮುದ್ರಣ ಪೂರ್ವವೀಕ್ಷಣೆ ಪರಿಶೀಲಿಸಿ Save ಒತ್ತಿ.`,
        });
      } else {
        setPullNotice({
          type: 'warning',
          text:
            data.notes
              ? `ಆಯ್ಕೆ ಮಾಡಿದ ಪುಟ (${physicalPages.join(', ')}) ದಲ್ಲಿ ಈ ಪ್ರಶ್ನೆಯ ಉತ್ತರ ಕಂಡುಬಂದಿಲ್ಲ. ಕಂಡುಬಂದ ಮಾಹಿತಿ: ${data.notes}`
              : `ಪುಟ ${physicalPages.join(', ')} ದಲ್ಲಿ ಪ್ರಶ್ನೆ #${pullQNo || serialStr} ರ ಉತ್ತರ ಕಂಡುಬಂದಿಲ್ಲ. ದಯವಿಟ್ಟು ಹಿಂದಿನ/ಮುಂದಿನ ಪುಟ ಸಂಖ್ಯೆ (- / +) ಪ್ರಯತ್ನಿಸಿ.`,
        });
      }
    } catch (err: any) {
      setPullNotice({
        type: 'error',
        text: err?.message || 'PDF ಪುಟದಿಂದ ಉತ್ತರ ಎಳೆದುಕೊಳ್ಳುವಲ್ಲಿ ದೋಷ ಸಂಭವಿಸಿದೆ.',
      });
    } finally {
      setIsPullingFromPdf(false);
    }
  };

  const handleSaveClick = async (andGoNext: boolean = false) => {
    const trimmedQ = qText.trim();
    if (!trimmedQ) {
      setErrorMsg('ಪ್ರಶ್ನೆಯ ಪಠ್ಯ ಖಾಲಿಯಾಗಿರಬಾರದು (Question text cannot be empty).');
      return;
    }

    setIsSaving(true);
    setErrorMsg(null);
    setSavedFeedback(false);

    try {
      const parsedNum = parseInt(serialStr.trim(), 10);
      const cleanOptions = options.map(o => o.trim()).filter(Boolean);
      const parsedPage = pulledAnswerPage || parseFirstPageFromRange(pullPageStr);

      await onSave({
        question: trimmedQ,
        answer: ansText.trim(),
        marks: Math.max(1, Number(marks) || 1),
        difficulty: difficulty.trim() || 'ಸಾಧಾರಣ',
        questionNumber: !isNaN(parsedNum) && parsedNum > 0 ? parsedNum : undefined,
        printedSerial: !isNaN(parsedNum) && parsedNum > 0 ? String(parsedNum) : question.printedSerial,
        options: cleanOptions.length > 0 ? cleanOptions : undefined,
        ...(parsedPage ? { answerPage: parsedPage } : {}),
      });

      setSavedFeedback(true);
      if (andGoNext && hasNext && onNavigateNext) {
        onNavigateNext();
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'ಉಳಿಸುವಲ್ಲಿ ದೋಷ ಸಂಭವಿಸಿದೆ.');
    } finally {
      setIsSaving(false);
    }
  };

  const showQuestionPreview =
    qText.includes('\\frac') || qText.includes('^') || qText.includes('_');

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-[2px] flex items-center justify-center p-3 sm:p-5 font-kannada"
      role="dialog"
      aria-modal="true"
      aria-label="ಪ್ರಶ್ನೆ ಮತ್ತು ಉತ್ತರ ತಿದ್ದುಪಡಿ"
    >
      <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-3xl max-h-[94vh] flex flex-col overflow-hidden">
        {/* Modal Header */}
        <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-indigo-600 text-white flex items-center justify-center shrink-0">
              <Edit3 className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                ಪ್ರಶ್ನೆ &amp; ವಿವರವಾದ ಉತ್ತರ ತಿದ್ದುಪಡಿ (Edit Question &amp; Detailed Answer)
              </h3>
              <p className="text-2xs text-slate-500">
                {chapterName || question.chapterName}
                {question.questionNumber ? ` · PDF ಕ್ರಮ ಸಂಖ್ಯೆ #${question.questionNumber}` : ''}
                {navIndex && navTotal ? ` · (${navIndex} / ${navTotal})` : ''}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            {onNavigatePrev && (
              <button
                type="button"
                disabled={!hasPrev || isSaving || isPullingFromPdf}
                onClick={onNavigatePrev}
                className="px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 disabled:opacity-40 text-xs font-semibold text-slate-700 flex items-center gap-1 cursor-pointer"
                title="ಹಿಂದಿನ ಪ್ರಶ್ನೆ (Previous Question)"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                <span>ಹಿಂದಿನ</span>
              </button>
            )}
            {onNavigateNext && (
              <button
                type="button"
                disabled={!hasNext || isSaving || isPullingFromPdf}
                onClick={onNavigateNext}
                className="px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 disabled:opacity-40 text-xs font-semibold text-slate-700 flex items-center gap-1 cursor-pointer"
                title="ಮುಂದಿನ ಪ್ರಶ್ನೆ (Next Question)"
              >
                <span>ಮುಂದಿನ</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              disabled={isPullingFromPdf}
              className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-200 disabled:opacity-40 transition-colors cursor-pointer"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Scrollable Editor Body */}
        <div className="p-5 overflow-y-auto space-y-4 text-xs">
          {errorMsg && (
            <div className="px-3.5 py-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 font-semibold">
              {errorMsg}
            </div>
          )}

          {savedFeedback && (
            <div className="px-3.5 py-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 font-semibold flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>ಬದಲಾವಣೆಗಳನ್ನು JSON ಮತ್ತು Firebase ಕ್ಲೌಡ್‌ನಲ್ಲಿ ಶಾಶ್ವತವಾಗಿ ಉಳಿಸಲಾಗಿದೆ!</span>
            </div>
          )}

          {/* Pull Detailed Answer Automatically from Uploaded PDF */}
          <div className="bg-amber-50/75 border border-amber-300 rounded-xl p-3.5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-amber-600 text-white flex items-center justify-center shrink-0">
                  <Sparkles className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="text-xs font-bold text-amber-950">
                    PDF ನಿಂದ ವಿವರವಾದ ಉತ್ತರ &amp; ಭಿನ್ನರಾಶಿಗಳನ್ನು ಸ್ವಯಂಚಾಲಿತವಾಗಿ ಎಳೆದುಕೊಳ್ಳಿ (Pull Answer from PDF)
                  </h4>
                  <p className="text-3xs text-amber-800">
                    ಕಾಪಿ-ಪೇಸ್ಟ್ ಮಾಡಿದಾಗ ಭಿನ್ನರಾಶಿಗಳು ತಪ್ಪಾಗುವುದನ್ನು ತಪ್ಪಿಸಲು ಅಧ್ಯಾಯ, ಪ್ರಶ್ನೆ ಸಂಖ್ಯೆ ಮತ್ತು PDF ಪುಟ ಸಂಖ್ಯೆ ನೀಡಿ ನೇರವಾಗಿ ಎಳೆದುಕೊಳ್ಳಿ
                  </p>
                </div>
              </div>

              {/* PDF Source status / quick uploader */}
              <div className="flex flex-wrap items-center gap-1.5">
                {savedPdfs.length > 0 && onSelectSavedPdf && (
                  <select
                    value={activePdfId || ''}
                    onChange={e => {
                      const chosen = savedPdfs.find(p => p.id === e.target.value);
                      if (chosen) {
                        setPullNotice(null);
                        onSelectSavedPdf(chosen);
                      }
                    }}
                    className="max-w-[200px] bg-white border border-amber-300 rounded-lg px-2 py-1 text-3xs font-semibold text-slate-800 focus:ring-1 focus:ring-amber-500 focus:outline-hidden cursor-pointer"
                    title="ಉಳಿಸಿದ PDF ಆಯ್ಕೆಮಾಡಿ (Select Saved PDF)"
                  >
                    <option value="">-- ಉಳಿಸಿದ PDF ಆಯ್ಕೆಮಾಡಿ --</option>
                    {savedPdfs.map(p => (
                      <option key={p.id} value={p.id}>
                        📄 {p.fileName} ({p.totalPages}p)
                      </option>
                    ))}
                  </select>
                )}

                <label className="px-2.5 py-1 rounded-lg bg-white hover:bg-amber-100 border border-amber-300 text-amber-900 text-3xs font-bold flex items-center gap-1 cursor-pointer whitespace-nowrap">
                  <Upload className="w-3 h-3" />
                  <span>{isUploadingPdf ? 'ಲೋಡ್ ಆಗುತ್ತಿದೆ...' : localPdfBuffer ? 'ಬೇರೆ PDF' : 'PDF ಅಪ್‌ಲೋಡ್'}</span>
                  <input
                    type="file"
                    accept="application/pdf,.pdf"
                    onChange={handleUploadPdfInline}
                    disabled={isUploadingPdf || isPullingFromPdf}
                    className="hidden"
                  />
                </label>
              </div>
            </div>

            {localPdfBuffer ? (
              <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg bg-emerald-50 border border-emerald-200 text-3xs text-emerald-900">
                <div className="flex items-center gap-1.5 truncate">
                  <FileText className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                  <span className="font-bold truncate">{localPdfName || 'LBA PDF'}</span>
                  {totalPdfPages && (
                    <span className="text-emerald-700 shrink-0 tabular-nums">
                      ({totalPdfPages} ಪುಟಗಳು)
                    </span>
                  )}
                </div>
                {selectedPullChapter?.answerPages && (
                  <span className="text-emerald-800 font-semibold shrink-0 tabular-nums">
                    ಅಧ್ಯಾಯದ ಉತ್ತರ ಪುಟಗಳು: {selectedPullChapter.answerPages}
                  </span>
                )}
              </div>
            ) : (
              <div className="px-2.5 py-1.5 rounded-lg bg-white/80 border border-amber-200 text-3xs text-amber-900 flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                <span>
                  ಯಾವುದೇ PDF ಲೋಡ್ ಆಗಿಲ್ಲ. ಮೇಲಿನ <strong>&quot;PDF ಅಪ್‌ಲೋಡ್&quot;</strong> ಅಥವಾ ಉಳಿಸಿದ PDF ಡ್ರಾಪ್‌ಡೌನ್‌ನಿಂದ LBA PDF ಆಯ್ಕೆಮಾಡಿ.
                </span>
              </div>
            )}

            {/* Chapter + Question No. + PDF Page No. Controls */}
            <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-end">
              {/* Chapter selector */}
              <div className="sm:col-span-5">
                <label className="block text-3xs font-bold text-amber-950 mb-1">
                  1. ಅಧ್ಯಾಯ (Chapter)
                </label>
                {chapters.length > 0 ? (
                  <select
                    value={selectedPullChapter?.chapterId || ''}
                    onChange={e => {
                      const nextId = e.target.value;
                      setSelectedPullChapterId(nextId);
                      const ch = chapters.find(c => c.chapterId === nextId);
                      const hintPage = parseFirstPageFromRange(ch?.answerPages);
                      if (hintPage) setPullPageStr(String(hintPage));
                      setPullNotice(null);
                    }}
                    className="w-full bg-white border border-amber-300 rounded-lg px-2 py-1.5 text-2xs font-semibold text-slate-900 focus:ring-1 focus:ring-amber-500 focus:outline-hidden cursor-pointer"
                  >
                    {chapters.map((ch, idx) => (
                      <option key={ch.chapterId} value={ch.chapterId}>
                        ಅಧ್ಯಾಯ {ch.chapterNumber ?? idx + 1}: {ch.chapterName}
                        {ch.answerPages ? ` (ಉ.ಪು: ${ch.answerPages})` : ''}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    readOnly
                    value={chapterName || question.chapterName || ''}
                    className="w-full bg-amber-100/50 border border-amber-200 rounded-lg px-2.5 py-1.5 text-2xs font-semibold text-slate-800"
                  />
                )}
              </div>

              {/* Question Number */}
              <div className="sm:col-span-3">
                <label className="block text-3xs font-bold text-amber-950 mb-1">
                  2. ಪ್ರಶ್ನೆ ಸಂಖ್ಯೆ (Q. No.)
                </label>
                <input
                  type="text"
                  value={pullQNo}
                  onChange={e => {
                    setPullQNo(e.target.value);
                    setPullNotice(null);
                  }}
                  placeholder="ಉದಾ: 53"
                  className="w-full bg-white border border-amber-300 rounded-lg px-2.5 py-1.5 text-2xs font-bold text-slate-900 focus:ring-1 focus:ring-amber-500 focus:outline-hidden tabular-nums"
                />
              </div>

              {/* PDF Page No. / Range */}
              <div className="sm:col-span-4">
                <label className="block text-3xs font-bold text-amber-950 mb-1">
                  3. PDF ಪುಟ ಸಂಖ್ಯೆ (Page No. / Range)
                </label>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => nudgePullPage(-1)}
                    disabled={isPullingFromPdf}
                    className="p-1.5 rounded-lg bg-white hover:bg-amber-100 border border-amber-300 text-amber-900 cursor-pointer shrink-0"
                    title="ಹಿಂದಿನ ಪುಟ (-1 Page)"
                  >
                    <Minus className="w-3.5 h-3.5" />
                  </button>
                  <input
                    type="text"
                    value={pullPageStr}
                    onChange={e => {
                      setPullPageStr(e.target.value);
                      setPullNotice(null);
                    }}
                    placeholder="ಉದಾ: 84 ಅಥವಾ 84-85"
                    className="w-full bg-white border border-amber-300 rounded-lg px-2 py-1.5 text-2xs font-bold text-slate-900 text-center focus:ring-1 focus:ring-amber-500 focus:outline-hidden tabular-nums"
                  />
                  <button
                    type="button"
                    onClick={() => nudgePullPage(1)}
                    disabled={isPullingFromPdf}
                    className="p-1.5 rounded-lg bg-white hover:bg-amber-100 border border-amber-300 text-amber-900 cursor-pointer shrink-0"
                    title="ಮುಂದಿನ ಪುಟ (+1 Page)"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>

            {/* Options + Action button */}
            <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
              <div className="flex flex-wrap items-center gap-3 text-3xs text-amber-950 font-semibold">
                <label className="inline-flex items-center gap-1.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={includeNextPage}
                    onChange={e => setIncludeNextPage(e.target.checked)}
                    className="rounded border-amber-400 text-amber-600 focus:ring-amber-500"
                  />
                  <span>+1 ಮುಂದಿನ ಪುಟವನ್ನೂ ಸೇರಿಸಿ (ಉದ್ದ ಉತ್ತರಗಳಿಗೆ)</span>
                </label>

                <label className="inline-flex items-center gap-1.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={pullQuestionToo}
                    onChange={e => setPullQuestionToo(e.target.checked)}
                    className="rounded border-amber-400 text-amber-600 focus:ring-amber-500"
                  />
                  <span>ಪ್ರಶ್ನೆ ಪಠ್ಯವನ್ನೂ ನವೀಕರಿಸಿ</span>
                </label>
              </div>

              <button
                type="button"
                disabled={isPullingFromPdf || !localPdfBuffer || !pullPageStr.trim()}
                onClick={handlePullAnswerFromPdf}
                className="px-3.5 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white text-xs font-bold flex items-center gap-1.5 shadow-xs transition-colors cursor-pointer whitespace-nowrap"
              >
                {isPullingFromPdf ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>PDF ಪುಟದಿಂದ ಓದಲಾಗುತ್ತಿದೆ...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>PDF ನಿಂದ ಉತ್ತರ ಎಳೆದುಕೊಳ್ಳಿ (Pull Answer)</span>
                  </>
                )}
              </button>
            </div>

            {pullNotice && (
              <div
                className={`px-3 py-2 rounded-lg border text-2xs font-semibold flex items-start gap-2 ${
                  pullNotice.type === 'success'
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                    : pullNotice.type === 'warning'
                      ? 'bg-amber-100/80 border-amber-300 text-amber-950'
                      : 'bg-rose-50 border-rose-200 text-rose-800'
                }`}
              >
                {pullNotice.type === 'success' ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                ) : (
                  <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                )}
                <span>{pullNotice.text}</span>
              </div>
            )}
          </div>

          {/* Metadata Row: PDF Serial, Marks, Difficulty */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-slate-50 border border-slate-200/80 rounded-xl p-3">
            <div>
              <label className="block text-2xs font-bold text-slate-700 mb-1">
                PDF ಕ್ರಮ ಸಂಖ್ಯೆ (Q. No.)
              </label>
              <input
                type="number"
                min={1}
                value={serialStr}
                onChange={e => {
                  setSerialStr(e.target.value);
                  setPullQNo(e.target.value);
                  setSavedFeedback(false);
                }}
                placeholder="ಉದಾ: 53"
                className="w-full bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-slate-900 focus:ring-1 focus:ring-indigo-500 focus:outline-hidden"
              />
            </div>

            <div>
              <label className="block text-2xs font-bold text-slate-700 mb-1">
                ಅಂಕಗಳು (Marks)
              </label>
              <select
                value={marks}
                onChange={e => {
                  setMarks(Number(e.target.value));
                  setSavedFeedback(false);
                }}
                className="w-full bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-slate-900 focus:ring-1 focus:ring-indigo-500 focus:outline-hidden cursor-pointer"
              >
                {[1, 2, 3, 4, 5, 6].map(m => (
                  <option key={m} value={m}>
                    {m} {m === 1 ? 'ಅಂಕ (1M)' : `ಅಂಕಗಳು (${m}M)`}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-2xs font-bold text-slate-700 mb-1">
                ಕ್ಲಿಷ್ಟತೆ (Difficulty)
              </label>
              <select
                value={difficulty}
                onChange={e => {
                  setDifficulty(e.target.value);
                  setSavedFeedback(false);
                }}
                className="w-full bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-slate-900 focus:ring-1 focus:ring-indigo-500 focus:outline-hidden cursor-pointer"
              >
                <option value="ಸುಲಭ">ಸುಲಭ (Easy)</option>
                <option value="ಸಾಧಾರಣ">ಸಾಧಾರಣ (Average / Medium)</option>
                <option value="ಕಠಿಣ">ಕಠಿಣ (Difficult)</option>
              </select>
            </div>
          </div>

          {/* Quick Math Symbol & Fraction Insert Bar */}
          <div className="bg-indigo-50/70 border border-indigo-200/80 rounded-xl px-3 py-2 space-y-1.5">
            <div className="flex flex-wrap items-center justify-between gap-1 text-2xs text-indigo-900 font-bold">
              <span>
                ಗಣಿತ ಚಿಹ್ನೆಗಳು &amp; ಭಿನ್ನರಾಶಿ (Click to insert into{' '}
                {activeField === 'question' ? 'Question' : 'Answer'}):
              </span>
              <span className="text-3xs font-medium text-indigo-700">
                Tip: \frac&#123;1&#125;&#123;2&#125; → ಲಂಬ ಭಿನ್ನರಾಶಿ, x^2 → x²
              </span>
            </div>
            <div className="flex flex-wrap gap-1 items-center">
              <button
                type="button"
                onMouseDown={e => e.preventDefault()}
                onClick={() => insertSymbol('\\frac{}{}', 3)}
                className="h-7 px-2 rounded-md bg-indigo-600 hover:bg-indigo-700 text-white border border-indigo-700 text-2xs font-bold transition-colors cursor-pointer flex items-center gap-1"
                title="ಲಂಬ ಭಿನ್ನರಾಶಿ ಸೇರಿಸಿ (Insert Stacked Fraction \frac{a}{b})"
              >
                <span>a/b ಭಿನ್ನರಾಶಿ</span>
              </button>
              {MATH_SYMBOLS.map(sym => (
                <button
                  key={sym}
                  type="button"
                  onMouseDown={e => e.preventDefault()}
                  onClick={() => insertSymbol(sym)}
                  className="min-w-7 h-7 px-1.5 rounded-md bg-white hover:bg-indigo-600 hover:text-white border border-indigo-200 text-xs font-bold text-slate-800 transition-colors cursor-pointer"
                >
                  {sym}
                </button>
              ))}
            </div>
          </div>

          {/* Question Text */}
          <div>
            <label className="block text-2xs font-bold text-slate-800 mb-1">
              ಪ್ರಶ್ನೆ (Question Text)
            </label>
            <textarea
              ref={questionRef}
              rows={3}
              value={qText}
              onFocus={() => setActiveField('question')}
              onChange={e => {
                setQText(e.target.value);
                setSavedFeedback(false);
              }}
              className="w-full bg-white border border-slate-300 rounded-xl p-3 text-xs sm:text-sm text-slate-900 leading-relaxed focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 focus:outline-hidden"
            />
            {showQuestionPreview && (
              <div className="mt-1.5 px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-800 leading-relaxed">
                <span className="text-3xs font-bold text-slate-500 mr-1.5">ಪ್ರಶ್ನೆ ಪೂರ್ವವೀಕ್ಷಣೆ:</span>
                <MathText text={qText} />
              </div>
            )}
          </div>

          {/* Optional MCQ Options Editor */}
          {(options.length > 0 || question.formatCategoryId === 'mcq') && (
            <div className="space-y-2 bg-slate-50 border border-slate-200 rounded-xl p-3">
              <div className="flex items-center justify-between">
                <label className="text-2xs font-bold text-slate-700">
                  ಬಹು ಆಯ್ಕೆಗಳು (MCQ Options)
                </label>
                <button
                  type="button"
                  onClick={() => {
                    setOptions(prev => [...prev, '']);
                    setSavedFeedback(false);
                  }}
                  className="px-2 py-0.5 bg-white hover:bg-indigo-50 text-indigo-700 border border-indigo-200 rounded text-3xs font-bold flex items-center gap-1 cursor-pointer"
                >
                  <Plus className="w-3 h-3" />
                  <span>ಆಯ್ಕೆ ಸೇರಿಸಿ</span>
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {options.map((opt, idx) => (
                  <div key={idx} className="flex items-center gap-1.5">
                    <input
                      type="text"
                      value={opt}
                      onChange={e => {
                        const next = [...options];
                        next[idx] = e.target.value;
                        setOptions(next);
                        setSavedFeedback(false);
                      }}
                      placeholder={`ಆಯ್ಕೆ ${idx + 1}`}
                      className="flex-1 bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs text-slate-900 focus:ring-1 focus:ring-indigo-500 focus:outline-hidden"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        setOptions(prev => prev.filter((_, i) => i !== idx));
                        setSavedFeedback(false);
                      }}
                      className="p-1.5 text-rose-600 hover:bg-rose-50 rounded-lg cursor-pointer"
                      title="Remove option"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Detailed Step-by-Step Answer */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-2xs font-bold text-emerald-900">
                ವಿವರವಾದ ಉತ್ತರ (Detailed Step-by-Step Answer)
              </label>
              <span className="text-3xs text-slate-500 tabular-nums">
                {ansText.trim().length} ಅಕ್ಷರಗಳು · ಪ್ರತಿ ಹಂತಕ್ಕೂ Enter ಒತ್ತಿ (New line per step)
              </span>
            </div>
            <textarea
              ref={answerRef}
              rows={7}
              value={ansText}
              onFocus={() => setActiveField('answer')}
              onChange={e => {
                setAnsText(e.target.value);
                setSavedFeedback(false);
              }}
              placeholder="ಮೇಲಿನ 'PDF ನಿಂದ ಉತ್ತರ ಎಳೆದುಕೊಳ್ಳಿ' ಬಟನ್ ಒತ್ತಿ ಅಥವಾ ಇಲ್ಲಿ ಸಂಪೂರ್ಣ ಹಂತ-ಹಂತದ ಉತ್ತರ ಟೈಪ್ ಮಾಡಿ..."
              className="w-full bg-white border border-emerald-300 rounded-xl p-3 text-xs sm:text-sm text-slate-900 leading-relaxed focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 focus:outline-hidden font-kannada"
            />
          </div>

          {/* Live Formatted Math Preview */}
          <div className="bg-emerald-50/70 border border-emerald-200 rounded-xl p-3.5 space-y-1.5">
            <div className="flex items-center gap-1.5 text-2xs font-bold text-emerald-800">
              <Eye className="w-3.5 h-3.5" />
              <span>ಮುದ್ರಣ ಪೂರ್ವವೀಕ್ಷಣೆ — ಭಿನ್ನರಾಶಿಗಳು &amp; ಘಾತಾಂಕಗಳು (Live Formatted Preview):</span>
            </div>
            <div className="text-xs sm:text-sm text-emerald-950 whitespace-pre-line leading-loose">
              <MathText text={ansText || '— ಉತ್ತರ ಖಾಲಿಯಾಗಿದೆ —'} />
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="px-5 py-3.5 border-t border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isPullingFromPdf || isDeleting}
              className="px-4 py-2 rounded-xl border border-slate-300 bg-white hover:bg-slate-100 disabled:opacity-40 text-xs font-bold text-slate-700 cursor-pointer"
            >
              ಮುಚ್ಚಿ (Close)
            </button>

            {onDelete && (
              confirmDelete ? (
                <div className="flex items-center gap-1.5 bg-rose-50 border border-rose-300 rounded-xl px-2.5 py-1">
                  <span className="text-2xs font-bold text-rose-900">
                    {isPossibleDuplicate ? 'ಡುಪ್ಲಿಕೇಟ್ ಡಿಲೀಟ್?' : 'ಖಚಿತವಾಗಿ ಡಿಲೀಟ್?'}
                  </span>
                  <button
                    type="button"
                    disabled={isDeleting || isSaving || isPullingFromPdf}
                    onClick={async () => {
                      setIsDeleting(true);
                      setErrorMsg(null);
                      try {
                        await onDelete();
                        setConfirmDelete(false);
                      } catch (err: any) {
                        setErrorMsg(err?.message || 'ಪ್ರಶ್ನೆ ಡಿಲೀಟ್ ಮಾಡುವಲ್ಲಿ ದೋಷ ಸಂಭವಿಸಿದೆ.');
                      } finally {
                        setIsDeleting(false);
                      }
                    }}
                    className="px-2.5 py-1 rounded-lg bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white text-2xs font-bold cursor-pointer"
                  >
                    {isDeleting ? 'ಡಿಲೀಟ್...' : 'ಹೌದು, ಡಿಲೀಟ್'}
                  </button>
                  <button
                    type="button"
                    disabled={isDeleting}
                    onClick={() => setConfirmDelete(false)}
                    className="px-2 py-1 rounded-lg bg-white hover:bg-slate-100 border border-slate-300 text-slate-700 text-2xs font-semibold cursor-pointer"
                  >
                    ರದ್ದು
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  disabled={isSaving || isPullingFromPdf || isDeleting}
                  onClick={() => setConfirmDelete(true)}
                  className="px-3 py-2 rounded-xl border border-rose-300 bg-rose-50 hover:bg-rose-100 disabled:opacity-40 text-rose-800 text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                  title="ಈ ಪ್ರಶ್ನೆ ಡುಪ್ಲಿಕೇಟ್ ಆಗಿದ್ದರೆ ಶಾಶ್ವತವಾಗಿ ಡಿಲೀಟ್ ಮಾಡಿ"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>
                    {isPossibleDuplicate ? 'ಡುಪ್ಲಿಕೇಟ್ ಡಿಲೀಟ್ (Delete)' : 'ಪ್ರಶ್ನೆ ಡಿಲೀಟ್ (Delete)'}
                  </span>
                </button>
              )
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={isSaving || isPullingFromPdf || isDeleting}
              onClick={() => handleSaveClick(false)}
              className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
            >
              <Save className="w-3.5 h-3.5" />
              <span>{isSaving ? 'ಉಳಿಸಲಾಗುತ್ತಿದೆ...' : 'JSON & Cloud ಗೆ ಉಳಿಸಿ (Save)'}</span>
            </button>

            {onNavigateNext && hasNext && (
              <button
                type="button"
                disabled={isSaving || isPullingFromPdf || isDeleting}
                onClick={() => handleSaveClick(true)}
                className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
              >
                <Save className="w-3.5 h-3.5" />
                <span>ಉಳಿಸಿ &amp; ಮುಂದಿನ ಪ್ರಶ್ನೆ (Save &amp; Next)</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
