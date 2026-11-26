/**
 * Setup Panel Component: 1. ಪರೀಕ್ಷಾ ವಿವರಗಳು (Exam Setup)
 * Professional Teacher Workspace: Class, Subject, Marks, Question Count, Exam Pattern, and Blueprint.
 * Admin-only controls (JSON Upload, JSON Guide, AI JSON Generator, Question Bank Images) are hidden from standard users.
 */

import React, { useMemo } from 'react';
import { IndexEntry } from '../types/questionBank.ts';
import {
  ShieldCheck,
  RefreshCw,
  Zap,
  ChevronDown,
  FileSpreadsheet,
  BookOpen,
  Sparkles,
  Upload,
  SlidersHorizontal,
  Image as ImageIcon,
} from 'lucide-react';
import {
  matchesGrade,
  extractGradeKey,
  canonicalGradeLabel,
  normalizeSubjectName,
  deduceSubjectCode,
  getSubjectDedupKey,
  formatDropdownSubjectLabel,
} from '../services/dataLoader.ts';
import { getRecommendedQuestionCount } from '../services/blueprintEngine.ts';

interface SetupPanelProps {
  isAdmin?: boolean;
  schoolName: string;
  setSchoolName: (name: string) => void;
  medium: string;
  setMedium: (med: string) => void;
  grade: string;
  setGrade: (grade: string) => void;
  selectedFileId: string;
  setSelectedFileId: (fileId: string) => void;
  availableFiles: IndexEntry[];
  semesterPart: 'sem1' | 'sem2' | 'all';
  setSemesterPart: (part: 'sem1' | 'sem2' | 'all') => void;
  paperModel: 'paper' | 'answers' | 'both';
  setPaperModel: (model: 'paper' | 'answers' | 'both') => void;
  examType: string;
  setExamType: (exam: string) => void;
  targetMarks: number;
  setTargetMarks: (marks: number) => void;
  targetQuestionsCount: number;
  setTargetQuestionsCount: (count: number) => void;
  examDateOrYear: string;
  setExamDateOrYear: (val: string) => void;
  onGenerate: () => void;
  onFreshSet: () => void;
  isGenerating?: boolean;
  onViewBlueprint?: () => void;
  onOpenSectionConfig?: () => void;
  onOpenJsonGuide?: () => void;
  onOpenAiGenerator?: () => void;
  onOpenExplorer?: () => void;
  onImportJsonFile?: (file: File) => void | Promise<void>;
  isImportingJson?: boolean;
}

export const SetupPanel: React.FC<SetupPanelProps> = ({
  isAdmin = false,
  schoolName,
  setSchoolName,
  medium,
  setMedium,
  grade,
  setGrade,
  selectedFileId,
  setSelectedFileId,
  availableFiles,
  semesterPart,
  setSemesterPart,
  paperModel,
  setPaperModel,
  examType,
  setExamType,
  targetMarks,
  setTargetMarks,
  targetQuestionsCount,
  setTargetQuestionsCount,
  examDateOrYear,
  setExamDateOrYear,
  onGenerate,
  onFreshSet,
  isGenerating,
  onViewBlueprint,
  onOpenSectionConfig,
  onOpenJsonGuide,
  onOpenAiGenerator,
  onOpenExplorer,
  onImportJsonFile,
  isImportingJson,
}) => {
  // Dynamically compile available grades without ANY duplicate entries
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

  // Current canonical grade label
  const activeGradeLabel = useMemo(() => {
    return canonicalGradeLabel(extractGradeKey(grade));
  }, [grade]);

  // Filter available question banks matching the currently selected grade
  const filteredFiles = useMemo(() => {
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

  const hasSpecificFilesForGrade = useMemo(() => {
    return availableFiles.some(f => matchesGrade(f, grade));
  }, [availableFiles, grade]);

  return (
    <div className="bg-white rounded-2xl border border-emerald-200 shadow-sm overflow-hidden font-kannada">
      {/* Colorful Emerald Header Band */}
      <div className="bg-gradient-to-r from-emerald-700 via-teal-700 to-emerald-800 px-5 py-3.5 flex items-center justify-between text-white">
        <div className="flex items-center gap-2">
          <BookOpen className="w-4 h-4 text-amber-300 shrink-0" />
          <h2 className="text-sm sm:text-base font-extrabold tracking-tight">
            1. ಪರೀಕ್ಷಾ ವಿವರಗಳು
          </h2>
        </div>
        <span className="text-xs font-bold text-emerald-100">ಹಂತ 1</span>
      </div>

      <div className="p-5 sm:p-6 space-y-4">
      {/* Field 1: School Name */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-xs font-bold text-emerald-950">
          <label htmlFor="setup-school-name">ಶಾಲೆಯ ಹೆಸರು (ಪತ್ರಿಕೆ ಶೀರ್ಷಿಕೆ)</label>
          <span className="text-[11px] text-emerald-700 font-semibold">ನೋಂದಾಯಿತ ಶಾಲೆ</span>
        </div>
        <input
          id="setup-school-name"
          type="text"
          value={schoolName}
          onChange={e => setSchoolName(e.target.value)}
          className="w-full bg-emerald-50/40 text-slate-900 font-bold text-xs rounded-xl px-3.5 py-2.5 border border-emerald-200 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/25 focus:border-emerald-600 uppercase"
        />
      </div>

      {/* Field 2: Teaching Medium */}
      <div className="space-y-1.5">
        <label htmlFor="setup-medium" className="block text-xs font-bold text-emerald-950">
          ಬೋಧನಾ ಮಾಧ್ಯಮ
        </label>
        <div className="relative">
          <select
            id="setup-medium"
            value={medium}
            onChange={e => setMedium(e.target.value)}
            className="w-full appearance-none bg-white border border-emerald-200 rounded-xl px-3.5 py-2.5 text-xs font-bold text-slate-800 pr-10 focus:ring-2 focus:ring-emerald-500/25 focus:border-emerald-600 focus:outline-none cursor-pointer"
          >
            <option value="ಕನ್ನಡ ಮಾಧ್ಯಮ (State Syllabus)">ಕನ್ನಡ ಮಾಧ್ಯಮ (State Syllabus)</option>
            <option value="English Medium">English Medium</option>
          </select>
          <ChevronDown className="w-4 h-4 text-emerald-600 absolute right-3 top-3 pointer-events-none" />
        </div>
      </div>

      {/* Field 3: Class & Subject */}
      <div className="space-y-2">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label htmlFor="setup-grade" className="block text-xs font-bold text-emerald-950">
              ತರಗತಿ (Class)
            </label>
            <div className="relative">
              <select
                id="setup-grade"
                value={activeGradeLabel}
                onChange={e => setGrade(canonicalGradeLabel(extractGradeKey(e.target.value)))}
                className="w-full appearance-none bg-sky-50/50 border border-sky-200 rounded-xl px-3 py-2.5 text-xs font-bold text-sky-950 pr-8 focus:bg-white focus:ring-2 focus:ring-sky-500/25 focus:border-sky-600 focus:outline-none cursor-pointer"
              >
                {gradeOptions.map(g => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
              <ChevronDown className="w-4 h-4 text-sky-600 absolute right-2.5 top-3 pointer-events-none" />
            </div>
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="setup-subject"
              className="text-xs font-bold text-emerald-950 flex items-center justify-between"
            >
              <span>ವಿಷಯ (Subject)</span>
              <span className="text-[11px] text-emerald-700 font-semibold tabular-nums">
                {filteredFiles.length} ಲಭ್ಯ
              </span>
            </label>
            <div className="relative">
              <select
                id="setup-subject"
                value={selectedFileId}
                onChange={e => setSelectedFileId(e.target.value)}
                className="w-full appearance-none bg-emerald-50/60 border border-emerald-500 rounded-xl px-3 py-2.5 text-xs font-bold text-emerald-950 pr-8 focus:bg-white focus:ring-2 focus:ring-emerald-500/25 focus:border-emerald-700 focus:outline-none cursor-pointer"
              >
                {filteredFiles.map(file => (
                  <option key={file.id} value={file.id}>
                    {formatDropdownSubjectLabel(file, filteredFiles)}
                  </option>
                ))}
              </select>
              <ChevronDown className="w-4 h-4 text-emerald-700 absolute right-2.5 top-3 pointer-events-none" />
            </div>
          </div>
        </div>

        {/* Admin-only alert when no direct bank exists for grade */}
        {isAdmin && !hasSpecificFilesForGrade && onOpenAiGenerator && (
          <div className="p-2.5 bg-amber-50 border border-amber-200 rounded-xl flex items-center justify-between gap-2 text-2xs text-amber-900">
            <span>ಈ ತರಗತಿಗೆ ಅಧಿಕೃತ ಬ್ಯಾಂಕ್ ಉಳಿಸಿಲ್ಲವೇ?</span>
            <button
              type="button"
              onClick={onOpenAiGenerator}
              className="px-2.5 py-1 bg-amber-200 hover:bg-amber-300 text-amber-950 font-bold rounded-lg transition-colors flex items-center gap-1 shrink-0 cursor-pointer whitespace-nowrap"
            >
              <Sparkles className="w-3 h-3" />
              <span>AI ಮೂಲಕ ರಚಿಸಿ</span>
            </button>
          </div>
        )}
      </div>

      {/* Field 4: Part / Semester */}
      <div className="space-y-1.5">
        <label htmlFor="setup-semester" className="block text-xs font-bold text-emerald-950">
          ಭಾಗ / ಸೆಮಿಸ್ಟರ್
        </label>
        <div className="relative">
          <select
            id="setup-semester"
            value={semesterPart}
            onChange={e => setSemesterPart(e.target.value as 'sem1' | 'sem2' | 'all')}
            className="w-full appearance-none bg-white border border-emerald-200 rounded-xl px-3.5 py-2.5 text-xs font-bold text-slate-800 pr-10 focus:ring-2 focus:ring-emerald-500/25 focus:border-emerald-600 focus:outline-none cursor-pointer"
          >
            <option value="sem2">ಭಾಗ 2 (Semester 2 · FA-3, FA-4)</option>
            <option value="sem1">ಭಾಗ 1 (Semester 1 · FA-1, FA-2)</option>
            <option value="all">ಸಂಪೂರ್ಣ ಪಠ್ಯಕ್ರಮ (Full Syllabus · Annual)</option>
          </select>
          <ChevronDown className="w-4 h-4 text-emerald-600 absolute right-3 top-3 pointer-events-none" />
        </div>
      </div>

      {/* Field 5: Paper Model */}
      <div className="space-y-1.5">
        <label htmlFor="setup-model" className="block text-xs font-bold text-emerald-950">
          ಪತ್ರಿಕೆಯ ಮಾದರಿ
        </label>
        <div className="relative">
          <select
            id="setup-model"
            value={paperModel}
            onChange={e => setPaperModel(e.target.value as 'paper' | 'answers' | 'both')}
            className="w-full appearance-none bg-white border border-emerald-200 rounded-xl px-3.5 py-2.5 text-xs font-bold text-slate-800 pr-10 focus:ring-2 focus:ring-emerald-500/25 focus:border-emerald-600 focus:outline-none cursor-pointer"
          >
            <option value="paper">ಕೇವಲ ಪ್ರಶ್ನೆಪತ್ರಿಕೆ (Question Paper Only)</option>
            <option value="answers">ಕೇವಲ ಉತ್ತರ ಪತ್ರಿಕೆ (Answer Key Only)</option>
            <option value="both">ಎರಡೂ (Question Paper &amp; Answer Key)</option>
          </select>
          <ChevronDown className="w-4 h-4 text-emerald-600 absolute right-3 top-3 pointer-events-none" />
        </div>
      </div>

      {/* Field 6: Examination Pattern */}
      <div className="space-y-1.5">
        <label htmlFor="setup-exam-type" className="block text-xs font-bold text-emerald-950">
          ಪರೀಕ್ಷಾ ವಿಧಾನ
        </label>
        <div className="relative">
          <select
            id="setup-exam-type"
            value={examType}
            onChange={e => setExamType(e.target.value)}
            className="w-full appearance-none bg-white border border-emerald-200 rounded-xl px-3.5 py-2.5 text-xs font-bold text-slate-800 pr-10 focus:ring-2 focus:ring-emerald-500/25 focus:border-emerald-600 focus:outline-none cursor-pointer"
          >
            <option value="ಸಂಕಲನಾತ್ಮಕ ಮೌಲ್ಯಮಾಪನ-1 (SA-1 ಮಧ್ಯವಾರ್ಷಿಕ)">
              ಸಂಕಲನಾತ್ಮಕ ಮೌಲ್ಯಮಾಪನ-1 (SA-1 ಮಧ್ಯವಾರ್ಷಿಕ)
            </option>
            <option value="ಸಂಕಲನಾತ್ಮಕ ಮೌಲ್ಯಮಾಪನ-2 (SA-2 ವಾರ್ಷಿಕ)">
              ಸಂಕಲನಾತ್ಮಕ ಮೌಲ್ಯಮಾಪನ-2 (SA-2 ವಾರ್ಷಿಕ)
            </option>
            <option value="ರಚನಾತ್ಮಕ ಮೌಲ್ಯಮಾಪನ-1 (FA-1)">ರಚನಾತ್ಮಕ ಮೌಲ್ಯಮಾಪನ-1 (FA-1)</option>
            <option value="ರಚನಾತ್ಮಕ ಮೌಲ್ಯಮಾಪನ-2 (FA-2)">ರಚನಾತ್ಮಕ ಮೌಲ್ಯಮಾಪನ-2 (FA-2)</option>
            <option value="ರಚನಾತ್ಮಕ ಮೌಲ್ಯಮಾಪನ-3 (FA-3)">ರಚನಾತ್ಮಕ ಮೌಲ್ಯಮಾಪನ-3 (FA-3)</option>
            <option value="ರಚನಾತ್ಮಕ ಮೌಲ್ಯಮಾಪನ-4 (FA-4)">ರಚನಾತ್ಮಕ ಮೌಲ್ಯಮಾಪನ-4 (FA-4)</option>
          </select>
          <ChevronDown className="w-4 h-4 text-emerald-600 absolute right-3 top-3 pointer-events-none" />
        </div>
      </div>

      {/* Field 7: Marks, Questions Count, Date */}
      <div className="grid grid-cols-3 gap-2.5">
        <div className="space-y-1">
          <label htmlFor="setup-marks" className="block text-[11px] font-bold text-emerald-900">
            ಅಂಕಗಳು
          </label>
          <input
            id="setup-marks"
            type="number"
            min={5}
            max={100}
            value={targetMarks}
            onChange={e => {
              const val = parseInt(e.target.value, 10) || 40;
              setTargetMarks(val);
              setTargetQuestionsCount(getRecommendedQuestionCount(val));
            }}
            className="w-full bg-emerald-50/70 text-emerald-950 font-extrabold text-sm rounded-xl px-3 py-2 text-center border border-emerald-300 tabular-nums focus:bg-white focus:ring-2 focus:ring-emerald-500/25 focus:border-emerald-600 focus:outline-none"
          />
        </div>

        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <label htmlFor="setup-qcount" className="block text-[11px] font-bold text-sky-900">
              ಪ್ರಶ್ನೆಗಳು
            </label>
            <button
              type="button"
              onClick={() => setTargetQuestionsCount(getRecommendedQuestionCount(targetMarks))}
              className="text-[10px] font-bold text-sky-700 hover:underline cursor-pointer"
              title="ಅಂಕಗಳಿಗೆ ತಕ್ಕಂತೆ ಪ್ರಶ್ನೆಗಳ ಸಂಖ್ಯೆಯನ್ನು ಸ್ವಯಂ ಲೆಕ್ಕಾಚಾರ ಮಾಡಿ"
            >
              ಸ್ವಯಂ
            </button>
          </div>
          <input
            id="setup-qcount"
            type="number"
            min={1}
            max={60}
            value={targetQuestionsCount}
            onChange={e => setTargetQuestionsCount(parseInt(e.target.value, 10) || 24)}
            className="w-full bg-sky-50/70 text-sky-950 font-extrabold text-sm rounded-xl px-3 py-2 text-center border border-sky-300 tabular-nums focus:bg-white focus:ring-2 focus:ring-sky-500/25 focus:border-sky-600 focus:outline-none"
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="setup-date" className="block text-[11px] font-bold text-amber-900">
            ಶೈಕ್ಷಣಿಕ ವರ್ಷ
          </label>
          <input
            id="setup-date"
            type="text"
            value={examDateOrYear}
            onChange={e => setExamDateOrYear(e.target.value)}
            className="w-full bg-amber-50/70 text-amber-950 font-bold text-xs rounded-xl px-2 py-2.5 text-center border border-amber-300 tabular-nums focus:bg-white focus:ring-2 focus:ring-amber-500/25 focus:border-amber-600 focus:outline-none"
          />
        </div>
      </div>

      {/* Zero-Repeat Mode Strip */}
      <div className="bg-gradient-to-r from-emerald-50 to-teal-50 border border-emerald-200 rounded-xl px-3 py-2.5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs font-semibold text-emerald-900 min-w-0">
          <ShieldCheck className="w-4 h-4 text-emerald-700 shrink-0" />
          <span className="truncate">ಪ್ರತಿ ಬಾರಿಯೂ ಹೊಸ ಪ್ರಶ್ನೆಗಳ ಸಂಯೋಜನೆ</span>
        </div>
        <button
          type="button"
          onClick={onFreshSet}
          className="px-2.5 py-1 text-[11px] font-bold rounded-lg bg-white text-emerald-800 border border-emerald-200 hover:bg-emerald-100 transition-colors shrink-0 inline-flex items-center gap-1 whitespace-nowrap cursor-pointer"
        >
          <RefreshCw className="w-3 h-3" />
          <span>ಹೊಸ ಸೆಟ್</span>
        </button>
      </div>

      {/* Configure Sections */}
      <button
        type="button"
        onClick={onOpenSectionConfig}
        className="w-full py-2.5 px-3.5 bg-amber-50/80 hover:bg-amber-100 text-amber-950 border border-amber-200 rounded-xl font-bold text-xs flex items-center justify-between transition-colors cursor-pointer"
      >
        <span className="flex items-center gap-2">
          <SlidersHorizontal className="w-3.5 h-3.5 text-amber-700 shrink-0" />
          <span>ವಿಭಾಗವಾರು ಪ್ರಶ್ನೆಗಳ ಹೊಂದಾಣಿಕೆ</span>
        </span>
        <span className="text-[11px] font-bold text-amber-800 whitespace-nowrap">ಹೊಂದಿಸಿ</span>
      </button>

      {/* Primary Action: Generate Question Paper */}
      <button
        type="button"
        disabled={isGenerating}
        onClick={onGenerate}
        className="w-full min-h-[48px] py-3 px-4 bg-gradient-to-r from-emerald-700 via-teal-700 to-emerald-800 hover:from-emerald-800 hover:to-teal-900 text-white font-extrabold text-sm rounded-xl shadow-sm transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
      >
        <Zap className="w-4 h-4 text-amber-300" />
        <span>ಪ್ರಶ್ನೆ ಪತ್ರಿಕೆ ರಚಿಸಿ (Generate Paper)</span>
      </button>

      {/* Secondary Action: Official 5-Stage Blueprint */}
      <button
        type="button"
        onClick={onViewBlueprint}
        className="w-full min-h-[44px] py-2.5 px-3.5 bg-gradient-to-r from-sky-50 to-indigo-50 hover:from-sky-100 hover:to-indigo-100 text-sky-950 border border-sky-300 rounded-xl font-bold text-xs transition-colors flex items-center justify-center gap-2 cursor-pointer"
      >
        <FileSpreadsheet className="w-4 h-4 text-sky-700" />
        <span>5-ಹಂತದ ಅಧಿಕೃತ ನೀಲನಕಾಶೆ (Blue Print)</span>
      </button>

      {/* ADMIN / DEVELOPER ONLY SECTION: Strictly hidden from regular school/teacher users */}
      {isAdmin && (
        <div className="pt-4 mt-2 border-t border-emerald-100 space-y-2.5">
          <div className="text-[11px] font-bold text-indigo-700 tracking-wide">
            ಅಡ್ಮಿನ್ / ಡೆವಲಪರ್ ಸಾಧನಗಳು
          </div>

          {onOpenExplorer && (
            <button
              type="button"
              onClick={onOpenExplorer}
              className="w-full py-2.5 px-3 bg-white hover:bg-indigo-50 text-slate-900 border border-slate-300 rounded-xl font-bold text-xs transition-colors flex items-center justify-between cursor-pointer"
            >
              <span className="flex items-center gap-2">
                <ImageIcon className="w-4 h-4 text-indigo-700 shrink-0" />
                <span>ಪ್ರಶ್ನೆ ಭಂಡಾರ &amp; ಚಿತ್ರ ನಿರ್ವಹಣೆ (6–10ನೇ ತರಗತಿ)</span>
              </span>
              <span className="text-[11px] text-indigo-700 font-bold">ತೆರೆಯಿರಿ</span>
            </button>
          )}

          {onImportJsonFile && (
            <label className="w-full flex items-center justify-center gap-1.5 px-3 py-2 bg-slate-50 hover:bg-indigo-50 text-indigo-700 border border-dashed border-indigo-300 rounded-xl text-2xs font-bold transition-colors cursor-pointer">
              {isImportingJson ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Upload className="w-3.5 h-3.5" />
              )}
              <span>
                {isImportingJson
                  ? 'JSON ಉಳಿಸಲಾಗುತ್ತಿದೆ...'
                  : 'ಸ್ಥಳೀಯ .JSON ಅಪ್‌ಲೋಡ್ & ಶಾಶ್ವತ ಸೇವ್'}
              </span>
              <input
                type="file"
                accept=".json,application/json"
                disabled={isImportingJson}
                onChange={e => {
                  const f = e.target.files?.[0];
                  if (f) onImportJsonFile(f);
                  e.target.value = '';
                }}
                className="hidden"
              />
            </label>
          )}

          <div className="grid grid-cols-2 gap-2">
            {onOpenAiGenerator && (
              <button
                type="button"
                onClick={onOpenAiGenerator}
                className="py-2 px-2.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-900 border border-indigo-200 rounded-xl font-bold text-2xs transition-colors flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap"
              >
                <Sparkles className="w-3.5 h-3.5 text-indigo-700 shrink-0" />
                <span className="truncate">AI JSON ಕ್ರಿಯೇಟರ್</span>
              </button>
            )}

            {onOpenJsonGuide && (
              <button
                type="button"
                onClick={onOpenJsonGuide}
                className="py-2 px-2.5 bg-white hover:bg-slate-50 text-slate-800 border border-slate-200 rounded-xl font-bold text-2xs transition-colors flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap"
              >
                <BookOpen className="w-3.5 h-3.5 text-slate-600 shrink-0" />
                <span className="truncate">JSON ಗೈಡ್</span>
              </button>
            )}
          </div>
        </div>
      )}
      </div>
    </div>
  );
};
