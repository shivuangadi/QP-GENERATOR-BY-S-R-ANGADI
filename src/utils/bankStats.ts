/**
 * Dynamic Question Bank Statistics & Semester Metadata Utility
 * Computes live total, Semester 1, Semester 2, and strict MCQ counts
 * across all built-in, server-saved, and Firebase question banks.
 */

import { useEffect, useState, useMemo } from 'react';
import { IndexEntry, QuestionBank, Chapter } from '../types/questionBank.ts';
import { loadQuestionBankByPath } from '../services/dataLoader.ts';
import { isStrictMcqQuestion } from './mcqGrading.ts';

export type SemesterSelection = 'sem1' | 'sem2' | 'all';

export interface BankDynamicStats {
  bankId: string;
  totalQuestions: number;
  sem1Questions: number;
  sem2Questions: number;
  totalMcq: number;
  sem1Mcq: number;
  sem2Mcq: number;
  totalChapters: number;
  hasExplicitSemesters: boolean;
  loaded: boolean;
}

export interface SemesterPeriodMeta {
  id: SemesterSelection;
  titleKn: string;
  titleEn: string;
  periodKn: string;
  shortPeriodKn: string;
  monthsKn: string;
}

export const SEMESTER_META: Record<SemesterSelection, SemesterPeriodMeta> = {
  sem1: {
    id: 'sem1',
    titleKn: 'ಮೊದಲನೇ ಸೆಮಿಸ್ಟರ್',
    titleEn: 'First Semester',
    periodKn: '1ನೇ ಸೆಮಿಸ್ಟರ್ · ಜೂನ್ – ಅಕ್ಟೋಬರ್',
    shortPeriodKn: 'ಮೊದಲನೇ ಸೆಮಿಸ್ಟರ್ (FA-1, FA-2, SA-1)',
    monthsKn: 'ಜೂನ್ – ಅಕ್ಟೋಬರ್',
  },
  sem2: {
    id: 'sem2',
    titleKn: 'ಎರಡನೇ ಸೆಮಿಸ್ಟರ್',
    titleEn: 'Second Semester',
    periodKn: '2ನೇ ಸೆಮಿಸ್ಟರ್ · ನವೆಂಬರ್ – ಮಾರ್ಚ್',
    shortPeriodKn: 'ಎರಡನೇ ಸೆಮಿಸ್ಟರ್ (FA-3, FA-4, SA-2)',
    monthsKn: 'ನವೆಂಬರ್ – ಮಾರ್ಚ್',
  },
  all: {
    id: 'all',
    titleKn: 'ಪೂರ್ಣ ವರ್ಷ (ಎರಡೂ ಸೆಮಿಸ್ಟರ್)',
    titleEn: 'Full Year · Both Semesters',
    periodKn: 'ಪೂರ್ಣ ವರ್ಷ · ಜೂನ್ – ಮಾರ್ಚ್',
    shortPeriodKn: 'ಪೂರ್ಣ ಪಠ್ಯಕ್ರಮ (ಸೆಮಿಸ್ಟರ್ 1 & 2)',
    monthsKn: 'ಜೂನ್ – ಮಾರ್ಚ್',
  },
};

export function getSemesterPeriodMeta(semester: SemesterSelection): SemesterPeriodMeta {
  return SEMESTER_META[semester] || SEMESTER_META.all;
}

/**
 * Filter chapters for a given semester consistently across Setup, Online Test, and Card Stats.
 * Mirrors App.tsx visibleChapters fallback so card counts match chapter counts 1:1.
 */
export function filterChaptersBySemester(
  chapters: Chapter[],
  semester: SemesterSelection
): Chapter[] {
  if (!Array.isArray(chapters) || chapters.length === 0) return [];
  if (semester === 'all') return chapters;

  const targetSem = semester === 'sem1' ? 1 : 2;
  const explicitlyTagged = chapters.filter(c => c.semester === targetSem);
  if (explicitlyTagged.length > 0) {
    return explicitlyTagged;
  }

  // Check if chapters have explicit tags ONLY for the other semester
  const anyExplicit = chapters.some(c => c.semester === 1 || c.semester === 2);
  if (anyExplicit) {
    // Bank explicitly tagged only the other semester — fall back to all chapters if empty
    // so teachers aren't stranded, OR return 0 if we want exact split; match App.tsx behavior:
    return chapters;
  }

  // No semester tags on any chapter: split evenly into first half (Sem 1) and second half (Sem 2)
  if (chapters.length === 1) return chapters;
  const mid = Math.ceil(chapters.length / 2);
  return semester === 'sem1' ? chapters.slice(0, mid) : chapters.slice(mid);
}

/**
 * Compute exact question & strict MCQ statistics from a loaded QuestionBank.
 */
export function computeBankStatsFromBank(
  bank: QuestionBank,
  bankId: string
): BankDynamicStats {
  const chapters = Array.isArray(bank?.chapters) ? bank.chapters : [];
  let totalQuestions = 0;
  let totalMcq = 0;

  for (const ch of chapters) {
    const qs = Array.isArray(ch.questions) ? ch.questions : [];
    totalQuestions += qs.length;
    for (const q of qs) {
      if (isStrictMcqQuestion(q)) totalMcq += 1;
    }
  }

  const hasExplicitSemesters = chapters.some(c => c.semester === 1 || c.semester === 2);
  const sem1Chapters = filterChaptersBySemester(chapters, 'sem1');
  const sem2Chapters = filterChaptersBySemester(chapters, 'sem2');

  let sem1Questions = 0;
  let sem1Mcq = 0;
  for (const ch of sem1Chapters) {
    const qs = Array.isArray(ch.questions) ? ch.questions : [];
    sem1Questions += qs.length;
    for (const q of qs) {
      if (isStrictMcqQuestion(q)) sem1Mcq += 1;
    }
  }

  let sem2Questions = 0;
  let sem2Mcq = 0;
  for (const ch of sem2Chapters) {
    const qs = Array.isArray(ch.questions) ? ch.questions : [];
    sem2Questions += qs.length;
    for (const q of qs) {
      if (isStrictMcqQuestion(q)) sem2Mcq += 1;
    }
  }

  return {
    bankId,
    totalQuestions,
    sem1Questions,
    sem2Questions,
    totalMcq,
    sem1Mcq,
    sem2Mcq,
    totalChapters: chapters.length,
    hasExplicitSemesters,
    loaded: true,
  };
}

/**
 * Resolve the dynamic count for a single bank entry for a chosen semester & mode.
 */
export function getBankCountForSemester(
  stats: BankDynamicStats | undefined,
  entry: IndexEntry | undefined,
  semester: SemesterSelection,
  mcqOnly = false
): number {
  if (stats?.loaded) {
    if (mcqOnly) {
      if (semester === 'sem1') return stats.sem1Mcq;
      if (semester === 'sem2') return stats.sem2Mcq;
      return stats.totalMcq;
    }
    if (semester === 'sem1') return stats.sem1Questions;
    if (semester === 'sem2') return stats.sem2Questions;
    return stats.totalQuestions;
  }

  // Instant pre-hydration fallback from IndexEntry metadata while background scan completes
  const fallbackTotal = Number(entry?.totalQuestions) || 0;
  if (fallbackTotal <= 0) return 0;
  if (mcqOnly) {
    // Conservative estimate before full bank scan finishes
    return 0;
  }
  if (semester === 'all') return fallbackTotal;
  return Math.round(fallbackTotal / 2);
}

// Module-level persistent stats cache so switching views (Setup <-> Online Test) is instantaneous
const globalStatsCache = new Map<string, BankDynamicStats>();

/**
 * React hook that keeps dynamic per-bank question & MCQ stats freshly computed
 * across all availableFiles (built-in, server, and Firebase).
 */
export function useDynamicBankStats(
  availableFiles: IndexEntry[],
  activeBank?: QuestionBank | null,
  activeBankId?: string
): {
  statsMap: Record<string, BankDynamicStats>;
  isScanning: boolean;
} {
  const [statsMap, setStatsMap] = useState<Record<string, BankDynamicStats>>(() => {
    const initial: Record<string, BankDynamicStats> = {};
    globalStatsCache.forEach((v, k) => {
      initial[k] = v;
    });
    return initial;
  });
  const [isScanning, setIsScanning] = useState<boolean>(false);

  // Immediately sync activeBank changes (e.g. after editing/rebuilding/importing)
  useEffect(() => {
    if (!activeBank || !activeBankId) return;
    const computed = computeBankStatsFromBank(activeBank, activeBankId);
    globalStatsCache.set(activeBankId, computed);
    setStatsMap(prev => ({ ...prev, [activeBankId]: computed }));
  }, [activeBank, activeBankId]);

  // Stable key list so effect runs only when bank inventory changes
  const fileSignature = useMemo(
    () => availableFiles.map(f => `${f.id}:${f.totalQuestions ?? ''}`).join('|'),
    [availableFiles]
  );

  // Background hydrate stats for all availableFiles (uses dataLoader's built-in bankCache)
  useEffect(() => {
    if (availableFiles.length === 0) return;

    let cancelled = false;
    const missing = availableFiles.filter(f => {
      const cached = globalStatsCache.get(f.id);
      if (!cached) return true;
      // Re-scan if index totalQuestions changed (e.g. bank was rebuilt/updated)
      if (typeof f.totalQuestions === 'number' && f.totalQuestions > 0 && cached.totalQuestions !== f.totalQuestions) {
        return true;
      }
      return false;
    });

    if (missing.length === 0) return;

    async function hydrateMissing() {
      setIsScanning(true);
      const BATCH_SIZE = 4;
      for (let i = 0; i < missing.length; i += BATCH_SIZE) {
        if (cancelled) break;
        const batch = missing.slice(i, i + BATCH_SIZE);
        const results = await Promise.allSettled(
          batch.map(async entry => {
            const bank = await loadQuestionBankByPath(entry.path);
            return computeBankStatsFromBank(bank, entry.id);
          })
        );

        if (cancelled) break;
        const updates: Record<string, BankDynamicStats> = {};
        let hasUpdates = false;
        for (const res of results) {
          if (res.status === 'fulfilled') {
            globalStatsCache.set(res.value.bankId, res.value);
            updates[res.value.bankId] = res.value;
            hasUpdates = true;
          }
        }
        if (hasUpdates) {
          setStatsMap(prev => ({ ...prev, ...updates }));
        }
      }
      if (!cancelled) setIsScanning(false);
    }

    hydrateMissing();
    return () => {
      cancelled = true;
    };
  }, [fileSignature, availableFiles]);

  return { statsMap, isScanning };
}
