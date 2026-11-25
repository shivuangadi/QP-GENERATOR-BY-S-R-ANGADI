/**
 * Question Replacement Modal
 * Allows teachers to replace any generated question with another matching question from the bank.
 * Author: S R Angadi
 */

import React from 'react';
import { QuestionItem, GeneratedQuestionItem } from '../types/questionBank.ts';
import { X, RefreshCw, Check, AlertCircle } from 'lucide-react';
import { MathText } from './MathText.tsx';

interface ReplaceQuestionModalProps {
  isOpen: boolean;
  onClose: () => void;
  targetQuestion: GeneratedQuestionItem | null;
  candidateQuestions: QuestionItem[];
  onSelectReplacement: (candidate: QuestionItem) => void;
}

export const ReplaceQuestionModal: React.FC<ReplaceQuestionModalProps> = ({
  isOpen,
  onClose,
  targetQuestion,
  candidateQuestions,
  onSelectReplacement,
}) => {
  if (!isOpen || !targetQuestion) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs no-print">
      <div className="bg-white rounded-xl shadow-xl border border-slate-200 max-w-2xl w-full max-h-[85vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
          <div>
            <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <RefreshCw className="w-4 h-4 text-indigo-600" />
              <span>ಪ್ರಶ್ನೆ ಬದಲಾಯಿಸಿ / Replace Question</span>
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              ಪ್ರಶ್ನೆ ಸಂಖ್ಯೆ {targetQuestion.displayNumber} ಕ್ಕೆ ಪರ್ಯಾಯ ಪ್ರಶ್ನೆಯನ್ನು ಆಯ್ಕೆ ಮಾಡಿ.
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Current Question preview */}
        <div className="p-4 bg-indigo-50/40 border-b border-indigo-100/60 text-xs text-indigo-950">
          <div className="font-semibold text-indigo-900 mb-1 flex items-center justify-between">
            <span>ಪ್ರಸ್ತುತ ಪ್ರಶ್ನೆ #{targetQuestion.displayNumber}:</span>
            <span className="text-slate-500 font-normal">{targetQuestion.chapterName}</span>
          </div>
          <p className="line-clamp-2 italic"><MathText text={targetQuestion.question} /></p>
        </div>

        {/* Candidates List */}
        <div className="p-5 overflow-y-auto flex-1 space-y-3">
          <div className="text-xs font-semibold text-slate-700 mb-2 flex items-center justify-between">
            <span>ಲಭ್ಯವಿರುವ ಪರ್ಯಾಯ ಪ್ರಶ್ನೆಗಳು ({candidateQuestions.length}):</span>
            <span className="text-slate-400 text-2xs">ಅದೇ ವಿಭಾಗದ ಮಾನದಂಡಗಳ ಆಧಾರದ ಮೇಲೆ</span>
          </div>

          {candidateQuestions.length === 0 ? (
            <div className="p-8 text-center bg-slate-50 rounded-lg border border-slate-100 text-slate-500 text-xs">
              <AlertCircle className="w-8 h-8 text-slate-400 mx-auto mb-2" />
              <p className="font-semibold">ಯಾವುದೇ ಪರ್ಯಾಯ ಪ್ರಶ್ನೆಗಳು ಲಭ್ಯವಿಲ್ಲ</p>
              <p className="mt-1 text-slate-400">
                ಈ ವಿಭಾಗದ ಎಲ್ಲಾ ಹೊಂದಾಣಿಕೆಯ ಪ್ರಶ್ನೆಗಳನ್ನು ಈಗಾಗಲೇ ಪತ್ರಿಕೆಯಲ್ಲಿ ಬಳಸಲಾಗಿದೆ.
              </p>
            </div>
          ) : (
            candidateQuestions.map((candidate, cIdx) => (
              <div
                key={`${candidate.chapterId || 'ch'}_${candidate.id || 'q'}_${cIdx}`}
                className="p-3.5 rounded-lg border border-slate-200 hover:border-indigo-500 hover:bg-indigo-50/20 transition-all flex items-start justify-between gap-3 group"
              >
                <div className="flex-1 space-y-1.5 text-xs">
                  <p className="font-medium text-slate-900 leading-relaxed whitespace-pre-line">
                    <MathText text={candidate.question} />
                  </p>
                  
                  {candidate.options && candidate.options.length > 0 && (
                    <div className="grid grid-cols-2 gap-1 text-slate-600 pl-2">
                      {candidate.options.map((opt, i) => (
                        <div key={i}><MathText text={opt} /></div>
                      ))}
                    </div>
                  )}

                  <div className="flex flex-wrap items-center gap-2 text-2xs text-slate-400 pt-1">
                    <span>{candidate.chapterName}</span>
                    <span>·</span>
                    <span>{candidate.questionType}</span>
                    <span>·</span>
                    <span>ಅಂಕ: {candidate.marks}</span>
                    {candidate.learningOutcome && (
                      <>
                        <span>·</span>
                        <span>{candidate.learningOutcome}</span>
                      </>
                    )}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    onSelectReplacement(candidate);
                    onClose();
                  }}
                  className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-md text-xs font-semibold flex items-center gap-1 shrink-0 transition-colors shadow-xs"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>ಆಯ್ಕೆ ಮಾಡಿ</span>
                </button>
              </div>
            ))
          )}
        </div>

        {/* Modal Footer */}
        <div className="p-4 border-t border-slate-100 flex justify-end bg-slate-50">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
          >
            ರದ್ದುಮಾಡಿ (Cancel)
          </button>
        </div>

      </div>
    </div>
  );
};
