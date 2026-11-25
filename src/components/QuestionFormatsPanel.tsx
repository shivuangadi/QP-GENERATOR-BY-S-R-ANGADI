/**
 * Question Formats Panel: 3. ಪ್ರಶ್ನೆ ಪ್ರಕಾರಗಳು (Question Formats)
 * Matches the exact 12-item grid layout and styling from the user's reference screenshot.
 * Author: M I Nilaji / S R Angadi
 */

import React from 'react';
import {
  STANDARD_QUESTION_FORMATS,
  QuestionFormatDef,
  getAvailableFormatsForSubject,
} from '../types/questionBank.ts';
import { Check } from 'lucide-react';

interface QuestionFormatsPanelProps {
  selectedFormatIds: string[];
  onChangeSelectedFormats: (formatIds: string[]) => void;
  formatQuestionCounts?: Record<string, number>;
  onOpenSectionConfig?: () => void;
  subject?: string;
  subjectCode?: string;
}

export const QuestionFormatsPanel: React.FC<QuestionFormatsPanelProps> = ({
  selectedFormatIds,
  onChangeSelectedFormats,
  formatQuestionCounts = {},
  onOpenSectionConfig,
  subject,
  subjectCode,
}) => {
  const availableFormats = React.useMemo(() => {
    return getAvailableFormatsForSubject(subjectCode || subject);
  }, [subject, subjectCode]);

  const isAllSelected = selectedFormatIds.length === availableFormats.length;

  const handleSelectAll = () => {
    onChangeSelectedFormats(availableFormats.map(f => f.id));
  };

  const handleClear = () => {
    onChangeSelectedFormats([]);
  };

  const handleToggle = (id: string) => {
    if (selectedFormatIds.includes(id)) {
      onChangeSelectedFormats(selectedFormatIds.filter(fId => fId !== id));
    } else {
      onChangeSelectedFormats([...selectedFormatIds, id]);
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200/90 p-5 sm:p-6 shadow-xs font-kannada">
      
      {/* Header with Title & Action Buttons */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-3 mb-3 border-b border-slate-100">
        <h2 className="text-base font-bold text-slate-900 tracking-tight">
          3. ಪ್ರಶ್ನೆ ಪ್ರಕಾರಗಳು (Question Formats)
        </h2>

        <div className="flex items-center gap-2">
          {onOpenSectionConfig && (
            <button
              type="button"
              onClick={onOpenSectionConfig}
              className="px-3 py-1 text-xs font-bold rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100 transition-colors flex items-center gap-1 cursor-pointer"
            >
              <span>⚙️</span>
              <span>ವಿಭಾಗ ಹೊಂದಾಣಿಕೆ</span>
            </button>
          )}

          <button
            type="button"
            onClick={handleSelectAll}
            className={`px-3.5 py-1 text-xs font-bold rounded-full transition-colors ${
              isAllSelected
                ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                : 'border border-emerald-500 text-emerald-700 bg-emerald-50/60 hover:bg-emerald-100'
            }`}
          >
            Select All
          </button>

          <button
            type="button"
            onClick={handleClear}
            className="px-3.5 py-1 text-xs font-bold rounded-full border border-slate-300 text-slate-600 bg-slate-50 hover:bg-slate-100 transition-colors"
          >
            Clear
          </button>
        </div>
      </div>

      {/* 3-column Grid of Question Formats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
        {availableFormats.map(fmt => {
          const isSelected = selectedFormatIds.includes(fmt.id);
          const count = formatQuestionCounts[fmt.id] ?? 0;

          return (
            <div
              key={fmt.id}
              onClick={() => handleToggle(fmt.id)}
              className={`p-3 rounded-xl border transition-all cursor-pointer select-none flex items-center gap-3 ${
                isSelected
                  ? 'border-indigo-500/80 bg-white shadow-2xs ring-1 ring-indigo-500/30'
                  : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50/60 text-slate-700'
              }`}
            >
              {/* Custom Blue Checkbox */}
              <div
                className={`w-5 h-5 rounded-md flex items-center justify-center shrink-0 transition-colors ${
                  isSelected
                    ? 'bg-blue-600 text-white'
                    : 'border-2 border-slate-300 bg-white'
                }`}
              >
                {isSelected && <Check className="w-3.5 h-3.5 stroke-[3]" />}
              </div>

              {/* Format Title */}
              <div className="flex-1 min-w-0">
                <span className="text-xs sm:text-xs font-bold text-slate-900 leading-snug truncate block">
                  {fmt.name}
                </span>
                {count > 0 && (
                  <span className="text-2xs text-slate-400 font-medium">
                    {count} ಪ್ರಶ್ನೆಗಳು ಲಭ್ಯ
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

    </div>
  );
};
