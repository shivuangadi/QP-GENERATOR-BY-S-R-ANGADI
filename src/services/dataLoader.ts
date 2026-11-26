/**
 * Data Loader Service for Question Paper Generator
 * Automatically discovers and normalizes official Karnataka DSERT Question Banks
 * Author: S R Angadi
 */

import {
  BankIndex,
  IndexEntry,
  QuestionBank,
  Chapter,
  QuestionItem,
  STANDARD_QUESTION_FORMATS,
} from '../types/questionBank.ts';
import { getQuestionBanksFromFirebase } from './firebase.ts';

// In-memory cache for loaded banks
const bankCache = new Map<string, QuestionBank>();

/**
 * Fetches JSON with automatic retry & backoff to gracefully recover from
 * transient dev-server restarts, cold starts, or proxy connection blips.
 */
async function fetchJsonWithRetry<T = any>(url: string, maxAttempts = 3): Promise<T> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(url, { cache: attempt > 1 ? 'no-store' : 'default' });
      const text = await res.text();
      const trimmed = text.trim();

      // Detect transient HTML proxy / restart fallback pages
      if (trimmed.startsWith('<!') || trimmed.toLowerCase().startsWith('<html')) {
        const err = new Error(`ಸರ್ವರ್ ಮರುಪ್ರಾರಂಭವಾಗುತ್ತಿದೆ (HTTP ${res.status})`);
        (err as any).isRetryable = true;
        throw err;
      }

      if (!res.ok) {
        const err = new Error(`ಫೈಲ್ ಲೋಡ್ ಮಾಡಲು ವಿಫಲವಾಗಿದೆ: ${url} (${res.status} ${res.statusText})`);
        (err as any).isRetryable = res.status >= 500 || res.status === 429;
        throw err;
      }

      return JSON.parse(trimmed) as T;
    } catch (err: any) {
      lastError = err;
      const isNetworkOrTransient =
        err?.name === 'TypeError' ||
        Boolean(err?.isRetryable) ||
        String(err?.message || '').includes('Failed to fetch') ||
        String(err?.message || '').includes('NetworkError');

      if (isNetworkOrTransient && attempt < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, attempt * 700));
        continue;
      }
      break;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`Failed to load ${url}`);
}

// Central index fallback pointing to provided files
const FALLBACK_INDEX: BankIndex = {
  version: '2.0',
  description: 'Karnataka State Syllabus DSERT LBA Official Question Banks',
  files: [
    {
      id: 'maths_class6',
      path: '/assets/aistudio/maths_class6_question_bank_f388d7c3.json',
      grade: '6 ನೇ ತರಗತಿ (Class 6)',
      gradeKey: '6',
      subject: 'ಗಣಿತ (Mathematics)',
      subjectCode: 'MATH',
      medium: 'ಕನ್ನಡ ಮಾಧ್ಯಮ (State Syllabus)',
      academicYear: '2026-27',
    },
    {
      id: 'kannada_class6',
      path: '/assets/aistudio/kannada_class6_question_bank_0e721821.json',
      grade: '6 ನೇ ತರಗತಿ (Class 6)',
      gradeKey: '6',
      subject: 'ಕನ್ನಡ (Kannada)',
      subjectCode: 'KAN',
      medium: 'ಕನ್ನಡ ಮಾಧ್ಯಮ (State Syllabus)',
      academicYear: '2026-27',
    },
    {
      id: 'english_class6',
      path: '/assets/aistudio/english_class6_question_bank_767d543a.json',
      grade: '6 ನೇ ತರಗತಿ (Class 6)',
      gradeKey: '6',
      subject: 'English (Second Language)',
      subjectCode: 'ENG',
      medium: 'ಕನ್ನಡ ಮಾಧ್ಯಮ (State Syllabus)',
      academicYear: '2026-27',
    },
    {
      id: 'hindi_class6',
      path: '/assets/aistudio/hindi_class6_question_bank_98dd4289.json',
      grade: '6 ನೇ ತರಗತಿ (Class 6)',
      gradeKey: '6',
      subject: 'ಹಿಂದಿ (Hindi)',
      subjectCode: 'HIN',
      medium: 'ಕನ್ನಡ ಮಾಧ್ಯಮ (State Syllabus)',
      academicYear: '2026-27',
    },
    {
      id: 'science_class6',
      path: '/assets/aistudio/Class6_Science_Kannada_Chapterwise_QA_Bank_230b74ea.json',
      grade: '6 ನೇ ತರಗತಿ (Class 6)',
      gradeKey: '6',
      subject: 'ವಿಜ್ಞಾನ (Science)',
      subjectCode: 'SCI',
      medium: 'ಕನ್ನಡ ಮಾಧ್ಯಮ (State Syllabus)',
      academicYear: '2026-27',
    },
    {
      id: 'social_class6',
      path: '/assets/aistudio/class-6-social-science-kannada-lba-unicode_1be3aa51.json',
      grade: '6 ನೇ ತರಗತಿ (Class 6)',
      gradeKey: '6',
      subject: 'ಸಮಾಜ ವಿಜ್ಞಾನ (Social Science)',
      subjectCode: 'SOC',
      medium: 'ಕನ್ನಡ ಮಾಧ್ಯಮ (State Syllabus)',
      academicYear: '2026-27',
    },
  ],
};

export const BUILTIN_CLASS6_INDEX_FILES: IndexEntry[] = FALLBACK_INDEX.files;

/**
 * Categorizes any question into one of the 12 standard formats shown in the UI reference
 */
export function categorizeQuestion(
  rawType: string,
  questionText: string,
  marks: number,
  hasOptions: boolean,
  hasItems: boolean
): { id: string; name: string } {
  const t = rawType.toLowerCase().trim();
  const q = questionText.toLowerCase();

  // 1. Multiple Choice
  if (
    hasOptions ||
    t.includes('mcq') ||
    t.includes('ಬಹು ಆಯ್ಕೆ') ||
    t.includes('ಆಯ್ಕೆ') ||
    t.includes('ಬಹುವಿಕಲ್ಪ') ||
    t.includes('बहुविकल्पीय') ||
    t.includes('multiple')
  ) {
    const fmt = STANDARD_QUESTION_FORMATS.find(f => f.id === 'mcq')!;
    return { id: fmt.id, name: fmt.name };
  }

  // 3. True / False
  if (
    t.includes('true_false') ||
    t.includes('truefalse') ||
    t.includes('ಸರಿ ಅಥವಾ ತಪ್ಪು') ||
    t.includes('ಸರಿ/ತಪ್ಪು') ||
    t.includes('ಸರಿ (✓)') ||
    t.includes('सही या गलत') ||
    t.includes('सही-गलत') ||
    q.includes('ಸರಿ ಅಥವಾ ತಪ್ಪು') ||
    q.includes('ಸರಿ [✔] ಅಥವಾ ತಪ್ಪು') ||
    q.includes('सही या गलत')
  ) {
    const fmt = STANDARD_QUESTION_FORMATS.find(f => f.id === 'true_false')!;
    return { id: fmt.id, name: fmt.name };
  }

  // 5. Match the following
  if (
    hasItems ||
    t.includes('match') ||
    t.includes('ಹೊಂದಿಸಿ') ||
    t.includes('ಮಿಲಾನ') ||
    t.includes('मिलान') ||
    t.includes('जोड़िए') ||
    t.includes('rhyming_words') ||
    q.includes('ಹೊಂದಿಸಿ ಬರೆಯಿರಿ') ||
    q.includes('ಜೋಡಿಸಿ ಬರೆಯಿರಿ') ||
    q.includes('मिलान कीजिये') ||
    q.includes('मिलान कीजिए')
  ) {
    const fmt = STANDARD_QUESTION_FORMATS.find(f => f.id === 'match')!;
    return { id: fmt.id, name: fmt.name };
  }

  // 4. Analogy / Related word
  if (
    t.includes('analogy') ||
    t.includes('ಸಂಬಂಧ') ||
    t.includes('ಮೊದಲೆರಡು ಪದ') ||
    t.includes('संबंध') ||
    t.includes('odd_word') ||
    t.includes('odd_one_out') ||
    t.includes('collocation') ||
    q.includes('ಸಂಬಂಧಿಸಿದಂತೆ') ||
    q.includes('::')
  ) {
    const fmt = STANDARD_QUESTION_FORMATS.find(f => f.id === 'analogy')!;
    return { id: fmt.id, name: fmt.name };
  }

  // 2. Fill in the blanks
  if (
    t.includes('fill') ||
    t.includes('blank') ||
    t.includes('ಬಿಟ್ಟ ಸ್ಥಳ') ||
    t.includes('ಖಾಲಿ ಜಾಗ') ||
    t.includes('रिक्त स्थान') ||
    t.includes('खाली स्थान') ||
    t.includes('word_clue') ||
    t.includes('counting') ||
    q.includes('_____') ||
    q.includes('-----') ||
    q.includes('ಬಿಟ್ಟ ಸ್ಥಳ') ||
    q.includes('ಖಾಲಿ ಬಿಟ್ಟ') ||
    q.includes('रिक्त स्थान')
  ) {
    const fmt = STANDARD_QUESTION_FORMATS.find(f => f.id === 'fill_blank')!;
    return { id: fmt.id, name: fmt.name };
  }

  // 8. Who said to whom / Reference to context
  if (
    t.includes('who_said') ||
    t.includes('reference_context') ||
    t.includes('speaker') ||
    t.includes('ಯಾರು ಯಾರಿಗೆ') ||
    t.includes('ಸಂದರ್ಭ') ||
    t.includes('किसने किससे') ||
    q.includes('ಯಾರು ಯಾರಿಗೆ ಹೇಳಿದರು') ||
    q.includes('ಸಂದರ್ಭ ಸಹಿತ') ||
    q.includes('किसने किससे कहा')
  ) {
    const fmt = STANDARD_QUESTION_FORMATS.find(f => f.id === 'who_said')!;
    return { id: fmt.id, name: fmt.name };
  }

  // 9. Passage / Picture question
  if (
    t.includes('comprehension') ||
    t.includes('picture') ||
    t.includes('ಚಿತ್ರ') ||
    t.includes('ಗದ್ಯಭಾಗ') ||
    t.includes('ಪಠ್ಯ ಓದಿ') ||
    t.includes('गद्यांश') ||
    t.includes('अनुच्छेद') ||
    t.includes('चित्र') ||
    q.includes('ಚಿತ್ರವನ್ನು ಗಮನಿಸಿ') ||
    q.includes('ಗದ್ಯಭಾಗವನ್ನು ಓದಿ') ||
    q.includes('ಪರಿಚ್ಛೇದವನ್ನು ಓದಿ') ||
    q.includes('गद्यांश') ||
    q.includes('चित्र देखकर')
  ) {
    const fmt = STANDARD_QUESTION_FORMATS.find(f => f.id === 'passage_pic')!;
    return { id: fmt.id, name: fmt.name };
  }

  // 10. Grammar section
  if (
    t.includes('grammar') ||
    t.includes('sandhi') ||
    t.includes('synonyms') ||
    t.includes('antonyms') ||
    t.includes('translation') ||
    t.includes('ವ್ಯಾಕರಣ') ||
    t.includes('ಸಂಧಿ') ||
    t.includes('ವಿಭಕ್ತಿ') ||
    t.includes('ಲಿಂಗ') ||
    t.includes('ತತ್ಸಮ') ||
    t.includes('ವಿರುದ್ಧಾರ್ಥಕ') ||
    t.includes('व्याकरण') ||
    t.includes('विलोम') ||
    t.includes('समानार्थक') ||
    t.includes('पर्यायवाची') ||
    t.includes('वचन') ||
    t.includes('लिंग')
  ) {
    const fmt = STANDARD_QUESTION_FORMATS.find(f => f.id === 'grammar_section')!;
    return { id: fmt.id, name: fmt.name };
  }

  // 12. Long answer / Essay / Drawing
  if (
    marks >= 4 ||
    t.includes('essay') ||
    t.includes('quote_memory') ||
    t.includes('ಕಂಠಪಾಠ') ||
    t.includes('ಪ್ರಬಂಧ') ||
    t.includes('ದೀರ್ಘ') ||
    t.includes('ವಿವರಣಾತ್ಮಕ')
  ) {
    const fmt = STANDARD_QUESTION_FORMATS.find(f => f.id === 'long_4m')!;
    return { id: fmt.id, name: fmt.name };
  }

  // 11. 3M / 4-6 sentences
  if (marks === 3 || t.includes('problem_solving') || t.includes('೪-೬ ವಾಕ್ಯ') || t.includes('ಮೂರು ಅಥವಾ ನಾಲ್ಕು')) {
    const fmt = STANDARD_QUESTION_FORMATS.find(f => f.id === 'short_3m')!;
    return { id: fmt.id, name: fmt.name };
  }

  // 7. 2M / 2-3 sentences
  if (marks === 2 || t.includes('short_answer') || t.includes('೨-೩ ವಾಕ್ಯ') || t.includes('ಎರಡು ಅಥವಾ ಮೂರು')) {
    const fmt = STANDARD_QUESTION_FORMATS.find(f => f.id === 'short_2m')!;
    return { id: fmt.id, name: fmt.name };
  }

  // 6. 1M / One sentence
  const fmt = STANDARD_QUESTION_FORMATS.find(f => f.id === 'one_sentence')!;
  return { id: fmt.id, name: fmt.name };
}

/**
 * Normalizes question object across all 6 subject schemas
 */
function normalizeQuestion(
  raw: Record<string, unknown>,
  chapterName: string,
  chapterId: string,
  chapterNumber: number,
  idx: number,
  fallbackMarks = 1
): QuestionItem {
  const id = String(raw.id || raw.questionId || `${chapterId}_q${idx + 1}`);
  const question = String(
    raw.question || raw.questionText || raw.text || raw.question_name || ''
  ).trim();

  let answer = String(raw.answer || raw.modelAnswerText || raw.solution || raw.answerText || '').trim();
  if (!answer || answer === 'null' || answer === 'undefined') {
    answer = 'ಉತ್ತರ ಲಭ್ಯವಿಲ್ಲ';
  }

  const rawType = String(
    raw.questionType || raw.type || raw.question_type || raw.sectionType || ''
  );

  let marks = Number(raw.marks || raw.marks_per_question || raw.mark || fallbackMarks);
  if (!marks || isNaN(marks) || marks < 1) marks = fallbackMarks;

  const learningOutcome = raw.learningOutcome
    ? String(raw.learningOutcome)
    : raw.learning_outcome
    ? String(raw.learning_outcome)
    : undefined;

  let rawDiff = String(
    raw.difficulty || raw.difficultyLabel || raw.difficultyLevel || raw.level || ''
  ).trim();
  let difficulty = 'ಸಾಧಾರಣ';
  const diffLower = rawDiff.toLowerCase();
  if (
    diffLower.includes('ಸುಲಭ') ||
    diffLower.includes('easy') ||
    diffLower.includes('सरल') ||
    diffLower === '1'
  ) {
    difficulty = 'ಸುಲಭ';
  } else if (
    diffLower.includes('ಕಠಿಣ') ||
    diffLower.includes('difficult') ||
    diffLower.includes('hard') ||
    diffLower.includes('कठिन') ||
    diffLower === '3'
  ) {
    difficulty = 'ಕಠಿಣ';
  } else if (
    diffLower.includes('ಸಾಧಾರಣ') ||
    diffLower.includes('medium') ||
    diffLower.includes('average') ||
    diffLower.includes('सामान्य') ||
    diffLower.includes('ಮಧ್ಯಮ') ||
    diffLower === '2'
  ) {
    difficulty = 'ಸಾಧಾರಣ';
  } else {
    // If not specified in raw JSON, intelligently assign based on question format & marks
    if (marks === 1) {
      difficulty = idx % 3 === 0 ? 'ಸಾಧಾರಣ' : 'ಸುಲಭ';
    } else if (marks === 2) {
      difficulty = idx % 4 === 0 ? 'ಕಠಿಣ' : idx % 2 === 0 ? 'ಸುಲಭ' : 'ಸಾಧಾರಣ';
    } else {
      difficulty = idx % 2 === 0 ? 'ಕಠಿಣ' : 'ಸಾಧಾರಣ';
    }
  }

  // Objective / Bloom's Taxonomy (ಜ್ಞಾನ, ತಿಳುವಳಿಕೆ, ಅನ್ವಯ, ಕೌಶಲ)
  let rawObj = String(
    raw.objective || raw.objectiveName || raw.taxonomy || raw.bloomTaxonomy || ''
  ).trim();
  let objective = 'ಜ್ಞಾನ';
  const objLower = rawObj.toLowerCase();
  if (objLower.includes('ಕೌಶಲ') || objLower.includes('skill')) {
    objective = 'ಕೌಶಲ';
  } else if (objLower.includes('ಅನ್ವಯ') || objLower.includes('apply') || objLower.includes('application')) {
    objective = 'ಅನ್ವಯ';
  } else if (objLower.includes('ತಿಳುವಳಿಕೆ') || objLower.includes('understanding') || objLower.includes('comprehension')) {
    objective = 'ತಿಳುವಳಿಕೆ';
  } else if (objLower.includes('ಜ್ಞಾನ') || objLower.includes('knowledge') || objLower.includes('recall')) {
    objective = 'ಜ್ಞಾನ';
  } else {
    // Intelligently deduce objective from question characteristics
    const qLower = question.toLowerCase();
    if (
      qLower.includes('ಚಿತ್ರ') ||
      qLower.includes('ರೇಖಾಚಿತ್ರ') ||
      qLower.includes('ಗುರುತಿಸಿ') ||
      qLower.includes('ನಕ್ಷೆ') ||
      qLower.includes('ರಚಿಸಿ') ||
      qLower.includes('ಸಾಧಿಸಿ') ||
      qLower.includes('draw') ||
      qLower.includes('diagram') ||
      qLower.includes('map') ||
      qLower.includes('graph')
    ) {
      objective = 'ಕೌಶಲ';
    } else if (
      qLower.includes('ಕಾರಣ') ||
      qLower.includes('ಏಕೆ') ||
      qLower.includes('ಹೇಗೆ') ||
      qLower.includes('ಅನ್ವಯ') ||
      qLower.includes('ಸ್ವಂತ ವಾಕ್ಯ') ||
      qLower.includes('ಬಳಸಿ') ||
      qLower.includes('ವ್ಯತ್ಯಾಸ') ||
      qLower.includes('ಹೋಲಿಸಿ') ||
      marks >= 3
    ) {
      objective = 'ಅನ್ವಯ';
    } else if (
      qLower.includes('ವಿವರಿಸಿ') ||
      qLower.includes('ತಿಳಿಸಿ') ||
      qLower.includes('ವ್ಯಾಖ್ಯಾನಿಸಿ') ||
      qLower.includes('ಲಕ್ಷಣಗಳು') ||
      qLower.includes('ಉದ್ದೇಶ') ||
      qLower.includes('ಪ್ರಯೋಜನ') ||
      marks === 2
    ) {
      objective = 'ತಿಳುವಳಿಕೆ';
    } else {
      // Deterministically cycle [ಜ್ಞಾನ, ತಿಳುವಳಿಕೆ, ಅನ್ವಯ, ಕೌಶಲ] so blueprint always has all 4
      const objCycle = ['ಜ್ಞಾನ', 'ತಿಳುವಳಿಕೆ', 'ಅನ್ವಯ', 'ಕೌಶಲ'];
      objective = objCycle[(idx + chapterNumber) % 4];
    }
  }

  let options: string[] | undefined = undefined;
  if (Array.isArray(raw.options)) {
    options = raw.options.map(opt => (typeof opt === 'string' ? opt : JSON.stringify(opt)));
  } else if (raw.options && typeof raw.options === 'object') {
    options = Object.entries(raw.options as Record<string, string>).map(
      ([k, v]) => `${k}) ${v}`
    );
  }

  let items: Array<{ left: string; right: string }> | undefined = undefined;
  if (Array.isArray(raw.items)) {
    items = raw.items as Array<{ left: string; right: string }>;
  }

  // Categorize into one of 12 standard formats
  const hasOpts = Boolean(options && options.length > 0);
  const hasItms = Boolean(items && items.length > 0);
  const category = categorizeQuestion(rawType, question, marks, hasOpts, hasItms);

  // Synchronize default marks according to format
  const stdDef = STANDARD_QUESTION_FORMATS.find(f => f.id === category.id);
  // Match-the-following questions carry 1 mark per sub-item (e.g. 4 items = 4 marks, 5 items = 5 marks)
  if (category.id === 'match' || (hasItms && items && items.length >= 2)) {
    const itmCount = (items && items.length) ? items.length : 4;
    marks = Math.max(3, itmCount);
  } else if (stdDef && !raw.marks) {
    marks = stdDef.marks;
  }

  return {
    ...raw,
    id,
    question,
    answer,
    questionType: rawType || category.name,
    formatCategoryId: category.id,
    formatCategoryName: category.name,
    marks,
    learningOutcome,
    difficulty,
    objective,
    objectiveName: objective,
    options,
    items,
    chapterId,
    chapterName,
    chapterNumber,
  };
}

/**
 * Extracts normalized numeric grade key from any Kannada/Devanagari/English/Roman grade string
 */
export function extractGradeKey(gradeStr: string | undefined | null): string {
  if (!gradeStr) return '6';
  const kannadaDigits = ['೦', '೧', '೨', '೩', '೪', '೫', '೬', '೭', '೮', '೯'];
  const devanagariDigits = ['०', '१', '२', '३', '४', '५', '६', '७', '८', '९'];
  let s = String(gradeStr);
  kannadaDigits.forEach((kd, idx) => {
    s = s.replaceAll(kd, String(idx));
  });
  devanagariDigits.forEach((dd, idx) => {
    s = s.replaceAll(dd, String(idx));
  });
  const m = s.match(/\d+/);
  if (m) return m[0];

  const romanMap: Array<[RegExp, string]> = [
    [/\bXII\b/i, '12'],
    [/\bXI\b/i, '11'],
    [/\bIX\b/i, '9'],
    [/\bX\b/i, '10'],
    [/\bVIII\b/i, '8'],
    [/\bVII\b/i, '7'],
    [/\bVI\b/i, '6'],
    [/\bV\b/i, '5'],
  ];
  for (const [regex, num] of romanMap) {
    if (regex.test(s)) return num;
  }
  return '6';
}

/**
 * Normalizes subject names into official Kannada & English labels.
 * CRITICAL: Social Science (ಸಮಾಜ / ಸಾಮಾಜಿಕ ವಿಜ್ಞಾನ) MUST be checked BEFORE Science (ವಿಜ್ಞಾನ)
 * because both contain the substring "ವಿಜ್ಞಾನ".
 */
export function normalizeSubjectName(subjectStr: string | undefined | null): string {
  if (!subjectStr) return 'ಗಣಿತ (Mathematics)';
  const s = String(subjectStr).replace(/\s*★\s*\(ಉಳಿಸಿದ\)/g, '').replace(/★/g, '').trim();
  const lower = s.toLowerCase();
  if (lower.includes('ಸಮಾಜ') || lower.includes('ಸಾಮಾಜಿಕ') || lower.includes('social')) {
    return 'ಸಮಾಜ ವಿಜ್ಞಾನ (Social Science)';
  }
  if (lower.includes('ವಿಜ್ಞಾನ') || lower.includes('science')) return 'ವಿಜ್ಞಾನ (Science)';
  if (lower.includes('ಗಣಿತ') || lower.includes('math')) return 'ಗಣಿತ (Mathematics)';
  if (lower.includes('ಕನ್ನಡ') || lower.includes('kannada')) {
    if (lower.includes('ದ್ವಿತೀಯ') || lower.includes('second') || lower.includes('l2')) {
      return 'ದ್ವಿತೀಯ ಭಾಷೆ ಕನ್ನಡ (Kannada 2nd Lang)';
    }
    if (lower.includes('ತೃತೀಯ') || lower.includes('third') || lower.includes('l3')) {
      return 'ತೃತೀಯ ಭಾಷೆ ಕನ್ನಡ (Kannada 3rd Lang)';
    }
    return 'ಪ್ರಥಮ ಭಾಷೆ ಕನ್ನಡ (Kannada)';
  }
  if (lower.includes('ಇಂಗ್ಲಿಷ್') || lower.includes('english')) {
    if (lower.includes('first') || lower.includes('ಪ್ರಥಮ') || lower.includes('fl') || lower.includes('l1')) {
      return 'English (First Language)';
    }
    if (lower.includes('third') || lower.includes('ತೃತೀಯ') || lower.includes('tl') || lower.includes('l3')) {
      return 'English (Third Language)';
    }
    return 'English (Second Language)';
  }
  if (lower.includes('ಹಿಂದಿ') || lower.includes('hindi') || lower.includes('हिंदी') || lower.includes('हिन्दी')) {
    return 'ಹಿಂದಿ (Hindi)';
  }
  if (lower.includes('ಸಂಸ್ಕೃತ') || lower.includes('sanskrit') || lower.includes('संस्कृत')) {
    return 'ಸಂಸ್ಕೃತ (Sanskrit)';
  }
  if (lower.includes('ಉರ್ದು') || lower.includes('urdu')) return 'ಉರ್ದು (Urdu)';
  if (lower.includes('ಮರಾಠಿ') || lower.includes('marathi')) return 'ಮರಾಠಿ (Marathi)';
  if (lower.includes('ತಮಿಳು') || lower.includes('tamil')) return 'ತಮಿಳು (Tamil)';
  if (lower.includes('ತೆಲುಗು') || lower.includes('telugu')) return 'ತೆಲುಗು (Telugu)';
  return s;
}

/**
 * Deduces standard subject code inspecting BOTH subjectCode and fallback subject name.
 * Handles prefixed codes (KAN-L1, ENG-SL, HIN-L3, MAT, SS, SCI-9) and Kannada variants (ಸಾಮಾಜಿಕ ವಿಜ್ಞಾನ).
 */
export function deduceSubjectCode(
  subjectCodeOrName: string | undefined | null,
  fallbackSubjectName?: string | undefined | null
): string {
  const combined = `${subjectCodeOrName || ''} ${fallbackSubjectName || ''}`.trim().toLowerCase();
  if (!combined) return 'GEN';

  const codeToken = String(subjectCodeOrName || '')
    .trim()
    .toLowerCase()
    .split(/[-_\s/()]+/)[0];

  if (
    codeToken === 'soc' ||
    codeToken === 'ss' ||
    codeToken === 'sst' ||
    combined.includes('ಸಮಾಜ') ||
    combined.includes('ಸಾಮಾಜಿಕ') ||
    combined.includes('social')
  ) {
    return 'SOC';
  }
  if (
    codeToken === 'sci' ||
    combined.includes('ವಿಜ್ಞಾನ') ||
    combined.includes('science')
  ) {
    return 'SCI';
  }
  if (
    codeToken === 'math' ||
    codeToken === 'maths' ||
    codeToken === 'mat' ||
    combined.includes('ಗಣಿತ') ||
    combined.includes('math')
  ) {
    return 'MATH';
  }
  if (
    codeToken === 'kan' ||
    combined.includes('ಕನ್ನಡ') ||
    combined.includes('kannada')
  ) {
    return 'KAN';
  }
  if (
    codeToken === 'eng' ||
    combined.includes('ಇಂಗ್ಲಿಷ್') ||
    combined.includes('english')
  ) {
    return 'ENG';
  }
  if (
    codeToken === 'hin' ||
    combined.includes('ಹಿಂದಿ') ||
    combined.includes('hindi') ||
    combined.includes('हिंदी') ||
    combined.includes('हिन्दी')
  ) {
    return 'HIN';
  }
  if (
    codeToken === 'san' ||
    codeToken === 'sans' ||
    combined.includes('ಸಂಸ್ಕೃತ') ||
    combined.includes('sanskrit') ||
    combined.includes('संस्कृत')
  ) {
    return 'SAN';
  }
  if (codeToken === 'urd' || combined.includes('ಉರ್ದು') || combined.includes('urdu')) return 'URD';
  if (codeToken === 'mar' || combined.includes('ಮರಾಠಿ') || combined.includes('marathi')) return 'MAR';
  if (codeToken === 'tam' || combined.includes('ತಮಿಳು') || combined.includes('tamil')) return 'TAM';
  if (codeToken === 'tel' || combined.includes('ತೆಲುಗು') || combined.includes('telugu')) return 'TEL';
  if (codeToken === 'comp' || codeToken === 'cs' || combined.includes('ಕಂಪ್ಯೂಟರ್') || combined.includes('computer')) {
    return 'COMP';
  }
  if (codeToken === 'pe' || combined.includes('ದೈಹಿಕ') || combined.includes('physical education')) return 'PE';
  return 'GEN';
}

/**
 * Normalizes teaching medium into a stable bucket ('english' | 'kannada' | 'other')
 * so Kannada Medium and English Medium banks for the same Class & Subject are BOTH preserved.
 */
export function normalizeMediumBucket(medium: string | undefined | null): string {
  const m = String(medium || '').toLowerCase();
  if (m.includes('english') || m.includes('ಇಂಗ್ಲಿಷ್') || /\bem\b/.test(m)) return 'english';
  if (m.includes('ಕನ್ನಡ') || m.includes('kannada') || /\bkm\b/.test(m)) return 'kannada';
  return 'default';
}

/**
 * Returns a collision-free deduplication key for a Question Bank entry.
 * Preserves:
 *  - Every distinct subject (never collapses custom subjects into bare 'GEN')
 *  - Language tiers (e.g. English First Language vs Second Language)
 *  - Distinct mediums for the same class + subject (e.g. 9th Science English Medium vs Kannada Medium)
 * While still cleanly merging exact duplicates of the same bank synced to both Server Disk & Firebase.
 */
export function getSubjectDedupKey(entry: {
  grade?: string;
  gradeKey?: string;
  subject?: string;
  subjectCode?: string;
  medium?: string;
}): string {
  const gKey = extractGradeKey(entry.gradeKey || entry.grade);
  const sCode = deduceSubjectCode(entry.subjectCode, entry.subject);
  const cleanSub = normalizeSubjectName(entry.subject).toLowerCase();

  let subPart = sCode;
  if (sCode === 'GEN') {
    subPart = `GEN:${cleanSub || 'unknown'}`;
  } else if (sCode === 'ENG' || sCode === 'KAN' || sCode === 'HIN') {
    const rawCombined = `${entry.subjectCode || ''} ${entry.subject || ''}`.toLowerCase();
    if (rawCombined.includes('first') || rawCombined.includes('ಪ್ರಥಮ') || rawCombined.includes('l1') || rawCombined.includes('fl')) {
      subPart = `${sCode}:L1`;
    } else if (rawCombined.includes('second') || rawCombined.includes('ದ್ವಿತೀಯ') || rawCombined.includes('l2') || rawCombined.includes('sl')) {
      subPart = `${sCode}:L2`;
    } else if (rawCombined.includes('third') || rawCombined.includes('ತೃತೀಯ') || rawCombined.includes('l3') || rawCombined.includes('tl')) {
      subPart = `${sCode}:L3`;
    }
  }

  // For language subjects (KAN/ENG/HIN), medium strings often vary trivially (e.g. "English / State Syllabus" vs "ಕನ್ನಡ ಮಾಧ್ಯಮ")
  // whereas for core subjects (MATH/SCI/SOC/GEN), Kannada Medium and English Medium are genuinely distinct question banks!
  const medPart =
    sCode === 'KAN' || sCode === 'ENG' || sCode === 'HIN'
      ? 'lang'
      : normalizeMediumBucket(entry.medium);

  return `${gKey}::${subPart}::${medPart}`;
}

/**
 * Formats a clean subject dropdown label, automatically showing the medium badge
 * when a class has multiple banks sharing the same normalized subject name (e.g. EM & KM).
 */
export function formatDropdownSubjectLabel(
  file: IndexEntry,
  siblingsInGrade: IndexEntry[]
): string {
  const baseName = normalizeSubjectName(file.subject);
  const sameNameCount = siblingsInGrade.filter(
    other => normalizeSubjectName(other.subject) === baseName
  ).length;
  const medBucket = normalizeMediumBucket(file.medium);
  const showMediumTag = sameNameCount > 1 || medBucket === 'english';
  const medTag =
    showMediumTag && file.medium
      ? medBucket === 'english'
        ? ' [English Med]'
        : medBucket === 'kannada'
          ? ' [ಕನ್ನಡ ಮಾಧ್ಯಮ]'
          : ` [${file.medium}]`
      : '';
  return `${baseName}${medTag}${file.isUserGenerated ? ' ★' : ''}`;
}

/**
 * Returns canonical Kannada/English display label for a grade key
 */
export function canonicalGradeLabel(gradeKey: string): string {
  switch (gradeKey) {
    case '6':
      return '6 ನೇ ತರಗತಿ (Class 6)';
    case '7':
      return '7 ನೇ ತರಗತಿ (Class 7)';
    case '8':
      return '8 ನೇ ತರಗತಿ (Class 8)';
    case '9':
      return '9 ನೇ ತರಗತಿ (Class 9)';
    case '10':
      return '10 ನೇ ತರಗತಿ (Class 10)';
    default:
      return `${gradeKey} ನೇ ತರಗತಿ (Class ${gradeKey})`;
  }
}

/**
 * Helper to match a file's grade against a selected grade string (handles Kannada/Devanagari/Roman numerals)
 */
export function matchesGrade(
  file: { grade?: string; gradeKey?: string } | null | undefined,
  targetGrade: string
): boolean {
  if (!file || !targetGrade) return false;
  const targetKey = extractGradeKey(targetGrade);
  const fileKey = extractGradeKey(file.gradeKey || file.grade);
  return fileKey === targetKey;
}

/**
 * Normalizes chapter object (handling both direct questions and sectioned questions)
 */
function normalizeChapter(
  raw: Record<string, unknown>,
  idx: number,
  totalChapters: number,
  forceEvenSemesterSplit: boolean = false
): Chapter {
  const chapterId = String(raw.chapterId || raw.id || raw.chapter_id || `ch_${idx + 1}`);
  const chapterNumber = raw.chapterNumber
    ? Number(raw.chapterNumber)
    : raw.chapter_number
    ? Number(raw.chapter_number)
    : raw.unit_number
    ? Number(raw.unit_number)
    : idx + 1;

  const chapterName = String(
    raw.chapterName || raw.title || raw.chapter_name || raw.name || `ಅಧ್ಯಾಯ ${chapterNumber}`
  ).trim();

  // Determine semester: if explicit and not forced to split, use provided semester;
  // otherwise split first half = Sem 1, second half = Sem 2
  let semester: 1 | 2;
  const rawSem = Number(raw.semester);
  if (!forceEvenSemesterSplit && (rawSem === 1 || rawSem === 2)) {
    semester = rawSem as 1 | 2;
  } else {
    semester = chapterNumber <= Math.ceil(totalChapters / 2) ? 1 : 2;
  }

  const extractedQuestions: QuestionItem[] = [];

  // Helper: Expands bundled subquestions (e.g. "एक वाक्य में उत्तर लिखिए : 1. ... 2. ... 11. ...")
  // into individual 1-mark questions so each question can be selected and scored individually!
  const expandQuestionIfNeeded = (rawObj: Record<string, unknown>, qIndex: number, fallbackMarks: number) => {
    const qText = String(
      rawObj.question || rawObj.questionText || rawObj.text || rawObj.question_name || ''
    ).trim();
    const ansText = String(rawObj.answer || rawObj.answerText || '').trim();
    const rawType = String(rawObj.questionType || rawObj.type || '').toLowerCase();
    const rawCat = String(rawObj.formatCategoryId || '').toLowerCase();

    // Check if it's already a match or has options/diagram
    const isMatch = rawType.includes('match') || rawType.includes('ಹೊಂದಿಸಿ') || rawType.includes('मिलान') || rawCat === 'match' || Array.isArray(rawObj.items);
    const hasOptions = Array.isArray(rawObj.options) && rawObj.options.length > 0;

    // Pattern to detect numbered sub-questions like "1. ", "2. ", "1) ", "2) "
    const numRegex = /(?:^|\n)\s*(\d{1,2})[\.\)]\s*/g;
    const qMatches = [...qText.matchAll(numRegex)];

    if (!isMatch && !hasOptions && qMatches.length >= 3) {
      // It's a bundle of 3 or more subquestions!
      const pattern = /(?:^|\n)\s*(\d{1,2})[\.\)]\s*/;
      const qParts = qText.split(pattern);
      const mainHeader = qParts[0].trim();

      // Also split answer if formatted with numbered answers
      const aParts = ansText.split(pattern);
      const aMap: Record<string, string> = {};
      for (let i = 1; i < aParts.length; i += 2) {
        aMap[aParts[i]] = (aParts[i + 1] || '').trim();
      }

      let subIdx = 0;
      for (let i = 1; i < qParts.length; i += 2) {
        const subNum = qParts[i];
        const subBody = (qParts[i + 1] || '').trim();
        if (!subBody) continue;

        const subAnswer = aMap[subNum] || ansText || 'ಉತ್ತರ ಲಭ್ಯವಿಲ್ಲ';
        const singleSubQ: Record<string, unknown> = {
          ...rawObj,
          id: `${rawObj.id || chapterId + '_q' + qIndex}_sub${subNum}`,
          question: subBody,
          answer: subAnswer,
          questionType: mainHeader || 'ಒಂದು ವಾಕ್ಯದಲ್ಲಿ ಉತ್ತರಿಸಿ',
          formatCategoryId: 'one_sentence',
          formatCategoryName: '೧. ಒಂದು ವಾಕ್ಯದ ಪ್ರಶ್ನೆ (1M)',
          marks: 1, // Each discrete question gets 1 mark!
        };

        extractedQuestions.push(
          normalizeQuestion(singleSubQ, chapterName, chapterId, chapterNumber, extractedQuestions.length, 1)
        );
        subIdx++;
      }
      if (subIdx > 0) return;
    }

    // Default: Not a bundle, normalize normally
    extractedQuestions.push(
      normalizeQuestion(rawObj, chapterName, chapterId, chapterNumber, extractedQuestions.length, fallbackMarks)
    );
  };

  // Case A: Direct questions array
  if (Array.isArray(raw.questions) && raw.questions.length > 0) {
    raw.questions.forEach((q, qIdx) => {
      expandQuestionIfNeeded(q as Record<string, unknown>, qIdx, 1);
    });
  }

  // Case B: Questions inside sections array
  if (Array.isArray(raw.sections)) {
    for (const sec of raw.sections as Record<string, unknown>[]) {
      const secTitle = String(sec.title || '');
      const secInstructions = String(sec.instructions || '');
      const secMarks = Number(sec.marks_per_question || sec.marks || 1);
      const secQuestions = Array.isArray(sec.questions) ? sec.questions : [];

      secQuestions.forEach((q, qIdx) => {
        const itemObj = {
          ...(q as Record<string, unknown>),
          sectionTitle: secTitle,
          sectionInstructions: secInstructions,
        };
        expandQuestionIfNeeded(itemObj, qIdx, secMarks);
      });
    }
  }

  const questionPages =
    typeof raw.questionPages === 'string' && raw.questionPages.trim()
      ? raw.questionPages.trim()
      : typeof raw.question_pages === 'string' && raw.question_pages.trim()
      ? raw.question_pages.trim()
      : undefined;
  const answerPages =
    typeof raw.answerPages === 'string' && raw.answerPages.trim()
      ? raw.answerPages.trim()
      : typeof raw.answer_pages === 'string' && raw.answer_pages.trim()
      ? raw.answer_pages.trim()
      : undefined;
  const printedPages =
    typeof raw.printedPages === 'string' && raw.printedPages.trim()
      ? raw.printedPages.trim()
      : typeof raw.printed_pages === 'string' && raw.printed_pages.trim()
      ? raw.printed_pages.trim()
      : undefined;

  return {
    chapterId,
    chapterNumber,
    chapterName,
    semester,
    ...(questionPages ? { questionPages } : {}),
    ...(answerPages ? { answerPages } : {}),
    ...(printedPages ? { printedPages } : {}),
    questions: extractedQuestions,
  };
}

/**
 * Guarantees every chapterId and every question id is globally unique across a QuestionBank.
 * Prevents React duplicate-key warnings (e.g., colliding "q-5-94" across chapters or multi-pass extracts)
 * and ensures image attachments/edits target the exact intended question.
 */
export function ensureUniqueQuestionIds(bank: QuestionBank): QuestionBank {
  if (!bank || !Array.isArray(bank.chapters)) return bank;

  const seenChapterIds = new Set<string>();
  const seenQuestionIds = new Set<string>();
  let mutated = false;

  const chapters = bank.chapters.map((ch, cIdx) => {
    let chapterId = String(ch.chapterId || `ch-${ch.chapterNumber || cIdx + 1}`).trim();
    if (!chapterId) chapterId = `ch-${cIdx + 1}`;
    if (seenChapterIds.has(chapterId)) {
      let suffix = 2;
      while (seenChapterIds.has(`${chapterId}_${suffix}`)) suffix++;
      chapterId = `${chapterId}_${suffix}`;
      mutated = true;
    }
    seenChapterIds.add(chapterId);

    const rawQuestions = Array.isArray(ch.questions) ? ch.questions : [];
    const questions = rawQuestions.map((q, qIdx) => {
      let qId = String(q.id || `q-${ch.chapterNumber || cIdx + 1}-${qIdx + 1}`).trim();
      if (!qId) qId = `q-${ch.chapterNumber || cIdx + 1}-${qIdx + 1}`;
      if (seenQuestionIds.has(qId)) {
        let suffix = 2;
        while (seenQuestionIds.has(`${qId}__${suffix}`)) suffix++;
        qId = `${qId}__${suffix}`;
        mutated = true;
      }
      seenQuestionIds.add(qId);

      if (qId !== q.id || q.chapterId !== chapterId) {
        mutated = true;
        return {
          ...q,
          id: qId,
          chapterId,
        };
      }
      return q;
    });

    if (chapterId !== ch.chapterId || mutated) {
      return {
        ...ch,
        chapterId,
        questions,
      };
    }
    return ch;
  });

  return mutated ? { ...bank, chapters } : bank;
}

/**
 * Normalizes complete question bank
 */
export function normalizeQuestionBank(raw: Record<string, unknown>): QuestionBank {
  const rawMeta = (raw.metadata || raw.meta || {}) as Record<string, unknown>;

  const rawChapters = Array.isArray(raw.chapters) ? raw.chapters : [];
  const totalChapters = rawChapters.length;

  // Check if all chapters share the exact same semester (e.g. all 1 or all undefined)
  const allSameSemester =
    totalChapters > 1 &&
    rawChapters.every(
      c =>
        Number((c as Record<string, unknown>).semester) ===
        Number((rawChapters[0] as Record<string, unknown>).semester)
    );

  const chapters = rawChapters.map((ch, idx) =>
    normalizeChapter(ch as Record<string, unknown>, idx, totalChapters, allSameSemester)
  );

  const rawGrade = String(rawMeta.grade || rawMeta.class || '6 ನೇ ತರಗತಿ (Class 6)');
  const detectedNum = extractGradeKey(
    rawMeta.gradeKey ? String(rawMeta.gradeKey) : rawGrade
  );
  const rawSubject = String(rawMeta.subject || 'ಗಣಿತ (Mathematics)');
  const resolvedSubjectCode = deduceSubjectCode(
    rawMeta.subjectCode ? String(rawMeta.subjectCode) : undefined,
    rawSubject
  );

  const metadata = {
    ...rawMeta,
    grade: rawGrade,
    gradeKey: detectedNum,
    subject: rawSubject,
    subjectCode: resolvedSubjectCode,
    medium: String(rawMeta.medium || 'ಕನ್ನಡ ಮಾಧ್ಯಮ (State Syllabus)'),
    board: rawMeta.board ? String(rawMeta.board) : 'ಕರ್ನಾಟಕ ರಾಜ್ಯ ಪಠ್ಯಕ್ರಮ (DSERT / KSEEB)',
    academicYear: String(rawMeta.academic_year || rawMeta.academicYear || '2026-27'),
    author: String(rawMeta.author || 'S R Angadi'),
    totalChapters: chapters.length,
  };

  return ensureUniqueQuestionIds({
    metadata,
    chapters,
  });
}

/**
 * Counts how many questions in a QuestionBank have at least one attached image or diagram SVG
 */
export function countBankUploadedImages(bank: QuestionBank | null | undefined): number {
  if (!bank || !Array.isArray(bank.chapters)) return 0;
  return bank.chapters.reduce(
    (sum, ch) =>
      sum +
      (ch.questions || []).filter(q =>
        Boolean(
          (typeof q.imageUrl === 'string' && q.imageUrl.trim()) ||
            (typeof q.diagramSvg === 'string' && q.diagramSvg.trim()) ||
            (typeof q.answerImageUrl === 'string' && q.answerImageUrl.trim()) ||
            (typeof q.answerDiagramSvg === 'string' && q.answerDiagramSvg.trim())
        )
      ).length,
    0
  );
}

/**
 * Registers an in-memory or newly generated Question Bank
 */
export function registerCustomBank(bank: QuestionBank, entry: IndexEntry) {
  const sanitized = ensureUniqueQuestionIds(bank);
  bankCache.set(entry.id, sanitized);
  if (entry.path) {
    bankCache.set(entry.path, sanitized);
  }
}

/**
 * Fetches central data/index.json, user-saved banks from /api/saved-question-banks,
 * Firebase Firestore question_banks (including chunked large banks), and any locally
 * cached draft bank in browser localStorage.
 */
export async function fetchBankIndex(): Promise<BankIndex> {
  let combinedFiles: IndexEntry[] = [...FALLBACK_INDEX.files];

  // 1. Fetch user-saved banks from server API or static file (with retry)
  try {
    let userData: { files?: IndexEntry[] } | null = null;
    try {
      userData = await fetchJsonWithRetry<{ files?: IndexEntry[] }>('/api/saved-question-banks', 2);
    } catch {
      try {
        userData = await fetchJsonWithRetry<{ files?: IndexEntry[] }>('/assets/user_banks/index.json', 2);
      } catch {
        userData = null;
      }
    }
    if (userData && Array.isArray(userData.files) && userData.files.length > 0) {
      const existingIds = new Set(userData.files.map(f => f.id));
      combinedFiles = [...userData.files, ...combinedFiles.filter(f => !existingIds.has(f.id))];
    }
  } catch {
    // Continue with built-in fallback index
  }

  // 2. Discover Question Banks stored in Firebase Firestore
  //    CRITICAL: NEVER skip a Firebase bank when a server disk file shares the same `id`!
  //    Server disk copies can be stale/older snapshots with far fewer uploaded images,
  //    whereas Firebase Firestore holds the authoritative latest images & edits.
  try {
    const fbBanks = await getQuestionBanksFromFirebase();
    for (const fbBank of fbBanks) {
      const bId: string =
        typeof fbBank.metadata.id === 'string' && fbBank.metadata.id
          ? fbBank.metadata.id
          : `fb_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const gKey = extractGradeKey(
        (fbBank.metadata as any).gradeKey || fbBank.metadata.grade || (fbBank.metadata as any).class
      );
      const canonGrade = canonicalGradeLabel(gKey);
      const canonSubject = normalizeSubjectName(fbBank.metadata.subject);
      const sCode = deduceSubjectCode(
        fbBank.metadata.subjectCode ? String(fbBank.metadata.subjectCode) : undefined,
        fbBank.metadata.subject
      );

      const fbImageCount = countBankUploadedImages(fbBank);

      const entry: IndexEntry = {
        id: bId,
        path: `firebase://${bId}`,
        grade: canonGrade,
        gradeKey: gKey,
        subject: canonSubject,
        subjectCode: sCode,
        medium: fbBank.metadata.medium || 'ಕನ್ನಡ ಮಾಧ್ಯಮ (State Syllabus)',
        academicYear: String(fbBank.metadata.academicYear || '2026-27'),
        totalChapters: fbBank.chapters.length,
        totalQuestions: fbBank.chapters.reduce((sum, ch) => sum + (ch.questions?.length || 0), 0),
        isUserGenerated: true,
        createdAt: String(
          (fbBank.metadata as any).updatedAt || (fbBank.metadata as any).createdAt || ''
        ),
        uploadedImageCount: fbImageCount,
      };
      registerCustomBank(fbBank, entry);
      combinedFiles.unshift(entry);
    }
  } catch (fbErr) {
    console.warn('Firebase question banks query skipped:', fbErr);
  }

  // 3. Recover any locally generated Question Bank sitting in browser localStorage draft
  //    (so a bank that was generated/cropped locally is immediately visible in class dropdowns too)
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      const rawLocal = window.localStorage.getItem('ai_json_gen_bank');
      if (rawLocal) {
        const parsed = JSON.parse(rawLocal) as QuestionBank;
        if (parsed && Array.isArray(parsed.chapters) && parsed.chapters.length > 0 && parsed.metadata) {
          const sanitized = ensureUniqueQuestionIds(parsed);
          const localId =
            typeof sanitized.metadata.id === 'string' && sanitized.metadata.id.trim()
              ? sanitized.metadata.id.trim()
              : 'local_ai_gen_bank';
          const gKey = extractGradeKey(
            (sanitized.metadata as any).gradeKey || sanitized.metadata.grade
          );
          const canonGrade = canonicalGradeLabel(gKey);
          const canonSubject = normalizeSubjectName(sanitized.metadata.subject);
          const sCode = deduceSubjectCode(
            sanitized.metadata.subjectCode ? String(sanitized.metadata.subjectCode) : undefined,
            sanitized.metadata.subject
          );
          const localImageCount = countBankUploadedImages(sanitized);
          const localEntry: IndexEntry = {
            id: localId,
            path: 'local://ai_json_gen_bank',
            grade: canonGrade,
            gradeKey: gKey,
            subject: canonSubject,
            subjectCode: sCode,
            medium: sanitized.metadata.medium || 'ಕನ್ನಡ ಮಾಧ್ಯಮ (State Syllabus)',
            academicYear: String(sanitized.metadata.academicYear || '2026-27'),
            totalChapters: sanitized.chapters.length,
            totalQuestions: sanitized.chapters.reduce((sum, ch) => sum + (ch.questions?.length || 0), 0),
            isUserGenerated: true,
            createdAt: String(
              (sanitized.metadata as any).updatedAt || (sanitized.metadata as any).createdAt || ''
            ),
            uploadedImageCount: localImageCount,
          };
          // Cache under local:// path only so it NEVER clobbers a richer firebase:// bank cached under localId!
          bankCache.set(localEntry.path, sanitized);
          const cachedById = bankCache.get(localId);
          if (!cachedById || localImageCount > countBankUploadedImages(cachedById)) {
            bankCache.set(localId, sanitized);
          }
          combinedFiles.push(localEntry);
        }
      }
    } catch {
      // Ignore malformed localStorage cache
    }
  }

  // 4. Deduplicate strictly by (gradeKey + subject/language tier + medium bucket)
  //    CRITICAL: ALWAYS preserve the bank with the MOST uploaded images (e.g., Class 9 Math with 137 images
  //    in Firebase beats both a 35-image stale disk copy and a 3-image newer duplicate!).
  const bestBySubjectKey = new Map<string, IndexEntry>();
  for (const f of combinedFiles) {
    const gKey = extractGradeKey(f.gradeKey || f.grade);
    const canonGrade = canonicalGradeLabel(gKey);
    const cleanSub = normalizeSubjectName(f.subject);
    const sCode = deduceSubjectCode(f.subjectCode, f.subject);
    const normalizedEntry: IndexEntry = {
      ...f,
      grade: canonGrade,
      gradeKey: gKey,
      subject: cleanSub,
      subjectCode: sCode,
    };
    const key = getSubjectDedupKey(normalizedEntry);
    const existing = bestBySubjectKey.get(key);
    const existingCount = existing?.totalQuestions || 0;
    const incomingCount = normalizedEntry.totalQuestions || 0;
    const existingImages = existing?.uploadedImageCount || 0;
    const incomingImages = normalizedEntry.uploadedImageCount || 0;
    const incomingCreatedAt = normalizedEntry.createdAt || '';
    const existingCreatedAt = existing?.createdAt || '';
    const incomingIsLocalOnly = normalizedEntry.path.startsWith('local://');
    const existingIsLocalOnly = Boolean(existing?.path.startsWith('local://'));
    const incomingIsFirebase = normalizedEntry.path.startsWith('firebase://');
    const existingIsFirebase = Boolean(existing?.path.startsWith('firebase://'));

    let shouldReplace = false;
    if (!existing) {
      shouldReplace = true;
    } else if (existingIsLocalOnly && !incomingIsLocalOnly && incomingImages >= existingImages) {
      shouldReplace = true;
    } else if (incomingImages > existingImages && (!incomingIsLocalOnly || existingImages === 0)) {
      // Highest uploaded image count ALWAYS wins!
      shouldReplace = true;
    } else if (existingImages > incomingImages && (!existingIsLocalOnly || incomingImages === 0)) {
      // Never let a lower-image bank overwrite a higher-image bank!
      shouldReplace = false;
    } else if (incomingIsFirebase && !existingIsFirebase && incomingCount >= Math.floor(existingCount * 0.7)) {
      // Prefer cloud-saved edited bank over raw static/disk file when image & question counts are comparable
      shouldReplace = true;
    } else if (existingIsFirebase && !incomingIsFirebase && existingCount >= Math.floor(incomingCount * 0.7)) {
      shouldReplace = false;
    } else if (incomingCount > existingCount) {
      shouldReplace = true;
    } else if (
      incomingCount === existingCount &&
      !incomingIsLocalOnly &&
      Boolean(normalizedEntry.isUserGenerated) &&
      !existing.isUserGenerated
    ) {
      shouldReplace = true;
    } else if (
      incomingCount === existingCount &&
      !incomingIsLocalOnly &&
      Boolean(incomingCreatedAt) &&
      (!existingCreatedAt || incomingCreatedAt > existingCreatedAt)
    ) {
      shouldReplace = true;
    }

    if (shouldReplace) {
      bestBySubjectKey.set(key, normalizedEntry);
    }
  }

  const subjectOrder: Record<string, number> = {
    KAN: 1,
    ENG: 2,
    HIN: 3,
    MATH: 4,
    SCI: 5,
    SOC: 6,
    SAN: 7,
  };
  combinedFiles = Array.from(bestBySubjectKey.values()).sort((a, b) => {
    const ga = parseInt(a.gradeKey || '99', 10);
    const gb = parseInt(b.gradeKey || '99', 10);
    if (!isNaN(ga) && !isNaN(gb) && ga !== gb) return ga - gb;
    const oa = subjectOrder[a.subjectCode || ''] || 50;
    const ob = subjectOrder[b.subjectCode || ''] || 50;
    if (oa !== ob) return oa - ob;
    return a.subject.localeCompare(b.subject);
  });

  return {
    version: '2.0',
    description: 'Karnataka State Syllabus DSERT LBA Official Question Banks',
    files: combinedFiles,
  };
}

/**
 * Loads a Question Bank from a file path or registered ID
 */
export async function loadQuestionBankByPath(filePath: string): Promise<QuestionBank> {
  if (bankCache.has(filePath)) {
    return bankCache.get(filePath)!;
  }

  const safePath =
    filePath.startsWith('http') || filePath.includes('%') ? filePath : encodeURI(filePath);

  if (bankCache.has(safePath)) {
    return bankCache.get(safePath)!;
  }

  if (filePath.startsWith('local://')) {
    if (typeof window !== 'undefined' && window.localStorage) {
      const rawLocal = window.localStorage.getItem('ai_json_gen_bank');
      if (rawLocal) {
        const parsed = ensureUniqueQuestionIds(JSON.parse(rawLocal) as QuestionBank);
        bankCache.set(filePath, parsed);
        return parsed;
      }
    }
    throw new Error('Local question bank cache not found.');
  }

  if (filePath.startsWith('firebase://')) {
    const banks = await getQuestionBanksFromFirebase();
    const targetId = filePath.replace('firebase://', '');
    const found = banks.find(b => b.metadata.id === targetId);
    if (found) {
      const sanitized = ensureUniqueQuestionIds(found);
      bankCache.set(filePath, sanitized);
      bankCache.set(safePath, sanitized);
      return sanitized;
    }
  }

  try {
    const rawData = await fetchJsonWithRetry<Record<string, unknown>>(safePath, 3);
    const bank = normalizeQuestionBank(rawData);
    bankCache.set(filePath, bank);
    bankCache.set(safePath, bank);
    return bank;
  } catch (err) {
    console.error(`Error loading question bank from ${filePath}:`, err);
    throw err;
  }
}

/**
 * Extracts question types available in selected chapters
 */
export function extractAvailableQuestionTypes(chapters: Chapter[], selectedChapterIds: string[]): string[] {
  const filtered = selectedChapterIds.length === 0 
    ? chapters 
    : chapters.filter(c => selectedChapterIds.includes(c.chapterId));
  
  const typeSet = new Set<string>();
  for (const ch of filtered) {
    for (const q of ch.questions) {
      if (q.questionType && q.questionType.trim()) {
        typeSet.add(q.questionType.trim());
      }
    }
  }
  return Array.from(typeSet);
}

/**
 * Extracts learning outcomes in selected chapters
 */
export function extractAvailableLearningOutcomes(chapters: Chapter[], selectedChapterIds: string[]): string[] {
  const filtered = selectedChapterIds.length === 0 
    ? chapters 
    : chapters.filter(c => selectedChapterIds.includes(c.chapterId));
  
  const loSet = new Set<string>();
  for (const ch of filtered) {
    for (const q of ch.questions) {
      if (q.learningOutcome && q.learningOutcome.trim()) {
        loSet.add(q.learningOutcome.trim());
      }
    }
  }
  return Array.from(loSet);
}

/**
 * Extracts difficulty levels in selected chapters
 */
export function extractAvailableDifficulties(chapters: Chapter[], selectedChapterIds: string[]): string[] {
  const filtered = selectedChapterIds.length === 0 
    ? chapters 
    : chapters.filter(c => selectedChapterIds.includes(c.chapterId));
  
  const diffSet = new Set<string>();
  for (const ch of filtered) {
    for (const q of ch.questions) {
      if (q.difficulty && q.difficulty.trim()) {
        diffSet.add(q.difficulty.trim());
      }
    }
  }
  return Array.from(diffSet);
}

