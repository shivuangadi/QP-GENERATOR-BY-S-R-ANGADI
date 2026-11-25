/**
 * Saved JSON Question Banks Table (Classwise & Subjectwise)
 * Displays all permanently saved JSON question banks grouped/sorted by Class and Subject,
 * flags double / duplicate JSON files for the same Class + Subject,
 * and places an inline Delete button BEFORE each row's Class & Subject columns.
 */

import React, { useMemo, useState } from 'react';
import {
  Trash2,
  FolderOpen,
  AlertTriangle,
  Search,
  Crop,
  Check,
  X,
  RefreshCw,
} from 'lucide-react';
import { SavedBankSummary } from '../services/pdfVault.ts';

interface SavedJsonBanksTableProps {
  banks: SavedBankSummary[];
  activeBankId?: string | null;
  isLoadingOpen?: boolean;
  deletingBankId?: string | null;
  openButtonLabel?: string;
  onOpenBank: (bank: SavedBankSummary) => void;
  onDeleteBank: (bank: SavedBankSummary) => Promise<void> | void;
}

function getDuplicateGroupKey(bank: SavedBankSummary): string {
  const gKey = (bank.gradeKey || bank.grade || '').trim().toLowerCase();
  const sKey =
    bank.subjectCode && bank.subjectCode !== 'GEN'
      ? bank.subjectCode.trim().toLowerCase()
      : (bank.subject || '').trim().toLowerCase();
  return `${gKey}::${sKey}`;
}

function formatSavedDate(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: '2-digit',
  });
}

export const SavedJsonBanksTable: React.FC<SavedJsonBanksTableProps> = ({
  banks,
  activeBankId,
  isLoadingOpen = false,
  deletingBankId = null,
  openButtonLabel = 'ತೆರೆಯಿರಿ & ಚಿತ್ರ',
  onOpenBank,
  onDeleteBank,
}) => {
  const [filterMode, setFilterMode] = useState<'all' | 'duplicates'>('all');
  const [selectedClassKey, setSelectedClassKey] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [confirmingKey, setConfirmingKey] = useState<string | null>(null);

  // Count occurrences per (Class + Subject) to detect doubles / duplicates
  const groupCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const b of banks) {
      const k = getDuplicateGroupKey(b);
      map.set(k, (map.get(k) || 0) + 1);
    }
    return map;
  }, [banks]);

  const duplicateBanksCount = useMemo(() => {
    return banks.filter(b => (groupCounts.get(getDuplicateGroupKey(b)) || 0) > 1).length;
  }, [banks, groupCounts]);

  const duplicateSubjectsCount = useMemo(() => {
    let count = 0;
    groupCounts.forEach(v => {
      if (v > 1) count++;
    });
    return count;
  }, [groupCounts]);

  // Distinct classes sorted numerically (Class 6 -> 7 -> 8 -> 9 -> 10)
  const classOptions = useMemo(() => {
    const byKey = new Map<string, string>();
    for (const b of banks) {
      const key = b.gradeKey || b.grade;
      if (!byKey.has(key)) byKey.set(key, b.grade);
    }
    return Array.from(byKey.entries()).sort((a, b) => {
      const na = parseInt(a[0], 10);
      const nb = parseInt(b[0], 10);
      if (!isNaN(na) && !isNaN(nb)) return na - nb;
      return a[0].localeCompare(b[0]);
    });
  }, [banks]);

  // Filtered and classwise + subjectwise sorted rows
  const visibleBanks = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return banks
      .filter(b => {
        if (filterMode === 'duplicates') {
          if ((groupCounts.get(getDuplicateGroupKey(b)) || 0) <= 1) return false;
        }
        if (selectedClassKey !== 'all') {
          const key = b.gradeKey || b.grade;
          if (key !== selectedClassKey) return false;
        }
        if (q) {
          const hay = `${b.grade} ${b.subject} ${b.title} ${b.filename || ''} ${b.id}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      })
      .sort((a, b) => {
        const na = parseInt(a.gradeKey, 10);
        const nb = parseInt(b.gradeKey, 10);
        if (!isNaN(na) && !isNaN(nb) && na !== nb) return na - nb;
        const gCmp = a.grade.localeCompare(b.grade);
        if (gCmp !== 0) return gCmp;
        const sCmp = a.subject.localeCompare(b.subject);
        if (sCmp !== 0) return sCmp;
        return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
      });
  }, [banks, filterMode, selectedClassKey, searchTerm, groupCounts]);

  const handleConfirmDelete = async (bank: SavedBankSummary) => {
    setConfirmingKey(null);
    await onDeleteBank(bank);
  };

  if (banks.length === 0) {
    return null;
  }

  return (
    <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
      {/* Header & Controls */}
      <div className="p-4 sm:px-5 border-b border-slate-200 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-slate-100 text-indigo-700 flex items-center justify-center shrink-0">
              <FolderOpen className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h3 className="text-xs sm:text-sm font-bold text-slate-900">
                ಉಳಿಸಿದ JSON ಪ್ರಶ್ನೆಕೋಶಗಳ ಪಟ್ಟಿ (Saved JSON Files — Classwise &amp; Subjectwise)
              </h3>
              <p className="text-2xs text-slate-500 tabular-nums">
                ಒಟ್ಟು {banks.length} ಫೈಲ್‌ಗಳು · {classOptions.length} ತರಗತಿಗಳು
                {duplicateBanksCount > 0 && (
                  <>
                    {' · '}
                    <span className="font-semibold text-amber-700">
                      {duplicateBanksCount} ನಕಲು / ಡಬಲ್ ಫೈಲ್‌ಗಳು ({duplicateSubjectsCount} ವಿಷಯಗಳಲ್ಲಿ)
                    </span>
                  </>
                )}
              </p>
            </div>
          </div>

          {/* Interactive Filter Toolbar */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Segmented All / Duplicates Only Switch */}
            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
              <button
                type="button"
                onClick={() => setFilterMode('all')}
                className={`px-2.5 py-1 text-2xs font-semibold rounded-md transition-colors cursor-pointer whitespace-nowrap tabular-nums ${
                  filterMode === 'all'
                    ? 'bg-white text-slate-900 shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                ಎಲ್ಲಾ ({banks.length})
              </button>
              <button
                type="button"
                onClick={() => setFilterMode('duplicates')}
                className={`px-2.5 py-1 text-2xs font-semibold rounded-md transition-colors cursor-pointer whitespace-nowrap tabular-nums flex items-center gap-1 ${
                  filterMode === 'duplicates'
                    ? 'bg-amber-600 text-white shadow-2xs'
                    : duplicateBanksCount > 0
                      ? 'text-amber-800 hover:text-amber-950'
                      : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {duplicateBanksCount > 0 && <AlertTriangle className="w-3 h-3 shrink-0" />}
                <span>ಡಬಲ್ / ನಕಲು ({duplicateBanksCount})</span>
              </button>
            </div>

            {/* Class Filter Dropdown */}
            <select
              value={selectedClassKey}
              onChange={e => setSelectedClassKey(e.target.value)}
              aria-label="Filter by class"
              className="bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 text-2xs font-semibold text-slate-800 cursor-pointer focus:outline-hidden focus:ring-1 focus:ring-indigo-600"
            >
              <option value="all">ಎಲ್ಲಾ ತರಗತಿಗಳು (All Classes)</option>
              {classOptions.map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>

            {/* Quick Search */}
            <div className="relative">
              <input
                type="text"
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                placeholder="ವಿಷಯ / ಫೈಲ್ ಹುಡುಕಿ..."
                className="w-40 sm:w-44 bg-slate-50 border border-slate-300 rounded-lg pl-7 pr-2.5 py-1.5 text-2xs text-slate-800 focus:bg-white focus:outline-hidden focus:ring-1 focus:ring-indigo-600"
              />
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2 top-2 pointer-events-none" />
            </div>
          </div>
        </div>

        {/* Duplicate Alert Banner */}
        {duplicateBanksCount > 0 && (
          <div className="px-3.5 py-2.5 rounded-xl bg-amber-50 border border-amber-200 flex flex-wrap items-center justify-between gap-2 text-2xs text-amber-950">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
              <span>
                <strong>ಡಬಲ್ / ನಕಲು JSON ಫೈಲ್‌ಗಳು ಪತ್ತೆಯಾಗಿವೆ:</strong> ಒಂದೇ ತರಗತಿ ಮತ್ತು ವಿಷಯಕ್ಕೆ ಒಂದಕ್ಕಿಂತ ಹೆಚ್ಚು JSON ಫೈಲ್‌ಗಳಿವೆ. ಅನಗತ್ಯ ನಕಲು ಫೈಲ್‌ಗಳನ್ನು ಪಟ್ಟಿಯ ಎಡಭಾಗದ <strong>Delete</strong> ಬಟನ್ ಒತ್ತಿ ಶಾಶ್ವತವಾಗಿ ಅಳಿಸಬಹುದು.
              </span>
            </div>
            {filterMode !== 'duplicates' && (
              <button
                type="button"
                onClick={() => setFilterMode('duplicates')}
                className="px-2.5 py-1 bg-amber-600 hover:bg-amber-700 text-white font-semibold rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                ನಕಲು ಫೈಲ್‌ಗಳು ಮಾತ್ರ ತೋರಿಸಿ ({duplicateBanksCount})
              </button>
            )}
          </div>
        )}
      </div>

      {/* Classwise & Subjectwise Table with Delete Button BEFORE Class & Subject */}
      <div className="overflow-x-auto max-h-96 overflow-y-auto">
        <table className="w-full text-left border-collapse text-xs">
          <thead className="bg-slate-50 border-b border-slate-200 sticky top-0 z-10">
            <tr className="text-2xs font-bold text-slate-600">
              <th className="py-2.5 pl-4 pr-3 w-32 whitespace-nowrap">ಅಳಿಸಿ (Delete)</th>
              <th className="py-2.5 px-3 whitespace-nowrap">ತರಗತಿ (Class)</th>
              <th className="py-2.5 px-3">ವಿಷಯ &amp; ಫೈಲ್ (Subject &amp; JSON File)</th>
              <th className="py-2.5 px-3 text-right whitespace-nowrap">ಘಟಕ</th>
              <th className="py-2.5 px-3 text-right whitespace-nowrap">ಪ್ರಶ್ನೆಗಳು</th>
              <th className="py-2.5 px-3 whitespace-nowrap">ಸಂಗ್ರಹ · ದಿನಾಂಕ</th>
              <th className="py-2.5 pl-3 pr-4 text-right whitespace-nowrap">ಕ್ರಿಯೆ (Open)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {visibleBanks.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-8 px-4 text-center text-xs text-slate-500">
                  {filterMode === 'duplicates'
                    ? 'ಯಾವುದೇ ಡಬಲ್ ಅಥವಾ ನಕಲು JSON ಫೈಲ್‌ಗಳು ಉಳಿದಿಲ್ಲ (No duplicate files found).'
                    : 'ಆಯ್ಕೆಮಾಡಿದ ಫಿಲ್ಟರ್‌ಗೆ ಹೊಂದುವ JSON ಫೈಲ್‌ಗಳು ಲಭ್ಯವಿಲ್ಲ.'}
                </td>
              </tr>
            ) : (
              visibleBanks.map((bank, index) => {
                const rowKey = `${bank.source}_${bank.id}`;
                const dupCount = groupCounts.get(getDuplicateGroupKey(bank)) || 1;
                const isDuplicate = dupCount > 1;
                const isConfirming = confirmingKey === rowKey;
                const isDeleting = deletingBankId === bank.id;
                const isActive = Boolean(activeBankId && activeBankId === bank.id);

                // Visual separator when class changes
                const prevBank = index > 0 ? visibleBanks[index - 1] : null;
                const isNewClassGroup = prevBank && (prevBank.gradeKey || prevBank.grade) !== (bank.gradeKey || bank.grade);

                const storageLabel =
                  bank.source === 'firebase' && bank.alsoOnServer
                    ? 'Firebase & Server'
                    : bank.source === 'firebase'
                      ? 'Firebase'
                      : 'Server';

                return (
                  <tr
                    key={rowKey}
                    className={`transition-colors ${
                      isNewClassGroup ? 'border-t-2 border-t-slate-200' : ''
                    } ${
                      isActive
                        ? 'bg-indigo-50/50'
                        : isDuplicate
                          ? 'bg-amber-50/35 hover:bg-amber-50/70'
                          : 'hover:bg-slate-50'
                    }`}
                  >
                    {/* Column 1: Delete Button BEFORE Class & Subject */}
                    <td className="py-2.5 pl-4 pr-3 whitespace-nowrap align-middle">
                      {isConfirming ? (
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            disabled={isDeleting}
                            onClick={() => handleConfirmDelete(bank)}
                            className="px-2 py-1 bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white text-3xs font-bold rounded-md transition-colors flex items-center gap-1 cursor-pointer whitespace-nowrap"
                            title="ಶಾಶ್ವತವಾಗಿ ಅಳಿಸಲು ದೃಢೀಕರಿಸಿ"
                          >
                            <Check className="w-3 h-3" />
                            <span>ಖಚಿತ</span>
                          </button>
                          <button
                            type="button"
                            disabled={isDeleting}
                            onClick={() => setConfirmingKey(null)}
                            className="p-1 bg-white hover:bg-slate-100 text-slate-600 border border-slate-300 rounded-md transition-colors cursor-pointer"
                            title="ರದ್ದುಗೊಳಿಸಿ"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          disabled={isDeleting}
                          onClick={() => setConfirmingKey(rowKey)}
                          className={`px-2.5 py-1.5 rounded-lg border text-2xs font-semibold transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap disabled:opacity-50 ${
                            isDuplicate
                              ? 'bg-rose-50 hover:bg-rose-600 text-rose-700 hover:text-white border-rose-300 hover:border-rose-600'
                              : 'bg-white hover:bg-rose-50 text-rose-700 border-slate-200 hover:border-rose-300'
                          }`}
                          title={`${bank.grade} ${bank.subject} JSON ಫೈಲ್ ಅಳಿಸಿ`}
                        >
                          {isDeleting ? (
                            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Trash2 className="w-3.5 h-3.5 shrink-0" />
                          )}
                          <span>{isDeleting ? 'ಅಳಿಸುತ್ತಿದೆ...' : 'Delete'}</span>
                        </button>
                      )}
                    </td>

                    {/* Column 2: Class */}
                    <td className="py-2.5 px-3 whitespace-nowrap align-middle">
                      <span className="font-bold text-slate-900">{bank.grade}</span>
                    </td>

                    {/* Column 3: Subject + Title/File + Duplicate Marker */}
                    <td className="py-2.5 px-3 align-middle min-w-[200px]">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        <span className="font-bold text-slate-900">{bank.subject}</span>
                        {isDuplicate && (
                          <span className="inline-flex items-center gap-1 text-3xs font-bold text-amber-800">
                            <AlertTriangle className="w-3 h-3 text-amber-600 shrink-0" />
                            <span>Duplicate · {dupCount} ಫೈಲ್‌ಗಳು</span>
                          </span>
                        )}
                        {isActive && (
                          <span className="text-3xs font-bold text-indigo-700">
                            · ತೆರೆದಿದೆ (Active)
                          </span>
                        )}
                      </div>
                      <p className="text-3xs text-slate-500 truncate max-w-xs" title={bank.filename || bank.title}>
                        {bank.title}
                        {bank.filename ? ` · ${bank.filename}` : ''}
                      </p>
                    </td>

                    {/* Column 4: Chapters */}
                    <td className="py-2.5 px-3 text-right whitespace-nowrap align-middle font-mono tabular-nums text-slate-700 font-semibold">
                      {bank.totalChapters}
                    </td>

                    {/* Column 5: Questions */}
                    <td className="py-2.5 px-3 text-right whitespace-nowrap align-middle font-mono tabular-nums text-slate-900 font-bold">
                      {bank.totalQuestions}
                    </td>

                    {/* Column 6: Storage & Date (Clean unboxed metadata) */}
                    <td className="py-2.5 px-3 whitespace-nowrap align-middle text-2xs text-slate-500 tabular-nums">
                      <span>{storageLabel}</span>
                      <span aria-hidden="true"> · </span>
                      <span>{formatSavedDate(bank.updatedAt)}</span>
                    </td>

                    {/* Column 7: Open Action */}
                    <td className="py-2.5 pl-3 pr-4 text-right whitespace-nowrap align-middle">
                      <button
                        type="button"
                        disabled={isLoadingOpen || isDeleting}
                        onClick={() => onOpenBank(bank)}
                        className="px-2.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-2xs font-semibold rounded-lg transition-colors inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                      >
                        <Crop className="w-3.5 h-3.5 shrink-0" />
                        <span>{openButtonLabel}</span>
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
