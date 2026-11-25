/**
 * Chapter Selection Panel: 2. ಪಾಠಗಳ ಆಯ್ಕೆ (Select Chapters)
 * Matching the exact visual style in the screenshot.
 * Author: M I Nilaji / S R Angadi
 */

import React from 'react';
import { Chapter } from '../types/questionBank.ts';
import { Check } from 'lucide-react';

interface ChapterSelectionPanelProps {
  chapters: Chapter[];
  selectedChapterIds: string[];
  onChangeSelectedChapters: (chapterIds: string[]) => void;
}

export const ChapterSelectionPanel: React.FC<ChapterSelectionPanelProps> = ({
  chapters,
  selectedChapterIds,
  onChangeSelectedChapters,
}) => {
  const isAllSelected = chapters.length > 0 && selectedChapterIds.length === chapters.length;

  const handleSelectAll = () => {
    onChangeSelectedChapters(chapters.map(c => c.chapterId));
  };

  const handleClear = () => {
    onChangeSelectedChapters([]);
  };

  const handleToggle = (id: string) => {
    if (selectedChapterIds.includes(id)) {
      onChangeSelectedChapters(selectedChapterIds.filter(chId => chId !== id));
    } else {
      onChangeSelectedChapters([...selectedChapterIds, id]);
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200/90 p-5 sm:p-6 shadow-xs font-kannada">
      
      {/* Header with Title & Action Buttons */}
      <div className="flex items-center justify-between pb-3 mb-3 border-b border-slate-100 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-bold text-slate-900 tracking-tight">
            2. ಪಾಠಗಳ ಆಯ್ಕೆ (Select Chapters)
          </h2>
          {chapters.length > 0 && (
            <span className="px-2 py-0.5 rounded-full text-2xs font-bold bg-indigo-50 text-indigo-700 border border-indigo-100">
              {selectedChapterIds.length}/{chapters.length} ಆಯ್ಕೆಮಾಡಲಾಗಿದೆ
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleSelectAll}
            disabled={chapters.length === 0}
            className={`px-3.5 py-1 text-xs font-bold rounded-full transition-colors ${
              isAllSelected
                ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                : 'border border-emerald-500 text-emerald-700 bg-emerald-50/60 hover:bg-emerald-100 disabled:opacity-40 disabled:pointer-events-none'
            }`}
          >
            Select All
          </button>

          <button
            type="button"
            onClick={handleClear}
            disabled={chapters.length === 0}
            className="px-3.5 py-1 text-xs font-bold rounded-full border border-slate-300 text-slate-600 bg-slate-50 hover:bg-slate-100 transition-colors disabled:opacity-40 disabled:pointer-events-none"
          >
            Clear
          </button>
        </div>
      </div>

      {/* Empty State */}
      {chapters.length === 0 ? (
        <div className="py-8 px-4 text-center rounded-xl bg-slate-50 border border-dashed border-slate-300 space-y-2">
          <p className="text-sm font-bold text-slate-700">
            ಆಯ್ದ ಸೆಮಿಸ್ಟರ್‌ನಲ್ಲಿ ಯಾವುದೇ ಅಧ್ಯಾಯಗಳು ಕಂಡುಬಂದಿಲ್ಲ.
          </p>
          <p className="text-xs text-slate-500">
            ದಯವಿಟ್ಟು ಎಡಭಾಗದಲ್ಲಿ "ಭಾಗ / ಸೆಮಿಸ್ಟರ್" ಆಯ್ಕೆಯನ್ನು "🟩 ಸಂಪೂರ್ಣ ಪಠ್ಯಕ್ರಮ (Full Syllabus)" ಗೆ ಬದಲಾಯಿಸಿ.
          </p>
        </div>
      ) : (
        /* 2-column Grid of Chapters */
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {chapters.map(chapter => {
            const isSelected = selectedChapterIds.includes(chapter.chapterId);

            return (
              <div
                key={chapter.chapterId}
                onClick={() => handleToggle(chapter.chapterId)}
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

                {/* Chapter Name */}
                <div className="flex-1 min-w-0">
                  <span className="text-xs sm:text-sm font-bold text-slate-900 leading-snug truncate block">
                    {chapter.chapterName}
                  </span>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-2xs text-slate-400 font-medium">
                      {chapter.questions.length} ಪ್ರಶ್ನೆಗಳು
                    </span>
                    {chapter.semester && (
                      <span className="text-2xs px-1.5 py-0.2 rounded bg-slate-100 text-slate-500 font-semibold">
                        Sem {chapter.semester}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

    </div>
  );
};
