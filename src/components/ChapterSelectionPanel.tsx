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
    <div className="bg-[#231d18] rounded-2xl border border-amber-200/15 shadow-xl overflow-hidden font-kannada">
      {/* Deep Botanical Forest-Teal Header Band */}
      <div className="bg-gradient-to-r from-[#1e3d31] via-[#214738] to-[#1a342a] border-b border-amber-200/15 px-5 py-3.5 flex items-center justify-between flex-wrap gap-2 text-white">
        <div className="flex items-center gap-2.5">
          <BookMarked className="w-4 h-4 text-amber-300 shrink-0" />
          <h2 className="text-sm sm:text-base font-extrabold tracking-tight text-[#f8f1e7]">
            2. ಪಾಠಗಳ ಆಯ್ಕೆ (Select Chapters)
          </h2>
          {chapters.length > 0 && (
            <span className="text-xs font-bold text-amber-200 tabular-nums">
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
                ? 'bg-amber-400 text-[#1b140d]'
                : 'bg-black/25 hover:bg-black/40 text-amber-100 border border-amber-200/25 disabled:opacity-40 disabled:pointer-events-none'
            }`}
          >
            ಎಲ್ಲವೂ ಆಯ್ಕೆ
          </button>

          <button
            type="button"
            onClick={handleClear}
            disabled={chapters.length === 0}
            className="px-3 py-1.5 text-xs font-bold rounded-lg bg-black/20 hover:bg-black/35 text-amber-100/90 border border-white/15 transition-colors disabled:opacity-40 disabled:pointer-events-none cursor-pointer whitespace-nowrap"
          >
            ತೆರವುಗೊಳಿಸಿ
          </button>
        </div>
      </div>

      <div className="p-5 sm:p-6">
        {/* Empty State */}
        {chapters.length === 0 ? (
          <div className="py-8 px-4 text-center rounded-xl bg-[#1b1612] border border-dashed border-amber-200/25 space-y-2">
            <p className="text-sm font-bold text-[#f7efe5]">
              ಆಯ್ದ ಸೆಮಿಸ್ಟರ್‌ನಲ್ಲಿ ಯಾವುದೇ ಅಧ್ಯಾಯಗಳು ಕಂಡುಬಂದಿಲ್ಲ.
            </p>
            <p className="text-xs text-[#c5b7a5]">
              ದಯವಿಟ್ಟು ಸೆಮಿಸ್ಟರ್ ಆಯ್ಕೆಯನ್ನು &quot;ಪೂರ್ಣ ವರ್ಷ (Full Syllabus)&quot; ಗೆ ಬದಲಾಯಿಸಿ.
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
                      ? 'border-emerald-400/60 bg-gradient-to-r from-[#23372d] to-[#282b23] shadow-sm'
                      : 'border-amber-200/12 bg-[#1c1713] hover:border-amber-300/35 hover:bg-[#27201a] text-[#d6c8b7]'
                  }`}
                >
                  {/* Custom Checkbox */}
                  <div
                    className={`w-5 h-5 rounded-md flex items-center justify-center shrink-0 transition-colors ${
                      isSelected
                        ? 'bg-emerald-600 text-white shadow-xs'
                        : 'border border-amber-200/30 bg-[#14100d]'
                    }`}
                  >
                    {isSelected && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                  </div>

                  {/* Chapter Name */}
                  <div className="flex-1 min-w-0">
                    <span className="text-xs sm:text-sm font-bold text-[#f7f0e6] leading-snug truncate block">
                      {chapter.chapterName}
                    </span>
                    <div className="flex items-center gap-2 mt-0.5 text-2xs text-[#b8a895] tabular-nums">
                      <span className="font-semibold text-amber-300/95">
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
