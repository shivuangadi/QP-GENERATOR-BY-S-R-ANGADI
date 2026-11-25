/**
 * Question Bank Explorer & Diagram Management Hub
 * Browse, filter, and manage all questions, answers, and diagram images across
 * built-in and permanently saved JSON question banks (Firebase + Server + Local .json).
 * Includes unit-wise (chapter-wise) pending image upload counters and Permanent PDF Vault integration.
 * Author: S R Angadi / M I Nilaji
 */

import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { QuestionBank, QuestionItem, IndexEntry } from '../types/questionBank.ts';
import {
  BookOpen,
  Search,
  CheckCircle2,
  HelpCircle,
  GraduationCap,
  Globe,
  ChevronDown,
  Crop,
  Download,
  RefreshCw,
  AlertTriangle,
  Trash2,
  Replace,
  FileJson,
  FolderOpen,
  Cloud,
  EyeOff,
  AlertCircle,
  Edit3,
} from 'lucide-react';
import {
  matchesGrade,
  extractGradeKey,
  canonicalGradeLabel,
  normalizeSubjectName,
  deduceSubjectCode,
  getSubjectDedupKey,
  formatDropdownSubjectLabel,
  normalizeQuestionBank,
  ensureUniqueQuestionIds,
} from '../services/dataLoader.ts';
import {
  smartMergeQuestionBanks,
  parseUploadedJsonToQuestionBank,
  pickBestMatchingBankCandidate,
  formatMergeSummaryKannada,
  deduplicateQuestionBank,
  areQuestionsDuplicates,
  isAnswerMissingOrIncomplete,
} from '../utils/bankMerger.ts';
import {
  deleteQuestionImageFromFirebase,
  extractImageIdFromUrl,
} from '../services/firebase.ts';
import {
  SavedPdfEntry,
  SavedBankSummary,
  listSavedPdfsCombined,
  loadPdfBufferPermanently,
  savePdfPermanently,
  findMatchingSavedPdf,
  listAllSavedQuestionBanks,
  loadSavedQuestionBank,
  deleteSavedQuestionBankPermanently,
} from '../services/pdfVault.ts';
import { MathText } from './MathText.tsx';
import {
  ImageFilterMode,
  detectImageRequirement,
  matchesImageFilter,
  computeBankImageAudit,
} from '../utils/diagramDetector.ts';
import { DiagramAuditPanel } from './DiagramAuditPanel.tsx';
import { QuestionImageModal, QuestionImageUpdate } from './QuestionImageModal.tsx';
import { QuestionEditModal, QuestionTextUpdate } from './QuestionEditModal.tsx';
import { SavedJsonBanksTable } from './SavedJsonBanksTable.tsx';

interface QuestionBankExplorerProps {
  bank: QuestionBank;
  availableFiles?: IndexEntry[];
  grade?: string;
  setGrade?: (g: string) => void;
  medium?: string;
  setMedium?: (m: string) => void;
  selectedFileId?: string;
  onSelectFile?: (fileId: string) => void;
  onUpdateBank?: (updatedBank: QuestionBank) => Promise<void> | void;
  onOpenSavedBank?: (loadedBank: QuestionBank, entry?: IndexEntry) => void;
  onDeleteSavedBank?: (deletedId: string) => void;
}

export function matchesDifficulty(
  diff: string | undefined | null,
  selectedDiff: string,
  rawMarks?: number | string
): boolean {
  if (!selectedDiff || selectedDiff === 'all') return true;
  const d = String(diff || '').toLowerCase().trim();
  const marks = Number(rawMarks) || 1;

  if (selectedDiff === 'Easy' || selectedDiff === 'ಸುಲಭ') {
    if (d.includes('ಸುಲಭ') || d.includes('easy') || d.includes('सरल') || d === '1' || d === '೧') return true;
    if (!d || d === 'ಸಾಮಾನ್ಯ' || d === '-') return marks === 1;
    return false;
  }
  if (selectedDiff === 'Medium' || selectedDiff === 'ಸಾಧಾರಣ') {
    if (
      d.includes('ಸಾಧಾರಣ') ||
      d.includes('medium') ||
      d.includes('avg') ||
      d.includes('average') ||
      d.includes('सामान्य') ||
      d.includes('ಮಧ್ಯಮ') ||
      d === '2' ||
      d === '೨'
    ) return true;
    if (!d || d === 'ಸಾಮಾನ್ಯ' || d === '-') return marks === 2;
    return false;
  }
  if (selectedDiff === 'Difficult' || selectedDiff === 'ಕಠಿಣ') {
    if (
      d.includes('ಕಠಿಣ') ||
      d.includes('difficult') ||
      d.includes('hard') ||
      d.includes('diff') ||
      d.includes('कठिन') ||
      d === '3' ||
      d === '೩' ||
      d === '೪' ||
      d === '4'
    ) return true;
    if (!d || d === 'ಸಾಮಾನ್ಯ' || d === '-') return marks >= 3;
    return false;
  }
  return true;
}

export function matchesObjective(
  obj: string | undefined | null,
  selectedObj: string
): boolean {
  if (!selectedObj || selectedObj === 'all') return true;
  const o = String(obj || '').toLowerCase().trim();
  if (selectedObj === 'knowledge' || selectedObj === 'ಜ್ಞಾನ') {
    return o.includes('ಜ್ಞಾನ') || o.includes('know') || o.includes('recall') || o.includes('ನೆನಪು');
  }
  if (selectedObj === 'understanding' || selectedObj === 'ತಿಳುವಳಿಕೆ') {
    return o.includes('ತಿಳುವಳಿಕೆ') || o.includes('understand') || o.includes('comprehen') || o.includes('ವಿವರಣೆ');
  }
  if (selectedObj === 'application' || selectedObj === 'ಅನ್ವಯ') {
    return o.includes('ಅನ್ವಯ') || o.includes('apply') || o.includes('applic') || o.includes('ಲೆಕ್ಕ');
  }
  if (selectedObj === 'skill' || selectedObj === 'ಕೌಶಲ' || selectedObj === 'ಕೌಶಲ್ಯ') {
    return o.includes('ಕೌಶಲ') || o.includes('ಕೌಶಲ್ಯ') || o.includes('skill') || o.includes('ಚಿತ್ರ');
  }
  return true;
}

export const QuestionBankExplorer: React.FC<QuestionBankExplorerProps> = ({
  bank,
  availableFiles = [],
  grade = '6 ನೇ ತರಗತಿ (Class 6)',
  setGrade,
  medium = 'ಕನ್ನಡ ಮಾಧ್ಯಮ (State Syllabus)',
  setMedium,
  selectedFileId,
  onSelectFile,
  onUpdateBank,
  onOpenSavedBank,
  onDeleteSavedBank,
}) => {
  const [selectedChapterId, setSelectedChapterId] = useState<string>('all');
  const [selectedType, setSelectedType] = useState<string>('all');
  const [selectedDiff, setSelectedDiff] = useState<string>('all');
  const [selectedObj, setSelectedObj] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [imageFilter, setImageFilter] = useState<ImageFilterMode>('all');

  // Permanently saved JSON banks & PDFs
  const [savedBanks, setSavedBanks] = useState<SavedBankSummary[]>([]);
  const [isLoadingSavedBank, setIsLoadingSavedBank] = useState<boolean>(false);
  const [deletingBankId, setDeletingBankId] = useState<string | null>(null);
  const [showSavedBanksTable, setShowSavedBanksTable] = useState<boolean>(true);
  const [savedPdfs, setSavedPdfs] = useState<SavedPdfEntry[]>([]);
  const [activePdfId, setActivePdfId] = useState<string | null>(null);
  const [sharedPdfBuffer, setSharedPdfBuffer] = useState<ArrayBuffer | null>(null);
  const [sharedPdfName, setSharedPdfName] = useState<string>('');
  const [isLoadingPdf, setIsLoadingPdf] = useState<boolean>(false);

  // Image / PDF Cropper Modal state + stable snapshot queue so moving Prev/Next works even under "Pending Images" filter
  const [editingImageQuestion, setEditingImageQuestion] = useState<QuestionItem | null>(null);
  const [editingImageSlot, setEditingImageSlot] = useState<'question' | 'answer'>('question');
  const [modalNavQueue, setModalNavQueue] = useState<
    Array<{ chapterId: string; questionId: string; defaultSlot: 'question' | 'answer' }>
  >([]);
  const [modalNavIndex, setModalNavIndex] = useState<number>(0);
  const [saveNotice, setSaveNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [isPersisting, setIsPersisting] = useState<boolean>(false);

  // Filter for questions missing detailed explanation answers + possible duplicates + Question/Answer Text Editor modal state
  const [showIncompleteAnswersOnly, setShowIncompleteAnswersOnly] = useState<boolean>(false);
  const [showPossibleDuplicatesOnly, setShowPossibleDuplicatesOnly] = useState<boolean>(false);
  const [confirmDeleteQuestionKey, setConfirmDeleteQuestionKey] = useState<string | null>(null);
  const [editingTextQueue, setEditingTextQueue] = useState<
    Array<{ chapterId: string; questionId: string }>
  >([]);
  const [editingTextIndex, setEditingTextIndex] = useState<number>(-1);

  // Load saved JSON banks and saved PDFs on mount
  const refreshVaultLists = useCallback(async () => {
    const [pdfsRes, banksRes] = await Promise.allSettled([
      listSavedPdfsCombined(),
      listAllSavedQuestionBanks(),
    ]);
    if (pdfsRes.status === 'fulfilled') setSavedPdfs(pdfsRes.value);
    if (banksRes.status === 'fulfilled') setSavedBanks(banksRes.value);
  }, []);

  useEffect(() => {
    refreshVaultLists();
  }, [refreshVaultLists]);

  // Reset chapter filter if switching to a different bank that doesn't contain selectedChapterId
  useEffect(() => {
    if (
      selectedChapterId !== 'all' &&
      !bank.chapters.some(ch => ch.chapterId === selectedChapterId)
    ) {
      setSelectedChapterId('all');
    }
  }, [bank, selectedChapterId]);

  // Automatically load the linked / matching Saved PDF whenever the active bank changes
  useEffect(() => {
    if (savedPdfs.length === 0) return;
    const match = findMatchingSavedPdf(savedPdfs, bank);
    if (!match) return;
    if (match.id === activePdfId && sharedPdfBuffer) return;

    let cancelled = false;
    setIsLoadingPdf(true);
    loadPdfBufferPermanently(match.id, match.serverPdfUrl)
      .then(buf => {
        if (cancelled) return;
        if (buf) {
          setSharedPdfBuffer(buf);
          setSharedPdfName(match.fileName);
          setActivePdfId(match.id);
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoadingPdf(false);
      });

    return () => {
      cancelled = true;
    };
  }, [bank, savedPdfs, activePdfId, sharedPdfBuffer]);

  // Unit-wise & total image upload audit
  const imageAudit = useMemo(() => computeBankImageAudit(bank), [bank]);

  // Duplicate question audit across all chapters
  const duplicateAudit = useMemo(() => deduplicateQuestionBank(bank), [bank]);

  // Current canonical grade label
  const activeGradeLabel = useMemo(() => {
    return canonicalGradeLabel(extractGradeKey(grade));
  }, [grade]);

  // Clean canonical grades list
  const gradeOptions = useMemo(() => {
    const availableKeys = new Set<string>(['6', '7', '8', '9', '10']);
    availableFiles.forEach(f => {
      const k = extractGradeKey(f.gradeKey || f.grade);
      if (k) availableKeys.add(k);
    });

    const orderedKeys = Array.from(availableKeys).sort((a, b) => {
      const numA = parseInt(a, 10);
      const numB = parseInt(b, 10);
      if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
      return a.localeCompare(b);
    });

    return orderedKeys.map(k => canonicalGradeLabel(k));
  }, [availableFiles]);

  // Clean deduplicated subjects for the selected grade (preserving distinct subjects, language tiers, and mediums)
  const subjectsForGrade = useMemo(() => {
    const matching = availableFiles.filter(f => matchesGrade(f, grade));
    const list = matching.length > 0 ? matching : availableFiles;

    const seenKeys = new Set<string>();
    const unique: IndexEntry[] = [];
    for (const f of list) {
      const sCode = deduceSubjectCode(f.subjectCode, f.subject);
      const dedupKey = getSubjectDedupKey({ ...f, subjectCode: sCode });
      if (!seenKeys.has(dedupKey)) {
        seenKeys.add(dedupKey);
        unique.push({
          ...f,
          subject: normalizeSubjectName(f.subject),
          subjectCode: sCode,
        });
      }
    }
    return unique;
  }, [availableFiles, grade]);

  // Extract all unique question types
  const allQuestionTypes = useMemo(() => {
    const types = new Set<string>();
    bank.chapters.forEach(ch => {
      ch.questions.forEach(q => {
        if (q.questionType) types.add(q.questionType);
      });
    });
    return Array.from(types);
  }, [bank]);

  const isBriefOrMissingDetailedAnswer = useCallback((q: QuestionItem): boolean => {
    if (isAnswerMissingOrIncomplete(q)) return true;
    const marks = Number(q.marks || 1);
    const ansLen = String(q.answer || '').trim().length;
    // Flag 2+ mark questions with very short non-step answers so teachers can quickly expand them
    if (marks >= 2 && ansLen < 75 && !q.answerImageUrl && !q.answerDiagramSvg) return true;
    return false;
  }, []);

  const incompleteAnswerCount = useMemo(() => {
    let count = 0;
    bank.chapters.forEach(ch => {
      if (selectedChapterId !== 'all' && ch.chapterId !== selectedChapterId) return;
      ch.questions.forEach(q => {
        if (isBriefOrMissingDetailedAnswer(q)) count += 1;
      });
    });
    return count;
  }, [bank, selectedChapterId, isBriefOrMissingDetailedAnswer]);

  // Detect possible duplicate questions within each chapter (same serial number OR fuzzy duplicate text)
  const possibleDuplicateKeys = useMemo(() => {
    const dupKeys = new Set<string>();
    bank.chapters.forEach(ch => {
      const qs = ch.questions || [];
      const serialGroups = new Map<number, string[]>();
      qs.forEach(q => {
        if (typeof q.questionNumber === 'number' && q.questionNumber > 0) {
          const list = serialGroups.get(q.questionNumber) || [];
          list.push(`${ch.chapterId}::${q.id}`);
          serialGroups.set(q.questionNumber, list);
        }
      });
      serialGroups.forEach(keys => {
        if (keys.length > 1) {
          keys.forEach(k => dupKeys.add(k));
        }
      });
      for (let i = 0; i < qs.length; i++) {
        for (let j = i + 1; j < qs.length; j++) {
          if (areQuestionsDuplicates(qs[i], qs[j])) {
            dupKeys.add(`${ch.chapterId}::${qs[i].id}`);
            dupKeys.add(`${ch.chapterId}::${qs[j].id}`);
          }
        }
      }
    });
    return dupKeys;
  }, [bank]);

  const possibleDuplicateCount = useMemo(() => {
    let count = 0;
    bank.chapters.forEach(ch => {
      if (selectedChapterId !== 'all' && ch.chapterId !== selectedChapterId) return;
      ch.questions.forEach(q => {
        if (possibleDuplicateKeys.has(`${ch.chapterId}::${q.id}`)) count += 1;
      });
    });
    return count;
  }, [bank, selectedChapterId, possibleDuplicateKeys]);

  // Extract all filtered questions
  const filteredQuestions = useMemo(() => {
    const list: QuestionItem[] = [];

    bank.chapters.forEach(ch => {
      if (selectedChapterId !== 'all' && ch.chapterId !== selectedChapterId) {
        return;
      }
      ch.questions.forEach(q => {
        if (selectedType !== 'all' && q.questionType !== selectedType) return;
        if (!matchesDifficulty(q.difficulty, selectedDiff, q.marks)) return;
        if (!matchesObjective(q.objective || (q as any).objectiveName, selectedObj)) return;
        if (!matchesImageFilter(q, imageFilter)) return;
        if (showIncompleteAnswersOnly && !isBriefOrMissingDetailedAnswer(q)) return;
        if (showPossibleDuplicatesOnly && !possibleDuplicateKeys.has(`${ch.chapterId}::${q.id}`)) {
          return;
        }

        if (searchQuery.trim()) {
          const qText = (q.question || '').toLowerCase();
          const aText = (q.answer || '').toLowerCase();
          const s = searchQuery.toLowerCase().trim();
          if (!qText.includes(s) && !aText.includes(s)) return;
        }

        list.push(q);
      });
    });

    return list;
  }, [
    bank,
    selectedChapterId,
    selectedType,
    selectedDiff,
    selectedObj,
    searchQuery,
    imageFilter,
    showIncompleteAnswersOnly,
    showPossibleDuplicatesOnly,
    possibleDuplicateKeys,
    isBriefOrMissingDetailedAnswer,
  ]);

  // Persist helper wrapper
  const persistBankUpdate = async (updatedBank: QuestionBank, successText: string) => {
    if (!onUpdateBank) return;
    setIsPersisting(true);
    setSaveNotice(null);
    try {
      await onUpdateBank(updatedBank);
      setSaveNotice({ type: 'success', text: successText });
      setTimeout(() => setSaveNotice(null), 5000);
      refreshVaultLists();
    } catch (err: any) {
      setSaveNotice({
        type: 'error',
        text: `ಸ್ಥಳೀಯವಾಗಿ ನವೀಕರಿಸಲಾಗಿದೆ, ಆದರೆ ಕ್ಲೌಡ್ ಉಳಿಸುವಿಕೆಯಲ್ಲಿ ದೋಷ: ${err?.message || 'ದೋಷ'}`,
      });
    } finally {
      setIsPersisting(false);
    }
  };

  // Select a permanently saved PDF from the PDF Vault
  const handleSelectSavedPdf = async (pdf: SavedPdfEntry) => {
    setIsLoadingPdf(true);
    setSaveNotice(null);
    try {
      const buf = await loadPdfBufferPermanently(pdf.id, pdf.serverPdfUrl);
      if (!buf) {
        setSaveNotice({
          type: 'error',
          text: `"${pdf.fileName}" ಫೈಲ್ ಲಭ್ಯವಾಗಿಲ್ಲ. ದಯವಿಟ್ಟು PDF ಒಮ್ಮೆ ಅಪ್‌ಲೋಡ್ ಮಾಡಿ.`,
        });
        return;
      }
      setSharedPdfBuffer(buf);
      setSharedPdfName(pdf.fileName);
      setActivePdfId(pdf.id);

      // Link this PDF ID into the bank metadata so next time it opens automatically
      if (bank.metadata.sourcePdfId !== pdf.id && onUpdateBank) {
        const linkedBank: QuestionBank = {
          ...bank,
          metadata: {
            ...bank.metadata,
            sourcePdfId: pdf.id,
            sourcePdfUrl: pdf.serverPdfUrl,
            source_pdf: pdf.fileName,
          },
        };
        onUpdateBank(linkedBank);
      }

      setSaveNotice({
        type: 'success',
        text: `"${pdf.fileName}" ಉಳಿಸಿದ PDF ಲೋಡ್ ಆಗಿದೆ — ಈಗ ಯಾವುದೇ ಪ್ರಶ್ನೆಗೆ ನೇರವಾಗಿ ಕ್ರಾಪ್ ಮಾಡಬಹುದು!`,
      });
      setTimeout(() => setSaveNotice(null), 4000);
    } finally {
      setIsLoadingPdf(false);
    }
  };

  // Upload a new PDF once and save it permanently to the PDF Vault
  const handleUploadPermanentPdf = async (file: File) => {
    setIsLoadingPdf(true);
    setSaveNotice(null);
    try {
      const buf = await file.arrayBuffer();
      let numPages = 0;
      try {
        const { PDFDocument } = await import('pdf-lib');
        const doc = await PDFDocument.load(buf.slice(0), { ignoreEncryption: true });
        numPages = doc.getPageCount();
      } catch {
        numPages = 0;
      }

      const saved = await savePdfPermanently({
        buffer: buf,
        fileName: file.name,
        totalPages: numPages,
        grade: bank.metadata.grade,
        gradeKey: extractGradeKey(bank.metadata.gradeKey || bank.metadata.grade),
        subject: bank.metadata.subject,
        subjectCode: deduceSubjectCode(
          bank.metadata.subjectCode ? String(bank.metadata.subjectCode) : undefined,
          bank.metadata.subject
        ),
        linkedBankId: typeof bank.metadata.id === 'string' ? bank.metadata.id : undefined,
      });

      setSharedPdfBuffer(buf);
      setSharedPdfName(file.name);
      setActivePdfId(saved.id);
      await refreshVaultLists();

      if (onUpdateBank) {
        await onUpdateBank({
          ...bank,
          metadata: {
            ...bank.metadata,
            sourcePdfId: saved.id,
            sourcePdfUrl: saved.serverPdfUrl,
            source_pdf: saved.fileName,
          },
        });
      }

      setSaveNotice({
        type: 'success',
        text: `"${file.name}" PDF ಶಾಶ್ವತವಾಗಿ ಉಳಿಸಲಾಗಿದೆ (${numPages || '?'} ಪುಟಗಳು). ಮತ್ತೆ ಅಪ್‌ಲೋಡ್ ಮಾಡುವ ಅಗತ್ಯವಿಲ್ಲ!`,
      });
      setTimeout(() => setSaveNotice(null), 5000);
    } catch (err: any) {
      setSaveNotice({
        type: 'error',
        text: `PDF ಉಳಿಸುವಲ್ಲಿ ದೋಷ: ${err?.message || 'ದೋಷ'}`,
      });
    } finally {
      setIsLoadingPdf(false);
    }
  };

  // Re-open any permanently saved JSON Question Bank (Firebase or Server Disk)
  const handleReopenSavedJsonBank = async (bankId: string) => {
    const summary = savedBanks.find(b => b.id === bankId);
    if (!summary) return;
    setIsLoadingSavedBank(true);
    setSaveNotice(null);
    try {
      const rawLoaded = await loadSavedQuestionBank(summary);
      const dedupRes = deduplicateQuestionBank(rawLoaded);
      const loaded = dedupRes.cleanedBank;
      const entry: IndexEntry = {
        id: summary.id,
        path: summary.path,
        grade: summary.grade,
        gradeKey: summary.gradeKey,
        subject: summary.subject,
        subjectCode: summary.subjectCode,
        medium: summary.medium,
        totalChapters: loaded.chapters.length,
        totalQuestions: loaded.chapters.reduce((s, c) => s + (c.questions?.length || 0), 0),
        isUserGenerated: true,
        createdAt: summary.updatedAt,
      };
      if (onOpenSavedBank) {
        onOpenSavedBank(loaded, entry);
      }
      setSelectedChapterId('all');
      const nextAudit = computeBankImageAudit(loaded);
      setImageFilter(nextAudit.totalPending > 0 ? 'pending' : 'all');

      if (dedupRes.removedDuplicates > 0 && onUpdateBank) {
        await persistBankUpdate(
          {
            ...loaded,
            metadata: {
              ...loaded.metadata,
              id: loaded.metadata.id || summary.id,
              updatedAt: new Date().toISOString(),
            },
          },
          `"${summary.title}" ತೆರೆಯಲಾಗಿದೆ · ${dedupRes.removedDuplicates} ಡುಪ್ಲಿಕೇಟ್ ಪ್ರಶ್ನೆಗಳನ್ನು ಸ್ವಯಂಚಾಲಿತವಾಗಿ ತೆಗೆದುಹಾಕಿ ಉಳಿಸಲಾಗಿದೆ (ಎಲ್ಲಾ ಚಿತ್ರಗಳು ಸುರಕ್ಷಿತವಾಗಿವೆ)!`
        );
      } else {
        setSaveNotice({
          type: 'success',
          text: `"${summary.title}" ತೆರೆಯಲಾಗಿದೆ (${nextAudit.totalPending} ಚಿತ್ರ ಅಪ್ಲೋಡ್ ಬಾಕಿ, ${nextAudit.totalUploaded} ಪೂರ್ಣಗೊಂಡಿವೆ).`,
        });
        setTimeout(() => setSaveNotice(null), 5000);
      }
    } catch (err: any) {
      setSaveNotice({
        type: 'error',
        text: `ಉಳಿಸಿದ JSON ಫೈಲ್ ತೆರೆಯಲು ಸಾಧ್ಯವಾಗಿಲ್ಲ: ${err?.message || 'ದೋಷ'}`,
      });
    } finally {
      setIsLoadingSavedBank(false);
    }
  };

  // Permanently delete a saved or duplicate JSON Question Bank (Firebase + Server Disk)
  const handleDeleteSavedJsonBank = async (summary: SavedBankSummary) => {
    setDeletingBankId(summary.id);
    try {
      await deleteSavedQuestionBankPermanently(summary);
      setSavedBanks(prev => prev.filter(b => !(b.id === summary.id && b.source === summary.source)));
      if (onDeleteSavedBank) {
        onDeleteSavedBank(summary.id);
      }
      setSaveNotice({
        type: 'success',
        text: `"${summary.grade} · ${summary.subject}" JSON ಫೈಲ್ ಶಾಶ್ವತವಾಗಿ ಅಳಿಸಲಾಗಿದೆ (Deleted).`,
      });
      setTimeout(() => setSaveNotice(null), 5000);
      await refreshVaultLists();
    } catch (err: any) {
      setSaveNotice({
        type: 'error',
        text: `JSON ಫೈಲ್ ಅಳಿಸುವಲ್ಲಿ ದೋಷ: ${err?.message || 'ದೋಷ'}`,
      });
    } finally {
      setDeletingBankId(null);
    }
  };

  // Open an external .json file (even a single-unit JSON!) directly inside Explorer:
  // ALWAYS smart-merges into the previous all-units bank for the same Class + Subject + Medium
  // preserving every other unit AND all previously uploaded images, then persists permanently!
  const handleOpenLocalJsonFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const parsed = JSON.parse(String(reader.result || '{}'));
        const parsedRes = parseUploadedJsonToQuestionBank(parsed, file.name, bank.metadata);
        let finalBank = parsedRes.bank;
        const gKey = parsedRes.gradeKey;
        const sCode = parsedRes.subjectCode;
        const cleanSubject = parsedRes.subject;

        // Look up the previous ALL-UNITS bank for this Class + Subject + Medium (Firebase + Server Disk + currently open bank)
        let existingFullBank: QuestionBank | null = null;
        let existingBankId: string | undefined = undefined;
        try {
          const allSaved = await listAllSavedQuestionBanks();
          const bestSaved = pickBestMatchingBankCandidate(allSaved, finalBank);
          if (bestSaved) {
            const loaded = await loadSavedQuestionBank(bestSaved);
            if (loaded && loaded.chapters?.length > 0) {
              existingFullBank = loaded;
              existingBankId = loaded.metadata.id || bestSaved.id;
            }
          }
        } catch {
          // continue checking active bank
        }

        if (bank && bank.chapters.length > 0) {
          const activeMatches =
            !parsedRes.hasExplicitGradeOrSubject ||
            Boolean(
              pickBestMatchingBankCandidate(
                [
                  {
                    id: bank.metadata.id,
                    grade: bank.metadata.grade,
                    gradeKey: bank.metadata.gradeKey,
                    subject: bank.metadata.subject,
                    subjectCode: bank.metadata.subjectCode,
                    medium: bank.metadata.medium,
                    totalChapters: bank.chapters.length,
                    totalQuestions: bank.chapters.reduce((s, c) => s + (c.questions?.length || 0), 0),
                  },
                ],
                finalBank
              )
            );
          if (
            activeMatches &&
            (!existingFullBank || bank.chapters.length > existingFullBank.chapters.length)
          ) {
            existingFullBank = bank;
            existingBankId = bank.metadata.id || existingBankId;
          }
        }

        let mergeSummaryText = '';
        if (existingFullBank && existingFullBank.chapters.length > 0) {
          const { mergedBank, stats } = smartMergeQuestionBanks(existingFullBank, finalBank);
          finalBank = ensureUniqueQuestionIds({
            ...mergedBank,
            metadata: {
              ...mergedBank.metadata,
              id: existingFullBank.metadata.id || existingBankId || `imported_${Date.now()}`,
              gradeKey: gKey,
              grade: canonicalGradeLabel(gKey),
              subjectCode: sCode,
              subject: cleanSubject,
            },
          });
          mergeSummaryText = formatMergeSummaryKannada(stats);
        } else {
          const bankId =
            typeof finalBank.metadata.id === 'string' && finalBank.metadata.id.trim()
              ? finalBank.metadata.id.trim().replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120)
              : `imported_${Date.now()}`;
          finalBank = ensureUniqueQuestionIds({
            ...finalBank,
            metadata: {
              ...finalBank.metadata,
              id: bankId,
              gradeKey: gKey,
              grade: canonicalGradeLabel(gKey),
              subjectCode: sCode,
              subject: cleanSubject,
            },
          });
        }

        const resolvedId = String(finalBank.metadata.id || `imported_${Date.now()}`);
        const entry: IndexEntry = {
          id: resolvedId,
          path: `firebase://${resolvedId}`,
          grade: canonicalGradeLabel(gKey),
          gradeKey: gKey,
          subject: cleanSubject,
          subjectCode: sCode,
          medium: finalBank.metadata.medium || 'ಕನ್ನಡ ಮಾಧ್ಯಮ (State Syllabus)',
          totalChapters: finalBank.chapters.length,
          totalQuestions: finalBank.chapters.reduce((s, c) => s + (c.questions?.length || 0), 0),
          isUserGenerated: true,
        };
        if (onOpenSavedBank) {
          onOpenSavedBank(finalBank, entry);
        }
        setSelectedChapterId('all');
        const nextAudit = computeBankImageAudit(finalBank);
        setImageFilter(nextAudit.totalPending > 0 ? 'pending' : 'all');

        const noticeText = mergeSummaryText
          ? `"${file.name}" (${canonicalGradeLabel(gKey)} · ${cleanSubject}) — ${mergeSummaryText}`
          : `"${file.name}" (${canonicalGradeLabel(gKey)} · ${cleanSubject}) ಶಾಶ್ವತವಾಗಿ ಉಳಿಸಲಾಗಿದೆ! ಈಗ ಎಲ್ಲಾ ಡ್ರಾಪ್‌ಡೌನ್‌ಗಳಲ್ಲಿ ಕಾಣಿಸುತ್ತದೆ.`;

        // Automatically persist permanently to Server Disk + Firebase so it immediately shows in all dropdowns!
        if (onUpdateBank) {
          await persistBankUpdate(finalBank, noticeText);
        } else {
          setSaveNotice({
            type: 'success',
            text: noticeText,
          });
          setTimeout(() => setSaveNotice(null), 6000);
        }
      } catch (err: any) {
        setSaveNotice({ type: 'error', text: `JSON ಓದುವ ದೋಷ: ${err?.message || 'ದೋಷ'}` });
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  // Resolve the latest live QuestionItem from `bank` for the active modal entry
  const activeModalQuestion = useMemo(() => {
    if (!editingImageQuestion) return null;
    const activeEntry = modalNavQueue[modalNavIndex];
    const targetChId = activeEntry?.chapterId ?? editingImageQuestion.chapterId;
    const targetQId = activeEntry?.questionId ?? editingImageQuestion.id;
    const ch = bank.chapters.find(c => c.chapterId === targetChId);
    const liveQ = ch?.questions.find(q => q.id === targetQId);
    return liveQ || editingImageQuestion;
  }, [bank, editingImageQuestion, modalNavIndex, modalNavQueue]);

  // Open the Image/Crop modal and snapshot the current visible list so Prev/Next works smoothly
  const openImageModalForQuestion = (
    q: QuestionItem,
    explicitSlot?: 'question' | 'answer'
  ) => {
    const queueList = filteredQuestions.some(item => item.id === q.id && item.chapterId === q.chapterId)
      ? filteredQuestions
      : bank.chapters.find(c => c.chapterId === q.chapterId)?.questions || [q];

    const snapshot = queueList.map(item => {
      const req = detectImageRequirement(item);
      const slot: 'question' | 'answer' = req.suggestedSlot === 'answer' ? 'answer' : 'question';
      return {
        chapterId: item.chapterId,
        questionId: item.id,
        defaultSlot: slot,
      };
    });

    const startIdx = Math.max(
      0,
      snapshot.findIndex(item => item.questionId === q.id && item.chapterId === q.chapterId)
    );
    const slotToUse = explicitSlot || snapshot[startIdx]?.defaultSlot || 'question';

    setModalNavQueue(snapshot);
    setModalNavIndex(startIdx);
    setEditingImageSlot(slotToUse);
    setEditingImageQuestion(q);
  };

  // Navigate to Previous / Next question directly inside the open Image/Crop modal
  const handleNavigateModalQuestion = (delta: -1 | 1) => {
    const nextIdx = modalNavIndex + delta;
    if (nextIdx < 0 || nextIdx >= modalNavQueue.length) return;
    const nextEntry = modalNavQueue[nextIdx];
    const ch = bank.chapters.find(c => c.chapterId === nextEntry.chapterId);
    const nextQ = ch?.questions.find(q => q.id === nextEntry.questionId);
    if (!nextQ) return;
    setModalNavIndex(nextIdx);
    setEditingImageSlot(nextEntry.defaultSlot);
    setEditingImageQuestion(nextQ);
  };

  // Save updated question images back to bank, server disk & Firebase
  const handleSaveQuestionImage = async (update: QuestionImageUpdate) => {
    const currentQ = activeModalQuestion || editingImageQuestion;
    if (!currentQ) return;
    const targetId = currentQ.id;
    const targetChId = currentQ.chapterId;

    const updatedChapters = bank.chapters.map(ch => {
      if (ch.chapterId !== targetChId) return ch;
      return {
        ...ch,
        questions: ch.questions.map(q => {
          if (q.id !== targetId) return q;
          return {
            ...q,
            imageUrl: update.imageUrl,
            diagramSvg: update.diagramSvg,
            answerImageUrl: update.answerImageUrl,
            answerDiagramSvg: update.answerDiagramSvg,
            hasDiagram: update.hasDiagram,
            needsImage: update.hasDiagram ? true : q.needsImage,
            diagramDescription: update.diagramDescription,
            answerDiagramDescription: update.answerDiagramDescription,
            objective: update.hasDiagram && !q.objective ? 'ಕೌಶಲ' : q.objective,
          };
        }),
      };
    });

    const updatedBank: QuestionBank = {
      ...bank,
      metadata: {
        ...bank.metadata,
        sourcePdfId: activePdfId || bank.metadata.sourcePdfId,
        source_pdf: sharedPdfName || bank.metadata.source_pdf,
        updatedAt: new Date().toISOString(),
      },
      chapters: updatedChapters,
    };

    await persistBankUpdate(
      updatedBank,
      'ಚಿತ್ರವನ್ನು Firebase ನಲ್ಲಿ ಉಳಿಸಿ, URL ಅನ್ನು ಪ್ರಶ್ನೆ ಬ್ಯಾಂಕ್‌ಗೆ ಜೋಡಿಸಲಾಗಿದೆ!'
    );
  };

  // Resolve currently open question for the Question & Detailed Answer Edit Modal
  const activeEditingTextQuestion = useMemo(() => {
    if (editingTextIndex < 0 || editingTextIndex >= editingTextQueue.length) return null;
    const target = editingTextQueue[editingTextIndex];
    const ch = bank.chapters.find(c => c.chapterId === target.chapterId);
    return ch?.questions.find(q => q.id === target.questionId) || null;
  }, [bank, editingTextQueue, editingTextIndex]);

  const openTextEditModalForQuestion = (q: QuestionItem) => {
    const queueList = filteredQuestions.some(item => item.id === q.id && item.chapterId === q.chapterId)
      ? filteredQuestions
      : bank.chapters.find(c => c.chapterId === q.chapterId)?.questions || [q];
    const snapshot = queueList.map(item => ({ chapterId: item.chapterId, questionId: item.id }));
    const idx = Math.max(
      0,
      snapshot.findIndex(item => item.questionId === q.id && item.chapterId === q.chapterId)
    );
    setEditingTextQueue(snapshot);
    setEditingTextIndex(idx);
  };

  const handleSaveEditedQuestionText = async (update: QuestionTextUpdate) => {
    const currentQ = activeEditingTextQuestion;
    if (!currentQ) return;
    const targetId = currentQ.id;
    const targetChId = currentQ.chapterId;

    const updatedChapters = bank.chapters.map(ch => {
      if (ch.chapterId !== targetChId) return ch;
      return {
        ...ch,
        questions: ch.questions.map(q => {
          if (q.id !== targetId) return q;
          return {
            ...q,
            question: update.question,
            answer: update.answer,
            marks: update.marks,
            difficulty: update.difficulty,
            questionNumber: update.questionNumber,
            printedSerial: update.printedSerial,
            options: update.options,
            ...(update.answerPage ? { answerPage: update.answerPage } : {}),
          };
        }),
      };
    });

    const updatedBank: QuestionBank = {
      ...bank,
      metadata: {
        ...bank.metadata,
        updatedAt: new Date().toISOString(),
      },
      chapters: updatedChapters,
    };

    await persistBankUpdate(
      updatedBank,
      'ಪ್ರಶ್ನೆ ಮತ್ತು ವಿವರವಾದ ಉತ್ತರವನ್ನು JSON & Firebase ಕ್ಲೌಡ್‌ನಲ್ಲಿ ಶಾಶ್ವತವಾಗಿ ಉಳಿಸಲಾಗಿದೆ!'
    );
  };

  // Permanently delete a single (duplicate/unwanted) question and clean up any attached images
  const handleDeleteQuestion = async (qItem: QuestionItem) => {
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

    const updatedChapters = bank.chapters.map(ch => {
      if (ch.chapterId !== qItem.chapterId) return ch;
      const remaining = ch.questions.filter(q => q.id !== qItem.id);
      return {
        ...ch,
        questions: remaining,
        questionCount: remaining.length,
      };
    });

    const updatedBank: QuestionBank = {
      ...bank,
      metadata: {
        ...bank.metadata,
        updatedAt: new Date().toISOString(),
      },
      chapters: updatedChapters,
    };

    setConfirmDeleteQuestionKey(null);

    // Keep text-edit modal queue synchronized smoothly if deleted from inside the editor
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

    const serialLabel = qItem.printedSerial || qItem.questionNumber;
    await persistBankUpdate(
      updatedBank,
      `ಪ್ರಶ್ನೆ ${serialLabel ? `#${serialLabel} ` : ''}ಶಾಶ್ವತವಾಗಿ ಡಿಲೀಟ್ ಮಾಡಿ JSON & Firebase ಕ್ಲೌಡ್‌ನಲ್ಲಿ ನವೀಕರಿಸಲಾಗಿದೆ!`
    );
  };

  // Toggle "No image needed" dismissal on a false-positive question
  const handleToggleNeedsImage = async (qItem: QuestionItem, needs: boolean) => {
    const updatedChapters = bank.chapters.map(ch => {
      if (ch.chapterId !== qItem.chapterId) return ch;
      return {
        ...ch,
        questions: ch.questions.map(q =>
          q.id === qItem.id ? { ...q, needsImage: needs, hasDiagram: needs ? true : false } : q
        ),
      };
    });

    const updatedBank: QuestionBank = {
      ...bank,
      metadata: {
        ...bank.metadata,
        updatedAt: new Date().toISOString(),
      },
      chapters: updatedChapters,
    };

    await persistBankUpdate(
      updatedBank,
      needs
        ? 'ಈ ಪ್ರಶ್ನೆಯನ್ನು "ಚಿತ್ರ ಅಗತ್ಯ" ಪಟ್ಟಿಗೆ ಸೇರಿಸಲಾಗಿದೆ.'
        : 'ಈ ಪ್ರಶ್ನೆಯನ್ನು "ಚಿತ್ರ ಬಾಕಿ" ಪಟ್ಟಿಯಿಂದ ತೆಗೆದುಹಾಕಲಾಗಿದೆ.'
    );
  };

  // Delete a Question or Answer image inline (cleans Firebase + server cache + updates bank)
  const handleDeleteQuestionImage = async (qItem: QuestionItem, slot: 'question' | 'answer') => {
    const urlToRemove = slot === 'question' ? qItem.imageUrl : qItem.answerImageUrl;
    const imageId = extractImageIdFromUrl(urlToRemove);
    if (imageId) {
      deleteQuestionImageFromFirebase(imageId).catch(() => {});
      fetch(`/api/question-image/${imageId}`, { method: 'DELETE' }).catch(() => {});
    }

    const updatedChapters = bank.chapters.map(ch => {
      if (ch.chapterId !== qItem.chapterId) return ch;
      return {
        ...ch,
        questions: ch.questions.map(q => {
          if (q.id !== qItem.id) return q;
          const next: QuestionItem = {
            ...q,
            imageUrl: slot === 'question' ? undefined : q.imageUrl,
            diagramSvg: slot === 'question' ? undefined : q.diagramSvg,
            answerImageUrl: slot === 'answer' ? undefined : q.answerImageUrl,
            answerDiagramSvg: slot === 'answer' ? undefined : q.answerDiagramSvg,
          };
          next.hasDiagram = Boolean(
            next.imageUrl || next.diagramSvg || next.answerImageUrl || next.answerDiagramSvg
          );
          return next;
        }),
      };
    });

    const updatedBank: QuestionBank = {
      ...bank,
      metadata: {
        ...bank.metadata,
        updatedAt: new Date().toISOString(),
      },
      chapters: updatedChapters,
    };

    await persistBankUpdate(
      updatedBank,
      `${slot === 'question' ? 'ಪ್ರಶ್ನೆ ಚಿತ್ರ' : 'ಉತ್ತರ ಚಿತ್ರ'} ಡಿಲೀಟ್ ಮಾಡಲಾಗಿದೆ (Firebase ನಿಂದಲೂ ತೆರವುಗೊಂಡಿದೆ).`
    );
  };

  // Remove duplicate questions across all chapters while preserving 100% of uploaded images
  const handleRemoveDuplicates = async () => {
    const res = deduplicateQuestionBank(bank);
    if (res.removedDuplicates === 0) {
      setSaveNotice({
        type: 'success',
        text: 'ಯಾವುದೇ ಡುಪ್ಲಿಕೇಟ್ ಪ್ರಶ್ನೆಗಳು ಕಂಡುಬಂದಿಲ್ಲ — ಎಲ್ಲಾ ಪ್ರಶ್ನೆಗಳು ಅನನ್ಯವಾಗಿವೆ (0 Duplicates)!',
      });
      setTimeout(() => setSaveNotice(null), 4500);
      return;
    }

    const cleaned: QuestionBank = {
      ...res.cleanedBank,
      metadata: {
        ...res.cleanedBank.metadata,
        sourcePdfId: activePdfId || res.cleanedBank.metadata.sourcePdfId,
        source_pdf: sharedPdfName || res.cleanedBank.metadata.source_pdf,
        updatedAt: new Date().toISOString(),
      },
    };

    const imgMsg =
      res.preservedImages > 0
        ? ` · ಅಪ್ಲೋಡ್ ಮಾಡಿದ ${res.preservedImages} ಚಿತ್ರಗಳನ್ನು ಸುರಕ್ಷಿತವಾಗಿ ಉಳಿಸಲಾಗಿದೆ`
        : ' · ಎಲ್ಲಾ ಚಿತ್ರಗಳು ಸುರಕ್ಷಿತವಾಗಿವೆ';

    await persistBankUpdate(
      cleaned,
      `${res.removedDuplicates} ಡುಪ್ಲಿಕೇಟ್ ಪ್ರಶ್ನೆಗಳನ್ನು (${res.chaptersAffected} ಅಧ್ಯಾಯಗಳಲ್ಲಿ) ತೆಗೆದುಹಾಕಿ ಶಾಶ್ವತವಾಗಿ ಉಳಿಸಲಾಗಿದೆ (${res.totalQuestionsBefore} → ${res.totalQuestionsAfter} ಪ್ರಶ್ನೆಗಳು${imgMsg})!`
    );
  };

  // Explicit Save Bank Permanently button
  const handleManualSaveBank = async () => {
    const { cleanedBank } = deduplicateQuestionBank(bank);
    await persistBankUpdate(
      {
        ...cleanedBank,
        metadata: {
          ...cleanedBank.metadata,
          sourcePdfId: activePdfId || cleanedBank.metadata.sourcePdfId,
          source_pdf: sharedPdfName || cleanedBank.metadata.source_pdf,
          updatedAt: new Date().toISOString(),
        },
      },
      'ಪ್ರಶ್ನೆ ಬ್ಯಾಂಕ್ ಮತ್ತು ಎಲ್ಲಾ ಚಿತ್ರಗಳ URL ಗಳನ್ನು Firebase & ಸರ್ವರ್‌ನಲ್ಲಿ ಶಾಶ್ವತವಾಗಿ ಉಳಿಸಲಾಗಿದೆ!'
    );
  };

  // Download current question bank JSON (including all imageUrl & answerImageUrl links)
  const handleDownloadUpdatedJson = () => {
    const jsonBlob = new Blob([JSON.stringify(bank, null, 2)], {
      type: 'application/json;charset=utf-8',
    });
    const url = URL.createObjectURL(jsonBlob);
    const link = document.createElement('a');
    const safeSub = String(bank.metadata.subject || 'Subject').replace(/\s+/g, '_');
    const safeGr = String(bank.metadata.grade || 'Class').replace(/\s+/g, '_');
    link.href = url;
    link.download = `${safeGr}_${safeSub}_Question_Bank.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Find chapter page hint for modal opening
  const activeModalChapter = useMemo(() => {
    const currentQ = activeModalQuestion || editingImageQuestion;
    if (!currentQ) return null;
    return bank.chapters.find(c => c.chapterId === currentQ.chapterId) || null;
  }, [bank, activeModalQuestion, editingImageQuestion]);

  const parseFirstPage = (rangeStr?: string): number => {
    if (!rangeStr) return 1;
    const m = String(rangeStr).match(/\d+/);
    return m ? Math.max(1, parseInt(m[0], 10)) : 1;
  };

  return (
    <div className="space-y-5 font-kannada">
      {/* 1. Header Card with Saved JSON Bank Opener & Class/Medium/Subject Switcher */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 space-y-4">
        <div className="border-b border-slate-100 pb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
              <BookOpen className="w-5 h-5 text-indigo-600" />
              <span>ಪ್ರಶ್ನೆ ಭಂಡಾರ &amp; ಚಿತ್ರ ನಿರ್ವಹಣೆ (Question Bank &amp; Image Hub)</span>
            </h2>
            <p className="text-xs text-slate-500 mt-0.5 tabular-nums">
              {bank.metadata.grade} · {bank.metadata.subject} · {bank.chapters.length} ಘಟಕಗಳು ·{' '}
              {imageAudit.totalQuestions} ಪ್ರಶ್ನೆಗಳು · {imageAudit.totalUploaded} ಚಿತ್ರ ಅಪ್ಲೋಡ್ ·{' '}
              <span className={imageAudit.totalPending > 0 ? 'font-bold text-amber-700' : 'text-emerald-700'}>
                {imageAudit.totalPending} ಚಿತ್ರ ಬಾಕಿ
              </span>
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <label className="px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-300 rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap">
              <FileJson className="w-3.5 h-3.5 text-amber-600" />
              <span>.JSON ತೆರೆಯಿರಿ</span>
              <input
                type="file"
                accept=".json,application/json"
                onChange={handleOpenLocalJsonFile}
                className="hidden"
              />
            </label>

            {onUpdateBank && (
              <button
                type="button"
                disabled={isPersisting}
                onClick={handleRemoveDuplicates}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap disabled:opacity-50 ${
                  duplicateAudit.removedDuplicates > 0
                    ? 'bg-amber-600 hover:bg-amber-700 text-white border-amber-700'
                    : 'bg-white hover:bg-slate-50 text-slate-700 border-slate-300'
                }`}
                title="ಅಪ್ಲೋಡ್ ಮಾಡಿದ ಎಲ್ಲಾ ಚಿತ್ರಗಳನ್ನು ಉಳಿಸಿಕೊಂಡು ಡುಪ್ಲಿಕೇಟ್ ಪ್ರಶ್ನೆಗಳನ್ನು ತೆಗೆದುಹಾಕಿ"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>
                  {duplicateAudit.removedDuplicates > 0
                    ? `ಡುಪ್ಲಿಕೇಟ್ ತೆಗೆದುಹಾಕಿ (${duplicateAudit.removedDuplicates})`
                    : 'ಡುಪ್ಲಿಕೇಟ್ ಪರಿಶೀಲಿಸಿ'}
                </span>
              </button>
            )}

            {onUpdateBank && (
              <button
                type="button"
                disabled={isPersisting}
                onClick={handleManualSaveBank}
                className="px-3 py-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                title="ಎಲ್ಲಾ ಚಿತ್ರಗಳ URL ಗಳೊಂದಿಗೆ ಪ್ರಶ್ನೆ ಬ್ಯಾಂಕ್ ಅನ್ನು ಶಾಶ್ವತವಾಗಿ ಸೇವ್ ಮಾಡಿ"
              >
                <Cloud className="w-3.5 h-3.5" />
                <span>{isPersisting ? 'ಉಳಿಸಲಾಗುತ್ತಿದೆ...' : 'ಶಾಶ್ವತವಾಗಿ ಸೇವ್ ಮಾಡಿ'}</span>
              </button>
            )}

            <button
              type="button"
              onClick={handleDownloadUpdatedJson}
              className="px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-300 rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
              title="ಚಿತ್ರಗಳ URL ಸಹಿತ JSON ಫೈಲ್ ಡೌನ್‌ಲೋಡ್ ಮಾಡಿ"
            >
              <Download className="w-3.5 h-3.5" />
              <span>JSON ಡೌನ್‌ಲೋಡ್</span>
            </button>
          </div>
        </div>

        {/* Permanently Saved JSON Question Banks — Classwise & Subjectwise Manager + Duplicate Delete */}
        {savedBanks.length > 0 && (
          <div className="space-y-3">
            <div className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-2 text-slate-800 font-semibold">
                <FolderOpen className="w-4 h-4 text-indigo-600 shrink-0" />
                <span>ಉಳಿಸಿದ JSON ಫೈಲ್‌ಗಳು &amp; ನಕಲು (Duplicate) ನಿರ್ವಹಣೆ ({savedBanks.length})</span>
              </div>
              <button
                type="button"
                onClick={() => setShowSavedBanksTable(prev => !prev)}
                className="px-3 py-1 bg-white hover:bg-slate-100 border border-slate-300 rounded-lg text-2xs font-semibold text-slate-700 transition-colors cursor-pointer whitespace-nowrap"
              >
                {showSavedBanksTable ? 'ಪಟ್ಟಿ ಮರೆಮಾಡಿ (Hide Table)' : 'ತರಗತಿವಾರು ಪಟ್ಟಿ ತೋರಿಸಿ (Show Table)'}
              </button>
            </div>

            {showSavedBanksTable && (
              <SavedJsonBanksTable
                banks={savedBanks}
                activeBankId={String(bank.metadata.id || selectedFileId || '')}
                isLoadingOpen={isLoadingSavedBank}
                deletingBankId={deletingBankId}
                openButtonLabel="ತೆರೆಯಿರಿ"
                onOpenBank={sb => handleReopenSavedJsonBank(sb.id)}
                onDeleteBank={handleDeleteSavedJsonBank}
              />
            )}
          </div>
        )}

        {saveNotice && (
          <div
            className={`px-3.5 py-2.5 rounded-xl border text-xs font-semibold flex items-center gap-2 ${
              saveNotice.type === 'success'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                : 'bg-rose-50 border-rose-200 text-rose-900'
            }`}
          >
            {saveNotice.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
            )}
            <span>{saveNotice.text}</span>
          </div>
        )}

        {duplicateAudit.removedDuplicates > 0 && onUpdateBank && (
          <div className="px-4 py-3 rounded-xl border border-amber-300 bg-amber-50 text-amber-950 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <p className="font-bold">
                  {duplicateAudit.removedDuplicates} ಡುಪ್ಲಿಕೇಟ್ ಪ್ರಶ್ನೆಗಳು ಪತ್ತೆಯಾಗಿವೆ ({duplicateAudit.chaptersAffected} ಅಧ್ಯಾಯಗಳಲ್ಲಿ · {duplicateAudit.totalQuestionsBefore} → {duplicateAudit.totalQuestionsAfter} ಪ್ರಶ್ನೆಗಳು)
                </p>
                <p className="text-2xs text-amber-800 mt-0.5">
                  ಅಪ್ಲೋಡ್ ಮಾಡಿದ ಎಲ್ಲಾ ಚಿತ್ರಗಳನ್ನು ಸುರಕ್ಷಿತವಾಗಿ ಉಳಿಸಿಕೊಂಡು ಡುಪ್ಲಿಕೇಟ್ ಪ್ರಶ್ನೆಗಳನ್ನು ಒಂದೇ ಕ್ಲಿಕ್‌ನಲ್ಲಿ ತೆಗೆದುಹಾಕಿ.
                </p>
              </div>
            </div>
            <button
              type="button"
              disabled={isPersisting}
              onClick={handleRemoveDuplicates}
              className="px-3.5 py-1.5 bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap disabled:opacity-50"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>{isPersisting ? 'ತೆಗೆದುಹಾಕಲಾಗುತ್ತಿದೆ...' : 'ಡುಪ್ಲಿಕೇಟ್ ತೆಗೆದುಹಾಕಿ & ಉಳಿಸಿ'}</span>
            </button>
          </div>
        )}

        {/* Top Direct Selection Toolbar: Class, Medium, Subject */}
        {setGrade && onSelectFile && (
          <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-3.5 grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
            <div>
              <label className="block text-2xs font-bold text-slate-700 mb-1 flex items-center gap-1">
                <GraduationCap className="w-3.5 h-3.5 text-indigo-600" />
                <span>ತರಗತಿ (Class)</span>
              </label>
              <div className="relative">
                <select
                  value={activeGradeLabel}
                  onChange={e => setGrade && setGrade(canonicalGradeLabel(extractGradeKey(e.target.value)))}
                  className="w-full appearance-none bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs font-bold text-slate-800 pr-7 focus:ring-1 focus:ring-indigo-600 focus:outline-hidden cursor-pointer"
                >
                  {gradeOptions.map(g => (
                    <option key={g} value={g}>
                      {g}
                    </option>
                  ))}
                </select>
                <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-2 top-2.5 pointer-events-none" />
              </div>
            </div>

            <div>
              <label className="block text-2xs font-bold text-slate-700 mb-1 flex items-center gap-1">
                <Globe className="w-3.5 h-3.5 text-emerald-600" />
                <span>ಮಾಧ್ಯಮ (Medium)</span>
              </label>
              <div className="relative">
                <select
                  value={medium}
                  onChange={e => setMedium && setMedium(e.target.value)}
                  className="w-full appearance-none bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs font-bold text-slate-800 pr-7 focus:ring-1 focus:ring-indigo-600 focus:outline-hidden cursor-pointer"
                >
                  <option value="ಕನ್ನಡ ಮಾಧ್ಯಮ (State Syllabus)">ಕನ್ನಡ ಮಾಧ್ಯಮ (Kannada Medium)</option>
                  <option value="English Medium (State Syllabus)">English Medium</option>
                </select>
                <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-2 top-2.5 pointer-events-none" />
              </div>
            </div>

            <div>
              <label className="block text-2xs font-bold text-slate-700 mb-1 flex items-center gap-1">
                <BookOpen className="w-3.5 h-3.5 text-amber-600" />
                <span>ವಿಷಯ (Subject)</span>
              </label>
              <div className="relative">
                <select
                  value={selectedFileId}
                  onChange={e => onSelectFile && onSelectFile(e.target.value)}
                  className="w-full appearance-none bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs font-bold text-slate-800 pr-7 focus:ring-1 focus:ring-indigo-600 focus:outline-hidden cursor-pointer"
                >
                  {subjectsForGrade.map(file => (
                    <option key={file.id} value={file.id}>
                      {formatDropdownSubjectLabel(file, subjectsForGrade)}
                    </option>
                  ))}
                </select>
                <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-2 top-2.5 pointer-events-none" />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 2. Centralized Unit-wise Image Upload Counter, Diagram Filter Bar & Permanent PDF Linker */}
      <DiagramAuditPanel
        audit={imageAudit}
        imageFilter={imageFilter}
        onChangeImageFilter={setImageFilter}
        selectedChapterId={selectedChapterId}
        onSelectChapterAndFilter={(chId, mode) => {
          setSelectedChapterId(chId);
          setImageFilter(mode);
        }}
        savedPdfs={savedPdfs}
        activePdfId={activePdfId}
        activePdfName={sharedPdfName}
        hasActivePdfBuffer={Boolean(sharedPdfBuffer)}
        isLoadingPdf={isLoadingPdf}
        onSelectSavedPdf={handleSelectSavedPdf}
        onUploadNewPdf={handleUploadPermanentPdf}
      />

      {/* 3. Question Filters Bar */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 text-xs">
        <div>
          <label className="block text-2xs font-bold text-slate-700 mb-1">
            ಘಟಕ / ಅಧ್ಯಾಯ (Chapter)
          </label>
          <select
            value={selectedChapterId}
            onChange={e => setSelectedChapterId(e.target.value)}
            className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-2 text-xs font-medium text-slate-800"
          >
            <option value="all">ಎಲ್ಲಾ ಘಟಕಗಳು ({bank.chapters.length})</option>
            {imageAudit.chapters.map(ch => (
              <option key={ch.chapterId} value={ch.chapterId}>
                {ch.chapterNumber}. {ch.chapterName} ({ch.totalQuestions} ಪ್ರಶ್ನೆ{ch.pendingCount > 0 ? ` · ${ch.pendingCount} ಚಿತ್ರ ಬಾಕಿ` : ''})
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-2xs font-bold text-slate-700 mb-1">
            ಪ್ರಶ್ನೆ ವಿಧ (Type)
          </label>
          <select
            value={selectedType}
            onChange={e => setSelectedType(e.target.value)}
            className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-2 text-xs font-medium text-slate-800"
          >
            <option value="all">ಎಲ್ಲಾ ವಿಧಗಳು ({allQuestionTypes.length})</option>
            {allQuestionTypes.map(type => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-2xs font-bold text-slate-700 mb-1">
            ಕ್ಲಿಷ್ಟತೆ (Difficulty)
          </label>
          <select
            value={selectedDiff}
            onChange={e => setSelectedDiff(e.target.value)}
            className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-2 text-xs font-medium text-slate-800"
          >
            <option value="all">ಎಲ್ಲಾ ಹಂತಗಳು (All)</option>
            <option value="Easy">ಸುಲಭ (Easy)</option>
            <option value="Medium">ಸಾಧಾರಣ / ಮಧ್ಯಮ (Medium)</option>
            <option value="Difficult">ಕಠಿಣ (Difficult)</option>
          </select>
        </div>

        <div>
          <label className="block text-2xs font-bold text-slate-700 mb-1">
            ಉದ್ದಿಷ್ಟ (Objective)
          </label>
          <select
            value={selectedObj}
            onChange={e => setSelectedObj(e.target.value)}
            className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-2 text-xs font-medium text-slate-800"
          >
            <option value="all">ಎಲ್ಲಾ ಉದ್ದಿಷ್ಟಗಳು (All)</option>
            <option value="knowledge">ಜ್ಞಾನ (Knowledge)</option>
            <option value="understanding">ತಿಳುವಳಿಕೆ (Understanding)</option>
            <option value="application">ಅನ್ವಯ (Application)</option>
            <option value="skill">ಕೌಶಲ (Skill)</option>
          </select>
        </div>

        <div>
          <label className="block text-2xs font-bold text-slate-700 mb-1">
            ಪ್ರಶ್ನೆ ಹುಡುಕಿ (Search)
          </label>
          <div className="relative">
            <input
              type="text"
              placeholder="ಪ್ರಶ್ನೆ ಅಥವಾ ಉತ್ತರ..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full bg-white border border-slate-200 rounded-lg pl-8 pr-2.5 py-2 text-xs text-slate-800 placeholder-slate-400"
            />
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5 pointer-events-none" />
          </div>
        </div>
      </div>

      {/* Results Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-xs text-slate-600 tabular-nums">
        <div className="flex flex-wrap items-center gap-2.5">
          <span>
            ತೋರಿಸಲಾಗುತ್ತಿರುವ ಪ್ರಶ್ನೆಗಳು: <strong className="text-slate-900">{filteredQuestions.length}</strong>
            {imageFilter === 'pending' && ' (ಚಿತ್ರ ಅಪ್ಲೋಡ್ ಬಾಕಿ ಇರುವ ಪ್ರಶ್ನೆಗಳು)'}
            {imageFilter === 'uploaded' && ' (ಚಿತ್ರ ಅಪ್ಲೋಡ್ ಆಗಿರುವ ಪ್ರಶ್ನೆಗಳು)'}
            {imageFilter === 'all_diagram' && ' (ಎಲ್ಲಾ ಚಿತ್ರ ಆಧಾರಿತ ಪ್ರಶ್ನೆಗಳು)'}
            {showIncompleteAnswersOnly && ' (ಸಂಕ್ಷಿಪ್ತ / ಅಪೂರ್ಣ ಉತ್ತರಗಳು)'}
            {showPossibleDuplicatesOnly && ' (ಸಂಭಾವ್ಯ ಡುಪ್ಲಿಕೇಟ್ ಪ್ರಶ್ನೆಗಳು)'}
          </span>

          <button
            type="button"
            onClick={() => setShowIncompleteAnswersOnly(prev => !prev)}
            className={`px-2.5 py-1 rounded-lg border text-2xs font-bold transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
              showIncompleteAnswersOnly
                ? 'bg-emerald-600 text-white border-emerald-700'
                : incompleteAnswerCount > 0
                ? 'bg-amber-50 hover:bg-amber-100 text-amber-900 border-amber-300'
                : 'bg-white hover:bg-slate-50 text-slate-600 border-slate-300'
            }`}
            title="ವಿವರವಾದ ಉತ್ತರ ಇಲ್ಲದ ಅಥವಾ ಸಂಕ್ಷಿಪ್ತ ಉತ್ತರ ಇರುವ ಪ್ರಶ್ನೆಗಳನ್ನು ಮಾತ್ರ ತೋರಿಸಿ"
          >
            <Edit3 className="w-3 h-3" />
            <span>
              ಸಂಕ್ಷಿಪ್ತ / ಬಾಕಿ ಉತ್ತರಗಳು ({incompleteAnswerCount})
            </span>
          </button>

          {possibleDuplicateCount > 0 && (
            <button
              type="button"
              onClick={() => setShowPossibleDuplicatesOnly(prev => !prev)}
              className={`px-2.5 py-1 rounded-lg border text-2xs font-bold transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
                showPossibleDuplicatesOnly
                  ? 'bg-rose-600 text-white border-rose-700'
                  : 'bg-rose-50 hover:bg-rose-100 text-rose-800 border-rose-300'
              }`}
              title="ಒಂದೇ ಕ್ರಮ ಸಂಖ್ಯೆ ಅಥವಾ ಹೋಲುವ ಪ್ರಶ್ನೆಗಳನ್ನು ಪರಿಶೀಲಿಸಿ ಡುಪ್ಲಿಕೇಟ್ ಡಿಲೀಟ್ ಮಾಡಿ"
            >
              <AlertTriangle className="w-3 h-3" />
              <span>
                ಸಂಭಾವ್ಯ ಡುಪ್ಲಿಕೇಟ್ ({possibleDuplicateCount})
              </span>
            </button>
          )}
        </div>

        {(selectedChapterId !== 'all' ||
          imageFilter !== 'all' ||
          searchQuery.trim() !== '' ||
          showIncompleteAnswersOnly ||
          showPossibleDuplicatesOnly) && (
          <button
            type="button"
            onClick={() => {
              setSelectedChapterId('all');
              setSelectedType('all');
              setSelectedDiff('all');
              setSelectedObj('all');
              setSearchQuery('');
              setImageFilter('all');
              setShowIncompleteAnswersOnly(false);
              setShowPossibleDuplicatesOnly(false);
            }}
            className="text-indigo-700 hover:underline font-semibold cursor-pointer"
          >
            ಎಲ್ಲಾ ಫಿಲ್ಟರ್ ತೆರವುಗೊಳಿಸಿ
          </button>
        )}
      </div>

      {/* 4. Questions Listing */}
      <div className="space-y-3">
        {filteredQuestions.length === 0 ? (
          <div className="bg-white rounded-2xl border border-dashed border-slate-300 p-10 text-center text-slate-500 space-y-2">
            <HelpCircle className="w-8 h-8 text-slate-400 mx-auto" />
            <p className="font-bold text-sm text-slate-800">
              {imageFilter === 'pending'
                ? 'ಈ ಆಯ್ಕೆಯಲ್ಲಿ ಚಿತ್ರ ಅಪ್ಲೋಡ್ ಬಾಕಿ ಇರುವ ಪ್ರಶ್ನೆಗಳು ಇಲ್ಲ!'
                : 'ಯಾವುದೇ ಪ್ರಶ್ನೆಗಳು ಕಂಡುಬಂದಿಲ್ಲ'}
            </p>
            <p className="text-xs">
              {imageFilter === 'pending'
                ? 'ಎಲ್ಲಾ ಗುರುತಿಸಿದ ಚಿತ್ರ ಪ್ರಶ್ನೆಗಳಿಗೆ ಚಿತ್ರ ಅಪ್ಲೋಡ್ ಪೂರ್ಣಗೊಂಡಿದೆ ಅಥವಾ ಬೇರೆ ಘಟಕವನ್ನು ಆಯ್ಕೆಮಾಡಿ.'
                : 'ದಯವಿಟ್ಟು ಫಿಲ್ಟರ್‌ಗಳನ್ನು ಬದಲಾಯಿಸಿ ಅಥವಾ ಹುಡುಕಾಟವನ್ನು ತೆರವುಗೊಳಿಸಿ.'}
            </p>
            <button
              type="button"
              onClick={() => {
                setSelectedChapterId('all');
                setSelectedType('all');
                setSelectedDiff('all');
                setSelectedObj('all');
                setSearchQuery('');
                setImageFilter('all');
              }}
              className="mt-2 px-3.5 py-1.5 text-xs font-bold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 rounded-lg transition-colors cursor-pointer"
            >
              ಎಲ್ಲಾ ಪ್ರಶ್ನೆಗಳನ್ನು ತೋರಿಸಿ
            </button>
          </div>
        ) : (
          filteredQuestions.map((q, idx) => {
            const imgReq = detectImageRequirement(q);
            const defaultSlot: 'question' | 'answer' =
              imgReq.suggestedSlot === 'answer' ? 'answer' : 'question';
            const qKey = `${q.chapterId}::${q.id}`;
            const isPossibleDup = possibleDuplicateKeys.has(qKey);
            const isConfirmingDelete = confirmDeleteQuestionKey === qKey;

            return (
              <div
                key={`${q.chapterId || 'ch'}_${q.id || 'q'}_${idx}`}
                className={`bg-white rounded-2xl border p-4 space-y-2.5 transition-colors ${
                  isPossibleDup
                    ? 'border-rose-300 hover:border-rose-400'
                    : imgReq.isPending
                    ? 'border-amber-300 hover:border-amber-400'
                    : 'border-slate-200 hover:border-indigo-300'
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-100 text-xs">
                  <div className="flex flex-wrap items-center gap-2 text-slate-600">
                    <span
                      className="font-extrabold text-slate-900 tabular-nums"
                      title="PDF ಕ್ರಮ ಸಂಖ್ಯೆ (PDF Question Number)"
                    >
                      #{q.printedSerial || q.questionNumber || idx + 1}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="font-semibold text-indigo-700">{q.chapterName}</span>
                    {isPossibleDup && (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-rose-100 text-rose-800 border border-rose-300 text-3xs font-extrabold">
                        <AlertTriangle className="w-3 h-3" />
                        <span>ಸಂಭಾವ್ಯ ಡುಪ್ಲಿಕೇಟ್</span>
                      </span>
                    )}
                    {q.objective && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="text-emerald-800 font-medium">{q.objective}</span>
                      </>
                    )}
                    {q.difficulty && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="text-slate-700 font-medium">{q.difficulty}</span>
                      </>
                    )}
                    <span aria-hidden="true">·</span>
                    <span className="text-slate-500">{q.questionType}</span>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    {imgReq.isPending && (
                      <button
                        type="button"
                        onClick={() => handleToggleNeedsImage(q, false)}
                        className="px-2 py-1 rounded-lg text-2xs font-medium text-slate-500 hover:text-slate-800 hover:bg-slate-100 border border-slate-200 flex items-center gap-1 cursor-pointer whitespace-nowrap"
                        title="ಈ ಪ್ರಶ್ನೆಗೆ ಚಿತ್ರ ಅಗತ್ಯವಿಲ್ಲದಿದ್ದರೆ ಬಾಕಿ ಪಟ್ಟಿಯಿಂದ ತೆಗೆಯಿರಿ"
                      >
                        <EyeOff className="w-3 h-3" />
                        <span>ಚಿತ್ರ ಬೇಡ</span>
                      </button>
                    )}

                    {onUpdateBank && (
                      <button
                        type="button"
                        onClick={() => openTextEditModalForQuestion(q)}
                        className="px-2.5 py-1 rounded-lg text-2xs font-semibold border border-emerald-300 bg-emerald-50 hover:bg-emerald-100 text-emerald-900 transition-colors flex items-center gap-1 cursor-pointer whitespace-nowrap"
                        title="ಪ್ರಶ್ನೆ ಅಥವಾ ವಿವರವಾದ ಉತ್ತರವನ್ನು ತಿದ್ದುಪಡಿ ಮಾಡಿ JSON ಗೆ ಉಳಿಸಿ"
                      >
                        <Edit3 className="w-3 h-3" />
                        <span>ತಿದ್ದುಪಡಿ (Edit)</span>
                      </button>
                    )}

                    {onUpdateBank && (
                      isConfirmingDelete ? (
                        <div className="inline-flex items-center gap-1 bg-rose-50 border border-rose-300 rounded-lg px-2 py-0.5">
                          <button
                            type="button"
                            disabled={isPersisting}
                            onClick={() => handleDeleteQuestion(q)}
                            className="px-2 py-0.5 rounded bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white text-3xs font-bold cursor-pointer whitespace-nowrap"
                          >
                            ಖಚಿತವಾಗಿ ಡಿಲೀಟ್
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteQuestionKey(null)}
                            className="px-1.5 py-0.5 rounded bg-white hover:bg-slate-100 border border-slate-300 text-slate-700 text-3xs font-semibold cursor-pointer whitespace-nowrap"
                          >
                            ರದ್ದು
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteQuestionKey(qKey)}
                          className="px-2.5 py-1 rounded-lg text-2xs font-semibold border border-rose-200 bg-rose-50/70 hover:bg-rose-100 text-rose-800 transition-colors flex items-center gap-1 cursor-pointer whitespace-nowrap"
                          title="ಈ ಪ್ರಶ್ನೆ ಡುಪ್ಲಿಕೇಟ್ ಆಗಿದ್ದರೆ ಶಾಶ್ವತವಾಗಿ ಡಿಲೀಟ್ ಮಾಡಿ"
                        >
                          <Trash2 className="w-3 h-3" />
                          <span>ಡಿಲೀಟ್</span>
                        </button>
                      )
                    )}

                    <button
                      type="button"
                      onClick={() => openImageModalForQuestion(q, defaultSlot)}
                      className={`px-3 py-1 rounded-lg text-2xs font-semibold border transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
                        imgReq.isPending
                          ? 'bg-amber-600 hover:bg-amber-700 text-white border-amber-600'
                          : imgReq.hasImage
                          ? 'bg-indigo-50 hover:bg-indigo-100 text-indigo-800 border-indigo-200'
                          : 'bg-white hover:bg-slate-50 text-slate-700 border-slate-300'
                      }`}
                      title="ಪ್ರಶ್ನೆ ಅಥವಾ ಉತ್ತರಕ್ಕೆ ಚಿತ್ರ ಜೋಡಿಸಿ / PDF ನಿಂದ ಕ್ರಾಪ್ ಮಾಡಿ"
                    >
                      <Crop className="w-3.5 h-3.5" />
                      <span>
                        {imgReq.isPending
                          ? 'ಚಿತ್ರ ಅಪ್ಲೋಡ್ / PDF ಕ್ರಾಪ್'
                          : imgReq.hasImage
                          ? 'ಚಿತ್ರ ಬದಲಿಸಿ'
                          : 'ಚಿತ್ರ ಜೋಡಿಸಿ / ಕ್ರಾಪ್'}
                      </span>
                    </button>

                    <span className="font-bold text-emerald-700 tabular-nums whitespace-nowrap">
                      {q.marks} {q.marks === 1 ? 'ಅಂಕ' : 'ಅಂಕಗಳು'}
                    </span>
                  </div>
                </div>

                {/* Clear Pending Diagram Indicator */}
                {imgReq.isPending && (
                  <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5 rounded-lg bg-amber-50 border border-amber-200/80 text-2xs text-amber-900">
                    <div className="flex items-center gap-1.5 font-semibold">
                      <AlertCircle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                      <span>
                        ಚಿತ್ರ ಅಪ್ಲೋಡ್ ಬಾಕಿ ({imgReq.suggestedSlot === 'answer' ? 'ಉತ್ತರ ಚಿತ್ರ' : 'ಪ್ರಶ್ನೆ ಚಿತ್ರ'}) ·{' '}
                        <span className="font-normal text-amber-800">{imgReq.reason}</span>
                      </span>
                    </div>
                  </div>
                )}

                {/* Question Text */}
                <div className="text-slate-900 font-semibold text-xs sm:text-sm leading-relaxed whitespace-pre-line">
                  <MathText text={q.question} />
                </div>

                {/* Attached Question Diagram / Image Preview with Inline Replace & Delete */}
                {(q.imageUrl || q.diagramSvg) && (
                  <div className="pt-1 space-y-1.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-2xs font-semibold text-slate-500">
                        ಪ್ರಶ್ನೆ ಚಿತ್ರ (Question Paper Image):
                      </span>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => openImageModalForQuestion(q, 'question')}
                          className="px-2 py-0.5 bg-white hover:bg-indigo-50 text-indigo-700 border border-indigo-200 rounded text-3xs font-bold flex items-center gap-1 cursor-pointer whitespace-nowrap"
                        >
                          <Replace className="w-3 h-3" />
                          <span>ಬದಲಾಯಿಸಿ (Replace)</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteQuestionImage(q, 'question')}
                          className="px-2 py-0.5 bg-white hover:bg-rose-50 text-rose-700 border border-rose-200 rounded text-3xs font-bold flex items-center gap-1 cursor-pointer whitespace-nowrap"
                        >
                          <Trash2 className="w-3 h-3" />
                          <span>ಡಿಲೀಟ್ (Delete)</span>
                        </button>
                      </div>
                    </div>
                    {q.imageUrl ? (
                      <img
                        src={q.imageUrl}
                        alt={q.diagramDescription || 'ಪ್ರಶ್ನೆ ಚಿತ್ರ'}
                        referrerPolicy="no-referrer"
                        className="max-h-44 max-w-full rounded-lg border border-slate-200 object-contain bg-white p-1"
                      />
                    ) : (
                      <div
                        className="max-w-xs border border-slate-200 rounded-lg bg-white p-1.5"
                        dangerouslySetInnerHTML={{ __html: q.diagramSvg || '' }}
                      />
                    )}
                  </div>
                )}

                {/* Options if MCQ */}
                {q.options && q.options.length > 0 && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 pl-3 pt-1 text-xs text-slate-700">
                    {q.options.map((opt, oIdx) => (
                      <div key={oIdx} className="bg-slate-50 rounded-lg px-2.5 py-1 border border-slate-200/60">
                        <MathText text={opt} />
                      </div>
                    ))}
                  </div>
                )}

                {/* Match Items */}
                {q.items && q.items.length > 0 && (
                  <div className="grid grid-cols-2 gap-2 pl-3 pt-1 text-xs bg-slate-50 p-2 rounded-xl border border-slate-200">
                    {q.items.map((it, iIdx) => (
                      <div key={iIdx} className="flex justify-between border-b border-slate-200/60 pb-1">
                        <span className="font-medium text-slate-800"><MathText text={it.left} /></span>
                        <span className="font-bold text-indigo-700"><MathText text={it.right} /></span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Answer Block */}
                <div className="bg-emerald-50/60 border border-emerald-200/60 rounded-xl p-2.5 text-xs text-emerald-950 mt-1 space-y-2">
                  <div>
                    <div className="flex items-center justify-between gap-2 mb-0.5">
                      <span className="font-bold text-emerald-900">ಉತ್ತರ:</span>
                      {onUpdateBank && (
                        <button
                          type="button"
                          onClick={() => openTextEditModalForQuestion(q)}
                          className="px-2 py-0.5 bg-white hover:bg-emerald-100 text-emerald-800 border border-emerald-300 rounded text-3xs font-bold flex items-center gap-1 cursor-pointer whitespace-nowrap"
                          title="ವಿವರವಾದ ಉತ್ತರವನ್ನು ಸೇರಿಸಿ ಅಥವಾ ತಿದ್ದುಪಡಿ ಮಾಡಿ"
                        >
                          <Edit3 className="w-3 h-3" />
                          <span>ಉತ್ತರ ತಿದ್ದುಪಡಿ (Edit Answer)</span>
                        </button>
                      )}
                    </div>
                    <span className="whitespace-pre-line leading-relaxed"><MathText text={q.answer} /></span>
                  </div>

                  {/* Separate Answer Key Diagram Preview with Inline Replace & Delete */}
                  {(q.answerImageUrl || q.answerDiagramSvg) && (
                    <div className="pt-1 border-t border-emerald-200/60 space-y-1.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-2xs font-bold text-emerald-800">
                          ಉತ್ತರ ಚಿತ್ರ / ಲೇಬಲ್ ಮಾಡಿದ ಚಿತ್ರ (Answer Key Image):
                        </span>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => openImageModalForQuestion(q, 'answer')}
                            className="px-2 py-0.5 bg-white hover:bg-emerald-50 text-emerald-700 border border-emerald-300 rounded text-3xs font-bold flex items-center gap-1 cursor-pointer whitespace-nowrap"
                          >
                            <Replace className="w-3 h-3" />
                            <span>ಬದಲಾಯಿಸಿ (Replace)</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteQuestionImage(q, 'answer')}
                            className="px-2 py-0.5 bg-white hover:bg-rose-50 text-rose-700 border border-rose-200 rounded text-3xs font-bold flex items-center gap-1 cursor-pointer whitespace-nowrap"
                          >
                            <Trash2 className="w-3 h-3" />
                            <span>ಡಿಲೀಟ್ (Delete)</span>
                          </button>
                        </div>
                      </div>
                      {q.answerImageUrl ? (
                        <img
                          src={q.answerImageUrl}
                          alt={q.answerDiagramDescription || 'ಉತ್ತರ ಚಿತ್ರ'}
                          referrerPolicy="no-referrer"
                          className="max-h-44 max-w-full rounded-lg border border-emerald-300 object-contain bg-white p-1"
                        />
                      ) : (
                        <div
                          className="max-w-xs border border-emerald-300 rounded-lg bg-white p-1.5"
                          dangerouslySetInnerHTML={{ __html: q.answerDiagramSvg || '' }}
                        />
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Interactive Image Upload & PDF Cropper Modal with Permanent PDF Vault & In-Modal Prev/Next Navigation */}
      {activeModalQuestion && (() => {
        const chQuestions = activeModalChapter?.questions || [];
        const qIndexInChapter = Math.max(
          0,
          chQuestions.findIndex(item => item.id === activeModalQuestion.id)
        );
        const navQueueLabel =
          imageFilter === 'pending'
            ? 'ಚಿತ್ರ ಬಾಕಿ ಇರುವ ಪ್ರಶ್ನೆಗಳು'
            : imageFilter === 'uploaded'
              ? 'ಚಿತ್ರ ಅಪ್ಲೋಡ್ ಆದ ಪ್ರಶ್ನೆಗಳು'
              : 'ಪ್ರಶ್ನೆ ಪಟ್ಟಿ';
        return (
          <QuestionImageModal
            isOpen={Boolean(activeModalQuestion)}
            onClose={() => {
              setEditingImageQuestion(null);
              setModalNavQueue([]);
              setModalNavIndex(0);
            }}
            question={activeModalQuestion}
            questionIndex={qIndexInChapter + 1}
            totalChapterQuestions={chQuestions.length}
            chapterQuestionPages={activeModalChapter?.questionPages}
            chapterAnswerPages={activeModalChapter?.answerPages}
            gradeKey={extractGradeKey(bank.metadata.gradeKey || bank.metadata.grade)}
            subjectCode={deduceSubjectCode(String(bank.metadata.subjectCode || bank.metadata.subject || ''))}
            pdfBuffer={sharedPdfBuffer}
            pdfFileName={sharedPdfName}
            savedPdfs={savedPdfs}
            activePdfId={activePdfId}
            initialQuestionPage={
              activeModalQuestion.sourcePage || parseFirstPage(activeModalChapter?.questionPages)
            }
            initialAnswerPage={
              activeModalQuestion.answerPage || parseFirstPage(activeModalChapter?.answerPages)
            }
            initialSlot={editingImageSlot}
            onNavigatePrev={
              modalNavQueue.length > 1 ? () => handleNavigateModalQuestion(-1) : undefined
            }
            onNavigateNext={
              modalNavQueue.length > 1 ? () => handleNavigateModalQuestion(1) : undefined
            }
            hasPrevQuestion={modalNavIndex > 0}
            hasNextQuestion={modalNavIndex < modalNavQueue.length - 1}
            navPositionIndex={modalNavQueue.length > 1 ? modalNavIndex + 1 : undefined}
            navTotalCount={modalNavQueue.length > 1 ? modalNavQueue.length : undefined}
            navQueueLabel={navQueueLabel}
            onPdfLoaded={(buf, name, savedEntry) => {
              setSharedPdfBuffer(buf);
              setSharedPdfName(name);
              if (savedEntry) {
                setActivePdfId(savedEntry.id);
                refreshVaultLists();
              }
            }}
            onSelectSavedPdf={handleSelectSavedPdf}
            onSave={handleSaveQuestionImage}
          />
        );
      })()}

      {/* Direct Question & Detailed Answer Editor Modal (with Pull Answer from Uploaded PDF) */}
      {activeEditingTextQuestion && (() => {
        const editChapter = bank.chapters.find(c => c.chapterId === activeEditingTextQuestion.chapterId);
        return (
          <QuestionEditModal
            isOpen={Boolean(activeEditingTextQuestion)}
            onClose={() => {
              setEditingTextIndex(-1);
              setEditingTextQueue([]);
            }}
            question={activeEditingTextQuestion}
            chapterName={activeEditingTextQuestion.chapterName || editChapter?.chapterName}
            onSave={handleSaveEditedQuestionText}
            onDelete={
              onUpdateBank
                ? () => handleDeleteQuestion(activeEditingTextQuestion)
                : undefined
            }
            isPossibleDuplicate={possibleDuplicateKeys.has(
              `${activeEditingTextQuestion.chapterId}::${activeEditingTextQuestion.id}`
            )}
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
            pdfBuffer={sharedPdfBuffer}
            pdfFileName={sharedPdfName}
            savedPdfs={savedPdfs}
            activePdfId={activePdfId}
            onSelectSavedPdf={handleSelectSavedPdf}
            onPdfLoaded={(buf, name, savedEntry) => {
              setSharedPdfBuffer(buf);
              setSharedPdfName(name);
              if (savedEntry) {
                setActivePdfId(savedEntry.id);
                refreshVaultLists();
              }
            }}
            chapters={bank.chapters.map(c => ({
              chapterId: c.chapterId,
              chapterNumber: c.chapterNumber,
              chapterName: c.chapterName,
              questionPages: c.questionPages,
              answerPages: c.answerPages,
            }))}
            initialAnswerPage={
              activeEditingTextQuestion.answerPage ||
              (editChapter?.answerPages ? parseFirstPage(editChapter.answerPages) : undefined)
            }
            grade={bank.metadata.grade}
            gradeKey={extractGradeKey(bank.metadata.gradeKey || bank.metadata.grade)}
            subject={bank.metadata.subject}
            subjectCode={deduceSubjectCode(String(bank.metadata.subjectCode || bank.metadata.subject || ''))}
            medium={bank.metadata.medium || medium}
          />
        );
      })()}
    </div>
  );
};
