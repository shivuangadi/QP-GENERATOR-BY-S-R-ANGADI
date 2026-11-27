import React, { useState, useEffect } from 'react';
import { WifiOff } from 'lucide-react';

export const OfflineIndicator: React.FC = () => {
  const [isOffline, setIsOffline] = useState<boolean>(() =>
    typeof navigator !== 'undefined' ? !navigator.onLine : false
  );

  useEffect(() => {
    const goOffline = () => setIsOffline(true);
    const goOnline = () => setIsOffline(false);
    window.addEventListener('offline', goOffline);
    window.addEventListener('online', goOnline);
    return () => {
      window.removeEventListener('offline', goOffline);
      window.removeEventListener('online', goOnline);
    };
  }, []);

  if (!isOffline) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="no-print fixed bottom-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-xl bg-amber-900 text-amber-50 border border-amber-400/50 shadow-lg text-xs font-bold flex items-center gap-2 font-kannada"
    >
      <WifiOff className="w-4 h-4 text-amber-300 shrink-0" />
      <span>ನೀವು ಆಫ್‌ಲೈನ್‌ನಲ್ಲಿದ್ದೀರಿ — ಉಳಿಸಿದ ಪ್ರಶ್ನೆ ಭಂಡಾರಗಳು ಇನ್ನೂ ಲಭ್ಯವಿವೆ</span>
    </div>
  );
};
