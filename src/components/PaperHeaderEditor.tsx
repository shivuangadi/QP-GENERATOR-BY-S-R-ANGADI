/**
 * Question Paper Header Editor Component
 * Editable exam headers, instructions, date/time, and marks.
 * Author: S R Angadi
 */

import React from 'react';
import { PaperHeader } from '../types/questionBank.ts';
import { School, Calendar, Clock, Award, FileText, ChevronDown, ChevronUp } from 'lucide-react';

interface PaperHeaderEditorProps {
  header: PaperHeader;
  onChangeHeader: (header: PaperHeader) => void;
}

export const PaperHeaderEditor: React.FC<PaperHeaderEditorProps> = ({
  header,
  onChangeHeader,
}) => {
  const [isExpanded, setIsExpanded] = React.useState(false);

  const handleUpdate = (field: keyof PaperHeader, value: unknown) => {
    onChangeHeader({
      ...header,
      [field]: value,
    });
  };

  const handleInstructionChange = (index: number, val: string) => {
    const updated = [...header.generalInstructions];
    updated[index] = val;
    handleUpdate('generalInstructions', updated);
  };

  const handleAddInstruction = () => {
    handleUpdate('generalInstructions', [
      ...header.generalInstructions,
      'ಹೊಸ ಸೂಚನೆ...',
    ]);
  };

  const handleRemoveInstruction = (index: number) => {
    const updated = header.generalInstructions.filter((_, i) => i !== index);
    handleUpdate('generalInstructions', updated);
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs mb-6 no-print">
      <div
        className="flex items-center justify-between cursor-pointer select-none"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-700 flex items-center justify-center">
            <School className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-900">
              ಪರೀಕ್ಷಾ ಶೀರ್ಷಿಕೆ ಮತ್ತು ವಿವರಗಳು (Paper Header Details)
            </h3>
            <p className="text-xs text-slate-500">
              {header.schoolName} · {header.examName} · {header.academicYear}
            </p>
          </div>
        </div>

        <button
          type="button"
          className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 flex items-center gap-1"
        >
          <span>{isExpanded ? 'ಮರೆಮಾಡಿ (Hide)' : 'ಸಂಪಾದಿಸಿ (Edit Header)'}</span>
          {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
      </div>

      {isExpanded && (
        <div className="mt-5 pt-4 border-t border-slate-100 space-y-4 animate-in fade-in duration-150">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            
            {/* School Name */}
            <div className="lg:col-span-2">
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                ಶಾಲೆಯ ಹೆಸರು (School Name)
              </label>
              <input
                type="text"
                value={header.schoolName}
                onChange={e => handleUpdate('schoolName', e.target.value)}
                className="w-full text-xs font-medium text-slate-900 border border-slate-200 rounded-lg px-3 py-2 focus:ring-1 focus:ring-indigo-600 focus:border-indigo-600"
                placeholder="ಉದಾ: ಕರ್ನಾಟಕ ಪಬ್ಲಿಕ್ ಶಾಲೆ (ಕೆ.ಪಿ.ಎಸ್)"
              />
            </div>

            {/* Exam Name */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                ಪರೀಕ್ಷೆಯ ಹೆಸರು (Examination Name)
              </label>
              <input
                type="text"
                value={header.examName}
                onChange={e => handleUpdate('examName', e.target.value)}
                className="w-full text-xs font-medium text-slate-900 border border-slate-200 rounded-lg px-3 py-2 focus:ring-1 focus:ring-indigo-600 focus:border-indigo-600"
                placeholder="ಉದಾ: ಸಂಕಲನಾತ್ಮಕ ಮೌಲ್ಯಮಾಪನ - ೧ (SA-1)"
              />
            </div>

            {/* Academic Year */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                ಶೈಕ್ಷಣಿಕ ವರ್ಷ (Academic Year)
              </label>
              <input
                type="text"
                value={header.academicYear}
                onChange={e => handleUpdate('academicYear', e.target.value)}
                className="w-full text-xs font-medium text-slate-900 border border-slate-200 rounded-lg px-3 py-2 focus:ring-1 focus:ring-indigo-600 focus:border-indigo-600"
              />
            </div>

            {/* Class */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                ತರಗತಿ (Class)
              </label>
              <input
                type="text"
                value={header.grade}
                onChange={e => handleUpdate('grade', e.target.value)}
                className="w-full text-xs font-medium text-slate-900 border border-slate-200 rounded-lg px-3 py-2 focus:ring-1 focus:ring-indigo-600 focus:border-indigo-600"
              />
            </div>

            {/* Subject */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                ವಿಷಯ (Subject)
              </label>
              <input
                type="text"
                value={header.subject}
                onChange={e => handleUpdate('subject', e.target.value)}
                className="w-full text-xs font-medium text-slate-900 border border-slate-200 rounded-lg px-3 py-2 focus:ring-1 focus:ring-indigo-600 focus:border-indigo-600"
              />
            </div>

            {/* Date */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1 flex items-center gap-1">
                <Calendar className="w-3.5 h-3.5 text-slate-400" />
                <span>ದಿನಾಂಕ (Date)</span>
              </label>
              <input
                type="text"
                value={header.date}
                onChange={e => handleUpdate('date', e.target.value)}
                placeholder="ಉದಾ: 15-03-2027"
                className="w-full text-xs font-medium text-slate-900 border border-slate-200 rounded-lg px-3 py-2 focus:ring-1 focus:ring-indigo-600 focus:border-indigo-600"
              />
            </div>

            {/* Time */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1 flex items-center gap-1">
                <Clock className="w-3.5 h-3.5 text-slate-400" />
                <span>ಸಮಯಾವಧಿ (Time Duration)</span>
              </label>
              <input
                type="text"
                value={header.time}
                onChange={e => handleUpdate('time', e.target.value)}
                placeholder="ಉದಾ: ೨ ಗಂಟೆ ೩೦ ನಿಮಿಷಗಳು"
                className="w-full text-xs font-medium text-slate-900 border border-slate-200 rounded-lg px-3 py-2 focus:ring-1 focus:ring-indigo-600 focus:border-indigo-600"
              />
            </div>

            {/* Max Marks */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1 flex items-center gap-1">
                <Award className="w-3.5 h-3.5 text-slate-400" />
                <span>ಗರಿಷ್ಠ ಅಂಕಗಳು (Max Marks)</span>
              </label>
              <input
                type="number"
                value={header.maxMarks}
                onChange={e => handleUpdate('maxMarks', parseInt(e.target.value, 10) || 0)}
                className="w-full text-xs font-bold text-emerald-700 border border-slate-200 rounded-lg px-3 py-2 focus:ring-1 focus:ring-indigo-600 focus:border-indigo-600"
              />
            </div>

          </div>

          {/* General Instructions Editor */}
          <div className="pt-3 border-t border-slate-100">
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-semibold text-slate-700">
                ಸಾಮಾನ್ಯ ಸೂಚನೆಗಳು (General Instructions)
              </label>
              <button
                type="button"
                onClick={handleAddInstruction}
                className="text-2xs font-semibold text-indigo-600 hover:text-indigo-800"
              >
                + ಸೂಚನೆ ಸೇರಿಸಿ
              </button>
            </div>
            <div className="space-y-1.5">
              {header.generalInstructions.map((instruction, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <span className="text-xs text-slate-400 font-bold w-4">{idx + 1}.</span>
                  <input
                    type="text"
                    value={instruction}
                    onChange={e => handleInstructionChange(idx, e.target.value)}
                    className="flex-1 text-xs text-slate-800 border border-slate-200 rounded-md px-2.5 py-1.5 focus:border-indigo-500 focus:outline-hidden"
                  />
                  <button
                    type="button"
                    onClick={() => handleRemoveInstruction(idx)}
                    className="text-slate-400 hover:text-rose-600 text-xs px-1"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          </div>

        </div>
      )}
    </div>
  );
};
