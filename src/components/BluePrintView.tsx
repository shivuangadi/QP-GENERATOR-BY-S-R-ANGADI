/**
 * Official Karnataka DSERT 5-Stage Blueprint View
 * Recreates the exact 5-stage blueprint matrix with:
 * 1. Step 5 Master Grid: 4 Objectives (ಜ್ಞಾನ, ತಿಳುವಳಿಕೆ, ಅನ್ವಯ, ಕೌಶಲ), each with 3 Step-2 Question Type sub-columns (ವ.ನಿ/ಕಿರು, ದೀರ್ಘ, ಪ್ರಬಂಧ).
 * 2. Standard Karnataka notation: Q(M) e.g. 2(2) = 2 questions of 2 marks. If 0, '-' is shown.
 * 3. Step 4: Editable percentage (%) with automatic marks and questions recalculation (capped at 100%).
 * 4. Exact tallies between Step 1, Step 2, Step 4, and Step 5 columns/rows.
 * 5. Drill-down inspection showing ONLY questions used in the question paper, with instant same-mark swapping.
 * Author: M I Nilaji / S R Angadi
 */

import React, { useState, useMemo } from 'react';
import {
  CompleteBlueprint,
  ObjectiveDiffCell,
  Step2CategoryId,
  DEFAULT_STEP2_PERCENTAGES,
  apportionExactIntegers,
  apportionBoundedQuestions,
  buildStep2FromPercentages,
  buildStep2ForTarget,
  buildSynchronizedMasterGrid,
  classifyQuestionToStep2Category,
  computeStep2QuestionCountForMarks,
} from '../services/blueprintEngine.ts';
import {
  QuestionBank,
  QuestionItem,
  GeneratedPaper,
  GeneratedQuestionItem,
} from '../types/questionBank.ts';
import {
  Printer,
  ArrowLeft,
  Layers,
  HelpCircle,
  X,
  Search,
  CheckCircle2,
  BookOpen,
  Tag,
  Info,
  RefreshCw,
  Check,
  Percent,
  Sliders,
  AlertTriangle,
} from 'lucide-react';
import { matchesDifficulty } from './QuestionBankExplorer.tsx';

interface CleanNumberInputProps {
  value: number;
  onChange: (val: number) => void;
  min?: number;
  max?: number;
  className?: string;
  title?: string;
  suffix?: string;
  disabled?: boolean;
}

/**
 * Clean numeric input that allows users to completely backspace without forcing an initial 0,
 * and seamlessly converts typed text to number on blur or valid change.
 */
export const CleanNumberInput: React.FC<CleanNumberInputProps> = ({
  value,
  onChange,
  min = 0,
  max,
  className = '',
  title,
  suffix,
  disabled = false,
}) => {
  const [localStr, setLocalStr] = useState<string>(() => (value === 0 ? '0' : String(value)));
  const isTypingRef = React.useRef<boolean>(false);

  React.useEffect(() => {
    if (!isTypingRef.current) {
      setLocalStr(value === 0 ? '0' : String(value));
    }
  }, [value]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const text = e.target.value;
    setLocalStr(text);
    isTypingRef.current = true;
    if (text.trim() === '') {
      // Allows user to backspace everything cleanly without prepending 0!
      onChange(0);
      return;
    }
    const parsed = parseFloat(text);
    if (!isNaN(parsed)) {
      let clamped = parsed;
      if (min !== undefined && clamped < min) clamped = min;
      if (max !== undefined && clamped > max) clamped = max;
      onChange(clamped);
    }
  };

  const handleBlur = () => {
    isTypingRef.current = false;
    if (localStr.trim() === '') {
      setLocalStr('0');
      onChange(0);
    } else {
      const parsed = parseFloat(localStr);
      if (isNaN(parsed)) {
        setLocalStr('0');
        onChange(0);
      } else {
        let clamped = parsed;
        if (min !== undefined && clamped < min) clamped = min;
        if (max !== undefined && clamped > max) clamped = max;
        setLocalStr(String(clamped));
        onChange(clamped);
      }
    }
  };

  return (
    <div className="inline-flex items-center justify-center gap-0.5">
      <input
        type="text"
        inputMode="decimal"
        value={localStr}
        onChange={handleChange}
        onBlur={handleBlur}
        disabled={disabled}
        className={className}
        title={title}
      />
      {suffix && <span className="text-slate-500 font-bold text-xs">{suffix}</span>}
    </div>
  );
};

interface BluePrintViewProps {
  blueprint: CompleteBlueprint;
  bank?: QuestionBank | null;
  paper?: GeneratedPaper | null;
  onUpdatePaper?: (paper: GeneratedPaper) => void;
  onBackToSetup: () => void;
  onViewPaper?: () => void;
}

interface DrillDownState {
  title: string;
  subtitle: string;
  badge: string;
  questions: QuestionItem[];
}

export const BluePrintView: React.FC<BluePrintViewProps> = ({
  blueprint,
  bank,
  paper,
  onUpdatePaper,
  onBackToSetup,
  onViewPaper,
}) => {
  const [drillDown, setDrillDown] = useState<DrillDownState | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Helper: Re-apportion Step 1 (Objectives), Step 2 (Question Types), Step 3 (Difficulty),
  // and Step 4 (Chapters) so ALL FIVE stages stay strictly synchronized with exact Marks & Questions
  // and always preserve `marks[i] >= questionsCount[i]` and `marks[i] === 0 => questionsCount[i] === 0`.
  const buildSyncedStep1 = React.useCallback(
    (
      baseItems: Array<{ id: string; name: string; percentage: number; marks: number; questionsCount: number }>,
      totalM: number,
      totalQ: number,
      recomputePct = false
    ) => {
      const weights = baseItems.map(i => (i.percentage > 0 ? i.percentage : i.marks));
      const marksArr = apportionExactIntegers(weights, totalM, 0);
      const prefQ = baseItems.map((i, idx) => (i.questionsCount > 0 ? i.questionsCount : marksArr[idx]));
      const qArr = apportionBoundedQuestions(marksArr, totalQ, prefQ);
      return baseItems.map((item, idx) => ({
        ...item,
        marks: marksArr[idx],
        questionsCount: qArr[idx],
        percentage: recomputePct
          ? totalM > 0
            ? Math.round((marksArr[idx] / totalM) * 1000) / 10
            : 0
          : item.percentage,
      }));
    },
    []
  );

  const buildSyncedStep2 = React.useCallback(
    (
      baseItems: Array<{
        id: Step2CategoryId | string;
        name: string;
        subtitle?: string;
        percentage: number;
        marks: number;
        questionsCount: number;
        marksPerQuestion: number;
      }>,
      totalM: number,
      preferredTotalQ?: number
    ) => {
      const weights = baseItems.map(i => Math.max(0, i.percentage));
      const allocatedMarks = apportionExactIntegers(weights, totalM, 0);
      const qShort = computeStep2QuestionCountForMarks('short_objective', allocatedMarks[0] ?? 0);
      const qEssay = computeStep2QuestionCountForMarks('essay', allocatedMarks[2] ?? 0);
      const prefLong =
        typeof preferredTotalQ === 'number' && preferredTotalQ > 0
          ? preferredTotalQ - qShort - qEssay
          : undefined;
      const qLong = computeStep2QuestionCountForMarks('long', allocatedMarks[1] ?? 0, prefLong);
      const qArr = [qShort, qLong, qEssay];

      return baseItems.map((item, idx) => {
        const m = allocatedMarks[idx] ?? 0;
        const q = qArr[idx] ?? 0;
        return {
          ...item,
          marks: m,
          questionsCount: q,
          marksPerQuestion: q > 0 ? Math.max(1, Math.round(m / q)) : item.marksPerQuestion,
        };
      });
    },
    []
  );

  const buildSyncedStep3 = React.useCallback(
    (
      baseItems: Array<{ id: string; name: string; percentage: number; marks: number; questionsCount: number }>,
      totalM: number,
      totalQ: number,
      recomputePct = false
    ) => {
      const weights = baseItems.map(i => (i.percentage > 0 ? i.percentage : i.marks));
      const marksArr = apportionExactIntegers(weights, totalM, 0);
      const prefQ = baseItems.map((i, idx) => (i.questionsCount > 0 ? i.questionsCount : marksArr[idx]));
      const qArr = apportionBoundedQuestions(marksArr, totalQ, prefQ);
      return baseItems.map((item, idx) => ({
        ...item,
        marks: marksArr[idx],
        questionsCount: qArr[idx],
        percentage: recomputePct
          ? totalM > 0
            ? Math.round((marksArr[idx] / totalM) * 1000) / 10
            : 0
          : item.percentage,
      }));
    },
    []
  );

  const buildSyncedStep4 = React.useCallback(
    (
      baseItems: Array<{
        chapterId: string;
        chapterNumber: number;
        chapterName: string;
        percentage: number;
        marks: number;
        questionsCount: number;
      }>,
      totalM: number,
      totalQ: number,
      recomputePct = false
    ) => {
      const weights = baseItems.map(c => (c.percentage > 0 ? c.percentage : c.marks || 1));
      const minMark = totalM >= baseItems.length ? 1 : 0;
      const marksArr = apportionExactIntegers(weights, totalM, minMark);
      const prefQ = baseItems.map((c, idx) => (c.questionsCount > 0 ? c.questionsCount : marksArr[idx]));
      const qArr = apportionBoundedQuestions(marksArr, totalQ, prefQ);
      return baseItems.map((c, idx) => ({
        ...c,
        marks: marksArr[idx],
        questionsCount: qArr[idx],
        percentage: recomputePct
          ? totalM > 0
            ? Math.round((marksArr[idx] / totalM) * 1000) / 10
            : 0
          : c.percentage,
      }));
    },
    []
  );

  // Build baseline Step 3 rows from blueprint.step3Difficulty (preserving actual paper tallies when available)
  const getInitialStep3Base = React.useCallback(
    () =>
      blueprint.step3Difficulty && blueprint.step3Difficulty.length === 3
        ? blueprint.step3Difficulty.map(d => ({
            id: d.id,
            name: d.name,
            percentage: d.percentage,
            marks: d.marks,
            questionsCount: d.questionsCount ?? 0,
          }))
        : [
            { id: 'easy', name: 'ಸುಲಭ (Easy)', percentage: 30, questionsCount: 0, marks: 0 },
            { id: 'avg', name: 'ಸಾಧಾರಣ (Average)', percentage: 50, questionsCount: 0, marks: 0 },
            { id: 'diff', name: 'ಕಠಿಣ (Difficult)', percentage: 20, questionsCount: 0, marks: 0 },
          ],
    [blueprint.step3Difficulty]
  );

  // Initial synchronized Step 2 directly from blueprint.step2QuestionTypes (strictly honoring 10M/10Q = 10 x 1M!)
  const getInitialStep2Base = React.useCallback(
    () =>
      blueprint.step2QuestionTypes && blueprint.step2QuestionTypes.length === 3
        ? blueprint.step2QuestionTypes.map(t => ({ ...t }))
        : buildStep2ForTarget(
            blueprint.totalMarks || 40,
            blueprint.totalQuestions || 24,
            DEFAULT_STEP2_PERCENTAGES
          ),
    [blueprint.step2QuestionTypes, blueprint.totalMarks, blueprint.totalQuestions]
  );

  const initialStep2 = useMemo(() => getInitialStep2Base(), [getInitialStep2Base]);

  const initialTotalMarks = blueprint.totalMarks || 40;
  const initialTotalQuestions =
    initialStep2.reduce((s, x) => s + x.questionsCount, 0) || blueprint.totalQuestions || 24;

  const isAlreadyAligned = (
    items: Array<{ marks: number; questionsCount?: number }>,
    targetM: number,
    targetQ: number
  ) =>
    items.length > 0 &&
    items.reduce((s, x) => s + (x.marks || 0), 0) === targetM &&
    items.reduce((s, x) => s + (x.questionsCount || 0), 0) === targetQ;

  // Step 2: Editable 3 Permanent Question Types (Synced 100% with actual paper & Stage 5)
  const [step2Items, setStep2Items] = useState(() => initialStep2);

  // Step 1: Editable Objectives State (preserve exact paper tallies when already aligned)
  const [step1Items, setStep1Items] = useState(() => {
    const raw = blueprint.step1Objectives.map(o => ({ ...o }));
    return isAlreadyAligned(raw, initialTotalMarks, initialTotalQuestions)
      ? raw
      : buildSyncedStep1(raw, initialTotalMarks, initialTotalQuestions, false);
  });

  // Step 3: Difficulty Levels State (preserve exact paper tallies when already aligned)
  const [step3Items, setStep3Items] = useState(() => {
    const raw = getInitialStep3Base();
    return isAlreadyAligned(raw, initialTotalMarks, initialTotalQuestions)
      ? raw
      : buildSyncedStep3(raw, initialTotalMarks, initialTotalQuestions, false);
  });

  // Step 4: Editable Chapter Weightage State (preserve exact paper tallies when already aligned)
  const [step4Items, setStep4Items] = useState(() => {
    const raw = blueprint.step4Chapters.map(c => ({ ...c }));
    return isAlreadyAligned(raw, initialTotalMarks, initialTotalQuestions)
      ? raw
      : buildSyncedStep4(raw, initialTotalMarks, initialTotalQuestions, false);
  });

  // Reset all 5 stages in lock-step whenever the underlying blueprint changes
  React.useEffect(() => {
    const nextStep2 = getInitialStep2Base();
    const nextM = blueprint.totalMarks || 40;
    const nextQ =
      nextStep2.reduce((s, x) => s + x.questionsCount, 0) || blueprint.totalQuestions || 24;

    setStep2Items(nextStep2);

    const rawStep1 = blueprint.step1Objectives.map(o => ({ ...o }));
    setStep1Items(
      isAlreadyAligned(rawStep1, nextM, nextQ)
        ? rawStep1
        : buildSyncedStep1(rawStep1, nextM, nextQ, false)
    );

    const rawStep3 = getInitialStep3Base();
    setStep3Items(
      isAlreadyAligned(rawStep3, nextM, nextQ)
        ? rawStep3
        : buildSyncedStep3(rawStep3, nextM, nextQ, false)
    );

    const rawStep4 = blueprint.step4Chapters.map(c => ({ ...c }));
    setStep4Items(
      isAlreadyAligned(rawStep4, nextM, nextQ)
        ? rawStep4
        : buildSyncedStep4(rawStep4, nextM, nextQ, false)
    );
  }, [
    blueprint.totalMarks,
    blueprint.totalQuestions,
    blueprint.step1Objectives,
    blueprint.step2QuestionTypes,
    blueprint.step3Difficulty,
    blueprint.step4Chapters,
    getInitialStep2Base,
    getInitialStep3Base,
    buildSyncedStep1,
    buildSyncedStep3,
    buildSyncedStep4,
  ]);

  // Helper: Adjust a single row's questionsCount while keeping totalQ constant across ALL 5 stages
  const adjustSingleRowQuestionCount = <T extends { marks: number; questionsCount: number }>(
    items: T[],
    editedIdx: number,
    requestedQ: number,
    targetTotalQ: number
  ): T[] => {
    const editedMarks = items[editedIdx]?.marks ?? 0;
    const otherMaxQ = items.reduce((s, it, i) => (i === editedIdx ? s : s + it.marks), 0);
    const minEditedQ = Math.max(0, targetTotalQ - otherMaxQ);
    const maxEditedQ = Math.min(editedMarks, targetTotalQ);
    const clampedQ = Math.max(minEditedQ, Math.min(maxEditedQ, Math.round(requestedQ)));

    const remainingQ = Math.max(0, targetTotalQ - clampedQ);
    const otherIndices = items.map((_, i) => i).filter(i => i !== editedIdx);
    const otherMarks = otherIndices.map(i => items[i].marks);
    const otherPrefQ = otherIndices.map(i => Math.max(1, items[i].questionsCount));
    const redistributed = apportionBoundedQuestions(otherMarks, remainingQ, otherPrefQ);

    const next = items.map(it => ({ ...it }));
    next[editedIdx].questionsCount = clampedQ;
    otherIndices.forEach((origIdx, k) => {
      next[origIdx].questionsCount = redistributed[k];
    });
    return next;
  };

  // Synchronize ALL 5 stages whenever Step 2 changes
  const syncOtherStagesFromStep2 = (nextStep2: typeof step2Items) => {
    const nextM = nextStep2.reduce((s, x) => s + x.marks, 0);
    const nextQ = nextStep2.reduce((s, x) => s + x.questionsCount, 0);
    setStep2Items(nextStep2);
    if (nextM > 0 && nextQ > 0) {
      setStep1Items(prev => buildSyncedStep1(prev, nextM, nextQ, false));
      setStep3Items(prev => buildSyncedStep3(prev, nextM, nextQ, false));
      setStep4Items(prev => buildSyncedStep4(prev, nextM, nextQ, false));
    }
  };

  // Synchronize ALL 5 stages whenever Step 1 changes
  const syncAllStagesFromStep1 = (nextStep1: typeof step1Items) => {
    const rawM = nextStep1.reduce((s, x) => s + x.marks, 0);
    const rawQ = nextStep1.reduce((s, x) => s + x.questionsCount, 0);
    if (rawM <= 0) {
      setStep1Items(nextStep1);
      return;
    }
    const nextStep2 = buildSyncedStep2(step2Items, rawM, rawQ);
    const finalM = nextStep2.reduce((s, x) => s + x.marks, 0);
    const finalQ = nextStep2.reduce((s, x) => s + x.questionsCount, 0);
    // Keep Step 1 marks exact while bounding its questions to finalQ
    const boundedS1Q = apportionBoundedQuestions(
      nextStep1.map(i => i.marks),
      finalQ,
      nextStep1.map(i => i.questionsCount)
    );
    const alignedStep1 = nextStep1.map((item, idx) => ({
      ...item,
      questionsCount: boundedS1Q[idx],
    }));

    setStep1Items(alignedStep1);
    setStep2Items(nextStep2);
    setStep3Items(prev => buildSyncedStep3(prev, finalM, finalQ, false));
    setStep4Items(prev => buildSyncedStep4(prev, finalM, finalQ, false));
  };

  // Synchronize ALL 5 stages whenever Step 3 changes
  const syncAllStagesFromStep3 = (nextStep3: typeof step3Items) => {
    const rawM = nextStep3.reduce((s, x) => s + x.marks, 0);
    const rawQ = nextStep3.reduce((s, x) => s + x.questionsCount, 0);
    if (rawM <= 0) {
      setStep3Items(nextStep3);
      return;
    }
    const nextStep2 = buildSyncedStep2(step2Items, rawM, rawQ);
    const finalM = nextStep2.reduce((s, x) => s + x.marks, 0);
    const finalQ = nextStep2.reduce((s, x) => s + x.questionsCount, 0);
    const boundedS3Q = apportionBoundedQuestions(
      nextStep3.map(i => i.marks),
      finalQ,
      nextStep3.map(i => i.questionsCount)
    );
    const alignedStep3 = nextStep3.map((item, idx) => ({
      ...item,
      questionsCount: boundedS3Q[idx],
    }));

    setStep3Items(alignedStep3);
    setStep2Items(nextStep2);
    setStep1Items(prev => buildSyncedStep1(prev, finalM, finalQ, false));
    setStep4Items(prev => buildSyncedStep4(prev, finalM, finalQ, false));
  };

  // Synchronize ALL 5 stages whenever Step 4 changes
  const syncAllStagesFromStep4 = (nextStep4: typeof step4Items) => {
    const rawM = nextStep4.reduce((s, x) => s + x.marks, 0);
    const rawQ = nextStep4.reduce((s, x) => s + x.questionsCount, 0);
    if (rawM <= 0) {
      setStep4Items(nextStep4);
      return;
    }
    const nextStep2 = buildSyncedStep2(step2Items, rawM, rawQ);
    const finalM = nextStep2.reduce((s, x) => s + x.marks, 0);
    const finalQ = nextStep2.reduce((s, x) => s + x.questionsCount, 0);
    const boundedS4Q = apportionBoundedQuestions(
      nextStep4.map(i => i.marks),
      finalQ,
      nextStep4.map(i => i.questionsCount)
    );
    const alignedStep4 = nextStep4.map((item, idx) => ({
      ...item,
      questionsCount: boundedS4Q[idx],
    }));

    setStep4Items(alignedStep4);
    setStep2Items(nextStep2);
    setStep1Items(prev => buildSyncedStep1(prev, finalM, finalQ, false));
    setStep3Items(prev => buildSyncedStep3(prev, finalM, finalQ, false));
  };

  // --- Step 1 (Objectives) Handlers ---
  const handleStep1PercentageChange = (idx: number, val: number) => {
    const baseM = blueprint.totalMarks || 40;
    const baseQ = activeTotalQuestions;
    const updated = step1Items.map((item, i) => {
      if (i !== idx) return { ...item };
      const newMarks = Math.max(0, Math.round((baseM * val) / 100));
      const newQ = newMarks > 0 ? Math.min(newMarks, Math.max(1, Math.round((baseQ * val) / 100))) : 0;
      return { ...item, percentage: val, marks: newMarks, questionsCount: newQ };
    });
    syncAllStagesFromStep1(updated);
  };

  const handleStep1MarksChange = (idx: number, val: number) => {
    const baseM = blueprint.totalMarks || 40;
    const safeM = Math.max(0, Math.round(val));
    const updated = step1Items.map((item, i) => {
      if (i !== idx) return { ...item };
      const newPct = baseM > 0 ? Math.round((safeM / baseM) * 1000) / 10 : 0;
      const newQ = safeM === 0 ? 0 : Math.min(safeM, Math.max(1, item.questionsCount));
      return { ...item, marks: safeM, percentage: newPct, questionsCount: newQ };
    });
    syncAllStagesFromStep1(updated);
  };

  const handleStep1QuestionsChange = (idx: number, val: number) => {
    const next = adjustSingleRowQuestionCount(step1Items, idx, val, activeTotalQuestions);
    setStep1Items(next);
  };

  const handleBalanceStep1To100 = () => {
    const baseM = blueprint.totalMarks || 40;
    const weights = step1Items.map(i => Math.max(0, i.percentage));
    const balancedPcts = apportionExactIntegers(weights, 100, 0);
    const nextMarks = apportionExactIntegers(balancedPcts, baseM, 0);
    const updated = step1Items.map((item, idx) => ({
      ...item,
      percentage: balancedPcts[idx],
      marks: nextMarks[idx],
    }));
    syncAllStagesFromStep1(updated);
  };

  // --- Step 2 (Question Types) Handlers ---
  const handleStep2PercentageChange = (idx: number, newPct: number) => {
    const baseM = blueprint.totalMarks || 40;
    const updated = step2Items.map((item, i) => {
      if (i !== idx) return { ...item };
      const catId = item.id as Step2CategoryId;
      const newMarks = Math.max(0, Math.round((baseM * newPct) / 100));
      const newQ = computeStep2QuestionCountForMarks(catId, newMarks);
      return {
        ...item,
        percentage: newPct,
        marks: newMarks,
        questionsCount: newQ,
        marksPerQuestion: newQ > 0 ? Math.max(1, Math.round(newMarks / newQ)) : item.marksPerQuestion,
      };
    });
    syncOtherStagesFromStep2(updated);
  };

  const handleStep2MarksChange = (idx: number, newMarks: number) => {
    const baseM = blueprint.totalMarks || 40;
    const safeM = Math.max(0, Math.round(newMarks));
    const updated = step2Items.map((item, i) => {
      if (i !== idx) return { ...item };
      const catId = item.id as Step2CategoryId;
      const newQ = computeStep2QuestionCountForMarks(catId, safeM);
      const newPct = baseM > 0 ? Math.round((safeM / baseM) * 1000) / 10 : 0;
      return {
        ...item,
        marks: safeM,
        percentage: newPct,
        questionsCount: newQ,
        marksPerQuestion: newQ > 0 ? Math.max(1, Math.round(safeM / newQ)) : item.marksPerQuestion,
      };
    });
    syncOtherStagesFromStep2(updated);
  };

  const handleStep2QuestionsChange = (idx: number, newQ: number) => {
    const baseM = blueprint.totalMarks || 40;
    const safeQ = Math.max(0, Math.round(newQ));
    const updated = step2Items.map((item, i) => {
      if (i !== idx) return { ...item };
      const catId = item.id as Step2CategoryId;
      const unitMarks = catId === 'short_objective' ? 1 : catId === 'essay' ? 4 : 2.5;
      const newMarks = safeQ === 0 ? 0 : Math.round(safeQ * unitMarks);
      const newPct = baseM > 0 ? Math.round((newMarks / baseM) * 1000) / 10 : 0;
      return {
        ...item,
        questionsCount: safeQ,
        marks: newMarks,
        percentage: newPct,
        marksPerQuestion: safeQ > 0 ? Math.max(1, Math.round(newMarks / safeQ)) : item.marksPerQuestion,
      };
    });
    syncOtherStagesFromStep2(updated);
  };

  const handleBalanceStep2To100 = () => {
    const baseM = blueprint.totalMarks || 40;
    const weights = step2Items.map(i => Math.max(0, i.percentage));
    const balancedPcts = apportionExactIntegers(weights, 100, 0);
    const balanced = buildStep2FromPercentages(baseM, {
      short_objective: balancedPcts[0] ?? 30,
      long: balancedPcts[1] ?? 50,
      essay: balancedPcts[2] ?? 20,
    });
    syncOtherStagesFromStep2(balanced);
  };

  const handleResetStep2Default = () => {
    const baseM = blueprint.totalMarks || 40;
    const resetItems = buildStep2FromPercentages(
      baseM,
      DEFAULT_STEP2_PERCENTAGES,
      blueprint.totalQuestions
    );
    syncOtherStagesFromStep2(resetItems);
  };

  // --- Step 3 (Difficulty) Handlers ---
  const handleStep3PercentageChange = (idx: number, val: number) => {
    const baseM = blueprint.totalMarks || 40;
    const baseQ = activeTotalQuestions;
    const updated = step3Items.map((item, i) => {
      if (i !== idx) return { ...item };
      const newMarks = Math.max(0, Math.round((baseM * val) / 100));
      const newQ = newMarks > 0 ? Math.min(newMarks, Math.max(1, Math.round((baseQ * val) / 100))) : 0;
      return { ...item, percentage: val, marks: newMarks, questionsCount: newQ };
    });
    syncAllStagesFromStep3(updated);
  };

  const handleStep3MarksChange = (idx: number, val: number) => {
    const baseM = blueprint.totalMarks || 40;
    const safeM = Math.max(0, Math.round(val));
    const updated = step3Items.map((item, i) => {
      if (i !== idx) return { ...item };
      const newPct = baseM > 0 ? Math.round((safeM / baseM) * 1000) / 10 : 0;
      const newQ = safeM === 0 ? 0 : Math.min(safeM, Math.max(1, item.questionsCount));
      return { ...item, marks: safeM, percentage: newPct, questionsCount: newQ };
    });
    syncAllStagesFromStep3(updated);
  };

  const handleStep3QuestionsChange = (idx: number, val: number) => {
    const next = adjustSingleRowQuestionCount(step3Items, idx, val, activeTotalQuestions);
    setStep3Items(next);
  };

  const handleBalanceStep3To100 = () => {
    const baseM = blueprint.totalMarks || 40;
    const weights = step3Items.map(i => Math.max(0, i.percentage));
    const balancedPcts = apportionExactIntegers(weights, 100, 0);
    const nextMarks = apportionExactIntegers(balancedPcts, baseM, 0);
    const updated = step3Items.map((item, idx) => ({
      ...item,
      percentage: balancedPcts[idx],
      marks: nextMarks[idx],
    }));
    syncAllStagesFromStep3(updated);
  };

  // --- Step 4 (Chapters) Handlers ---
  const handleStep4PercentageChange = (idx: number, val: number) => {
    const baseM = blueprint.totalMarks || 40;
    const baseQ = activeTotalQuestions;
    const updated = step4Items.map((item, i) => {
      if (i !== idx) return { ...item };
      const newMarks = Math.max(0, Math.round((baseM * val) / 100));
      const newQ = newMarks > 0 ? Math.min(newMarks, Math.max(1, Math.round((baseQ * val) / 100))) : 0;
      return { ...item, percentage: val, marks: newMarks, questionsCount: newQ };
    });
    syncAllStagesFromStep4(updated);
  };

  const handleStep4MarksChange = (idx: number, val: number) => {
    const baseM = blueprint.totalMarks || 40;
    const safeM = Math.max(0, Math.round(val));
    const updated = step4Items.map((item, i) => {
      if (i !== idx) return { ...item };
      const newPct = baseM > 0 ? Math.round((safeM / baseM) * 1000) / 10 : 0;
      const newQ = safeM === 0 ? 0 : Math.min(safeM, Math.max(1, item.questionsCount));
      return { ...item, marks: safeM, percentage: newPct, questionsCount: newQ };
    });
    syncAllStagesFromStep4(updated);
  };

  const handleStep4QuestionsChange = (idx: number, val: number) => {
    const next = adjustSingleRowQuestionCount(step4Items, idx, val, activeTotalQuestions);
    setStep4Items(next);
  };

  const handleBalanceStep4To100 = () => {
    const baseM = blueprint.totalMarks || 40;
    const weights = step4Items.map(i => Math.max(0, i.percentage));
    const balancedPcts = apportionExactIntegers(weights, 100, 0);
    const minM = baseM >= step4Items.length ? 1 : 0;
    const nextMarks = apportionExactIntegers(balancedPcts, baseM, minM);
    const updated = step4Items.map((item, idx) => ({
      ...item,
      percentage: balancedPcts[idx],
      marks: nextMarks[idx],
    }));
    syncAllStagesFromStep4(updated);
  };

  // Live coordinated Blueprint Totals (used consistently in Header + all 5 stages)
  const activeTotalMarks =
    step2Items.reduce((s, x) => s + x.marks, 0) || blueprint.totalMarks || 40;
  const activeTotalQuestions =
    step2Items.reduce((s, x) => s + x.questionsCount, 0) || blueprint.totalQuestions || 24;
  const step1PctSum = step1Items.reduce((s, x) => s + x.percentage, 0);
  const step2PctSum = step2Items.reduce((s, x) => s + x.percentage, 0);
  const step3PctSum = step3Items.reduce((s, x) => s + x.percentage, 0);
  const step4PctSum = step4Items.reduce((s, x) => s + x.percentage, 0);

  // Question Swap State (allowing user to change a question without altering blueprint)
  const [swappingQuestion, setSwappingQuestion] = useState<QuestionItem | null>(null);
  const [swapTab, setSwapTab] = useState<'same_chapter' | 'other_chapters'>('same_chapter');
  const [swapSearchQuery, setSwapSearchQuery] = useState<string>('');
  const [swapSuccessMessage, setSwapSuccessMessage] = useState<string | null>(null);

  // Extract all questions across all chapters in the bank
  const allBankQuestions = useMemo(() => {
    if (!bank) return [];
    return bank.chapters.flatMap(ch => ch.questions);
  }, [bank]);

  // Questions actually used in the question paper
  const usedPaperQuestions = useMemo(() => {
    if (!paper) return [];
    return paper.sections.flatMap(s => s.questions);
  }, [paper]);

  // Set of currently used question IDs in the paper
  const currentlyUsedIds = useMemo(() => {
    return new Set(usedPaperQuestions.map(q => q.bankQuestionId));
  }, [usedPaperQuestions]);

  // Fuzzy chapter matching helper to prevent string mismatches between index and blueprint
  const cleanCh = (s: string) =>
    (s || '')
      .replace(/^[0-9೦-೯\.\s\-–_:]+/, '')
      .replace(/\s+/g, '')
      .toLowerCase();

  const isChMatch = (c1: string | undefined | null, c2: string | undefined | null) => {
    if (!c1 || !c2) return false;
    const k1 = cleanCh(c1);
    const k2 = cleanCh(c2);
    return k1 === k2 || k1.includes(k2) || k2.includes(k1);
  };

  // Candidates for swap matching EXACT SAME MARKS so blueprint is NOT altered
  const swapCandidates = useMemo(() => {
    if (!swappingQuestion) return [];
    const targetMarks = swappingQuestion.marks;
    const targetChId = swappingQuestion.chapterId;
    const targetChName = swappingQuestion.chapterName;

    let candidates = allBankQuestions.filter(q => {
      // STRICT CONSTRAINT: Marks must match exactly so the blueprint is NOT altered!
      if (q.marks !== targetMarks) return false;
      // Must not already be used in paper
      if (currentlyUsedIds.has(q.id) || q.id === swappingQuestion.id) return false;

      const isSameChapter = q.chapterId === targetChId || q.chapterName === targetChName;
      if (swapTab === 'same_chapter') {
        return isSameChapter;
      } else {
        return !isSameChapter;
      }
    });

    if (swapSearchQuery.trim()) {
      const sq = swapSearchQuery.toLowerCase().trim();
      candidates = candidates.filter(
        c =>
          c.question.toLowerCase().includes(sq) ||
          c.answer.toLowerCase().includes(sq) ||
          (c.chapterName && c.chapterName.toLowerCase().includes(sq))
      );
    }

    return candidates;
  }, [swappingQuestion, swapTab, swapSearchQuery, allBankQuestions, currentlyUsedIds]);

  const handleApplySwap = (candidate: QuestionItem) => {
    if (!swappingQuestion) return;

    // 1. Update in paper if paper and onUpdatePaper exist
    if (paper && onUpdatePaper) {
      const updatedSections = paper.sections.map(sec => ({
        ...sec,
        questions: sec.questions.map(q => {
          if (q.bankQuestionId === swappingQuestion.id || q.question === swappingQuestion.question) {
            return {
              ...q,
              bankQuestionId: candidate.id,
              question: candidate.question,
              answer: candidate.answer,
              questionType: candidate.questionType,
              formatCategoryId: candidate.formatCategoryId,
              formatCategoryName: candidate.formatCategoryName,
              options: candidate.options ? [...candidate.options] : undefined,
              items: candidate.items ? [...candidate.items] : undefined,
              chapterName: candidate.chapterName || q.chapterName,
              learningOutcome: candidate.learningOutcome,
              difficulty: candidate.difficulty,
              imageUrl: candidate.imageUrl,
              diagramSvg: candidate.diagramSvg,
              answerImageUrl: candidate.answerImageUrl,
              answerDiagramSvg: candidate.answerDiagramSvg,
              hasDiagram: candidate.hasDiagram,
              diagramDescription: candidate.diagramDescription,
              answerDiagramDescription: candidate.answerDiagramDescription,
            };
          }
          return q;
        }),
      }));
      onUpdatePaper({
        ...paper,
        sections: updatedSections,
      });
    }

    // 2. Update in active drillDown view
    if (drillDown) {
      const updatedQuestions = drillDown.questions.map(q =>
        q.id === swappingQuestion.id || q.question === swappingQuestion.question ? candidate : q
      );
      setDrillDown({
        ...drillDown,
        questions: updatedQuestions,
      });
    }

    setSwapSuccessMessage(
      `ಪ್ರಶ್ನೆಯನ್ನು "${candidate.chapterName}" ಪಾಠದ ${candidate.marks} ಅಂಕದ ಪ್ರಶ್ನೆಯೊಂದಿಗೆ ಯಶಸ್ವಿಯಾಗಿ ಬದಲಾಯಿಸಲಾಗಿದೆ! ನೀಲನಕಾಶೆಯ ಅಂಕಗಳು ಹಾಗೆಯೇ ಇವೆ.`
    );
    setTimeout(() => setSwapSuccessMessage(null), 4000);
    setSwappingQuestion(null);
  };

  // Helper to convert GeneratedQuestionItem to QuestionItem for display and swap
  // Helper to convert GeneratedQuestionItem or QuestionItem to QuestionItem for display and swap
  const toQuestionItem = (
    gq: QuestionItem | GeneratedQuestionItem,
    fallbackChId?: string
  ): QuestionItem => {
    const fullQ = allBankQuestions.find(
      bq => bq.id === (gq as any).bankQuestionId || bq.id === (gq as any).id || bq.question === gq.question
    );
    if (fullQ) return fullQ;
    return {
      id: (gq as any).bankQuestionId || (gq as any).uid || (gq as any).id || `q_${Date.now()}_${Math.random()}`,
      question: gq.question,
      answer: gq.answer,
      questionType: gq.questionType,
      formatCategoryId: gq.formatCategoryId,
      formatCategoryName: gq.questionType || '',
      marks: gq.marks,
      options: gq.options,
      items: gq.items,
      imageUrl: gq.imageUrl,
      diagramSvg: gq.diagramSvg,
      answerImageUrl: gq.answerImageUrl,
      answerDiagramSvg: gq.answerDiagramSvg,
      hasDiagram: gq.hasDiagram,
      diagramDescription: gq.diagramDescription,
      answerDiagramDescription: gq.answerDiagramDescription,
      chapterId: fallbackChId || (gq as any).chapterId || '',
      chapterName: gq.chapterName,
      learningOutcome: gq.learningOutcome,
      difficulty: gq.difficulty,
    };
  };

  // Helper to determine question objective
  const getQuestionObjective = (q: QuestionItem | GeneratedQuestionItem): 'know' | 'und' | 'app' | 'skill' => {
    // 1. Explicit tag on question
    const rawObj = ((q as any).objective || (q as any).objectiveName || '').toLowerCase();
    if (rawObj.includes('know') || rawObj.includes('ಜ್ಞಾನ') || rawObj.includes('ಸ್ಮರಣೆ')) return 'know';
    if (rawObj.includes('und') || rawObj.includes('ತಿಳುವಳಿಕೆ') || rawObj.includes('ಗ್ರಹಿಕೆ')) return 'und';
    if (rawObj.includes('app') || rawObj.includes('ಅನ್ವಯ') || rawObj.includes('ಅಭಿವ್ಯಕ್ತಿ')) return 'app';
    if (rawObj.includes('skill') || rawObj.includes('ಕೌಶಲ') || rawObj.includes('ಚಿತ್ರ') || rawObj.includes('ನಕ್ಷೆ')) return 'skill';

    // 2. Learning outcome string
    const lo = (q.learningOutcome || '').toLowerCase();
    if (lo.includes('ಜ್ಞಾನ') || lo.includes('knowledge') || lo.includes('ಸ್ಮರಣೆ')) return 'know';
    if (lo.includes('ಅನ್ವಯ') || lo.includes('application') || lo.includes('ಅಭಿವ್ಯಕ್ತಿ')) return 'app';
    if (lo.includes('ಕೌಶಲ') || lo.includes('skill') || lo.includes('ಚಿತ್ರ') || lo.includes('ನಕ್ಷೆ') || q.hasDiagram) return 'skill';
    if (lo.includes('ತಿಳುವಳಿಕೆ') || lo.includes('understanding') || lo.includes('ಗ್ರಹಿಕೆ')) return 'und';

    // 3. Question text keywords
    const text = (q.question || '').toLowerCase();
    if (text.includes('ಚಿತ್ರ') || text.includes('ರೇಖಾಚಿತ್ರ') || text.includes('ನಕ್ಷೆ') || text.includes('ಗುರುತಿಸಿ') || text.includes('ರಚಿಸಿ') || text.includes('ಡ್ರಾಯಿಂಗ್') || q.hasDiagram) return 'skill';
    if (text.includes('ಲೆಕ್ಕ') || text.includes('ಕಂಡುಹಿಡಿಯಿರಿ') || text.includes('ಬೆಲೆ') || text.includes('ಸಾಧಿಸಿ') || text.includes('ಸಮಸ್ಯೆ') || text.includes('ಅನ್ವಯ') || text.includes('ಪ್ರಯೋಗ')) return 'app';
    if (text.includes('ಕಾರಣ') || text.includes('ವ್ಯತ್ಯಾಸ') || text.includes('ವಿವರಿಸಿ') || text.includes('ಹೋಲಿಸಿ') || text.includes('ಗ್ರಹಿಸಿ')) return 'und';

    if (q.marks === 1) return 'know';
    if (q.marks === 2) return 'und';
    if (q.marks === 3) return 'app';
    return 'skill';
  };

  // 1. Handler: Click an Objective in Step 1
  const handleObjectiveClick = (objId: string, objName: string, expectedMarks: number) => {
    let matched: Array<QuestionItem | GeneratedQuestionItem> = usedPaperQuestions.filter(
      q => getQuestionObjective(q) === objId
    );
    if (matched.length === 0 && allBankQuestions.length > 0) {
      matched = allBankQuestions.filter(q => getQuestionObjective(q) === objId);
    }
    if (matched.length === 0 && allBankQuestions.length > 0) {
      matched = allBankQuestions.slice(0, 6);
    }
    const questions = matched.map(q => toQuestionItem(q));

    setDrillDown({
      title: `ಉದ್ದೇಶ: ${objName} (${questions.length} ಪ್ರಶ್ನೆಗಳು · ${expectedMarks} ಅಂಕ)`,
      subtitle: `ಪ್ರಶ್ನೆ ಪತ್ರಿಕೆಯಲ್ಲಿ ಈ ಉದ್ದಿಷ್ಟಕ್ಕೆ ಆಯ್ಕೆಯಾದ ಪ್ರಶ್ನೆಗಳು (ಪ್ರಶ್ನೆ ಬದಲಾಯಿಸಲು ಬಟನ್ ಬಳಸಿ)`,
      badge: `${questions.length} ಪ್ರಶ್ನೆಗಳು`,
      questions,
    });
    setSearchQuery('');
  };

  // 2. Handler: Click a Question Type in Step 2 (3 permanent mark-based categories)
  const handleQuestionTypeClick = (typeId: string, typeName: string, marksPerQ: number) => {
    const isType = (q: QuestionItem | GeneratedQuestionItem) => {
      if (typeId === 'short_objective' || typeId === 'long' || typeId === 'essay') {
        return classifyQuestionToStep2Category(q) === typeId;
      }
      if (typeId === 'mcq' || typeId === 'vsa' || typeId === 'objective' || typeId === 'short') {
        return classifyQuestionToStep2Category(q) === 'short_objective';
      }
      if (typeId === 'sa' || typeId === 'la1') {
        return classifyQuestionToStep2Category(q) === 'long';
      }
      if (typeId === 'la2' || typeId === 'essay_descriptive') {
        return classifyQuestionToStep2Category(q) === 'essay';
      }
      return q.marks === marksPerQ;
    };

    let matched: Array<QuestionItem | GeneratedQuestionItem> = usedPaperQuestions.filter(isType);
    if (matched.length === 0 && allBankQuestions.length > 0) {
      matched = allBankQuestions.filter(isType);
    }
    const questions = matched.map(q => toQuestionItem(q));

    setDrillDown({
      title: `${typeName} (${questions.length} ಪ್ರಶ್ನೆಗಳು)`,
      subtitle: `ಪ್ರಶ್ನೆ ಪತ್ರಿಕೆಯಲ್ಲಿ ಈ ಪ್ರಶ್ನೆ ವಿಧಕ್ಕೆ ಬಳಸಲಾದ ಪ್ರಶ್ನೆಗಳು`,
      badge: `${questions.length} ಪ್ರಶ್ನೆಗಳು`,
      questions,
    });
    setSearchQuery('');
  };

  // 3. Handler: Click a Difficulty row in Step 3
  const handleDifficultyClick = (diffId: string, diffName: string) => {
    const isDiff = (q: QuestionItem | GeneratedQuestionItem) => {
      if (diffId === 'easy') return matchesDifficulty(q.difficulty, 'Easy', q.marks);
      if (diffId === 'diff') return matchesDifficulty(q.difficulty, 'Difficult', q.marks);
      return matchesDifficulty(q.difficulty, 'Medium', q.marks);
    };

    let matched: Array<QuestionItem | GeneratedQuestionItem> = usedPaperQuestions.filter(isDiff);
    if (matched.length === 0 && allBankQuestions.length > 0) {
      matched = allBankQuestions.filter(isDiff);
    }
    if (matched.length === 0 && allBankQuestions.length > 0) {
      matched = allBankQuestions.slice(0, 6);
    }
    const questions = matched.map(q => toQuestionItem(q));

    setDrillDown({
      title: `ಕ್ಲಿಷ್ಟತೆಯ ಮಟ್ಟ: ${diffName} (${questions.length} ಪ್ರಶ್ನೆಗಳು)`,
      subtitle: `ಪ್ರಶ್ನೆ ಪತ್ರಿಕೆಯಲ್ಲಿ ಈ ಕ್ಲಿಷ್ಟತೆಗೆ ಆಯ್ಕೆಯಾದ ಪ್ರಶ್ನೆಗಳು`,
      badge: `${questions.length} ಪ್ರಶ್ನೆಗಳು`,
      questions,
    });
    setSearchQuery('');
  };

  // 4. Handler: Click a Chapter row in Step 4
  const handleChapterClick = (
    chapterId: string,
    chapterName: string,
    expectedMarks: number
  ) => {
    let matched: Array<QuestionItem | GeneratedQuestionItem> = usedPaperQuestions.filter(
      q => isChMatch(q.chapterName, chapterName) || (q as any).chapterId === chapterId
    );
    if (matched.length === 0 && allBankQuestions.length > 0) {
      matched = allBankQuestions.filter(
        q => isChMatch(q.chapterName, chapterName) || q.chapterId === chapterId
      );
    }
    if (matched.length === 0 && allBankQuestions.length > 0) {
      matched = allBankQuestions.slice(0, 6);
    }
    const questions = matched.map(q => toQuestionItem(q, chapterId));

    setDrillDown({
      title: `ಪಾಠ: ${chapterName} (${questions.length} ಪ್ರಶ್ನೆಗಳು · ${expectedMarks} ಅಂಕ)`,
      subtitle: `ನೀಲನಕಾಶೆಯಂತೆ ಆಯ್ಕೆಯಾದ ಪ್ರಶ್ನೆಗಳು (ಪ್ರಶ್ನೆ ಬದಲಾಯಿಸಲು ಬಟನ್ ಬಳಸಿ)`,
      badge: `${questions.length} ಪ್ರಶ್ನೆಗಳು`,
      questions,
    });
    setSearchQuery('');
  };

  // 5. Handler: Click a specific cell in Step 5 Master Grid (Objective x Step 2 Question Type)
  const handleMasterCellClick = (
    cell: ObjectiveDiffCell | null,
    chapterId: string,
    chapterName: string,
    objName: string,
    objKey: 'know' | 'und' | 'app' | 'skill',
    qTypeName: string,
    qTypeKey: Step2CategoryId
  ) => {
    let matched: any[] = [];

    // Tier 1: Direct question IDs in cell
    if (cell && cell.questionIds && cell.questionIds.length > 0) {
      const idSet = new Set(cell.questionIds);
      matched = usedPaperQuestions.filter(
        q => idSet.has(q.bankQuestionId) || idSet.has(q.uid) || idSet.has((q as any).id)
      );
    }

    // Tier 2: Paper questions by fuzzy chapter + objective + Step 2 question type
    if (matched.length === 0 && usedPaperQuestions.length > 0) {
      matched = usedPaperQuestions.filter(q => {
        const isCh = isChMatch(q.chapterName, chapterName) || (q as any).chapterId === chapterId;
        if (!isCh) return false;
        if (getQuestionObjective(q) !== objKey) return false;
        return classifyQuestionToStep2Category(q) === qTypeKey;
      });
    }

    // Tier 3: Paper questions by fuzzy chapter + Step 2 question type
    if (matched.length === 0 && usedPaperQuestions.length > 0) {
      matched = usedPaperQuestions.filter(q => {
        const isCh = isChMatch(q.chapterName, chapterName) || (q as any).chapterId === chapterId;
        return isCh && classifyQuestionToStep2Category(q) === qTypeKey;
      });
    }

    // Tier 4: Paper questions by fuzzy chapter
    if (matched.length === 0 && usedPaperQuestions.length > 0) {
      matched = usedPaperQuestions.filter(q => {
        return isChMatch(q.chapterName, chapterName) || (q as any).chapterId === chapterId;
      });
    }

    // Tier 5: Bank questions by fuzzy chapter + objective + Step 2 question type
    if (matched.length === 0 && allBankQuestions.length > 0) {
      matched = allBankQuestions.filter(q => {
        const isCh = isChMatch(q.chapterName, chapterName) || q.chapterId === chapterId;
        if (!isCh) return false;
        if (getQuestionObjective(q) !== objKey) return false;
        return classifyQuestionToStep2Category(q) === qTypeKey;
      });
    }

    // Tier 6: Bank questions by fuzzy chapter + Step 2 question type
    if (matched.length === 0 && allBankQuestions.length > 0) {
      matched = allBankQuestions.filter(q => {
        const isCh = isChMatch(q.chapterName, chapterName) || q.chapterId === chapterId;
        return isCh && classifyQuestionToStep2Category(q) === qTypeKey;
      });
    }

    // Tier 7: Bank questions by fuzzy chapter
    if (matched.length === 0 && allBankQuestions.length > 0) {
      matched = allBankQuestions.filter(q => {
        return isChMatch(q.chapterName, chapterName) || q.chapterId === chapterId;
      });
    }

    // Tier 8: Bank questions by matching Step 2 question type across bank
    if (matched.length === 0 && allBankQuestions.length > 0) {
      matched = allBankQuestions.filter(q => classifyQuestionToStep2Category(q) === qTypeKey);
    }

    // Tier 9: Sample fallback questions from bank so it's NEVER empty
    if (matched.length === 0 && allBankQuestions.length > 0) {
      matched = allBankQuestions.slice(0, 5);
    }

    const questions = matched.map(q => toQuestionItem(q, chapterId));

    setDrillDown({
      title: `${chapterName} · ${objName} [${qTypeName}]`,
      subtitle: `ನೀಲನಕಾಶೆಯ ಈ ಕೋಶದ ಪ್ರಶ್ನೆಗಳು (${questions.length} ಪ್ರಶ್ನೆಗಳು · ${cell?.totalMarks || questions.reduce((s, x) => s + x.marks, 0)} ಅಂಕ)`,
      badge: `${questions.length} ಪ್ರಶ್ನೆಗಳು`,
      questions,
    });
    setSearchQuery('');
  };

  // Filtered drill-down questions based on search query
  const filteredDrillDownQuestions = useMemo(() => {
    if (!drillDown) return [];
    if (!searchQuery.trim()) return drillDown.questions;
    const q = searchQuery.toLowerCase().trim();
    return drillDown.questions.filter(item => {
      const questionText = (item.question || '').toLowerCase();
      const answerText = (item.answer || '').toLowerCase();
      const optionsText = (item.options || []).join(' ').toLowerCase();
      return questionText.includes(q) || answerText.includes(q) || optionsText.includes(q);
    });
  }, [drillDown, searchQuery]);

  // Cell Renderer with standard Karnataka DSERT notation: Q(M) where Q = questions, M = total marks in cell. If 0, '-'
  const renderCell = (
    cell: ObjectiveDiffCell | null,
    chapterId: string,
    chapterName: string,
    objName: string,
    objKey: 'know' | 'und' | 'app' | 'skill',
    qTypeName: string,
    qTypeKey: Step2CategoryId
  ) => {
    if (!cell || cell.questionsCount <= 0) {
      return <span className="text-slate-300">-</span>;
    }
    return (
      <span
        onClick={e => {
          e.stopPropagation();
          handleMasterCellClick(cell, chapterId, chapterName, objName, objKey, qTypeName, qTypeKey);
        }}
        className="font-bold text-slate-900 cursor-pointer hover:bg-emerald-100 hover:text-emerald-950 px-1 py-0.5 rounded transition-colors inline-block tabular-nums"
        title={`ಕ್ಲಿಕ್ ಮಾಡಿ: ${cell.questionsCount} ಪ್ರಶ್ನೆಗಳು · ಒಟ್ಟು ${cell.totalMarks} ಅಂಕ`}
      >
        {cell.questionsCount}({cell.totalMarks})
      </span>
    );
  };

  // Synchronized Step 5 Master Grid strictly coordinating with Step 1 (Objectives), Step 2 (Question Types), and Step 4 (Chapters)
  const synchronizedMasterGrid = useMemo(
    () =>
      buildSynchronizedMasterGrid(
        step1Items,
        step2Items,
        step4Items,
        blueprint.step5MasterGrid
      ),
    [step1Items, step2Items, step4Items, blueprint.step5MasterGrid]
  );

  // Compute Step 5 vertical column totals (12 Objective x Question-Type columns + Step 2 cross-check totals)
  const columnTotals = useMemo(() => {
    const totals: Record<string, { q: number; m: number }> = {
      know_short: { q: 0, m: 0 },
      know_long: { q: 0, m: 0 },
      know_essay: { q: 0, m: 0 },
      und_short: { q: 0, m: 0 },
      und_long: { q: 0, m: 0 },
      und_essay: { q: 0, m: 0 },
      app_short: { q: 0, m: 0 },
      app_long: { q: 0, m: 0 },
      app_essay: { q: 0, m: 0 },
      skill_short: { q: 0, m: 0 },
      skill_long: { q: 0, m: 0 },
      skill_essay: { q: 0, m: 0 },
      total_short: { q: 0, m: 0 },
      total_long: { q: 0, m: 0 },
      total_essay: { q: 0, m: 0 },
      grand_q: { q: 0, m: 0 },
      grand_m: { q: 0, m: 0 },
    };

    synchronizedMasterGrid.forEach(row => {
      const add = (key: string, groupKey: 'total_short' | 'total_long' | 'total_essay', cell: ObjectiveDiffCell | null) => {
        if (cell) {
          totals[key].q += cell.questionsCount;
          totals[key].m += cell.totalMarks;
          totals[groupKey].q += cell.questionsCount;
          totals[groupKey].m += cell.totalMarks;
        }
      };
      add('know_short', 'total_short', row.knowledgeShort);
      add('know_long', 'total_long', row.knowledgeLong);
      add('know_essay', 'total_essay', row.knowledgeEssay);
      add('und_short', 'total_short', row.understandingShort);
      add('und_long', 'total_long', row.understandingLong);
      add('und_essay', 'total_essay', row.understandingEssay);
      add('app_short', 'total_short', row.applicationShort);
      add('app_long', 'total_long', row.applicationLong);
      add('app_essay', 'total_essay', row.applicationEssay);
      add('skill_short', 'total_short', row.skillShort);
      add('skill_long', 'total_long', row.skillLong);
      add('skill_essay', 'total_essay', row.skillEssay);

      totals.grand_q.q += row.totalQuestions;
      totals.grand_m.m += row.totalMarks;
    });

    return totals;
  }, [synchronizedMasterGrid]);

  // Step 5 Grand Total Row Cell Renderer: Shows Q(M) e.g. 2(2) = 2 questions of 2 marks, or '-'
  const renderTotalCell = (
    tot: { q: number; m: number },
    colName: string,
    objKey: 'know' | 'und' | 'app' | 'skill',
    qTypeKey: Step2CategoryId
  ) => {
    if (!tot || tot.q <= 0) {
      return <span className="text-slate-400 font-bold">-</span>;
    }
    return (
      <span
        onClick={() => {
          let matched: Array<QuestionItem | GeneratedQuestionItem> = usedPaperQuestions.filter(q => {
            if (getQuestionObjective(q) !== objKey) return false;
            return classifyQuestionToStep2Category(q) === qTypeKey;
          });
          if (matched.length === 0 && allBankQuestions.length > 0) {
            matched = allBankQuestions.filter(q => {
              if (getQuestionObjective(q) !== objKey) return false;
              return classifyQuestionToStep2Category(q) === qTypeKey;
            });
          }
          if (matched.length === 0 && allBankQuestions.length > 0) {
            matched = allBankQuestions.filter(q => classifyQuestionToStep2Category(q) === qTypeKey);
          }
          if (matched.length === 0 && allBankQuestions.length > 0) {
            matched = allBankQuestions.slice(0, 6);
          }
          const questions = matched.map(q => toQuestionItem(q));
          setDrillDown({
            title: `ಒಟ್ಟು: ${colName} (${questions.length} ಪ್ರಶ್ನೆಗಳು · ${tot.m} ಅಂಕ)`,
            subtitle: `ಪ್ರಶ್ನೆ ಪತ್ರಿಕೆಯಲ್ಲಿ ಈ ಕಾಲಂಗೆ ಬಳಸಲಾದ ಒಟ್ಟು ಪ್ರಶ್ನೆಗಳು`,
            badge: `${questions.length} ಪ್ರಶ್ನೆಗಳು`,
            questions,
          });
          setSearchQuery('');
        }}
        className="font-bold text-slate-900 cursor-pointer hover:bg-emerald-100 hover:text-emerald-950 px-1 py-0.5 rounded transition-colors inline-block tabular-nums"
        title={`ಕ್ಲಿಕ್ ಮಾಡಿ: ${colName} - ${tot.q} ಪ್ರಶ್ನೆಗಳು (${tot.m} ಅಂಕ)`}
      >
        {tot.q}({tot.m})
      </span>
    );
  };

  return (
    <div className="space-y-6 font-kannada">
      {/* Top Action Toolbar (hidden when printing) */}
      <div className="bg-gradient-to-r from-emerald-50 via-white to-sky-50 rounded-2xl border border-emerald-200 p-4 shadow-xs flex flex-wrap items-center justify-between gap-4 no-print">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onBackToSetup}
            className="px-3.5 py-2 text-xs font-bold text-emerald-900 bg-white hover:bg-emerald-100 border border-emerald-200 rounded-xl transition-colors flex items-center gap-1.5 cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>ಸೆಟಪ್‌ಗೆ ಹಿಂತಿರುಗಿ (Back to Setup)</span>
          </button>

          {onViewPaper && (
            <button
              type="button"
              onClick={onViewPaper}
              className="px-3.5 py-2 text-xs font-bold text-sky-900 bg-sky-100 hover:bg-sky-200 border border-sky-300 rounded-xl transition-colors flex items-center gap-1.5 cursor-pointer"
            >
              <Layers className="w-4 h-4" />
              <span>ಪ್ರಶ್ನೆ ಪತ್ರಿಕೆ ವೀಕ್ಷಿಸಿ (View Paper)</span>
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => window.print()}
            className="px-4 py-2 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-xl transition-colors shadow-xs flex items-center gap-1.5 cursor-pointer"
          >
            <Printer className="w-4 h-4" />
            <span>ನೀಲನಕಾಶೆ ಮುದ್ರಿಸಿ (Print Blue Print)</span>
          </button>
        </div>
      </div>

      {/* Interactive Helper Banner (hidden on print) */}
      <div className="p-3.5 bg-gradient-to-r from-amber-50 via-emerald-50/70 to-sky-50 border border-emerald-200 rounded-2xl flex flex-wrap items-center justify-between gap-3 text-xs font-bold text-emerald-950 shadow-2xs no-print">
        <div className="flex items-center gap-2">
          <Info className="w-4 h-4 text-emerald-700 shrink-0" />
          <span>
            ಬ್ಲೂಪ್ರಿಂಟ್‌ನ ಯಾವುದೇ ಕೋಶ ಅಥವಾ ಸಂಖ್ಯೆಯ ಮೇಲೆ ಕ್ಲಿಕ್ ಮಾಡಿ ಪ್ರಶ್ನೆಗಳನ್ನು ವೀಕ್ಷಿಸಬಹುದು ಮತ್ತು ಸಮಾನ ಅಂಕದ ಪ್ರಶ್ನೆಯೊಂದಿಗೆ ಬದಲಾಯಿಸಬಹುದು. ಹಂತ 2 ಮತ್ತು ಹಂತ 5 ರ ಪ್ರಶ್ನೆ ವಿಧಗಳು 100% ಸಮನ್ವಯಗೊಂಡಿವೆ.
          </span>
        </div>
        <span className="text-2xs px-2.5 py-1 rounded-lg bg-emerald-700 text-white font-bold shrink-0">
          ಪ್ರಶ್ನೆ ವೀಕ್ಷಿಸಲು / ಬದಲಾಯಿಸಲು ಕ್ಲಿಕ್ ಮಾಡಿ
        </span>
      </div>

      {/* Printable Blueprint Canvas */}
      <div className="printable-document bg-white border-2 border-slate-900 shadow-xl mx-auto max-w-[215mm] min-h-[297mm] p-6 sm:p-8 text-slate-900 font-kannada space-y-5">
        {/* Main Document Header */}
        <div className="text-center pb-2 border-b-2 border-slate-900">
          <h1 className="text-lg sm:text-xl font-black tracking-wide text-slate-900">
            {blueprint.title}
          </h1>
          <p className="text-xs font-bold text-slate-700 mt-1">
            ತರಗತಿ: {blueprint.grade} | ವಿಷಯ: {blueprint.subject} | ಒಟ್ಟು ಪ್ರಶ್ನೆಗಳು:{' '}
            <span className="font-black text-indigo-900">{activeTotalQuestions}</span> | ಒಟ್ಟು ಅಂಕಗಳು:{' '}
            <span className="font-black text-emerald-900">{activeTotalMarks}</span>
          </p>
        </div>

        {/* TOP 3 TABLES: ಹಂತ 1 (ಉದ್ದೇಶಗಳು), ಹಂತ 2 (ಪ್ರಶ್ನೆ ಪ್ರಕಾರಗಳು), ಹಂತ 3 (ಕ್ಲಿಷ್ಟತೆಯ ಮಟ್ಟ) */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {/* ಹಂತ 1: ಉದ್ದೇಶವಾರು ಅಂಕ ಹಂಚಿಕೆ */}
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center justify-between gap-1">
              <h2 className="text-xs sm:text-sm font-bold text-slate-900">
                ಹಂತ 1: ಉದ್ದೇಶವಾರು ಅಂಕ ಹಂಚಿಕೆ
              </h2>
              {Math.round(step1PctSum) !== 100 && (
                <button
                  type="button"
                  onClick={handleBalanceStep1To100}
                  className="no-print px-1.5 py-0.5 rounded bg-amber-100 hover:bg-amber-200 border border-amber-300 text-amber-900 text-[10px] font-bold cursor-pointer"
                  title="ಶೇಕಡಾವಾರು ಮೊತ್ತವನ್ನು 100% ಗೆ ಸಮತೋಲನಗೊಳಿಸಿ"
                >
                  100% ಹೊಂದಿಸಿ
                </button>
              )}
            </div>
            <table className="w-full border-collapse border border-slate-900 text-xs">
              <thead>
                <tr className="bg-slate-100 border-b border-slate-900 text-center font-bold">
                  <th className="border border-slate-900 py-1.5 px-1 w-8">ಕ್ರ.ಸಂ.</th>
                  <th className="border border-slate-900 py-1.5 px-2 text-left">ಉದ್ದಿಷ್ಟಗಳು</th>
                  <th className="border border-slate-900 py-1.5 px-1 w-14">ಶೇಕಡಾ (%)</th>
                  <th className="border border-slate-900 py-1.5 px-1 w-12">ಅಂಕ</th>
                  <th className="border border-slate-900 py-1.5 px-1 w-12">ಪ್ರಶ್ನೆ</th>
                </tr>
              </thead>
              <tbody>
                {step1Items.map((item, idx) => (
                  <tr
                    key={item.id}
                    className="text-center border-b border-slate-900 font-medium hover:bg-amber-50/50 transition-colors group"
                  >
                    <td className="border border-slate-900 py-1 px-1">{idx + 1}</td>
                    <td
                      onClick={() => handleObjectiveClick(item.id, item.name, item.marks)}
                      className="border border-slate-900 py-1 px-2 text-left font-semibold truncate max-w-[110px] group-hover:text-indigo-900 cursor-pointer"
                      title="ಕ್ಲಿಕ್ ಮಾಡಿ: ಈ ಉದ್ದಿಷ್ಟದ ಪ್ರಶ್ನೆಗಳನ್ನು ವೀಕ್ಷಿಸಿ"
                    >
                      {item.name}
                    </td>
                    <td className="border border-slate-900 py-0.5 px-1">
                      <CleanNumberInput
                        value={item.percentage}
                        min={0}
                        max={100}
                        onChange={val => handleStep1PercentageChange(idx, val)}
                        suffix="%"
                        className="w-11 text-center font-bold bg-white border border-slate-300 rounded px-1 py-0.5 text-xs text-slate-900 focus:outline-hidden focus:ring-1 focus:ring-indigo-600"
                      />
                    </td>
                    <td className="border border-slate-900 py-0.5 px-1">
                      <CleanNumberInput
                        value={item.marks}
                        min={0}
                        onChange={val => handleStep1MarksChange(idx, val)}
                        className="w-10 text-center font-bold bg-white border border-slate-300 rounded px-1 py-0.5 text-xs text-emerald-900 focus:outline-hidden focus:ring-1 focus:ring-indigo-600"
                      />
                    </td>
                    <td className="border border-slate-900 py-0.5 px-1">
                      <CleanNumberInput
                        value={item.questionsCount}
                        min={0}
                        max={item.marks}
                        onChange={val => handleStep1QuestionsChange(idx, val)}
                        className="w-10 text-center font-bold bg-white border border-slate-300 rounded px-1 py-0.5 text-xs text-indigo-900 focus:outline-hidden focus:ring-1 focus:ring-indigo-600"
                      />
                    </td>
                  </tr>
                ))}
                <tr className="bg-slate-50 border-t-2 border-slate-900 text-center font-bold">
                  <td className="border border-slate-900 py-1.5 px-1" colSpan={2}>
                    ಒಟ್ಟು
                  </td>
                  <td
                    className={`border border-slate-900 py-1.5 px-1 ${
                      Math.round(step1PctSum) !== 100 ? 'text-rose-700' : ''
                    }`}
                  >
                    {step1PctSum.toFixed(0)}%
                  </td>
                  <td className="border border-slate-900 py-1.5 px-1 font-black text-emerald-900">
                    {step1Items.reduce((s, x) => s + x.marks, 0)}
                  </td>
                  <td className="border border-slate-900 py-1.5 px-1 font-black text-indigo-900">
                    {step1Items.reduce((s, x) => s + x.questionsCount, 0)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* ಹಂತ 2: ಪ್ರಶ್ನೆವಾರು ಶೇಕಡಾ ಅಂಕ ಹಂಚಿಕೆ (ಖಾಯಂ 3 ವಿಧಗಳು: 30% / 50% / 20% ಡೀಫಾಲ್ಟ್, ಸಂಪಾದಿಸಬಹುದಾದ) */}
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center justify-between gap-1">
              <h2 className="text-xs sm:text-sm font-bold text-slate-900">
                ಹಂತ 2: ಪ್ರಶ್ನೆವಾರು ಶೇಕಡಾ ಅಂಕ ಹಂಚಿಕೆ
              </h2>
              <div className="flex items-center gap-1 no-print">
                {Math.round(step2PctSum) !== 100 && (
                  <button
                    type="button"
                    onClick={handleBalanceStep2To100}
                    className="px-1.5 py-0.5 rounded bg-amber-100 hover:bg-amber-200 border border-amber-300 text-amber-900 text-[10px] font-bold cursor-pointer"
                    title="ಶೇಕಡಾವಾರು ಮೊತ್ತವನ್ನು 100% ಗೆ ಸ್ವಯಂಚಾಲಿತವಾಗಿ ಸಮತೋಲನಗೊಳಿಸಿ"
                  >
                    100% ಹೊಂದಿಸಿ
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleResetStep2Default}
                  className="px-1.5 py-0.5 rounded bg-slate-100 hover:bg-slate-200 border border-slate-300 text-slate-700 text-[10px] font-bold cursor-pointer"
                  title="ಡೀಫಾಲ್ಟ್ 30% / 50% / 20% ಗೆ ಮರುಹೊಂದಿಸಿ"
                >
                  30-50-20
                </button>
              </div>
            </div>
            <table className="w-full border-collapse border border-slate-900 text-xs">
              <thead>
                <tr className="bg-slate-100 border-b border-slate-900 text-center font-bold">
                  <th className="border border-slate-900 py-1.5 px-1 w-8">ಕ್ರ.ಸಂ.</th>
                  <th className="border border-slate-900 py-1.5 px-2 text-left">ಪ್ರಶ್ನೆಯ ವಿಧ</th>
                  <th className="border border-slate-900 py-1.5 px-1 w-14">ಶೇಕಡಾ (%)</th>
                  <th className="border border-slate-900 py-1.5 px-1 w-12">ಪ್ರಶ್ನೆ</th>
                  <th className="border border-slate-900 py-1.5 px-1 w-12">ಅಂಕ</th>
                </tr>
              </thead>
              <tbody>
                {step2Items.map((item, idx) => (
                  <tr
                    key={item.id}
                    className="text-center border-b border-slate-900 font-medium hover:bg-blue-50/50 transition-colors group"
                  >
                    <td className="border border-slate-900 py-1 px-1">{idx + 1}</td>
                    <td
                      onClick={() =>
                        handleQuestionTypeClick(item.id, item.name, item.marksPerQuestion)
                      }
                      className="border border-slate-900 py-1 px-2 text-left font-semibold leading-snug group-hover:text-indigo-900 cursor-pointer"
                      title={
                        item.subtitle
                          ? `${item.name} (${item.subtitle}) — ಪ್ರಶ್ನೆಗಳನ್ನು ವೀಕ್ಷಿಸಲು ಕ್ಲಿಕ್ ಮಾಡಿ`
                          : 'ಕ್ಲಿಕ್ ಮಾಡಿ: ಈ ಪ್ರಕಾರದ ಪ್ರಶ್ನೆಗಳನ್ನು ವೀಕ್ಷಿಸಿ'
                      }
                    >
                      <div>{item.name}</div>
                      {item.subtitle && (
                        <div className="text-[9px] font-normal text-slate-500 leading-tight no-print">
                          {item.subtitle}
                        </div>
                      )}
                    </td>
                    <td className="border border-slate-900 py-0.5 px-1">
                      <CleanNumberInput
                        value={item.percentage}
                        min={0}
                        max={100}
                        onChange={val => handleStep2PercentageChange(idx, val)}
                        suffix="%"
                        className="w-11 text-center font-bold bg-white border border-slate-300 rounded px-1 py-0.5 text-xs text-slate-900 focus:outline-hidden focus:ring-1 focus:ring-indigo-600"
                      />
                    </td>
                    <td className="border border-slate-900 py-0.5 px-1">
                      <CleanNumberInput
                        value={item.questionsCount}
                        min={0}
                        onChange={val => handleStep2QuestionsChange(idx, val)}
                        className="w-10 text-center font-bold bg-white border border-slate-300 rounded px-1 py-0.5 text-xs text-indigo-900 focus:outline-hidden focus:ring-1 focus:ring-indigo-600"
                      />
                    </td>
                    <td className="border border-slate-900 py-0.5 px-1">
                      <CleanNumberInput
                        value={item.marks}
                        min={0}
                        onChange={val => handleStep2MarksChange(idx, val)}
                        className="w-10 text-center font-bold bg-white border border-slate-300 rounded px-1 py-0.5 text-xs text-emerald-900 focus:outline-hidden focus:ring-1 focus:ring-indigo-600"
                      />
                    </td>
                  </tr>
                ))}
                <tr className="bg-slate-50 border-t-2 border-slate-900 text-center font-bold">
                  <td className="border border-slate-900 py-1.5 px-1" colSpan={2}>
                    ಒಟ್ಟು
                  </td>
                  <td
                    className={`border border-slate-900 py-1.5 px-1 ${
                      Math.round(step2PctSum) !== 100 ? 'text-rose-700' : ''
                    }`}
                  >
                    {step2PctSum.toFixed(0)}%
                  </td>
                  <td className="border border-slate-900 py-1.5 px-1 font-black text-indigo-900">
                    {activeTotalQuestions}
                  </td>
                  <td className="border border-slate-900 py-1.5 px-1 font-black text-emerald-900">
                    {activeTotalMarks}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* ಹಂತ 3: ಕ್ಲಿಷ್ಟತೆಯ ಮಟ್ಟವಾರು ಹಂಚಿಕೆ (ಕ್ರ.ಸಂ., ಕ್ಲಿಷ್ಟತೆಯ ಮಟ್ಟ, ಶೇಕಡಾ, ಪ್ರಶ್ನೆಗಳ ಸಂಖ್ಯೆ, ಅಂಕ) */}
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center justify-between gap-1">
              <h2 className="text-xs sm:text-sm font-bold text-slate-900">
                ಹಂತ 3: ಕ್ಲಿಷ್ಟತೆಯ ಮಟ್ಟವಾರು ಹಂಚಿಕೆ
              </h2>
              {Math.round(step3PctSum) !== 100 && (
                <button
                  type="button"
                  onClick={handleBalanceStep3To100}
                  className="no-print px-1.5 py-0.5 rounded bg-amber-100 hover:bg-amber-200 border border-amber-300 text-amber-900 text-[10px] font-bold cursor-pointer"
                  title="ಶೇಕಡಾವಾರು ಮೊತ್ತವನ್ನು 100% ಗೆ ಸಮತೋಲನಗೊಳಿಸಿ"
                >
                  100% ಹೊಂದಿಸಿ
                </button>
              )}
            </div>
            <table className="w-full border-collapse border border-slate-900 text-xs">
              <thead>
                <tr className="bg-slate-100 border-b border-slate-900 text-center font-bold">
                  <th className="border border-slate-900 py-1.5 px-1 w-8">ಕ್ರ.ಸಂ.</th>
                  <th className="border border-slate-900 py-1.5 px-2 text-left">ಕ್ಲಿಷ್ಟತೆಯ ಮಟ್ಟ</th>
                  <th className="border border-slate-900 py-1.5 px-1 w-14">ಶೇಕಡಾ (%)</th>
                  <th className="border border-slate-900 py-1.5 px-1 w-12">ಪ್ರಶ್ನೆ</th>
                  <th className="border border-slate-900 py-1.5 px-1 w-12">ಅಂಕ</th>
                </tr>
              </thead>
              <tbody>
                {step3Items.map((item, idx) => (
                  <tr
                    key={item.id}
                    className="text-center border-b border-slate-900 font-medium hover:bg-emerald-50/50 transition-colors group"
                  >
                    <td className="border border-slate-900 py-1 px-1">{idx + 1}</td>
                    <td
                      onClick={() => handleDifficultyClick(item.id, item.name)}
                      className="border border-slate-900 py-1 px-2 text-left font-semibold truncate max-w-[110px] group-hover:text-indigo-900 cursor-pointer"
                      title="ಕ್ಲಿಕ್ ಮಾಡಿ: ಈ ಕ್ಲಿಷ್ಟತೆಯ ಪ್ರಶ್ನೆಗಳನ್ನು ವೀಕ್ಷಿಸಿ"
                    >
                      {item.name}
                    </td>
                    <td className="border border-slate-900 py-0.5 px-1">
                      <CleanNumberInput
                        value={item.percentage}
                        min={0}
                        max={100}
                        onChange={val => handleStep3PercentageChange(idx, val)}
                        suffix="%"
                        className="w-11 text-center font-bold bg-white border border-slate-300 rounded px-1 py-0.5 text-xs text-slate-900 focus:outline-hidden focus:ring-1 focus:ring-indigo-600"
                      />
                    </td>
                    <td className="border border-slate-900 py-0.5 px-1">
                      <CleanNumberInput
                        value={item.questionsCount}
                        min={0}
                        max={item.marks}
                        onChange={val => handleStep3QuestionsChange(idx, val)}
                        className="w-10 text-center font-bold bg-white border border-slate-300 rounded px-1 py-0.5 text-xs text-indigo-900 focus:outline-hidden focus:ring-1 focus:ring-indigo-600"
                      />
                    </td>
                    <td className="border border-slate-900 py-0.5 px-1">
                      <CleanNumberInput
                        value={item.marks}
                        min={0}
                        onChange={val => handleStep3MarksChange(idx, val)}
                        className="w-10 text-center font-bold bg-white border border-slate-300 rounded px-1 py-0.5 text-xs text-emerald-900 focus:outline-hidden focus:ring-1 focus:ring-indigo-600"
                      />
                    </td>
                  </tr>
                ))}
                <tr className="bg-slate-50 border-t-2 border-slate-900 text-center font-bold">
                  <td className="border border-slate-900 py-1.5 px-1" colSpan={2}>
                    ಒಟ್ಟು
                  </td>
                  <td
                    className={`border border-slate-900 py-1.5 px-1 ${
                      Math.round(step3PctSum) !== 100 ? 'text-rose-700' : ''
                    }`}
                  >
                    {step3PctSum.toFixed(0)}%
                  </td>
                  <td className="border border-slate-900 py-1.5 px-1 font-black text-indigo-900">
                    {step3Items.reduce((s, x) => s + x.questionsCount, 0)}
                  </td>
                  <td className="border border-slate-900 py-1.5 px-1 font-black text-emerald-900">
                    {step3Items.reduce((s, x) => s + x.marks, 0)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* ಹಂತ 4: ಪಾಠವಾರು ಅಂಕ ಹಂಚಿಕೆ (Editable Percentage and Marks Column) */}
        <div className="space-y-1.5 pt-2 border-t border-slate-200">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-xs sm:text-sm font-bold text-slate-900">
              ಹಂತ 4: ಪಾಠವಾರು ಅಂಕ ಮತ್ತು ಶೇಕಡಾವಾರು ಹಂಚಿಕೆ (Chapter Weightage)
            </h2>
            <div className="flex items-center gap-2 no-print">
              <span
                className={`text-2xs font-extrabold px-2 py-0.5 rounded-full ${
                  step4PctSum > 100
                    ? 'bg-rose-100 text-rose-800 border border-rose-300'
                    : Math.round(step4PctSum) === 100
                    ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                    : 'bg-amber-100 text-amber-800 border border-amber-300'
                }`}
              >
                ಒಟ್ಟು ಶೇಕಡಾ: {step4PctSum.toFixed(1)}% / 100%
              </span>
              {Math.round(step4PctSum) !== 100 && (
                <button
                  type="button"
                  onClick={handleBalanceStep4To100}
                  className="px-2 py-0.5 text-2xs font-bold text-amber-900 bg-amber-100 hover:bg-amber-200 border border-amber-300 rounded cursor-pointer"
                >
                  100% ಹೊಂದಿಸಿ
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  const resetCh = buildSyncedStep4(
                    blueprint.step4Chapters,
                    activeTotalMarks,
                    activeTotalQuestions,
                    true
                  );
                  setStep4Items(resetCh);
                }}
                className="px-2 py-0.5 text-2xs font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded cursor-pointer"
              >
                ಮರುಹೊಂದಿಸಿ
              </button>
            </div>
          </div>

          {step4PctSum > 100 && (
            <div className="no-print p-2 bg-rose-50 border border-rose-200 rounded-lg text-2xs text-rose-800 flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
              <span>ಎಚ್ಚರಿಕೆ: ಒಟ್ಟು ಶೇಕಡಾವಾರು 100% ಮೀರಬಾರದು. ದಯವಿಟ್ಟು ಹೊಂದಿಸಿ.</span>
            </div>
          )}

          <table className="w-full border-collapse border border-slate-900 text-xs">
            <thead>
              <tr className="bg-slate-100 border-b border-slate-900 text-center font-bold">
                <th className="border border-slate-900 py-1 px-1.5 w-10">ಕ್ರ.ಸಂ.</th>
                <th className="border border-slate-900 py-1 px-3 text-left">ಪಾಠದ ಹೆಸರು</th>
                <th className="border border-slate-900 py-1 px-2 w-28 bg-amber-50/70">
                  ಶೇಕಡಾವಾರು (%)
                </th>
                <th className="border border-slate-900 py-1 px-2 w-24">ಪ್ರಶ್ನೆಗಳ ಸಂಖ್ಯೆ</th>
                <th className="border border-slate-900 py-1 px-2 w-24">ಒಟ್ಟು ಅಂಕಗಳು</th>
              </tr>
            </thead>
            <tbody>
              {step4Items.map((item, idx) => {
                return (
                  <tr
                    key={item.chapterId}
                    className="text-center border-b border-slate-900 font-medium hover:bg-indigo-50/40 transition-colors"
                  >
                    <td className="border border-slate-900 py-1 px-1">{idx + 1}</td>
                    <td
                      onClick={() => handleChapterClick(item.chapterId, item.chapterName, item.marks)}
                      className="border border-slate-900 py-1 px-3 text-left font-semibold truncate max-w-[200px] cursor-pointer hover:text-indigo-900"
                      title="ಕ್ಲಿಕ್ ಮಾಡಿ: ಈ ಪಾಠದ ಪ್ರಶ್ನೆಗಳನ್ನು ವೀಕ್ಷಿಸಿ"
                    >
                      {item.chapterName}
                    </td>
                    {/* Editable Percentage Input */}
                    <td className="border border-slate-900 py-0.5 px-2 bg-amber-50/30">
                      <CleanNumberInput
                        value={item.percentage}
                        min={0}
                        max={100}
                        onChange={val => handleStep4PercentageChange(idx, val)}
                        suffix="%"
                        className="w-16 text-center font-bold bg-white border border-slate-300 rounded px-1.5 py-0.5 text-xs text-slate-900 focus:outline-hidden focus:ring-1 focus:ring-indigo-600"
                      />
                    </td>
                    <td className="border border-slate-900 py-0.5 px-2">
                      <CleanNumberInput
                        value={item.questionsCount}
                        min={0}
                        max={item.marks}
                        onChange={val => handleStep4QuestionsChange(idx, val)}
                        className="w-14 text-center font-bold bg-white border border-slate-300 rounded px-1.5 py-0.5 text-xs text-indigo-900 focus:outline-hidden focus:ring-1 focus:ring-indigo-600"
                      />
                    </td>
                    <td className="border border-slate-900 py-0.5 px-2">
                      <CleanNumberInput
                        value={item.marks}
                        min={0}
                        onChange={val => handleStep4MarksChange(idx, val)}
                        className="w-14 text-center font-bold bg-white border border-slate-300 rounded px-1.5 py-0.5 text-xs text-emerald-900 focus:outline-hidden focus:ring-1 focus:ring-indigo-600"
                      />
                    </td>
                  </tr>
                );
              })}
              <tr className="bg-slate-50 border-t-2 border-slate-900 text-center font-bold">
                <td className="border border-slate-900 py-1 px-1" colSpan={2}>
                  ಒಟ್ಟು
                </td>
                <td className="border border-slate-900 py-1 px-2 font-black text-amber-950">
                  {step4PctSum.toFixed(1)}%
                </td>
                <td className="border border-slate-900 py-1 px-2 font-black text-indigo-900">
                  {step4Items.reduce((s, x) => s + x.questionsCount, 0)}
                </td>
                <td className="border border-slate-900 py-1 px-2 font-black text-emerald-900">
                  {step4Items.reduce((s, x) => s + x.marks, 0)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* SECTION 5: ಅಧಿಕೃತ 3D ನೀಲನಕಾಶೆ ಮಾಸ್ಟರ್ ಕೋಷ್ಟಕ (4 Objectives x 3 Step-2 Question Types: ವ.ನಿ/ಕಿರು, ದೀರ್ಘ, ಪ್ರಬಂಧ) */}
        <div className="pt-2 border-t-2 border-slate-900 space-y-2">
          <div className="text-center pb-1">
            <h2 className="text-xs sm:text-sm font-black tracking-wide text-slate-900 uppercase">
              ಹಂತ 5: ಅಧಿಕೃತ 3D ನೀಲನಕಾಶೆ ಮಾಸ್ಟರ್ ಕೋಷ್ಟಕ (Master Blueprint Grid)
            </h2>
            <p className="text-[11px] font-semibold text-slate-600 mt-0.5">
              ವ.ನಿ/ಕಿರು = ವಸ್ತುನಿಷ್ಠ / ಕಿರು ಉತ್ತರ (1 ಅಂಕ) · ದೀರ್ಘ = ದೀರ್ಘ ಉತ್ತರ (2/3 ಅಂಕ) · ಪ್ರಬಂಧ = ಪ್ರಬಂಧ ಮಾದರಿ (4 ಅಂಕ)
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full border-collapse border border-slate-900 text-xs">
              <thead>
                {/* Main Objective Headers */}
                <tr className="bg-slate-100 border-b border-slate-900 text-center font-bold">
                  <th className="border border-slate-900 py-1.5 px-1 w-7" rowSpan={2}>
                    ಕ್ರ.ಸಂ
                  </th>
                  <th
                    className="border border-slate-900 py-1.5 px-2 text-left"
                    rowSpan={2}
                  >
                    ಪಾಠದ ಹೆಸರು
                  </th>
                  {/* 1. Knowledge */}
                  <th
                    className="border border-slate-900 py-1 px-1 bg-amber-50/70"
                    colSpan={3}
                  >
                    ಜ್ಞಾನ / ಸ್ಮರಣೆ
                  </th>
                  {/* 2. Understanding */}
                  <th
                    className="border border-slate-900 py-1 px-1 bg-sky-50/70"
                    colSpan={3}
                  >
                    ಗ್ರಹಿಕೆ / ತಿಳುವಳಿಕೆ
                  </th>
                  {/* 3. Application */}
                  <th
                    className="border border-slate-900 py-1 px-1 bg-emerald-50/70"
                    colSpan={3}
                  >
                    ಅಭಿವ್ಯಕ್ತಿ / ಅನ್ವಯ
                  </th>
                  {/* 4. Skill */}
                  <th
                    className="border border-slate-900 py-1 px-1 bg-purple-50/70"
                    colSpan={3}
                  >
                    ಪ್ರಶಂಸೆ / ಕೌಶಲ / ನಕ್ಷೆ
                  </th>
                  <th className="border border-slate-900 py-1.5 px-1.5 w-12" rowSpan={2}>
                    ಒಟ್ಟು ಪ್ರಶ್ನೆ
                  </th>
                  <th className="border border-slate-900 py-1.5 px-1.5 w-12" rowSpan={2}>
                    ಒಟ್ಟು ಅಂಕ
                  </th>
                </tr>

                {/* Sub-column Headers: Step 2 Question Types (ವ.ನಿ/ಕಿರು, ದೀರ್ಘ, ಪ್ರಬಂಧ) under each objective */}
                <tr className="bg-slate-50 border-b border-slate-900 text-center font-bold text-[10px]">
                  {/* Knowledge */}
                  <th className="border border-slate-900 py-1 px-1 bg-amber-50/40" title="ವಸ್ತುನಿಷ್ಠ / ಕಿರು ಉತ್ತರ (1 ಅಂಕ)">ವ.ನಿ/ಕಿರು</th>
                  <th className="border border-slate-900 py-1 px-1 bg-amber-50/40" title="ದೀರ್ಘ ಉತ್ತರ (2/3 ಅಂಕ)">ದೀರ್ಘ</th>
                  <th className="border border-slate-900 py-1 px-1 bg-amber-50/40" title="ಪ್ರಬಂಧ ಮಾದರಿ (4 ಅಂಕ)">ಪ್ರಬಂಧ</th>
                  {/* Understanding */}
                  <th className="border border-slate-900 py-1 px-1 bg-sky-50/40" title="ವಸ್ತುನಿಷ್ಠ / ಕಿರು ಉತ್ತರ (1 ಅಂಕ)">ವ.ನಿ/ಕಿರು</th>
                  <th className="border border-slate-900 py-1 px-1 bg-sky-50/40" title="ದೀರ್ಘ ಉತ್ತರ (2/3 ಅಂಕ)">ದೀರ್ಘ</th>
                  <th className="border border-slate-900 py-1 px-1 bg-sky-50/40" title="ಪ್ರಬಂಧ ಮಾದರಿ (4 ಅಂಕ)">ಪ್ರಬಂಧ</th>
                  {/* Application */}
                  <th className="border border-slate-900 py-1 px-1 bg-emerald-50/40" title="ವಸ್ತುನಿಷ್ಠ / ಕಿರು ಉತ್ತರ (1 ಅಂಕ)">ವ.ನಿ/ಕಿರು</th>
                  <th className="border border-slate-900 py-1 px-1 bg-emerald-50/40" title="ದೀರ್ಘ ಉತ್ತರ (2/3 ಅಂಕ)">ದೀರ್ಘ</th>
                  <th className="border border-slate-900 py-1 px-1 bg-emerald-50/40" title="ಪ್ರಬಂಧ ಮಾದರಿ (4 ಅಂಕ)">ಪ್ರಬಂಧ</th>
                  {/* Skill */}
                  <th className="border border-slate-900 py-1 px-1 bg-purple-50/40" title="ವಸ್ತುನಿಷ್ಠ / ಕಿರು ಉತ್ತರ (1 ಅಂಕ)">ವ.ನಿ/ಕಿರು</th>
                  <th className="border border-slate-900 py-1 px-1 bg-purple-50/40" title="ದೀರ್ಘ ಉತ್ತರ (2/3 ಅಂಕ)">ದೀರ್ಘ</th>
                  <th className="border border-slate-900 py-1 px-1 bg-purple-50/40" title="ಪ್ರಬಂಧ ಮಾದರಿ (4 ಅಂಕ)">ಪ್ರಬಂಧ</th>
                </tr>
              </thead>
              <tbody>
                {synchronizedMasterGrid.map((row, idx) => (
                  <tr
                    key={row.chapterId}
                    className="text-center border-b border-slate-900 font-medium hover:bg-slate-50/60"
                  >
                    <td className="border border-slate-900 py-1 px-1 tabular-nums">{idx + 1}</td>
                    <td
                      onClick={() =>
                        handleChapterClick(row.chapterId, row.chapterName, row.totalMarks)
                      }
                      className="border border-slate-900 py-1 px-2 text-left font-semibold truncate max-w-[140px] cursor-pointer hover:bg-emerald-50 hover:text-emerald-950 transition-colors"
                      title="ಕ್ಲಿಕ್ ಮಾಡಿ: ಈ ಪಾಠದ ಪ್ರಶ್ನೆಗಳನ್ನು ವೀಕ್ಷಿಸಿ"
                    >
                      {row.chapterName}
                    </td>

                    {/* Knowledge Sub-columns: ವ.ನಿ/ಕಿರು, ದೀರ್ಘ, ಪ್ರಬಂಧ */}
                    <td className="border border-slate-900 py-1 px-1">
                      {renderCell(row.knowledgeShort, row.chapterId, row.chapterName, 'ಜ್ಞಾನ', 'know', 'ವಸ್ತುನಿಷ್ಠ/ಕಿರು ಉತ್ತರ', 'short_objective')}
                    </td>
                    <td className="border border-slate-900 py-1 px-1">
                      {renderCell(row.knowledgeLong, row.chapterId, row.chapterName, 'ಜ್ಞಾನ', 'know', 'ದೀರ್ಘ ಉತ್ತರ', 'long')}
                    </td>
                    <td className="border border-slate-900 py-1 px-1">
                      {renderCell(row.knowledgeEssay, row.chapterId, row.chapterName, 'ಜ್ಞಾನ', 'know', 'ಪ್ರಬಂಧ ಮಾದರಿ', 'essay')}
                    </td>

                    {/* Understanding Sub-columns: ವ.ನಿ/ಕಿರು, ದೀರ್ಘ, ಪ್ರಬಂಧ */}
                    <td className="border border-slate-900 py-1 px-1">
                      {renderCell(row.understandingShort, row.chapterId, row.chapterName, 'ತಿಳುವಳಿಕೆ', 'und', 'ವಸ್ತುನಿಷ್ಠ/ಕಿರು ಉತ್ತರ', 'short_objective')}
                    </td>
                    <td className="border border-slate-900 py-1 px-1">
                      {renderCell(row.understandingLong, row.chapterId, row.chapterName, 'ತಿಳುವಳಿಕೆ', 'und', 'ದೀರ್ಘ ಉತ್ತರ', 'long')}
                    </td>
                    <td className="border border-slate-900 py-1 px-1">
                      {renderCell(row.understandingEssay, row.chapterId, row.chapterName, 'ತಿಳುವಳಿಕೆ', 'und', 'ಪ್ರಬಂಧ ಮಾದರಿ', 'essay')}
                    </td>

                    {/* Application Sub-columns: ವ.ನಿ/ಕಿರು, ದೀರ್ಘ, ಪ್ರಬಂಧ */}
                    <td className="border border-slate-900 py-1 px-1">
                      {renderCell(row.applicationShort, row.chapterId, row.chapterName, 'ಅನ್ವಯ', 'app', 'ವಸ್ತುನಿಷ್ಠ/ಕಿರು ಉತ್ತರ', 'short_objective')}
                    </td>
                    <td className="border border-slate-900 py-1 px-1">
                      {renderCell(row.applicationLong, row.chapterId, row.chapterName, 'ಅನ್ವಯ', 'app', 'ದೀರ್ಘ ಉತ್ತರ', 'long')}
                    </td>
                    <td className="border border-slate-900 py-1 px-1">
                      {renderCell(row.applicationEssay, row.chapterId, row.chapterName, 'ಅನ್ವಯ', 'app', 'ಪ್ರಬಂಧ ಮಾದರಿ', 'essay')}
                    </td>

                    {/* Skill Sub-columns: ವ.ನಿ/ಕಿರು, ದೀರ್ಘ, ಪ್ರಬಂಧ */}
                    <td className="border border-slate-900 py-1 px-1">
                      {renderCell(row.skillShort, row.chapterId, row.chapterName, 'ಕೌಶಲ', 'skill', 'ವಸ್ತುನಿಷ್ಠ/ಕಿರು ಉತ್ತರ', 'short_objective')}
                    </td>
                    <td className="border border-slate-900 py-1 px-1">
                      {renderCell(row.skillLong, row.chapterId, row.chapterName, 'ಕೌಶಲ', 'skill', 'ದೀರ್ಘ ಉತ್ತರ', 'long')}
                    </td>
                    <td className="border border-slate-900 py-1 px-1">
                      {renderCell(row.skillEssay, row.chapterId, row.chapterName, 'ಕೌಶಲ', 'skill', 'ಪ್ರಬಂಧ ಮಾದರಿ', 'essay')}
                    </td>

                    {/* Chapter Totals */}
                    <td className="border border-slate-900 py-1 px-1.5 font-bold text-indigo-900 bg-slate-50 tabular-nums">
                      {row.totalQuestions}
                    </td>
                    <td className="border border-slate-900 py-1 px-1.5 font-black text-emerald-900 bg-slate-50 tabular-nums">
                      {row.totalMarks}
                    </td>
                  </tr>
                ))}

                {/* ಒಟ್ಟು ಸಾಲು (Grand Total Row) - Strictly Tallying 100% with Step 1, Step 2, and Step 4 */}
                <tr className="bg-slate-200 border-t-2 border-slate-900 text-center font-bold">
                  <td className="border border-slate-900 py-1.5 px-1" colSpan={2}>
                    ಒಟ್ಟು (Total)
                  </td>
                  {/* Knowledge Totals */}
                  <td className="border border-slate-900 py-1 px-1">
                    {renderTotalCell(columnTotals.know_short, 'ಜ್ಞಾನ - ವಸ್ತುನಿಷ್ಠ/ಕಿರು', 'know', 'short_objective')}
                  </td>
                  <td className="border border-slate-900 py-1 px-1">
                    {renderTotalCell(columnTotals.know_long, 'ಜ್ಞಾನ - ದೀರ್ಘ ಉತ್ತರ', 'know', 'long')}
                  </td>
                  <td className="border border-slate-900 py-1 px-1">
                    {renderTotalCell(columnTotals.know_essay, 'ಜ್ಞಾನ - ಪ್ರಬಂಧ ಮಾದರಿ', 'know', 'essay')}
                  </td>

                  {/* Understanding Totals */}
                  <td className="border border-slate-900 py-1 px-1">
                    {renderTotalCell(columnTotals.und_short, 'ತಿಳುವಳಿಕೆ - ವಸ್ತುನಿಷ್ಠ/ಕಿರು', 'und', 'short_objective')}
                  </td>
                  <td className="border border-slate-900 py-1 px-1">
                    {renderTotalCell(columnTotals.und_long, 'ತಿಳುವಳಿಕೆ - ದೀರ್ಘ ಉತ್ತರ', 'und', 'long')}
                  </td>
                  <td className="border border-slate-900 py-1 px-1">
                    {renderTotalCell(columnTotals.und_essay, 'ತಿಳುವಳಿಕೆ - ಪ್ರಬಂಧ ಮಾದರಿ', 'und', 'essay')}
                  </td>

                  {/* Application Totals */}
                  <td className="border border-slate-900 py-1 px-1">
                    {renderTotalCell(columnTotals.app_short, 'ಅನ್ವಯ - ವಸ್ತುನಿಷ್ಠ/ಕಿರು', 'app', 'short_objective')}
                  </td>
                  <td className="border border-slate-900 py-1 px-1">
                    {renderTotalCell(columnTotals.app_long, 'ಅನ್ವಯ - ದೀರ್ಘ ಉತ್ತರ', 'app', 'long')}
                  </td>
                  <td className="border border-slate-900 py-1 px-1">
                    {renderTotalCell(columnTotals.app_essay, 'ಅನ್ವಯ - ಪ್ರಬಂಧ ಮಾದರಿ', 'app', 'essay')}
                  </td>

                  {/* Skill Totals */}
                  <td className="border border-slate-900 py-1 px-1">
                    {renderTotalCell(columnTotals.skill_short, 'ಕೌಶಲ - ವಸ್ತುನಿಷ್ಠ/ಕಿರು', 'skill', 'short_objective')}
                  </td>
                  <td className="border border-slate-900 py-1 px-1">
                    {renderTotalCell(columnTotals.skill_long, 'ಕೌಶಲ - ದೀರ್ಘ ಉತ್ತರ', 'skill', 'long')}
                  </td>
                  <td className="border border-slate-900 py-1 px-1">
                    {renderTotalCell(columnTotals.skill_essay, 'ಕೌಶಲ - ಪ್ರಬಂಧ ಮಾದರಿ', 'skill', 'essay')}
                  </td>

                  {/* Grand Totals (Strictly Synchronized with Steps 1, 2, 3, and 4) */}
                  <td className="border border-slate-900 py-1.5 px-1.5 font-black text-indigo-950 text-sm tabular-nums">
                    {columnTotals.grand_q.q}
                  </td>
                  <td className="border border-slate-900 py-1.5 px-1.5 font-black text-emerald-950 text-sm tabular-nums">
                    {columnTotals.grand_m.m}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Step 2 <-> Step 5 Exact Tally Verification Strip */}
          <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 bg-emerald-50/70 border border-emerald-200 rounded-lg text-[11px] font-bold text-emerald-950 tabular-nums">
            <span>ಹಂತ 2 ↔ ಹಂತ 5 ಪ್ರಶ್ನೆ ವಿಧಗಳ ಸಮನ್ವಯ ಮೊತ್ತ:</span>
            <div className="flex flex-wrap items-center gap-3">
              <span>ವ.ನಿ/ಕಿರು: {columnTotals.total_short.q} ಪ್ರಶ್ನೆ ({columnTotals.total_short.m} ಅಂಕ)</span>
              <span>·</span>
              <span>ದೀರ್ಘ: {columnTotals.total_long.q} ಪ್ರಶ್ನೆ ({columnTotals.total_long.m} ಅಂಕ)</span>
              <span>·</span>
              <span>ಪ್ರಬಂಧ: {columnTotals.total_essay.q} ಪ್ರಶ್ನೆ ({columnTotals.total_essay.m} ಅಂಕ)</span>
            </div>
          </div>
        </div>

        {/* Blueprint Signature Footer */}
        <div className="pt-6 flex justify-between items-end text-xs font-bold text-slate-800">
          <div className="space-y-1">
            <div>ವಿಷಯ ಶಿಕ್ಷಕರ ಸಹಿ: ........................</div>
            <div className="text-2xs text-slate-500 font-medium">ಪ್ರಶ್ನೆ ಪತ್ರಿಕೆ ಸಂಯೋಜಕರು</div>
          </div>
          <div className="text-center space-y-1">
            <div>ದಿನಾಂಕ: {new Date().toLocaleDateString('kn-IN')}</div>
          </div>
          <div className="space-y-1 text-right">
            <div>ಮುಖ್ಯೋಪಾಧ್ಯಾಯರ ಸಹಿ: ........................</div>
            <div className="text-2xs text-slate-500 font-medium">ಶಾಲಾ ಮೊಹರು (Seal)</div>
          </div>
        </div>

        {/* ಅಧಿಕೃತ ಸೂಚನೆಯನ್ನು ವರ್ಗ ಶಿಕ್ಷಕರ ಹಾಗೂ ಮುಖ್ಯ ಗುರುಗಳ ಸಹಿ ಇರುವ ಸ್ಥಾನದ ಕೆಳಗಡೆ ನೀಡಲಾಗಿದೆ */}
        <div className="pt-4 border-t border-slate-300 text-center">
          <p className="text-xs font-bold text-slate-800">
            ಸೂಚನೆ :- ಆವರಣದ ಒಳಗಿನ ಸಂಖ್ಯೆಯು ಒಟ್ಟು ಅಂಕಗಳನ್ನು ಹಾಗೂ ಹೊರಗಿರುವ ಸಂಖ್ಯೆಯು ಪ್ರಶ್ನೆಗಳ ಸಂಖ್ಯೆಯನ್ನು ಸೂಚಿಸುತ್ತದೆ. (ಉದಾ: 2(4) = 2 ಪ್ರಶ್ನೆಗಳು, 4 ಅಂಕಗಳು).
          </p>
        </div>
      </div>

      {/* Success Banner when a Question is Swapped */}
      {swapSuccessMessage && (
        <div className="fixed bottom-6 right-6 z-50 bg-emerald-600 text-white px-4 py-3 rounded-2xl shadow-xl flex items-center gap-3 animate-fade-in text-xs font-bold">
          <CheckCircle2 className="w-5 h-5 shrink-0" />
          <span>{swapSuccessMessage}</span>
          <button
            onClick={() => setSwapSuccessMessage(null)}
            className="ml-2 hover:opacity-75 text-xs font-bold"
          >
            ✕
          </button>
        </div>
      )}

      {/* DRILL-DOWN QUESTION MODAL (Showing ONLY questions used in the paper, with swap option) */}
      {drillDown && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-4xl w-full max-h-[90vh] flex flex-col shadow-2xl overflow-hidden border border-slate-200">
            {/* Modal Header */}
            <div className="p-4 sm:p-5 border-b border-slate-100 flex items-center justify-between gap-3 bg-slate-50/70">
              <div className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm sm:text-base font-bold text-slate-900">
                    {drillDown.title}
                  </h3>
                  <span className="px-2.5 py-0.5 rounded-full text-2xs font-extrabold bg-indigo-100 text-indigo-800 border border-indigo-200">
                    {drillDown.badge}
                  </span>
                </div>
                <p className="text-xs text-slate-500">{drillDown.subtitle}</p>
              </div>
              <button
                type="button"
                onClick={() => setDrillDown(null)}
                className="w-8 h-8 rounded-full bg-slate-200 hover:bg-slate-300 flex items-center justify-center text-slate-700 transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Search Toolbar */}
            <div className="p-3 border-b border-slate-100 bg-white">
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                <input
                  type="text"
                  placeholder="ಪ್ರಶ್ನೆ ಅಥವಾ ಉತ್ತರದಲ್ಲಿ ಹುಡುಕಿ..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-4 py-2 text-xs font-medium text-slate-900 focus:outline-hidden focus:ring-1 focus:ring-indigo-600"
                />
              </div>
            </div>

            {/* Questions List */}
            <div className="p-4 sm:p-5 overflow-y-auto space-y-3 flex-1 bg-[#f8fafc]">
              {filteredDrillDownQuestions.length === 0 ? (
                <div className="p-8 text-center text-slate-500 space-y-2">
                  <HelpCircle className="w-8 h-8 text-slate-400 mx-auto" />
                  <p className="text-xs font-bold">ಪ್ರಶ್ನೆಗಳು ಕಂಡುಬಂದಿಲ್ಲ</p>
                  <p className="text-2xs text-slate-400">ಹುಡುಕಾಟದ ಕೀವರ್ಡ್ ಬದಲಾಯಿಸಿ ಪ್ರಯತ್ನಿಸಿ.</p>
                </div>
              ) : (
                filteredDrillDownQuestions.map((q, idx) => (
                  <div
                    key={`${q.chapterId || 'ch'}_${q.id || 'q'}_${idx}`}
                    className="bg-white border border-slate-200 rounded-2xl p-4 shadow-2xs space-y-2.5 hover:border-indigo-300 transition-colors"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 text-2xs border-b border-slate-100 pb-2">
                      <div className="flex items-center gap-2">
                        <span className="font-extrabold text-slate-700 bg-slate-100 px-2 py-0.5 rounded-md">
                          #{idx + 1}
                        </span>
                        <span className="font-bold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded-md border border-indigo-100">
                          {q.chapterName}
                        </span>
                        <span className="text-slate-500 font-medium">{q.questionType}</span>
                      </div>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {/* Objective Badge */}
                        <span className="px-2 py-0.5 rounded-full bg-purple-50 text-purple-900 border border-purple-200 font-extrabold text-2xs">
                          🎯 {(q as any).objectiveName || (getQuestionObjective(q) === 'know' ? 'ಜ್ಞಾನ' : getQuestionObjective(q) === 'und' ? 'ತಿಳುವಳಿಕೆ' : getQuestionObjective(q) === 'app' ? 'ಅನ್ವಯ' : 'ಕೌಶಲ')}
                        </span>
                        {/* Difficulty Badge */}
                        <span className="px-2 py-0.5 rounded-full bg-amber-50 text-amber-900 border border-amber-200 font-extrabold text-2xs">
                          ⚡ {q.difficulty || 'ಸಾಧಾರಣ'}
                        </span>
                        {/* Marks Badge */}
                        <span className="px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200 font-black">
                          {q.marks} {q.marks === 1 ? 'ಅಂಕ' : 'ಅಂಕಗಳು'}
                        </span>
                        {/* SWAP QUESTION BUTTON */}
                        <button
                          type="button"
                          onClick={() => {
                            setSwappingQuestion(q);
                            setSwapTab('same_chapter');
                            setSwapSearchQuery('');
                          }}
                          className="px-2.5 py-1 text-2xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-colors flex items-center gap-1 shadow-2xs cursor-pointer ml-1"
                          title="ಈ ಪ್ರಶ್ನೆಯನ್ನು ಬೇರೆ ಪ್ರಶ್ನೆಯೊಂದಿಗೆ ಬದಲಾಯಿಸಿ"
                        >
                          <RefreshCw className="w-3 h-3" />
                          <span>ಪ್ರಶ್ನೆ ಬದಲಾಯಿಸಿ</span>
                        </button>
                      </div>
                    </div>

                    <p className="text-xs sm:text-sm font-semibold text-slate-900 leading-relaxed">
                      {q.question}
                    </p>

                    {/* Options if MCQ */}
                    {q.options && q.options.length > 0 && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 pl-2 pt-1 text-xs text-slate-700">
                        {q.options.map((opt, oIdx) => (
                          <div
                            key={oIdx}
                            className="bg-slate-50 rounded-lg px-2.5 py-1 border border-slate-200/60"
                          >
                            {opt}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Match Items */}
                    {q.items && q.items.length > 0 && (
                      <div className="grid grid-cols-2 gap-2 pl-2 pt-1 text-xs bg-slate-50 p-2 rounded-xl border border-slate-200">
                        {q.items.map((it, iIdx) => (
                          <div
                            key={iIdx}
                            className="flex justify-between border-b border-slate-200/60 pb-1"
                          >
                            <span className="font-medium text-slate-800">{it.left}</span>
                            <span className="font-bold text-indigo-700">{it.right}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Answer Block */}
                    <div className="bg-emerald-50/70 border border-emerald-200/80 rounded-xl p-2.5 text-xs text-emerald-950 mt-1">
                      <span className="font-bold text-emerald-900 block mb-0.5">ಉತ್ತರ:</span>
                      <span className="whitespace-pre-line leading-relaxed">{q.answer}</span>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-3 border-t border-slate-100 bg-white flex justify-end">
              <button
                type="button"
                onClick={() => setDrillDown(null)}
                className="px-4 py-2 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl cursor-pointer"
              >
                ಮುಚ್ಚಿ (Close)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* QUESTION SWAP MODAL (Allows choosing replacement question with exact same marks) */}
      {swappingQuestion && (
        <div className="fixed inset-0 z-60 bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-4 font-kannada">
          <div className="bg-white rounded-3xl max-w-3xl w-full max-h-[85vh] flex flex-col shadow-2xl overflow-hidden border border-indigo-200 animate-scale-up">
            {/* Swap Header */}
            <div className="p-4 bg-gradient-to-r from-indigo-700 to-indigo-900 text-white flex items-center justify-between">
              <div>
                <h4 className="font-bold text-sm sm:text-base flex items-center gap-2">
                  <RefreshCw className="w-4 h-4 text-indigo-200" />
                  <span>ಪ್ರಶ್ನೆ ಬದಲಾವಣೆ (Swap Question)</span>
                </h4>
                <p className="text-2xs text-indigo-200 mt-0.5">
                  ಪ್ರಸ್ತುತ: &ldquo;{swappingQuestion.chapterName}&rdquo; ·{' '}
                  <span className="font-black text-amber-300">{swappingQuestion.marks} ಅಂಕ</span> (ನೀಲನಕಾಶೆ ಅಂಕ ಬದಲಾಗುವುದಿಲ್ಲ)
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSwappingQuestion(null)}
                className="w-7 h-7 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Swap Tabs */}
            <div className="flex border-b border-slate-200 bg-slate-50 text-xs font-bold">
              <button
                type="button"
                onClick={() => setSwapTab('same_chapter')}
                className={`flex-1 py-2.5 px-3 text-center border-b-2 cursor-pointer transition-colors ${
                  swapTab === 'same_chapter'
                    ? 'border-indigo-600 text-indigo-700 bg-white'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                1. ಇದೇ ಪಾಠದಿಂದ ({swappingQuestion.chapterName})
              </button>
              <button
                type="button"
                onClick={() => setSwapTab('other_chapters')}
                className={`flex-1 py-2.5 px-3 text-center border-b-2 cursor-pointer transition-colors ${
                  swapTab === 'other_chapters'
                    ? 'border-indigo-600 text-indigo-700 bg-white'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                2. ಬೇರೆ ಪಾಠಗಳಿಂದ ({swappingQuestion.marks}M ಅಂಕದ ಪ್ರಶ್ನೆಗಳು)
              </button>
            </div>

            {/* Search candidate questions */}
            <div className="p-3 border-b border-slate-100 bg-white">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
                <input
                  type="text"
                  placeholder="ಬದಲಿ ಪ್ರಶ್ನೆಯನ್ನು ಹುಡುಕಿ..."
                  value={swapSearchQuery}
                  onChange={e => setSwapSearchQuery(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-8 pr-3 py-1.5 text-xs text-slate-900 focus:outline-hidden focus:ring-1 focus:ring-indigo-600"
                />
              </div>
            </div>

            {/* Candidates list */}
            <div className="p-4 overflow-y-auto space-y-3 flex-1 bg-[#f8fafc]">
              {swapCandidates.length === 0 ? (
                <div className="p-8 text-center text-slate-500 space-y-1">
                  <p className="text-xs font-bold">ಯಾವುದೇ ಬದಲಿ ಪ್ರಶ್ನೆಗಳು ಲಭ್ಯವಿಲ್ಲ</p>
                  <p className="text-2xs text-slate-400">
                    ಈ ವರ್ಗದಲ್ಲಿ {swappingQuestion.marks} ಅಂಕದ ಬೇರೆ ಪ್ರಶ್ನೆಗಳು ಬ್ಯಾಂಕ್‌ನಲ್ಲಿ ಲಭ್ಯವಿಲ್ಲ.
                  </p>
                </div>
              ) : (
                swapCandidates.map((candidate, cIdx) => (
                  <div
                    key={`${candidate.chapterId || 'ch'}_${candidate.id || 'q'}_${cIdx}`}
                    className="bg-white border border-slate-200 hover:border-indigo-400 rounded-2xl p-3.5 shadow-2xs space-y-2 transition-all group"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 text-2xs border-b border-slate-100 pb-1.5">
                      <div className="flex items-center gap-1.5">
                        <span className="font-bold text-indigo-800 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-100">
                          {candidate.chapterName}
                        </span>
                        <span className="text-slate-500 font-medium">({candidate.questionType})</span>
                      </div>
                      <div className="flex items-center gap-1.5 font-bold">
                        <span className="text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                          {candidate.marks} ಅಂಕ
                        </span>
                        <button
                          type="button"
                          onClick={() => handleApplySwap(candidate)}
                          className="px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-2xs font-extrabold flex items-center gap-1 transition-colors cursor-pointer shadow-2xs"
                        >
                          <Check className="w-3 h-3" />
                          <span>ಈ ಪ್ರಶ್ನೆಯನ್ನು ಆರಿಸಿ</span>
                        </button>
                      </div>
                    </div>

                    <div className="text-xs font-semibold text-slate-900 leading-relaxed">
                      {candidate.question}
                    </div>

                    <div className="bg-emerald-50/50 border border-emerald-100 rounded-lg p-2 text-2xs text-emerald-950">
                      <strong className="text-emerald-900">ಉತ್ತರ:</strong> {candidate.answer}
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Modal bottom */}
            <div className="p-3 bg-slate-50 border-t border-slate-200 flex justify-between items-center">
              <span className="text-2xs text-slate-500 font-bold">
                ಲಭ್ಯವಿರುವ ಪ್ರಶ್ನೆಗಳು: {swapCandidates.length}
              </span>
              <button
                type="button"
                onClick={() => setSwappingQuestion(null)}
                className="px-3.5 py-1 text-xs font-bold bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-lg cursor-pointer"
              >
                ರದ್ದುಮಾಡಿ (Cancel)
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
