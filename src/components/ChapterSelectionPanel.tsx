/**
 * Chapter Selection Panel: 2. ಪಾಠಗಳ ಆಯ್ಕೆ (Select Chapters)
 * Colorful Royal Sky-Blue & Botanical theme card for clear visual distinction.
 * Author: M I Nilaji / S R Angadi
 */

import React from 'react';
import { Chapter } from '../types/questionBank.ts';
import { Check, BookMarked } from 'lucide-react';

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
    <div className="bg-white rounded-2xl border border-sky-200 shadow-sm overflow-hidden font-kannada">
      {/* Colorful Royal Sky-Blue Header Band */}
      <div className="bg-gradient-to-r from-sky-700 via-blue-700 to-indigo-700 px-5 py-3.5 flex items-center justify-between flex-wrap gap-2 text-white">
        <div className="flex items-center gap-2.5">
          <BookMarked className="w-4 h-4 text-amber-300 shrink-0" />
          <h2 className="text-sm sm:text-base font-extrabold tracking-tight">
            2. ಪಾಠಗಳ ಆಯ್ಕೆ (Select Chapters)
          </h2>
          {chapters.length > 0 && (
            <span className="text-xs font-bold text-sky-100 tabular-nums">
              ({selectedChapterIds.length}/{chapters.length})
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleSelectAll}
            disabled={chapters.length === 0}
            className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-colors cursor-pointer whitespace-nowrap ${
              isAllSelected
                ? 'bg-amber-400 text-slate-950'
                : 'bg-white/15 hover:bg-white/25 text-white border border-white/25 disabled:opacity-40 disabled:pointer-events-none'
            }`}
          >
            ಎಲ್ಲವೂ ಆಯ್ಕೆ
          </button>

          <button
            type="button"
            onClick={handleClear}
            disabled={chapters.length === 0}
            className="px-3 py-1.5 text-xs font-bold rounded-lg bg-white/10 hover:bg-white/20 text-white border border-white/20 transition-colors disabled:opacity-40 disabled:pointer-events-none cursor-pointer whitespace-nowrap"
          >
            ತೆರವುಗೊಳಿಸಿ
          </button>
        </div>
      </div>

      <div className="p-5 sm:p-6">
        {/* Empty State */}
        {chapters.length === 0 ? (
          <div className="py-8 px-4 text-center rounded-xl bg-sky-50/50 border border-dashed border-sky-300 space-y-2">
            <p className="text-sm font-bold text-sky-950">
              ಆಯ್ದ ಸೆಮಿಸ್ಟರ್‌ನಲ್ಲಿ ಯಾವುದೇ ಅಧ್ಯಾಯಗಳು ಕಂಡುಬಂದಿಲ್ಲ.
            </p>
            <p className="text-xs text-sky-800">
              ದಯವಿಟ್ಟು ಎಡಭಾಗದಲ್ಲಿ &quot;ಭಾಗ / ಸೆಮಿಸ್ಟರ್&quot; ಆಯ್ಕೆಯನ್ನು &quot;ಸಂಪೂರ್ಣ ಪಠ್ಯಕ್ರಮ (Full Syllabus)&quot; ಗೆ ಬದಲಾಯಿಸಿ.
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
                      ? 'border-sky-400 bg-gradient-to-r from-sky-50 to-emerald-50/60 shadow-2xs'
                      : 'border-slate-200 bg-white hover:border-sky-300 hover:bg-sky-50/30 text-slate-700'
                  }`}
                >
                  {/* Custom Checkbox */}
                  <div
                    className={`w-5 h-5 rounded-md flex items-center justify-center shrink-0 transition-colors ${
                      isSelected
                        ? 'bg-sky-700 text-white'
                        : 'border border-slate-300 bg-white'
                    }`}
                  >
                    {isSelected && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                  </div>

                  {/* Chapter Name */}
                  <div className="flex-1 min-w-0">
                    <span className="text-xs sm:text-sm font-bold text-slate-900 leading-snug truncate block">
                      {chapter.chapterName}
                    </span>
                    <div className="flex items-center gap-2 mt-0.5 text-2xs text-slate-600 tabular-nums">
                      <span className="font-semibold text-sky-800">
                        {chapter.questions.length} ಪ್ರಶ್ನೆಗಳು
                      </span>
                      {chapter.semester && (
                        <span>· Sem {chapter.semester}</span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
