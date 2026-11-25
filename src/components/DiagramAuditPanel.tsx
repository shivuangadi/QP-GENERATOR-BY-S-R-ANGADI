/**
 * Diagram Audit & Chapter-wise Image Upload Tracker Panel
 * Provides:
 *  1. Summary KPI strip (Total Questions · Image Needed · Uploaded · Pending Upload)
 *  2. 4-mode interactive segmented image filter (All | Pending Images | Uploaded | All Diagram Qs)
 *  3. Chapter-wise / Unit-wise image upload counter table showing exact pending counts per unit
 *  4. Permanently Saved PDF Vault selector & 1-click upload so PDFs never need re-uploading
 */

import React, { useState } from 'react';
import {
  Image as ImageIcon,
  CheckCircle2,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  FileText,
  Upload,
  RefreshCw,
  Filter,
} from 'lucide-react';
import { BankImageAudit, ImageFilterMode } from '../utils/diagramDetector.ts';
import { SavedPdfEntry } from '../services/pdfVault.ts';

interface DiagramAuditPanelProps {
  audit: BankImageAudit;
  imageFilter: ImageFilterMode;
  onChangeImageFilter: (mode: ImageFilterMode) => void;
  selectedChapterId: string;
  onSelectChapterAndFilter: (chapterId: string, mode: ImageFilterMode) => void;
  // Persistent PDF Vault integration
  savedPdfs: SavedPdfEntry[];
  activePdfId?: string | null;
  activePdfName?: string;
  hasActivePdfBuffer: boolean;
  isLoadingPdf?: boolean;
  onSelectSavedPdf: (pdf: SavedPdfEntry) => Promise<void> | void;
  onUploadNewPdf?: (file: File) => Promise<void> | void;
  defaultExpandedTable?: boolean;
}

export const DiagramAuditPanel: React.FC<DiagramAuditPanelProps> = ({
  audit,
  imageFilter,
  onChangeImageFilter,
  selectedChapterId,
  onSelectChapterAndFilter,
  savedPdfs,
  activePdfId,
  activePdfName,
  hasActivePdfBuffer,
  isLoadingPdf = false,
  onSelectSavedPdf,
  onUploadNewPdf,
  defaultExpandedTable = true,
}) => {
  const [showChapterTable, setShowChapterTable] = useState<boolean>(defaultExpandedTable);
  const [onlyChaptersWithDiagrams, setOnlyChaptersWithDiagrams] = useState<boolean>(false);

  const availableBinaryPdfs = savedPdfs.filter(p => p.hasLocalCache || p.hasServerFile);
  const displayedChapters = onlyChaptersWithDiagrams
    ? audit.chapters.filter(c => c.neededTotal > 0)
    : audit.chapters;

  const overallPercent =
    audit.totalNeeded > 0 ? Math.round((audit.totalUploaded / audit.totalNeeded) * 100) : 100;

  return (
    <section className="bg-white rounded-2xl border border-slate-200 overflow-hidden font-kannada">
      {/* Top Bar: Title + Filter Segmented Controls */}
      <div className="px-5 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
            <ImageIcon className="w-4 h-4 text-indigo-600 shrink-0" />
            <span>ಘಟಕವಾರು ಚಿತ್ರ ಅಪ್ಲೋಡ್ ನಿರ್ವಹಣೆ (Unit-wise Image Upload Hub)</span>
          </h3>
          <p className="text-xs text-slate-500 mt-0.5 tabular-nums">
            ಒಟ್ಟು {audit.totalQuestions} ಪ್ರಶ್ನೆಗಳಲ್ಲಿ {audit.totalNeeded} ಪ್ರಶ್ನೆಗಳಿಗೆ ಚಿತ್ರ ಗುರುತಿಸಲಾಗಿದೆ ·{' '}
            <span className="font-semibold text-emerald-700">{audit.totalUploaded} ಅಪ್ಲೋಡ್ ಆಗಿದೆ</span> ·{' '}
            <span className={audit.totalPending > 0 ? 'font-bold text-amber-700' : 'text-slate-600'}>
              {audit.totalPending} ಬಾಕಿ ಇವೆ
            </span>
          </p>
        </div>

        {/* Interactive Segmented Filter Bar */}
        <div
          className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-xl border border-slate-200/80 text-xs"
          role="group"
          aria-label="ಚಿತ್ರ ಫಿಲ್ಟರ್"
        >
          <button
            type="button"
            onClick={() => onChangeImageFilter('all')}
            className={`px-3 py-1.5 rounded-lg font-semibold transition-colors cursor-pointer whitespace-nowrap tabular-nums ${
              imageFilter === 'all'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            ಎಲ್ಲಾ ({audit.totalQuestions})
          </button>
          <button
            type="button"
            onClick={() => onChangeImageFilter('pending')}
            className={`px-3 py-1.5 rounded-lg font-semibold transition-colors cursor-pointer whitespace-nowrap tabular-nums flex items-center gap-1.5 ${
              imageFilter === 'pending'
                ? 'bg-amber-600 text-white shadow-xs'
                : 'text-amber-800 hover:bg-amber-50'
            }`}
          >
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            <span>ಚಿತ್ರ ಅಪ್ಲೋಡ್ ಬಾಕಿ ({audit.totalPending})</span>
          </button>
          <button
            type="button"
            onClick={() => onChangeImageFilter('uploaded')}
            className={`px-3 py-1.5 rounded-lg font-semibold transition-colors cursor-pointer whitespace-nowrap tabular-nums flex items-center gap-1.5 ${
              imageFilter === 'uploaded'
                ? 'bg-emerald-600 text-white shadow-xs'
                : 'text-emerald-800 hover:bg-emerald-50'
            }`}
          >
            <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
            <span>ಅಪ್ಲೋಡ್ ಆಗಿದೆ ({audit.totalUploaded})</span>
          </button>
          <button
            type="button"
            onClick={() => onChangeImageFilter('all_diagram')}
            className={`px-3 py-1.5 rounded-lg font-semibold transition-colors cursor-pointer whitespace-nowrap tabular-nums ${
              imageFilter === 'all_diagram'
                ? 'bg-indigo-600 text-white shadow-xs'
                : 'text-indigo-800 hover:bg-indigo-50'
            }`}
          >
            ಎಲ್ಲಾ ಚಿತ್ರ ಪ್ರಶ್ನೆಗಳು ({audit.totalNeeded})
          </button>
        </div>
      </div>

      {/* 4-Column Summary KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 divide-y lg:divide-y-0 lg:divide-x divide-slate-200 border-b border-slate-200 bg-slate-50/60">
        <div className="px-5 py-3">
          <div className="text-2xs font-semibold text-slate-500">ಒಟ್ಟು ಪ್ರಶ್ನೆಗಳು</div>
          <div className="text-xl font-bold text-slate-900 tabular-nums mt-0.5">
            {audit.totalQuestions}
          </div>
          <div className="text-3xs text-slate-500 tabular-nums">
            {audit.chapters.length} ಘಟಕಗಳು / ಅಧ್ಯಾಯಗಳು
          </div>
        </div>

        <div className="px-5 py-3">
          <div className="text-2xs font-semibold text-slate-500">ಚಿತ್ರ ಅಗತ್ಯವಿರುವ ಪ್ರಶ್ನೆಗಳು</div>
          <div className="text-xl font-bold text-indigo-700 tabular-nums mt-0.5">
            {audit.totalNeeded}
          </div>
          <div className="text-3xs text-slate-500">ಸ್ವಯಂ ಗುರುತಿಸಿದ + ಅಪ್ಲೋಡ್ ಆದವು</div>
        </div>

        <div className="px-5 py-3">
          <div className="text-2xs font-semibold text-emerald-700">ಚಿತ್ರ ಅಪ್ಲೋಡ್ ಪೂರ್ಣಗೊಂಡಿದೆ</div>
          <div className="text-xl font-bold text-emerald-700 tabular-nums mt-0.5">
            {audit.totalUploaded}
          </div>
          <div className="text-3xs text-slate-500 tabular-nums">
            ಪೂರ್ಣ ಪ್ರಗತಿ: {overallPercent}%
          </div>
        </div>

        <button
          type="button"
          onClick={() => onSelectChapterAndFilter('all', 'pending')}
          className="px-5 py-3 text-left hover:bg-amber-50/70 transition-colors cursor-pointer"
          title="ಚಿತ್ರ ಅಪ್ಲೋಡ್ ಬಾಕಿ ಇರುವ ಎಲ್ಲಾ ಪ್ರಶ್ನೆಗಳನ್ನು ಒಂದೆಡೆ ನೋಡಿ"
        >
          <div className="text-2xs font-semibold text-amber-800">ಅಪ್ಲೋಡ್ ಬಾಕಿ ಇರುವ ಚಿತ್ರಗಳು</div>
          <div className="text-xl font-bold text-amber-700 tabular-nums mt-0.5">
            {audit.totalPending}
          </div>
          <div className="text-3xs text-amber-800 font-medium">
            {audit.totalPending > 0 ? 'ಕ್ಲಿಕ್ ಮಾಡಿ ಬಾಕಿ ಪ್ರಶ್ನೆ ನೋಡಿ →' : 'ಎಲ್ಲಾ ಚಿತ್ರಗಳು ಪೂರ್ಣಗೊಂಡಿವೆ'}
          </div>
        </button>
      </div>

      {/* Permanently Saved PDF Vault Linker Strip */}
      <div className="px-5 py-3 border-b border-slate-200 bg-white flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-2 min-w-0">
          <FileText className="w-4 h-4 text-indigo-600 shrink-0" />
          <div className="min-w-0">
            <span className="font-semibold text-slate-700">PDF ಮೂಲ ಫೈಲ್ (ಕ್ರಾಪ್ ಮಾಡಲು): </span>
            {isLoadingPdf ? (
              <span className="text-indigo-700 font-semibold inline-flex items-center gap-1">
                <RefreshCw className="w-3 h-3 animate-spin" />
                <span>ಉಳಿಸಿದ PDF ಲೋಡ್ ಆಗುತ್ತಿದೆ...</span>
              </span>
            ) : hasActivePdfBuffer ? (
              <span className="font-bold text-emerald-800 truncate">
                {activePdfName || 'PDF ಲೋಡ್ ಆಗಿದೆ'} · ಶಾಶ್ವತವಾಗಿ ಉಳಿಸಲಾಗಿದೆ (ಮತ್ತೆ ಅಪ್ಲೋಡ್ ಬೇಕಾಗಿಲ್ಲ)
              </span>
            ) : (
              <span className="text-slate-500">
                ಯಾವುದೇ PDF ಜೋಡಿಸಿಲ್ಲ — ಕೆಳಗಿನ ಉಳಿಸಿದ PDF ಆಯ್ಕೆಮಾಡಿ ಅಥವಾ ಒಮ್ಮೆ ಅಪ್ಲೋಡ್ ಮಾಡಿ
              </span>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {availableBinaryPdfs.length > 0 && (
            <select
              value={activePdfId || ''}
              onChange={e => {
                const found = availableBinaryPdfs.find(p => p.id === e.target.value);
                if (found) onSelectSavedPdf(found);
              }}
              className="bg-slate-50 border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-slate-800 max-w-[260px] truncate cursor-pointer focus:outline-hidden focus:ring-1 focus:ring-indigo-600"
              aria-label="ಉಳಿಸಿದ PDF ಆಯ್ಕೆಮಾಡಿ"
            >
              <option value="">
                -- ಉಳಿಸಿದ PDF ಆಯ್ಕೆಮಾಡಿ ({availableBinaryPdfs.length}) --
              </option>
              {availableBinaryPdfs.map(pdf => (
                <option key={pdf.id} value={pdf.id}>
                  {pdf.fileName} {pdf.totalPages > 0 ? `(${pdf.totalPages} ಪುಟ)` : ''}
                </option>
              ))}
            </select>
          )}

          {onUploadNewPdf && (
            <label className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap transition-colors">
              <Upload className="w-3.5 h-3.5" />
              <span>{hasActivePdfBuffer ? 'ಬೇರೆ PDF ಸೇವ್ ಮಾಡಿ' : 'PDF ಒಮ್ಮೆ ಅಪ್ಲೋಡ್ & ಸೇವ್ ಮಾಡಿ'}</span>
              <input
                type="file"
                accept=".pdf,application/pdf"
                className="hidden"
                onChange={e => {
                  const file = e.target.files?.[0];
                  if (file) onUploadNewPdf(file);
                  e.target.value = '';
                }}
              />
            </label>
          )}
        </div>
      </div>

      {/* Chapter-wise / Unit-wise Image Upload Breakdown Toggle & Table */}
      <div className="px-5 py-2.5 bg-slate-50/40 flex flex-wrap items-center justify-between gap-2 border-b border-slate-100">
        <button
          type="button"
          onClick={() => setShowChapterTable(prev => !prev)}
          className="text-xs font-bold text-slate-800 hover:text-indigo-700 flex items-center gap-1.5 cursor-pointer"
        >
          {showChapterTable ? (
            <ChevronUp className="w-4 h-4 text-slate-500" />
          ) : (
            <ChevronDown className="w-4 h-4 text-slate-500" />
          )}
          <span>ಘಟಕವಾರು ಚಿತ್ರ ಅಪ್ಲೋಡ್ ಲೆಕ್ಕ (Chapter-wise Pending Image Count)</span>
        </button>

        {showChapterTable && (
          <div className="flex items-center gap-3 text-xs">
            <label className="inline-flex items-center gap-1.5 text-slate-600 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={onlyChaptersWithDiagrams}
                onChange={e => setOnlyChaptersWithDiagrams(e.target.checked)}
                className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-600"
              />
              <span>ಚಿತ್ರ ಅಗತ್ಯವಿರುವ ಘಟಕಗಳು ಮಾತ್ರ</span>
            </label>
            {selectedChapterId !== 'all' && (
              <button
                type="button"
                onClick={() => onSelectChapterAndFilter('all', imageFilter)}
                className="text-indigo-700 hover:underline font-semibold cursor-pointer whitespace-nowrap"
              >
                ಎಲ್ಲಾ ಘಟಕ ತೋರಿಸಿ
              </button>
            )}
          </div>
        )}
      </div>

      {showChapterTable && (
        <div className="overflow-x-auto max-h-72 overflow-y-auto">
          {displayedChapters.length === 0 ? (
            <div className="px-5 py-6 text-center text-xs text-slate-500">
              ಚಿತ್ರ ಅಗತ್ಯವಿರುವ ಘಟಕಗಳು ಪತ್ತೆಯಾಗಿಲ್ಲ. ಯಾವುದೇ ಪ್ರಶ್ನೆಯಲ್ಲೂ ನೇರವಾಗಿ "ಚಿತ್ರ ಜೋಡಿಸಿ" ಬಟನ್ ಬಳಸಿ ಚಿತ್ರ ಸೇರಿಸಬಹುದು.
            </div>
          ) : (
            <table className="w-full text-left border-collapse text-xs">
              <thead className="bg-slate-50 text-slate-600 border-b border-slate-200 sticky top-0 z-10">
                <tr>
                  <th className="py-2 px-4 font-semibold">ಘಟಕ / ಅಧ್ಯಾಯ (Unit)</th>
                  <th className="py-2 px-3 font-semibold text-right whitespace-nowrap">ಒಟ್ಟು ಪ್ರಶ್ನೆ</th>
                  <th className="py-2 px-3 font-semibold text-right whitespace-nowrap">ಚಿತ್ರ ಅಗತ್ಯ</th>
                  <th className="py-2 px-3 font-semibold text-right whitespace-nowrap">ಅಪ್ಲೋಡ್ ಆಗಿದೆ</th>
                  <th className="py-2 px-3 font-semibold text-right whitespace-nowrap">ಅಪ್ಲೋಡ್ ಬಾಕಿ</th>
                  <th className="py-2 px-4 font-semibold text-right whitespace-nowrap">ಕ್ರಿಯೆ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {displayedChapters.map(ch => {
                  const isActiveRow = selectedChapterId === ch.chapterId;
                  const pct =
                    ch.neededTotal > 0
                      ? Math.round((ch.uploadedCount / ch.neededTotal) * 100)
                      : 100;
                  return (
                    <tr
                      key={ch.chapterId}
                      className={`transition-colors ${
                        isActiveRow ? 'bg-indigo-50/70' : 'hover:bg-slate-50'
                      }`}
                    >
                      <td className="py-2.5 px-4">
                        <div className="font-semibold text-slate-900">
                          <span className="tabular-nums text-slate-500 mr-1.5">
                            {ch.chapterNumber}.
                          </span>
                          {ch.chapterName}
                        </div>
                        {ch.neededTotal > 0 && (
                          <div className="mt-1 flex items-center gap-2">
                            <div className="w-28 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full transition-all ${
                                  ch.pendingCount === 0 ? 'bg-emerald-600' : 'bg-indigo-600'
                                }`}
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                            <span className="text-3xs text-slate-500 tabular-nums">{pct}%</span>
                          </div>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-right text-slate-600 tabular-nums">
                        {ch.totalQuestions}
                      </td>
                      <td className="py-2.5 px-3 text-right font-semibold text-slate-800 tabular-nums">
                        {ch.neededTotal}
                      </td>
                      <td className="py-2.5 px-3 text-right font-semibold text-emerald-700 tabular-nums">
                        {ch.uploadedCount}
                      </td>
                      <td className="py-2.5 px-3 text-right tabular-nums">
                        {ch.pendingCount > 0 ? (
                          <span className="font-bold text-amber-700">
                            {ch.pendingCount} ಬಾಕಿ
                          </span>
                        ) : ch.neededTotal > 0 ? (
                          <span className="font-semibold text-emerald-700">0 (ಪೂರ್ಣ)</span>
                        ) : (
                          <span className="text-slate-400">0</span>
                        )}
                      </td>
                      <td className="py-2.5 px-4 text-right whitespace-nowrap">
                        {ch.pendingCount > 0 ? (
                          <button
                            type="button"
                            onClick={() => onSelectChapterAndFilter(ch.chapterId, 'pending')}
                            className="px-2.5 py-1 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-2xs font-semibold inline-flex items-center gap-1 cursor-pointer transition-colors"
                          >
                            <Filter className="w-3 h-3" />
                            <span>ಬಾಕಿ {ch.pendingCount} ತೋರಿಸಿ</span>
                          </button>
                        ) : ch.uploadedCount > 0 ? (
                          <button
                            type="button"
                            onClick={() => onSelectChapterAndFilter(ch.chapterId, 'all_diagram')}
                            className="px-2.5 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 rounded-lg text-2xs font-semibold cursor-pointer transition-colors"
                          >
                            ಚಿತ್ರ ನೋಡಿ ({ch.uploadedCount})
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => onSelectChapterAndFilter(ch.chapterId, 'all')}
                            className="px-2.5 py-1 bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 rounded-lg text-2xs font-medium cursor-pointer transition-colors"
                          >
                            ಪ್ರಶ್ನೆ ನೋಡಿ
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}
    </section>
  );
};
