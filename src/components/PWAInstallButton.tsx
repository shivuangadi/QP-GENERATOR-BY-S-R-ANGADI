import React, { useState } from 'react';
import {
  Download,
  Smartphone,
  Share,
  PlusSquare,
  MoreVertical,
  X,
  CheckCircle2,
  ExternalLink,
  Copy,
  Check,
  RefreshCw,
} from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall.ts';

interface PWAInstallButtonProps {
  variant?: 'header' | 'card';
}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({ variant = 'header' }) => {
  const { canNativeInstall, isInstalled, isIOS, isInIframe, install } = usePWAInstall();
  const [showHelpModal, setShowHelpModal] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  // Never show install CTA if already running as an installed standalone PWA
  if (isInstalled) return null;

  const appUrl = typeof window !== 'undefined' ? window.location.origin + '/' : '/';

  const handleClick = async () => {
    if (canNativeInstall) {
      const outcome = await install();
      if (outcome === 'accepted') return;
      if (outcome === 'unavailable') {
        setShowHelpModal(true);
      }
      return;
    }
    setShowHelpModal(true);
  };

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(appUrl);
      setCopiedLink(true);
      window.setTimeout(() => setCopiedLink(false), 2200);
    } catch {
      // ignore clipboard restrictions
    }
  };

  return (
    <>
      {variant === 'header' ? (
        <button
          type="button"
          onClick={handleClick}
          title="ಮೊಬೈಲ್ ಅಥವಾ ಕಂಪ್ಯೂಟರ್‌ನಲ್ಲಿ ಸ್ವತಂತ್ರ ಆಪ್ ಆಗಿ ಇನ್‌ಸ್ಟಾಲ್ ಮಾಡಿ (Install Standalone App)"
          className="px-2.5 sm:px-3 py-1.5 rounded-lg text-xs font-extrabold bg-emerald-500 hover:bg-emerald-400 text-white border border-emerald-300/60 shadow-xs transition-all flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
        >
          <Download className="w-3.5 h-3.5 shrink-0" />
          <span>ಆಪ್ ಇನ್‌ಸ್ಟಾಲ್</span>
        </button>
      ) : (
        <button
          type="button"
          onClick={handleClick}
          className="px-4 py-2.5 rounded-xl text-xs sm:text-sm font-extrabold bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white shadow-md transition-all inline-flex items-center gap-2 cursor-pointer whitespace-nowrap shrink-0"
        >
          <Smartphone className="w-4 h-4 shrink-0" />
          <span>ಸ್ವತಂತ್ರ ಆಪ್ ಆಗಿ ಇನ್‌ಸ್ಟಾಲ್ ಮಾಡಿ (Install App)</span>
        </button>
      )}

      {showHelpModal && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/65 backdrop-blur-xs flex items-center justify-center p-4 font-kannada"
          onClick={() => setShowHelpModal(false)}
        >
          <div
            className="bg-white rounded-2xl border border-orange-200 shadow-2xl max-w-md w-full overflow-hidden text-left"
            onClick={e => e.stopPropagation()}
          >
            <div className="bg-gradient-to-r from-orange-600 via-amber-500 to-orange-600 px-5 py-4 flex items-center justify-between text-white">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-white/20 flex items-center justify-center shrink-0">
                  <Smartphone className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h3 className="text-sm font-black">ಸ್ವತಂತ್ರ ಆಪ್ ಇನ್‌ಸ್ಟಾಲ್ ಮಾಡಿ</h3>
                  <p className="text-[11px] text-orange-100">QP GENERATOR BY S R ANGADI</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowHelpModal(false)}
                className="p-1.5 rounded-lg bg-white/15 hover:bg-white/25 text-white cursor-pointer"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4 text-xs sm:text-sm text-slate-700">
              {isInIframe ? (
                <div className="space-y-3.5">
                  <div className="bg-amber-50 border border-amber-300 rounded-xl p-3.5 text-amber-950 text-xs leading-relaxed">
                    <p className="font-bold mb-1">
                      ಪ್ರಿವ್ಯೂ ವಿಂಡೋ ಒಳಗಿನಿಂದ ನೇರ ಇನ್‌ಸ್ಟಾಲ್ ಮಾಡಲು ಬ್ರೌಸರ್ ಅನುಮತಿಸುವುದಿಲ್ಲ
                    </p>
                    <p>
                      ಕೆಳಗಿನ ಬಟನ್ ಒತ್ತಿ ಈ ಆಪ್ ಅನ್ನು ನೇರವಾಗಿ <strong>Chrome / Edge ಹೊಸ ಟ್ಯಾಬ್‌ನಲ್ಲಿ</strong> ತೆರೆಯಿರಿ — ಅಲ್ಲಿ <strong>"ಆಪ್ ಇನ್‌ಸ್ಟಾಲ್"</strong> ಒತ್ತಿದ ತಕ್ಷಣ ಆಪ್ ಇನ್‌ಸ್ಟಾಲ್ ಆಗುತ್ತದೆ!
                    </p>
                  </div>

                  <div className="flex flex-col gap-2">
                    <a
                      href={appUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white text-xs sm:text-sm font-extrabold flex items-center justify-center gap-2 shadow-sm transition-all"
                    >
                      <ExternalLink className="w-4 h-4 shrink-0" />
                      <span>ಹೊಸ ಬ್ರೌಸರ್ ಟ್ಯಾಬ್‌ನಲ್ಲಿ ತೆರೆದು ಇನ್‌ಸ್ಟಾಲ್ ಮಾಡಿ</span>
                    </a>

                    <button
                      type="button"
                      onClick={handleCopyLink}
                      className="w-full py-2 px-4 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
                    >
                      {copiedLink ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-emerald-600" />
                          <span>ಆಪ್ ಲಿಂಕ್ ಕಾಪಿ ಆಗಿದೆ! Chrome ನಲ್ಲಿ ಪೇಸ್ಟ್ ಮಾಡಿ</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5" />
                          <span>ಆಪ್ ಲಿಂಕ್ ಕಾಪಿ ಮಾಡಿ (Copy App Link)</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              ) : isIOS ? (
                <>
                  <p className="font-semibold text-slate-800 leading-relaxed">
                    iPhone / iPad ನಲ್ಲಿ ಈ ಆಪ್ ಅನ್ನು ಹೋಂ ಸ್ಕ್ರೀನ್‌ಗೆ ಸೇರಿಸಿ:
                  </p>
                  <ol className="space-y-3 bg-orange-50/70 border border-orange-200 rounded-xl p-4">
                    <li className="flex items-start gap-2.5">
                      <span className="w-6 h-6 rounded-full bg-orange-600 text-white font-bold text-xs flex items-center justify-center shrink-0">
                        1
                      </span>
                      <span>
                        Safari ಬ್ರೌಸರ್‌ನ ಕೆಳಭಾಗದಲ್ಲಿರುವ <Share className="inline w-4 h-4 text-orange-700 mx-0.5" /> <strong>Share</strong> ಬಟನ್ ಒತ್ತಿ.
                      </span>
                    </li>
                    <li className="flex items-start gap-2.5">
                      <span className="w-6 h-6 rounded-full bg-orange-600 text-white font-bold text-xs flex items-center justify-center shrink-0">
                        2
                      </span>
                      <span>
                        ಕೆಳಗೆ ಸ್ಕ್ರಾಲ್ ಮಾಡಿ <PlusSquare className="inline w-4 h-4 text-orange-700 mx-0.5" /> <strong>&quot;Add to Home Screen&quot;</strong> ಆಯ್ಕೆಮಾಡಿ.
                      </span>
                    </li>
                    <li className="flex items-start gap-2.5">
                      <span className="w-6 h-6 rounded-full bg-emerald-600 text-white font-bold text-xs flex items-center justify-center shrink-0">
                        3
                      </span>
                      <span>
                        ಮೇಲ್ಭಾಗದಲ್ಲಿರುವ <strong>&quot;Add&quot;</strong> ಬಟನ್ ಒತ್ತಿ — ಆಪ್ ಐಕಾನ್ ನಿಮ್ಮ ಹೋಂ ಸ್ಕ್ರೀನ್‌ನಲ್ಲಿ ಕಾಣಿಸುತ್ತದೆ!
                      </span>
                    </li>
                  </ol>
                </>
              ) : (
                <>
                  <p className="font-semibold text-slate-800 leading-relaxed">
                    ಈ ವೆಬ್ ಅಪ್ಲಿಕೇಶನ್ ಅನ್ನು ನಿಮ್ಮ ಮೊಬೈಲ್ ಹೋಂ ಸ್ಕ್ರೀನ್ ಅಥವಾ ಕಂಪ್ಯೂಟರ್‌ನಲ್ಲಿ ಸ್ವತಂತ್ರ ಆಪ್ (Standalone App) ಆಗಿ ಇನ್‌ಸ್ಟಾಲ್ ಮಾಡಿ:
                  </p>
                  <ol className="space-y-3 bg-emerald-50/70 border border-emerald-200 rounded-xl p-4">
                    <li className="flex items-start gap-2.5">
                      <span className="w-6 h-6 rounded-full bg-emerald-600 text-white font-bold text-xs flex items-center justify-center shrink-0">
                        1
                      </span>
                      <span>
                        ಬ್ರೌಸರ್ ಅಡ್ರೆಸ್ ಬಾರ್‌ನ ಬಲಭಾಗದಲ್ಲಿರುವ <strong>Install (⊕ / ⬇)</strong> ಐಕಾನ್ ಅಥವಾ <MoreVertical className="inline w-4 h-4 text-emerald-700 mx-0.5" /> <strong>ಮೆನು (3 ಚುಕ್ಕೆಗಳು)</strong> ಒತ್ತಿ.
                      </span>
                    </li>
                    <li className="flex items-start gap-2.5">
                      <span className="w-6 h-6 rounded-full bg-orange-600 text-white font-bold text-xs flex items-center justify-center shrink-0">
                        2
                      </span>
                      <span>
                        <strong>&quot;Install App / Add to Home Screen&quot;</strong> ಆಯ್ಕೆಮಾಡಿ — ಪೂರ್ಣ ಪ್ರಮಾಣದ ಆಪ್ ಆಗಿ ಇನ್‌ಸ್ಟಾಲ್ ಆಗುತ್ತದೆ!
                      </span>
                    </li>
                  </ol>
                  <button
                    type="button"
                    onClick={() => window.location.reload()}
                    className="w-full py-2 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>ಪುಟವನ್ನು ರಿಫ್ರೆಶ್ ಮಾಡಿ ಇನ್‌ಸ್ಟಾಲ್ ಪಾಪ್-ಅಪ್ ಸಕ್ರಿಯಗೊಳಿಸಿ</span>
                  </button>
                </>
              )}

              <div className="flex items-center justify-between gap-2 pt-1">
                <span className="text-[11px] text-emerald-700 font-bold flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                  <span>PWA Standalone ಬೆಂಬಲ ಸಕ್ರಿಯವಾಗಿದೆ</span>
                </span>
                <button
                  type="button"
                  onClick={() => setShowHelpModal(false)}
                  className="px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold cursor-pointer"
                >
                  ಸರಿ (OK)
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
