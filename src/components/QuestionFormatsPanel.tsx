/**
 * Question Formats Panel: 3. ಪ್ರಶ್ನೆ ಪ್ರಕಾರಗಳು (Question Formats)
 * Colorful Warm Amber-Orange academic card styling for clear visual hierarchy.
 * Author: M I Nilaji / S R Angadi
 */

import React from 'react';
import { getAvailableFormatsForSubject } from '../types/questionBank.ts';
import { Check, Sliders, ListChecks } from 'lucide-react';

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
    <div className="bg-white rounded-2xl border border-amber-200 shadow-sm overflow-hidden font-kannada">
      {/* Colorful Warm Amber-Orange Header Band */}
      <div className="bg-gradient-to-r from-amber-600 via-orange-600 to-amber-700 px-5 py-3.5 flex flex-wrap items-center justify-between gap-2 text-white">
        <div className="flex items-center gap-2.5">
          <ListChecks className="w-4 h-4 text-amber-100 shrink-0" />
          <h2 className="text-sm sm:text-base font-extrabold tracking-tight">
            3. ಪ್ರಶ್ನೆ ಪ್ರಕಾರಗಳು (Question Formats)
          </h2>
          <span className="text-xs font-bold text-amber-100 tabular-nums">
            ({selectedFormatIds.length}/{availableFormats.length})
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {onOpenSectionConfig && (
            <button
              type="button"
              onClick={onOpenSectionConfig}
              className="px-3 py-1.5 text-xs font-bold rounded-lg bg-white text-amber-900 hover:bg-amber-50 transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap shadow-2xs"
            >
              <Sliders className="w-3.5 h-3.5" />
              <span>ವಿಭಾಗ ಹೊಂದಾಣಿಕೆ</span>
            </button>
          )}

          <button
            type="button"
            onClick={handleSelectAll}
            className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-colors cursor-pointer whitespace-nowrap ${
              isAllSelected
                ? 'bg-emerald-950 text-amber-300'
                : 'bg-white/15 hover:bg-white/25 text-white border border-white/25'
            }`}
          >
            ಎಲ್ಲವೂ ಆಯ್ಕೆ
          </button>

          <button
            type="button"
            onClick={handleClear}
            className="px-3 py-1.5 text-xs font-bold rounded-lg bg-white/10 hover:bg-white/20 text-white border border-white/20 transition-colors cursor-pointer whitespace-nowrap"
          >
            ತೆರವುಗೊಳಿಸಿ
          </button>
        </div>
      </div>

      {/* 3-column Grid of Question Formats */}
      <div className="p-5 sm:p-6">
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
                    ? 'border-amber-400 bg-gradient-to-r from-amber-50 to-orange-50/70 shadow-2xs'
                    : 'border-slate-200 bg-white hover:border-amber-300 hover:bg-amber-50/30 text-slate-700'
                }`}
              >
                {/* Custom Checkbox */}
                <div
                  className={`w-5 h-5 rounded-md flex items-center justify-center shrink-0 transition-colors ${
                    isSelected
                      ? 'bg-amber-600 text-white'
                      : 'border border-slate-300 bg-white'
                  }`}
                >
                  {isSelected && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                </div>

                {/* Format Title */}
                <div className="flex-1 min-w-0">
                  <span className="text-xs font-bold text-slate-900 leading-snug truncate block">
                    {fmt.name}
                  </span>
                  {count > 0 && (
                    <span className="text-2xs text-amber-800 font-semibold tabular-nums">
                      {count} ಪ್ರಶ್ನೆಗಳು ಲಭ್ಯ
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
