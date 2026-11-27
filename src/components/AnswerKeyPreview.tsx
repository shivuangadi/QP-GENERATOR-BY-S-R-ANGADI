/**
 * Separate Answer Key (ಉತ್ತರ ಪತ್ರಿಕೆ) Component
 * Maintains exact question numbering and original answers from JSON.
 * Author: S R Angadi
 */

import React from 'react';
import { GeneratedPaper } from '../types/questionBank.ts';
import { Printer, CheckCircle, FileCheck, HelpCircle } from 'lucide-react';
import { MathText } from './MathText.tsx';
import { ResilientQuestionImage } from './ResilientQuestionImage.tsx';

interface AnswerKeyPreviewProps {
  paper: GeneratedPaper;
}

export const AnswerKeyPreview: React.FC<AnswerKeyPreviewProps> = ({ paper }) => {
  return (
    <div className="space-y-6">
      {/* Action Toolbar */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs flex items-center justify-between no-print">
        <div className="flex items-center gap-2">
          <FileCheck className="w-5 h-5 text-emerald-600" />
          <div>
            <h3 className="text-sm font-bold text-slate-900">
              ಉತ್ತರ ಪತ್ರಿಕೆ ಮತ್ತು ಮೌಲ್ಯಮಾಪನ ಸೂಚಿ (Answer Key & Scoring Scheme)
            </h3>
            <p className="text-xs text-slate-500">
              ಪ್ರಶ್ನೆ ಪತ್ರಿಕೆಯಲ್ಲಿ ಆಯ್ಕೆಯಾದ ಎಲ್ಲಾ ಪ್ರಶ್ನೆಗಳ ಅಧಿಕೃತ ಉತ್ತರಗಳು ಮತ್ತು ಅಂಕ ಹಂಚಿಕೆ.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => window.print()}
          className="px-4 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors shadow-xs flex items-center gap-2"
        >
          <Printer className="w-4 h-4" />
          <span>ಉತ್ತರ ಪತ್ರಿಕೆ ಮುದ್ರಿಸಿ (Print Answer Key)</span>
        </button>
      </div>

      {/* Printable Answer Key Sheet */}
      <div className="printable-document bg-white border border-slate-300 shadow-lg mx-auto max-w-[210mm] min-h-[297mm] p-8 sm:p-12 text-slate-900 font-kannada">
        
        {/* Header */}
        <div className="text-center pb-3 border-b-2 border-slate-900 mb-6 space-y-1">
          <div className="inline-block px-3 py-1 bg-slate-900 text-white text-xs font-bold uppercase tracking-wider rounded mb-1">
            ಉತ್ತರ ಪತ್ರಿಕೆ / ಅಧಿಕೃತ ಕೀಲಿ ಉತ್ತರ (ANSWER KEY)
          </div>
          <h1 className="text-lg sm:text-xl font-bold tracking-wide text-slate-900">
            {paper.header.schoolName}
          </h1>
          <h2 className="text-sm sm:text-base font-semibold text-slate-700">
            {paper.header.examName} · {paper.header.academicYear}
          </h2>

          <div className="pt-2 text-xs font-medium grid grid-cols-2 sm:grid-cols-4 gap-2 text-left border-t border-slate-300 mt-2">
            <div>
              <strong>ತರಗತಿ:</strong> {paper.header.grade}
            </div>
            <div>
              <strong>ವಿಷಯ:</strong> {paper.header.subject}
            </div>
            <div>
              <strong>ಒಟ್ಟು ಪ್ರಶ್ನೆಗಳು:</strong> {paper.totalQuestions}
            </div>
            <div className="text-right font-bold">
              <strong>ಗರಿಷ್ಠ ಅಂಕಗಳು:</strong> {paper.totalMarks}
            </div>
          </div>
        </div>

        {/* Answers List Section by Section */}
        <div className="space-y-6">
          {paper.sections.map(section => (
            <div key={section.blueprint.id} className="section-block border-b border-slate-200 pb-5 last:border-b-0">
              
              <div className="font-bold text-sm text-slate-900 mb-3 bg-slate-100 p-2 rounded flex justify-between items-center">
                <span>{section.blueprint.title}</span>
                <span className="text-xs font-normal text-slate-600">
                  ಪ್ರತಿ ಪ್ರಶ್ನೆಗೆ {section.blueprint.marksPerQuestion} ಅಂಕ
                </span>
              </div>

              <div className="space-y-3">
                {section.questions.map(q => {
                  const hasAnswer = q.answer && q.answer.trim().length > 0 && q.answer !== 'ಉತ್ತರ ಲಭ್ಯವಿಲ್ಲ';

                  return (
                    <div
                      key={q.uid}
                      className="question-block p-3 rounded-lg border border-slate-100 bg-slate-50/50 space-y-1.5 text-xs"
                    >
                      {/* Question reference */}
                      <div className="flex items-start justify-between gap-3 text-slate-600">
                        <div className="font-semibold text-slate-800 leading-relaxed">
                          <span>ಪ್ರಶ್ನೆ #{q.displayNumber}:</span>{' '}
                          <span className="font-normal italic"><MathText text={q.question} /></span>
                        </div>
                        <span className="font-bold text-slate-700 tabular-nums shrink-0">
                          [{q.marks} ಅಂಕ]
                        </span>
                      </div>

                      {/* Question Diagram / Dual Images Side-by-Side preview if present */}
                      {(q.imageUrl || q.imageUrl2) && (
                        <div className="my-1.5">
                          {(q.answerImageUrl || q.answerImageUrl2) && (
                            <span className="block text-2xs font-semibold text-slate-500 mb-1">
                              ಪ್ರಶ್ನೆ ಚಿತ್ರ (Question Diagram):
                            </span>
                          )}
                          {q.imageUrl && q.imageUrl2 ? (
                            <div className="grid grid-cols-2 gap-3 max-w-2xl items-center">
                              <ResilientQuestionImage
                                src={q.imageUrl}
                                alt={q.diagramDescription || 'ಪ್ರಶ್ನೆ ಚಿತ್ರ 1'}
                                className={`${q.answerImageUrl || q.answerImageUrl2 ? 'max-h-28' : 'max-h-36'} w-full rounded border border-slate-200 object-contain bg-white p-0.5`}
                              />
                              <ResilientQuestionImage
                                src={q.imageUrl2}
                                alt="ಪ್ರಶ್ನೆ ಚಿತ್ರ 2"
                                className={`${q.answerImageUrl || q.answerImageUrl2 ? 'max-h-28' : 'max-h-36'} w-full rounded border border-slate-200 object-contain bg-white p-0.5`}
                              />
                            </div>
                          ) : (
                            <ResilientQuestionImage
                              src={(q.imageUrl || q.imageUrl2)!}
                              alt={q.diagramDescription || 'ಪ್ರಶ್ನೆ ಚಿತ್ರ'}
                              className={`${q.answerImageUrl || q.answerImageUrl2 ? 'max-h-28' : 'max-h-36'} rounded border border-slate-200 object-contain bg-white p-0.5`}
                            />
                          )}
                        </div>
                      )}
                      {q.diagramSvg && !q.imageUrl && !q.imageUrl2 && (
                        <div
                          className="my-1.5 max-w-xs border border-slate-200 rounded bg-white p-1"
                          dangerouslySetInnerHTML={{ __html: q.diagramSvg }}
                        />
                      )}

                      {/* Official Answer */}
                      <div className="flex items-start gap-2 pt-1.5 border-t border-slate-200/60">
                        <span className="font-bold text-emerald-800 shrink-0">ಉತ್ತರ:</span>
                        <div className="flex-1 space-y-2">
                          <div className="font-medium text-slate-900 whitespace-pre-line leading-relaxed">
                            {hasAnswer ? (
                              <MathText text={q.answer} />
                            ) : q.answerImageUrl || q.answerImageUrl2 || q.answerDiagramSvg ? (
                              <span className="text-emerald-800 font-semibold">
                                ಕೆಳಗಿನ ಲೇಬಲ್ ಮಾಡಿದ ಉತ್ತರ ಚಿತ್ರವನ್ನು ಗಮನಿಸಿ (See labeled answer diagram below)
                              </span>
                            ) : (
                              <span className="text-amber-700 italic flex items-center gap-1">
                                <HelpCircle className="w-3.5 h-3.5" />
                                <span>ಪ್ರಶ್ನೆ ಬ್ಯಾಂಕ್‌ನಲ್ಲಿ ಉತ್ತರ ಲಭ್ಯವಿಲ್ಲ (Answer unavailable in bank)</span>
                              </span>
                            )}
                          </div>

                          {/* Separate Answer Key Diagram (1 or 2 Images Side-by-Side) */}
                          {(q.answerImageUrl || q.answerImageUrl2) && (
                            <div className="pt-1">
                              <span className="block text-2xs font-bold text-emerald-800 mb-1">
                                ಉತ್ತರ ಚಿತ್ರ / ಲೇಬಲ್ ಮಾಡಿದ ಚಿತ್ರ (Answer Key Diagram):
                              </span>
                              {q.answerImageUrl && q.answerImageUrl2 ? (
                                <div className="grid grid-cols-2 gap-3 max-w-2xl items-center">
                                  <ResilientQuestionImage
                                    src={q.answerImageUrl}
                                    alt={q.answerDiagramDescription || 'ಉತ್ತರ ಚಿತ್ರ 1 / Labeled Answer Diagram 1'}
                                    className="max-h-48 w-full rounded border border-emerald-300 object-contain bg-white p-1"
                                  />
                                  <ResilientQuestionImage
                                    src={q.answerImageUrl2}
                                    alt="ಉತ್ತರ ಚಿತ್ರ 2 / Labeled Answer Diagram 2"
                                    className="max-h-48 w-full rounded border border-emerald-300 object-contain bg-white p-1"
                                  />
                                </div>
                              ) : (
                                <ResilientQuestionImage
                                  src={(q.answerImageUrl || q.answerImageUrl2)!}
                                  alt={q.answerDiagramDescription || 'ಉತ್ತರ ಚಿತ್ರ / Labeled Answer Diagram'}
                                  className="max-h-48 max-w-full rounded border border-emerald-300 object-contain bg-white p-1"
                                />
                              )}
                            </div>
                          )}
                          {q.answerDiagramSvg && !q.answerImageUrl && !q.answerImageUrl2 && (
                            <div className="pt-1">
                              <span className="block text-2xs font-bold text-emerald-800 mb-1">
                                ಉತ್ತರ ಚಿತ್ರ / ಲೇಬಲ್ ಮಾಡಿದ ಚಿತ್ರ (Answer Key Diagram):
                              </span>
                              <div
                                className="max-w-sm border border-emerald-300 rounded bg-white p-1.5"
                                dangerouslySetInnerHTML={{ __html: q.answerDiagramSvg }}
                              />
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Metadata tag */}
                      <div className="text-2xs text-slate-400 pt-1 flex items-center gap-2">
                        <span>ಅಧ್ಯಾಯ: {q.chapterName}</span>
                        {q.learningOutcome && (
                          <>
                            <span>·</span>
                            <span>ಕಲಿಕಾಂಶ: {q.learningOutcome}</span>
                          </>
                        )}
                        {q.difficulty && (
                          <>
                            <span>·</span>
                            <span>ಹಂತ: {q.difficulty}</span>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

            </div>
          ))}
        </div>

        {/* Footer Notice */}
        <div className="mt-8 pt-4 border-t border-slate-300 text-center text-xs text-slate-500">
          * ಈ ಕೀಲಿ ಉತ್ತರವು ಶಿಕ್ಷಕರ ಹಾಗೂ ಮೌಲ್ಯಮಾಪಕರ ಅಧಿಕೃತ ಉಪಯೋಗಕ್ಕೆ ಮಾತ್ರ.
        </div>

      </div>
    </div>
  );
};
