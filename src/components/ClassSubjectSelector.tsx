/**
 * Step 1, 2, 3: Class, Medium, and Subject Selection Component
 * Dynamically populated from central index.json
 * Author: S R Angadi
 */

import React from 'react';
import { IndexEntry, QuestionBank } from '../types/questionBank.ts';
import { GraduationCap, Languages, Book, CheckCircle2, Info } from 'lucide-react';

import {
  extractGradeKey,
  canonicalGradeLabel,
  matchesGrade,
  normalizeSubjectName,
  deduceSubjectCode,
  getSubjectDedupKey,
} from '../services/dataLoader.ts';

interface ClassSubjectSelectorProps {
  availableFiles: IndexEntry[];
  selectedGrade: string;
  onSelectGrade: (grade: string) => void;
  selectedMedium: string;
  onSelectMedium: (medium: string) => void;
  selectedFileId: string;
  onSelectFile: (fileId: string) => void;
  currentBank: QuestionBank | null;
  isLoading: boolean;
}

export const ClassSubjectSelector: React.FC<ClassSubjectSelectorProps> = ({
  availableFiles,
  selectedGrade,
  onSelectGrade,
  selectedMedium,
  onSelectMedium,
  selectedFileId,
  onSelectFile,
  currentBank,
  isLoading,
}) => {
  // Extract unique canonical classes dynamically (e.g. 6, 7, 8, 9, 10)
  const uniqueGrades = React.useMemo(() => {
    const gradeKeys = new Set<string>(['6', '7', '8', '9', '10']);
    availableFiles.forEach(f => {
      const k = extractGradeKey(f.gradeKey || f.grade);
      if (k) gradeKeys.add(k);
    });
    const sorted = Array.from(gradeKeys).sort((a, b) => {
      const numA = parseInt(a, 10);
      const numB = parseInt(b, 10);
      if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
      return a.localeCompare(b);
    });
    return sorted.map(k => canonicalGradeLabel(k));
  }, [availableFiles]);

  // Extract unique mediums for the selected grade
  const availableMediums = React.useMemo(() => {
    const mediums = new Set<string>();
    availableFiles
      .filter(f => matchesGrade(f, selectedGrade))
      .forEach(f => {
        if (f.medium) mediums.add(f.medium);
      });
    return mediums.size > 0
      ? Array.from(mediums)
      : ['ಕನ್ನಡ ಮಾಧ್ಯಮ (State Syllabus)', 'English Medium'];
  }, [availableFiles, selectedGrade]);

  // Extract all available subjects for selected grade (preserving every distinct subject, language tier & medium)
  const availableSubjects = React.useMemo(() => {
    const gradeFiles = availableFiles.filter(f => matchesGrade(f, selectedGrade));
    const list = gradeFiles.length > 0 ? gradeFiles : availableFiles;

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
  }, [availableFiles, selectedGrade]);

  // Total questions count in current bank
  const totalQuestionsCount = React.useMemo(() => {
    if (!currentBank) return 0;
    return currentBank.chapters.reduce((acc, ch) => acc + ch.questions.length, 0);
  }, [currentBank]);

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 sm:p-6 shadow-xs">
      <div className="border-b border-slate-100 pb-4 mb-6">
        <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
          <GraduationCap className="w-5 h-5 text-indigo-600" />
          <span>ಮೂಲಭೂತ ಆಯ್ಕೆಗಳು / Basic Selection</span>
        </h2>
        <p className="text-xs text-slate-500 mt-1">
          ಪ್ರಶ್ನೆ ಬ್ಯಾಂಕ್ ಫೈಲ್‌ಗಳಿಂದ ಸ್ವಯಂಚಾಲಿತವಾಗಿ ಗುರುತಿಸಲಾದ ತರಗತಿ, ಮಾಧ್ಯಮ ಮತ್ತು ವಿಷಯವನ್ನು ಆಯ್ಕೆ ಮಾಡಿ.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Step 1: Select Class */}
        <div className="space-y-2">
          <label className="text-xs font-semibold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
            <span className="w-5 h-5 rounded-full bg-indigo-50 text-indigo-700 flex items-center justify-center text-xs font-bold">೧</span>
            <span>ತರಗತಿ ಆಯ್ಕೆ (Select Class)</span>
          </label>
          <div className="space-y-1.5">
            {uniqueGrades.map(grade => {
              const isSelected = matchesGrade({ grade }, selectedGrade);
              return (
                <button
                  key={grade}
                  type="button"
                  onClick={() => onSelectGrade(grade)}
                  className={`w-full text-left px-3.5 py-2.5 rounded-lg border text-sm font-medium transition-all flex items-center justify-between ${
                    isSelected
                      ? 'border-indigo-600 bg-indigo-50/50 text-indigo-950 font-semibold ring-1 ring-indigo-600'
                      : 'border-slate-200 hover:border-slate-300 text-slate-700 bg-white'
                  }`}
                >
                  <span className="truncate">{grade}</span>
                  {isSelected && <CheckCircle2 className="w-4 h-4 text-indigo-600 shrink-0" />}
                </button>
              );
            })}
          </div>
        </div>

        {/* Step 2: Select Medium */}
        <div className="space-y-2">
          <label className="text-xs font-semibold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
            <span className="w-5 h-5 rounded-full bg-indigo-50 text-indigo-700 flex items-center justify-center text-xs font-bold">೨</span>
            <span>ಮಾಧ್ಯಮ ಆಯ್ಕೆ (Select Medium)</span>
          </label>
          <div className="space-y-1.5">
            {availableMediums.map(med => {
              const isSelected = selectedMedium === med;
              return (
                <button
                  key={med}
                  type="button"
                  onClick={() => onSelectMedium(med)}
                  className={`w-full text-left px-3.5 py-2.5 rounded-lg border text-sm font-medium transition-all flex items-center justify-between ${
                    isSelected
                      ? 'border-indigo-600 bg-indigo-50/50 text-indigo-950 font-semibold ring-1 ring-indigo-600'
                      : 'border-slate-200 hover:border-slate-300 text-slate-700 bg-white'
                  }`}
                >
                  <span className="flex items-center gap-2 truncate">
                    <Languages className="w-4 h-4 text-slate-400" />
                    <span>{med}</span>
                  </span>
                  {isSelected && <CheckCircle2 className="w-4 h-4 text-indigo-600 shrink-0" />}
                </button>
              );
            })}
          </div>
        </div>

        {/* Step 3: Select Subject */}
        <div className="space-y-2">
          <label className="text-xs font-semibold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
            <span className="w-5 h-5 rounded-full bg-indigo-50 text-indigo-700 flex items-center justify-center text-xs font-bold">೩</span>
            <span>ವಿಷಯ ಆಯ್ಕೆ (Select Subject)</span>
          </label>
          <div className="space-y-1.5">
            {availableSubjects.map(sub => {
              const isSelected = selectedFileId === sub.id;
              return (
                <button
                  key={sub.id}
                  type="button"
                  onClick={() => onSelectFile(sub.id)}
                  className={`w-full text-left px-3.5 py-2.5 rounded-lg border text-sm font-medium transition-all flex items-center justify-between ${
                    isSelected
                      ? 'border-indigo-600 bg-indigo-50/50 text-indigo-950 font-semibold ring-1 ring-indigo-600'
                      : 'border-slate-200 hover:border-slate-300 text-slate-700 bg-white'
                  }`}
                >
                  <span className="flex items-center gap-2 truncate">
                    <Book className="w-4 h-4 text-slate-400" />
                    <span>{sub.subject}</span>
                  </span>
                  {isSelected && <CheckCircle2 className="w-4 h-4 text-indigo-600 shrink-0" />}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Loaded Question Bank Metadata Summary Card */}
      {currentBank && !isLoading && (
        <div className="mt-6 pt-5 border-t border-slate-100 bg-slate-50/70 rounded-lg p-4 flex flex-wrap items-center justify-between gap-4 text-xs text-slate-600">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="font-semibold text-slate-900">
              {currentBank.metadata.grade} · {currentBank.metadata.subject}
            </span>
            <span className="text-slate-400">|</span>
            <span>ಪಠ್ಯಕ್ರಮ: {currentBank.metadata.board || 'ಕರ್ನಾಟಕ ರಾಜ್ಯ ಪಠ್ಯಕ್ರಮ'}</span>
            <span className="text-slate-400">|</span>
            <span>ಶೈಕ್ಷಣಿಕ ವರ್ಷ: {currentBank.metadata.academicYear || '2026-27'}</span>
            <span className="text-slate-400">|</span>
            <span>ರಚನೆ: {currentBank.metadata.author || 'S R Angadi'}</span>
          </div>
          <div className="flex items-center gap-4 text-slate-800 font-medium">
            <span>ಅಧ್ಯಾಯಗಳು: <strong className="text-indigo-700 font-bold">{currentBank.chapters.length}</strong></span>
            <span>ಒಟ್ಟು ಪ್ರಶ್ನೆಗಳು: <strong className="text-indigo-700 font-bold">{totalQuestionsCount}</strong></span>
          </div>
        </div>
      )}

      {isLoading && (
        <div className="mt-6 p-4 text-center text-sm text-slate-500 animate-pulse">
          ಪ್ರಶ್ನೆ ಬ್ಯಾಂಕ್ ಡೇಟಾ ಲೋಡ್ ಆಗುತ್ತಿದೆ... (Loading Question Bank...)
        </div>
      )}
    </div>
  );
};
