/**
 * Setup Panel Component: 1. ಪರೀಕ್ಷಾ ವಿವರಗಳು (Setup)
 * Matches the exact design, labels, dropdowns, and button style from the screenshot.
 * Author: M I Nilaji / S R Angadi
 */

import React, { useMemo } from 'react';
import { IndexEntry } from '../types/questionBank.ts';
import { ShieldCheck, RefreshCw, Zap, ChevronDown, FileText, Sparkles, Upload } from 'lucide-react';
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
  onOpenJsonGuide?: () => void;
  onOpenSectionConfig?: () => void;
  onOpenAiGenerator?: () => void;
  onImportJsonFile?: (file: File) => void | Promise<void>;
  isImportingJson?: boolean;
}

export const SetupPanel: React.FC<SetupPanelProps> = ({
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
  onOpenJsonGuide,
  onOpenSectionConfig,
  onOpenAiGenerator,
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

  // Filter available question banks matching the currently selected grade,
  // preserving every distinct subject, language tier, and medium variant
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
    <div className="bg-white rounded-2xl border border-slate-200/90 p-5 sm:p-6 shadow-xs space-y-4 font-kannada">
      
      {/* 1. Header with Step 1 pill */}
      <div className="flex items-center justify-between pb-1 border-b border-slate-100">
        <h2 className="text-base font-bold text-slate-900 tracking-tight">
          1. ಪರೀಕ್ಷಾ ವಿವರಗಳು (Setup)
        </h2>
        <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-[#dcfce7] text-[#15803d]">
          Step 1
        </span>
      </div>

      {/* Field 1: School Name */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-xs font-semibold text-slate-700">
          <span>ಶಾಲೆಯ ಹೆಸರು (Header)</span>
          <span className="text-amber-700 font-medium flex items-center gap-1">
            <span>🔒</span>
            <span>ನೋಂದಾಯಿತ ಶಾಲೆ</span>
          </span>
        </div>
        <input
          type="text"
          value={schoolName}
          onChange={e => setSchoolName(e.target.value)}
          className="w-full bg-[#edf1f7] text-slate-800 font-bold text-xs rounded-xl px-3.5 py-2.5 border border-slate-200/70 focus:outline-hidden focus:ring-1 focus:ring-indigo-600 uppercase"
        />
      </div>

      {/* Field 2: Teaching Medium */}
      <div className="space-y-1.5">
        <label className="block text-xs font-semibold text-slate-700">
          ಬೋಧನಾ ಮಾಧ್ಯಮ
        </label>
        <div className="relative">
          <select
            value={medium}
            onChange={e => setMedium(e.target.value)}
            className="w-full appearance-none bg-white border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs font-bold text-slate-800 pr-10 focus:ring-1 focus:ring-indigo-600 focus:outline-hidden cursor-pointer"
          >
            <option value="ಕನ್ನಡ ಮಾಧ್ಯಮ (State Syllabus)">ಕನ್ನಡ ಮಾಧ್ಯಮ (State Syllabus)</option>
            <option value="English Medium">English Medium</option>
          </select>
          <ChevronDown className="w-4 h-4 text-slate-500 absolute right-3 top-3 pointer-events-none" />
        </div>
      </div>

      {/* Field 3: Class & Subject (Side by side) */}
      <div className="space-y-2">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-slate-700">
              ತರಗತಿ
            </label>
            <div className="relative">
              <select
                value={activeGradeLabel}
                onChange={e => setGrade(canonicalGradeLabel(extractGradeKey(e.target.value)))}
                className="w-full appearance-none bg-white border border-slate-200 rounded-xl px-3 py-2.5 text-xs font-bold text-slate-800 pr-8 focus:ring-1 focus:ring-indigo-600 focus:outline-hidden cursor-pointer"
              >
                {gradeOptions.map(g => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
              <ChevronDown className="w-4 h-4 text-slate-500 absolute right-2.5 top-3 pointer-events-none" />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-slate-700 flex items-center justify-between">
              <span>ವಿಷಯ</span>
              <span className="text-2xs text-slate-400 font-medium">({filteredFiles.length} ಲಭ್ಯ)</span>
            </label>
            <div className="relative">
              <select
                value={selectedFileId}
                onChange={e => setSelectedFileId(e.target.value)}
                className="w-full appearance-none bg-white border-2 border-slate-900 rounded-xl px-3 py-2.5 text-xs font-bold text-slate-900 pr-8 focus:ring-1 focus:ring-indigo-600 focus:outline-hidden cursor-pointer shadow-xs"
              >
                {filteredFiles.map(file => (
                  <option key={file.id} value={file.id}>
                    {formatDropdownSubjectLabel(file, filteredFiles)}
                  </option>
                ))}
              </select>
              <ChevronDown className="w-4 h-4 text-slate-800 absolute right-2.5 top-3 pointer-events-none font-bold" />
            </div>
          </div>
        </div>

        {/* Helpful alert if no direct question bank exists for this grade */}
        {!hasSpecificFilesForGrade && onOpenAiGenerator && (
          <div className="p-2.5 bg-amber-50 border border-amber-200 rounded-xl flex items-center justify-between gap-2 text-2xs text-amber-900">
            <span>ಈ ತರಗತಿಗೆ ಅಧಿಕೃತ ಬ್ಯಾಂಕ್ ಉಳಿಸಿಲ್ಲವೇ?</span>
            <button
              type="button"
              onClick={onOpenAiGenerator}
              className="px-2 py-1 bg-amber-200 hover:bg-amber-300 text-amber-900 font-bold rounded-lg transition-colors flex items-center gap-1 shrink-0 cursor-pointer"
            >
              <Sparkles className="w-3 h-3" />
              <span>AI ಮೂಲಕ ರಚಿಸಿ</span>
            </button>
          </div>
        )}

        {/* Quick 1-click local .JSON Upload & Permanent Save */}
        {onImportJsonFile && (
          <label className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 bg-slate-50 hover:bg-indigo-50 text-indigo-700 border border-dashed border-indigo-300 rounded-xl text-2xs font-bold transition-colors cursor-pointer">
            {isImportingJson ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Upload className="w-3.5 h-3.5" />
            )}
            <span>
              {isImportingJson
                ? 'JSON ಉಳಿಸಲಾಗುತ್ತಿದೆ...'
                : 'ಸ್ಥಳೀಯ .JSON ಅಪ್‌ಲೋಡ್ & ಶಾಶ್ವತ ಸೇವ್ (Upload & Merge JSON)'}
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
      </div>

      {/* Field 4: Part / Semester */}
      <div className="space-y-1.5">
        <label className="block text-xs font-semibold text-slate-700">
          ಭಾಗ / ಸೆಮಿಸ್ಟರ್
        </label>
        <div className="relative">
          <select
            value={semesterPart}
            onChange={e => setSemesterPart(e.target.value as 'sem1' | 'sem2' | 'all')}
            className="w-full appearance-none bg-white border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs font-bold text-slate-800 pr-10 focus:ring-1 focus:ring-indigo-600 focus:outline-hidden cursor-pointer"
          >
            <option value="sem2">🟥 ಭಾಗ ೨ (Semester 2 / FA-3, FA-4)</option>
            <option value="sem1">🟦 ಭಾಗ ೧ (Semester 1 / FA-1, FA-2)</option>
            <option value="all">🟩 ಸಂಪೂರ್ಣ ಪಠ್ಯಕ್ರಮ (Full Syllabus / Annual)</option>
          </select>
          <ChevronDown className="w-4 h-4 text-slate-500 absolute right-3 top-3 pointer-events-none" />
        </div>
      </div>

      {/* Field 5: Paper Model */}
      <div className="space-y-1.5">
        <label className="block text-xs font-semibold text-slate-700">
          ಪತ್ರಿಕೆಯ ಮಾದರಿ
        </label>
        <div className="relative">
          <select
            value={paperModel}
            onChange={e => setPaperModel(e.target.value as 'paper' | 'answers' | 'both')}
            className="w-full appearance-none bg-[#fbfbfe] border border-amber-300 rounded-xl px-3.5 py-2.5 text-xs font-bold text-slate-800 pr-10 focus:ring-1 focus:ring-indigo-600 focus:outline-hidden cursor-pointer"
          >
            <option value="paper">📄 ಕೇವಲ ಪ್ರಶ್ನೆಪತ್ರಿಕೆ (Question Paper Only)</option>
            <option value="answers">✅ ಕೇವಲ ಉತ್ತರ ಪತ್ರಿಕೆ (Answer Key Only)</option>
            <option value="both">📑 ಎರಡೂ (Question Paper & Answer Key)</option>
          </select>
          <ChevronDown className="w-4 h-4 text-slate-500 absolute right-3 top-3 pointer-events-none" />
        </div>
      </div>

      {/* Field 6: Examination Pattern / Scheme */}
      <div className="space-y-1.5">
        <label className="block text-xs font-semibold text-slate-700">
          ಪರೀಕ್ಷಾ ವಿಧಾನ
        </label>
        <div className="relative">
          <select
            value={examType}
            onChange={e => setExamType(e.target.value)}
            className="w-full appearance-none bg-white border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs font-bold text-slate-800 pr-10 focus:ring-1 focus:ring-indigo-600 focus:outline-hidden cursor-pointer"
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
          <ChevronDown className="w-4 h-4 text-slate-500 absolute right-3 top-3 pointer-events-none" />
        </div>
      </div>

      {/* Field 7: 3-column Marks, Question count, Date with Auto-Calculation */}
      <div className="grid grid-cols-3 gap-2.5">
        <div className="space-y-1">
          <label className="block text-2xs font-bold text-slate-700 uppercase">
            ಅಂಕಗಳು
          </label>
          <input
            type="number"
            min={5}
            max={100}
            value={targetMarks}
            onChange={e => {
              const val = parseInt(e.target.value, 10) || 40;
              setTargetMarks(val);
              setTargetQuestionsCount(getRecommendedQuestionCount(val));
            }}
            className="w-full bg-[#f4f7fb] text-slate-900 font-bold text-sm rounded-xl px-3 py-2 text-center border border-slate-200/80 focus:ring-1 focus:ring-indigo-600 focus:outline-hidden"
          />
        </div>

        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <label className="block text-2xs font-bold text-slate-700 uppercase">
              ಪ್ರಶ್ನೆಗಳು
            </label>
            <button
              type="button"
              onClick={() => setTargetQuestionsCount(getRecommendedQuestionCount(targetMarks))}
              className="text-3xs font-extrabold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 px-1 py-0.2 rounded border border-indigo-200 transition-colors"
              title="ಅಂಕಗಳಿಗೆ ತಕ್ಕಂತೆ ಪ್ರಶ್ನೆಗಳ ಸಂಖ್ಯೆಯನ್ನು ಸ್ವಯಂ ಲೆಕ್ಕಾಚಾರ ಮಾಡಿ"
            >
              ⚡ ಸ್ವಯಂ
            </button>
          </div>
          <input
            type="number"
            min={1}
            max={60}
            value={targetQuestionsCount}
            onChange={e => setTargetQuestionsCount(parseInt(e.target.value, 10) || 24)}
            className="w-full bg-[#edf1f7] text-slate-900 font-bold text-sm rounded-xl px-3 py-2 text-center border border-slate-200/80 focus:ring-1 focus:ring-indigo-600 focus:outline-hidden"
          />
        </div>

        <div className="space-y-1">
          <label className="block text-2xs font-bold text-slate-700 uppercase">
            ದಿನಾಂಕ
          </label>
          <input
            type="text"
            value={examDateOrYear}
            onChange={e => setExamDateOrYear(e.target.value)}
            className="w-full bg-white text-slate-900 font-bold text-xs rounded-xl px-2 py-2 text-center border border-slate-200/80 focus:ring-1 focus:ring-indigo-600 focus:outline-hidden"
          />
        </div>
      </div>

      {/* Field 8: Zero-Repeat Mode with Fresh Set button */}
      <div className="bg-[#f0fdf4] border border-[#bbf7d0] rounded-xl p-2.5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs font-bold text-[#15803d]">
          <ShieldCheck className="w-4 h-4 text-[#16a34a] shrink-0" />
          <span className="truncate">Zero-Repeat Mode: ಪ್ರತಿ ಬಾರಿಯೂ ಹೊಸ ಪ್ರಶ್ನೆಗಳು</span>
        </div>
        <button
          type="button"
          onClick={onFreshSet}
          className="px-2.5 py-1 text-2xs font-bold rounded-lg bg-[#dcfce7] text-[#15803d] hover:bg-[#bbf7d0] transition-colors shrink-0 flex items-center gap-1 shadow-2xs"
        >
          <RefreshCw className="w-3 h-3" />
          <span>Fresh Set</span>
        </button>
      </div>

      {/* Field: ವಿಭಾಗವಾರು ಪ್ರಶ್ನೆಗಳ ಹೊಂದಾಣಿಕೆ (Configure Sections) */}
      <button
        type="button"
        onClick={onOpenSectionConfig}
        className="w-full py-2.5 px-3 bg-linear-to-r from-indigo-50 via-purple-50 to-indigo-50 hover:from-indigo-100 hover:to-purple-100 text-indigo-950 border border-indigo-200/90 rounded-xl font-bold text-xs flex items-center justify-between shadow-2xs transition-all cursor-pointer group"
      >
        <div className="flex items-center gap-2">
          <span className="text-sm">⚙️</span>
          <span className="font-extrabold tracking-tight">ವಿಭಾಗವಾರು ಪ್ರಶ್ನೆಗಳ ಹೊಂದಾಣಿಕೆ (Configure Sections)</span>
        </div>
        <span className="text-2xs font-extrabold text-indigo-700 bg-white px-2 py-0.5 rounded-lg border border-indigo-200 shadow-2xs">
          ಹೊಂದಿಸಿ
        </span>
      </button>

      {/* Field 9: Big Green Action Button */}
      <button
        type="button"
        disabled={isGenerating}
        onClick={onGenerate}
        className="w-full py-3.5 px-4 bg-[#009b5a] hover:bg-[#00874e] active:bg-[#007040] text-white font-extrabold text-sm rounded-xl shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
      >
        <Zap className="w-4 h-4 fill-white" />
        <span>ಪ್ರಶ್ನೆ ಪತ್ರಿಕೆ ರಚಿಸಿ (Instant 0.01s)</span>
      </button>

      {/* Helper Tools: Blueprint View & JSON Model Guide */}
      <div className="pt-2 grid grid-cols-2 gap-2 border-t border-slate-100">
        <button
          type="button"
          onClick={onViewBlueprint}
          className="w-full py-2.5 px-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-900 border border-indigo-200/80 rounded-xl font-bold text-2xs transition-colors flex items-center justify-center gap-1.5 shadow-2xs cursor-pointer"
        >
          <span>📊</span>
          <span className="truncate">ನೀಲನಕಾಶೆ (Blue Print)</span>
        </button>

        <button
          type="button"
          onClick={onOpenJsonGuide}
          className="w-full py-2.5 px-2 bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-200/80 rounded-xl font-bold text-2xs transition-colors flex items-center justify-center gap-1.5 shadow-2xs cursor-pointer"
        >
          <span>📘</span>
          <span className="truncate">JSON ಮಾದರಿ ಗೈಡ್</span>
        </button>
      </div>

      {onOpenAiGenerator && (
        <button
          type="button"
          onClick={onOpenAiGenerator}
          className="w-full py-2.5 px-3 bg-linear-to-r from-purple-50 via-indigo-50 to-blue-50 hover:from-purple-100 hover:to-indigo-100 text-purple-950 border border-purple-200/80 rounded-xl font-extrabold text-2xs transition-all flex items-center justify-between shadow-2xs cursor-pointer group"
        >
          <div className="flex items-center gap-2">
            <span className="text-sm">🤖</span>
            <span>AI ಪ್ರಶ್ನೆ ಬ್ಯಾಂಕ್ ಜನರೇಟರ್ (LBA PDF to JSON)</span>
          </div>
          <span className="px-2 py-0.5 rounded-md bg-purple-600 text-white font-black text-3xs">
            ಹೊಸತು
          </span>
        </button>
      )}

    </div>
  );
};
