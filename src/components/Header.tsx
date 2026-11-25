/**
 * Application Header component adhering to Top Bar Contract
 * Author: S R Angadi
 */

import React from 'react';
import { BookOpen, FileText, CheckSquare, Printer, Layers } from 'lucide-react';

interface HeaderProps {
  activeTab: 'config' | 'sections' | 'preview' | 'explorer';
  setActiveTab: (tab: 'config' | 'sections' | 'preview' | 'explorer') => void;
  hasGeneratedPaper: boolean;
  onGenerateClick: () => void;
  totalMarks: number;
  totalQuestions: number;
}

export const Header: React.FC<HeaderProps> = ({
  activeTab,
  setActiveTab,
  hasGeneratedPaper,
  onGenerateClick,
  totalMarks,
  totalQuestions,
}) => {
  return (
    <header className="no-print sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-slate-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16 gap-4">
          
          {/* Zone 1: Brand Wordmark (Single text element) */}
          <div className="flex items-center gap-3 shrink-0">
            <div className="w-9 h-9 rounded-lg bg-indigo-600 text-white flex items-center justify-center shadow-sm">
              <BookOpen className="w-5 h-5" />
            </div>
            <div>
              <span className="text-base sm:text-lg font-bold tracking-tight text-slate-900 block leading-tight">
                ಪ್ರಶ್ನೆ ಪತ್ರಿಕೆ ರಚನಾ ಸಾಧನ
              </span>
              <span className="text-xs text-slate-500 font-medium tracking-wide">
                QUESTION PAPER GENERATOR · S R ANGADI
              </span>
            </div>
          </div>

          {/* Zone 2: Navigation Links */}
          <nav className="hidden md:flex items-center gap-1 sm:gap-2 text-sm font-medium">
            <button
              onClick={() => setActiveTab('config')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-colors whitespace-nowrap ${
                activeTab === 'config'
                  ? 'bg-slate-100 text-indigo-700 font-semibold'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
              }`}
            >
              <CheckSquare className="w-4 h-4" />
              <span>ವಿಷಯ ಆಯ್ಕೆ</span>
            </button>

            <button
              onClick={() => setActiveTab('sections')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-colors whitespace-nowrap ${
                activeTab === 'sections'
                  ? 'bg-slate-100 text-indigo-700 font-semibold'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
              }`}
            >
              <Layers className="w-4 h-4" />
              <span>ವಿಭಾಗ ರಚನೆ</span>
              {totalQuestions > 0 && (
                <span className="text-xs text-slate-500 ml-1">
                  ({totalQuestions} ಪ್ರಶ್ನೆ / {totalMarks} ಅಂಕ)
                </span>
              )}
            </button>

            <button
              onClick={() => setActiveTab('preview')}
              disabled={!hasGeneratedPaper}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-colors whitespace-nowrap ${
                activeTab === 'preview'
                  ? 'bg-slate-100 text-indigo-700 font-semibold'
                  : hasGeneratedPaper
                  ? 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                  : 'text-slate-300 cursor-not-allowed'
              }`}
            >
              <FileText className="w-4 h-4" />
              <span>ಪತ್ರಿಕೆ & ಕೀಲಿ ಉತ್ತರ</span>
            </button>

            <button
              onClick={() => setActiveTab('explorer')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-colors whitespace-nowrap ${
                activeTab === 'explorer'
                  ? 'bg-slate-100 text-indigo-700 font-semibold'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
              }`}
            >
              <BookOpen className="w-4 h-4" />
              <span>ಪ್ರಶ್ನೆ ಭಂಡಾರ</span>
            </button>
          </nav>

          {/* Zone 3: Primary Action */}
          <div className="flex items-center gap-3 shrink-0">
            {activeTab === 'preview' && hasGeneratedPaper ? (
              <button
                onClick={() => window.print()}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 active:bg-emerald-800 transition-colors shadow-sm whitespace-nowrap"
              >
                <Printer className="w-4 h-4" />
                <span>ಮುದ್ರಣ / Print</span>
              </button>
            ) : (
              <button
                onClick={onGenerateClick}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 active:bg-indigo-800 transition-colors shadow-sm whitespace-nowrap"
              >
                <FileText className="w-4 h-4" />
                <span>ಪ್ರಶ್ನೆ ಪತ್ರಿಕೆ ರಚಿಸಿ</span>
              </button>
            )}
          </div>

        </div>

        {/* Mobile Navigation bar */}
        <div className="flex md:hidden items-center justify-around py-2 border-t border-slate-100 text-xs">
          <button
            onClick={() => setActiveTab('config')}
            className={`py-1 px-2 rounded font-medium ${activeTab === 'config' ? 'text-indigo-600 font-bold' : 'text-slate-600'}`}
          >
            ವಿಷಯ ಆಯ್ಕೆ
          </button>
          <button
            onClick={() => setActiveTab('sections')}
            className={`py-1 px-2 rounded font-medium ${activeTab === 'sections' ? 'text-indigo-600 font-bold' : 'text-slate-600'}`}
          >
            ವಿಭಾಗಗಳು ({totalMarks} ಅಂಕ)
          </button>
          <button
            onClick={() => hasGeneratedPaper && setActiveTab('preview')}
            disabled={!hasGeneratedPaper}
            className={`py-1 px-2 rounded font-medium ${
              activeTab === 'preview'
                ? 'text-indigo-600 font-bold'
                : hasGeneratedPaper
                ? 'text-slate-600'
                : 'text-slate-300'
            }`}
          >
            ಪತ್ರಿಕೆ
          </button>
          <button
            onClick={() => setActiveTab('explorer')}
            className={`py-1 px-2 rounded font-medium ${activeTab === 'explorer' ? 'text-indigo-600 font-bold' : 'text-slate-600'}`}
          >
            ಪ್ರಶ್ನೆ ಭಂಡಾರ
          </button>
        </div>
      </div>
    </header>
  );
};
