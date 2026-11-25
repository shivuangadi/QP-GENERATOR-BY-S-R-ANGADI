/**
 * Strict MCQ Filtering & Smart Grading Utilities for Online Test Mode
 * Handles English (A/B/C/D), Kannada (ಅ/ಆ/ಇ/ಈ), numeric (1/2/3/4), and direct text answer formats.
 */

import { QuestionBank, QuestionItem, Chapter } from '../types/questionBank.ts';

export interface OnlineTestMcqQuestion extends QuestionItem {
  chapterId: string;
  chapterName: string;
  chapterNumber?: number;
  cleanOptions: string[];
  correctOptionIndex: number;
  correctOptionText: string;
  explanationText: string;
}

export interface ChapterMcqStat {
  chapterId: string;
  chapterNumber?: number;
  chapterName: string;
  mcqCount: number;
  totalQuestions: number;
}

const OPTION_PREFIX_REGEX =
  /^\s*(?:\(?\s*([a-dA-D]|[1-4]|ಅ|ಆ|ಇ|ಈ|ಕ|ಖ|ಗ|ಘ)\s*[).:\-]\s*|\[\s*([a-dA-D]|[1-4]|ಅ|ಆ|ಇ|ಈ)\s*\]\s*)/;

const LETTER_TO_INDEX: Record<string, number> = {
  a: 0,
  b: 1,
  c: 2,
  d: 3,
  '1': 0,
  '2': 1,
  '3': 2,
  '4': 3,
  'ಅ': 0,
  'ಆ': 1,
  'ಇ': 2,
  'ಈ': 3,
  'ಕ': 0,
  'ಖ': 1,
  'ಗ': 2,
  'ಘ': 3,
};

export const KANNADA_OPTION_LABELS = ['ಅ', 'ಆ', 'ಇ', 'ಈ', 'ಉ', 'ಊ'];
export const ENGLISH_OPTION_LABELS = ['A', 'B', 'C', 'D', 'E', 'F'];

/**
 * Strip leading option labels like "A) ", "(ಅ) ", "B. ", "1) "
 */
export function stripOptionPrefix(text: string | undefined | null): string {
  if (!text) return '';
  return String(text).replace(OPTION_PREFIX_REGEX, '').trim();
}

/**
 * Normalize text for robust equality / substring comparison across Unicode whitespace and punctuation
 */
function normalizeComparable(text: string): string {
  return String(text || '')
    .toLowerCase()
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^[.,:;()\[\]\-–—\s]+|[.,:;()\[\]\-–—\s]+$/g, '')
    .trim();
}

/**
 * Strictly determine if a QuestionItem is an MCQ eligible for Online Test.
 * Must be categorized as MCQ AND have at least 2 valid non-empty options.
 */
export function isStrictMcqQuestion(q: QuestionItem | null | undefined): boolean {
  if (!q || !q.question || !String(q.question).trim()) return false;

  const cleanOptions = Array.isArray(q.options)
    ? q.options.map(opt => String(opt || '').trim()).filter(Boolean)
    : [];

  if (cleanOptions.length < 2) return false;

  const fmtId = String(q.formatCategoryId || '').toLowerCase().trim();
  const qType = String(q.questionType || '').toLowerCase();
  const fmtName = String(q.formatCategoryName || '').toLowerCase();

  // Explicitly exclude non-MCQ categories even if malformed options exist
  if (
    fmtId &&
    fmtId !== 'mcq' &&
    ['match', 'fill_blank', 'true_false', 'one_sentence', 'short_2m', 'short_3m', 'long_4m', 'who_said', 'passage_pic', 'grammar_section', 'analogy'].includes(fmtId)
  ) {
    return false;
  }

  if (fmtId === 'mcq') return true;

  if (
    qType.includes('mcq') ||
    qType.includes('multiple choice') ||
    qType.includes('ಬಹು ಆಯ್ಕೆ') ||
    qType.includes('ಬಹುಆಯ್ಕೆ') ||
    qType.includes('ವಸ್ತುನಿಷ್ಠ') ||
    fmtName.includes('ಬಹು ಆಯ್ಕೆ') ||
    fmtName.includes('mcq')
  ) {
    return true;
  }

  // Fallback: 1-mark question with 3–5 options and no match pairs
  const marks = Number(q.marks) || 1;
  const hasMatchItems = Array.isArray(q.items) && q.items.length > 0;
  return marks === 1 && !hasMatchItems && cleanOptions.length >= 3 && cleanOptions.length <= 5;
}

/**
 * Resolve the 0-based correct option index from q.options and q.answer.
 * Returns -1 only if answer is completely missing or unmatchable.
 */
export function resolveCorrectOptionIndex(
  options: string[],
  rawAnswer: string | undefined | null
): number {
  if (!Array.isArray(options) || options.length === 0) return -1;
  const answer = String(rawAnswer || '').trim();
  if (!answer) return -1;

  // Clean common answer prefixes like "ಉತ್ತರ:", "Ans:", "Answer:", "ಸರಿ ಉತ್ತರ:"
  const cleanedAnswer = answer
    .replace(/^(?:ಸರಿ(?:ಯಾದ)?\s*ಉತ್ತರ|ಉತ್ತರ|answer|ans)\s*[:\-–—.]\s*/i, '')
    .trim();

  // Take first line if multi-line answer includes detailed explanation on subsequent lines
  const firstLine = cleanedAnswer.split(/\r?\n/)[0].trim();

  // 1. Exact full string match against any option
  const normAns = normalizeComparable(firstLine);
  for (let i = 0; i < options.length; i++) {
    if (normalizeComparable(options[i]) === normAns) {
      return i;
    }
  }

  // 2. Exact match after stripping option prefixes (e.g. option "A) 90°" vs answer "90°" or "(ಅ) 90°")
  const strippedAns = normalizeComparable(stripOptionPrefix(firstLine));
  if (strippedAns) {
    for (let i = 0; i < options.length; i++) {
      const strippedOpt = normalizeComparable(stripOptionPrefix(options[i]));
      if (strippedOpt && strippedOpt === strippedAns) {
        return i;
      }
    }
  }

  // 3. Check leading option prefix letter/Kannada vowel in cleanedAnswer (e.g., "B) 180°", "(ಆ)", "C", "ಇ) 45°")
  const prefixMatch = firstLine.match(
    /^\s*\(?\s*([a-dA-D]|[1-4]|ಅ|ಆ|ಇ|ಈ|ಕ|ಖ|ಗ|ಘ)\s*(?:[).:\-\]]|$|\s)/
  );
  if (prefixMatch) {
    const token = prefixMatch[1].toLowerCase();
    const mappedIdx = LETTER_TO_INDEX[token];
    if (mappedIdx !== undefined && mappedIdx >= 0 && mappedIdx < options.length) {
      // Double-check if there is trailing text in the answer; if it explicitly matches a DIFFERENT option's body, prefer the body match
      const remainder = normalizeComparable(stripOptionPrefix(firstLine));
      if (remainder.length >= 2) {
        const directBodyIdx = options.findIndex(opt => {
          const strippedOpt = normalizeComparable(stripOptionPrefix(opt));
          return strippedOpt && strippedOpt === remainder;
        });
        if (directBodyIdx !== -1) return directBodyIdx;
      }
      return mappedIdx;
    }
  }

  // 4. Standalone single-character letter/Kannada vowel match anywhere when answer is very short
  if (firstLine.length <= 4) {
    const solo = firstLine.replace(/[()[\].:\-\s]/g, '').toLowerCase();
    if (solo in LETTER_TO_INDEX) {
      const idx = LETTER_TO_INDEX[solo];
      if (idx >= 0 && idx < options.length) return idx;
    }
  }

  // 5. Substring match when answer contains option text followed by explanation (e.g., "ಆ) 180° — ಸರಳ ರೇಖೆಯ ಕೋನ")
  let bestIdx = -1;
  let bestLen = 0;
  for (let i = 0; i < options.length; i++) {
    const strippedOpt = normalizeComparable(stripOptionPrefix(options[i]));
    if (!strippedOpt) continue;
    if (
      (strippedAns && strippedAns.startsWith(strippedOpt)) ||
      normAns.includes(strippedOpt)
    ) {
      if (strippedOpt.length > bestLen) {
        bestLen = strippedOpt.length;
        bestIdx = i;
      }
    }
  }
  if (bestIdx !== -1) return bestIdx;

  // 6. Check if an option's own label prefix appears inside answer like "(C)" or "ಆ)"
  for (let i = 0; i < options.length; i++) {
    const optPrefixMatch = options[i].match(OPTION_PREFIX_REGEX);
    const optLetter = (optPrefixMatch?.[1] || optPrefixMatch?.[2] || '').toLowerCase();
    if (optLetter && new RegExp(`(?:^|[\\s(])${optLetter}(?:[)\\].:\\s]|$)`, 'i').test(firstLine)) {
      return i;
    }
  }

  return -1;
}

/**
 * Build explanation text from q.answer (if q.answer has extra detail beyond the short option)
 */
export function buildExplanationText(
  rawAnswer: string | undefined | null,
  correctOptionText: string
): string {
  const ans = String(rawAnswer || '').trim();
  if (!ans) return '';
  const strippedAns = normalizeComparable(stripOptionPrefix(ans));
  const strippedOpt = normalizeComparable(stripOptionPrefix(correctOptionText));
  if (!strippedAns || strippedAns === strippedOpt) {
    return '';
  }
  // If answer has additional explanation or multi-line working steps, return it cleanly
  if (ans.includes('\n') || ans.length > correctOptionText.length + 6) {
    return ans;
  }
  return '';
}

/**
 * Compute per-chapter MCQ counts for a QuestionBank
 */
export function getChapterMcqStats(bank: QuestionBank | null | undefined): ChapterMcqStat[] {
  if (!bank || !Array.isArray(bank.chapters)) return [];
  return bank.chapters.map((ch: Chapter) => {
    const allQs = Array.isArray(ch.questions) ? ch.questions : [];
    const mcqCount = allQs.filter(q => {
      if (!isStrictMcqQuestion(q)) return false;
      const cleanOpts = (q.options || []).map(o => String(o || '').trim()).filter(Boolean);
      return resolveCorrectOptionIndex(cleanOpts, q.answer) !== -1;
    }).length;
    return {
      chapterId: ch.chapterId,
      chapterNumber: ch.chapterNumber,
      chapterName: ch.chapterName,
      mcqCount,
      totalQuestions: allQs.length,
    };
  });
}

/**
 * Extract all strictly valid, gradeable MCQ questions from selected chapters of a QuestionBank
 */
export function extractMcqQuestionsFromBank(
  bank: QuestionBank | null | undefined,
  selectedChapterIds?: string[]
): OnlineTestMcqQuestion[] {
  if (!bank || !Array.isArray(bank.chapters)) return [];

  const chapterSet =
    selectedChapterIds && selectedChapterIds.length > 0 ? new Set(selectedChapterIds) : null;

  const result: OnlineTestMcqQuestion[] = [];
  const seenKeys = new Set<string>();

  for (const ch of bank.chapters) {
    if (chapterSet && !chapterSet.has(ch.chapterId)) continue;
    const questions = Array.isArray(ch.questions) ? ch.questions : [];
    for (const q of questions) {
      if (!isStrictMcqQuestion(q)) continue;

      const cleanOptions = (q.options || [])
        .map(o => String(o || '').trim())
        .filter(Boolean);

      const correctOptionIndex = resolveCorrectOptionIndex(cleanOptions, q.answer);
      if (correctOptionIndex === -1) continue;

      // Deduplicate identical question prompts within the same test pool
      const dedupKey = `${ch.chapterId}::${normalizeComparable(q.question)}`;
      if (seenKeys.has(dedupKey)) continue;
      seenKeys.add(dedupKey);

      const correctOptionText = cleanOptions[correctOptionIndex];
      const explanationText = buildExplanationText(q.answer, correctOptionText);

      result.push({
        ...q,
        chapterId: ch.chapterId,
        chapterName: ch.chapterName,
        chapterNumber: ch.chapterNumber,
        cleanOptions,
        correctOptionIndex,
        correctOptionText,
        explanationText,
      });
    }
  }

  return result;
}

/**
 * Unbiased Fisher-Yates shuffle returning a new array
 */
export function shuffleArray<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/**
 * Format option label based on medium (Kannada vs English)
 */
export function getOptionLabel(index: number, medium?: string): string {
  const isEnglish =
    String(medium || '').toLowerCase().includes('english') &&
    !String(medium || '').includes('ಕನ್ನಡ');
  const labels = isEnglish ? ENGLISH_OPTION_LABELS : KANNADA_OPTION_LABELS;
  return labels[index] || String.fromCharCode(65 + index);
}

/**
 * Format duration in seconds to MM:SS
 */
export function formatDurationMMSS(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}
