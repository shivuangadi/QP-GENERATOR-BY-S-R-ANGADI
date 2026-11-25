/**
 * Step 5, 6, 7 & Section Builder Component
 * Build and customize exam blueprint sections with live marks calculation and question availability feedback.
 * Author: S R Angadi
 */

import React from 'react';
import { SectionBlueprint, Chapter, QuestionBank } from '../types/questionBank.ts';
import {
  extractAvailableQuestionTypes,
  extractAvailableLearningOutcomes,
  extractAvailableDifficulties,
} from '../services/dataLoader.ts';
import { filterQuestionsForBlueprint } from '../services/paperGenerator.ts';
import {
  Plus,
  Trash2,
  ArrowUp,
  ArrowDown,
  Layers,
  Sparkles,
  AlertCircle,
  CheckCircle,
  HelpCircle,
} from 'lucide-react';

interface SectionBuilderProps {
  bank: QuestionBank;
  globalSelectedChapterIds: string[];
  blueprints: SectionBlueprint[];
  onChangeBlueprints: (blueprints: SectionBlueprint[]) => void;
}

const ROMAN_NUMERALS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];

export const SectionBuilder: React.FC<SectionBuilderProps> = ({
  bank,
  globalSelectedChapterIds,
  blueprints,
  onChangeBlueprints,
}) => {
  // Available question types in the selected chapters
  const availableQuestionTypes = React.useMemo(() => {
    return extractAvailableQuestionTypes(bank.chapters, globalSelectedChapterIds);
  }, [bank, globalSelectedChapterIds]);

  // Available learning outcomes
  const availableLOs = React.useMemo(() => {
    return extractAvailableLearningOutcomes(bank.chapters, globalSelectedChapterIds);
  }, [bank, globalSelectedChapterIds]);

  // Available difficulties
  const availableDifficulties = React.useMemo(() => {
    return extractAvailableDifficulties(bank.chapters, globalSelectedChapterIds);
  }, [bank, globalSelectedChapterIds]);

  // Grand totals
  const grandTotalMarks = blueprints.reduce(
    (sum, bp) => sum + bp.questionCount * bp.marksPerQuestion,
    0
  );
  const grandTotalQuestions = blueprints.reduce((sum, bp) => sum + bp.questionCount, 0);

  // Add new section
  const handleAddSection = () => {
    const nextIdx = blueprints.length;
    const defaultRoman = ROMAN_NUMERALS[nextIdx] || `${nextIdx + 1}`;
    const defaultType = availableQuestionTypes[0] || 'ಎಲ್ಲಾ ವಿಧಗಳು';
    
    const newSection: SectionBlueprint = {
      id: `sec_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
      sectionRoman: defaultRoman,
      title: `ವಿಭಾಗ - ${defaultRoman} : ${defaultType}`,
      instructionText: `ಕೆಳಗಿನ ಪ್ರಶ್ನೆಗಳಿಗೆ ಉತ್ತರಿಸಿ:`,
      questionType: defaultType,
      formatCategoryId: 'all',
      selectedChapterIds: [], // inherit all selected chapters
      selectedLearningOutcomes: ['all'],
      difficulty: 'all',
      marksPerQuestion: 1,
      questionCount: 4,
    };
    onChangeBlueprints([...blueprints, newSection]);
  };

  // Delete section
  const handleDeleteSection = (id: string) => {
    if (blueprints.length <= 1) {
      alert('ಕನಿಷ್ಠ ಒಂದು ವಿಭಾಗವಿರಬೇಕು (At least one section is required).');
      return;
    }
    onChangeBlueprints(blueprints.filter(bp => bp.id !== id));
  };

  // Move section up
  const handleMoveUp = (index: number) => {
    if (index === 0) return;
    const updated = [...blueprints];
    const temp = updated[index];
    updated[index] = updated[index - 1];
    updated[index - 1] = temp;
    onChangeBlueprints(updated);
  };

  // Move section down
  const handleMoveDown = (index: number) => {
    if (index === blueprints.length - 1) return;
    const updated = [...blueprints];
    const temp = updated[index];
    updated[index] = updated[index + 1];
    updated[index + 1] = temp;
    onChangeBlueprints(updated);
  };

  // Update specific section field
  const handleUpdateSection = (id: string, updates: Partial<SectionBlueprint>) => {
    onChangeBlueprints(
      blueprints.map(bp => {
        if (bp.id !== id) return bp;
        const updated = { ...bp, ...updates };

        // If question type changed and title was default-formatted, update title
        if (updates.questionType && updates.questionType !== bp.questionType) {
          if (updated.title.startsWith(`ವಿಭಾಗ - ${updated.sectionRoman}`)) {
            updated.title = `ವಿಭಾಗ - ${updated.sectionRoman} : ${updates.questionType}`;
          }
        }
        return updated;
      })
    );
  };

  // Preset Blueprint templates
  const applyPreset = (presetType: 'fa' | 'midterm' | 'annual') => {
    const types: string[] = availableQuestionTypes;
    const mcqType = types.find((t: string) => t.includes('ಆಯ್ಕೆ')) || types[0] || 'ಬಹು ಆಯ್ಕೆಯ ಪ್ರಶ್ನೆಗಳು';
    const oneWordType = types.find((t: string) => t.includes('ಒಂದು ವಾಕ್ಯ') || t.includes('ಖಾಲಿ')) || types[1] || 'ಒಂದು ವಾಕ್ಯದಲ್ಲಿ ಉತ್ತರಿಸಿ';
    const shortType = types.find((t: string) => t.includes('ಎರಡು') || t.includes('ಮೂರು')) || types[2] || 'ಎರಡು ಅಥವಾ ಮೂರು ವಾಕ್ಯಗಳಲ್ಲಿ ಉತ್ತರಿಸಿ';
    const longType = types.find((t: string) => t.includes('ವಿವರಣಾತ್ಮಕ')) || types[3] || 'ವಿವರಣಾತ್ಮಕ ಪ್ರಶ್ನೆಗಳು';

    if (presetType === 'fa') {
      // 20 Marks FA format
      onChangeBlueprints([
        {
          id: `sec_fa_1_${Date.now()}`,
          sectionRoman: 'I',
          title: `ವಿಭಾಗ - I : ${mcqType}`,
          instructionText: `ಸರಿಯಾದ ಉತ್ತರವನ್ನು ಆರಿಸಿ ಬರೆಯಿರಿ:`,
          questionType: mcqType,
          formatCategoryId: 'mcq',
          selectedChapterIds: [],
          selectedLearningOutcomes: ['all'],
          difficulty: 'all',
          marksPerQuestion: 1,
          questionCount: 4,
        },
        {
          id: `sec_fa_2_${Date.now()}`,
          sectionRoman: 'II',
          title: `ವಿಭಾಗ - II : ${oneWordType}`,
          instructionText: `ಒಂದು ವಾಕ್ಯದಲ್ಲಿ ಉತ್ತರಿಸಿ:`,
          questionType: oneWordType,
          formatCategoryId: 'fill_blank',
          selectedChapterIds: [],
          selectedLearningOutcomes: ['all'],
          difficulty: 'all',
          marksPerQuestion: 1,
          questionCount: 4,
        },
        {
          id: `sec_fa_3_${Date.now()}`,
          sectionRoman: 'III',
          title: `ವಿಭಾಗ - III : ${shortType}`,
          instructionText: `ಎರಡು-ಮೂರು ವಾಕ್ಯಗಳಲ್ಲಿ ಉತ್ತರಿಸಿ:`,
          questionType: shortType,
          formatCategoryId: 'short_2m',
          selectedChapterIds: [],
          selectedLearningOutcomes: ['all'],
          difficulty: 'all',
          marksPerQuestion: 2,
          questionCount: 3,
        },
        {
          id: `sec_fa_4_${Date.now()}`,
          sectionRoman: 'IV',
          title: `ವಿಭಾಗ - IV : ${longType}`,
          instructionText: `ವಿವರವಾಗಿ ಉತ್ತರಿಸಿ:`,
          questionType: longType,
          formatCategoryId: 'short_3m',
          selectedChapterIds: [],
          selectedLearningOutcomes: ['all'],
          difficulty: 'all',
          marksPerQuestion: 3,
          questionCount: 2,
        },
      ]);
    } else if (presetType === 'midterm') {
      // 40 Marks Mid-term format
      onChangeBlueprints([
        {
          id: `sec_mid_1_${Date.now()}`,
          sectionRoman: 'I',
          title: `ವಿಭಾಗ - I : ${mcqType}`,
          instructionText: `ಸರಿಯಾದ ಉತ್ತರವನ್ನು ಆರಿಸಿ ಬರೆಯಿರಿ:`,
          questionType: mcqType,
          formatCategoryId: 'mcq',
          selectedChapterIds: [],
          selectedLearningOutcomes: ['all'],
          difficulty: 'all',
          marksPerQuestion: 1,
          questionCount: 8,
        },
        {
          id: `sec_mid_2_${Date.now()}`,
          sectionRoman: 'II',
          title: `ವಿಭಾಗ - II : ${oneWordType}`,
          instructionText: `ಒಂದು ವಾಕ್ಯದಲ್ಲಿ ಉತ್ತರಿಸಿ:`,
          questionType: oneWordType,
          formatCategoryId: 'fill_blank',
          selectedChapterIds: [],
          selectedLearningOutcomes: ['all'],
          difficulty: 'all',
          marksPerQuestion: 1,
          questionCount: 8,
        },
        {
          id: `sec_mid_3_${Date.now()}`,
          sectionRoman: 'III',
          title: `ವಿಭಾಗ - III : ${shortType}`,
          instructionText: `ಎರಡು-ಮೂರು ವಾಕ್ಯಗಳಲ್ಲಿ ಉತ್ತರಿಸಿ:`,
          questionType: shortType,
          formatCategoryId: 'short_2m',
          selectedChapterIds: [],
          selectedLearningOutcomes: ['all'],
          difficulty: 'all',
          marksPerQuestion: 2,
          questionCount: 6,
        },
        {
          id: `sec_mid_4_${Date.now()}`,
          sectionRoman: 'IV',
          title: `ವಿಭಾಗ - IV : ${longType}`,
          instructionText: `ವಿವರವಾಗಿ ಉತ್ತರಿಸಿ:`,
          questionType: longType,
          formatCategoryId: 'short_3m',
          selectedChapterIds: [],
          selectedLearningOutcomes: ['all'],
          difficulty: 'all',
          marksPerQuestion: 3,
          questionCount: 4,
        },
      ]);
    } else {
      // Annual Exam format (e.g. 50 Marks)
      onChangeBlueprints([
        {
          id: `sec_ann_1_${Date.now()}`,
          sectionRoman: 'I',
          title: `ವಿಭಾಗ - I : ${mcqType}`,
          instructionText: `ಸರಿಯಾದ ಉತ್ತರವನ್ನು ಆರಿಸಿ ಬರೆಯಿರಿ:`,
          questionType: mcqType,
          formatCategoryId: 'mcq',
          selectedChapterIds: [],
          selectedLearningOutcomes: ['all'],
          difficulty: 'all',
          marksPerQuestion: 1,
          questionCount: 10,
        },
        {
          id: `sec_ann_2_${Date.now()}`,
          sectionRoman: 'II',
          title: `ವಿಭಾಗ - II : ${oneWordType}`,
          instructionText: `ಒಂದು ವಾಕ್ಯದಲ್ಲಿ ಉತ್ತರಿಸಿ:`,
          questionType: oneWordType,
          formatCategoryId: 'fill_blank',
          selectedChapterIds: [],
          selectedLearningOutcomes: ['all'],
          difficulty: 'all',
          marksPerQuestion: 1,
          questionCount: 10,
        },
        {
          id: `sec_ann_3_${Date.now()}`,
          sectionRoman: 'III',
          title: `ವಿಭಾಗ - III : ${shortType}`,
          instructionText: `ಎರಡು-ಮೂರು ವಾಕ್ಯಗಳಲ್ಲಿ ಉತ್ತರಿಸಿ:`,
          questionType: shortType,
          formatCategoryId: 'short_2m',
          selectedChapterIds: [],
          selectedLearningOutcomes: ['all'],
          difficulty: 'all',
          marksPerQuestion: 2,
          questionCount: 8,
        },
        {
          id: `sec_ann_4_${Date.now()}`,
          sectionRoman: 'IV',
          title: `ವಿಭಾಗ - IV : ${longType}`,
          instructionText: `ವಿವರವಾಗಿ ಉತ್ತರಿಸಿ:`,
          questionType: longType,
          formatCategoryId: 'short_3m',
          selectedChapterIds: [],
          selectedLearningOutcomes: ['all'],
          difficulty: 'all',
          marksPerQuestion: 3,
          questionCount: 4,
        },
      ]);
    }
  };

  return (
    <div className="space-y-6">
      {/* Blueprint Header & Presets Bar */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 sm:p-6 shadow-xs">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-slate-100 pb-5">
          <div>
            <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
              <Layers className="w-5 h-5 text-indigo-600" />
              <span>ವಿಭಾಗ ರಚನಾ ಸಾಧನ (Question Paper Section Builder)</span>
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              ಪ್ರತಿ ವಿಭಾಗಕ್ಕೆ ಪ್ರಶ್ನೆ ವಿಧ, ಅಂಕ, ಪ್ರಶ್ನೆಗಳ ಸಂಖ್ಯೆ ಹಾಗೂ ಮಾನದಂಡಗಳನ್ನು ನಿಗದಿಪಡಿಸಿ.
            </p>
          </div>

          {/* Quick Presets */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-slate-500 font-medium">ಮಾದರಿ ವಿನ್ಯಾಸಗಳು:</span>
            <button
              type="button"
              onClick={() => applyPreset('fa')}
              className="px-2.5 py-1 text-xs font-semibold rounded-md bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border border-indigo-200 transition-colors"
            >
              FA ಕಿರುಪರೀಕ್ಷೆ (೨೦ ಅಂಕ)
            </button>
            <button
              type="button"
              onClick={() => applyPreset('midterm')}
              className="px-2.5 py-1 text-xs font-semibold rounded-md bg-purple-50 text-purple-700 hover:bg-purple-100 border border-purple-200 transition-colors"
            >
              ಮಧ್ಯವಾರ್ಷಿಕ (೪೦ ಅಂಕ)
            </button>
            <button
              type="button"
              onClick={() => applyPreset('annual')}
              className="px-2.5 py-1 text-xs font-semibold rounded-md bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200 transition-colors"
            >
              ವಾರ್ಷಿಕ ಪರೀಕ್ಷೆ (೫೦ ಅಂಕ)
            </button>
          </div>
        </div>

        {/* Live Grand Total Counter Ribbon */}
        <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-50 p-3.5 rounded-lg border border-slate-100 text-center">
          <div>
            <div className="text-xs text-slate-500">ಒಟ್ಟು ವಿಭಾಗಗಳು</div>
            <div className="text-lg font-bold text-slate-900">{blueprints.length}</div>
          </div>
          <div>
            <div className="text-xs text-slate-500">ಒಟ್ಟು ಪ್ರಶ್ನೆಗಳು</div>
            <div className="text-lg font-bold text-indigo-600">{grandTotalQuestions}</div>
          </div>
          <div>
            <div className="text-xs text-slate-500">ಗರಿಷ್ಠ ಅಂಕಗಳು (Max Marks)</div>
            <div className="text-lg font-bold text-emerald-600">{grandTotalMarks}</div>
          </div>
          <div className="flex items-center justify-center">
            <button
              type="button"
              onClick={handleAddSection}
              className="w-full h-full py-1.5 px-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-md text-xs font-semibold flex items-center justify-center gap-1.5 shadow-xs transition-colors"
            >
              <Plus className="w-4 h-4" />
              <span>ವಿಭಾಗ ಸೇರಿಸಿ</span>
            </button>
          </div>
        </div>
      </div>

      {/* Sections List */}
      <div className="space-y-4">
        {blueprints.map((bp, index) => {
          // Check matching questions in bank for this blueprint
          const matchingQuestions = filterQuestionsForBlueprint(bank, bp);
          const availableCount = matchingQuestions.length;
          const isSufficient = availableCount >= bp.questionCount;
          const sectionTotal = bp.questionCount * bp.marksPerQuestion;

          return (
            <div
              key={bp.id}
              className={`bg-white rounded-xl border transition-all p-5 shadow-xs ${
                isSufficient ? 'border-slate-200' : 'border-amber-300 ring-1 ring-amber-300'
              }`}
            >
              {/* Section Header Controls */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
                <div className="flex items-center gap-2">
                  <span className="w-7 h-7 rounded-md bg-slate-100 text-slate-800 flex items-center justify-center font-bold text-sm">
                    {bp.sectionRoman}
                  </span>
                  <input
                    type="text"
                    value={bp.title}
                    onChange={e => handleUpdateSection(bp.id, { title: e.target.value })}
                    className="font-bold text-slate-900 text-base bg-transparent border-b border-transparent hover:border-slate-300 focus:border-indigo-600 focus:outline-hidden px-1 py-0.5 max-w-md"
                    placeholder="ವಿಭಾಗದ ಶೀರ್ಷಿಕೆ"
                  />
                </div>

                <div className="flex items-center gap-2">
                  {/* Availability badge */}
                  <span
                    className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ${
                      isSufficient
                        ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                        : 'bg-amber-50 text-amber-800 border border-amber-300'
                    }`}
                  >
                    {isSufficient ? (
                      <CheckCircle className="w-3.5 h-3.5 text-emerald-600" />
                    ) : (
                      <AlertCircle className="w-3.5 h-3.5 text-amber-600" />
                    )}
                    <span>
                      ಬ್ಯಾಂಕ್‌ನಲ್ಲಿ {availableCount} ಲಭ್ಯ (ಅಗತ್ಯ: {bp.questionCount})
                    </span>
                  </span>

                  {/* Reorder Buttons */}
                  <div className="flex items-center border border-slate-200 rounded-md">
                    <button
                      type="button"
                      onClick={() => handleMoveUp(index)}
                      disabled={index === 0}
                      title="ಮೇಲಕ್ಕೆ ಚಲಿಸಿ"
                      className="p-1.5 text-slate-500 hover:text-slate-800 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-50"
                    >
                      <ArrowUp className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleMoveDown(index)}
                      disabled={index === blueprints.length - 1}
                      title="ಕೆಳಕ್ಕೆ ಚಲಿಸಿ"
                      className="p-1.5 text-slate-500 hover:text-slate-800 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-50 border-l border-slate-200"
                    >
                      <ArrowDown className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Delete Button */}
                  <button
                    type="button"
                    onClick={() => handleDeleteSection(bp.id)}
                    title="ಈ ವಿಭಾಗವನ್ನು ಅಳಿಸಿ"
                    className="p-1.5 text-rose-500 hover:text-rose-700 hover:bg-rose-50 rounded-md transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Instructions text */}
              <div className="mt-3">
                <input
                  type="text"
                  value={bp.instructionText}
                  onChange={e => handleUpdateSection(bp.id, { instructionText: e.target.value })}
                  placeholder="ವಿಭಾಗದ ಸೂಚನೆಗಳು (ಉದಾ: ಕೆಳಗಿನ ಪ್ರಶ್ನೆಗಳಿಗೆ ಉತ್ತರಿಸಿ:)"
                  className="w-full text-xs text-slate-600 italic bg-slate-50/50 border border-slate-200 rounded-md px-3 py-1.5 focus:border-indigo-500 focus:outline-hidden"
                />
              </div>

              {/* Section Settings Grid */}
              <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                
                {/* 1. Question Type Selector */}
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    ಪ್ರಶ್ನೆ ವಿಧ (Question Type)
                  </label>
                  <select
                    value={bp.questionType}
                    onChange={e => handleUpdateSection(bp.id, { questionType: e.target.value })}
                    className="w-full text-xs font-medium text-slate-800 bg-white border border-slate-200 rounded-lg px-2.5 py-2 focus:ring-1 focus:ring-indigo-600 focus:border-indigo-600"
                  >
                    <option value="ಎಲ್ಲಾ ವಿಧಗಳು">ಎಲ್ಲಾ ಲಭ್ಯವಿರುವ ವಿಧಗಳು (All Types)</option>
                    {availableQuestionTypes.map((type: string) => (
                      <option key={type} value={type}>
                        {type}
                      </option>
                    ))}
                  </select>
                </div>

                {/* 2. Marks Per Question */}
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    ಪ್ರತಿ ಪ್ರಶ್ನೆಗೆ ಅಂಕ (Marks Each)
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={10}
                    value={bp.marksPerQuestion}
                    onChange={e =>
                      handleUpdateSection(bp.id, {
                        marksPerQuestion: Math.max(1, parseInt(e.target.value, 10) || 1),
                      })
                    }
                    className="w-full text-xs font-semibold text-slate-800 bg-white border border-slate-200 rounded-lg px-2.5 py-2 focus:ring-1 focus:ring-indigo-600 focus:border-indigo-600"
                  />
                </div>

                {/* 3. Question Count */}
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    ಪ್ರಶ್ನೆಗಳ ಸಂಖ್ಯೆ (Count)
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={50}
                    value={bp.questionCount}
                    onChange={e =>
                      handleUpdateSection(bp.id, {
                        questionCount: Math.max(1, parseInt(e.target.value, 10) || 1),
                      })
                    }
                    className="w-full text-xs font-semibold text-slate-800 bg-white border border-slate-200 rounded-lg px-2.5 py-2 focus:ring-1 focus:ring-indigo-600 focus:border-indigo-600"
                  />
                </div>

                {/* 4. Section Total Marks */}
                <div className="bg-slate-50 rounded-lg border border-slate-200 p-2 flex flex-col justify-center items-center">
                  <div className="text-2xs uppercase tracking-wider text-slate-500 font-semibold">
                    ವಿಭಾಗದ ಒಟ್ಟು ಅಂಕ
                  </div>
                  <div className="text-base font-extrabold text-slate-900">
                    {bp.questionCount} × {bp.marksPerQuestion} = <span className="text-indigo-600">{sectionTotal}</span> ಅಂಕಗಳು
                  </div>
                </div>

              </div>

              {/* Advanced criteria: Learning outcome & Difficulty */}
              <div className="mt-3 pt-3 border-t border-slate-100 grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                {/* Learning Outcome Filter */}
                <div className="flex items-center gap-2">
                  <span className="text-slate-500 shrink-0 font-medium">ಕಲಿಕಾಂಶ (Outcome):</span>
                  <select
                    value={bp.selectedLearningOutcomes[0] || 'all'}
                    onChange={e =>
                      handleUpdateSection(bp.id, {
                        selectedLearningOutcomes: [e.target.value],
                      })
                    }
                    className="text-xs bg-white border border-slate-200 rounded-md px-2 py-1 flex-1 text-slate-700"
                  >
                    <option value="all">ಎಲ್ಲಾ ಕಲಿಕಾಂಶಗಳು (All Outcomes)</option>
                    {availableLOs.map((lo: string) => (
                      <option key={lo} value={lo}>
                        {lo}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Difficulty Filter */}
                <div className="flex items-center gap-2">
                  <span className="text-slate-500 shrink-0 font-medium">ಕ್ಲಿಷ್ಟತೆ (Difficulty):</span>
                  <select
                    value={bp.difficulty}
                    onChange={e => handleUpdateSection(bp.id, { difficulty: e.target.value })}
                    className="text-xs bg-white border border-slate-200 rounded-md px-2 py-1 flex-1 text-slate-700"
                  >
                    <option value="all">ಎಲ್ಲಾ ಹಂತಗಳು (All Difficulties)</option>
                    {availableDifficulties.map((diff: string) => (
                      <option key={diff} value={diff}>
                        {diff === 'Easy' ? 'ಸುಲಭ (Easy)' : diff === 'Medium' ? 'ಮಧ್ಯಮ (Medium)' : diff === 'Difficult' ? 'ಕಠಿಣ (Difficult)' : diff}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Insufficient Warning */}
              {!isSufficient && (
                <div className="mt-3 p-2.5 bg-amber-50 rounded-lg border border-amber-200 text-xs text-amber-800 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  <div>
                    <strong>ಗಮನಿಸಿ:</strong> ಆಯ್ಕೆಮಾಡಲಾದ ಮಾನದಂಡಗಳಿಗೆ ಪ್ರಶ್ನೆ ಬ್ಯಾಂಕ್‌ನಲ್ಲಿ {availableCount} ಪ್ರಶ್ನೆಗಳು ಮಾತ್ರ ಲಭ್ಯವಿವೆ. ದಯವಿಟ್ಟು ಪ್ರಶ್ನೆಗಳ ಸಂಖ್ಯೆಯನ್ನು {availableCount} ಅಥವಾ ಅದಕ್ಕಿಂತ ಕಡಿಮೆಗೆ ಬದಲಾಯಿಸಿ, ಅಥವಾ ಕಲಿಕಾಂಶ/ಕ್ಲಿಷ್ಟತೆಯ ಆಯ್ಕೆಯನ್ನು ಸಡಿಲಗೊಳಿಸಿ.
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
