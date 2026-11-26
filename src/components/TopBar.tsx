/**
 * Vibrant School-Greenery Top Navigation Bar (Strict 3-Zone Contract)
 * Role-aware:
 * - Pre-login: Home, Online Test, School Login CTA
 * - Teacher (School): Question Paper Setup, Blueprint, Online Test, Paper Preview (NO Explorer/JSON Creator/Image tools)
 * - Admin / Developer: Full studio including Question Bank & Class 6 Image Manager, AI JSON Creator, JSON Guide
 */

import React from 'react';
import { LogOut, ShieldCheck, BookOpen } from 'lucide-react';

export type AppViewMode =
  | 'home'
  | 'setup'
  | 'preview'
  | 'explorer'
  | 'blueprint'
  | 'ai_generator'
  | 'online_test';

interface TopBarProps {
  schoolName: string;
  userRole: 'teacher' | 'admin' | null;
  userEmail?: string;
  onLogout?: () => void;
  activeView: AppViewMode;
  setActiveView: (view: AppViewMode) => void;
  hasGeneratedPaper: boolean;
  onOpenJsonGuide?: () => void;
}

export const TopBar: React.FC<TopBarProps> = ({
  schoolName,
  userRole,
  onLogout,
  activeView,
  setActiveView,
  hasGeneratedPaper,
  onOpenJsonGuide,
}) => {
  const isLoggedIn = userRole !== null;
  const isAdmin = userRole === 'admin';

  return (
    <header className="no-print sticky top-0 z-40 w-full bg-gradient-to-r from-orange-600 via-amber-600 to-orange-700 text-white border-b border-orange-500/80 shadow-sm font-kannada">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4 sm:gap-6">
        {/* Zone 1: Single-line Brand Wordmark */}
        <button
          type="button"
          onClick={() => setActiveView(isLoggedIn ? 'setup' : 'home')}
          className="flex items-center gap-2 text-sm sm:text-base font-extrabold tracking-tight text-white hover:text-amber-100 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          <BookOpen className="w-5 h-5 text-amber-100 shrink-0" />
          <span>QP GENERATOR BY S R ANGADI</span>
        </button>

        {/* Zone 2: Clean Single-Line Text Navigation Links */}
        <nav
          aria-label="Primary Navigation"
          className="flex items-center gap-4 sm:gap-6 overflow-x-auto no-scrollbar py-1"
        >
          {!isLoggedIn ? (
            <>
              <button
                type="button"
                onClick={() => setActiveView('home')}
                className={`text-xs sm:text-sm font-semibold transition-colors whitespace-nowrap shrink-0 pb-0.5 cursor-pointer ${
                  activeView === 'home'
                    ? 'text-white font-extrabold border-b-2 border-white'
                    : 'text-orange-50/90 hover:text-white'
                }`}
              >
                ಮುಖಪುಟ
              </button>
              <button
                type="button"
                onClick={() => setActiveView('online_test')}
                className={`text-xs sm:text-sm font-semibold transition-colors whitespace-nowrap shrink-0 pb-0.5 cursor-pointer ${
                  activeView === 'online_test'
                    ? 'text-white font-extrabold border-b-2 border-white'
                    : 'text-orange-50/90 hover:text-white'
                }`}
              >
                ಆನ್‌ಲೈನ್ ಟೆಸ್ಟ್
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setActiveView('setup')}
                className={`text-xs sm:text-sm font-semibold transition-colors whitespace-nowrap shrink-0 pb-0.5 cursor-pointer ${
                  activeView === 'setup'
                    ? 'text-white font-extrabold border-b-2 border-white'
                    : 'text-orange-50/90 hover:text-white'
                }`}
              >
                ಪ್ರಶ್ನೆ ಪತ್ರಿಕೆ
              </button>

              <button
                type="button"
                onClick={() => setActiveView('blueprint')}
                className={`text-xs sm:text-sm font-semibold transition-colors whitespace-nowrap shrink-0 pb-0.5 cursor-pointer ${
                  activeView === 'blueprint'
                    ? 'text-white font-extrabold border-b-2 border-white'
                    : 'text-orange-50/90 hover:text-white'
                }`}
              >
                ನೀಲನಕಾಶೆ
              </button>

              <button
                type="button"
                onClick={() => setActiveView('online_test')}
                className={`text-xs sm:text-sm font-semibold transition-colors whitespace-nowrap shrink-0 pb-0.5 cursor-pointer ${
                  activeView === 'online_test'
                    ? 'text-white font-extrabold border-b-2 border-white'
                    : 'text-orange-50/90 hover:text-white'
                }`}
              >
                ಆನ್‌ಲೈನ್ ಟೆಸ್ಟ್
              </button>

              {hasGeneratedPaper && (
                <button
                  type="button"
                  onClick={() => setActiveView('preview')}
                  className={`text-xs sm:text-sm font-semibold transition-colors whitespace-nowrap shrink-0 pb-0.5 cursor-pointer ${
                    activeView === 'preview'
                      ? 'text-white font-extrabold border-b-2 border-white'
                      : 'text-orange-50/90 hover:text-white'
                  }`}
                >
                  ಪತ್ರಿಕೆ ಪ್ರಿವ್ಯೂ
                </button>
              )}

              {/* Admin / Developer Only Tools */}
              {isAdmin && (
                <>
                  <span className="h-4 w-px bg-orange-300/60 shrink-0" aria-hidden="true" />
                  <button
                    type="button"
                    onClick={() => setActiveView('explorer')}
                    className={`text-xs sm:text-sm font-semibold transition-colors whitespace-nowrap shrink-0 pb-0.5 cursor-pointer ${
                      activeView === 'explorer'
                        ? 'text-white font-extrabold border-b-2 border-white'
                        : 'text-orange-50/90 hover:text-white'
                    }`}
                  >
                    ಪ್ರಶ್ನೆ ಭಂಡಾರ &amp; ಚಿತ್ರ
                  </button>

                  <button
                    type="button"
                    onClick={() => setActiveView('ai_generator')}
                    className={`text-xs sm:text-sm font-semibold transition-colors whitespace-nowrap shrink-0 pb-0.5 cursor-pointer ${
                      activeView === 'ai_generator'
                        ? 'text-white font-extrabold border-b-2 border-white'
                        : 'text-orange-50/90 hover:text-white'
                    }`}
                  >
                    AI JSON ಕ್ರಿಯೇಟರ್
                  </button>

                  {onOpenJsonGuide && (
                    <button
                      type="button"
                      onClick={onOpenJsonGuide}
                      className="text-xs sm:text-sm font-semibold text-orange-50/90 hover:text-white transition-colors whitespace-nowrap shrink-0 pb-0.5 cursor-pointer"
                    >
                      JSON ಗೈಡ್
                    </button>
                  )}
                </>
              )}
            </>
          )}
        </nav>

        {/* Zone 3: Single Primary Action */}
        <div className="flex items-center gap-3 shrink-0">
          {!isLoggedIn ? (
            <button
              type="button"
              onClick={() => {
                setActiveView('home');
                window.setTimeout(() => {
                  document.getElementById('school-login-card')?.scrollIntoView({ behavior: 'smooth' });
                }, 50);
              }}
              className="px-4 py-2 rounded-xl text-xs font-extrabold text-orange-900 bg-white hover:bg-orange-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer shadow-xs"
            >
              ಶಾಲಾ ಲಾಗಿನ್
            </button>
          ) : (
            <div className="flex items-center gap-3">
              <div className="hidden lg:flex items-center gap-1.5 text-xs text-orange-50 max-w-[190px]">
                {isAdmin && <ShieldCheck className="w-3.5 h-3.5 text-amber-100 shrink-0" />}
                <span className="font-semibold truncate" title={schoolName}>
                  {isAdmin ? `Admin · ${schoolName}` : schoolName}
                </span>
              </div>
              <button
                type="button"
                onClick={onLogout}
                className="px-3.5 py-2 rounded-xl text-xs font-bold text-white bg-white/15 hover:bg-red-700 border border-white/30 hover:border-red-600 transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>ಲಾಗ್‌ಔಟ್</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
