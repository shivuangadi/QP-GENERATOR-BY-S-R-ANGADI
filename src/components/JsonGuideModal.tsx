/**
 * Interactive Guide & Model on How to Prepare Question Bank JSON Files Correctly
 * Explains schema, mandatory answer field, options, and chapter weightages.
 * Author: M I Nilaji / S R Angadi
 */

import React, { useState } from 'react';
import { X, Copy, Check, Download, BookOpen, AlertCircle, FileCode } from 'lucide-react';

interface JsonGuideModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const SAMPLE_JSON_MODEL = `{
  "metadata": {
    "grade": "6 ನೇ ತರಗತಿ (Class 6)",
    "subject": "ಗಣಿತ (Mathematics)",
    "medium": "ಕನ್ನಡ ಮಾಧ್ಯಮ (State Syllabus)",
    "academic_year": "2026-27",
    "board": "ಕರ್ನಾಟಕ ರಾಜ್ಯ ಪಠ್ಯಕ್ರಮ (DSERT / KSEEB)",
    "total_chapters": 5
  },
  "chapters": [
    {
      "id": "math-ch-10",
      "chapter_number": 10,
      "title": "ಸೊನ್ನೆಯ ಮತ್ತೊಂದು ಬದಿ",
      "blueprint": {
        "marks": 8,
        "questions_count": 5,
        "weightage_percent": 20
      },
      "sections": [
        {
          "section_id": "I",
          "title": "ವಸ್ತುನಿಷ್ಠ ಪ್ರಶ್ನೆಗಳು (MCQ)",
          "marks_per_question": 1,
          "questions": [
            {
              "id": "m10-q1",
              "question_number": 1,
              "type": "mcq",
              "question": "ಸಂಖ್ಯಾರೇಖೆಯ ಮೇಲೆ (-12) ಸೊನ್ನೆಯಿಂದ ಯಾವ ದಿಕ್ಕಿನಲ್ಲಿರುತ್ತದೆ?",
              "options": [
                "A. ಬಲಕ್ಕೆ",
                "B. ಎಡಕ್ಕೆ",
                "C. ಮೇಲೆ",
                "D. ಕೆಳಗೆ"
              ],
              "answer": "B. ಎಡಕ್ಕೆ (ಸೊನ್ನೆಯ ಎಡಭಾಗದಲ್ಲಿ ಋಣ ಸಂಖ್ಯೆಗಳಿರುತ್ತವೆ)",
              "difficulty": "ಸುಲಭ",
              "learning_outcome": "LO 9",
              "marks": 1
            }
          ]
        },
        {
          "section_id": "II",
          "title": "ಕಿರು ಉತ್ತರ ಪ್ರಶ್ನೆಗಳು (1M / 2M)",
          "marks_per_question": 1,
          "questions": [
            {
              "id": "m10-q2",
              "question_number": 2,
              "type": "fill_blank",
              "question": "(+7) ರ ಸಂಕಲನದ ವಿಲೋಮ ಸಂಖ್ಯೆ _______________ ಆಗಿದೆ.",
              "answer": "-7",
              "difficulty": "ಸುಲಭ",
              "learning_outcome": "LO 9",
              "marks": 1
            },
            {
              "id": "m10-q3",
              "question_number": 3,
              "type": "short_answer",
              "question": "(-4) + (+6) ರ ಮೊತ್ತವನ್ನು ಸಂಖ್ಯಾ ರೇಖೆ ಬಳಸಿ ಕಂಡುಹಿಡಿಯಿರಿ.",
              "answer": "ಸಂಖ್ಯಾರೇಖೆಯ ಮೇಲೆ -4 ರಿಂದ ಬಲಕ್ಕೆ 6 ಘಟಕ ಚಲಿಸಿದಾಗ +2 ತಲುಪುತ್ತೇವೆ. ಆದ್ದರಿಂದ (-4) + (+6) = +2.",
              "difficulty": "ಸಾಧಾರಣ",
              "learning_outcome": "LO 10",
              "marks": 2
            }
          ]
        }
      ]
    }
  ]
}`;

export const JsonGuideModal: React.FC<JsonGuideModalProps> = ({ isOpen, onClose }) => {
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const handleCopy = () => {
    navigator.clipboard.writeText(SAMPLE_JSON_MODEL);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const blob = new Blob([SAMPLE_JSON_MODEL], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'karnataka_question_bank_model.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs no-print font-kannada">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-4xl w-full max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-indigo-600 text-white flex items-center justify-center shadow-xs">
              <FileCode className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900 leading-tight">
                ಪ್ರಶ್ನೆ ಬ್ಯಾಂಕ್ JSON ಫೈಲ್ ತಯಾರಿಸುವ ಪರಿಪೂರ್ಣ ಮಾದರಿ
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                How to prepare Karnataka Question Bank JSON files with 100% verified answers & blueprint weightages.
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-5 text-xs text-slate-700 leading-relaxed">
          
          {/* Important Notice regarding "Answer is not available" */}
          <div className="bg-amber-50 border-2 border-amber-300 rounded-xl p-4 text-amber-900 space-y-1.5">
            <div className="font-bold text-sm flex items-center gap-2 text-amber-950">
              <AlertCircle className="w-5 h-5 text-amber-600 shrink-0" />
              <span>ಉತ್ತರ ಲಭ್ಯವಿಲ್ಲ (Answer is not available) ಏಕೆ ತೋರಿಸುತ್ತದೆ? ಇದನ್ನು ಸರಿಪಡಿಸುವುದು ಹೇಗೆ?</span>
            </div>
            <ul className="list-disc list-inside space-y-1 pl-1">
              <li>
                <strong>ಪ್ರಮುಖ ಕಾರಣ:</strong> JSON ಫೈಲ್‌ನಲ್ಲಿ ಯಾವುದೇ ಪ್ರಶ್ನೆಗೆ <code className="bg-amber-200/60 px-1.5 py-0.5 rounded text-slate-900 font-mono">"answer": null</code> ಅಥವಾ ಉತ್ತರ ಖಾಲಿಯಾಗಿದ್ದರೆ, ಉತ್ತರ ಪತ್ರಿಕೆಯಲ್ಲಿ <em>"ಪ್ರಶ್ನೆ ಬ್ಯಾಂಕ್‌ನಲ್ಲಿ ಉತ್ತರ ಲಭ್ಯವಿಲ್ಲ"</em> ಎಂದು ತೋರಿಸುತ್ತದೆ.
              </li>
              <li>
                <strong>ಪರಿಹಾರ:</strong> ಪ್ರತಿಯೊಂದು ಪ್ರಶ್ನೆಗೂ ಖಚಿತವಾಗಿ <code className="bg-amber-200/60 px-1.5 py-0.5 rounded text-slate-900 font-mono">"answer": "ನಿಖರವಾದ ಉತ್ತರ ಪಠ್ಯ..."</code> ನಮೂದಿಸಬೇಕು.
              </li>
              <li>
                ನಮ್ಮ ಅಪ್ಲಿಕೇಶನ್‌ನಲ್ಲಿ ಈಗ ಕೇವಲ <strong>ಉತ್ತರವಿರುವ ಅಧಿಕೃತ ಪ್ರಶ್ನೆಗಳನ್ನು ಮಾತ್ರ</strong> ಪ್ರಶ್ನೆ ಪತ್ರಿಕೆಗೆ ಆಯ್ಕೆ ಮಾಡಲಾಗುತ್ತದೆ, ಇದರಿಂದ ಉತ್ತರ ಪತ್ರಿಕೆ ಯಾವಾಗಲೂ 100% ಪೂರ್ಣವಾಗಿರುತ್ತದೆ!
              </li>
            </ul>
          </div>

          {/* Key Guidelines */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-2">
              <h4 className="font-bold text-slate-900 text-xs sm:text-sm">
                ೧. ಕಡ್ಡಾಯ ಫೀಲ್ಡ್‌ಗಳು (Mandatory Fields)
              </h4>
              <ul className="space-y-1.5 text-slate-600">
                <li>• <strong className="text-slate-900">id</strong>: ಅನನ್ಯ ಗುರುತಿನ ಸಂಖ್ಯೆ (ಉದಾ: "m10-q1")</li>
                <li>• <strong className="text-slate-900">question</strong>: ಪ್ರಶ್ನೆಯ ಪೂರ್ಣ ಪಠ್ಯ (Kannada/English)</li>
                <li>• <strong className="text-slate-900">answer</strong>: ಅಧಿಕೃತ ಕೀಲಿ ಉತ್ತರ (Never leave null!)</li>
                <li>• <strong className="text-slate-900">marks</strong>: ನಿಗದಿತ ಅಂಕ (1, 2, 3, 4)</li>
                <li>• <strong className="text-slate-900">type</strong>: mcq, fill_blank, true_false, short_answer, etc.</li>
                <li>• <strong className="text-slate-900">options</strong>: ಬಹು ಆಯ್ಕೆ ಪ್ರಶ್ನೆಗೆ 4 ಆಯ್ಕೆಗಳು</li>
              </ul>
            </div>

            <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-2">
              <h4 className="font-bold text-slate-900 text-xs sm:text-sm">
                ೨. ನೀಲನಕಾಶೆ ಅಂಕ ಹಂಚಿಕೆ (Blueprint Weightage)
              </h4>
              <ul className="space-y-1.5 text-slate-600">
                <li>• <strong className="text-slate-900">difficulty</strong>: "ಸುಲಭ" (Easy), "ಸಾಧಾರಣ" (Avg), "ಕಠಿಣ" (Diff)</li>
                <li>• <strong className="text-slate-900">learning_outcome</strong>: "LO 1", "LO 9" (ಕಲಿಕಾಫಲ)</li>
                <li>• <strong className="text-slate-900">blueprint</strong>: ಪಾಠವಾರು ಅಂಕಗಳು (marks) & ಪ್ರಶ್ನೆಗಳ ಸಂಖ್ಯೆ (questions_count)</li>
                <li>• ಪರೀಕ್ಷಾ ನೀಲನಕಾಶೆಯ ಹಂತ 4 ಮತ್ತು 5 ರ ಪ್ರಕಾರ ಅಂಕಗಳ ತೂಕವನ್ನು ಹಂಚಲಾಗುತ್ತದೆ.</li>
              </ul>
            </div>
          </div>

          {/* Sample JSON Code Box */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-bold text-slate-900">
                ಮಾದರಿ JSON ಫೈಲ್ ಕೋಡ್ (Sample Question Bank JSON Structure):
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleCopy}
                  className="px-3 py-1 bg-slate-100 hover:bg-slate-200 rounded-lg text-slate-700 font-semibold flex items-center gap-1.5 transition-colors"
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copied ? 'ನಕಲಿಸಲಾಗಿದೆ!' : 'ಕೋಡ್ ಕಾಪಿ ಮಾಡಿ'}</span>
                </button>

                <button
                  type="button"
                  onClick={handleDownload}
                  className="px-3 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-semibold flex items-center gap-1.5 transition-colors"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>ಮಾದರಿ JSON ಡೌನ್‌ಲೋಡ್</span>
                </button>
              </div>
            </div>

            <pre className="p-4 bg-slate-950 text-emerald-400 font-mono text-2xs sm:text-xs rounded-xl overflow-x-auto max-h-72 border border-slate-800 leading-relaxed">
              {SAMPLE_JSON_MODEL}
            </pre>
          </div>

        </div>

        {/* Modal Footer */}
        <div className="p-4 border-t border-slate-200 flex justify-end bg-slate-50">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-bold text-slate-700 bg-white border border-slate-300 rounded-xl hover:bg-slate-100 transition-colors"
          >
            ಮುಚ್ಚಿರಿ (Close)
          </button>
        </div>

      </div>
    </div>
  );
};
