/**
 * Step 4: Chapter Selection Component
 * Select All, Deselect All, Multi-select with real-time question counts.
 * Author: S R Angadi
 */

import React from 'react';
import { Chapter } from '../types/questionBank.ts';
import { CheckSquare, Square, FolderCheck, ListFilter } from 'lucide-react';

interface ChapterSelectorProps {
  chapters: Chapter[];
  selectedChapterIds: string[];
  onChangeSelectedChapters: (chapterIds: string[]) => void;
}

export const ChapterSelector: React.FC<ChapterSelectorProps> = ({
  chapters,
  selectedChapterIds,
  onChangeSelectedChapters,
}) => {
  const isAllSelected = chapters.length > 0 && selectedChapterIds.length === chapters.length;

  const handleSelectAll = () => {
    onChangeSelectedChapters(chapters.map(c => c.chapterId));
  };

  const handleDeselectAll = () => {
    onChangeSelectedChapters([]);
  };

  const handleToggleChapter = (chapterId: string) => {
    if (selectedChapterIds.includes(chapterId)) {
      onChangeSelectedChapters(selectedChapterIds.filter(id => id !== chapterId));
    } else {
      onChangeSelectedChapters([...selectedChapterIds, chapterId]);
    }
  };

  // Calculate questions count in selected chapters
  const selectedQuestionsCount = React.useMemo(() => {
    return chapters
      .filter(ch => selectedChapterIds.includes(ch.chapterId))
      .reduce((sum, ch) => sum + ch.questions.length, 0);
  }, [chapters, selectedChapterIds]);

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 sm:p-6 shadow-xs">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4 mb-4">
        <div>
          <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <FolderCheck className="w-5 h-5 text-indigo-600" />
            <span>ಹಂತ ೪ : ಅಧ್ಯಾಯಗಳ ಆಯ್ಕೆ (Select Chapters)</span>
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            ಪ್ರಶ್ನೆ ಪತ್ರಿಕೆಯಲ್ಲಿ ಸೇರಿಸಬೇಕಾದ ಅಧ್ಯಾಯಗಳನ್ನು ಆರಿಸಿ.
          </p>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleSelectAll}
            disabled={isAllSelected}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors flex items-center gap-1.5 ${
              isAllSelected
                ? 'bg-slate-50 text-slate-400 border-slate-200 cursor-not-allowed'
                : 'bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100'
            }`}
          >
            <CheckSquare className="w-3.5 h-3.5" />
            <span>ಎಲ್ಲವನ್ನೂ ಆಯ್ಕೆಮಾಡಿ (Select All)</span>
          </button>

          <button
            type="button"
            onClick={handleDeselectAll}
            disabled={selectedChapterIds.length === 0}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors flex items-center gap-1.5 ${
              selectedChapterIds.length === 0
                ? 'bg-slate-50 text-slate-400 border-slate-200 cursor-not-allowed'
                : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
            }`}
          >
            <Square className="w-3.5 h-3.5" />
            <span>ಆಯ್ಕೆ ತೆರವುಗೊಳಿಸಿ (Clear)</span>
          </button>
        </div>
      </div>

      {/* Chapters Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
        {chapters.map(chapter => {
          const isSelected = selectedChapterIds.includes(chapter.chapterId);
          return (
            <div
              key={chapter.chapterId}
              onClick={() => handleToggleChapter(chapter.chapterId)}
              className={`p-3 rounded-lg border cursor-pointer select-none transition-all flex items-start gap-3 ${
                isSelected
                  ? 'border-indigo-600 bg-indigo-50/40 text-slate-900 shadow-xs ring-1 ring-indigo-600'
                  : 'border-slate-200 bg-white hover:border-slate-300 text-slate-700'
              }`}
            >
              <div className="mt-0.5 shrink-0">
                {isSelected ? (
                  <CheckSquare className="w-4 h-4 text-indigo-600" />
                ) : (
                  <Square className="w-4 h-4 text-slate-300" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium leading-snug line-clamp-2">
                  {chapter.chapterName}
                </p>
                <div className="flex items-center gap-2 mt-1.5 text-xs text-slate-500">
                  <span className="font-semibold text-slate-700">
                    {chapter.questions.length} ಪ್ರಶ್ನೆಗಳು
                  </span>
                  <span>·</span>
                  <span className="text-slate-400">
                    {Array.from(new Set(chapter.questions.map(q => q.questionType))).length} ಪ್ರಶ್ನೆ ವಿಧಗಳು
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer summary */}
      <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
        <div>
          ಆಯ್ಕೆಮಾಡಲಾದ ಅಧ್ಯಾಯಗಳು: <strong className="text-slate-900 font-semibold">{selectedChapterIds.length}</strong> / {chapters.length}
        </div>
        <div>
          ಲಭ್ಯವಿರುವ ಒಟ್ಟು ಪ್ರಶ್ನೆಗಳು: <strong className="text-indigo-600 font-semibold">{selectedQuestionsCount}</strong>
        </div>
      </div>
    </div>
  );
};
