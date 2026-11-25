/**
 * Top Navbar component matching the user's reference screenshot
 * Author: M I Nilaji / S R Angadi
 */

import React from 'react';
import { School, Power, Calendar, BookOpen } from 'lucide-react';

interface TopBarProps {
  schoolName: string;
  subjectsSummary?: string;
  validityDate?: string;
  onLogout?: () => void;
  activeView: 'setup' | 'preview' | 'explorer' | 'blueprint' | 'ai_generator' | 'online_test';
  setActiveView: (view: 'setup' | 'preview' | 'explorer' | 'blueprint' | 'ai_generator' | 'online_test') => void;
  hasGeneratedPaper: boolean;
  onOpenJsonGuide?: () => void;
}

export const TopBar: React.FC<TopBarProps> = ({
  schoolName,
  subjectsSummary = 'ಕನ್ನಡ, English, ಹಿಂದಿ, ಗಣಿತ, ವಿಜ್ಞಾನ, ಸಮಾಜ ವಿಜ್ಞಾನ, EVS (ಪರಿಸರ)',
  validityDate = '2026-11-02',
  onLogout,
  activeView,
  setActiveView,
  hasGeneratedPaper,
  onOpenJsonGuide,
}) => {
  return (
    <div className="no-print w-full px-4 sm:px-6 lg:px-8 pt-4 pb-2">
      <header className="w-full bg-[#181c3d] text-white rounded-2xl shadow-lg border border-slate-700/40 px-4 sm:px-6 py-3.5 flex flex-wrap items-center justify-between gap-4">
        
        {/* Left: School brand lockup */}
        <div className="flex items-center gap-3.5 cursor-pointer" onClick={() => setActiveView('setup')}>
          <div className="w-10 h-10 rounded-xl bg-indigo-600 text-white flex items-center justify-center shadow-md shrink-0">
            <School className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-base sm:text-lg font-black tracking-wide text-white">
                M I NILAJI
              </span>
              <span className="px-2 py-0.5 text-2xs font-bold rounded-full border border-indigo-400/60 bg-indigo-950/60 text-indigo-200">
                ಶಾಲಾ ಲಾಗಿನ್
              </span>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-slate-300 font-medium mt-0.5">
              <span>🏰</span>
              <span className="tracking-wide uppercase font-semibold">{schoolName}</span>
            </div>
          </div>
        </div>

        {/* Center: Subjects summary tag & View Nav */}
        <div className="flex items-center flex-wrap gap-2">
          {/* Quick tab switcher */}
          <div className="flex items-center gap-1 bg-white/10 p-1 rounded-xl text-xs font-semibold">
            <button
              onClick={() => setActiveView('setup')}
              className={`px-2.5 py-1 rounded-lg transition-all ${
                activeView === 'setup' ? 'bg-indigo-600 text-white shadow-xs' : 'text-slate-300 hover:text-white'
              }`}
            >
              ಸೆಟಪ್
            </button>
            <button
              onClick={() => setActiveView('ai_generator')}
              className={`px-2.5 py-1 rounded-lg transition-all flex items-center gap-1 font-bold ${
                activeView === 'ai_generator'
                  ? 'bg-linear-to-r from-purple-600 to-indigo-600 text-white shadow-xs'
                  : 'text-purple-300 hover:text-white'
              }`}
            >
              <span>🤖</span>
              <span>AI JSON ಜನರೇಟರ್</span>
            </button>
            <button
              onClick={() => setActiveView('blueprint')}
              className={`px-2.5 py-1 rounded-lg transition-all flex items-center gap-1 ${
                activeView === 'blueprint' ? 'bg-indigo-600 text-white shadow-xs' : 'text-slate-300 hover:text-white'
              }`}
            >
              <span>📊</span>
              <span>ನೀಲನಕಾಶೆ</span>
            </button>
            {onOpenJsonGuide && (
              <button
                onClick={onOpenJsonGuide}
                className="px-2.5 py-1 rounded-lg text-amber-300 hover:text-white hover:bg-white/10 transition-all flex items-center gap-1"
              >
                <span>📘</span>
                <span>JSON ಗೈಡ್</span>
              </button>
            )}
            <button
              onClick={() => setActiveView('explorer')}
              className={`px-2.5 py-1 rounded-lg transition-all whitespace-nowrap shrink-0 ${
                activeView === 'explorer' ? 'bg-indigo-600 text-white shadow-xs' : 'text-slate-300 hover:text-white'
              }`}
            >
              ಪ್ರಶ್ನೆ ಭಂಡಾರ
            </button>
            <button
              onClick={() => setActiveView('online_test')}
              className={`px-2.5 py-1 rounded-lg transition-all font-bold whitespace-nowrap shrink-0 ${
                activeView === 'online_test'
                  ? 'bg-emerald-600 text-white shadow-xs'
                  : 'text-emerald-300 hover:text-white hover:bg-white/10'
              }`}
            >
              ಆನ್‌ಲೈನ್ ಟೆಸ್ಟ್
            </button>
            {hasGeneratedPaper && (
              <button
                onClick={() => setActiveView('preview')}
                className={`px-2.5 py-1 rounded-lg transition-all whitespace-nowrap shrink-0 ${
                  activeView === 'preview' ? 'bg-emerald-600 text-white shadow-xs' : 'text-emerald-300 hover:text-white'
                }`}
              >
                📄 ಪತ್ರಿಕೆ
              </button>
            )}
          </div>
        </div>

        {/* Right: Validity Date & Logout */}
        <div className="flex items-center gap-3 shrink-0 ml-auto sm:ml-0">
          <div className="hidden sm:flex items-center gap-1.5 bg-white/10 px-3 py-1.5 rounded-xl text-xs font-medium text-slate-200 border border-white/5">
            <Calendar className="w-3.5 h-3.5 text-indigo-300" />
            <span>ಮಾನ್ಯತೆ: <strong>{validityDate}</strong></span>
          </div>

          <button
            type="button"
            onClick={onLogout || (() => setActiveView('setup'))}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-bold text-white bg-[#e11d48] hover:bg-[#be123c] active:bg-[#9f1239] transition-all shadow-sm"
          >
            <Power className="w-3.5 h-3.5" />
            <span>Logout</span>
          </button>
        </div>

      </header>
    </div>
  );
};
