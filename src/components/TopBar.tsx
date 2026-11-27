/**
 * Saffron / Warm-Amber Top Navigation Banner
 * Always-visible wrapped navigation strip — ZERO hidden items, ZERO horizontal scrolling required.
 * Role-aware:
 * - Pre-login: Home, Online Test, School Login CTA
 * - Teacher (School): Question Paper Setup, Online Test, Paper Preview
 * - Admin / Developer: Full studio including Question Paper, Online Test, Paper Preview,
 *   Question Bank & Images, AI JSON Creator, and JSON Guide — all visible at once.
 */

import React from 'react';
import {
  LogOut,
  ShieldCheck,
  BookOpen,
  Home,
  FileText,
  ClipboardCheck,
  Eye,
  Database,
  Sparkles,
  BookMarked,
} from 'lucide-react';
import { PWAInstallButton } from './PWAInstallButton.tsx';

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

  const navBtnClass = (isActive: boolean) =>
    `inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs sm:text-[13px] transition-all cursor-pointer whitespace-nowrap ${
      isActive
        ? 'bg-white text-orange-800 font-extrabold shadow-xs ring-1 ring-white'
        : 'bg-white/12 hover:bg-white/22 text-white font-semibold border border-white/20'
    }`;

  return (
    <header className="no-print sticky top-0 z-40 w-full bg-gradient-to-r from-orange-600 via-amber-600 to-orange-700 text-white border-b border-orange-500/80 shadow-md font-kannada">
      {/* Row 1: Brand Wordmark + Install App + School / Admin Auth Controls */}
      <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-2.5 flex flex-wrap items-center justify-between gap-2.5 border-b border-white/15">
        <button
          type="button"
          onClick={() => setActiveView(isLoggedIn ? 'setup' : 'home')}
          className="flex items-center gap-2 text-sm sm:text-base font-extrabold tracking-tight text-white hover:text-amber-100 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          <BookOpen className="w-5 h-5 text-amber-100 shrink-0" />
          <span>QP GENERATOR BY S R ANGADI</span>
        </button>

        <div className="flex items-center gap-2 sm:gap-3 shrink-0 ml-auto">
          {isLoggedIn && (
            <div className="hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-black/15 border border-white/15 text-xs text-orange-50 max-w-[220px]">
              {isAdmin && <ShieldCheck className="w-3.5 h-3.5 text-amber-200 shrink-0" />}
              <span className="font-semibold truncate" title={schoolName}>
                {isAdmin ? `Admin · ${schoolName}` : schoolName}
              </span>
            </div>
          )}

          <PWAInstallButton variant="header" />

          {!isLoggedIn ? (
            <button
              type="button"
              onClick={() => {
                setActiveView('home');
                window.setTimeout(() => {
                  document.getElementById('school-login-card')?.scrollIntoView({ behavior: 'smooth' });
                }, 50);
              }}
              className="px-3.5 py-1.5 rounded-lg text-xs font-extrabold text-orange-900 bg-white hover:bg-orange-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer shadow-xs"
            >
              ಶಾಲಾ ಲಾಗಿನ್
            </button>
          ) : (
            <button
              type="button"
              onClick={onLogout}
              className="px-3 py-1.5 rounded-lg text-xs font-bold text-white bg-white/15 hover:bg-red-700 border border-white/30 hover:border-red-600 transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>ಲಾಗ್‌ಔಟ್</span>
            </button>
          )}
        </div>
      </div>

      {/* Row 2: Full-Width Always-Visible Navigation Bar (Wraps cleanly — zero hidden options, zero horizontal scroll) */}
      <div className="bg-black/10">
        <nav
          aria-label="Primary Navigation"
          className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-2 flex flex-wrap items-center gap-1.5 sm:gap-2"
        >
          {!isLoggedIn ? (
            <>
              <button
                type="button"
                onClick={() => setActiveView('home')}
                className={navBtnClass(activeView === 'home')}
              >
                <Home className="w-3.5 h-3.5 shrink-0" />
                <span>ಮುಖಪುಟ</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveView('online_test')}
                className={navBtnClass(activeView === 'online_test')}
              >
                <ClipboardCheck className="w-3.5 h-3.5 shrink-0" />
                <span>ಆನ್‌ಲೈನ್ ಟೆಸ್ಟ್</span>
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setActiveView('setup')}
                className={navBtnClass(activeView === 'setup')}
              >
                <FileText className="w-3.5 h-3.5 shrink-0" />
                <span>ಪ್ರಶ್ನೆ ಪತ್ರಿಕೆ</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveView('online_test')}
                className={navBtnClass(activeView === 'online_test')}
              >
                <ClipboardCheck className="w-3.5 h-3.5 shrink-0" />
                <span>ಆನ್‌ಲೈನ್ ಟೆಸ್ಟ್</span>
              </button>

              {hasGeneratedPaper && (
                <button
                  type="button"
                  onClick={() => setActiveView('preview')}
                  className={navBtnClass(activeView === 'preview')}
                >
                  <Eye className="w-3.5 h-3.5 shrink-0" />
                  <span>ಪತ್ರಿಕೆ ಪ್ರಿವ್ಯೂ</span>
                </button>
              )}

              {/* Admin / Developer Tools — Always visible without scrolling */}
              {isAdmin && (
                <>
                  <button
                    type="button"
                    onClick={() => setActiveView('explorer')}
                    className={navBtnClass(activeView === 'explorer')}
                  >
                    <Database className="w-3.5 h-3.5 shrink-0" />
                    <span>ಪ್ರಶ್ನೆ ಭಂಡಾರ &amp; ಚಿತ್ರ</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setActiveView('ai_generator')}
                    className={navBtnClass(activeView === 'ai_generator')}
                  >
                    <Sparkles className="w-3.5 h-3.5 shrink-0" />
                    <span>AI JSON ಕ್ರಿಯೇಟರ್</span>
                  </button>

                  {onOpenJsonGuide && (
                    <button
                      type="button"
                      onClick={onOpenJsonGuide}
                      className={navBtnClass(false)}
                    >
                      <BookMarked className="w-3.5 h-3.5 shrink-0" />
                      <span>JSON ಗೈಡ್</span>
                    </button>
                  )}
                </>
              )}
            </>
          )}
        </nav>
      </div>
    </header>
  );
};
