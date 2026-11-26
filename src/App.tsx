/**
 * Main Application Component: ಪ್ರಶ್ನೆ ಪತ್ರಿಕೆ ರಚನಾ ಸಾಧನ (QUESTION PAPER GENERATOR BY S R ANGADI)
 * Designed for Karnataka State Syllabus Question Papers and Answer Keys
 * Author: M I Nilaji / S R Angadi
 */

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import {
  IndexEntry,
  QuestionBank,
  Chapter,
  PaperHeader,
  GeneratedPaper,
  SectionBlueprint,
  STANDARD_QUESTION_FORMATS,
  getAvailableFormatsForSubject,
} from './types/questionBank.ts';
import {
  fetchBankIndex,
  loadQuestionBankByPath,
  registerCustomBank,
  matchesGrade,
  canonicalGradeLabel,
  extractGradeKey,
  deduceSubjectCode,
  getSubjectDedupKey,
  normalizeMediumBucket,
  ensureUniqueQuestionIds,
} from './services/dataLoader.ts';
import { generateQuestionPaper, buildBlueprintsFromSelectedFormats } from './services/paperGenerator.ts';
import { generateOfficialBlueprint } from './services/blueprintEngine.ts';
import {
  auth,
  isVerifiedAdminUser,
  getMySchoolRegistrationFromFirebase,
  signOutStudent,
  saveQuestionBankToFirebase,
} from './services/firebase.ts';
import { listAllSavedQuestionBanks, loadSavedQuestionBank } from './services/pdfVault.ts';
import {
  smartMergeQuestionBanks,
  parseUploadedJsonToQuestionBank,
  pickBestMatchingBankCandidate,
  deduplicateQuestionBank,
} from './utils/bankMerger.ts';

import { TopBar, AppViewMode } from './components/TopBar.tsx';
import { HomePortalView, AppUserSession } from './components/HomePortalView.tsx';
import { SetupPanel } from './components/SetupPanel.tsx';
import { ChapterSelectionPanel } from './components/ChapterSelectionPanel.tsx';
import { QuestionFormatsPanel } from './components/QuestionFormatsPanel.tsx';
import { PaperPreview } from './components/PaperPreview.tsx';
import { AnswerKeyPreview } from './components/AnswerKeyPreview.tsx';
import { QuestionBankExplorer } from './components/QuestionBankExplorer.tsx';
import { BluePrintView } from './components/BluePrintView.tsx';
import { JsonGuideModal } from './components/JsonGuideModal.tsx';
import { SectionConfigModal } from './components/SectionConfigModal.tsx';
import { AiJsonGenerator } from './components/AiJsonGenerator.tsx';
import { OnlineTestView } from './components/OnlineTestView.tsx';

import {
  AlertTriangle,
  ArrowLeft,
  Printer,
  RefreshCw,
  Sliders,
  Building2,
  ShieldCheck,
  Image as ImageIcon,
  X,
} from 'lucide-react';

const TEACHER_SESSION_STORAGE_KEY = 'qpg_school_session_v1';

function loadStoredTeacherSession(): AppUserSession | null {
  try {
    const raw = sessionStorage.getItem(TEACHER_SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.schoolName !== 'string' || !parsed.schoolName.trim()) {
      return null;
    }
    if (typeof parsed.email !== 'string' || !parsed.email.includes('@')) {
      return null;
    }
    // Security: NEVER restore admin privilege from client storage; admin is derived solely from live Firebase Auth.
    return {
      uid: typeof parsed.uid === 'string' && parsed.uid ? parsed.uid : 'school_guest',
      role: 'teacher',
      schoolName: parsed.schoolName.trim(),
      teacherName: typeof parsed.teacherName === 'string' ? parsed.teacherName.trim() : '',
      email: parsed.email.trim().toLowerCase(),
      taluk: typeof parsed.taluk === 'string' ? parsed.taluk.trim() : undefined,
      district: typeof parsed.district === 'string' ? parsed.district.trim() : undefined,
      diseCode: typeof parsed.diseCode === 'string' ? parsed.diseCode.trim() : undefined,
      medium: typeof parsed.medium === 'string' && parsed.medium.trim()
        ? parsed.medium.trim()
        : 'ಕನ್ನಡ ಮಾಧ್ಯಮ (State Syllabus)',
      authMethod: 'registration',
    };
  } catch {
    return null;
  }
}

export default function App() {
  // User session & strict Firebase-verified Admin state
  const [userSession, setUserSession] = useState<AppUserSession | null>(() => loadStoredTeacherSession());
  const [firebaseAdminVerified, setFirebaseAdminVerified] = useState<boolean>(false);

  // Cryptographically verified admin check (never trusted from client storage or form input)
  const isAdmin = Boolean(
    userSession &&
      userSession.role === 'admin' &&
      firebaseAdminVerified &&
      isVerifiedAdminUser(auth.currentUser)
  );

  // Navigation view state: starts on 'home' before login, 'setup' if a teacher session is already active
  const [activeView, setActiveView] = useState<AppViewMode>(() =>
    loadStoredTeacherSession() ? 'setup' : 'home'
  );

  // JSON Guide Modal state (Admin-only)
  const [isJsonGuideOpen, setIsJsonGuideOpen] = useState<boolean>(false);

  // Preview sub-mode: 'paper' (Question Paper only) | 'answers' (Answer key only) | 'both'
  const [previewSubMode, setPreviewSubMode] = useState<'paper' | 'answers' | 'both'>('paper');

  // Central Index and question bank files
  const [availableFiles, setAvailableFiles] = useState<IndexEntry[]>([]);
  const [selectedFileId, setSelectedFileId] = useState<string>('maths_class6');

  // Form states
  const [schoolName, setSchoolName] = useState<string>(
    () => loadStoredTeacherSession()?.schoolName || 'GOVT KHPS NINGYANATTI'
  );
  const [medium, setMedium] = useState<string>(
    () => loadStoredTeacherSession()?.medium || 'ಕನ್ನಡ ಮಾಧ್ಯಮ (State Syllabus)'
  );
  const [grade, setGrade] = useState<string>('6 ನೇ ತರಗತಿ (Class 6)');
  const [semesterPart, setSemesterPart] = useState<'sem1' | 'sem2' | 'all'>('sem2');
  const [paperModel, setPaperModel] = useState<'paper' | 'answers' | 'both'>('paper');
  const [examType, setExamType] = useState<string>('ಸಂಕಲನಾತ್ಮಕ ಮೌಲ್ಯಮಾಪನ-1 (SA-1 ಮಧ್ಯವಾರ್ಷಿಕ)');
  const [targetMarks, setTargetMarks] = useState<number>(40);
  const [targetQuestionsCount, setTargetQuestionsCount] = useState<number>(24);
  const [examDateOrYear, setExamDateOrYear] = useState<string>('2026-27');

  // Active loaded Question Bank
  const [currentBank, setCurrentBank] = useState<QuestionBank | null>(null);
  const [isLoadingBank, setIsLoadingBank] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Selected Chapters
  const [selectedChapterIds, setSelectedChapterIds] = useState<string[]>([]);

  // Selected Question Formats
  const [selectedFormatIds, setSelectedFormatIds] = useState<string[]>(
    STANDARD_QUESTION_FORMATS.map(f => f.id)
  );

  // Generated Paper State
  const [generatedPaper, setGeneratedPaper] = useState<GeneratedPaper | null>(null);
  const [initialGeneratedPaper, setInitialGeneratedPaper] = useState<GeneratedPaper | null>(null);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState<boolean>(false);

  // Section Configuration Modal State (vibhagavaru prashnegalannu hondisuva option)
  const [isSectionConfigOpen, setIsSectionConfigOpen] = useState<boolean>(false);
  const [customSections, setCustomSections] = useState<SectionBlueprint[] | null>(null);

  // Track all previously shown bank question IDs & per-question usage counts across regenerations
  // so "ಪುನಃ ರಚಿಸಿ" ALWAYS returns 100% fresh questions without prematurely wiping other sections' history!
  const previouslyShownQuestionIdsRef = useRef<Set<string>>(new Set());
  const questionUsageCountRef = useRef<Map<string, number>>(new Map());
  const latestGeneratedPaperRef = useRef<GeneratedPaper | null>(null);
  latestGeneratedPaperRef.current = generatedPaper;

  // Reset regeneration history whenever bank, chapters, or selected formats change
  useEffect(() => {
    previouslyShownQuestionIdsRef.current = new Set();
    questionUsageCountRef.current = new Map();
  }, [currentBank, selectedChapterIds, selectedFormatIds]);

  // Keep Firebase Auth state synchronized (for verified Admin & Google-signed-in Teachers)
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async user => {
      if (user && user.email) {
        const verifiedAdmin = isVerifiedAdminUser(user);
        setFirebaseAdminVerified(verifiedAdmin);

        let existingReg = null;
        try {
          existingReg = await getMySchoolRegistrationFromFirebase();
        } catch {
          existingReg = null;
        }

        const resolvedSchool =
          existingReg?.schoolName?.trim() ||
          (verifiedAdmin ? 'GOVT KHPS NINGYANATTI' : `${user.displayName || 'ಶಾಲೆ'} (School)`);
        const resolvedMedium =
          existingReg?.medium?.trim() || 'ಕನ್ನಡ ಮಾಧ್ಯಮ (State Syllabus)';

        const nextSession: AppUserSession = {
          uid: user.uid,
          role: verifiedAdmin ? 'admin' : 'teacher',
          schoolName: resolvedSchool,
          teacherName: existingReg?.teacherName || user.displayName || (verifiedAdmin ? 'S R Angadi (Admin)' : ''),
          email: user.email.toLowerCase(),
          taluk: existingReg?.taluk,
          district: existingReg?.district,
          diseCode: existingReg?.diseCode,
          medium: resolvedMedium,
          authMethod: 'google',
        };

        setUserSession(nextSession);
        setSchoolName(resolvedSchool);
        setMedium(resolvedMedium);
        setActiveView(prev => (prev === 'home' ? 'setup' : prev));
      } else {
        setFirebaseAdminVerified(false);
        setUserSession(prev => {
          if (prev && (prev.role === 'admin' || prev.authMethod === 'google')) {
            return null;
          }
          return prev;
        });
      }
    });

    return () => unsubscribe();
  }, []);

  // Strict RBAC route guard:
  // 1) Before login, only 'home' and 'online_test' are accessible.
  // 2) Normal teacher accounts can NEVER access 'explorer', 'ai_generator', or JSON Guide modal.
  useEffect(() => {
    if (!userSession) {
      if (activeView !== 'home' && activeView !== 'online_test') {
        setActiveView('home');
      }
      if (isJsonGuideOpen) setIsJsonGuideOpen(false);
      return;
    }

    if (!isAdmin) {
      if (activeView === 'explorer' || activeView === 'ai_generator') {
        setActiveView('setup');
      }
      if (isJsonGuideOpen) {
        setIsJsonGuideOpen(false);
      }
    }
  }, [userSession, isAdmin, activeView, isJsonGuideOpen]);

  const handleAuthenticated = useCallback((session: AppUserSession) => {
    const verifiedAdmin = session.role === 'admin' && isVerifiedAdminUser(auth.currentUser);
    const safeSession: AppUserSession = {
      ...session,
      role: verifiedAdmin ? 'admin' : 'teacher',
    };

    setFirebaseAdminVerified(verifiedAdmin);
    setUserSession(safeSession);
    if (safeSession.schoolName.trim()) {
      setSchoolName(safeSession.schoolName.trim());
    }
    if (safeSession.medium) {
      setMedium(safeSession.medium);
    }

    if (!verifiedAdmin && safeSession.authMethod === 'registration') {
      try {
        sessionStorage.setItem(
          TEACHER_SESSION_STORAGE_KEY,
          JSON.stringify({
            uid: safeSession.uid,
            schoolName: safeSession.schoolName,
            teacherName: safeSession.teacherName,
            email: safeSession.email,
            taluk: safeSession.taluk,
            district: safeSession.district,
            diseCode: safeSession.diseCode,
            medium: safeSession.medium,
          })
        );
      } catch {
        // ignore storage quota errors
      }
    } else {
      try {
        sessionStorage.removeItem(TEACHER_SESSION_STORAGE_KEY);
      } catch {
        // ignore
      }
    }

    setActiveView('setup');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const handleLogout = useCallback(async () => {
    try {
      sessionStorage.removeItem(TEACHER_SESSION_STORAGE_KEY);
    } catch {
      // ignore
    }
    try {
      await signOutStudent();
    } catch {
      // ignore
    }
    setFirebaseAdminVerified(false);
    setUserSession(null);
    setGeneratedPaper(null);
    setIsJsonGuideOpen(false);
    setActiveView('home');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  // 1. Initial Load: Fetch Index and initial Question Bank (Maths Class 6 by default as in screenshot)
  const loadInitialBank = useCallback(async () => {
    try {
      setIsLoadingBank(true);
      setLoadError(null);
      const index = await fetchBankIndex();
      setAvailableFiles(index.files);

      // Prefer maths_class6, with automatic fallback to other indexed files if needed
      const preferred = index.files.find(f => f.id === 'maths_class6');
      const candidates = preferred
        ? [preferred, ...index.files.filter(f => f.id !== preferred.id)]
        : index.files;

      let loadedEntry: IndexEntry | null = null;
      let loadedBank: QuestionBank | null = null;
      let lastErr: unknown = null;

      for (const candidate of candidates) {
        try {
          loadedBank = await loadQuestionBankByPath(candidate.path);
          loadedEntry = candidate;
          break;
        } catch (err) {
          lastErr = err;
        }
      }

      if (loadedEntry && loadedBank) {
        setSelectedFileId(loadedEntry.id);
        setCurrentBank(loadedBank);

        // For Maths, default to Semester 2 chapters (chapters 6 to 10) as in user's screenshot
        const sem2Chapters = loadedBank.chapters.filter(c => c.semester === 2);
        const initialChs = sem2Chapters.length > 0 ? sem2Chapters : loadedBank.chapters;
        setSelectedChapterIds(initialChs.map(c => c.chapterId));
      } else if (lastErr) {
        throw lastErr;
      }
    } catch (err) {
      console.error('Initialization error:', err);
      setLoadError('ಪ್ರಶ್ನೆ ಬ್ಯಾಂಕ್ ಲೋಡ್ ಮಾಡುವಲ್ಲಿ ದೋಷ ಕಂಡುಬಂದಿದೆ. ದಯವಿಟ್ಟು ಪುನಃ ಪ್ರಯತ್ನಿಸಿ.');
    } finally {
      setIsLoadingBank(false);
    }
  }, []);

  useEffect(() => {
    loadInitialBank();
  }, [loadInitialBank]);

  // Keep availableFiles fresh when returning to Setup or Explorer without losing freshly registered custom entries
  const refreshBankIndex = useCallback(async () => {
    try {
      const index = await fetchBankIndex();
      if (index.files && index.files.length > 0) {
        setAvailableFiles(prev => {
          const byId = new Map<string, IndexEntry>();
          index.files.forEach(f => byId.set(f.id, f));
          // Preserve any newly created/imported local entries not yet reflected in index
          prev.forEach(existing => {
            if (!byId.has(existing.id) && (existing.isUserGenerated || !existing.path)) {
              byId.set(existing.id, existing);
            }
          });
          return Array.from(byId.values());
        });
      }
    } catch {
      // Keep existing availableFiles if refresh fails
    }
  }, []);

  useEffect(() => {
    if (activeView === 'setup' || activeView === 'explorer') {
      refreshBankIndex();
    }
  }, [activeView, refreshBankIndex]);

  // 2. When Subject / File Changes
  const handleSelectFile = useCallback(
    async (fileId: string) => {
      const fileEntry = availableFiles.find(f => f.id === fileId);
      if (!fileEntry) return;

      try {
        setIsLoadingBank(true);
        setLoadError(null);
        setSelectedFileId(fileId);

        // Also sync Grade if the fileEntry specifies a different grade
        if (fileEntry.grade && !matchesGrade({ grade }, fileEntry.grade)) {
          setGrade(canonicalGradeLabel(extractGradeKey(fileEntry.gradeKey || fileEntry.grade)));
        }

        // Sync teaching medium dropdown cleanly with the selected bank's medium
        if (fileEntry.medium) {
          const medBucket = normalizeMediumBucket(fileEntry.medium);
          if (medBucket === 'english') {
            setMedium('English Medium');
          } else if (medBucket === 'kannada') {
            setMedium('ಕನ್ನಡ ಮಾಧ್ಯಮ (State Syllabus)');
          }
        }

        const rawBank = await loadQuestionBankByPath(fileEntry.path);
        const dedupRes = deduplicateQuestionBank(rawBank);
        const bank = dedupRes.cleanedBank;
        setCurrentBank(bank);

        // If duplicates were found in a user-saved bank (Firebase/Server), auto-sync the cleaned copy
        // (preserving 100% of uploaded images) so duplicates never reappear!
        if (
          dedupRes.removedDuplicates > 0 &&
          (fileEntry.isUserGenerated || fileEntry.path.startsWith('firebase://') || fileEntry.path.includes('/user_banks/'))
        ) {
          const syncedBank: QuestionBank = {
            ...bank,
            metadata: {
              ...bank.metadata,
              id: bank.metadata.id || fileEntry.id,
              updatedAt: new Date().toISOString(),
            },
          };
          registerCustomBank(syncedBank, {
            ...fileEntry,
            totalChapters: syncedBank.chapters.length,
            totalQuestions: dedupRes.totalQuestionsAfter,
          });
          setAvailableFiles(prev =>
            prev.map(f =>
              f.id === fileEntry.id
                ? { ...f, totalChapters: syncedBank.chapters.length, totalQuestions: dedupRes.totalQuestionsAfter }
                : f
            )
          );
          fetch('/api/save-question-bank', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ questionBank: syncedBank }),
          }).catch(() => {});
          saveQuestionBankToFirebase(syncedBank).catch(() => {});
        }

        // Select chapters according to current semesterPart (fallback to all if semester subset is empty)
        let chs = bank.chapters;
        if (semesterPart === 'sem1') {
          const filtered = bank.chapters.filter(c => c.semester === 1);
          if (filtered.length > 0) chs = filtered;
        } else if (semesterPart === 'sem2') {
          const filtered = bank.chapters.filter(c => c.semester === 2);
          if (filtered.length > 0) chs = filtered;
        }
        setSelectedChapterIds(chs.map(c => c.chapterId));

        // Auto-select valid question formats for this subject (hiding language formats for core subjects)
        const availFmts = getAvailableFormatsForSubject(
          deduceSubjectCode(fileEntry.subjectCode, fileEntry.subject || bank.metadata.subject)
        );
        setSelectedFormatIds(availFmts.map(f => f.id));

        // Reset paper for new subject
        setGeneratedPaper(null);
        setInitialGeneratedPaper(null);
        setGenerationError(null);
      } catch (err) {
        console.error('Error changing question bank:', err);
        setLoadError('ಆಯ್ದ ಪ್ರಶ್ನೆ ಬ್ಯಾಂಕ್ ಲೋಡ್ ಮಾಡಲು ಸಾಧ್ಯವಾಗಿಲ್ಲ.');
      } finally {
        setIsLoadingBank(false);
      }
    },
    [availableFiles, semesterPart, grade]
  );

  // 3. When Grade changes from dropdown, switch grade and automatically select matching question bank
  const handleGradeChange = useCallback(
    (newGrade: string) => {
      const canon = canonicalGradeLabel(extractGradeKey(newGrade));
      setGrade(canon);

      // Find files matching the new grade
      const matchingFiles = availableFiles.filter(f => matchesGrade(f, canon));
      if (matchingFiles.length > 0) {
        const currentFile = availableFiles.find(f => f.id === selectedFileId);
        const currentCode = currentFile
          ? deduceSubjectCode(currentFile.subjectCode, currentFile.subject)
          : '';
        // Try to match the same subject or subjectCode
        const sameSubject = matchingFiles.find(f => {
          if (!currentFile) return false;
          const fCode = deduceSubjectCode(f.subjectCode, f.subject);
          return (
            (currentCode !== 'GEN' && fCode === currentCode) ||
            f.subject.toLowerCase() === currentFile.subject.toLowerCase()
          );
        });
        const target = sameSubject || matchingFiles[0];
        handleSelectFile(target.id);
      }
    },
    [availableFiles, selectedFileId, handleSelectFile]
  );

  // 4. When Semester Part changes, auto-filter/select matching chapters
  const handleSemesterPartChange = useCallback(
    (part: 'sem1' | 'sem2' | 'all') => {
      setSemesterPart(part);
      if (!currentBank) return;

      let chs = currentBank.chapters;
      if (part === 'sem1') {
        const filtered = currentBank.chapters.filter(c => c.semester === 1);
        if (filtered.length > 0) chs = filtered;
      } else if (part === 'sem2') {
        const filtered = currentBank.chapters.filter(c => c.semester === 2);
        if (filtered.length > 0) chs = filtered;
      }
      setSelectedChapterIds(chs.map(c => c.chapterId));
    },
    [currentBank]
  );

  // When Exam Type changes, automatically synchronize semester part (e.g. SA-2 -> sem2, SA-1 -> sem1)
  const handleExamTypeChange = useCallback(
    (newExamType: string) => {
      setExamType(newExamType);
      if (!currentBank) return;

      let newPart: 'sem1' | 'sem2' | 'all' = semesterPart;
      if (
        newExamType.includes('SA-2') ||
        newExamType.includes('FA-3') ||
        newExamType.includes('FA-4')
      ) {
        newPart = 'sem2';
      } else if (
        newExamType.includes('SA-1') ||
        newExamType.includes('FA-1') ||
        newExamType.includes('FA-2')
      ) {
        newPart = 'sem1';
      }

      setSemesterPart(newPart);

      let chs = currentBank.chapters;
      if (newPart === 'sem1') {
        const filtered = currentBank.chapters.filter(c => c.semester === 1);
        if (filtered.length > 0) chs = filtered;
      } else if (newPart === 'sem2') {
        const filtered = currentBank.chapters.filter(c => c.semester === 2);
        if (filtered.length > 0) chs = filtered;
      }
      setSelectedChapterIds(chs.map(c => c.chapterId));
    },
    [currentBank, semesterPart]
  );

  // Chapters to display based on semester part (with resilient fallback so never empty)
  const visibleChapters = useMemo(() => {
    if (!currentBank) return [];
    let list: Chapter[] = [];
    if (semesterPart === 'sem1') {
      list = currentBank.chapters.filter(c => c.semester === 1);
    } else if (semesterPart === 'sem2') {
      list = currentBank.chapters.filter(c => c.semester === 2);
    } else {
      list = currentBank.chapters;
    }

    // Resilience: if filtered semester has 0 chapters, fall back to all chapters
    if (list.length === 0 && currentBank.chapters.length > 0) {
      return currentBank.chapters;
    }
    return list;
  }, [currentBank, semesterPart]);

  // Available question counts per format for the selected subject and chapters
  const formatCounts = useMemo(() => {
    if (!currentBank) return {};
    const filteredChs =
      selectedChapterIds.length === 0
        ? currentBank.chapters
        : currentBank.chapters.filter(c => selectedChapterIds.includes(c.chapterId));

    const counts: Record<string, number> = {};
    for (const ch of filteredChs) {
      for (const q of ch.questions) {
        counts[q.formatCategoryId] = (counts[q.formatCategoryId] || 0) + 1;
      }
    }
    return counts;
  }, [currentBank, selectedChapterIds]);

  // Official 5-Stage Blueprint with complete tallying and interconnectivity
  const activeBlueprint = useMemo(() => {
    if (!currentBank) return null;
    return generateOfficialBlueprint(
      currentBank,
      selectedChapterIds,
      targetMarks,
      targetQuestionsCount,
      generatedPaper
    );
  }, [currentBank, selectedChapterIds, targetMarks, targetQuestionsCount, generatedPaper]);

  // Generate Paper Trigger: "Instant 0.01s"
  const handleGeneratePaper = useCallback((
    targetView: 'preview' | 'blueprint' = 'preview',
    isRegenerate: boolean = false
  ) => {
    if (!currentBank) return;

    if (selectedChapterIds.length === 0) {
      setGenerationError('ದಯವಿಟ್ಟು ಕನಿಷ್ಠ ಒಂದು ಅಧ್ಯಾಯವನ್ನು ಆಯ್ಕೆಮಾಡಿ (Please select at least one chapter).');
      return;
    }

    if (selectedFormatIds.length === 0) {
      setGenerationError('ದಯವಿಟ್ಟು ಕನಿಷ್ಠ ಒಂದು ಪ್ರಶ್ನೆ ಪ್ರಕಾರವನ್ನು ಆಯ್ಕೆಮಾಡಿ (Please select at least one question format).');
      return;
    }

    setIsGenerating(true);
    setGenerationError(null);

    try {
      // Collect currently displayed question IDs & normalized texts via ref so Regenerate ALWAYS uses the live paper
      const normalizeQText = (text: string) =>
        String(text || '')
          .replace(/^[0-9೦-೯]+[\.\)\-:\s]+/, '')
          .replace(/[^\p{L}\p{N}\s]/gu, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .toLowerCase();

      const livePaper = latestGeneratedPaperRef.current;
      const currentPaperIds = new Set<string>();
      const currentPaperTexts = new Set<string>();
      if (livePaper) {
        for (const sec of livePaper.sections) {
          for (const q of sec.questions) {
            if (q.bankQuestionId) currentPaperIds.add(q.bankQuestionId);
            const nt = normalizeQText(q.question);
            if (nt.length >= 6) currentPaperTexts.add(nt);
          }
        }
      }

      if (isRegenerate) {
        for (const id of currentPaperIds) {
          previouslyShownQuestionIdsRef.current.add(id);
          if (!questionUsageCountRef.current.has(id)) {
            questionUsageCountRef.current.set(id, 1);
          }
        }
      } else {
        // Fresh generation from Setup: start a clean history
        previouslyShownQuestionIdsRef.current = new Set();
        questionUsageCountRef.current = new Map();
      }

      const excludeIds = isRegenerate
        ? new Set<string>(previouslyShownQuestionIdsRef.current)
        : new Set<string>();

      // Use custom configured sections if set by user, otherwise auto-generate strictly from selected formats
      // Passing excludeIds allows Regenerate to shift slots away from exhausted 1-2 question formats into fresh selected formats!
      let blueprints: SectionBlueprint[];
      if (customSections && customSections.length > 0) {
        blueprints = customSections.map(s => ({
          ...s,
          selectedChapterIds: selectedChapterIds.length > 0 ? selectedChapterIds : s.selectedChapterIds,
        }));
      } else {
        blueprints = buildBlueprintsFromSelectedFormats(
          currentBank,
          selectedFormatIds,
          selectedChapterIds,
          targetMarks,
          targetQuestionsCount,
          excludeIds
        );
      }

      const paperHeader: PaperHeader = {
        schoolName,
        examName: examType,
        academicYear: examDateOrYear,
        grade,
        subject: currentBank.metadata.subject,
        medium,
        date: examDateOrYear,
        time: '೨ ಗಂಟೆ ೩೦ ನಿಮಿಷಗಳು',
        maxMarks: targetMarks,
        generalInstructions: [
          'ಎಲ್ಲಾ ಪ್ರಶ್ನೆಗಳಿಗೂ ಉತ್ತರಿಸುವುದು ಕಡ್ಡಾಯವಾಗಿದೆ.',
          'ಪ್ರಶ್ನೆಗಳಿಗೆ ನಿಗದಿಪಡಿಸಿದ ಅಂಕಗಳನ್ನು ಬಲಭಾಗದಲ್ಲಿ ನೀಡಲಾಗಿದೆ.',
          'ಪ್ರಶ್ನೆ ಪತ್ರಿಕೆಯನ್ನು ಎಚ್ಚರಿಕೆಯಿಂದ ಓದಿ ಉತ್ತರಿಸಿ.',
        ],
      };

      const paper = generateQuestionPaper(
        currentBank,
        paperHeader,
        blueprints,
        excludeIds,
        isRegenerate ? currentPaperIds : new Set<string>(),
        isRegenerate ? currentPaperTexts : new Set<string>(),
        isRegenerate ? new Map(questionUsageCountRef.current) : new Map()
      );

      // Increment usage counts per question ID without ever wiping history for other sections
      for (const sec of paper.sections) {
        for (const q of sec.questions) {
          if (q.bankQuestionId) {
            previouslyShownQuestionIdsRef.current.add(q.bankQuestionId);
            questionUsageCountRef.current.set(
              q.bankQuestionId,
              (questionUsageCountRef.current.get(q.bankQuestionId) || 0) + 1
            );
          }
        }
      }

      setGeneratedPaper(paper);
      setInitialGeneratedPaper(JSON.parse(JSON.stringify(paper)));
      setPreviewSubMode(paperModel);
      if (targetView === 'blueprint') {
        setActiveView('blueprint');
      } else {
        setActiveView('preview');
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'ಪ್ರಶ್ನೆ ಪತ್ರಿಕೆ ರಚನೆಯಲ್ಲಿ ದೋಷ ಸಂಭವಿಸಿದೆ.';
      setGenerationError(msg);
    } finally {
      setIsGenerating(false);
    }
  }, [
    currentBank,
    selectedChapterIds,
    selectedFormatIds,
    customSections,
    targetMarks,
    targetQuestionsCount,
    schoolName,
    examType,
    examDateOrYear,
    grade,
    medium,
    paperModel,
    generatedPaper,
  ]);

  // Regenerate with completely new non-repeating questions
  const handleRegenerate = useCallback(() => {
    handleGeneratePaper('preview', true);
  }, [handleGeneratePaper]);

  // Reset to initial generated version
  const handleResetToGenerated = useCallback(() => {
    if (initialGeneratedPaper) {
      setGeneratedPaper(JSON.parse(JSON.stringify(initialGeneratedPaper)));
    }
  }, [initialGeneratedPaper]);

  // Open Blueprint view, ensuring a paper is generated so unit question counts & swap work seamlessly
  const handleOpenBlueprint = useCallback(() => {
    if (!generatedPaper && currentBank && selectedChapterIds.length > 0) {
      handleGeneratePaper('blueprint');
    }
    setActiveView('blueprint');
  }, [generatedPaper, currentBank, selectedChapterIds, handleGeneratePaper]);

  // Ensure paper is auto-generated whenever blueprint view is opened from TopBar or any navigation
  useEffect(() => {
    if (activeView === 'blueprint' && !generatedPaper && currentBank && selectedChapterIds.length > 0 && !isGenerating) {
      handleGeneratePaper('blueprint');
    }
  }, [activeView, generatedPaper, currentBank, selectedChapterIds, isGenerating, handleGeneratePaper]);

  // Handle loading newly generated Question Bank from AI Generator
  const handleLoadGeneratedBank = useCallback(
    (bank: QuestionBank, entry: IndexEntry, navigateToSetup: boolean = true) => {
      const normalizedGradeKey = extractGradeKey(
        entry.gradeKey || entry.grade || bank.metadata.gradeKey || bank.metadata.grade
      );
      const normalizedSubjectCode = deduceSubjectCode(
        entry.subjectCode || (bank.metadata.subjectCode as string),
        entry.subject || bank.metadata.subject
      );
      const normalizedEntry: IndexEntry = {
        ...entry,
        grade: canonicalGradeLabel(normalizedGradeKey),
        gradeKey: normalizedGradeKey,
        subjectCode: normalizedSubjectCode,
        isUserGenerated: true,
      };

      registerCustomBank(bank, normalizedEntry);
      const newDedupKey = getSubjectDedupKey(normalizedEntry);
      setAvailableFiles(prev => [
        normalizedEntry,
        ...prev.filter(f => {
          if (f.id === normalizedEntry.id) return false;
          return getSubjectDedupKey(f) !== newDedupKey;
        }),
      ]);
      setGrade(canonicalGradeLabel(normalizedGradeKey));
      setSemesterPart('all');
      setSelectedFileId(normalizedEntry.id);
      setCurrentBank(bank);
      setSelectedChapterIds(bank.chapters.map(c => c.chapterId));
      if (navigateToSetup) {
        setActiveView('setup');
      }
    },
    []
  );

  // Open a previously saved or built-in Class 6 JSON bank directly inside QuestionBankExplorer
  const handleOpenSavedBankInExplorer = useCallback((rawBank: QuestionBank, entry?: IndexEntry) => {
    const { cleanedBank } = deduplicateQuestionBank(rawBank);
    const bankId =
      entry?.id ||
      (typeof cleanedBank.metadata.id === 'string' && cleanedBank.metadata.id) ||
      `saved_${Date.now()}`;
    const gKey = extractGradeKey(
      entry?.gradeKey || entry?.grade || cleanedBank.metadata.gradeKey || cleanedBank.metadata.grade
    );
    const sCode = deduceSubjectCode(
      entry?.subjectCode || (cleanedBank.metadata.subjectCode as string),
      entry?.subject || cleanedBank.metadata.subject
    );
    const bank: QuestionBank = {
      ...cleanedBank,
      metadata: {
        ...cleanedBank.metadata,
        id: bankId,
        gradeKey: gKey,
        subjectCode: sCode,
      },
    };
    const resolvedEntry: IndexEntry = entry
      ? {
          ...entry,
          id: bankId,
          grade: canonicalGradeLabel(gKey),
          gradeKey: gKey,
          subjectCode: sCode,
          totalChapters: bank.chapters.length,
          totalQuestions: bank.chapters.reduce((s, c) => s + (c.questions?.length || 0), 0),
        }
      : {
          id: bankId,
          path: `firebase://${bankId}`,
          grade: canonicalGradeLabel(gKey),
          gradeKey: gKey,
          subject: bank.metadata.subject,
          subjectCode: sCode,
          medium: bank.metadata.medium || 'ಕನ್ನಡ ಮಾಧ್ಯಮ (State Syllabus)',
          totalChapters: bank.chapters.length,
          totalQuestions: bank.chapters.reduce((s, c) => s + (c.questions?.length || 0), 0),
          isUserGenerated: true,
        };

    registerCustomBank(bank, resolvedEntry);
    setAvailableFiles(prev => {
      const exists = prev.some(f => f.id === resolvedEntry.id);
      return exists ? prev.map(f => (f.id === resolvedEntry.id ? resolvedEntry : f)) : [resolvedEntry, ...prev];
    });
    setGrade(canonicalGradeLabel(gKey));
    setSelectedFileId(resolvedEntry.id);
    setCurrentBank(bank);
    setSelectedChapterIds(bank.chapters.map(c => c.chapterId));
  }, []);

  // Remove a deleted saved/duplicate JSON bank from active app dropdowns cleanly
  const handleDeleteSavedBank = useCallback(
    (deletedId: string) => {
      setAvailableFiles(prev => {
        const remaining = prev.filter(f => f.id !== deletedId);
        if (selectedFileId === deletedId && remaining.length > 0) {
          const next = remaining[0];
          setSelectedFileId(next.id);
          loadQuestionBankByPath(next.path)
            .then(loaded => {
              setCurrentBank(loaded);
              setSelectedChapterIds(loaded.chapters.map(c => c.chapterId));
            })
            .catch(() => {});
        }
        return remaining;
      });
    },
    [selectedFileId]
  );

  // Persist updates made to the active Question Bank (e.g., attaching/cropping question & answer images)
  const handleUpdateCurrentBank = useCallback(
    async (updatedBank: QuestionBank) => {
      const currentEntry = availableFiles.find(f => f.id === selectedFileId);
      const bankId =
        typeof updatedBank.metadata.id === 'string' && updatedBank.metadata.id
          ? updatedBank.metadata.id
          : selectedFileId || `bank_${Date.now()}`;

      const resolvedGradeKey = extractGradeKey(
        updatedBank.metadata.gradeKey || updatedBank.metadata.grade
      );
      const resolvedSubjectCode = deduceSubjectCode(
        updatedBank.metadata.subjectCode as string | undefined,
        updatedBank.metadata.subject
      );

      const { cleanedBank: dedupedUpdate } = deduplicateQuestionBank(updatedBank);
      const enrichedBank: QuestionBank = {
        ...dedupedUpdate,
        metadata: {
          ...dedupedUpdate.metadata,
          id: bankId,
          gradeKey: resolvedGradeKey,
          subjectCode: resolvedSubjectCode,
          updatedAt: new Date().toISOString(),
        },
      };

      setCurrentBank(enrichedBank);

      // Keep in-memory bankCache in sync
      if (currentEntry) {
        registerCustomBank(enrichedBank, {
          ...currentEntry,
          id: bankId,
        });
      }

      // Sync any already-generated paper questions so newly attached images show immediately in preview & answer key
      setGeneratedPaper(prevPaper => {
        if (!prevPaper) return prevPaper;
        const qLookup = new Map<string, (typeof enrichedBank.chapters)[0]['questions'][0]>();
        enrichedBank.chapters.forEach(ch => {
          ch.questions.forEach(q => qLookup.set(q.id, q));
        });
        return {
          ...prevPaper,
          sections: prevPaper.sections.map(sec => ({
            ...sec,
            questions: sec.questions.map(gq => {
              const latest = qLookup.get(gq.bankQuestionId);
              if (!latest) return gq;
              return {
                ...gq,
                imageUrl: latest.imageUrl,
                diagramSvg: latest.diagramSvg,
                answerImageUrl: latest.answerImageUrl,
                answerDiagramSvg: latest.answerDiagramSvg,
                hasDiagram: latest.hasDiagram,
                diagramDescription: latest.diagramDescription,
                answerDiagramDescription: latest.answerDiagramDescription,
              };
            }),
          })),
        };
      });

      // Persist to Server Disk (/api/save-question-bank) and Firebase Firestore
      const serverPromise = fetch('/api/save-question-bank', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questionBank: enrichedBank }),
      }).then(async res => {
        if (!res.ok) throw new Error(`Server save failed (${res.status})`);
        return res.json();
      });

      const firebasePromise = saveQuestionBankToFirebase(enrichedBank);

      const [serverResult, firebaseResult] = await Promise.allSettled([serverPromise, firebasePromise]);
      if (serverResult.status === 'fulfilled' && serverResult.value?.entry) {
        const savedEntry: IndexEntry = serverResult.value.entry;
        registerCustomBank(enrichedBank, savedEntry);
        setAvailableFiles(prev =>
          prev.map(f => (f.id === selectedFileId ? { ...savedEntry, id: f.id } : f))
        );
      } else if (firebaseResult.status === 'fulfilled' && firebaseResult.value) {
        const fbId = firebaseResult.value;
        const fbEntry: IndexEntry = {
          ...(currentEntry || {
            id: fbId,
            path: `firebase://${fbId}`,
            grade: enrichedBank.metadata.grade,
            subject: enrichedBank.metadata.subject,
            medium: enrichedBank.metadata.medium,
          }),
          id: currentEntry?.id || fbId,
          path: `firebase://${fbId}`,
          isUserGenerated: true,
        };
        registerCustomBank(enrichedBank, fbEntry);
        setAvailableFiles(prev =>
          prev.map(f => (f.id === selectedFileId ? fbEntry : f))
        );
      } else {
        console.error('Both server and Firebase save failed:', {
          server: serverResult.status === 'rejected' ? serverResult.reason : null,
          firebase: firebaseResult.status === 'rejected' ? firebaseResult.reason : null,
        });
        setLoadError('ಬದಲಾವಣೆಗಳನ್ನು ಶಾಶ್ವತವಾಗಿ ಉಳಿಸಲು ಸಾಧ್ಯವಾಗಲಿಲ್ಲ. ದಯವಿಟ್ಟು ಪುನಃ ಪ್ರಯತ್ನಿಸಿ.');
      }
    },
    [availableFiles, selectedFileId]
  );

  // Direct 1-click JSON file import from SetupPanel (normalizes, smart-merges preserving images, and saves permanently!)
  const [isImportingJson, setIsImportingJson] = useState<boolean>(false);
  const handleImportJsonFile = useCallback(
    async (file: File) => {
      setIsImportingJson(true);
      setLoadError(null);
      try {
        const rawText = await file.text();
        const parsed = JSON.parse(rawText);
        const parsedRes = parseUploadedJsonToQuestionBank(parsed, file.name, currentBank?.metadata);
        let bank = parsedRes.bank;
        const resolvedGradeKey = parsedRes.gradeKey;
        const resolvedSubjectCode = parsedRes.subjectCode;

        // Find the previous ALL-UNITS bank for the same Class + Subject + Medium across Firebase, Server Disk, availableFiles, and currentBank
        let existingFull: QuestionBank | null = null;
        let existingId: string | undefined = undefined;

        try {
          const allSaved = await listAllSavedQuestionBanks();
          const bestSaved = pickBestMatchingBankCandidate(allSaved, bank);
          if (bestSaved) {
            const loaded = await loadSavedQuestionBank(bestSaved);
            if (loaded && loaded.chapters?.length > 0) {
              existingFull = loaded;
              existingId = loaded.metadata.id || bestSaved.id;
            }
          }
        } catch {
          // Fallback to availableFiles below
        }

        const bestIndexEntry = pickBestMatchingBankCandidate(availableFiles, bank);
        if (
          bestIndexEntry &&
          (!existingFull || (bestIndexEntry.totalChapters || 0) > existingFull.chapters.length)
        ) {
          try {
            const loadedIdx = await loadQuestionBankByPath(bestIndexEntry.path);
            if (loadedIdx && loadedIdx.chapters?.length > (existingFull?.chapters.length || 0)) {
              existingFull = loadedIdx;
              existingId = loadedIdx.metadata.id || bestIndexEntry.id;
            }
          } catch {
            // ignore
          }
        }

        // Also check currently loaded bank if it matches (or if uploaded single-unit JSON omitted metadata)
        if (currentBank && currentBank.chapters.length > 0) {
          const currentMatches =
            !parsedRes.hasExplicitGradeOrSubject ||
            Boolean(
              pickBestMatchingBankCandidate(
                [
                  {
                    id: currentBank.metadata.id,
                    grade: currentBank.metadata.grade,
                    gradeKey: currentBank.metadata.gradeKey,
                    subject: currentBank.metadata.subject,
                    subjectCode: currentBank.metadata.subjectCode,
                    medium: currentBank.metadata.medium,
                    totalChapters: currentBank.chapters.length,
                    totalQuestions: currentBank.chapters.reduce((s, c) => s + (c.questions?.length || 0), 0),
                  },
                ],
                bank
              )
            );
          if (
            currentMatches &&
            (!existingFull || currentBank.chapters.length > existingFull.chapters.length)
          ) {
            existingFull = currentBank;
            existingId = currentBank.metadata.id || existingId;
          }
        }

        if (existingFull && existingFull.chapters?.length > 0) {
          const { mergedBank } = smartMergeQuestionBanks(existingFull, bank);
          bank = ensureUniqueQuestionIds({
            ...mergedBank,
            metadata: {
              ...mergedBank.metadata,
              id: existingFull.metadata.id || existingId,
              gradeKey: resolvedGradeKey,
              grade: canonicalGradeLabel(resolvedGradeKey),
              subjectCode: resolvedSubjectCode,
            },
          });
        } else {
          bank = ensureUniqueQuestionIds(bank);
        }

        // Persist permanently to Server + Firebase
        const [serverRes, fbRes] = await Promise.allSettled([
          fetch('/api/save-question-bank', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ questionBank: bank }),
          }).then(async r => {
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            return r.json();
          }),
          saveQuestionBankToFirebase(bank),
        ]);

        const persistedId =
          (serverRes.status === 'fulfilled' && serverRes.value?.entry?.id) ||
          (fbRes.status === 'fulfilled' && fbRes.value) ||
          bank.metadata.id ||
          `imported_${Date.now()}`;

        const entry: IndexEntry =
          serverRes.status === 'fulfilled' && serverRes.value?.entry
            ? serverRes.value.entry
            : {
                id: persistedId,
                path: `firebase://${persistedId}`,
                grade: canonicalGradeLabel(resolvedGradeKey),
                gradeKey: resolvedGradeKey,
                subject: bank.metadata.subject,
                subjectCode: resolvedSubjectCode,
                medium: bank.metadata.medium || 'ಕನ್ನಡ ಮಾಧ್ಯಮ (State Syllabus)',
                academicYear: String(bank.metadata.academicYear || '2026-27'),
                totalChapters: bank.chapters.length,
                totalQuestions: bank.chapters.reduce((s, c) => s + (c.questions?.length || 0), 0),
                isUserGenerated: true,
              };

        const finalBank: QuestionBank = {
          ...bank,
          metadata: { ...bank.metadata, id: entry.id },
        };

        registerCustomBank(finalBank, entry);
        setAvailableFiles(prev => {
          const exists = prev.some(f => f.id === entry.id);
          return exists ? prev.map(f => (f.id === entry.id ? entry : f)) : [entry, ...prev];
        });
        setGrade(canonicalGradeLabel(resolvedGradeKey));
        setSelectedFileId(entry.id);
        setCurrentBank(finalBank);
        setSelectedChapterIds(finalBank.chapters.map(c => c.chapterId));
      } catch (err: any) {
        console.error('JSON import error:', err);
        setLoadError(`JSON ಫೈಲ್ ಅಪ್‌ಲೋಡ್ ದೋಷ: ${err?.message || 'ಅಮಾನ್ಯ JSON ಫೈಲ್'}`);
      } finally {
        setIsImportingJson(false);
      }
    },
    [availableFiles, currentBank]
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50/75 via-teal-50/35 to-sky-50/65 flex flex-col font-kannada antialiased text-slate-900">
      
      {/* Strict 3-Zone Institutional TopBar */}
      <TopBar
        schoolName={schoolName}
        userRole={userSession ? (isAdmin ? 'admin' : 'teacher') : null}
        userEmail={userSession?.email}
        onLogout={handleLogout}
        activeView={activeView}
        setActiveView={setActiveView}
        hasGeneratedPaper={Boolean(generatedPaper)}
        onOpenJsonGuide={isAdmin ? () => setIsJsonGuideOpen(true) : undefined}
      />

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
        
        {/* Error Notification */}
        {generationError && (
          <div className="mb-5 p-4 bg-rose-50 border border-rose-200 rounded-xl text-rose-900 flex items-start gap-3 no-print">
            <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
            <div className="flex-1 text-xs sm:text-sm">
              <strong className="font-bold block mb-1">ಪ್ರಶ್ನೆಗಳ ಕೊರತೆ (Notice):</strong>
              <div className="whitespace-pre-line text-rose-800 leading-relaxed">{generationError}</div>
            </div>
            <button
              type="button"
              onClick={() => setGenerationError(null)}
              className="text-rose-500 hover:text-rose-800 p-1 rounded cursor-pointer"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {loadError && activeView !== 'home' && (
          <div className="mb-5 p-4 bg-amber-50 border border-amber-200 rounded-xl text-amber-900 flex flex-wrap items-center justify-between gap-3 no-print">
            <div className="flex items-start gap-3 flex-1">
              <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
              <div className="text-xs sm:text-sm font-semibold">{loadError}</div>
            </div>
            <button
              type="button"
              onClick={loadInitialBank}
              disabled={isLoadingBank}
              className="px-3.5 py-1.5 text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 disabled:opacity-50 rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoadingBank ? 'animate-spin' : ''}`} />
              <span>ಪುನಃ ಪ್ರಯತ್ನಿಸಿ</span>
            </button>
          </div>
        )}

        {/* VIEW 0: Professional Home Page (School Registration + Guide + Pre-Login Online Test) */}
        {activeView === 'home' && (
          <HomePortalView
            defaultSchoolName={schoolName}
            defaultMedium={medium}
            totalSubjectsCount={availableFiles.length}
            onAuthenticated={handleAuthenticated}
            onOpenOnlineTest={() => setActiveView('online_test')}
          />
        )}

        {/* VIEW 1: Generator Setup Dashboard (Logged-in Teachers & Verified Admin) */}
        {userSession && activeView === 'setup' && (
          <div className="space-y-5">
            {/* Colorful Registered School Context Header */}
            <div className="bg-gradient-to-r from-emerald-50 via-white to-sky-50 border border-emerald-200 rounded-2xl px-4 py-3.5 shadow-2xs flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-600 to-teal-700 text-white flex items-center justify-center shrink-0 shadow-xs">
                  {isAdmin ? (
                    <ShieldCheck className="w-5 h-5 text-amber-300" />
                  ) : (
                    <Building2 className="w-5 h-5 text-amber-200" />
                  )}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-extrabold text-emerald-950 truncate">
                      {schoolName}
                    </span>
                    <span className="text-xs text-emerald-400">·</span>
                    <span className="text-xs font-semibold text-teal-800 truncate">
                      {userSession.teacherName || userSession.email}
                    </span>
                  </div>
                  <p className="text-xs text-slate-600 mt-0.5">
                    {isAdmin
                      ? 'ಅಡ್ಮಿನ್ ಮೋಡ್: ಪ್ರಶ್ನೆ ಪತ್ರಿಕೆ ರಚನೆ, ಪ್ರಶ್ನೆ ಭಂಡಾರ, AI JSON ಮತ್ತು 6–10ನೇ ತರಗತಿ ಚಿತ್ರಗಳ ನಿರ್ವಹಣೆ ಲಭ್ಯವಿದೆ.'
                      : 'ತರಗತಿ, ವಿಷಯ, ಪಾಠಗಳು, ಪ್ರಶ್ನೆಗಳ ಸಂಖ್ಯೆ, ಅಂಕಗಳು ಮತ್ತು ಪ್ರಶ್ನೆ ಪ್ರಕಾರಗಳನ್ನು ಆಯ್ಕೆ ಮಾಡಿ ಪ್ರಶ್ನೆ ಪತ್ರಿಕೆ ಹಾಗೂ ನೀಲನಕಾಶೆ ರಚಿಸಿ.'}
                  </p>
                </div>
              </div>

              {isAdmin && (
                <button
                  type="button"
                  onClick={() => setActiveView('explorer')}
                  className="px-3.5 py-2 text-xs font-bold text-white bg-indigo-700 hover:bg-indigo-800 rounded-xl transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap shadow-xs"
                >
                  <ImageIcon className="w-3.5 h-3.5" />
                  <span>6ನೇ ತರಗತಿ / ಎಲ್ಲಾ ವಿಷಯಗಳ ಚಿತ್ರ ನಿರ್ವಹಣೆ</span>
                </button>
              )}
            </div>

            {/* Custom Sections Active Banner */}
            {customSections && customSections.length > 0 && (
              <div className="px-4 py-3 bg-indigo-50/70 border border-indigo-200 rounded-xl flex flex-wrap items-center justify-between gap-3 text-xs font-semibold text-indigo-950">
                <div className="flex items-center gap-2">
                  <Sliders className="w-4 h-4 text-indigo-700 shrink-0" />
                  <span className="tabular-nums">
                    ವಿಶೇಷ ವಿಭಾಗಗಳ ಹೊಂದಾಣಿಕೆ ಸಕ್ರಿಯವಾಗಿದೆ:{' '}
                    <strong className="text-indigo-800">{customSections.length} ವಿಭಾಗಗಳು</strong> ·{' '}
                    <strong className="text-indigo-800">{targetQuestionsCount} ಪ್ರಶ್ನೆಗಳು</strong> ·{' '}
                    <strong className="text-emerald-800">{targetMarks} ಅಂಕಗಳು</strong>
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setIsSectionConfigOpen(true)}
                    className="px-2.5 py-1 bg-white hover:bg-indigo-100 text-indigo-800 rounded-lg border border-indigo-200 transition-colors cursor-pointer whitespace-nowrap"
                  >
                    ಬದಲಾಯಿಸಿ
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setCustomSections(null);
                      setTargetMarks(40);
                      setTargetQuestionsCount(24);
                    }}
                    className="px-2.5 py-1 bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 rounded-lg transition-colors cursor-pointer whitespace-nowrap"
                  >
                    ಮರುಹೊಂದಿಸಿ
                  </button>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              {/* Left Column: 1. ಪರೀಕ್ಷಾ ವಿವರಗಳು (Setup) */}
              <div className="lg:col-span-4">
                <SetupPanel
                  schoolName={schoolName}
                  setSchoolName={setSchoolName}
                  medium={medium}
                  setMedium={setMedium}
                  grade={grade}
                  setGrade={handleGradeChange}
                  selectedFileId={selectedFileId}
                  setSelectedFileId={handleSelectFile}
                  availableFiles={availableFiles}
                  semesterPart={semesterPart}
                  setSemesterPart={handleSemesterPartChange}
                  paperModel={paperModel}
                  setPaperModel={setPaperModel}
                  examType={examType}
                  setExamType={handleExamTypeChange}
                  targetMarks={targetMarks}
                  setTargetMarks={setTargetMarks}
                  targetQuestionsCount={targetQuestionsCount}
                  setTargetQuestionsCount={setTargetQuestionsCount}
                  examDateOrYear={examDateOrYear}
                  setExamDateOrYear={setExamDateOrYear}
                  onGenerate={handleGeneratePaper}
                  onFreshSet={handleGeneratePaper}
                  isGenerating={isGenerating}
                  onViewBlueprint={handleOpenBlueprint}
                  onOpenSectionConfig={() => setIsSectionConfigOpen(true)}
                  isAdmin={isAdmin}
                  onOpenExplorer={isAdmin ? () => setActiveView('explorer') : undefined}
                  onOpenJsonGuide={isAdmin ? () => setIsJsonGuideOpen(true) : undefined}
                  onOpenAiGenerator={isAdmin ? () => setActiveView('ai_generator') : undefined}
                  onImportJsonFile={isAdmin ? handleImportJsonFile : undefined}
                  isImportingJson={isImportingJson}
                />
              </div>

              {/* Right Column: 2. ಪಾಠಗಳ ಆಯ್ಕೆ + 3. ಪ್ರಶ್ನೆ ಪ್ರಕಾರಗಳು */}
              <div className="lg:col-span-8 space-y-6">
                <ChapterSelectionPanel
                  chapters={visibleChapters}
                  selectedChapterIds={selectedChapterIds}
                  onChangeSelectedChapters={setSelectedChapterIds}
                />

                <QuestionFormatsPanel
                  selectedFormatIds={selectedFormatIds}
                  onChangeSelectedFormats={ids => {
                    setSelectedFormatIds(ids);
                    setCustomSections(null);
                  }}
                  formatQuestionCounts={formatCounts}
                  onOpenSectionConfig={() => setIsSectionConfigOpen(true)}
                  subject={currentBank?.metadata.subject}
                  subjectCode={currentBank?.metadata.subjectCode as string}
                />
              </div>
            </div>
          </div>
        )}

        {/* VIEW 2: Generated Question Paper & Answer Key Preview */}
        {userSession && activeView === 'preview' && generatedPaper && currentBank && (
          <div className="space-y-6">
            {/* Top Toolbar for Preview */}
            <div className="bg-gradient-to-r from-emerald-50 via-white to-sky-50 rounded-2xl border border-emerald-200 p-4 shadow-xs flex flex-wrap items-center justify-between gap-4 no-print font-kannada">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setActiveView('setup')}
                  className="px-3.5 py-2 rounded-xl font-bold text-xs bg-white hover:bg-emerald-100 text-emerald-900 border border-emerald-200 transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                >
                  <ArrowLeft className="w-4 h-4" />
                  <span>ಸೆಟಪ್‌ಗೆ ಹಿಂತಿರುಗಿ</span>
                </button>

                <div className="flex items-center gap-1 bg-emerald-100/70 p-1 rounded-xl text-xs font-bold border border-emerald-200/80">
                  <button
                    type="button"
                    onClick={() => setPreviewSubMode('paper')}
                    className={`px-3 py-1.5 rounded-lg transition-colors cursor-pointer whitespace-nowrap ${
                      previewSubMode === 'paper' ? 'bg-white text-indigo-700 shadow-xs' : 'text-emerald-900'
                    }`}
                  >
                    ಪ್ರಶ್ನೆ ಪತ್ರಿಕೆ ಮಾತ್ರ
                  </button>
                  <button
                    type="button"
                    onClick={() => setPreviewSubMode('answers')}
                    className={`px-3 py-1.5 rounded-lg transition-colors cursor-pointer whitespace-nowrap ${
                      previewSubMode === 'answers' ? 'bg-white text-emerald-700 shadow-xs' : 'text-emerald-900'
                    }`}
                  >
                    ಉತ್ತರ ಪತ್ರಿಕೆ ಮಾತ್ರ
                  </button>
                  <button
                    type="button"
                    onClick={() => setPreviewSubMode('both')}
                    className={`px-3 py-1.5 rounded-lg transition-colors cursor-pointer whitespace-nowrap ${
                      previewSubMode === 'both' ? 'bg-white text-slate-900 shadow-xs' : 'text-emerald-900'
                    }`}
                  >
                    ಎರಡೂ (Both)
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleRegenerate}
                  className="px-3.5 py-2 text-xs font-bold text-sky-900 bg-sky-100 hover:bg-sky-200 border border-sky-300 rounded-xl transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>ಹೊಸ ಸಂಯೋಜನೆ</span>
                </button>

                <button
                  type="button"
                  onClick={() => window.print()}
                  className="px-4 py-2 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-xl transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap shadow-xs"
                >
                  <Printer className="w-4 h-4" />
                  <span>ಮುದ್ರಣ / PDF</span>
                </button>
              </div>
            </div>

            {/* Paper Preview Render */}
            {(previewSubMode === 'paper' || previewSubMode === 'both') && (
              <div className="space-y-4">
                {previewSubMode === 'both' && (
                  <div className="font-bold text-sm text-slate-800 pb-2 border-b border-slate-300 no-print">
                    ೧. ವಿದ್ಯಾರ್ಥಿಗಳ ಪ್ರಶ್ನೆ ಪತ್ರಿಕೆ (Student Question Paper)
                  </div>
                )}
                <PaperPreview
                  paper={generatedPaper}
                  bank={currentBank}
                  onUpdatePaper={setGeneratedPaper}
                  onRegenerate={handleRegenerate}
                  onResetToGenerated={handleResetToGenerated}
                  onBackToSetup={() => setActiveView('setup')}
                />
              </div>
            )}

            {/* Answer Key Render */}
            {(previewSubMode === 'answers' || previewSubMode === 'both') && (
              <div className={`space-y-4 ${previewSubMode === 'both' ? 'mt-12 pt-8 border-t-2 border-slate-300' : ''}`}>
                {previewSubMode === 'both' && (
                  <div className="font-bold text-sm text-emerald-800 pb-2 border-b border-emerald-300 no-print">
                    ೨. ಅಧಿಕೃತ ಕೀಲಿ ಉತ್ತರ ಮತ್ತು ಮೌಲ್ಯಮಾಪನ ಸೂಚಿ (Official Answer Key)
                  </div>
                )}
                <AnswerKeyPreview paper={generatedPaper} />
              </div>
            )}
          </div>
        )}

        {/* VIEW 3: Question Bank Explorer & Diagram Image Manager (STRICTLY ADMIN-ONLY) */}
        {isAdmin && activeView === 'explorer' && currentBank && (
          <div className="space-y-4">
            <div className="no-print">
              <button
                type="button"
                onClick={() => setActiveView('setup')}
                className="px-3.5 py-2 rounded-lg font-bold text-xs bg-white border border-slate-200 hover:bg-slate-50 text-slate-800 transition-colors flex items-center gap-1.5 cursor-pointer"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>ಸೆಟಪ್‌ಗೆ ಹಿಂತಿರುಗಿ</span>
              </button>
            </div>
            <QuestionBankExplorer
              bank={currentBank}
              availableFiles={availableFiles}
              grade={grade}
              setGrade={handleGradeChange}
              medium={medium}
              setMedium={setMedium}
              selectedFileId={selectedFileId}
              onSelectFile={handleSelectFile}
              onUpdateBank={handleUpdateCurrentBank}
              onOpenSavedBank={handleOpenSavedBankInExplorer}
              onDeleteSavedBank={handleDeleteSavedBank}
            />
          </div>
        )}

        {/* VIEW 4: Official 5-Stage Blue Print View */}
        {userSession && activeView === 'blueprint' && activeBlueprint && (
          <BluePrintView
            blueprint={activeBlueprint}
            bank={currentBank}
            paper={generatedPaper}
            onUpdatePaper={setGeneratedPaper}
            onBackToSetup={() => setActiveView('setup')}
            onViewPaper={generatedPaper ? () => setActiveView('preview') : undefined}
          />
        )}

        {/* VIEW 5: AI-Powered JSON Question Bank Generator (STRICTLY ADMIN-ONLY; preserves state while mounted) */}
        {isAdmin && (
          <div style={{ display: activeView === 'ai_generator' ? 'block' : 'none' }}>
            <AiJsonGenerator
              onBackToApp={() => setActiveView('setup')}
              onLoadGeneratedBank={handleLoadGeneratedBank}
              onDeleteSavedBank={handleDeleteSavedBank}
            />
          </div>
        )}

        {/* VIEW 6: Student Online MCQ Test Mode (Accessible BEFORE and AFTER Login) */}
        {activeView === 'online_test' && (
          <OnlineTestView
            availableFiles={availableFiles}
            initialFileId={selectedFileId}
            initialBank={currentBank}
            schoolName={schoolName}
            onBackToSetup={() => setActiveView(userSession ? 'setup' : 'home')}
          />
        )}

      </main>

      {/* JSON File Model & Creation Guide Modal (STRICTLY ADMIN-ONLY) */}
      {isAdmin && (
        <JsonGuideModal
          isOpen={isJsonGuideOpen}
          onClose={() => setIsJsonGuideOpen(false)}
        />
      )}

      {/* Section Configurator Modal (vibhagavaru prashnegalannu hondisuva option) */}
      {userSession && (
        <SectionConfigModal
          isOpen={isSectionConfigOpen}
          onClose={() => setIsSectionConfigOpen(false)}
          sections={
            customSections ||
            (currentBank
              ? buildBlueprintsFromSelectedFormats(
                  currentBank,
                  selectedFormatIds,
                  selectedChapterIds,
                  targetMarks,
                  targetQuestionsCount
                )
              : [])
          }
          targetMarks={targetMarks}
          targetQuestionsCount={targetQuestionsCount}
          onApplySections={(newSections, updatedMarks, updatedCount) => {
            setCustomSections(newSections);
            setTargetMarks(updatedMarks);
            setTargetQuestionsCount(updatedCount);
          }}
        />
      )}

      {/* Saffron (ಕೇಸರಿ) Footer */}
      <footer className="no-print mt-12 py-6 border-t border-orange-500/60 bg-gradient-to-r from-orange-700 via-amber-600 to-orange-700 text-center text-xs text-orange-50 font-kannada shadow-inner">
        <p className="font-extrabold text-white tracking-wide">
          QP GENERATOR BY S R ANGADI
        </p>
        <p className="text-xs text-orange-100 mt-1">
          {schoolName} · ಕರ್ನಾಟಕ ರಾಜ್ಯ ಪಠ್ಯಕ್ರಮ (DSERT LBA ಅಧಿಕೃತ ಪ್ರಶ್ನೆ ಬ್ಯಾಂಕ್‌ಗಳು)
        </p>
      </footer>
    </div>
  );
}
