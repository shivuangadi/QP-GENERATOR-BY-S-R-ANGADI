/**
 * Question Paper Interactive Preview Component
 * Formatted for A4 with in-place edits, question reordering, replacing, font-size, line-spacing, and page breaks.
 * Author: S R Angadi
 */

import React from 'react';
import {
  GeneratedPaper,
  GeneratedQuestionItem,
  QuestionBank,
  QuestionItem,
} from '../types/questionBank.ts';
import { getAlternativeQuestions } from '../services/paperGenerator.ts';
import { ReplaceQuestionModal } from './ReplaceQuestionModal.tsx';
import { MathText } from './MathText.tsx';
import { ResilientQuestionImage } from './ResilientQuestionImage.tsx';
import {
  Printer,
  RotateCcw,
  RefreshCw,
  Trash2,
  ArrowUp,
  ArrowDown,
  Scissors,
  Edit3,
  Type,
  AlignJustify,
  FileText,
  Image as ImageIcon,
  Cloud,
  Check,
} from 'lucide-react';
import { saveQuestionPaperToFirebase } from '../services/firebase.ts';

interface PaperPreviewProps {
  paper: GeneratedPaper;
  bank: QuestionBank;
  onUpdatePaper: (paper: GeneratedPaper) => void;
  onRegenerate: () => void;
  onResetToGenerated: () => void;
  onBackToSetup?: () => void;
}

export const PaperPreview: React.FC<PaperPreviewProps> = ({
  paper,
  bank,
  onUpdatePaper,
  onRegenerate,
  onResetToGenerated,
  onBackToSetup,
}) => {
  // Appearance controls
  const [fontSize, setFontSize] = React.useState<'sm' | 'base' | 'lg'>('base');
  const [lineSpacing, setLineSpacing] = React.useState<'tight' | 'normal' | 'relaxed'>('normal');

  // Dotted lines visibility & spacing
  const [showDottedLines, setShowDottedLines] = React.useState<boolean>(true);
  const [dottedLineGap, setDottedLineGap] = React.useState<'normal' | 'relaxed' | 'spacious'>('relaxed');
  const [customLineCounts, setCustomLineCounts] = React.useState<Record<string, number>>({});

  // Question replacement state
  const [replacingQuestion, setReplacingQuestion] = React.useState<GeneratedQuestionItem | null>(null);
  const [candidateReplacements, setCandidateReplacements] = React.useState<QuestionItem[]>([]);

  // Editing state for specific question text
  const [editingQuestionUid, setEditingQuestionUid] = React.useState<string | null>(null);

  // Firebase save state
  const [isSavingToFirebase, setIsSavingToFirebase] = React.useState<boolean>(false);
  const [firebaseSaveSuccess, setFirebaseSaveSuccess] = React.useState<boolean>(false);
  const [firebaseSaveError, setFirebaseSaveError] = React.useState<string | null>(null);

  const getDefaultLineCount = (q: GeneratedQuestionItem) => {
    if (customLineCounts[q.uid] !== undefined) {
      return customLineCounts[q.uid];
    }
    const marks = q.marks || 1;
    const cat = q.formatCategoryId;
    if (cat === 'mcq') return 1;
    if (cat === 'fill_blank' || cat === 'true_false' || cat === 'analogy') return 1;
    if (marks === 1 || cat === 'one_sentence') return 2;
    if (marks === 2 || cat === 'short_2m' || cat === 'who_said') return 4;
    if (marks === 3 || cat === 'short_3m' || cat === 'passage_pic' || cat === 'grammar_section') return 6;
    if (marks >= 4 || cat === 'long_4m') return 8;
    return Math.max(2, marks * 2);
  };

  const handleSaveToFirebase = async () => {
    setIsSavingToFirebase(true);
    setFirebaseSaveSuccess(false);
    setFirebaseSaveError(null);
    try {
      await saveQuestionPaperToFirebase(paper);
      setFirebaseSaveSuccess(true);
      setTimeout(() => setFirebaseSaveSuccess(false), 4000);
    } catch (err: any) {
      setFirebaseSaveError(err.message || 'Firebase ಗೆ ಉಳಿಸುವಲ್ಲಿ ದೋಷ ಕಂಡುಬಂದಿದೆ.');
      setTimeout(() => setFirebaseSaveError(null), 5000);
    } finally {
      setIsSavingToFirebase(false);
    }
  };

  // Font size classes
  const fontSizeClass = {
    sm: 'text-[13px]',
    base: 'text-[14.5px]',
    lg: 'text-[16px]',
  }[fontSize];

  // Line spacing classes
  const lineSpacingClass = {
    tight: 'leading-snug space-y-1.5',
    normal: 'leading-relaxed space-y-3',
    relaxed: 'leading-loose space-y-4',
  }[lineSpacing];

  // Move question within a section
  const handleMoveQuestion = (sectionIdx: number, questionIdx: number, direction: 'up' | 'down') => {
    const updatedSections = [...paper.sections];
    const targetSection = { ...updatedSections[sectionIdx] };
    const questions = [...targetSection.questions];

    const targetIdx = direction === 'up' ? questionIdx - 1 : questionIdx + 1;
    if (targetIdx < 0 || targetIdx >= questions.length) return;

    const temp = questions[questionIdx];
    questions[questionIdx] = questions[targetIdx];
    questions[targetIdx] = temp;

    targetSection.questions = questions;
    updatedSections[sectionIdx] = targetSection;

    // Recalculate display numbers
    let num = 1;
    for (const sec of updatedSections) {
      for (const q of sec.questions) {
        q.displayNumber = num++;
      }
    }

    onUpdatePaper({
      ...paper,
      sections: updatedSections,
    });
  };

  // Remove question
  const handleRemoveQuestion = (sectionIdx: number, questionIdx: number) => {
    const updatedSections = [...paper.sections];
    const targetSection = { ...updatedSections[sectionIdx] };
    targetSection.questions = targetSection.questions.filter((_, i) => i !== questionIdx);
    updatedSections[sectionIdx] = targetSection;

    // Recalculate totals and numbers
    let num = 1;
    let totalMarks = 0;
    let totalQuestions = 0;
    for (const sec of updatedSections) {
      totalQuestions += sec.questions.length;
      for (const q of sec.questions) {
        q.displayNumber = num++;
        totalMarks += q.marks;
      }
    }

    onUpdatePaper({
      ...paper,
      sections: updatedSections,
      totalQuestions,
      totalMarks,
      header: {
        ...paper.header,
        maxMarks: totalMarks,
      },
    });
  };

  // Toggle page break before question
  const handleTogglePageBreak = (sectionIdx: number, questionIdx: number) => {
    const updatedSections = [...paper.sections];
    const targetSection = { ...updatedSections[sectionIdx] };
    const questions = [...targetSection.questions];
    questions[questionIdx] = {
      ...questions[questionIdx],
      pageBreakBefore: !questions[questionIdx].pageBreakBefore,
    };
    targetSection.questions = questions;
    updatedSections[sectionIdx] = targetSection;

    onUpdatePaper({
      ...paper,
      sections: updatedSections,
    });
  };

  // Open replace question modal
  const handleOpenReplaceModal = (sectionIdx: number, q: GeneratedQuestionItem) => {
    const bp = paper.sections[sectionIdx].blueprint;
    const currentlyUsedIds = new Set<string>();
    for (const sec of paper.sections) {
      for (const item of sec.questions) {
        currentlyUsedIds.add(item.bankQuestionId);
      }
    }

    const candidates = getAlternativeQuestions(bank, bp, currentlyUsedIds);
    setReplacingQuestion(q);
    setCandidateReplacements(candidates);
  };

  // Select replacement question
  const handleApplyReplacement = (candidate: QuestionItem) => {
    if (!replacingQuestion) return;

    const updatedSections = paper.sections.map(sec => {
      const qIndex = sec.questions.findIndex(q => q.uid === replacingQuestion.uid);
      if (qIndex === -1) return sec;

      const updatedQuestions = [...sec.questions];
      const prev = updatedQuestions[qIndex];
      updatedQuestions[qIndex] = {
        ...prev,
        bankQuestionId: candidate.id,
        question: candidate.question,
        answer: candidate.answer,
        questionType: candidate.questionType,
        marks: sec.blueprint.marksPerQuestion || candidate.marks || 1,
        options: candidate.options ? [...candidate.options] : undefined,
        chapterName: candidate.chapterName || prev.chapterName,
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
      return {
        ...sec,
        questions: updatedQuestions,
      };
    });

    onUpdatePaper({
      ...paper,
      sections: updatedSections,
    });
    setReplacingQuestion(null);
  };

  // Update question text directly in-place
  const handleUpdateQuestionText = (uid: string, newText: string) => {
    const updatedSections = paper.sections.map(sec => ({
      ...sec,
      questions: sec.questions.map(q => (q.uid === uid ? { ...q, question: newText } : q)),
    }));
    onUpdatePaper({
      ...paper,
      sections: updatedSections,
    });
  };

  // Detect whether question involves a diagram
  const isDiagramQuestion = (q: GeneratedQuestionItem) => {
    if (q.imageUrl || q.diagramSvg || q.hasDiagram) return true;
    return /ಚಿತ್ರ|ಆಕೃತಿ|ನಕ್ಷೆ|ರೇಖಾಚಿತ್ರ|ಪಟ|ಡಯಾಗ್ರಾಂ|diagram|figure|graph|chart/i.test(q.question);
  };

  // Extract stem and clean single-line MCQ options (handles both structured q.options and inline multi-line options)
  const extractMcqDisplay = (q: GeneratedQuestionItem): { stem: string; options: string[] } => {
    if (Array.isArray(q.options) && q.options.length > 0) {
      const cleaned = q.options
        .map(opt => String(opt || '').replace(/\s*\n\s*/g, ' ').trim())
        .filter(Boolean);
      return { stem: q.question, options: cleaned };
    }

    const lines = String(q.question || '')
      .split('\n')
      .map(l => l.trim())
      .filter(Boolean);
    if (lines.length >= 5) {
      const optPattern = /^\s*(?:\(?[ಅಆಇಈA-Da-d]\)[\.\-:]?|\([ಅಆಇಈA-Da-d]\)|[ಅಆಇಈA-Da-d][\.\)])\s*\S/;
      const lastFour = lines.slice(-4);
      if (lastFour.every(l => optPattern.test(l))) {
        return {
          stem: lines.slice(0, -4).join('\n'),
          options: lastFour,
        };
      }
    }

    return { stem: q.question, options: [] };
  };

  // Deduplicate Match-the-Following prompt so Part A never appears twice (once as plain text and again in the A/B table)
  const getCleanMatchDisplay = (
    q: GeneratedQuestionItem
  ): { isMatchTable: boolean; cleanPrompt: string; cleanItems: Array<{ left: string; right: string }> } => {
    const rawItems = Array.isArray(q.items)
      ? q.items
          .map(it => ({
            left: String(it?.left || '').trim(),
            right: String(it?.right || '').trim(),
          }))
          .filter(it => it.left.length > 0 || it.right.length > 0)
      : [];

    if (rawItems.length === 0) {
      return { isMatchTable: false, cleanPrompt: q.question, cleanItems: [] };
    }

    const norm = (s: string) =>
      s
        .replace(/^[0-9೦-೯a-zA-Zಅಆಇಈ]+[\.\)\-:\s]+/, '')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();

    const itemTexts = new Set<string>();
    for (const it of rawItems) {
      if (it.left) {
        itemTexts.add(it.left.toLowerCase());
        itemTexts.add(norm(it.left));
      }
      if (it.right) {
        itemTexts.add(it.right.toLowerCase());
        itemTexts.add(norm(it.right));
      }
    }

    // Filter out lines from q.question that repeat Part A / Part B headers or any table item
    const rawLines = String(q.question || '')
      .split('\n')
      .map(l => l.trim())
      .filter(Boolean);

    const headerOrListPattern =
      /^(?:['"‘’]?(?:ಅ|ಆ|a|b|ಎ|ಬಿ)['"‘’]?\s*(?:ಭಾಗ|ಪಟ್ಟಿ|column|part)|(?:ಭಾಗ|ಪಟ್ಟಿ|column|part)\s*[-–:]?\s*['"‘’]?(?:ಅ|ಆ|a|b|ಎ|ಬಿ)['"‘’]?|[0-9೦-೯]+[\.\)]\s*|[a-dA-Dಅಆಇಈ][\.\)]\s*)/i;

    const keptLines = rawLines.filter(line => {
      const low = line.toLowerCase();
      const nLow = norm(line);
      if (itemTexts.has(low) || itemTexts.has(nLow)) return false;
      // Drop lines that contain one of the left/right item strings
      for (const it of rawItems) {
        const nl = norm(it.left);
        if (nl.length >= 3 && nLow.includes(nl)) return false;
      }
      if (headerOrListPattern.test(line)) return false;
      return true;
    });

    const isEnglishPaper =
      /english/i.test(paper.header.subject || '') ||
      (/^[A-Za-z0-9\s.,:;\-()'"!?]+$/.test(q.question || '') && (q.question || '').trim().length > 0);

    const fallbackPrompt = isEnglishPaper
      ? 'Match the following:'
      : 'ಕೆಳಗಿನವುಗಳನ್ನು ಹೊಂದಿಸಿ ಬರೆಯಿರಿ:';

    const cleanPrompt = keptLines.length > 0 ? keptLines[0] : fallbackPrompt;
    return { isMatchTable: true, cleanPrompt, cleanItems: rawItems };
  };

  return (
    <div className="space-y-6">
      {/* Action Toolbar */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs flex flex-wrap items-center justify-between gap-4 no-print">
        
        {/* Left: View Controls */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Font Size Selector */}
          <div className="flex items-center gap-1 border border-slate-200 rounded-lg p-1 text-xs">
            <Type className="w-3.5 h-3.5 text-slate-400 ml-1" />
            <button
              onClick={() => setFontSize('sm')}
              className={`px-2 py-0.5 rounded font-medium ${
                fontSize === 'sm' ? 'bg-indigo-50 text-indigo-700 font-bold' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              A-
            </button>
            <button
              onClick={() => setFontSize('base')}
              className={`px-2 py-0.5 rounded font-medium ${
                fontSize === 'base' ? 'bg-indigo-50 text-indigo-700 font-bold' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              A
            </button>
            <button
              onClick={() => setFontSize('lg')}
              className={`px-2 py-0.5 rounded font-medium ${
                fontSize === 'lg' ? 'bg-indigo-50 text-indigo-700 font-bold' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              A+
            </button>
          </div>

          {/* Line spacing selector */}
          <div className="flex items-center gap-1 border border-slate-200 rounded-lg p-1 text-xs">
            <AlignJustify className="w-3.5 h-3.5 text-slate-400 ml-1" />
            <button
              onClick={() => setLineSpacing('tight')}
              className={`px-2 py-0.5 rounded ${
                lineSpacing === 'tight' ? 'bg-indigo-50 text-indigo-700 font-bold' : 'text-slate-600'
              }`}
            >
              ಕಿರಿದು
            </button>
            <button
              onClick={() => setLineSpacing('normal')}
              className={`px-2 py-0.5 rounded ${
                lineSpacing === 'normal' ? 'bg-indigo-50 text-indigo-700 font-bold' : 'text-slate-600'
              }`}
            >
              ಸಾಧಾರಣ
            </button>
            <button
              onClick={() => setLineSpacing('relaxed')}
              className={`px-2 py-0.5 rounded ${
                lineSpacing === 'relaxed' ? 'bg-indigo-50 text-indigo-700 font-bold' : 'text-slate-600'
              }`}
            >
              ವಿಸ್ತಾರ
            </button>
          </div>

          {/* Dotted Lines for Answer Writing Controls */}
          <div className="flex items-center gap-1.5 border border-slate-200 rounded-lg p-1 text-xs">
            <button
              type="button"
              onClick={() => setShowDottedLines(!showDottedLines)}
              className={`px-2 py-0.5 rounded font-bold transition-all cursor-pointer ${
                showDottedLines ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600'
              }`}
              title="ವಿದ್ಯಾರ್ಥಿಗಳಿಗೆ ಉತ್ತರ ಬರೆಯಲು ಡಾಟೆಡ್ ಲೈನ್‌ಗಳು (Answer Dotted Lines)"
            >
              ಡಾಟೆಡ್ ಲೈನ್‌ಗಳು: {showDottedLines ? 'ಆನ್' : 'ಆಫ್'}
            </button>
            {showDottedLines && (
              <div className="flex items-center gap-0.5 border-l border-slate-200 pl-1.5">
                <span className="text-3xs text-slate-400 mr-0.5">ಅಂತರ:</span>
                <button
                  type="button"
                  onClick={() => setDottedLineGap('normal')}
                  className={`px-1.5 py-0.5 rounded text-2xs font-bold transition-colors ${
                    dottedLineGap === 'normal'
                      ? 'bg-indigo-100 text-indigo-800'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                  title="22px ಸಾಮಾನ್ಯ ಅಂತರ (Normal Line Spacing)"
                >
                  ಸಾಮಾನ್ಯ
                </button>
                <button
                  type="button"
                  onClick={() => setDottedLineGap('relaxed')}
                  className={`px-1.5 py-0.5 rounded text-2xs font-bold transition-colors ${
                    dottedLineGap === 'relaxed'
                      ? 'bg-indigo-100 text-indigo-800'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                  title="28px ಮಧ್ಯಮ ಅಂತರ (Medium Line Spacing)"
                >
                  ಮಧ್ಯಮ
                </button>
                <button
                  type="button"
                  onClick={() => setDottedLineGap('spacious')}
                  className={`px-1.5 py-0.5 rounded text-2xs font-bold transition-colors ${
                    dottedLineGap === 'spacious'
                      ? 'bg-indigo-100 text-indigo-800'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                  title="34px ಹೆಚ್ಚು ಅಂತರ (Spacious Line Spacing)"
                >
                  ಹೆಚ್ಚು
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Right: Regenerate & Print buttons */}
        <div className="flex flex-wrap items-center gap-2">
          {onBackToSetup && (
            <button
              type="button"
              onClick={onBackToSetup}
              className="px-3.5 py-1.5 text-xs font-bold text-emerald-900 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer"
            >
              <span>ಸೆಟಪ್‌ಗೆ ಹಿಂತಿರುಗಿ</span>
            </button>
          )}

          <button
            type="button"
            onClick={onResetToGenerated}
            title="ಮೂಲ ರಚಿತ ಆವೃತ್ತಿಗೆ ಹಿಂತಿರುಗಿ"
            className="px-3 py-1.5 text-xs font-semibold text-slate-700 hover:text-slate-950 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>ಮರುಹೊಂದಿಸಿ</span>
          </button>

          <button
            type="button"
            onClick={onRegenerate}
            title="ಹೊಸ ಸಂಯೋಜನೆಯೊಂದಿಗೆ ಪುನಃ ರಚಿಸಿ"
            className="px-3 py-1.5 text-xs font-semibold text-sky-900 hover:text-sky-950 bg-sky-100 hover:bg-sky-200 border border-sky-200 rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>ಪುನಃ ರಚಿಸಿ</span>
          </button>

          <button
            type="button"
            onClick={handleSaveToFirebase}
            disabled={isSavingToFirebase}
            title="ಪ್ರಶ್ನೆ ಪತ್ರಿಕೆಯನ್ನು Firebase ಕ್ಲೌಡ್ ಡೇಟಾಬೇಸ್‌ಗೆ ಉಳಿಸಿ"
            className={`px-3.5 py-1.5 text-xs font-bold rounded-lg transition-colors flex items-center gap-1.5 shadow-xs cursor-pointer ${
              firebaseSaveSuccess
                ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                : 'bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-300'
            }`}
          >
            {firebaseSaveSuccess ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-600" />
                <span>ಉಳಿಸಲಾಗಿದೆ!</span>
              </>
            ) : (
              <>
                <Cloud className="w-3.5 h-3.5 text-amber-600" />
                <span>{isSavingToFirebase ? 'ಉಳಿಸಲಾಗುತ್ತಿದೆ...' : 'ಕ್ಲೌಡ್‌ಗೆ ಉಳಿಸಿ'}</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={() => window.print()}
            className="px-4 py-1.5 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-colors shadow-xs flex items-center gap-1.5 cursor-pointer"
          >
            <Printer className="w-4 h-4" />
            <span>ಮುದ್ರಣ / PDF</span>
          </button>
        </div>

      </div>

      {/* A4 Paper Canvas */}
      <div className="printable-document bg-white border border-emerald-200 shadow-lg mx-auto max-w-[210mm] min-h-[297mm] p-4 sm:p-8 md:p-12 text-slate-900 font-kannada relative rounded-xl sm:rounded-none">
        
        {/* Paper Header */}
        <div className="text-center pb-3 border-b-2 border-slate-900 mb-4 space-y-1">
          <h1 className="text-xl sm:text-2xl font-black tracking-wide text-slate-900 uppercase">
            {paper.header.schoolName}
          </h1>
          <h2 className="text-base sm:text-lg font-bold text-slate-800">
            {paper.header.examName} · {paper.header.academicYear}
          </h2>

          {/* Student metadata bar */}
          <div className="pt-2 text-xs font-medium grid grid-cols-2 sm:grid-cols-4 gap-2 text-left border-t border-slate-300 mt-2">
            <div>
              <strong>ತರಗತಿ:</strong> {paper.header.grade}
            </div>
            <div>
              <strong>ವಿಷಯ:</strong> {paper.header.subject}
            </div>
            <div>
              <strong>ಸಮಯ:</strong> {paper.header.time}
            </div>
            <div className="text-right sm:text-right font-bold">
              <strong>ಗರಿಷ್ಠ ಅಂಕಗಳು:</strong> {paper.header.maxMarks}
            </div>
          </div>

          <div className="pt-2 text-xs grid grid-cols-2 gap-4 text-left border-t border-dashed border-slate-200">
            <div>
              <span>ವಿದ್ಯಾರ್ಥಿಯ ಹೆಸರು: ___________________________</span>
            </div>
            <div className="text-right">
              <span>ನೋಂದಣಿ ಸಂಖ್ಯೆ / Roll No: ______________</span>
            </div>
          </div>
        </div>

        {/* General Instructions */}
        {paper.header.generalInstructions.length > 0 && (
          <div className="mb-6 p-3 bg-slate-50/70 border border-slate-200 rounded text-xs space-y-1">
            <span className="font-bold underline text-slate-800 block mb-1">ಸಾಮಾನ್ಯ ಸೂಚನೆಗಳು:</span>
            <ol className="list-decimal list-inside space-y-0.5 text-slate-700">
              {paper.header.generalInstructions.map((ins, idx) => (
                <li key={idx}>{ins}</li>
              ))}
            </ol>
          </div>
        )}

        {/* Sections and Questions */}
        <div className="space-y-6">
          {paper.sections.map((section, sIdx) => {
            const sectionTotalMarks = section.questions.reduce((sum, q) => sum + q.marks, 0);

            return (
              <div key={section.blueprint.id} className="section-block">
                
                {/* Section Title Header */}
                <div className="flex items-center justify-between border-b border-slate-800 pb-1 mb-3">
                  <div className="font-bold text-sm sm:text-base text-slate-900">
                    <span>{section.blueprint.title}</span>
                  </div>
                  <div className="font-bold text-xs sm:text-sm text-slate-800 tabular-nums">
                    {section.blueprint.formatCategoryId === 'match' ? (
                      <span>[೧ × {sectionTotalMarks} = {sectionTotalMarks} ಅಂಕಗಳು]</span>
                    ) : (
                      <span>[{section.questions.length} × {section.blueprint.marksPerQuestion} = {sectionTotalMarks} ಅಂಕಗಳು]</span>
                    )}
                  </div>
                </div>

                {/* Section Instruction */}
                {section.blueprint.instructionText && (
                  <p className="text-xs italic text-slate-700 mb-3">
                    {section.blueprint.instructionText}
                  </p>
                )}

                {/* Question Items */}
                <div className={lineSpacingClass}>
                  {section.questions.map((q, qIdx) => {
                    const isEditing = editingQuestionUid === q.uid;
                    const lineCount = getDefaultLineCount(q);
                    const matchDisplay = getCleanMatchDisplay(q);
                    const { stem: displayStem, options: displayOptions } = matchDisplay.isMatchTable
                      ? { stem: matchDisplay.cleanPrompt, options: [] as string[] }
                      : extractMcqDisplay(q);

                    return (
                      <div
                        key={q.uid}
                        className={`question-block relative rounded-lg transition-all ${
                          q.pageBreakBefore ? 'page-break-always pt-4 border-t-2 border-indigo-200' : ''
                        }`}
                      >
                        {/* Page break marker in preview */}
                        {q.pageBreakBefore && (
                          <div className="no-print text-2xs text-indigo-600 font-mono mb-2 flex items-center gap-1.5">
                            <Scissors className="w-3 h-3" />
                            <span>--- ಮುದ್ರಣ ಪುಟ ವಿಭಜನೆ (PAGE BREAK) ---</span>
                          </div>
                        )}

                        {/* Question Content */}
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex items-start gap-2 flex-1 min-w-0">
                            <span className="font-bold shrink-0">{q.displayNumber}.</span>
                            
                            <div className="flex-1 min-w-0">
                              {isEditing ? (
                                <textarea
                                  value={q.question}
                                  onChange={e => handleUpdateQuestionText(q.uid, e.target.value)}
                                  rows={2}
                                  className={`w-full p-2 border border-indigo-400 rounded-md font-kannada ${fontSizeClass} focus:outline-hidden focus:ring-1 focus:ring-indigo-600`}
                                />
                              ) : (
                                <div className={`font-medium ${fontSizeClass} whitespace-pre-line text-slate-900`}>
                                  <MathText text={displayStem} />
                                </div>
                              )}

                              {/* Question Diagram / Dual Images Side-by-Side Display */}
                              {q.imageUrl && q.imageUrl2 ? (
                                <div className="my-2.5 grid grid-cols-2 gap-3 max-w-2xl items-center">
                                  <div className="flex justify-center">
                                    <ResilientQuestionImage
                                      src={q.imageUrl}
                                      alt={q.diagramDescription || 'ಪ್ರಶ್ನೆ ಚಿತ್ರ 1 / Diagram 1'}
                                      className="max-h-56 w-full rounded border border-slate-300 object-contain bg-white p-1"
                                    />
                                  </div>
                                  <div className="flex justify-center">
                                    <ResilientQuestionImage
                                      src={q.imageUrl2}
                                      alt="ಪ್ರಶ್ನೆ ಚಿತ್ರ 2 / Diagram 2"
                                      className="max-h-56 w-full rounded border border-slate-300 object-contain bg-white p-1"
                                    />
                                  </div>
                                </div>
                              ) : (q.imageUrl || q.imageUrl2) ? (
                                <div className="my-2.5 inline-block max-w-sm">
                                  <ResilientQuestionImage
                                    src={(q.imageUrl || q.imageUrl2)!}
                                    alt={q.diagramDescription || 'ಪ್ರಶ್ನೆ ಚಿತ್ರ / Diagram'}
                                    className="max-h-56 max-w-full rounded border border-slate-300 object-contain bg-white p-1"
                                  />
                                </div>
                              ) : null}

                              {q.diagramSvg && !q.imageUrl && !q.imageUrl2 && (
                                <div
                                  className="my-2.5 max-w-sm border border-slate-300 rounded bg-white p-2"
                                  dangerouslySetInnerHTML={{ __html: q.diagramSvg }}
                                />
                              )}

                              {/* MCQ Options Display: Always 4 options in a single horizontal line (mobile, desktop & print) */}
                              {displayOptions.length > 0 && (
                                <div className="mcq-options-row grid grid-cols-4 gap-x-2 sm:gap-x-4 gap-y-1 mt-1.5 pl-1 sm:pl-2 w-full items-start">
                                  {displayOptions.map((opt, oIdx) => (
                                    <div
                                      key={oIdx}
                                      className={`${fontSizeClass} text-slate-800 break-words leading-snug min-w-0`}
                                    >
                                      <MathText text={opt} />
                                    </div>
                                  ))}
                                </div>
                              )}

                              {/* Match the following items table (single clean A/B table, zero duplicate Part A above) */}
                              {matchDisplay.isMatchTable && matchDisplay.cleanItems.length > 0 && (
                                <div className="mt-2 max-w-lg border border-slate-300 rounded-lg overflow-hidden text-xs">
                                  <table className="w-full border-collapse">
                                    <thead>
                                      <tr className="bg-slate-100 border-b border-slate-300 text-slate-800 font-bold">
                                        <th className="py-1.5 px-3 text-left w-1/2 border-r border-slate-300">ಭಾಗ - 'ಅ'</th>
                                        <th className="py-1.5 px-3 text-left w-1/2">ಭಾಗ - 'ಆ'</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {matchDisplay.cleanItems.map((item, itmIdx) => (
                                        <tr key={itmIdx} className="border-b border-slate-200 last:border-b-0">
                                          <td className="py-1.5 px-3 text-slate-900 border-r border-slate-200"><MathText text={item.left} /></td>
                                          <td className="py-1.5 px-3 text-slate-900"><MathText text={item.right} /></td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              )}

                              {/* Dotted Answer Lines for Student Writing */}
                              {showDottedLines && lineCount > 0 && (
                                <div className="mt-2.5 space-y-1.5 select-none w-full">
                                  {Array.from({ length: lineCount }).map((_, lIdx) => (
                                    <div
                                      key={lIdx}
                                      style={{
                                        height:
                                          dottedLineGap === 'normal'
                                            ? '22px'
                                            : dottedLineGap === 'spacious'
                                            ? '34px'
                                            : '28px',
                                      }}
                                      className="w-full border-b border-dotted border-slate-400/90 flex items-end pb-0.5"
                                    >
                                      {lIdx === 0 && (q.formatCategoryId === 'mcq' || q.marks === 1) && (
                                        <span className="text-2xs text-slate-400 select-none mr-2 font-medium">ಉತ್ತರ:</span>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              )}

                              {/* Always-Visible Touch-Friendly Question Controls (Mobile & Desktop, Hidden on print) */}
                              <div className="no-print mt-2.5 pt-2 border-t border-dashed border-slate-200 flex flex-wrap items-center justify-between gap-2 text-[11px]">
                                <div className="flex flex-wrap items-center gap-1.5">
                                  {/* Primary Prominent Swap Button — Always visible on Mobile & Desktop */}
                                  <button
                                    type="button"
                                    onClick={() => handleOpenReplaceModal(sIdx, q)}
                                    title="ಈ ಪ್ರಶ್ನೆಯನ್ನು ಬದಲಾಯಿಸಿ (Swap Question)"
                                    className="min-h-[32px] px-2.5 py-1 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white font-bold rounded-lg transition-colors inline-flex items-center gap-1.5 cursor-pointer shadow-2xs"
                                  >
                                    <RefreshCw className="w-3.5 h-3.5 shrink-0" />
                                    <span>ಪ್ರಶ್ನೆ ಬದಲಾಯಿಸಿ</span>
                                  </button>

                                  {/* Edit text inline */}
                                  <button
                                    type="button"
                                    onClick={() => setEditingQuestionUid(isEditing ? null : q.uid)}
                                    title="ಪ್ರಶ್ನೆ ಪಠ್ಯ ಸಂಪಾದಿಸಿ"
                                    className={`min-h-[32px] px-2.5 py-1 font-bold rounded-lg border transition-colors inline-flex items-center gap-1 cursor-pointer ${
                                      isEditing
                                        ? 'bg-emerald-600 text-white border-emerald-600'
                                        : 'bg-sky-50 hover:bg-sky-100 text-sky-900 border-sky-200'
                                    }`}
                                  >
                                    <Edit3 className="w-3.5 h-3.5 shrink-0" />
                                    <span>{isEditing ? 'ಮುಗಿಸಿ' : 'ಸಂಪಾದಿಸಿ'}</span>
                                  </button>

                                  {/* Move Up / Down */}
                                  <button
                                    type="button"
                                    disabled={qIdx === 0}
                                    onClick={() => handleMoveQuestion(sIdx, qIdx, 'up')}
                                    title="ಮೇಲಕ್ಕೆ ಚಲಿಸಿ"
                                    className="min-h-[32px] px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 rounded-lg disabled:opacity-30 cursor-pointer"
                                    aria-label="Move Up"
                                  >
                                    <ArrowUp className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    type="button"
                                    disabled={qIdx === section.questions.length - 1}
                                    onClick={() => handleMoveQuestion(sIdx, qIdx, 'down')}
                                    title="ಕೆಳಕ್ಕೆ ಚಲಿಸಿ"
                                    className="min-h-[32px] px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 rounded-lg disabled:opacity-30 cursor-pointer"
                                    aria-label="Move Down"
                                  >
                                    <ArrowDown className="w-3.5 h-3.5" />
                                  </button>

                                  {/* Toggle Page Break */}
                                  <button
                                    type="button"
                                    onClick={() => handleTogglePageBreak(sIdx, qIdx)}
                                    title={q.pageBreakBefore ? 'ಪುಟ ವಿಭಜನೆ ತೆಗೆಯಿರಿ' : 'ಇಲ್ಲಿಂದ ಮುಂದಿನ ಪುಟಕ್ಕೆ ಹಾಕಿ'}
                                    className={`min-h-[32px] px-2 py-1 font-semibold rounded-lg border transition-colors inline-flex items-center gap-1 cursor-pointer ${
                                      q.pageBreakBefore
                                        ? 'bg-amber-100 text-amber-900 border-amber-300'
                                        : 'bg-white hover:bg-amber-50 text-slate-700 border-slate-200'
                                    }`}
                                  >
                                    <Scissors className="w-3.5 h-3.5 shrink-0" />
                                    <span className="hidden sm:inline">ಪುಟ</span>
                                  </button>

                                  {/* Delete */}
                                  <button
                                    type="button"
                                    onClick={() => handleRemoveQuestion(sIdx, qIdx)}
                                    title="ಪ್ರಶ್ನೆ ಅಳಿಸಿ"
                                    className="min-h-[32px] px-2 py-1 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-lg transition-colors cursor-pointer"
                                    aria-label="Delete Question"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>

                                {/* Dotted Answer Lines Controls */}
                                <div className="flex items-center gap-1.5 text-slate-600">
                                  <span className="font-semibold tabular-nums">ಲೈನ್: {lineCount}</span>
                                  <button
                                    type="button"
                                    onClick={() => setCustomLineCounts(prev => ({ ...prev, [q.uid]: lineCount + 1 }))}
                                    className="min-h-[30px] px-2 py-0.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 font-bold border border-emerald-200 rounded-lg transition-colors cursor-pointer"
                                    title="ಈ ಪ್ರಶ್ನೆಗೆ 1 ಲೈನ್ ಸೇರಿಸಿ"
                                  >
                                    + ಲೈನ್
                                  </button>
                                  {lineCount > 0 && (
                                    <button
                                      type="button"
                                      onClick={() => setCustomLineCounts(prev => ({ ...prev, [q.uid]: Math.max(0, lineCount - 1) }))}
                                      className="min-h-[30px] px-2 py-0.5 bg-rose-50 hover:bg-rose-100 text-rose-700 font-bold border border-rose-200 rounded-lg transition-colors cursor-pointer"
                                      title="ಈ ಪ್ರಶ್ನೆಯಿಂದ 1 ಲೈನ್ ತೆಗೆಯಿರಿ"
                                    >
                                      - ಲೈನ್
                                    </button>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>

                          {/* Marks Display */}
                          <div className="shrink-0 font-bold text-xs sm:text-sm text-slate-700 tabular-nums">
                            [{q.marks}]
                          </div>
                        </div>

                      </div>
                    );
                  })}
                </div>

              </div>
            );
          })}
        </div>

        {/* Paper Footer Note */}
        <div className="mt-12 pt-4 border-t border-slate-300 text-center text-xs text-slate-500 italic">
          *** ಪರೀಕ್ಷೆಗೆ ಶುಭಹಾರೈಕೆಗಳು (ALL THE BEST) ***
        </div>

      </div>

      {/* Question Replace Modal */}
      <ReplaceQuestionModal
        isOpen={Boolean(replacingQuestion)}
        onClose={() => setReplacingQuestion(null)}
        targetQuestion={replacingQuestion}
        candidateQuestions={candidateReplacements}
        onSelectReplacement={handleApplyReplacement}
      />
    </div>
  );
};
