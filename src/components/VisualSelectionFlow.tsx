/**
 * Visual Progressive Selection Flow: Semester -> Class (1-10) -> Subject
 * Matches the Warm Dark Espresso Botanical photo-gradient card aesthetic.
 * Shared by both Question Paper Setup and Online MCQ Test modes with live
 * dynamic Semester Period and Question Counts on every card.
 */

import React, { useMemo, useState } from 'react';
import {
  GraduationCap,
  ChevronRight,
  ArrowLeft,
  Users,
  Trophy,
  BookOpen,
  Calendar,
  CheckCircle2,
  Layers,
  Sparkles,
  Loader2,
} from 'lucide-react';
import { IndexEntry } from '../types/questionBank.ts';
import { extractGradeKey, deduceSubjectCode } from '../services/dataLoader.ts';
import {
  BankDynamicStats,
  SemesterSelection,
  SEMESTER_META,
  getSemesterPeriodMeta,
  getBankCountForSemester,
} from '../utils/bankStats.ts';

// Curated local study photography assets (bundled by Vite for fast & offline PWA use)
import imgGradCap from '../assets/images/card_sem_gradcap_1795712408613.jpg';
import imgOpenBook from '../assets/images/card_sem_openbook_1795712409288.jpg';
import imgLibrary from '../assets/images/card_study_library_1795712410889.jpg';
import imgPencils from '../assets/images/card_class_pencils_1795712416582.jpg';
import imgGlobe from '../assets/images/card_class_globe_1795712411430.jpg';
import imgFlowers from '../assets/images/card_class_flowers_1795712412780.jpg';
import imgGlasses from '../assets/images/card_class_glasses_1795712412511.jpg';
import imgLaptop from '../assets/images/card_class_laptop_1795712413601.jpg';

export type SelectionStep = 'semester' | 'class' | 'subject' | 'configure';

interface VisualSelectionFlowProps {
  mode: 'setup' | 'online_test';
  activeStep: SelectionStep;
  onChangeStep: (step: SelectionStep) => void;
  semester: SemesterSelection;
  onSelectSemester: (sem: SemesterSelection) => void;
  selectedGradeKey: string;
  onSelectGradeKey: (gradeKey: string) => void;
  selectedFileId: string;
  onSelectFileId: (fileId: string) => void;
  availableFiles: IndexEntry[];
  statsMap: Record<string, BankDynamicStats>;
  isScanningStats?: boolean;
  /** Optional quick info label for Step 4 breadcrumb */
  configureStepLabel?: string;
}

interface ClassCardTheme {
  gradeKey: string;
  labelKn: string;
  photo: string;
  photoPosition: string;
  /** Right-side architectural tint hex */
  tintHex: string;
  /** Whether text over the right tint should be dark espresso (for light sand cards) */
  darkText?: boolean;
}

const CLASS_CARDS_1_TO_10: ClassCardTheme[] = [
  {
    gradeKey: '1',
    labelKn: '1ನೇ ತರಗತಿ',
    photo: imgLibrary,
    photoPosition: 'object-left',
    tintHex: '#beb095',
    darkText: true,
  },
  {
    gradeKey: '2',
    labelKn: '2ನೇ ತರಗತಿ',
    photo: imgPencils,
    photoPosition: 'object-center',
    tintHex: '#9c7858',
  },
  {
    gradeKey: '3',
    labelKn: '3ನೇ ತರಗತಿ',
    photo: imgGlobe,
    photoPosition: 'object-center',
    tintHex: '#35594a',
  },
  {
    gradeKey: '4',
    labelKn: '4ನೇ ತರಗತಿ',
    photo: imgOpenBook,
    photoPosition: 'object-center',
    tintHex: '#715358',
  },
  {
    gradeKey: '5',
    labelKn: '5ನೇ ತರಗತಿ',
    photo: imgGlasses,
    photoPosition: 'object-center',
    tintHex: '#374f6e',
  },
  {
    gradeKey: '6',
    labelKn: '6ನೇ ತರಗತಿ',
    photo: imgLibrary,
    photoPosition: 'object-right',
    tintHex: '#4b5b3f',
  },
  {
    gradeKey: '7',
    labelKn: '7ನೇ ತರಗತಿ',
    photo: imgFlowers,
    photoPosition: 'object-center',
    tintHex: '#6c5267',
  },
  {
    gradeKey: '8',
    labelKn: '8ನೇ ತರಗತಿ',
    photo: imgGlobe,
    photoPosition: 'object-left',
    tintHex: '#9d6b37',
  },
  {
    gradeKey: '9',
    labelKn: '9ನೇ ತರಗತಿ',
    photo: imgLaptop,
    photoPosition: 'object-center',
    tintHex: '#454a54',
  },
  {
    gradeKey: '10',
    labelKn: '10ನೇ ತರಗತಿ',
    photo: imgGradCap,
    photoPosition: 'object-center',
    tintHex: '#2b4a3e',
  },
];

interface CoreSubjectTemplate {
  code: string;
  titleKn: string;
  titleEn: string;
  glyph?: string;
  iconType?: 'users' | 'trophy' | 'book';
  leftColor: string;
  midColor: string;
  photo: string;
}

const CORE_SUBJECT_TEMPLATES: CoreSubjectTemplate[] = [
  {
    code: 'KAN',
    titleKn: 'ಕನ್ನಡ',
    titleEn: 'Kannada',
    glyph: 'ಕ',
    leftColor: '#56782a',
    midColor: '#2c4c24',
    photo: imgOpenBook,
  },
  {
    code: 'ENG',
    titleKn: 'English',
    titleEn: 'English',
    glyph: 'Aa',
    leftColor: '#1b6d9f',
    midColor: '#15466b',
    photo: imgLibrary,
  },
  {
    code: 'HIN',
    titleKn: 'ಹಿಂದಿ',
    titleEn: 'Hindi',
    glyph: 'ह',
    leftColor: '#9e3b58',
    midColor: '#662337',
    photo: imgFlowers,
  },
  {
    code: 'MATH',
    titleKn: 'ಗಣಿತ',
    titleEn: 'Mathematics',
    glyph: 'Σ',
    leftColor: '#a66d20',
    midColor: '#6d4413',
    photo: imgPencils,
  },
  {
    code: 'SCI',
    titleKn: 'ವಿಜ್ಞಾನ',
    titleEn: 'Science',
    glyph: 'ವಿ',
    leftColor: '#2c6c49',
    midColor: '#19452e',
    photo: imgOpenBook,
  },
  {
    code: 'SOC',
    titleKn: 'ಸಮಾಜ ವಿಜ್ಞಾನ',
    titleEn: 'Social Studies',
    iconType: 'users',
    leftColor: '#1c7864',
    midColor: '#104e42',
    photo: imgGradCap,
  },
];

function getSubjectVisualMeta(code: string, subjectName: string): CoreSubjectTemplate {
  const matched = CORE_SUBJECT_TEMPLATES.find(t => t.code === code);
  if (matched) return matched;

  const lower = (subjectName || '').toLowerCase();
  if (lower.includes('nmms') || lower.includes('scholarship')) {
    return {
      code: 'NMMS',
      titleKn: 'NMMS',
      titleEn: 'National Means-cum-Merit Scholarship',
      iconType: 'trophy',
      leftColor: '#6936a4',
      midColor: '#411f6b',
      photo: imgGradCap,
    };
  }

  return {
    code: code || 'OTHER',
    titleKn: subjectName || 'ವಿಷಯ',
    titleEn: 'Question Bank',
    iconType: 'book',
    leftColor: '#68399e',
    midColor: '#3f2263',
    photo: imgGlobe,
  };
}

function getCompactMediumTag(medium?: string): string {
  const m = String(medium || '').toLowerCase();
  if (m.includes('english') || m.includes('ಇಂಗ್ಲಿಷ್')) return 'English Med.';
  if (m.includes('urdu') || m.includes('ಉರ್ದು')) return 'Urdu Med.';
  if (m.includes('hindi') || m.includes('ಹಿಂದಿ')) return 'Hindi Med.';
  return 'ಕನ್ನಡ ಮಾಧ್ಯಮ';
}

export const VisualSelectionFlow: React.FC<VisualSelectionFlowProps> = ({
  mode,
  activeStep,
  onChangeStep,
  semester,
  onSelectSemester,
  selectedGradeKey,
  onSelectGradeKey,
  selectedFileId,
  onSelectFileId,
  availableFiles,
  statsMap,
  isScanningStats = false,
  configureStepLabel,
}) => {
  const mcqOnly = mode === 'online_test';
  const countPrefix = mcqOnly ? 'MCQ ಪ್ರಶ್ನೆಗಳು' : 'ಪ್ರಶ್ನೋತ್ತರಗಳು';
  const activeSemesterMeta = getSemesterPeriodMeta(semester);
  const [comingSoonNotice, setComingSoonNotice] = useState<string | null>(null);

  // Totals for each Semester Card across all available banks
  const semesterTotals = useMemo(() => {
    const sums: Record<SemesterSelection, number> = { sem1: 0, sem2: 0, all: 0 };
    for (const file of availableFiles) {
      const st = statsMap[file.id];
      sums.sem1 += getBankCountForSemester(st, file, 'sem1', mcqOnly);
      sums.sem2 += getBankCountForSemester(st, file, 'sem2', mcqOnly);
      sums.all += getBankCountForSemester(st, file, 'all', mcqOnly);
    }
    return sums;
  }, [availableFiles, statsMap, mcqOnly]);

  // Per-grade dynamic totals for the currently selected semester
  const gradeTotalsMap = useMemo(() => {
    const map: Record<string, { total: number; bankCount: number }> = {};
    for (const file of availableFiles) {
      const gk = extractGradeKey(file.gradeKey || file.grade);
      const count = getBankCountForSemester(statsMap[file.id], file, semester, mcqOnly);
      if (!map[gk]) map[gk] = { total: 0, bankCount: 0 };
      map[gk].total += count;
      map[gk].bankCount += 1;
    }
    return map;
  }, [availableFiles, statsMap, semester, mcqOnly]);

  // Build subject cards for the selected grade (6 core subjects + any extra/multi-medium banks)
  const subjectCards = useMemo(() => {
    const gradeFiles = availableFiles.filter(
      f => extractGradeKey(f.gradeKey || f.grade) === selectedGradeKey
    );

    const usedFileIds = new Set<string>();
    const cards: Array<{
      key: string;
      file?: IndexEntry;
      template: CoreSubjectTemplate;
      displayTitleKn: string;
      displayTitleEn: string;
      mediumTag?: string;
      semesterCount: number;
      fullYearCount: number;
      isAvailable: boolean;
    }> = [];

    // Check if there are multiple files with the same subjectCode (e.g. Kannada & English medium Maths)
    const codeOccurrences: Record<string, number> = {};
    for (const f of gradeFiles) {
      const c = deduceSubjectCode(f.subjectCode, f.subject);
      codeOccurrences[c] = (codeOccurrences[c] || 0) + 1;
    }

    // 1. Place the 6 canonical subjects in the reference screenshot order
    for (const tpl of CORE_SUBJECT_TEMPLATES) {
      const matchingFiles = gradeFiles.filter(
        f => deduceSubjectCode(f.subjectCode, f.subject) === tpl.code
      );

      if (matchingFiles.length === 0) {
        cards.push({
          key: `core_${tpl.code}`,
          template: tpl,
          displayTitleKn: tpl.titleKn,
          displayTitleEn: tpl.titleEn,
          semesterCount: 0,
          fullYearCount: 0,
          isAvailable: false,
        });
      } else {
        for (const file of matchingFiles) {
          usedFileIds.add(file.id);
          const st = statsMap[file.id];
          const semCount = getBankCountForSemester(st, file, semester, mcqOnly);
          const fullCount = getBankCountForSemester(st, file, 'all', mcqOnly);
          cards.push({
            key: file.id,
            file,
            template: tpl,
            displayTitleKn: tpl.titleKn,
            displayTitleEn: tpl.titleEn,
            mediumTag:
              (codeOccurrences[tpl.code] || 0) > 1 ? getCompactMediumTag(file.medium) : undefined,
            semesterCount: semCount,
            fullYearCount: fullCount,
            isAvailable: true,
          });
        }
      }
    }

    // 2. Append any extra/custom uploaded subjects (e.g. NMMS, Sanskrit, Computer)
    for (const file of gradeFiles) {
      if (usedFileIds.has(file.id)) continue;
      const code = deduceSubjectCode(file.subjectCode, file.subject);
      const tpl = getSubjectVisualMeta(code, file.subject);
      const st = statsMap[file.id];
      const semCount = getBankCountForSemester(st, file, semester, mcqOnly);
      const fullCount = getBankCountForSemester(st, file, 'all', mcqOnly);
      cards.push({
        key: file.id,
        file,
        template: tpl,
        displayTitleKn: file.subject.split('(')[0].trim() || tpl.titleKn,
        displayTitleEn:
          file.subject.includes('(')
            ? file.subject.slice(file.subject.indexOf('(') + 1).replace(/\)$/, '').trim()
            : tpl.titleEn,
        mediumTag: getCompactMediumTag(file.medium),
        semesterCount: semCount,
        fullYearCount: fullCount,
        isAvailable: true,
      });
    }

    return cards;
  }, [availableFiles, selectedGradeKey, statsMap, semester, mcqOnly]);

  const activeFileEntry = useMemo(
    () => availableFiles.find(f => f.id === selectedFileId),
    [availableFiles, selectedFileId]
  );

  const activeSubjectShortName = useMemo(() => {
    if (!activeFileEntry) return 'ವಿಷಯ ಆಯ್ಕೆ';
    const code = deduceSubjectCode(activeFileEntry.subjectCode, activeFileEntry.subject);
    const tpl = CORE_SUBJECT_TEMPLATES.find(t => t.code === code);
    return tpl ? tpl.titleKn : activeFileEntry.subject.split('(')[0].trim();
  }, [activeFileEntry]);

  const activeFileSemCount = useMemo(() => {
    if (!activeFileEntry) return 0;
    return getBankCountForSemester(statsMap[activeFileEntry.id], activeFileEntry, semester, mcqOnly);
  }, [activeFileEntry, statsMap, semester, mcqOnly]);

  const handleSemesterPick = (sem: SemesterSelection) => {
    setComingSoonNotice(null);
    onSelectSemester(sem);
    onChangeStep('class');
  };

  const handleClassPick = (gradeKey: string, hasBanks: boolean) => {
    if (!hasBanks) {
      setComingSoonNotice(
        `${gradeKey}ನೇ ತರಗತಿಯ ಪ್ರಶ್ನೆ ಬ್ಯಾಂಕ್ ಶೀಘ್ರದಲ್ಲೇ ಲಭ್ಯವಾಗಲಿದೆ. ಸದ್ಯ 6 ರಿಂದ 10ನೇ ತರಗತಿಯ ಬ್ಯಾಂಕ್‌ಗಳನ್ನು ಆಯ್ಕೆ ಮಾಡಿ.`
      );
      return;
    }
    setComingSoonNotice(null);
    onSelectGradeKey(gradeKey);
    onChangeStep('subject');
  };

  const handleSubjectPick = (fileId: string | undefined, subjectName: string) => {
    if (!fileId) {
      setComingSoonNotice(
        `${selectedGradeKey}ನೇ ತರಗತಿಯ ${subjectName} ವಿಷಯದ ಪ್ರಶ್ನೆ ಬ್ಯಾಂಕ್ ಶೀಘ್ರದಲ್ಲೇ ಸೇರಿಸಲಾಗುವುದು.`
      );
      return;
    }
    setComingSoonNotice(null);
    onSelectFileId(fileId);
    onChangeStep('configure');
  };

  // Semester Cards Visual Definitions (Matching Reference Screenshot 2 + Full Year option)
  const semesterCards = [
    {
      id: 'sem1' as SemesterSelection,
      meta: SEMESTER_META.sem1,
      photo: imgGradCap,
      overlayGradient:
        'linear-gradient(155deg, rgba(24,52,37,0.78) 0%, rgba(18,38,27,0.72) 55%, rgba(16,32,23,0.86) 100%)',
      arrowBg: 'bg-emerald-700 group-hover:bg-emerald-600 border-emerald-400/50',
      ringAccent: 'border-emerald-300/35',
    },
    {
      id: 'sem2' as SemesterSelection,
      meta: SEMESTER_META.sem2,
      photo: imgOpenBook,
      overlayGradient:
        'linear-gradient(155deg, rgba(78,52,26,0.74) 0%, rgba(56,36,18,0.74) 55%, rgba(40,26,13,0.88) 100%)',
      arrowBg: 'bg-amber-600 group-hover:bg-amber-500 border-amber-300/50',
      ringAccent: 'border-amber-300/35',
    },
    {
      id: 'all' as SemesterSelection,
      meta: SEMESTER_META.all,
      photo: imgLibrary,
      overlayGradient:
        'linear-gradient(155deg, rgba(24,54,60,0.78) 0%, rgba(20,42,46,0.74) 55%, rgba(18,32,35,0.88) 100%)',
      arrowBg: 'bg-teal-600 group-hover:bg-teal-500 border-teal-300/50',
      ringAccent: 'border-teal-300/35',
    },
  ];

  return (
    <div className="space-y-5 font-kannada">
      {/* ── Interactive Step Breadcrumb Bar (Jump back to Semester, Class, or Subject in 1 click) ── */}
      <div className="bg-[#231d18]/95 border border-amber-200/15 rounded-2xl px-4 py-3 shadow-lg flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
          {/* Step 1: Semester */}
          <button
            type="button"
            onClick={() => {
              setComingSoonNotice(null);
              onChangeStep('semester');
            }}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all inline-flex items-center gap-1.5 cursor-pointer ${
              activeStep === 'semester'
                ? 'bg-gradient-to-r from-orange-600 to-amber-600 text-white shadow-sm'
                : 'bg-[#2f2720] hover:bg-[#3a3027] text-amber-100 border border-amber-200/15'
            }`}
          >
            <span className="w-4 h-4 rounded-full bg-black/25 text-[10px] font-black flex items-center justify-center">
              1
            </span>
            <span>{activeSemesterMeta.titleKn}</span>
          </button>

          <ChevronRight className="w-3.5 h-3.5 text-amber-200/40 shrink-0" />

          {/* Step 2: Class */}
          <button
            type="button"
            onClick={() => {
              setComingSoonNotice(null);
              onChangeStep('class');
            }}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all inline-flex items-center gap-1.5 cursor-pointer ${
              activeStep === 'class'
                ? 'bg-gradient-to-r from-orange-600 to-amber-600 text-white shadow-sm'
                : 'bg-[#2f2720] hover:bg-[#3a3027] text-amber-100 border border-amber-200/15'
            }`}
          >
            <span className="w-4 h-4 rounded-full bg-black/25 text-[10px] font-black flex items-center justify-center">
              2
            </span>
            <span>{selectedGradeKey}ನೇ ತರಗತಿ</span>
          </button>

          <ChevronRight className="w-3.5 h-3.5 text-amber-200/40 shrink-0" />

          {/* Step 3: Subject */}
          <button
            type="button"
            onClick={() => {
              setComingSoonNotice(null);
              onChangeStep('subject');
            }}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all inline-flex items-center gap-1.5 cursor-pointer ${
              activeStep === 'subject'
                ? 'bg-gradient-to-r from-orange-600 to-amber-600 text-white shadow-sm'
                : 'bg-[#2f2720] hover:bg-[#3a3027] text-amber-100 border border-amber-200/15'
            }`}
          >
            <span className="w-4 h-4 rounded-full bg-black/25 text-[10px] font-black flex items-center justify-center">
              3
            </span>
            <span>{activeSubjectShortName}</span>
          </button>

          <ChevronRight className="w-3.5 h-3.5 text-amber-200/40 shrink-0" />

          {/* Step 4: Configure / Test */}
          <button
            type="button"
            onClick={() => {
              if (activeFileEntry) {
                setComingSoonNotice(null);
                onChangeStep('configure');
              }
            }}
            disabled={!activeFileEntry}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-40 ${
              activeStep === 'configure'
                ? 'bg-emerald-700 text-white shadow-sm border border-emerald-400/40'
                : 'bg-[#2f2720] hover:bg-[#3a3027] text-amber-100/80 border border-amber-200/15'
            }`}
          >
            <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
            <span>
              {configureStepLabel || (mcqOnly ? 'ಪಾಠ & ಪರೀಕ್ಷೆ' : 'ಪಾಠ & ಪತ್ರಿಕೆ ರಚನೆ')}
            </span>
          </button>
        </div>

        {/* Right Live Dynamic Status Chip */}
        <div className="flex items-center gap-2 text-xs">
          {isScanningStats && (
            <span className="inline-flex items-center gap-1.5 text-amber-200/75 text-[11px] font-semibold">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-400" />
              <span>ಲೆಕ್ಕಾಚಾರ...</span>
            </span>
          )}
          {activeStep === 'configure' && activeFileEntry && (
            <span className="px-3 py-1 rounded-full bg-[#30271f] border border-amber-300/25 text-amber-200 font-bold tabular-nums text-[11px] whitespace-nowrap">
              {activeSemesterMeta.periodKn} · {countPrefix}: {activeFileSemCount}
            </span>
          )}
        </div>
      </div>

      {/* Gentle Coming Soon Notice (for Classes 1-5 or unpopulated subjects) */}
      {comingSoonNotice && (
        <div className="px-4 py-3 rounded-xl bg-amber-950/70 border border-amber-400/35 text-amber-100 text-xs sm:text-sm font-semibold flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-amber-400 shrink-0" />
            <span>{comingSoonNotice}</span>
          </div>
          <button
            type="button"
            onClick={() => setComingSoonNotice(null)}
            className="text-xs font-bold text-amber-300 hover:text-white px-2 py-0.5 cursor-pointer shrink-0"
          >
            ಸರಿ
          </button>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════
          STAGE 1: SEMESTER SELECTION CARDS (Reference Screenshot 2 Style)
          ════════════════════════════════════════════════════════════════ */}
      {activeStep === 'semester' && (
        <section className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2 className="text-2xl sm:text-3xl font-black text-[#f7f0e6] tracking-tight">
                ಸೆಮಿಸ್ಟರ್ ಆಯ್ಕೆ ಮಾಡಿ
              </h2>
              <p className="text-xs sm:text-sm text-[#c6b9a8] mt-1">
                {mcqOnly
                  ? 'ಆನ್‌ಲೈನ್ ಬಹು ಆಯ್ಕೆ ಪರೀಕ್ಷೆಗಾಗಿ ಸೆಮಿಸ್ಟರ್ ಅವಧಿಯನ್ನು ಆಯ್ಕೆ ಮಾಡಿ'
                  : 'ಪ್ರಶ್ನೆ ಪತ್ರಿಕೆ ರಚನೆಗಾಗಿ ಸೆಮಿಸ್ಟರ್ ಅವಧಿಯನ್ನು ಆಯ್ಕೆ ಮಾಡಿ'}
              </p>
            </div>
            <div className="text-xs font-bold text-amber-200/80 bg-[#26201a] border border-amber-200/15 px-3.5 py-1.5 rounded-full tabular-nums">
              ಒಟ್ಟು ಲಭ್ಯ {countPrefix}: {semesterTotals.all}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {semesterCards.map(card => {
              const count = semesterTotals[card.id];
              const isSelected = semester === card.id;
              return (
                <button
                  key={card.id}
                  type="button"
                  onClick={() => handleSemesterPick(card.id)}
                  className={`group relative overflow-hidden rounded-[22px] min-h-[250px] sm:min-h-[275px] text-center flex flex-col items-center justify-center p-6 transition-all duration-300 cursor-pointer border shadow-xl ${
                    isSelected
                      ? 'border-amber-300/80 ring-2 ring-amber-400/35 shadow-amber-950/60'
                      : 'border-white/15 hover:border-amber-200/50 hover:-translate-y-0.5'
                  }`}
                >
                  {/* Background Study Photography */}
                  <img
                    src={card.photo}
                    alt={card.meta.titleEn}
                    className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                  />

                  {/* Rich Botanical Atmospheric Overlay */}
                  <div
                    className="absolute inset-0 transition-opacity duration-300"
                    style={{ background: card.overlayGradient }}
                  />

                  {/* Subtle inner specular edge */}
                  <div className="absolute inset-0 rounded-[22px] ring-1 ring-inset ring-white/10 pointer-events-none" />

                  {/* Foreground Centered Editorial Content */}
                  <div className="relative z-10 flex flex-col items-center justify-center gap-3 w-full">
                    {/* Circular Graduation Cap Emblem */}
                    <div
                      className={`w-14 h-14 rounded-full border ${card.ringAccent} bg-black/30 backdrop-blur-sm flex items-center justify-center text-amber-100 shadow-inner`}
                    >
                      {card.id === 'all' ? (
                        <Layers className="w-6 h-6" />
                      ) : (
                        <GraduationCap className="w-7 h-7" />
                      )}
                    </div>

                    {/* Titles */}
                    <div className="space-y-0.5">
                      <h3 className="text-xl sm:text-2xl font-black text-white drop-shadow-sm leading-snug">
                        {card.meta.titleKn}
                      </h3>
                      <p className="text-xs sm:text-sm font-medium text-amber-100/85 tracking-wide">
                        {card.meta.titleEn}
                      </p>
                      <p className="text-[11px] font-semibold text-amber-200/80 pt-0.5">
                        ಅವಧಿ: {card.meta.monthsKn}
                      </p>
                    </div>

                    {/* Dynamic Question Count Pill */}
                    <div className="px-5 py-1.5 rounded-full bg-black/40 border border-white/30 backdrop-blur-md text-white font-extrabold text-sm sm:text-base tabular-nums shadow-sm">
                      {countPrefix}: {count}
                    </div>

                    {/* Circular Forward Arrow Button */}
                    <div
                      className={`mt-1 w-10 h-10 rounded-full border ${card.arrowBg} text-white flex items-center justify-center shadow-lg transition-transform duration-300 group-hover:translate-x-0.5`}
                    >
                      <ChevronRight className="w-5 h-5 stroke-[2.5]" />
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* ════════════════════════════════════════════════════════════════
          STAGE 2: CLASS SELECTION CARDS 1–10 (Reference Screenshot 3 Style)
          ════════════════════════════════════════════════════════════════ */}
      {activeStep === 'class' && (
        <section className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-2xl sm:text-3xl font-black text-[#f7f0e6] tracking-tight">
                ತರಗತಿ ಆಯ್ಕೆ ಮಾಡಿ (1ನೇ – 10ನೇ ತರಗತಿ)
              </h2>
              <p className="text-xs sm:text-sm text-[#c6b9a8] mt-1 flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                <span>ಆಯ್ದ ಅವಧಿ: {activeSemesterMeta.periodKn}</span>
              </p>
            </div>

            <button
              type="button"
              onClick={() => onChangeStep('semester')}
              className="px-3.5 py-2 rounded-xl bg-[#2a221c] hover:bg-[#362c24] border border-amber-200/20 text-amber-100 text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>ಸೆಮಿಸ್ಟರ್ ಬದಲಿಸಿ</span>
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {CLASS_CARDS_1_TO_10.map(cls => {
              const gradeStat = gradeTotalsMap[cls.gradeKey];
              const qCount = gradeStat?.total ?? 0;
              const hasBanks = (gradeStat?.bankCount ?? 0) > 0;
              const isSelected = selectedGradeKey === cls.gradeKey;
              const isDarkText = Boolean(cls.darkText);

              return (
                <button
                  key={cls.gradeKey}
                  type="button"
                  onClick={() => handleClassPick(cls.gradeKey, hasBanks)}
                  className={`group relative overflow-hidden rounded-[20px] h-[156px] sm:h-[172px] text-left transition-all duration-300 border shadow-lg cursor-pointer ${
                    isSelected && hasBanks
                      ? 'border-amber-300/85 ring-2 ring-amber-400/35'
                      : hasBanks
                        ? 'border-white/15 hover:border-amber-200/55 hover:-translate-y-0.5'
                        : 'border-white/10 opacity-90 hover:opacity-100'
                  }`}
                >
                  {/* Full-Bleed Study Photo positioned toward left */}
                  <img
                    src={cls.photo}
                    alt={cls.labelKn}
                    className={`absolute inset-0 w-full h-full object-cover ${cls.photoPosition} transition-transform duration-500 group-hover:scale-105`}
                  />

                  {/* Seamless Horizontal Feather Blending Left Photo -> Right Tinted Panel */}
                  <div
                    className="absolute inset-0"
                    style={{
                      background: `linear-gradient(90deg, rgba(16,12,9,0.18) 0%, ${cls.tintHex}66 28%, ${cls.tintHex}ea 52%, ${cls.tintHex}ff 100%)`,
                    }}
                  />

                  {/* Subtle inner hairline border */}
                  <div className="absolute inset-0 rounded-[20px] ring-1 ring-inset ring-white/10 pointer-events-none" />

                  {/* Foreground Content positioned cleanly across center-left & right chevron */}
                  <div className="relative z-10 h-full px-6 sm:px-8 flex items-center justify-between gap-4">
                    {/* Left Spacer to let sunlit study photo shine + Center-Aligned Class Typography */}
                    <div className="pl-[26%] sm:pl-[30%] flex flex-col items-start justify-center min-w-0">
                      <span
                        className={`text-4xl sm:text-5xl font-black leading-none tracking-tight tabular-nums drop-shadow-xs ${
                          isDarkText ? 'text-[#2c2118]' : 'text-white'
                        }`}
                      >
                        {cls.gradeKey}
                      </span>
                      <span
                        className={`text-base sm:text-lg font-extrabold mt-1 leading-tight ${
                          isDarkText ? 'text-[#2c2118]' : 'text-white/95'
                        }`}
                      >
                        {cls.labelKn}
                      </span>

                      {/* Dynamic Count Badge or Coming Soon Pill */}
                      <div className="mt-2">
                        {hasBanks && qCount > 0 ? (
                          <span className="inline-flex items-center px-3.5 py-1 rounded-full bg-[#f5e3ab] text-[#23190f] font-extrabold text-xs tabular-nums shadow-sm">
                            {countPrefix}: {qCount}
                          </span>
                        ) : hasBanks ? (
                          <span className="inline-flex items-center px-3 py-1 rounded-full bg-black/40 border border-white/25 text-white font-bold text-xs tabular-nums">
                            {gradeStat.bankCount} ವಿಷಯ ಲಭ್ಯ
                          </span>
                        ) : (
                          <span
                            className={`inline-flex items-center px-3 py-0.5 rounded-full text-[11px] font-bold border ${
                              isDarkText
                                ? 'bg-[#3b2f23]/80 text-amber-50 border-[#3b2f23]/40'
                                : 'bg-black/35 text-white/90 border-white/25'
                            }`}
                          >
                            ಶೀಘ್ರದಲ್ಲೇ
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Far-Right Circular Chevron */}
                    <div
                      className={`w-8 h-8 rounded-full border flex items-center justify-center shrink-0 transition-transform duration-300 group-hover:translate-x-0.5 ${
                        isDarkText
                          ? 'bg-[#2c2118]/20 border-[#2c2118]/35 text-[#2c2118]'
                          : 'bg-black/25 border-white/30 text-white'
                      }`}
                    >
                      <ChevronRight className="w-4 h-4 stroke-[2.5]" />
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* ════════════════════════════════════════════════════════════════
          STAGE 3: SUBJECT SELECTION CARDS (Reference Screenshot 1 Style)
          Includes Dynamic Semester Period & Dynamic Total Questions!
          ════════════════════════════════════════════════════════════════ */}
      {activeStep === 'subject' && (
        <section className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-2xl sm:text-3xl font-black text-[#f7f0e6] tracking-tight">
                {selectedGradeKey}ನೇ ತರಗತಿ - ವಿಷಯಗಳು
              </h2>
              <p className="text-xs sm:text-sm text-[#c6b9a8] mt-1 flex flex-wrap items-center gap-2">
                <span>ವಿಷಯವನ್ನು ಆಯ್ಕೆ ಮಾಡಿ</span>
                <span className="text-amber-300/40">•</span>
                <span className="inline-flex items-center gap-1 text-amber-300 font-bold">
                  <Calendar className="w-3.5 h-3.5" />
                  <span>{activeSemesterMeta.periodKn}</span>
                </span>
              </p>
            </div>

            <div className="flex items-center gap-2">
              {/* Quick inline Semester switcher right above Subject cards so dynamic period & counts update live! */}
              <div className="flex items-center gap-1 bg-[#251f19] border border-amber-200/15 p-1 rounded-xl">
                {(['sem1', 'sem2', 'all'] as SemesterSelection[]).map(semOpt => (
                  <button
                    key={semOpt}
                    type="button"
                    onClick={() => onSelectSemester(semOpt)}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-colors cursor-pointer whitespace-nowrap ${
                      semester === semOpt
                        ? 'bg-gradient-to-r from-orange-600 to-amber-600 text-white shadow-xs'
                        : 'text-[#cbbca9] hover:text-white hover:bg-white/5'
                    }`}
                  >
                    {semOpt === 'sem1' ? 'ಸೆಮಿಸ್ಟರ್ 1' : semOpt === 'sem2' ? 'ಸೆಮಿಸ್ಟರ್ 2' : 'ಪೂರ್ಣ ವರ್ಷ'}
                  </button>
                ))}
              </div>

              <button
                type="button"
                onClick={() => onChangeStep('class')}
                className="px-3 py-1.5 rounded-xl bg-[#2a221c] hover:bg-[#362c24] border border-amber-200/20 text-amber-100 text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer transition-colors"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>ತರಗತಿ</span>
              </button>
            </div>
          </div>

          {/* 3-Column Subject Cards Grid matching Reference Screenshot 1 */}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {subjectCards.map(card => {
              const isSelected = Boolean(card.file && card.file.id === selectedFileId);
              const { template } = card;

              return (
                <button
                  key={card.key}
                  type="button"
                  onClick={() => handleSubjectPick(card.file?.id, card.displayTitleKn)}
                  className={`group relative overflow-hidden rounded-[20px] min-h-[164px] text-left transition-all duration-300 border shadow-xl cursor-pointer ${
                    isSelected
                      ? 'border-amber-300 ring-2 ring-amber-400/40'
                      : card.isAvailable
                        ? 'border-white/15 hover:border-amber-200/55 hover:-translate-y-0.5'
                        : 'border-white/10 opacity-85 hover:opacity-100'
                  }`}
                >
                  {/* Right-Anchored Sunlit Botanical Study Photography */}
                  <img
                    src={template.photo}
                    alt={card.displayTitleEn}
                    className="absolute inset-0 w-full h-full object-cover object-right transition-transform duration-500 group-hover:scale-105"
                  />

                  {/* Smooth Jewel/Botanical Gradient Blending Left Panel -> Right Sunlit Photo */}
                  <div
                    className="absolute inset-0"
                    style={{
                      background: `linear-gradient(96deg, ${template.leftColor}ff 0%, ${template.midColor}eb 48%, ${template.midColor}78 72%, rgba(18,14,10,0.22) 100%)`,
                    }}
                  />

                  {/* Subtle inner specular edge */}
                  <div className="absolute inset-0 rounded-[20px] ring-1 ring-inset ring-white/12 pointer-events-none" />

                  {/* Card Content */}
                  <div className="relative z-10 h-full p-4 sm:p-5 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3.5 min-w-0 flex-1">
                      {/* Frosted Glass Subject Icon Tile (ಕ / Aa / ह / Σ / ವಿ / Users / Trophy) */}
                      <div className="w-12 h-12 rounded-xl bg-black/35 border border-white/25 backdrop-blur-sm flex items-center justify-center text-white text-xl font-black shrink-0 shadow-md">
                        {template.glyph ? (
                          <span>{template.glyph}</span>
                        ) : template.iconType === 'users' ? (
                          <Users className="w-6 h-6" />
                        ) : template.iconType === 'trophy' ? (
                          <Trophy className="w-6 h-6 text-amber-300" />
                        ) : (
                          <BookOpen className="w-6 h-6" />
                        )}
                      </div>

                      {/* Subject Titles + Dynamic Semester Period + Dynamic Question Count Pill */}
                      <div className="min-w-0 flex-1 space-y-1.5">
                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="text-base sm:text-lg font-black text-white leading-tight drop-shadow-xs truncate">
                              {card.displayTitleKn}
                            </h3>
                            {card.mediumTag && (
                              <span className="px-2 py-0.5 rounded-md bg-black/35 border border-white/20 text-[10px] font-bold text-amber-100 whitespace-nowrap">
                                {card.mediumTag}
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-white/85 font-medium truncate">
                            {card.displayTitleEn}
                          </p>
                        </div>

                        {/* Dynamic Semester Period on Subject Card */}
                        <div className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-200/95 bg-black/30 border border-white/15 px-2.5 py-0.5 rounded-md max-w-full">
                          <Calendar className="w-3 h-3 shrink-0 text-amber-300" />
                          <span className="truncate">{activeSemesterMeta.periodKn}</span>
                        </div>

                        {/* Dynamic Total Question Count Pill (exact Reference Screenshot 1 style!) */}
                        <div className="pt-0.5">
                          {card.isAvailable && card.semesterCount > 0 ? (
                            <span className="inline-flex items-center px-4 py-1.5 rounded-full bg-[#f7e7b4] text-[#1f160c] font-black text-xs sm:text-sm tabular-nums shadow-md">
                              {countPrefix}: {card.semesterCount}
                            </span>
                          ) : card.isAvailable && card.fullYearCount > 0 ? (
                            <span className="inline-flex items-center px-3.5 py-1 rounded-full bg-black/45 border border-amber-300/40 text-amber-100 font-bold text-xs tabular-nums">
                              {countPrefix}: 0 (ಒಟ್ಟು: {card.fullYearCount})
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-4 py-1.5 rounded-full bg-black/35 border border-white/30 backdrop-blur-sm text-white/95 font-bold text-xs sm:text-sm">
                              ಶೀಘ್ರದಲ್ಲೇ
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Far-Right Circular Chevron */}
                    <div className="w-8 h-8 rounded-full bg-black/35 border border-white/30 text-white flex items-center justify-center shrink-0 transition-all duration-300 group-hover:bg-white/20 group-hover:translate-x-0.5">
                      <ChevronRight className="w-4 h-4 stroke-[2.5]" />
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
};
