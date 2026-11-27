/**
 * Student Online MCQ Test Module (ಆನ್‌ಲೈನ್ ಪರೀಕ್ಷಾ ವ್ಯವಸ್ಥೆ)
 * Features:
 * - Student Login via Google Account OR Direct Email ID
 * - Strict MCQ-only filtering across all grades, subjects, and chapters
 * - Student choice of Grade, Subject, Chapters (with exact MCQ counts), and Number of Questions
 * - Interactive MCQ exam runner with timer, MathText formula support, diagrams, and question palette
 * - Instant on-spot result evaluation with detailed solved Q&A review
 * - Automatic Email copy of solved questions & answers sent to student's email ID (+ Mailto & Print/PDF fallback)
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import {
  Mail,
  User as UserIcon,
  LogOut,
  CheckCircle2,
  XCircle,
  MinusCircle,
  Clock,
  BookOpen,
  Play,
  ArrowLeft,
  ArrowRight,
  Send,
  Printer,
  RotateCcw,
  Check,
  AlertCircle,
  History,
  Shuffle,
  Loader2,
  ChevronDown,
  ChevronUp,
  Layers,
  Award,
} from 'lucide-react';
import { IndexEntry, QuestionBank } from '../types/questionBank.ts';
import {
  loadQuestionBankByPath,
  canonicalGradeLabel,
  extractGradeKey,
} from '../services/dataLoader.ts';
import { ResilientQuestionImage } from './ResilientQuestionImage.tsx';
import {
  auth,
  signInStudentWithGoogle,
  signOutStudent,
  saveOnlineTestAttemptToFirebase,
  getStudentOnlineTestAttemptsFromFirebase,
  OnlineTestAttemptRecord,
  OnlineTestSolvedItem,
} from '../services/firebase.ts';
import {
  OnlineTestMcqQuestion,
  getChapterMcqStats,
  extractMcqQuestionsFromBank,
  shuffleArray,
  stripOptionPrefix,
  getOptionLabel,
  formatDurationMMSS,
} from '../utils/mcqGrading.ts';
import { MathText } from './MathText.tsx';
import { VisualSelectionFlow, SelectionStep } from './VisualSelectionFlow.tsx';
import {
  BankDynamicStats,
  SemesterSelection,
  filterChaptersBySemester,
  getSemesterPeriodMeta,
  useDynamicBankStats,
} from '../utils/bankStats.ts';

interface StudentSession {
  uid: string;
  name: string;
  email: string;
  authMethod: 'google' | 'email' | 'guest';
}

interface OnlineTestViewProps {
  availableFiles: IndexEntry[];
  initialFileId: string;
  initialBank: QuestionBank | null;
  schoolName: string;
  onBackToSetup: () => void;
  sharedBankStats?: Record<string, BankDynamicStats>;
  isScanningStats?: boolean;
}

type TestStage = 'setup' | 'running' | 'result';

interface EmailDeliveryState {
  status: 'idle' | 'sending' | 'sent' | 'not_configured' | 'error';
  message: string;
  provider?: string;
}

const STUDENT_SESSION_STORAGE_KEY = 'qpg_online_test_student_session_v1';
const LOCAL_HISTORY_PREFIX = 'qpg_online_test_history_v1_';
const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

function isSafeImageSrc(url?: string): boolean {
  if (!url) return false;
  const trimmed = url.trim();
  return (
    trimmed.startsWith('/api/') ||
    trimmed.startsWith('data:image/') ||
    trimmed.startsWith('https://') ||
    trimmed.startsWith('http://')
  );
}

function readLocalHistory(email: string): OnlineTestAttemptRecord[] {
  try {
    const raw = localStorage.getItem(`${LOCAL_HISTORY_PREFIX}${email.toLowerCase()}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveLocalHistory(email: string, attempt: OnlineTestAttemptRecord): OnlineTestAttemptRecord[] {
  const existing = readLocalHistory(email).filter(a => a.id !== attempt.id);
  const next = [attempt, ...existing].slice(0, 25);
  try {
    localStorage.setItem(`${LOCAL_HISTORY_PREFIX}${email.toLowerCase()}`, JSON.stringify(next));
  } catch {
    // Ignore storage quota errors
  }
  return next;
}

function getPerformanceFeedback(percentage: number): {
  titleKn: string;
  titleEn: string;
  toneClass: string;
} {
  if (percentage >= 85) {
    return {
      titleKn: 'ಅತ್ಯುತ್ತಮ ಸಾಧನೆ!',
      titleEn: 'Outstanding Performance',
      toneClass: 'text-emerald-800 bg-emerald-50 border-emerald-200',
    };
  }
  if (percentage >= 65) {
    return {
      titleKn: 'ತುಂಬಾ ಚೆನ್ನಾಗಿದೆ!',
      titleEn: 'Very Good Effort',
      toneClass: 'text-amber-900 bg-amber-50 border-amber-200',
    };
  }
  if (percentage >= 40) {
    return {
      titleKn: 'ಒಳ್ಳೆಯ ಪ್ರಯತ್ನ — ಇನ್ನಷ್ಟು ಅಭ್ಯಾಸ ಮಾಡಿ',
      titleEn: 'Good Attempt — Keep Practicing',
      toneClass: 'text-orange-900 bg-orange-50 border-orange-200',
    };
  }
  return {
    titleKn: 'ಮತ್ತೆ ಅಭ್ಯಾಸ ಮಾಡಿ ಪ್ರಯತ್ನಿಸಿ',
    titleEn: 'Needs More Practice',
    toneClass: 'text-rose-800 bg-rose-50 border-rose-200',
  };
}

function buildMailtoHref(attempt: OnlineTestAttemptRecord, schoolName: string): string {
  const subject = `ಆನ್‌ಲೈನ್ ಪರೀಕ್ಷಾ ಫಲಿತಾಂಶ (${attempt.score}/${attempt.totalQuestions} - ${attempt.percentage}%) | ${attempt.subject}`;
  const headerLines = [
    `${schoolName}`,
    `ವಿದ್ಯಾರ್ಥಿ: ${attempt.studentName} (${attempt.studentEmail})`,
    `ತರಗತಿ: ${attempt.grade} | ವಿಷಯ: ${attempt.subject}`,
    `ಅಂಕಗಳು: ${attempt.score} / ${attempt.totalQuestions} (${attempt.percentage}%)`,
    `ಸರಿ: ${attempt.correctCount} | ತಪ್ಪು: ${attempt.wrongCount} | ಉತ್ತರಿಸಿಲ್ಲ: ${attempt.unansweredCount} | ಸಮಯ: ${formatDurationMMSS(attempt.timeTakenSeconds)}`,
    '',
    '--- ಬಿಡಿಸಿದ ಪ್ರಶ್ನೆಗಳು ಮತ್ತು ಉತ್ತರಗಳು ---',
  ];

  const qLines: string[] = [];
  for (let i = 0; i < attempt.items.length; i++) {
    const item = attempt.items[i];
    const mark = item.isCorrect ? '✓ ಸರಿ' : item.isUnanswered ? '— ಉತ್ತರಿಸಿಲ್ಲ' : '✕ ತಪ್ಪು';
    const block = [
      `${i + 1}. ${item.question}`,
      `   ನಿಮ್ಮ ಉತ್ತರ: ${item.selectedOption || 'ಉತ್ತರಿಸಿಲ್ಲ'} (${mark})`,
      `   ಸರಿಯಾದ ಉತ್ತರ: ${item.correctOption}`,
    ].join('\n');
    // Keep mailto body safely within browser URL length limits (~1800 chars encoded)
    if (headerLines.join('\n').length + qLines.join('\n\n').length + block.length > 1350) {
      qLines.push(`... (ಒಟ್ಟು ${attempt.items.length} ಪ್ರಶ್ನೆಗಳಲ್ಲಿ ಉಳಿದ ಪ್ರಶ್ನೆಗಳಿಗಾಗಿ PDF ಮುದ್ರಣ ಆಯ್ಕೆ ಬಳಸಿ)`);
      break;
    }
    qLines.push(block);
  }

  const body = [...headerLines, ...qLines].join('\n');
  return `mailto:${encodeURIComponent(attempt.studentEmail)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export const OnlineTestView: React.FC<OnlineTestViewProps> = ({
  availableFiles,
  initialFileId,
  initialBank,
  schoolName,
  onBackToSetup,
  sharedBankStats,
  isScanningStats: sharedScanning,
}) => {
  // ── Student Authentication State ──
  const [student, setStudent] = useState<StudentSession | null>(() => {
    try {
      const saved = sessionStorage.getItem(STUDENT_SESSION_STORAGE_KEY);
      if (saved) return JSON.parse(saved) as StudentSession;
    } catch {
      // ignore
    }
    return null;
  });
  const [loginName, setLoginName] = useState<string>('');
  const [loginEmail, setLoginEmail] = useState<string>('');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [isGoogleSigningIn, setIsGoogleSigningIn] = useState<boolean>(false);
  const [showOptionalProfileForm, setShowOptionalProfileForm] = useState<boolean>(false);
  const [resultEmailInput, setResultEmailInput] = useState<string>('');
  const [resultEmailError, setResultEmailError] = useState<string | null>(null);

  // Sync Firebase Auth user automatically if already signed in with Google
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, user => {
      if (user && user.email) {
        const session: StudentSession = {
          uid: user.uid,
          name: user.displayName || user.email.split('@')[0] || 'Student',
          email: user.email.toLowerCase(),
          authMethod: 'google',
        };
        setStudent(session);
        try {
          sessionStorage.setItem(STUDENT_SESSION_STORAGE_KEY, JSON.stringify(session));
        } catch {
          // ignore
        }
      }
    });
    return () => unsub();
  }, []);

  // ── Test Configuration & Progressive Card Step State ──
  const [stage, setStage] = useState<TestStage>('setup');
  const [selectionStep, setSelectionStep] = useState<SelectionStep>('semester');
  const [selectedSemester, setSelectedSemester] = useState<SemesterSelection>('all');
  const [selectedGradeKey, setSelectedGradeKey] = useState<string>(() => {
    const initEntry = availableFiles.find(f => f.id === initialFileId);
    return extractGradeKey(initEntry?.gradeKey || initEntry?.grade || initialBank?.metadata?.grade || '6');
  });
  const [selectedBankId, setSelectedBankId] = useState<string>(initialFileId || availableFiles[0]?.id || '');
  const [activeBank, setActiveBank] = useState<QuestionBank | null>(initialBank);
  const [isLoadingBank, setIsLoadingBank] = useState<boolean>(false);
  const [bankLoadError, setBankLoadError] = useState<string | null>(null);
  const [selectedChapterIds, setSelectedChapterIds] = useState<string[]>([]);
  const [questionCount, setQuestionCount] = useState<number>(10);
  const [shuffleQuestions, setShuffleQuestions] = useState<boolean>(true);
  const [configError, setConfigError] = useState<string | null>(null);

  // Dynamic bank stats fallback if not passed from App
  const localStatsHook = useDynamicBankStats(
    sharedBankStats ? [] : availableFiles,
    activeBank,
    selectedBankId
  );
  const effectiveStatsMap = sharedBankStats || localStatsHook.statsMap;
  const effectiveIsScanning = sharedScanning ?? localStatsHook.isScanning;

  // ── Active Exam State ──
  const [testQuestions, setTestQuestions] = useState<OnlineTestMcqQuestion[]>([]);
  const [answersMap, setAnswersMap] = useState<Record<string, number>>({});
  const [currentIdx, setCurrentIdx] = useState<number>(0);
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(0);
  const [showSubmitConfirm, setShowSubmitConfirm] = useState<boolean>(false);
  const [showExitConfirm, setShowExitConfirm] = useState<boolean>(false);

  // ── Result & Email Delivery State ──
  const [activeAttempt, setActiveAttempt] = useState<OnlineTestAttemptRecord | null>(null);
  const [emailDelivery, setEmailDelivery] = useState<EmailDeliveryState>({
    status: 'idle',
    message: '',
  });
  const [showSmtpHint, setShowSmtpHint] = useState<boolean>(false);
  const [reviewFilter, setReviewFilter] = useState<'all' | 'wrong' | 'correct'>('all');

  // ── Past Attempts History ──
  const [pastAttempts, setPastAttempts] = useState<OnlineTestAttemptRecord[]>([]);
  const [showHistoryPanel, setShowHistoryPanel] = useState<boolean>(false);

  // Load past attempts (works for both guest and signed-in students)
  const refreshHistory = useCallback(async (sess: StudentSession | null) => {
    const historyKey = sess?.email ? sess.email : 'guest_local';
    const localItems = readLocalHistory(historyKey);
    let cloudItems: OnlineTestAttemptRecord[] = [];
    if (sess?.authMethod === 'google' && auth.currentUser) {
      cloudItems = await getStudentOnlineTestAttemptsFromFirebase();
    }
    const mergedMap = new Map<string, OnlineTestAttemptRecord>();
    for (const item of [...cloudItems, ...localItems]) {
      if (!mergedMap.has(item.id)) {
        mergedMap.set(item.id, item);
      }
    }
    const merged = Array.from(mergedMap.values()).sort((a, b) =>
      String(b.submittedAt || '').localeCompare(String(a.submittedAt || ''))
    );
    setPastAttempts(merged);
  }, []);

  useEffect(() => {
    refreshHistory(student);
  }, [student, refreshHistory]);

  // Subjects filtered by selectedGradeKey
  const subjectsForGrade = useMemo(() => {
    return availableFiles.filter(
      f => extractGradeKey(f.gradeKey || f.grade) === selectedGradeKey
    );
  }, [availableFiles, selectedGradeKey]);

  // Ensure selectedBankId stays valid when grade changes
  useEffect(() => {
    if (subjectsForGrade.length === 0) return;
    if (!subjectsForGrade.some(f => f.id === selectedBankId)) {
      setSelectedBankId(subjectsForGrade[0].id);
    }
  }, [subjectsForGrade, selectedBankId]);

  // Load selected question bank dynamically
  useEffect(() => {
    let cancelled = false;
    async function loadBank() {
      if (!selectedBankId) {
        setActiveBank(null);
        return;
      }
      if (selectedBankId === initialFileId && initialBank) {
        setActiveBank(initialBank);
        setBankLoadError(null);
        return;
      }
      const entry = availableFiles.find(f => f.id === selectedBankId);
      if (!entry) return;
      try {
        setIsLoadingBank(true);
        setBankLoadError(null);
        const loaded = await loadQuestionBankByPath(entry.path);
        if (!cancelled) {
          setActiveBank(loaded);
        }
      } catch (err: any) {
        if (!cancelled) {
          setBankLoadError(err?.message || 'ಪ್ರಶ್ನೆ ಭಂಡಾರವನ್ನು ಲೋಡ್ ಮಾಡಲು ಸಾಧ್ಯವಾಗಲಿಲ್ಲ.');
          setActiveBank(null);
        }
      } finally {
        if (!cancelled) setIsLoadingBank(false);
      }
    }
    loadBank();
    return () => {
      cancelled = true;
    };
  }, [selectedBankId, initialFileId, initialBank, availableFiles]);

  // Filter activeBank chapters by selected semester so counts match Subject cards 1:1
  const semesterFilteredBank = useMemo<QuestionBank | null>(() => {
    if (!activeBank) return null;
    if (selectedSemester === 'all') return activeBank;
    const filteredChapters = filterChaptersBySemester(activeBank.chapters, selectedSemester);
    return {
      ...activeBank,
      chapters: filteredChapters,
    };
  }, [activeBank, selectedSemester]);

  // Compute strict per-chapter MCQ stats for the active semester
  const chapterStats = useMemo(
    () => getChapterMcqStats(semesterFilteredBank),
    [semesterFilteredBank]
  );

  const chaptersWithMcqs = useMemo(
    () => chapterStats.filter(c => c.mcqCount > 0),
    [chapterStats]
  );

  // Auto-select all chapters with MCQs whenever activeBank or selectedSemester changes
  useEffect(() => {
    const validIds = chaptersWithMcqs.map(c => c.chapterId);
    setSelectedChapterIds(validIds);
    setConfigError(null);
  }, [semesterFilteredBank, chaptersWithMcqs]);

  // Pool of strict MCQs matching selected chapters
  const availableMcqPool = useMemo(
    () => extractMcqQuestionsFromBank(semesterFilteredBank, selectedChapterIds),
    [semesterFilteredBank, selectedChapterIds]
  );

  // Clamp questionCount when pool size changes
  useEffect(() => {
    if (availableMcqPool.length === 0) return;
    setQuestionCount(prev => {
      if (prev <= 0) return Math.min(10, availableMcqPool.length);
      return Math.min(prev, availableMcqPool.length);
    });
  }, [availableMcqPool.length]);

  // Live exam timer
  useEffect(() => {
    if (stage !== 'running') return;
    const timer = window.setInterval(() => {
      setElapsedSeconds(prev => prev + 1);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [stage]);

  // ── Auth Handlers ──
  const handleGoogleLogin = async () => {
    setLoginError(null);
    setIsGoogleSigningIn(true);
    try {
      const user = await signInStudentWithGoogle();
      if (!user.email) {
        setLoginError('Google ಖಾತೆಯಲ್ಲಿ ಇಮೇಲ್ ವಿಳಾಸ ಲಭ್ಯವಿಲ್ಲ. ದಯವಿಟ್ಟು ಕೆಳಗೆ ಇಮೇಲ್ ನಮೂದಿಸಿ.');
        return;
      }
      const session: StudentSession = {
        uid: user.uid,
        name: user.displayName || user.email.split('@')[0] || 'Student',
        email: user.email.toLowerCase(),
        authMethod: 'google',
      };
      setStudent(session);
      sessionStorage.setItem(STUDENT_SESSION_STORAGE_KEY, JSON.stringify(session));
    } catch (err: any) {
      const code = err?.code || '';
      if (code === 'auth/popup-closed-by-user') {
        setLoginError('Google ಲಾಗಿನ್ ಪಾಪ್-ಅಪ್ ಮುಚ್ಚಲಾಗಿದೆ. ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ ಅಥವಾ ಕೆಳಗೆ ಇಮೇಲ್ ನಮೂದಿಸಿ.');
      } else {
        setLoginError('Google ಲಾಗಿನ್ ವಿಫಲವಾಗಿದೆ. ನೀವು ಕೆಳಗಿನ ಇಮೇಲ್ ಐಡಿ ಫಾರ್ಮ್ ಬಳಸಿ ನೇರವಾಗಿ ಲಾಗಿನ್ ಆಗಬಹುದು.');
      }
    } finally {
      setIsGoogleSigningIn(false);
    }
  };

  const handleDirectEmailLogin = (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(null);
    const trimmedName = loginName.trim();
    const trimmedEmail = loginEmail.trim().toLowerCase();
    if (trimmedEmail && !EMAIL_REGEX.test(trimmedEmail)) {
      setLoginError('ಇಮೇಲ್ ವಿಳಾಸ ನಮೂದಿಸಿದರೆ ಸರಿಯಾದ ಇಮೇಲ್ ನೀಡಿ (ಉದಾ: student@gmail.com) ಅಥವಾ ಖಾಲಿ ಬಿಡಿ.');
      return;
    }
    if (!trimmedName && !trimmedEmail) {
      setShowOptionalProfileForm(false);
      return;
    }
    const session: StudentSession = {
      uid: trimmedEmail ? 'email_guest' : 'guest',
      name: trimmedName || 'ವಿದ್ಯಾರ್ಥಿ',
      email: trimmedEmail,
      authMethod: trimmedEmail ? 'email' : 'guest',
    };
    setStudent(session);
    setShowOptionalProfileForm(false);
    try {
      sessionStorage.setItem(STUDENT_SESSION_STORAGE_KEY, JSON.stringify(session));
    } catch {
      // ignore
    }
  };

  const handleStudentLogout = async () => {
    try {
      await signOutStudent();
    } catch {
      // ignore
    }
    sessionStorage.removeItem(STUDENT_SESSION_STORAGE_KEY);
    setStudent(null);
    setStage('setup');
    setActiveAttempt(null);
    setTestQuestions([]);
    setAnswersMap({});
  };

  // ── Chapter Toggle Handlers ──
  const toggleChapter = (chapterId: string) => {
    setSelectedChapterIds(prev =>
      prev.includes(chapterId)
        ? prev.filter(id => id !== chapterId)
        : [...prev, chapterId]
    );
    setConfigError(null);
  };

  const selectAllMcqChapters = () => {
    setSelectedChapterIds(chaptersWithMcqs.map(c => c.chapterId));
    setConfigError(null);
  };

  const clearAllChapters = () => {
    setSelectedChapterIds([]);
    setConfigError(null);
  };

  // ── Start Online MCQ Test ──
  const handleStartTest = () => {
    setConfigError(null);
    if (!activeBank) {
      setConfigError('ದಯವಿಟ್ಟು ಮೊದಲು ವಿಷಯವನ್ನು ಆಯ್ಕೆಮಾಡಿ.');
      return;
    }
    if (selectedChapterIds.length === 0) {
      setConfigError('ಕನಿಷ್ಠ ಒಂದು ಪಾಠವನ್ನು ಆಯ್ಕೆಮಾಡಿ.');
      return;
    }
    if (availableMcqPool.length === 0) {
      setConfigError('ಆಯ್ಕೆಮಾಡಿದ ಪಾಠಗಳಲ್ಲಿ ಬಹು ಆಯ್ಕೆ (MCQ) ಪ್ರಶ್ನೆಗಳು ಲಭ್ಯವಿಲ್ಲ.');
      return;
    }

    const desiredCount = Math.max(1, Math.min(questionCount, availableMcqPool.length, 100));
    const orderedPool = shuffleQuestions ? shuffleArray(availableMcqPool) : [...availableMcqPool];
    const picked = orderedPool.slice(0, desiredCount);

    setTestQuestions(picked);
    setAnswersMap({});
    setCurrentIdx(0);
    setElapsedSeconds(0);
    setShowSubmitConfirm(false);
    setShowExitConfirm(false);
    setActiveAttempt(null);
    setEmailDelivery({ status: 'idle', message: '' });
    setReviewFilter('all');
    setStage('running');
  };

  // ── Send Result + Solved Q&A Report Email ──
  const dispatchResultEmail = useCallback(
    async (attempt: OnlineTestAttemptRecord) => {
      setEmailDelivery({
        status: 'sending',
        message: `${attempt.studentEmail} ವಿಳಾಸಕ್ಕೆ ಫಲಿತಾಂಶ ಮತ್ತು ಉತ್ತರ ಪತ್ರಿಕೆಯ ಪ್ರತಿ ಕಳುಹಿಸಲಾಗುತ್ತಿದೆ...`,
      });
      try {
        const res = await fetch('/api/online-test/send-report', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            studentName: attempt.studentName,
            studentEmail: attempt.studentEmail,
            schoolName,
            grade: attempt.grade,
            subject: attempt.subject,
            chapters: attempt.chapters,
            score: attempt.score,
            totalQuestions: attempt.totalQuestions,
            correctCount: attempt.correctCount,
            wrongCount: attempt.wrongCount,
            unansweredCount: attempt.unansweredCount,
            percentage: attempt.percentage,
            timeTakenSeconds: attempt.timeTakenSeconds,
            items: attempt.items.map(item => ({
              chapterName: item.chapterName,
              question: item.question,
              selectedOption: item.selectedOption,
              correctOption: item.correctOption,
              isCorrect: item.isCorrect,
              isUnanswered: item.isUnanswered,
              explanation: item.explanation || '',
            })),
          }),
        });
        const data = await res.json();
        if (data?.emailSent) {
          setEmailDelivery({
            status: 'sent',
            provider: data.provider,
            message:
              data.message ||
              `ನಿಮ್ಮ ಇಮೇಲ್ (${attempt.studentEmail}) ಗೆ ಫಲಿತಾಂಶ ಮತ್ತು ಉತ್ತರ ಪತ್ರಿಕೆಯ ಪ್ರತಿ ಕಳುಹಿಸಲಾಗಿದೆ.`,
          });
          return true;
        }
        if (data?.reason === 'not_configured') {
          setEmailDelivery({
            status: 'not_configured',
            message:
              data.message ||
              'ಸ್ವಯಂಚಾಲಿತ ಇಮೇಲ್ ಕಳುಹಿಸುವ ಸೇವೆ ಇನ್ನೂ ಕಾನ್ಫಿಗರ್ ಆಗಿಲ್ಲ. ಕೆಳಗಿನ "ಇಮೇಲ್ ಆ್ಯಪ್‌ನಲ್ಲಿ ಕಳುಹಿಸಿ" ಅಥವಾ "PDF ಉಳಿಸಿ" ಬಟನ್ ಬಳಸಿ.',
          });
          return false;
        }
        setEmailDelivery({
          status: 'error',
          message:
            data?.error ||
            'ಇಮೇಲ್ ಕಳುಹಿಸುವಾಗ ದೋಷ ಸಂಭವಿಸಿದೆ. ದಯವಿಟ್ಟು ಮರುಪ್ರಯತ್ನಿಸಿ ಅಥವಾ ಕೆಳಗಿನ ಇಮೇಲ್ ಆ್ಯಪ್ / PDF ಆಯ್ಕೆ ಬಳಸಿ.',
        });
        return false;
      } catch {
        setEmailDelivery({
          status: 'error',
          message: 'ಸರ್ವರ್ ಸಂಪರ್ಕಿಸಲು ಸಾಧ್ಯವಾಗಲಿಲ್ಲ. ದಯವಿಟ್ಟು ಕೆಳಗಿನ ಇಮೇಲ್ ಆ್ಯಪ್ ಅಥವಾ ಮುದ್ರಣ ಆಯ್ಕೆ ಬಳಸಿ.',
        });
        return false;
      }
    },
    [schoolName]
  );

  // ── Submit Test & Grade Instantly (Works with or without Name/Email!) ──
  const finalizeAndSubmitTest = async () => {
    if (!activeBank || testQuestions.length === 0) return;

    const effectiveName = student?.name?.trim() || loginName.trim() || 'ವಿದ್ಯಾರ್ಥಿ (Guest)';
    const rawEmail = (student?.email || loginEmail || '').trim().toLowerCase();
    const effectiveEmail = EMAIL_REGEX.test(rawEmail) ? rawEmail : '';
    const effectiveUid = student?.uid || 'guest';

    let correctCount = 0;
    let wrongCount = 0;
    let unansweredCount = 0;

    const solvedItems: OnlineTestSolvedItem[] = testQuestions.map(q => {
      const selectedIdx = answersMap[q.id] ?? -1;
      const isUnanswered = selectedIdx < 0 || selectedIdx >= q.cleanOptions.length;
      const isCorrect = !isUnanswered && selectedIdx === q.correctOptionIndex;

      if (isUnanswered) {
        unansweredCount += 1;
      } else if (isCorrect) {
        correctCount += 1;
      } else {
        wrongCount += 1;
      }

      const selectedOption = isUnanswered ? '' : q.cleanOptions[selectedIdx];
      return {
        questionId: q.id,
        chapterName: q.chapterName,
        question: q.question,
        options: q.cleanOptions,
        selectedOptionIndex: selectedIdx,
        selectedOption,
        correctOptionIndex: q.correctOptionIndex,
        correctOption: q.correctOptionText,
        isCorrect,
        isUnanswered,
        explanation: q.explanationText || '',
        imageUrl: isSafeImageSrc(q.imageUrl) ? q.imageUrl : '',
        imageUrl2: isSafeImageSrc(q.imageUrl2) ? q.imageUrl2 : '',
        answerImageUrl: isSafeImageSrc(q.answerImageUrl) ? q.answerImageUrl : '',
        answerImageUrl2: isSafeImageSrc(q.answerImageUrl2) ? q.answerImageUrl2 : '',
      };
    });

    const totalQuestions = solvedItems.length;
    const percentage = Math.round((correctCount / totalQuestions) * 100);
    const chapterNames = Array.from(new Set(testQuestions.map(q => q.chapterName)));

    const attempt: OnlineTestAttemptRecord = {
      id: `test_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      studentUid: effectiveUid,
      studentName: effectiveName,
      studentEmail: effectiveEmail,
      grade: activeBank.metadata.grade || canonicalGradeLabel(selectedGradeKey),
      subject: activeBank.metadata.subject || 'ವಿಷಯ',
      chapters: chapterNames,
      score: correctCount,
      totalQuestions,
      correctCount,
      wrongCount,
      unansweredCount,
      percentage,
      timeTakenSeconds: elapsedSeconds,
      emailSent: false,
      items: solvedItems,
      submittedAt: new Date().toISOString(),
    };

    // Show immediate on-spot results right away
    setActiveAttempt(attempt);
    setResultEmailInput(effectiveEmail);
    setResultEmailError(null);
    setShowSubmitConfirm(false);
    setStage('result');

    // Save locally immediately so history updates instantly
    const historyKey = effectiveEmail || 'guest_local';
    const updatedLocal = saveLocalHistory(historyKey, attempt);
    setPastAttempts(prev => {
      const mergedMap = new Map<string, OnlineTestAttemptRecord>();
      for (const item of [attempt, ...updatedLocal, ...prev]) {
        if (!mergedMap.has(item.id)) mergedMap.set(item.id, item);
      }
      return Array.from(mergedMap.values()).sort((a, b) =>
        String(b.submittedAt || '').localeCompare(String(a.submittedAt || ''))
      );
    });

    // Only auto-email and save to Firestore when student explicitly provided a valid email
    if (effectiveEmail) {
      const wasEmailed = await dispatchResultEmail(attempt);
      const finalizedAttempt: OnlineTestAttemptRecord = { ...attempt, emailSent: wasEmailed };
      setActiveAttempt(finalizedAttempt);
      saveLocalHistory(historyKey, finalizedAttempt);
      await saveOnlineTestAttemptToFirebase(finalizedAttempt);
    } else {
      setEmailDelivery({ status: 'idle', message: '' });
    }
  };

  const answeredCount = Object.keys(answersMap).length;
  const currentQuestion = testQuestions[currentIdx] || null;
  const activeMedium = activeBank?.metadata?.medium || 'ಕನ್ನಡ';

  const displayStudentName = student?.name || loginName.trim() || 'ವಿದ್ಯಾರ್ಥಿ';
  const displayStudentEmail = student?.email || '';

  // ════════════════════════════════════════════════════════════════
  // SCREEN 1: ONLINE TEST CONFIGURATION (PROGRESSIVE PHOTO CARDS + NO MANDATORY LOGIN!)
  // ════════════════════════════════════════════════════════════════
  if (stage === 'setup') {
    const presetCounts = [5, 10, 15, 20, 25].filter(n => n <= availableMcqPool.length);
    const activeSemMeta = getSemesterPeriodMeta(selectedSemester);

    return (
      <div className="max-w-6xl mx-auto py-2 space-y-5 font-kannada">
        {/* Top Navigation & Optional Student Profile Bar (Dark Espresso Theme) */}
        <div className="bg-[#231d18] rounded-2xl border border-amber-200/15 shadow-xl px-4 sm:px-5 py-3.5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <button
                type="button"
                onClick={onBackToSetup}
                className="px-3 py-1.5 rounded-lg font-bold text-xs bg-[#191410] border border-amber-200/20 hover:bg-[#2f2720] text-amber-100 transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>ಹಿಂತಿರುಗಿ</span>
              </button>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-bold text-[#f7f0e6] truncate">
                    {student ? student.name : 'ನೇರ ಆನ್‌ಲೈನ್ ಪರೀಕ್ಷೆ (ಲಾಗಿನ್ ಅಗತ್ಯವಿಲ್ಲ)'}
                  </span>
                  {displayStudentEmail && (
                    <span className="text-xs text-[#c6b7a4] truncate">({displayStudentEmail})</span>
                  )}
                </div>
                {!student && (
                  <p className="text-[11px] text-emerald-300 font-semibold">
                    ಹೆಸರು ಅಥವಾ ಇಮೇಲ್ ಐಡಿ ಇಲ್ಲದೆಯೇ ನೇರವಾಗಿ ಪರೀಕ್ಷೆ ಬರೆಯಬಹುದು (ಐಚ್ಛಿಕ)
                  </p>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              {pastAttempts.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowHistoryPanel(prev => !prev)}
                  className="px-3 py-1.5 rounded-lg text-xs font-bold border border-amber-200/20 bg-[#1a1511] hover:bg-[#2d241d] text-amber-100 inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <History className="w-3.5 h-3.5 text-amber-300" />
                  <span>ಹಿಂದಿನ ಪರೀಕ್ಷೆಗಳು ({pastAttempts.length})</span>
                  {showHistoryPanel ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                </button>
              )}

              <button
                type="button"
                onClick={() => setShowOptionalProfileForm(prev => !prev)}
                className="px-3 py-1.5 rounded-lg text-xs font-bold border border-amber-300/30 bg-[#2e241b] hover:bg-[#3b2d21] text-amber-200 inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <UserIcon className="w-3.5 h-3.5" />
                <span>{student ? 'ವಿವರ ಬದಲಿಸಿ' : 'ಹೆಸರು / ಇಮೇಲ್ (ಐಚ್ಛಿಕ)'}</span>
              </button>

              {student && (
                <button
                  type="button"
                  onClick={handleStudentLogout}
                  className="px-3 py-1.5 rounded-lg text-xs font-bold border border-rose-400/30 bg-[#2a1a1a] hover:bg-rose-900/50 text-rose-200 inline-flex items-center gap-1 whitespace-nowrap shrink-0 transition-colors cursor-pointer"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>ತೆರವು</span>
                </button>
              )}
            </div>
          </div>

          {/* Collapsible Optional Name / Email / Google Login Form */}
          {showOptionalProfileForm && (
            <div className="pt-3 border-t border-amber-200/15 space-y-3">
              <form onSubmit={handleDirectEmailLogin} className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-end">
                <div className="sm:col-span-4">
                  <label htmlFor="optional-student-name" className="block text-[11px] font-bold text-[#e5d8c7] mb-1">
                    ವಿದ್ಯಾರ್ಥಿಯ ಹೆಸರು (ಐಚ್ಛಿಕ)
                  </label>
                  <input
                    id="optional-student-name"
                    type="text"
                    maxLength={100}
                    value={loginName}
                    onChange={e => setLoginName(e.target.value)}
                    placeholder="ಉದಾ: ರಾಹುಲ್ ಕುಮಾರ್"
                    className="w-full px-3 py-2 rounded-lg border border-amber-200/20 bg-[#17120e] text-xs text-[#faf4ec] placeholder:text-[#8c7d6b] focus:outline-none focus:ring-2 focus:ring-amber-400/35"
                  />
                </div>
                <div className="sm:col-span-4">
                  <label htmlFor="optional-student-email" className="block text-[11px] font-bold text-[#e5d8c7] mb-1">
                    ಇಮೇಲ್ ಐಡಿ (ಐಚ್ಛಿಕ — ಫಲಿತಾಂಶ ಪ್ರತಿಯನ್ನು ಪಡೆಯಲು)
                  </label>
                  <input
                    id="optional-student-email"
                    type="email"
                    maxLength={150}
                    value={loginEmail}
                    onChange={e => setLoginEmail(e.target.value)}
                    placeholder="student@gmail.com"
                    className="w-full px-3 py-2 rounded-lg border border-amber-200/20 bg-[#17120e] text-xs text-[#faf4ec] placeholder:text-[#8c7d6b] focus:outline-none focus:ring-2 focus:ring-amber-400/35"
                  />
                </div>
                <div className="sm:col-span-4 flex items-center gap-2">
                  <button
                    type="submit"
                    className="px-3.5 py-2 rounded-lg bg-gradient-to-r from-orange-600 to-amber-600 hover:from-orange-500 hover:to-amber-500 text-white text-xs font-bold cursor-pointer whitespace-nowrap"
                  >
                    ಉಳಿಸಿ
                  </button>
                  <button
                    type="button"
                    onClick={handleGoogleLogin}
                    disabled={isGoogleSigningIn}
                    className="px-3 py-2 rounded-lg border border-amber-200/25 bg-[#1b1612] hover:bg-[#2a221b] text-amber-100 text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap disabled:opacity-60"
                  >
                    {isGoogleSigningIn ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Mail className="w-3.5 h-3.5 text-amber-300" />}
                    <span>Google ಲಾಗಿನ್</span>
                  </button>
                </div>
              </form>
              {loginError && (
                <div className="p-2.5 rounded-lg bg-rose-950/70 border border-rose-400/35 text-rose-200 text-xs font-medium flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
                  <span>{loginError}</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Collapsible Past Attempts History */}
        {showHistoryPanel && pastAttempts.length > 0 && (
          <div className="bg-[#231d18] rounded-2xl border border-amber-200/15 shadow-xl p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-[#f7f0e6]">ನಿಮ್ಮ ಹಿಂದಿನ ಆನ್‌ಲೈನ್ ಪರೀಕ್ಷಾ ಫಲಿತಾಂಶಗಳು</h3>
              <span className="text-xs text-[#bfb09d]">ವಿವರ ನೋಡಲು ಕ್ಲಿಕ್ ಮಾಡಿ</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {pastAttempts.map(att => (
                <button
                  key={att.id}
                  type="button"
                  onClick={() => {
                    setActiveAttempt(att);
                    setEmailDelivery({
                      status: att.emailSent ? 'sent' : 'idle',
                      message: att.emailSent
                        ? `${att.studentEmail} ಗೆ ಇಮೇಲ್ ಪ್ರತಿ ಕಳುಹಿಸಲಾಗಿದೆ.`
                        : '',
                    });
                    setReviewFilter('all');
                    setStage('result');
                  }}
                  className="text-left p-3.5 rounded-xl border border-amber-200/15 bg-[#1a1511] hover:border-amber-300/45 hover:bg-[#2a221a] transition-colors flex items-center justify-between gap-3 cursor-pointer"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-bold text-[#f7f0e6] truncate">
                      {att.subject} · {att.grade}
                    </div>
                    <div className="text-xs text-[#b9aa97] mt-0.5">
                      {new Date(att.submittedAt).toLocaleString('en-IN', {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      })}{' '}
                      · ಸಮಯ {formatDurationMMSS(att.timeTakenSeconds)}
                    </div>
                  </div>
                  <div className="text-right shrink-0 tabular-nums">
                    <div className="text-base font-extrabold text-amber-300">
                      {att.score}/{att.totalQuestions}
                    </div>
                    <div className="text-xs font-bold text-emerald-300">{att.percentage}%</div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Progressive Photo Card Selector: Semester -> Class (1-10) -> Subject */}
        <VisualSelectionFlow
          mode="online_test"
          activeStep={selectionStep}
          onChangeStep={setSelectionStep}
          semester={selectedSemester}
          onSelectSemester={setSelectedSemester}
          selectedGradeKey={selectedGradeKey}
          onSelectGradeKey={setSelectedGradeKey}
          selectedFileId={selectedBankId}
          onSelectFileId={setSelectedBankId}
          availableFiles={availableFiles}
          statsMap={effectiveStatsMap}
          isScanningStats={effectiveIsScanning}
          configureStepLabel="ಪಾಠ & ಪರೀಕ್ಷೆ ಪ್ರಾರಂಭ"
        />

        {/* Step 4: Chapters, MCQ Count & Start Test (shown when Subject is picked) */}
        {selectionStep === 'configure' && (
          <div className="bg-[#231d18] rounded-2xl border border-amber-200/15 shadow-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-amber-200/15 bg-gradient-to-r from-[#233d30] via-[#263f33] to-[#1e3127] flex flex-wrap items-center justify-between gap-3">
              <div>
                <h1 className="text-base sm:text-lg font-extrabold text-[#faf4ec]">
                  ಆನ್‌ಲೈನ್ ಬಹು ಆಯ್ಕೆ ಪರೀಕ್ಷೆ — {activeBank?.metadata?.subject || 'ವಿಷಯ'} ({selectedGradeKey}ನೇ ತರಗತಿ)
                </h1>
                <p className="text-xs text-amber-200/90 mt-0.5">
                  {activeSemMeta.periodKn} · ಇಲ್ಲಿ ಕೇವಲ ಬಹು ಆಯ್ಕೆ (MCQ) ಪ್ರಶ್ನೆಗಳು ಮಾತ್ರ ಬರುತ್ತವೆ.
                </p>
              </div>
              <div className="text-xs font-extrabold text-[#1f160c] bg-[#f7e7b4] px-3.5 py-1.5 rounded-full tabular-nums whitespace-nowrap shrink-0 shadow-sm">
                ಲಭ್ಯವಿರುವ MCQ ಗಳು: {availableMcqPool.length}
              </div>
            </div>

            <div className="p-6 space-y-6">
              {isLoadingBank && (
                <div className="p-6 rounded-xl border border-amber-200/15 bg-[#1a1511] flex items-center justify-center gap-2.5 text-sm font-semibold text-amber-100">
                  <Loader2 className="w-5 h-5 animate-spin text-amber-400" />
                  <span>ವಿಷಯದ ಬಹು ಆಯ್ಕೆ (MCQ) ಪ್ರಶ್ನೆಗಳನ್ನು ಲೋಡ್ ಮಾಡಲಾಗುತ್ತಿದೆ...</span>
                </div>
              )}

              {bankLoadError && (
                <div className="p-4 rounded-xl bg-rose-950/70 border border-rose-400/35 text-rose-200 text-sm font-medium flex items-center gap-2">
                  <AlertCircle className="w-5 h-5 shrink-0 text-rose-400" />
                  <span>{bankLoadError}</span>
                </div>
              )}

              {/* Chapter Multi-Selection with MCQ counts */}
              {!isLoadingBank && activeBank && (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-xs sm:text-sm font-bold text-[#f7f0e6] flex items-center gap-1.5">
                      <BookOpen className="w-4 h-4 text-amber-300" />
                      <span>
                        ಪಾಠಗಳನ್ನು ಆಯ್ಕೆಮಾಡಿ (Select Chapters) — ಆಯ್ಕೆಯಾದವು: {selectedChapterIds.length} / {chaptersWithMcqs.length}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={selectAllMcqChapters}
                        className="px-3 py-1.5 rounded-lg text-xs font-bold bg-amber-500/20 text-amber-200 hover:bg-amber-500/30 border border-amber-300/30 whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        ಎಲ್ಲಾ ಆಯ್ಕೆಮಾಡಿ
                      </button>
                      <button
                        type="button"
                        onClick={clearAllChapters}
                        className="px-3 py-1.5 rounded-lg text-xs font-bold bg-[#191410] text-[#d6c8b7] hover:bg-[#2b231c] border border-amber-200/15 whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        ತೆರವುಗೊಳಿಸಿ
                      </button>
                    </div>
                  </div>

                  {chaptersWithMcqs.length === 0 ? (
                    <div className="p-5 rounded-xl bg-amber-950/50 border border-amber-400/30 text-amber-100 text-sm flex items-start gap-2.5">
                      <AlertCircle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                      <div>
                        <div className="font-bold">ಈ ಸೆಮಿಸ್ಟರ್/ವಿಷಯದಲ್ಲಿ ಬಹು ಆಯ್ಕೆ (MCQ) ಪ್ರಶ್ನೆಗಳು ಲಭ್ಯವಿಲ್ಲ.</div>
                        <div className="text-xs mt-1 text-amber-200/80">
                          ದಯವಿಟ್ಟು &quot;ಪೂರ್ಣ ವರ್ಷ&quot; ಸೆಮಿಸ್ಟರ್ ಅಥವಾ ಬೇರೆ ವಿಷಯವನ್ನು ಆಯ್ಕೆಮಾಡಿ.
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 max-h-72 overflow-y-auto pr-1">
                      {chapterStats.map((ch, idx) => {
                        const hasMcq = ch.mcqCount > 0;
                        const isChecked = selectedChapterIds.includes(ch.chapterId);
                        return (
                          <label
                            key={ch.chapterId}
                            className={`flex items-start gap-2.5 p-3 rounded-xl border transition-colors ${
                              !hasMcq
                                ? 'bg-[#171310] border-amber-200/10 opacity-45 cursor-not-allowed'
                                : isChecked
                                  ? 'bg-gradient-to-r from-[#23372d] to-[#272a22] border-emerald-400/60 cursor-pointer'
                                  : 'bg-[#1b1612] border-amber-200/12 hover:border-amber-300/35 cursor-pointer'
                            }`}
                          >
                            <input
                              type="checkbox"
                              disabled={!hasMcq}
                              checked={isChecked}
                              onChange={() => hasMcq && toggleChapter(ch.chapterId)}
                              className="mt-1 h-4 w-4 rounded border-amber-200/30 bg-[#14100d] text-emerald-600 focus:ring-emerald-500 shrink-0"
                            />
                            <div className="min-w-0 flex-1">
                              <div className="text-xs font-bold text-[#f7f0e6] leading-snug line-clamp-2">
                                {ch.chapterNumber ? `${ch.chapterNumber}. ` : `${idx + 1}. `}
                                {ch.chapterName}
                              </div>
                              <div className="text-[11px] font-semibold mt-1 tabular-nums">
                                {hasMcq ? (
                                  <span className="text-amber-300">{ch.mcqCount} MCQ ಪ್ರಶ್ನೆಗಳು</span>
                                ) : (
                                  <span className="text-[#8e8070]">0 MCQ ಪ್ರಶ್ನೆಗಳು</span>
                                )}
                              </div>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* Number of Questions Selector */}
              {!isLoadingBank && activeBank && availableMcqPool.length > 0 && (
                <div className="p-4 sm:p-5 rounded-xl bg-[#1b1612] border border-amber-200/15 space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <label
                        htmlFor="online-test-count"
                        className="text-xs font-bold text-[#f7f0e6] flex items-center gap-1.5"
                      >
                        <Layers className="w-4 h-4 text-amber-300" />
                        <span>ಪ್ರಶ್ನೆಗಳ ಸಂಖ್ಯೆ ಆಯ್ಕೆಮಾಡಿ (Number of MCQ Questions)</span>
                      </label>
                      <p className="text-xs text-[#bfb09d] mt-0.5 tabular-nums">
                        ಆಯ್ಕೆಮಾಡಿದ ಪಾಠಗಳಲ್ಲಿ ಒಟ್ಟು <strong className="text-amber-200">{availableMcqPool.length}</strong> ಬಹು ಆಯ್ಕೆ ಪ್ರಶ್ನೆಗಳು ಲಭ್ಯವಿವೆ (ಗರಿಷ್ಠ 100).
                      </p>
                    </div>

                    <label className="inline-flex items-center gap-2 text-xs font-semibold text-[#e6d8c7] cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={shuffleQuestions}
                        onChange={e => setShuffleQuestions(e.target.checked)}
                        className="h-4 w-4 rounded border-amber-200/30 bg-[#14100d] text-amber-500 focus:ring-amber-400"
                      />
                      <Shuffle className="w-3.5 h-3.5 text-amber-300" />
                      <span>ಪ್ರಶ್ನೆಗಳನ್ನು ಮಿಶ್ರಣಗೊಳಿಸಿ (Shuffle)</span>
                    </label>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {presetCounts.map(n => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => setQuestionCount(n)}
                        className={`min-h-[40px] px-4 py-1.5 rounded-lg text-xs font-bold tabular-nums border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                          questionCount === n
                            ? 'bg-gradient-to-r from-orange-600 to-amber-600 text-white border-amber-400/50 shadow-sm'
                            : 'bg-[#251e18] text-[#e6d8c7] border-amber-200/20 hover:bg-[#312820]'
                        }`}
                      >
                        {n} ಪ್ರಶ್ನೆಗಳು
                      </button>
                    ))}
                    {availableMcqPool.length > 0 && !presetCounts.includes(availableMcqPool.length) && (
                      <button
                        type="button"
                        onClick={() => setQuestionCount(Math.min(100, availableMcqPool.length))}
                        className={`min-h-[40px] px-4 py-1.5 rounded-lg text-xs font-bold tabular-nums border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                          questionCount === Math.min(100, availableMcqPool.length)
                            ? 'bg-gradient-to-r from-orange-600 to-amber-600 text-white border-amber-400/50 shadow-sm'
                            : 'bg-[#251e18] text-[#e6d8c7] border-amber-200/20 hover:bg-[#312820]'
                        }`}
                      >
                        ಎಲ್ಲಾ ({Math.min(100, availableMcqPool.length)})
                      </button>
                    )}

                    <div className="flex items-center gap-2 ml-auto">
                      <span className="text-xs font-semibold text-[#c9baa7]">ಸ್ವಂತ ಸಂಖ್ಯೆ:</span>
                      <input
                        id="online-test-count"
                        type="number"
                        min={1}
                        max={Math.min(100, availableMcqPool.length)}
                        value={questionCount}
                        onChange={e => {
                          const val = parseInt(e.target.value, 10);
                          if (Number.isNaN(val)) {
                            setQuestionCount(1);
                          } else {
                            setQuestionCount(Math.max(1, Math.min(val, availableMcqPool.length, 100)));
                          }
                        }}
                        className="w-20 min-h-[40px] px-3 py-1.5 rounded-lg border border-amber-200/25 bg-[#14100d] text-sm font-bold text-center text-[#faf4ec] tabular-nums focus:outline-none focus:ring-2 focus:ring-amber-400/35"
                      />
                    </div>
                  </div>
                </div>
              )}

              {configError && (
                <div className="p-3.5 rounded-xl bg-rose-950/70 border border-rose-400/35 text-rose-200 text-xs font-semibold flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
                  <span>{configError}</span>
                </div>
              )}

              {/* Start Test CTA */}
              <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-amber-200/15">
                <div className="text-xs text-[#c7b8a5]">
                  {displayStudentEmail ? (
                    <>
                      ಫಲಿತಾಂಶದ ಪ್ರತಿ <strong className="text-amber-200">{displayStudentEmail}</strong> ಗೆ ಕಳುಹಿಸಲಾಗುತ್ತದೆ.
                    </>
                  ) : (
                    <span>ಪರೀಕ್ಷೆ ಮುಗಿದ ತಕ್ಷಣ ಫಲಿತಾಂಶ ಮತ್ತು ಸರಿಯಾದ ಉತ್ತರಗಳು ಪರದೆಯ ಮೇಲೆ ಕಾಣಿಸುತ್ತವೆ.</span>
                  )}
                </div>
                <button
                  type="button"
                  disabled={isLoadingBank || availableMcqPool.length === 0 || selectedChapterIds.length === 0}
                  onClick={handleStartTest}
                  className="min-h-[48px] px-7 py-3 rounded-xl bg-gradient-to-r from-emerald-700 via-teal-700 to-emerald-800 hover:from-emerald-600 hover:to-teal-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-extrabold text-sm transition-all inline-flex items-center gap-2 shadow-lg border border-emerald-400/35 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Play className="w-4 h-4 fill-current text-amber-300" />
                  <span>
                    ಆನ್‌ಲೈನ್ ಪರೀಕ್ಷೆ ಪ್ರಾರಂಭಿಸಿ ({Math.min(questionCount, availableMcqPool.length, 100)} ಪ್ರಶ್ನೆಗಳು)
                  </span>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ════════════════════════════════════════════════════════════════
  // SCREEN 3: ACTIVE ONLINE MCQ EXAM RUNNER (DARK ESPRESSO THEME)
  // ════════════════════════════════════════════════════════════════
  if (stage === 'running' && currentQuestion) {
    const selectedOptionIdx = answersMap[currentQuestion.id];
    const unansweredRemaining = testQuestions.length - answeredCount;
    const progressPercent = Math.round(((currentIdx + 1) / testQuestions.length) * 100);

    return (
      <div className="max-w-4xl mx-auto py-2 space-y-4 font-kannada">
        {/* Exam Top Status Bar */}
        <div className="bg-[#231d18] rounded-2xl border border-amber-200/15 shadow-xl px-5 py-3.5 flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs font-semibold text-amber-300/90">
              {activeBank?.metadata?.grade} · {activeBank?.metadata?.subject}
            </div>
            <div className="text-sm font-bold text-[#f7f0e6] truncate">
              {displayStudentName}
              {displayStudentEmail ? ` (${displayStudentEmail})` : ''}
            </div>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <div className="px-3 py-1.5 rounded-lg bg-[#1a2a21] border border-emerald-400/30 text-emerald-200 text-xs font-bold tabular-nums inline-flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              <span>ಉತ್ತರಿಸಿದವು: {answeredCount}/{testQuestions.length}</span>
            </div>
            <div className="px-3 py-1.5 rounded-lg bg-[#2e2318] text-amber-200 border border-amber-300/30 text-xs font-bold tabular-nums inline-flex items-center gap-1.5">
              <Clock className="w-4 h-4 text-amber-400" />
              <span>{formatDurationMMSS(elapsedSeconds)}</span>
            </div>
            <button
              type="button"
              onClick={() => setShowExitConfirm(true)}
              className="px-3 py-1.5 rounded-lg border border-amber-200/20 bg-[#191410] hover:bg-[#2a221b] text-xs font-bold text-[#e6d8c7] whitespace-nowrap shrink-0 cursor-pointer"
            >
              ನಿರ್ಗಮಿಸಿ
            </button>
          </div>
        </div>

        {/* Inline Exit Confirmation */}
        {showExitConfirm && (
          <div className="p-4 rounded-xl bg-amber-950/75 border border-amber-400/40 flex flex-wrap items-center justify-between gap-3">
            <div className="text-xs sm:text-sm font-semibold text-amber-100">
              ನೀವು ಪರೀಕ್ಷೆಯನ್ನು ಮಧ್ಯದಲ್ಲಿ ನಿಲ್ಲಿಸಿ ಹಿಂತಿರುಗಲು ಬಯಸುವಿರಾ? ನಿಮ್ಮ ಉತ್ತರಗಳು ಉಳಿಯುವುದಿಲ್ಲ.
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowExitConfirm(false)}
                className="px-3.5 py-1.5 rounded-lg bg-[#231d18] border border-amber-200/25 text-xs font-bold text-amber-100 cursor-pointer"
              >
                ಪರೀಕ್ಷೆ ಮುಂದುವರಿಸಿ
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowExitConfirm(false);
                  setStage('setup');
                }}
                className="px-3.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold cursor-pointer"
              >
                ಹೌದು, ನಿರ್ಗಮಿಸಿ
              </button>
            </div>
          </div>
        )}

        {/* Thin Progress Bar */}
        <div className="h-1.5 w-full bg-[#2a221b] rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-orange-500 to-amber-400 transition-all duration-300"
            style={{ width: `${progressPercent}%` }}
          />
        </div>

        {/* Question Navigator Palette */}
        <div className="bg-[#231d18] rounded-2xl border border-amber-200/15 px-4 py-3">
          <div className="text-[11px] font-bold text-[#bfb09d] mb-2">
            ಪ್ರಶ್ನೆ ಸಂಖ್ಯೆ ಆಯ್ಕೆ (Question Navigator)
          </div>
          <div className="flex flex-wrap gap-1.5">
            {testQuestions.map((q, idx) => {
              const isCurrent = idx === currentIdx;
              const isAnswered = answersMap[q.id] !== undefined;
              return (
                <button
                  key={q.id}
                  type="button"
                  onClick={() => setCurrentIdx(idx)}
                  aria-label={`Question ${idx + 1}`}
                  className={`w-9 h-9 rounded-lg text-xs font-bold tabular-nums border transition-colors cursor-pointer ${
                    isCurrent
                      ? 'bg-gradient-to-r from-orange-600 to-amber-600 text-white border-amber-300 ring-2 ring-amber-400/35'
                      : isAnswered
                        ? 'bg-[#1f3429] text-emerald-200 border-emerald-400/45 hover:bg-[#274334]'
                        : 'bg-[#18130f] text-[#c8b9a6] border-amber-200/15 hover:bg-[#2a221b]'
                  }`}
                >
                  {idx + 1}
                </button>
              );
            })}
          </div>
        </div>

        {/* Active Question Card */}
        <div className="bg-[#231d18] rounded-2xl border border-amber-200/15 shadow-xl p-5 sm:p-7 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-amber-200/12">
            <span className="text-xs font-extrabold text-amber-300 tabular-nums">
              ಪ್ರಶ್ನೆ {currentIdx + 1} / {testQuestions.length}
            </span>
            <span className="text-xs font-medium text-[#bfb09d]">
              ಪಾಠ: {currentQuestion.chapterName}
            </span>
          </div>

          {/* Question Text */}
          <div className="text-base sm:text-lg font-bold text-[#faf4ec] leading-relaxed whitespace-pre-line">
            <MathText text={currentQuestion.question} />
          </div>

          {/* Optional Question Diagram Images (1 or 2 Side-by-Side) */}
          {((isSafeImageSrc(currentQuestion.imageUrl) && currentQuestion.imageUrl) ||
            (isSafeImageSrc(currentQuestion.imageUrl2) && currentQuestion.imageUrl2)) && (
            isSafeImageSrc(currentQuestion.imageUrl) &&
            currentQuestion.imageUrl &&
            isSafeImageSrc(currentQuestion.imageUrl2) &&
            currentQuestion.imageUrl2 ? (
              <div className="my-2 grid grid-cols-2 gap-3 items-center">
                <ResilientQuestionImage
                  src={currentQuestion.imageUrl}
                  alt={`Question ${currentIdx + 1} diagram 1`}
                  className="max-h-60 w-full rounded-xl border border-amber-200/25 bg-white p-2 object-contain"
                />
                <ResilientQuestionImage
                  src={currentQuestion.imageUrl2}
                  alt={`Question ${currentIdx + 1} diagram 2`}
                  className="max-h-60 w-full rounded-xl border border-amber-200/25 bg-white p-2 object-contain"
                />
              </div>
            ) : (
              <div className="my-2 flex justify-center">
                <ResilientQuestionImage
                  src={(currentQuestion.imageUrl || currentQuestion.imageUrl2)!}
                  alt={`Question ${currentIdx + 1} diagram`}
                  className="max-h-64 w-auto rounded-xl border border-amber-200/25 bg-white p-2 object-contain"
                />
              </div>
            )
          )}

          {/* Clickable MCQ Options */}
          <div className="space-y-2.5 pt-1">
            {currentQuestion.cleanOptions.map((optText, optIdx) => {
              const isSelected = selectedOptionIdx === optIdx;
              const label = getOptionLabel(optIdx, activeMedium);
              const cleanedBody = stripOptionPrefix(optText) || optText;

              return (
                <button
                  key={`${currentQuestion.id}_opt_${optIdx}`}
                  type="button"
                  onClick={() =>
                    setAnswersMap(prev => ({
                      ...prev,
                      [currentQuestion.id]: optIdx,
                    }))
                  }
                  className={`w-full min-h-[52px] text-left px-4 py-3.5 rounded-xl border transition-all flex items-start gap-3.5 cursor-pointer ${
                    isSelected
                      ? 'bg-gradient-to-r from-[#342619] to-[#2c2218] border-amber-400 ring-1 ring-amber-400/60 text-white'
                      : 'bg-[#1a1511] border-amber-200/15 hover:border-amber-300/40 hover:bg-[#272019] text-[#eee3d5]'
                  }`}
                >
                  <span
                    className={`w-7 h-7 rounded-lg text-xs font-extrabold flex items-center justify-center shrink-0 mt-0.5 ${
                      isSelected
                        ? 'bg-amber-500 text-[#1b140d]'
                        : 'bg-[#2a221b] text-amber-200 border border-amber-200/20'
                    }`}
                  >
                    {label}
                  </span>
                  <span className="text-sm sm:text-base font-medium leading-relaxed flex-1">
                    <MathText text={cleanedBody} />
                  </span>
                  {isSelected && (
                    <Check className="w-5 h-5 text-amber-300 shrink-0 mt-0.5" />
                  )}
                </button>
              );
            })}
          </div>

          {/* Inline Submit Confirmation Banner */}
          {showSubmitConfirm && (
            <div className="p-4 rounded-xl bg-[#2c2218] border border-amber-300/35 space-y-3">
              <div className="text-sm font-bold text-amber-100">
                {unansweredRemaining > 0
                  ? `ಇನ್ನೂ ${unansweredRemaining} ಪ್ರಶ್ನೆಗಳಿಗೆ ಉತ್ತರಿಸಿಲ್ಲ. ಆದರೂ ಪರೀಕ್ಷೆಯನ್ನು ಸಲ್ಲಿಸಬೇಕೆ?`
                  : 'ಎಲ್ಲಾ ಪ್ರಶ್ನೆಗಳಿಗೆ ಉತ್ತರಿಸಿದ್ದೀರಿ! ಪರೀಕ್ಷೆಯನ್ನು ಸಲ್ಲಿಸಿ ಫಲಿತಾಂಶ ನೋಡಲು ಸಿದ್ಧರಿದ್ದೀರಾ?'}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={finalizeAndSubmitTest}
                  className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>ಹೌದು, ಪರೀಕ್ಷೆ ಸಲ್ಲಿಸಿ ಫಲಿತಾಂಶ ನೋಡಿ</span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowSubmitConfirm(false)}
                  className="px-4 py-2.5 rounded-xl bg-[#1a1511] border border-amber-200/25 text-amber-100 text-xs font-bold cursor-pointer"
                >
                  ರದ್ದುಮಾಡಿ
                </button>
              </div>
            </div>
          )}

          {/* Bottom Navigation Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-amber-200/15">
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={currentIdx === 0}
                onClick={() => setCurrentIdx(prev => Math.max(0, prev - 1))}
                className="min-h-[42px] px-4 py-2 rounded-xl border border-amber-200/20 bg-[#1a1511] hover:bg-[#2b231c] disabled:opacity-40 text-xs font-bold text-amber-100 inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>ಹಿಂದಿನ</span>
              </button>

              {selectedOptionIdx !== undefined && (
                <button
                  type="button"
                  onClick={() =>
                    setAnswersMap(prev => {
                      const next = { ...prev };
                      delete next[currentQuestion.id];
                      return next;
                    })
                  }
                  className="min-h-[42px] px-3.5 py-2 rounded-xl border border-amber-200/15 text-xs font-semibold text-[#c5b6a4] hover:text-white hover:bg-[#2a221b] whitespace-nowrap shrink-0 cursor-pointer"
                >
                  ಆಯ್ಕೆ ತೆರವು
                </button>
              )}
            </div>

            <div className="flex items-center gap-2">
              {currentIdx < testQuestions.length - 1 ? (
                <button
                  type="button"
                  onClick={() => setCurrentIdx(prev => Math.min(testQuestions.length - 1, prev + 1))}
                  className="min-h-[42px] px-5 py-2 rounded-xl bg-gradient-to-r from-orange-600 to-amber-600 hover:from-orange-500 hover:to-amber-500 text-white text-xs font-bold inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <span>ಮುಂದಿನ ಪ್ರಶ್ನೆ</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              ) : null}

              <button
                type="button"
                onClick={() => {
                  if (unansweredRemaining === 0 && !showSubmitConfirm) {
                    finalizeAndSubmitTest();
                  } else {
                    setShowSubmitConfirm(true);
                  }
                }}
                className="min-h-[42px] px-5 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-600 text-white text-xs font-bold inline-flex items-center gap-1.5 shadow-sm whitespace-nowrap shrink-0 cursor-pointer"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>ಪರೀಕ್ಷೆ ಸಲ್ಲಿಸಿ (Submit)</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ════════════════════════════════════════════════════════════════
  // SCREEN 4: INSTANT ON-SPOT RESULT + EMAIL COPY + SOLVED Q&A SHEET
  // ════════════════════════════════════════════════════════════════
  if (stage === 'result' && activeAttempt) {
    const perf = getPerformanceFeedback(activeAttempt.percentage);
    const mailtoHref = buildMailtoHref(activeAttempt, schoolName);
    const filteredItems = activeAttempt.items.filter(item => {
      if (reviewFilter === 'correct') return item.isCorrect;
      if (reviewFilter === 'wrong') return !item.isCorrect;
      return true;
    });

    return (
      <div className="max-w-4xl mx-auto py-2 space-y-5 font-kannada">
        {/* Top Action Controls (Hidden on Print) */}
        <div className="no-print flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => setStage('setup')}
            className="px-4 py-2 rounded-xl bg-[#231d18] border border-amber-200/20 hover:bg-[#312820] text-xs font-bold text-amber-100 inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <RotateCcw className="w-4 h-4 text-amber-300" />
            <span>ಹೊಸ ಪರೀಕ್ಷೆ ನೀಡಿ (New Test)</span>
          </button>

          <div className="flex flex-wrap items-center gap-2">
            <a
              href={mailtoHref}
              className="px-4 py-2 rounded-xl bg-[#231d18] border border-amber-200/20 hover:bg-[#312820] text-xs font-bold text-amber-100 inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
            >
              <Mail className="w-4 h-4 text-amber-300" />
              <span>ಇಮೇಲ್ ಆ್ಯಪ್‌ನಲ್ಲಿ ಕಳುಹಿಸಿ</span>
            </a>

            <button
              type="button"
              onClick={() => window.print()}
              className="px-4 py-2 rounded-xl bg-gradient-to-r from-orange-600 to-amber-600 hover:from-orange-500 hover:to-amber-500 text-white text-xs font-bold inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer shadow-md"
            >
              <Printer className="w-4 h-4" />
              <span>ಉತ್ತರ ಪತ್ರಿಕೆ ಮುದ್ರಿಸಿ / PDF ಉಳಿಸಿ</span>
            </button>
          </div>
        </div>

        {/* Hero Score Summary Card */}
        <div className="bg-white rounded-2xl border border-amber-200/20 shadow-xl overflow-hidden text-slate-900">
          <div className="bg-gradient-to-r from-[#2c2117] via-[#3a2a1c] to-[#23382c] text-white px-6 py-5 flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-amber-300">
                {schoolName}
              </div>
              <h1 className="text-xl sm:text-2xl font-bold mt-0.5">
                ಆನ್‌ಲೈನ್ ಪರೀಕ್ಷಾ ಫಲಿತಾಂಶ (Instant Test Result)
              </h1>
              <div className="text-xs sm:text-sm text-amber-100/85 mt-1">
                {activeAttempt.studentName}
                {activeAttempt.studentEmail ? ` (${activeAttempt.studentEmail})` : ''} · {activeAttempt.grade} · {activeAttempt.subject}
              </div>
            </div>
            <div className="text-right tabular-nums">
              <div className="text-3xl sm:text-4xl font-extrabold text-white">
                {activeAttempt.score} / {activeAttempt.totalQuestions}
              </div>
              <div className="text-sm font-bold text-amber-300">
                {activeAttempt.percentage}% ಅಂಕಗಳು
              </div>
            </div>
          </div>

          <div className="p-6 space-y-5">
            {/* Performance Remark Banner */}
            <div className={`px-4 py-3 rounded-xl border flex flex-wrap items-center justify-between gap-2 ${perf.toneClass}`}>
              <div className="flex items-center gap-2 font-bold text-sm">
                <Award className="w-5 h-5 shrink-0" />
                <span>{perf.titleKn} ({perf.titleEn})</span>
              </div>
              <div className="text-xs font-semibold tabular-nums">
                ತೆಗೆದುಕೊಂಡ ಸಮಯ: {formatDurationMMSS(activeAttempt.timeTakenSeconds)}
              </div>
            </div>

            {/* 4 Key Metrics Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 tabular-nums">
              <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200">
                <div className="text-xs font-bold text-emerald-800 flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  <span>ಸರಿ ಉತ್ತರಗಳು</span>
                </div>
                <div className="text-2xl font-extrabold text-emerald-700 mt-1">
                  {activeAttempt.correctCount}
                </div>
              </div>

              <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200">
                <div className="text-xs font-bold text-rose-800 flex items-center gap-1.5">
                  <XCircle className="w-4 h-4 text-rose-600" />
                  <span>ತಪ್ಪು ಉತ್ತರಗಳು</span>
                </div>
                <div className="text-2xl font-extrabold text-rose-700 mt-1">
                  {activeAttempt.wrongCount}
                </div>
              </div>

              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
                <div className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                  <MinusCircle className="w-4 h-4 text-slate-500" />
                  <span>ಉತ್ತರಿಸಿಲ್ಲ</span>
                </div>
                <div className="text-2xl font-extrabold text-slate-700 mt-1">
                  {activeAttempt.unansweredCount}
                </div>
              </div>

              <div className="p-3.5 rounded-xl bg-indigo-50 border border-indigo-200">
                <div className="text-xs font-bold text-indigo-800 flex items-center gap-1.5">
                  <Clock className="w-4 h-4 text-indigo-600" />
                  <span>ಶೇಕಡಾವಾರು</span>
                </div>
                <div className="text-2xl font-extrabold text-indigo-700 mt-1">
                  {activeAttempt.percentage}%
                </div>
              </div>
            </div>

            {activeAttempt.chapters.length > 0 && (
              <div className="text-xs text-slate-600">
                <strong className="text-slate-800">ಆಯ್ಕೆಮಾಡಿದ ಪಾಠಗಳು:</strong>{' '}
                {activeAttempt.chapters.join(', ')}
              </div>
            )}

            {/* Optional Email Copy Delivery Panel (Hidden on Print) */}
            <div className="no-print p-4 rounded-xl border border-slate-200 bg-slate-50 space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-start gap-2.5 min-w-0 flex-1">
                  {emailDelivery.status === 'sending' ? (
                    <Loader2 className="w-5 h-5 text-indigo-600 animate-spin shrink-0 mt-0.5" />
                  ) : emailDelivery.status === 'sent' ? (
                    <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                  ) : (
                    <Mail className="w-5 h-5 text-indigo-600 shrink-0 mt-0.5" />
                  )}
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-slate-900">
                      {activeAttempt.studentEmail
                        ? `ಇಮೇಲ್ ಪ್ರತಿ ಸ್ಥಿತಿ (${activeAttempt.studentEmail})`
                        : 'ಫಲಿತಾಂಶದ ಪ್ರತಿಯನ್ನು ಇಮೇಲ್‌ಗೆ ಪಡೆಯಿರಿ (ಐಚ್ಛಿಕ)'}
                    </div>
                    <p className="text-xs text-slate-600 mt-0.5 leading-relaxed">
                      {emailDelivery.message ||
                        'ಬೇಕಿದ್ದರೆ ಕೆಳಗೆ ಇಮೇಲ್ ವಿಳಾಸ ನಮೂದಿಸಿ ಉತ್ತರ ಪತ್ರಿಕೆಯ ಪ್ರತಿಯನ್ನು ಇಮೇಲ್‌ಗೆ ಕಳುಹಿಸಿಕೊಳ್ಳಬಹುದು.'}
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  {!activeAttempt.studentEmail && (
                    <input
                      type="email"
                      value={resultEmailInput}
                      onChange={e => {
                        setResultEmailInput(e.target.value);
                        setResultEmailError(null);
                      }}
                      placeholder="student@gmail.com (ಐಚ್ಛಿಕ)"
                      className="px-3 py-2 rounded-lg border border-slate-300 bg-white text-xs text-slate-900 w-52 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                    />
                  )}
                  <button
                    type="button"
                    disabled={emailDelivery.status === 'sending'}
                    onClick={() => {
                      const targetEmail = (activeAttempt.studentEmail || resultEmailInput).trim().toLowerCase();
                      if (!EMAIL_REGEX.test(targetEmail)) {
                        setResultEmailError('ದಯವಿಟ್ಟು ಸರಿಯಾದ ಇಮೇಲ್ ವಿಳಾಸ ನಮೂದಿಸಿ.');
                        return;
                      }
                      setResultEmailError(null);
                      const updatedAttempt = { ...activeAttempt, studentEmail: targetEmail };
                      setActiveAttempt(updatedAttempt);
                      dispatchResultEmail(updatedAttempt);
                    }}
                    className="px-3.5 py-2 rounded-lg bg-white border border-slate-300 hover:bg-slate-100 text-xs font-bold text-slate-800 inline-flex items-center gap-1.5 disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Send className="w-3.5 h-3.5 text-indigo-600" />
                    <span>{emailDelivery.status === 'sent' ? 'ಮರುಕಳುಹಿಸಿ' : 'ಇಮೇಲ್ ಕಳುಹಿಸಿ'}</span>
                  </button>
                </div>
              </div>
              {resultEmailError && (
                <p className="text-xs font-semibold text-rose-700">{resultEmailError}</p>
              )}

              {emailDelivery.status === 'not_configured' && (
                <div className="pt-2 border-t border-slate-200/80">
                  <button
                    type="button"
                    onClick={() => setShowSmtpHint(prev => !prev)}
                    className="text-xs font-bold text-indigo-700 hover:underline inline-flex items-center gap-1"
                  >
                    <span>ಶಿಕ್ಷಕರಿಗೆ ಸೂಚನೆ: ಸ್ವಯಂಚಾಲಿತ ಇಮೇಲ್ ಸಕ್ರಿಯಗೊಳಿಸುವುದು ಹೇಗೆ?</span>
                    {showSmtpHint ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                  </button>
                  {showSmtpHint && (
                    <div className="mt-2 p-3 rounded-lg bg-white border border-slate-200 text-xs text-slate-700 space-y-1 leading-relaxed">
                      <div>
                        AI Studio <strong>Settings → Secrets</strong> ನಲ್ಲಿ ಇವುಗಳಲ್ಲಿ ಯಾವುದಾದರೂ ಒಂದನ್ನು ಸೇರಿಸಿ:
                      </div>
                      <div>
                        1. <strong>Gmail SMTP:</strong> <code>SMTP_HOST=smtp.gmail.com</code>, <code>SMTP_PORT=587</code>, <code>SMTP_USER</code> (ನಿಮ್ಮ Gmail), <code>SMTP_PASS</code> (Gmail App Password)
                      </div>
                      <div>
                        2. <strong>Resend API:</strong> <code>RESEND_API_KEY</code> ಮತ್ತು <code>SMTP_FROM</code>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Full Solved Questions & Answers Review Sheet */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200 bg-slate-50/70 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-bold text-slate-900">
                ಬಿಡಿಸಿದ ಪ್ರಶ್ನೆಗಳು ಮತ್ತು ಉತ್ತರಗಳ ಪತ್ರಿಕೆ (Solved Questions &amp; Answers)
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                ಪ್ರತಿ ಪ್ರಶ್ನೆಗೆ ನಿಮ್ಮ ಉತ್ತರ ಮತ್ತು ಸರಿಯಾದ ಉತ್ತರದ ವಿವರಣೆ ಇಲ್ಲಿದೆ.
              </p>
            </div>

            <div className="no-print flex items-center gap-1.5">
              {(
                [
                  { id: 'all', label: `ಎಲ್ಲಾ (${activeAttempt.items.length})` },
                  { id: 'wrong', label: `ತಪ್ಪು / ಬಾಕಿ (${activeAttempt.wrongCount + activeAttempt.unansweredCount})` },
                  { id: 'correct', label: `ಸರಿ (${activeAttempt.correctCount})` },
                ] as const
              ).map(tab => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setReviewFilter(tab.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors whitespace-nowrap shrink-0 ${
                    reviewFilter === tab.id
                      ? 'bg-indigo-600 text-white border-indigo-600'
                      : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          <div className="divide-y divide-slate-200">
            {filteredItems.map((item, visibleIdx) => {
              const originalIndex = activeAttempt.items.indexOf(item) + 1;
              return (
                <div key={`${item.questionId}_${visibleIdx}`} className="p-5 sm:p-6 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-xs font-bold text-slate-500 tabular-nums">
                      ಪ್ರಶ್ನೆ {originalIndex}
                      {item.chapterName ? ` · ${item.chapterName}` : ''}
                    </div>
                    {item.isCorrect ? (
                      <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-md">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>ಸರಿ (Correct)</span>
                      </span>
                    ) : item.isUnanswered ? (
                      <span className="inline-flex items-center gap-1 text-xs font-bold text-slate-600 bg-slate-100 border border-slate-200 px-2.5 py-1 rounded-md">
                        <MinusCircle className="w-3.5 h-3.5" />
                        <span>ಉತ್ತರಿಸಿಲ್ಲ (Unanswered)</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs font-bold text-rose-700 bg-rose-50 border border-rose-200 px-2.5 py-1 rounded-md">
                        <XCircle className="w-3.5 h-3.5" />
                        <span>ತಪ್ಪು (Wrong)</span>
                      </span>
                    )}
                  </div>

                  <div className="text-sm sm:text-base font-semibold text-slate-900 leading-relaxed whitespace-pre-line">
                    <MathText text={item.question} />
                  </div>

                  {((isSafeImageSrc(item.imageUrl) && item.imageUrl) ||
                    (isSafeImageSrc(item.imageUrl2) && item.imageUrl2)) && (
                    isSafeImageSrc(item.imageUrl) &&
                    item.imageUrl &&
                    isSafeImageSrc(item.imageUrl2) &&
                    item.imageUrl2 ? (
                      <div className="my-1 grid grid-cols-2 gap-3 max-w-2xl items-center">
                        <ResilientQuestionImage
                          src={item.imageUrl}
                          alt={`Question ${originalIndex} diagram 1`}
                          className="max-h-48 w-full rounded-lg border border-slate-200 p-1.5 bg-white object-contain"
                        />
                        <ResilientQuestionImage
                          src={item.imageUrl2}
                          alt={`Question ${originalIndex} diagram 2`}
                          className="max-h-48 w-full rounded-lg border border-slate-200 p-1.5 bg-white object-contain"
                        />
                      </div>
                    ) : (
                      <div className="my-1">
                        <ResilientQuestionImage
                          src={(item.imageUrl || item.imageUrl2)!}
                          alt={`Question ${originalIndex} diagram`}
                          className="max-h-48 w-auto rounded-lg border border-slate-200 p-1.5 bg-white object-contain"
                        />
                      </div>
                    )
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs sm:text-sm">
                    <div
                      className={`p-3 rounded-xl border ${
                        item.isCorrect
                          ? 'bg-emerald-50/70 border-emerald-200 text-emerald-950'
                          : item.isUnanswered
                            ? 'bg-slate-50 border-slate-200 text-slate-700'
                            : 'bg-rose-50/70 border-rose-200 text-rose-950'
                      }`}
                    >
                      <div className="text-[11px] font-bold uppercase tracking-wide opacity-75">
                        ನಿಮ್ಮ ಉತ್ತರ (Your Answer)
                      </div>
                      <div className="font-semibold mt-0.5">
                        {item.selectedOption ? (
                          <MathText text={item.selectedOption} />
                        ) : (
                          <span>ಉತ್ತರ ಆಯ್ಕೆ ಮಾಡಿಲ್ಲ</span>
                        )}
                      </div>
                    </div>

                    <div className="p-3 rounded-xl border bg-emerald-50/70 border-emerald-200 text-emerald-950">
                      <div className="text-[11px] font-bold uppercase tracking-wide text-emerald-800">
                        ಸರಿಯಾದ ಉತ್ತರ (Correct Answer)
                      </div>
                      <div className="font-bold mt-0.5">
                        <MathText text={item.correctOption} />
                      </div>
                    </div>
                  </div>

                  {item.explanation && (
                    <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 text-xs sm:text-sm text-slate-700 leading-relaxed whitespace-pre-line">
                      <span className="font-bold text-slate-900">ವಿವರಣೆ (Explanation): </span>
                      <MathText text={item.explanation} />
                    </div>
                  )}

                  {((isSafeImageSrc(item.answerImageUrl) && item.answerImageUrl) ||
                    (isSafeImageSrc(item.answerImageUrl2) && item.answerImageUrl2)) && (
                    isSafeImageSrc(item.answerImageUrl) &&
                    item.answerImageUrl &&
                    isSafeImageSrc(item.answerImageUrl2) &&
                    item.answerImageUrl2 ? (
                      <div className="my-1 grid grid-cols-2 gap-3 max-w-2xl items-center">
                        <ResilientQuestionImage
                          src={item.answerImageUrl}
                          alt={`Answer ${originalIndex} diagram 1`}
                          className="max-h-48 w-full rounded-lg border border-slate-200 p-1.5 bg-white object-contain"
                        />
                        <ResilientQuestionImage
                          src={item.answerImageUrl2}
                          alt={`Answer ${originalIndex} diagram 2`}
                          className="max-h-48 w-full rounded-lg border border-slate-200 p-1.5 bg-white object-contain"
                        />
                      </div>
                    ) : (
                      <div className="my-1">
                        <ResilientQuestionImage
                          src={(item.answerImageUrl || item.answerImageUrl2)!}
                          alt={`Answer ${originalIndex} diagram`}
                          className="max-h-48 w-auto rounded-lg border border-slate-200 p-1.5 bg-white object-contain"
                        />
                      </div>
                    )
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  return null;
};
