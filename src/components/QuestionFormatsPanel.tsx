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
    <div className="bg-[#231d18] rounded-2xl border border-amber-200/15 shadow-xl overflow-hidden font-kannada">
      {/* Warm Ochre-Saffron Header Band */}
      <div className="bg-gradient-to-r from-[#7a4518] via-[#8f521c] to-[#6b3b15] border-b border-amber-200/15 px-5 py-3.5 flex flex-wrap items-center justify-between gap-2 text-white">
        <div className="flex items-center gap-2.5">
          <ListChecks className="w-4 h-4 text-amber-200 shrink-0" />
          <h2 className="text-sm sm:text-base font-extrabold tracking-tight text-[#fff6ea]">
            3. ಪ್ರಶ್ನೆ ಪ್ರಕಾರಗಳು (Question Formats)
          </h2>
          <span className="text-xs font-bold text-amber-200 tabular-nums">
            ({selectedFormatIds.length}/{availableFormats.length})
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {onOpenSectionConfig && (
            <button
              type="button"
              onClick={onOpenSectionConfig}
              className="px-3 py-1.5 text-xs font-bold rounded-lg bg-[#f7e7b4] text-[#23190f] hover:bg-[#faeec7] transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap shadow-xs"
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
                ? 'bg-[#1c150f] text-amber-300 border border-amber-300/40'
                : 'bg-black/25 hover:bg-black/40 text-amber-100 border border-amber-200/25'
            }`}
          >
            ಎಲ್ಲವೂ ಆಯ್ಕೆ
          </button>

          <button
            type="button"
            onClick={handleClear}
            className="px-3 py-1.5 text-xs font-bold rounded-lg bg-black/20 hover:bg-black/35 text-amber-100/90 border border-white/15 transition-colors cursor-pointer whitespace-nowrap"
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
                    ? 'border-amber-400/65 bg-gradient-to-r from-[#342619] to-[#2a2119] shadow-sm'
                    : 'border-amber-200/12 bg-[#1c1713] hover:border-amber-300/35 hover:bg-[#27201a] text-[#d6c8b7]'
                }`}
              >
                {/* Custom Checkbox */}
                <div
                  className={`w-5 h-5 rounded-md flex items-center justify-center shrink-0 transition-colors ${
                    isSelected
                      ? 'bg-amber-600 text-white shadow-xs'
                      : 'border border-amber-200/30 bg-[#14100d]'
                  }`}
                >
                  {isSelected && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                </div>

                {/* Format Title */}
                <div className="flex-1 min-w-0">
                  <span className="text-xs font-bold text-[#f7f0e6] leading-snug truncate block">
                    {fmt.name}
                  </span>
                  {count > 0 && (
                    <span className="text-2xs text-amber-300 font-semibold tabular-nums">
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
