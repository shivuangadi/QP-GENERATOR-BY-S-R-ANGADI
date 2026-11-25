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

interface StudentSession {
  uid: string;
  name: string;
  email: string;
  authMethod: 'google' | 'email';
}

interface OnlineTestViewProps {
  availableFiles: IndexEntry[];
  initialFileId: string;
  initialBank: QuestionBank | null;
  schoolName: string;
  onBackToSetup: () => void;
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
      toneClass: 'text-emerald-700 bg-emerald-50 border-emerald-200',
    };
  }
  if (percentage >= 65) {
    return {
      titleKn: 'ತುಂಬಾ ಚೆನ್ನಾಗಿದೆ!',
      titleEn: 'Very Good Effort',
      toneClass: 'text-indigo-700 bg-indigo-50 border-indigo-200',
    };
  }
  if (percentage >= 40) {
    return {
      titleKn: 'ಒಳ್ಳೆಯ ಪ್ರಯತ್ನ — ಇನ್ನಷ್ಟು ಅಭ್ಯಾಸ ಮಾಡಿ',
      titleEn: 'Good Attempt — Keep Practicing',
      toneClass: 'text-amber-700 bg-amber-50 border-amber-200',
    };
  }
  return {
    titleKn: 'ಮತ್ತೆ ಅಭ್ಯಾಸ ಮಾಡಿ ಪ್ರಯತ್ನಿಸಿ',
    titleEn: 'Needs More Practice',
    toneClass: 'text-rose-700 bg-rose-50 border-rose-200',
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

  // ── Test Configuration State ──
  const [stage, setStage] = useState<TestStage>('setup');
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

  // Load past attempts whenever student logs in
  const refreshHistory = useCallback(async (sess: StudentSession) => {
    const localItems = readLocalHistory(sess.email);
    let cloudItems: OnlineTestAttemptRecord[] = [];
    if (sess.authMethod === 'google' && auth.currentUser) {
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
    if (student) {
      refreshHistory(student);
    } else {
      setPastAttempts([]);
    }
  }, [student, refreshHistory]);

  // Unique grades available in availableFiles
  const gradeOptions = useMemo(() => {
    const map = new Map<string, { key: string; label: string; count: number }>();
    for (const f of availableFiles) {
      const key = extractGradeKey(f.gradeKey || f.grade);
      const prev = map.get(key);
      if (prev) {
        prev.count += 1;
      } else {
        map.set(key, {
          key,
          label: canonicalGradeLabel(key),
          count: 1,
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => Number(a.key) - Number(b.key));
  }, [availableFiles]);

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

  // Compute strict per-chapter MCQ stats
  const chapterStats = useMemo(() => getChapterMcqStats(activeBank), [activeBank]);

  const chaptersWithMcqs = useMemo(
    () => chapterStats.filter(c => c.mcqCount > 0),
    [chapterStats]
  );

  // Auto-select all chapters with MCQs whenever activeBank changes
  useEffect(() => {
    const validIds = chaptersWithMcqs.map(c => c.chapterId);
    setSelectedChapterIds(validIds);
    setConfigError(null);
  }, [activeBank, chaptersWithMcqs]);

  // Pool of strict MCQs matching selected chapters
  const availableMcqPool = useMemo(
    () => extractMcqQuestionsFromBank(activeBank, selectedChapterIds),
    [activeBank, selectedChapterIds]
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
    if (trimmedName.length < 2) {
      setLoginError('ದಯವಿಟ್ಟು ವಿದ್ಯಾರ್ಥಿಯ ಪೂರ್ಣ ಹೆಸರನ್ನು ನಮೂದಿಸಿ.');
      return;
    }
    if (!EMAIL_REGEX.test(trimmedEmail)) {
      setLoginError('ದಯವಿಟ್ಟು ಸರಿಯಾದ ಇಮೇಲ್ ವಿಳಾಸವನ್ನು ನಮೂದಿಸಿ (ಉದಾ: student@gmail.com).');
      return;
    }
    const session: StudentSession = {
      uid: 'email_guest',
      name: trimmedName,
      email: trimmedEmail,
      authMethod: 'email',
    };
    setStudent(session);
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

  // ── Submit Test & Grade Instantly ──
  const finalizeAndSubmitTest = async () => {
    if (!student || !activeBank || testQuestions.length === 0) return;

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
        answerImageUrl: isSafeImageSrc(q.answerImageUrl) ? q.answerImageUrl : '',
      };
    });

    const totalQuestions = solvedItems.length;
    const percentage = Math.round((correctCount / totalQuestions) * 100);
    const chapterNames = Array.from(new Set(testQuestions.map(q => q.chapterName)));

    const attempt: OnlineTestAttemptRecord = {
      id: `test_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      studentUid: student.uid,
      studentName: student.name,
      studentEmail: student.email,
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
    setShowSubmitConfirm(false);
    setStage('result');

    // Save locally immediately so history updates instantly
    const updatedLocal = saveLocalHistory(student.email, attempt);
    setPastAttempts(prev => {
      const mergedMap = new Map<string, OnlineTestAttemptRecord>();
      for (const item of [attempt, ...updatedLocal, ...prev]) {
        if (!mergedMap.has(item.id)) mergedMap.set(item.id, item);
      }
      return Array.from(mergedMap.values()).sort((a, b) =>
        String(b.submittedAt || '').localeCompare(String(a.submittedAt || ''))
      );
    });

    // Automatically email solved questions & answers to student's email ID
    const wasEmailed = await dispatchResultEmail(attempt);
    const finalizedAttempt: OnlineTestAttemptRecord = { ...attempt, emailSent: wasEmailed };
    setActiveAttempt(finalizedAttempt);
    saveLocalHistory(student.email, finalizedAttempt);

    // Persist attempt record to Firestore
    await saveOnlineTestAttemptToFirebase(finalizedAttempt);
  };

  const answeredCount = Object.keys(answersMap).length;
  const currentQuestion = testQuestions[currentIdx] || null;
  const activeMedium = activeBank?.metadata?.medium || 'ಕನ್ನಡ';

  // ════════════════════════════════════════════════════════════════
  // SCREEN 1: STUDENT EMAIL LOGIN
  // ════════════════════════════════════════════════════════════════
  if (!student) {
    return (
      <div className="max-w-3xl mx-auto py-4 font-kannada">
        <div className="no-print mb-4">
          <button
            type="button"
            onClick={onBackToSetup}
            className="px-3.5 py-2 rounded-lg font-semibold text-xs bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>ಮುಖ್ಯ ಪುಟಕ್ಕೆ ಹಿಂತಿರುಗಿ</span>
          </button>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="bg-[#181c3d] text-white px-6 sm:px-8 py-6">
            <div className="text-xs font-semibold tracking-wide uppercase text-indigo-300">
              {schoolName}
            </div>
            <h1 className="text-xl sm:text-2xl font-bold mt-1">
              ವಿದ್ಯಾರ್ಥಿ ಆನ್‌ಲೈನ್ ಪರೀಕ್ಷಾ ಲಾಗಿನ್ (Student Online MCQ Test)
            </h1>
            <p className="text-sm text-slate-300 mt-1.5 leading-relaxed">
              ನಿಮ್ಮ ಇಮೇಲ್ ಐಡಿ ಬಳಸಿ ಲಾಗಿನ್ ಆಗಿ, ವಿಷಯ ಮತ್ತು ಪಾಠಗಳನ್ನು ಆಯ್ಕೆಮಾಡಿ ಬಹು ಆಯ್ಕೆ (MCQ) ಪರೀಕ್ಷೆ ನೀಡಿ.
              ಪರೀಕ್ಷೆಯ ಫಲಿತಾಂಶ ತಕ್ಷಣವೇ ಕಾಣಿಸುತ್ತದೆ ಮತ್ತು ಬಿಡಿಸಿದ ಪ್ರಶ್ನೆ-ಉತ್ತರಗಳ ಪ್ರತಿ ನಿಮ್ಮ ಇಮೇಲ್‌ಗೆ ಕಳುಹಿಸಲಾಗುತ್ತದೆ.
            </p>
          </div>

          <div className="p-6 sm:p-8 space-y-6">
            {/* Option A: One-Click Google Sign-In */}
            <div className="space-y-3">
              <div className="text-xs font-bold uppercase tracking-wider text-slate-500">
                ಆಯ್ಕೆ 1 · Google ಖಾತೆಯ ಮೂಲಕ ತಕ್ಷಣ ಲಾಗಿನ್
              </div>
              <button
                type="button"
                onClick={handleGoogleLogin}
                disabled={isGoogleSigningIn}
                className="w-full min-h-[48px] px-5 py-3 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 active:bg-slate-100 text-slate-900 font-bold text-sm transition-colors flex items-center justify-center gap-3 shadow-2xs disabled:opacity-60"
              >
                {isGoogleSigningIn ? (
                  <Loader2 className="w-5 h-5 animate-spin text-indigo-600" />
                ) : (
                  <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
                    <path
                      fill="#4285F4"
                      d="M23.745 12.27c0-.79-.07-1.54-.19-2.27h-11.3v4.51h6.47c-.29 1.48-1.14 2.73-2.4 3.58v3h3.86c2.26-2.09 3.56-5.17 3.56-8.82z"
                    />
                    <path
                      fill="#34A853"
                      d="M12.255 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96h-3.98v3.09C3.515 21.3 7.565 24 12.255 24z"
                    />
                    <path
                      fill="#FBBC05"
                      d="M5.525 14.29c-.25-.72-.38-1.49-.38-2.29s.14-1.57.38-2.29V6.62h-3.98a11.86 11.86 0 0 0 0 10.76l3.98-3.09z"
                    />
                    <path
                      fill="#EA4335"
                      d="M12.255 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C18.205 1.19 15.495 0 12.255 0c-4.69 0-8.74 2.7-10.71 6.62l3.98 3.09c.95-2.85 3.6-4.96 6.73-4.96z"
                    />
                  </svg>
                )}
                <span>Google ಇಮೇಲ್ ಮೂಲಕ ಲಾಗಿನ್ ಆಗಿ (Sign in with Google)</span>
              </button>
            </div>

            <div className="relative flex items-center">
              <div className="flex-grow border-t border-slate-200" />
              <span className="px-3 text-xs font-semibold text-slate-400">ಅಥವಾ (OR)</span>
              <div className="flex-grow border-t border-slate-200" />
            </div>

            {/* Option B: Direct Student Name + Email ID Login */}
            <form onSubmit={handleDirectEmailLogin} className="space-y-4">
              <div className="text-xs font-bold uppercase tracking-wider text-slate-500">
                ಆಯ್ಕೆ 2 · ನಿಮ್ಮ ಹೆಸರು ಮತ್ತು ಇಮೇಲ್ ಐಡಿ ನಮೂದಿಸಿ ಲಾಗಿನ್ ಆಗಿ
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label
                    htmlFor="student-name-input"
                    className="block text-xs font-bold text-slate-700 mb-1.5"
                  >
                    ವಿದ್ಯಾರ್ಥಿಯ ಹೆಸರು (Student Name) *
                  </label>
                  <div className="relative">
                    <UserIcon className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      id="student-name-input"
                      type="text"
                      required
                      maxLength={100}
                      value={loginName}
                      onChange={e => setLoginName(e.target.value)}
                      placeholder="ಉದಾ: ರಾಹುಲ್ ಕುಮಾರ್"
                      className="w-full min-h-[44px] pl-10 pr-3.5 py-2.5 rounded-xl border border-slate-300 bg-white text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500"
                    />
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="student-email-input"
                    className="block text-xs font-bold text-slate-700 mb-1.5"
                  >
                    ಇಮೇಲ್ ಐಡಿ (Email Address) *
                  </label>
                  <div className="relative">
                    <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      id="student-email-input"
                      type="email"
                      required
                      maxLength={150}
                      value={loginEmail}
                      onChange={e => setLoginEmail(e.target.value)}
                      placeholder="student@gmail.com"
                      className="w-full min-h-[44px] pl-10 pr-3.5 py-2.5 rounded-xl border border-slate-300 bg-white text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500"
                    />
                  </div>
                </div>
              </div>

              {loginError && (
                <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-medium flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-600" />
                  <span>{loginError}</span>
                </div>
              )}

              <button
                type="submit"
                className="w-full min-h-[48px] px-5 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white font-bold text-sm transition-colors flex items-center justify-center gap-2 shadow-sm"
              >
                <span>ಪರೀಕ್ಷಾ ಪುಟಕ್ಕೆ ಮುಂದುವರಿಯಿರಿ (Continue to Online Test)</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </form>
          </div>
        </div>
      </div>
    );
  }

  // ════════════════════════════════════════════════════════════════
  // SCREEN 2: ONLINE TEST CONFIGURATION (SUBJECT, CHAPTERS, MCQ COUNT)
  // ════════════════════════════════════════════════════════════════
  if (stage === 'setup') {
    const presetCounts = [5, 10, 15, 20, 25].filter(n => n <= availableMcqPool.length);

    return (
      <div className="max-w-5xl mx-auto py-2 space-y-5 font-kannada">
        {/* Logged-in Student Header Strip */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-2xs px-5 py-4 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3.5 min-w-0">
            <div className="w-11 h-11 rounded-xl bg-indigo-600 text-white font-bold text-base flex items-center justify-center shrink-0">
              {student.name.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-base font-bold text-slate-900 truncate">{student.name}</h2>
                <span className="text-xs font-medium text-slate-500">
                  ({student.authMethod === 'google' ? 'Google ಪರಿಶೀಲಿತ' : 'ಇಮೇಲ್ ಲಾಗಿನ್'})
                </span>
              </div>
              <div className="text-xs text-slate-600 flex items-center gap-1.5 mt-0.5 truncate">
                <Mail className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <span className="truncate">{student.email}</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {pastAttempts.length > 0 && (
              <button
                type="button"
                onClick={() => setShowHistoryPanel(prev => !prev)}
                className="px-3.5 py-2 rounded-lg text-xs font-bold border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700 inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
              >
                <History className="w-4 h-4 text-indigo-600" />
                <span>ಹಿಂದಿನ ಪರೀಕ್ಷೆಗಳು ({pastAttempts.length})</span>
                {showHistoryPanel ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </button>
            )}
            <button
              type="button"
              onClick={handleStudentLogout}
              className="px-3.5 py-2 rounded-lg text-xs font-bold border border-slate-200 bg-white hover:bg-rose-50 hover:text-rose-700 hover:border-rose-200 text-slate-700 inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>ಬೇರೆ ಇಮೇಲ್ ಲಾಗಿನ್</span>
            </button>
          </div>
        </div>

        {/* Collapsible Past Attempts History */}
        {showHistoryPanel && pastAttempts.length > 0 && (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xs p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900">ನಿಮ್ಮ ಹಿಂದಿನ ಆನ್‌ಲೈನ್ ಪರೀಕ್ಷಾ ಫಲಿತಾಂಶಗಳು</h3>
              <span className="text-xs text-slate-500">ವಿವರ ನೋಡಲು ಕ್ಲಿಕ್ ಮಾಡಿ</span>
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
                  className="text-left p-3.5 rounded-xl border border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/30 transition-colors flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-bold text-slate-900 truncate">
                      {att.subject} · {att.grade}
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      {new Date(att.submittedAt).toLocaleString('en-IN', {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      })}{' '}
                      · ಸಮಯ {formatDurationMMSS(att.timeTakenSeconds)}
                    </div>
                  </div>
                  <div className="text-right shrink-0 tabular-nums">
                    <div className="text-base font-extrabold text-indigo-700">
                      {att.score}/{att.totalQuestions}
                    </div>
                    <div className="text-xs font-bold text-slate-600">{att.percentage}%</div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Main Online MCQ Test Configurator Card */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-6 py-5 border-b border-slate-200 bg-slate-50/70 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-lg sm:text-xl font-bold text-slate-900">
                ಆನ್‌ಲೈನ್ ಬಹು ಆಯ್ಕೆ ಪರೀಕ್ಷೆ (MCQ Only Online Test)
              </h1>
              <p className="text-xs sm:text-sm text-slate-600 mt-0.5">
                ಇಲ್ಲಿ ಕೇವಲ ಬಹು ಆಯ್ಕೆ (MCQ) ಪ್ರಶ್ನೆಗಳು ಮಾತ್ರ ಬರುತ್ತವೆ. ತರಗತಿ, ವಿಷಯ, ಪಾಠಗಳು ಮತ್ತು ಪ್ರಶ್ನೆಗಳ ಸಂಖ್ಯೆಯನ್ನು ಆಯ್ಕೆಮಾಡಿ.
              </p>
            </div>
            <div className="text-xs font-bold text-indigo-700 bg-indigo-50 border border-indigo-200 px-3 py-1.5 rounded-lg tabular-nums whitespace-nowrap shrink-0">
              ಲಭ್ಯವಿರುವ MCQ ಗಳು: {availableMcqPool.length}
            </div>
          </div>

          <div className="p-6 space-y-6">
            {/* Step 1: Class & Subject Selection */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label
                  htmlFor="online-test-grade"
                  className="block text-xs font-bold text-slate-700 mb-1.5"
                >
                  1. ತರಗತಿ ಆಯ್ಕೆಮಾಡಿ (Select Class / Grade)
                </label>
                <select
                  id="online-test-grade"
                  value={selectedGradeKey}
                  onChange={e => setSelectedGradeKey(e.target.value)}
                  className="w-full min-h-[44px] px-3.5 py-2.5 rounded-xl border border-slate-300 bg-white text-sm font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500"
                >
                  {gradeOptions.map(g => (
                    <option key={g.key} value={g.key}>
                      {g.label} ({g.count} ವಿಷಯಗಳು)
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label
                  htmlFor="online-test-subject"
                  className="block text-xs font-bold text-slate-700 mb-1.5"
                >
                  2. ವಿಷಯ ಆಯ್ಕೆಮಾಡಿ (Select Subject)
                </label>
                <select
                  id="online-test-subject"
                  value={selectedBankId}
                  onChange={e => setSelectedBankId(e.target.value)}
                  className="w-full min-h-[44px] px-3.5 py-2.5 rounded-xl border border-slate-300 bg-white text-sm font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500"
                >
                  {subjectsForGrade.map(f => (
                    <option key={f.id} value={f.id}>
                      {f.subject} — {f.medium}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {isLoadingBank && (
              <div className="p-6 rounded-xl border border-slate-200 bg-slate-50 flex items-center justify-center gap-2.5 text-sm font-semibold text-slate-700">
                <Loader2 className="w-5 h-5 animate-spin text-indigo-600" />
                <span>ವಿಷಯದ ಬಹು ಆಯ್ಕೆ (MCQ) ಪ್ರಶ್ನೆಗಳನ್ನು ಲೋಡ್ ಮಾಡಲಾಗುತ್ತಿದೆ...</span>
              </div>
            )}

            {bankLoadError && (
              <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-sm font-medium flex items-center gap-2">
                <AlertCircle className="w-5 h-5 shrink-0 text-rose-600" />
                <span>{bankLoadError}</span>
              </div>
            )}

            {/* Step 2: Chapter Multi-Selection with MCQ counts */}
            {!isLoadingBank && activeBank && (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                      <BookOpen className="w-4 h-4 text-indigo-600" />
                      <span>
                        3. ಪಾಠಗಳನ್ನು ಆಯ್ಕೆಮಾಡಿ (Select Chapters) — ಆಯ್ಕೆಯಾದವು: {selectedChapterIds.length} / {chaptersWithMcqs.length}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={selectAllMcqChapters}
                      className="px-3 py-1.5 rounded-lg text-xs font-bold bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border border-indigo-200 whitespace-nowrap shrink-0"
                    >
                      ಎಲ್ಲಾ ಆಯ್ಕೆಮಾಡಿ
                    </button>
                    <button
                      type="button"
                      onClick={clearAllChapters}
                      className="px-3 py-1.5 rounded-lg text-xs font-bold bg-white text-slate-600 hover:bg-slate-100 border border-slate-200 whitespace-nowrap shrink-0"
                    >
                      ತೆರವುಗೊಳಿಸಿ
                    </button>
                  </div>
                </div>

                {chaptersWithMcqs.length === 0 ? (
                  <div className="p-5 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-sm flex items-start gap-2.5">
                    <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                    <div>
                      <div className="font-bold">ಈ ವಿಷಯದಲ್ಲಿ ಬಹು ಆಯ್ಕೆ (MCQ) ಪ್ರಶ್ನೆಗಳು ಲಭ್ಯವಿಲ್ಲ.</div>
                      <div className="text-xs mt-1 text-amber-800">
                        ದಯವಿಟ್ಟು ಬೇರೆ ತರಗತಿ ಅಥವಾ ವಿಷಯವನ್ನು ಆಯ್ಕೆಮಾಡಿ.
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
                              ? 'bg-slate-50 border-slate-200/70 opacity-55 cursor-not-allowed'
                              : isChecked
                                ? 'bg-indigo-50/60 border-indigo-400 cursor-pointer'
                                : 'bg-white border-slate-200 hover:border-slate-300 cursor-pointer'
                          }`}
                        >
                          <input
                            type="checkbox"
                            disabled={!hasMcq}
                            checked={isChecked}
                            onChange={() => hasMcq && toggleChapter(ch.chapterId)}
                            className="mt-1 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 shrink-0"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="text-xs font-bold text-slate-900 leading-snug line-clamp-2">
                              {ch.chapterNumber ? `${ch.chapterNumber}. ` : `${idx + 1}. `}
                              {ch.chapterName}
                            </div>
                            <div className="text-[11px] font-semibold mt-1 tabular-nums text-slate-500">
                              {hasMcq ? (
                                <span className="text-indigo-700">{ch.mcqCount} MCQ ಪ್ರಶ್ನೆಗಳು</span>
                              ) : (
                                <span>0 MCQ ಪ್ರಶ್ನೆಗಳು</span>
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

            {/* Step 3: Number of Questions Selector */}
            {!isLoadingBank && activeBank && availableMcqPool.length > 0 && (
              <div className="p-4 sm:p-5 rounded-xl bg-slate-50 border border-slate-200 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <label
                      htmlFor="online-test-count"
                      className="text-xs font-bold text-slate-800 flex items-center gap-1.5"
                    >
                      <Layers className="w-4 h-4 text-indigo-600" />
                      <span>4. ಪ್ರಶ್ನೆಗಳ ಸಂಖ್ಯೆ ಆಯ್ಕೆಮಾಡಿ (Number of MCQ Questions)</span>
                    </label>
                    <p className="text-xs text-slate-500 mt-0.5 tabular-nums">
                      ಆಯ್ಕೆಮಾಡಿದ ಪಾಠಗಳಲ್ಲಿ ಒಟ್ಟು <strong>{availableMcqPool.length}</strong> ಬಹು ಆಯ್ಕೆ ಪ್ರಶ್ನೆಗಳು ಲಭ್ಯವಿವೆ (ಗರಿಷ್ಠ 100).
                    </p>
                  </div>

                  <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={shuffleQuestions}
                      onChange={e => setShuffleQuestions(e.target.checked)}
                      className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    <Shuffle className="w-3.5 h-3.5 text-slate-500" />
                    <span>ಪ್ರಶ್ನೆಗಳನ್ನು ಮಿಶ್ರಣಗೊಳಿಸಿ (Shuffle)</span>
                  </label>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {presetCounts.map(n => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setQuestionCount(n)}
                      className={`min-h-[40px] px-4 py-1.5 rounded-lg text-xs font-bold tabular-nums border transition-colors whitespace-nowrap shrink-0 ${
                        questionCount === n
                          ? 'bg-indigo-600 text-white border-indigo-600'
                          : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
                      }`}
                    >
                      {n} ಪ್ರಶ್ನೆಗಳು
                    </button>
                  ))}
                  {availableMcqPool.length > 0 && !presetCounts.includes(availableMcqPool.length) && (
                    <button
                      type="button"
                      onClick={() => setQuestionCount(Math.min(100, availableMcqPool.length))}
                      className={`min-h-[40px] px-4 py-1.5 rounded-lg text-xs font-bold tabular-nums border transition-colors whitespace-nowrap shrink-0 ${
                        questionCount === Math.min(100, availableMcqPool.length)
                          ? 'bg-indigo-600 text-white border-indigo-600'
                          : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
                      }`}
                    >
                      ಎಲ್ಲಾ ({Math.min(100, availableMcqPool.length)})
                    </button>
                  )}

                  <div className="flex items-center gap-2 ml-auto">
                    <span className="text-xs font-semibold text-slate-600">ಸ್ವಂತ ಸಂಖ್ಯೆ:</span>
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
                      className="w-20 min-h-[40px] px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-sm font-bold text-center text-slate-900 tabular-nums focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500"
                    />
                  </div>
                </div>
              </div>
            )}

            {configError && (
              <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-semibold flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                <span>{configError}</span>
              </div>
            )}

            {/* Start Test CTA */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-200">
              <div className="text-xs text-slate-600">
                ಫಲಿತಾಂಶದ ಪ್ರತಿ <strong className="text-slate-900">{student.email}</strong> ಗೆ ಕಳುಹಿಸಲಾಗುತ್ತದೆ.
              </div>
              <button
                type="button"
                disabled={isLoadingBank || availableMcqPool.length === 0 || selectedChapterIds.length === 0}
                onClick={handleStartTest}
                className="min-h-[48px] px-7 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-bold text-sm transition-colors inline-flex items-center gap-2 shadow-sm whitespace-nowrap shrink-0"
              >
                <Play className="w-4 h-4 fill-current" />
                <span>
                  ಆನ್‌ಲೈನ್ ಪರೀಕ್ಷೆ ಪ್ರಾರಂಭಿಸಿ ({Math.min(questionCount, availableMcqPool.length, 100)} ಪ್ರಶ್ನೆಗಳು)
                </span>
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ════════════════════════════════════════════════════════════════
  // SCREEN 3: ACTIVE ONLINE MCQ EXAM RUNNER
  // ════════════════════════════════════════════════════════════════
  if (stage === 'running' && currentQuestion) {
    const selectedOptionIdx = answersMap[currentQuestion.id];
    const unansweredRemaining = testQuestions.length - answeredCount;
    const progressPercent = Math.round(((currentIdx + 1) / testQuestions.length) * 100);

    return (
      <div className="max-w-4xl mx-auto py-2 space-y-4 font-kannada">
        {/* Exam Top Status Bar */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-2xs px-5 py-3.5 flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs font-semibold text-slate-500">
              {activeBank?.metadata?.grade} · {activeBank?.metadata?.subject}
            </div>
            <div className="text-sm font-bold text-slate-900 truncate">
              {student.name} ({student.email})
            </div>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <div className="px-3 py-1.5 rounded-lg bg-slate-100 text-slate-800 text-xs font-bold tabular-nums inline-flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              <span>ಉತ್ತರಿಸಿದವು: {answeredCount}/{testQuestions.length}</span>
            </div>
            <div className="px-3 py-1.5 rounded-lg bg-indigo-50 text-indigo-800 border border-indigo-200 text-xs font-bold tabular-nums inline-flex items-center gap-1.5">
              <Clock className="w-4 h-4 text-indigo-600" />
              <span>{formatDurationMMSS(elapsedSeconds)}</span>
            </div>
            <button
              type="button"
              onClick={() => setShowExitConfirm(true)}
              className="px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-xs font-bold text-slate-600 whitespace-nowrap shrink-0"
            >
              ನಿರ್ಗಮಿಸಿ
            </button>
          </div>
        </div>

        {/* Inline Exit Confirmation */}
        {showExitConfirm && (
          <div className="p-4 rounded-xl bg-amber-50 border border-amber-300 flex flex-wrap items-center justify-between gap-3">
            <div className="text-xs sm:text-sm font-semibold text-amber-900">
              ನೀವು ಪರೀಕ್ಷೆಯನ್ನು ಮಧ್ಯದಲ್ಲಿ ನಿಲ್ಲಿಸಿ ಹಿಂತಿರುಗಲು ಬಯಸುವಿರಾ? ನಿಮ್ಮ ಉತ್ತರಗಳು ಉಳಿಯುವುದಿಲ್ಲ.
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowExitConfirm(false)}
                className="px-3.5 py-1.5 rounded-lg bg-white border border-slate-300 text-xs font-bold text-slate-700"
              >
                ಪರೀಕ್ಷೆ ಮುಂದುವರಿಸಿ
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowExitConfirm(false);
                  setStage('setup');
                }}
                className="px-3.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold"
              >
                ಹೌದು, ನಿರ್ಗಮಿಸಿ
              </button>
            </div>
          </div>
        )}

        {/* Thin Progress Bar */}
        <div className="h-1.5 w-full bg-slate-200 rounded-full overflow-hidden">
          <div
            className="h-full bg-indigo-600 transition-all duration-300"
            style={{ width: `${progressPercent}%` }}
          />
        </div>

        {/* Question Navigator Palette */}
        <div className="bg-white rounded-2xl border border-slate-200 px-4 py-3">
          <div className="text-[11px] font-bold text-slate-500 mb-2">
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
                  className={`w-9 h-9 rounded-lg text-xs font-bold tabular-nums border transition-colors ${
                    isCurrent
                      ? 'bg-indigo-600 text-white border-indigo-600 ring-2 ring-indigo-300'
                      : isAnswered
                        ? 'bg-emerald-50 text-emerald-800 border-emerald-300 hover:bg-emerald-100'
                        : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  {idx + 1}
                </button>
              );
            })}
          </div>
        </div>

        {/* Active Question Card */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 sm:p-7 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-100">
            <span className="text-xs font-bold text-indigo-700 tabular-nums">
              ಪ್ರಶ್ನೆ {currentIdx + 1} / {testQuestions.length}
            </span>
            <span className="text-xs font-medium text-slate-500">
              ಪಾಠ: {currentQuestion.chapterName}
            </span>
          </div>

          {/* Question Text */}
          <div className="text-base sm:text-lg font-semibold text-slate-900 leading-relaxed whitespace-pre-line">
            <MathText text={currentQuestion.question} />
          </div>

          {/* Optional Question Diagram Image */}
          {isSafeImageSrc(currentQuestion.imageUrl) && (
            <div className="my-2 flex justify-center">
              <img
                src={currentQuestion.imageUrl}
                alt={`Question ${currentIdx + 1} diagram`}
                className="max-h-64 w-auto rounded-xl border border-slate-200 bg-white p-2 object-contain"
              />
            </div>
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
                  className={`w-full min-h-[52px] text-left px-4 py-3.5 rounded-xl border transition-all flex items-start gap-3.5 ${
                    isSelected
                      ? 'bg-indigo-50 border-indigo-600 ring-1 ring-indigo-600 text-slate-950'
                      : 'bg-white border-slate-200 hover:border-indigo-300 hover:bg-slate-50 text-slate-800'
                  }`}
                >
                  <span
                    className={`w-7 h-7 rounded-lg text-xs font-extrabold flex items-center justify-center shrink-0 mt-0.5 ${
                      isSelected
                        ? 'bg-indigo-600 text-white'
                        : 'bg-slate-100 text-slate-700 border border-slate-200'
                    }`}
                  >
                    {label}
                  </span>
                  <span className="text-sm sm:text-base font-medium leading-relaxed flex-1">
                    <MathText text={cleanedBody} />
                  </span>
                  {isSelected && (
                    <Check className="w-5 h-5 text-indigo-600 shrink-0 mt-0.5" />
                  )}
                </button>
              );
            })}
          </div>

          {/* Inline Submit Confirmation Banner */}
          {showSubmitConfirm && (
            <div className="p-4 rounded-xl bg-indigo-50 border border-indigo-200 space-y-3">
              <div className="text-sm font-bold text-indigo-950">
                {unansweredRemaining > 0
                  ? `ಇನ್ನೂ ${unansweredRemaining} ಪ್ರಶ್ನೆಗಳಿಗೆ ಉತ್ತರಿಸಿಲ್ಲ. ಆದರೂ ಪರೀಕ್ಷೆಯನ್ನು ಸಲ್ಲಿಸಬೇಕೆ?`
                  : 'ಎಲ್ಲಾ ಪ್ರಶ್ನೆಗಳಿಗೆ ಉತ್ತರಿಸಿದ್ದೀರಿ! ಪರೀಕ್ಷೆಯನ್ನು ಸಲ್ಲಿಸಿ ಫಲಿತಾಂಶ ನೋಡಲು ಸಿದ್ಧರಿದ್ದೀರಾ?'}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={finalizeAndSubmitTest}
                  className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold inline-flex items-center gap-1.5"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>ಹೌದು, ಪರೀಕ್ಷೆ ಸಲ್ಲಿಸಿ ಫಲಿತಾಂಶ ನೋಡಿ</span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowSubmitConfirm(false)}
                  className="px-4 py-2.5 rounded-xl bg-white border border-slate-300 text-slate-700 text-xs font-bold"
                >
                  ರದ್ದುಮಾಡಿ
                </button>
              </div>
            </div>
          )}

          {/* Bottom Navigation Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-slate-200">
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={currentIdx === 0}
                onClick={() => setCurrentIdx(prev => Math.max(0, prev - 1))}
                className="min-h-[42px] px-4 py-2 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-40 text-xs font-bold text-slate-700 inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
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
                  className="min-h-[42px] px-3.5 py-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-500 hover:text-slate-800 hover:bg-slate-50 whitespace-nowrap shrink-0"
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
                  className="min-h-[42px] px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
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
                className="min-h-[42px] px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold inline-flex items-center gap-1.5 shadow-2xs whitespace-nowrap shrink-0"
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
            className="px-4 py-2 rounded-xl bg-white border border-slate-200 hover:bg-slate-50 text-xs font-bold text-slate-800 inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
          >
            <RotateCcw className="w-4 h-4 text-indigo-600" />
            <span>ಹೊಸ ಪರೀಕ್ಷೆ ನೀಡಿ (New Test)</span>
          </button>

          <div className="flex flex-wrap items-center gap-2">
            <a
              href={mailtoHref}
              className="px-4 py-2 rounded-xl bg-white border border-slate-300 hover:bg-slate-50 text-xs font-bold text-slate-800 inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
            >
              <Mail className="w-4 h-4 text-indigo-600" />
              <span>ಇಮೇಲ್ ಆ್ಯಪ್‌ನಲ್ಲಿ ಕಳುಹಿಸಿ</span>
            </a>

            <button
              type="button"
              onClick={() => window.print()}
              className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
            >
              <Printer className="w-4 h-4" />
              <span>ಉತ್ತರ ಪತ್ರಿಕೆ ಮುದ್ರಿಸಿ / PDF ಉಳಿಸಿ</span>
            </button>
          </div>
        </div>

        {/* Hero Score Summary Card */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="bg-[#181c3d] text-white px-6 py-5 flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-indigo-300">
                {schoolName}
              </div>
              <h1 className="text-xl sm:text-2xl font-bold mt-0.5">
                ಆನ್‌ಲೈನ್ ಪರೀಕ್ಷಾ ಫಲಿತಾಂಶ (Instant Test Result)
              </h1>
              <div className="text-xs sm:text-sm text-slate-300 mt-1">
                {activeAttempt.studentName} ({activeAttempt.studentEmail}) · {activeAttempt.grade} · {activeAttempt.subject}
              </div>
            </div>
            <div className="text-right tabular-nums">
              <div className="text-3xl sm:text-4xl font-extrabold text-white">
                {activeAttempt.score} / {activeAttempt.totalQuestions}
              </div>
              <div className="text-sm font-bold text-indigo-300">
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

            {/* Email Copy Delivery Status Panel (Hidden on Print) */}
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
                      ಇಮೇಲ್ ಪ್ರತಿ ಸ್ಥಿತಿ ({activeAttempt.studentEmail})
                    </div>
                    <p className="text-xs text-slate-600 mt-0.5 leading-relaxed">
                      {emailDelivery.message ||
                        'ನಿಮ್ಮ ಬಿಡಿಸಿದ ಪ್ರಶ್ನೆಗಳು ಮತ್ತು ಉತ್ತರಗಳ ಪ್ರತಿಯನ್ನು ನಿಮ್ಮ ಇಮೇಲ್‌ಗೆ ಕಳುಹಿಸಬಹುದು.'}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    disabled={emailDelivery.status === 'sending'}
                    onClick={() => dispatchResultEmail(activeAttempt)}
                    className="px-3.5 py-2 rounded-lg bg-white border border-slate-300 hover:bg-slate-100 text-xs font-bold text-slate-800 inline-flex items-center gap-1.5 disabled:opacity-50 whitespace-nowrap shrink-0"
                  >
                    <Send className="w-3.5 h-3.5 text-indigo-600" />
                    <span>{emailDelivery.status === 'sent' ? 'ಮರುಕಳುಹಿಸಿ' : 'ಇಮೇಲ್ ಕಳುಹಿಸಿ'}</span>
                  </button>
                </div>
              </div>

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

                  {isSafeImageSrc(item.imageUrl) && (
                    <div className="my-1">
                      <img
                        src={item.imageUrl}
                        alt={`Question ${originalIndex} diagram`}
                        className="max-h-48 w-auto rounded-lg border border-slate-200 p-1.5 bg-white object-contain"
                      />
                    </div>
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

                  {isSafeImageSrc(item.answerImageUrl) && (
                    <div className="my-1">
                      <img
                        src={item.answerImageUrl}
                        alt={`Answer ${originalIndex} diagram`}
                        className="max-h-48 w-auto rounded-lg border border-slate-200 p-1.5 bg-white object-contain"
                      />
                    </div>
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
