/**
 * Smart Question Bank Merger
 * Merges a newly extracted / updated QuestionBank into an existing saved QuestionBank for the
 * same Class + Subject + Medium while:
 *  1. Preserving ALL previously uploaded images (imageUrl, diagramSvg, answerImageUrl, answerDiagramSvg,
 *     hasDiagram, diagramDescription, answerDiagramDescription, needsImage)
 *  2. Adding ONLY newly discovered questions (ZERO duplicates, even if degree symbols like 600 -> 60°
 *     or numbering prefixes changed between extractions)
 *  3. Filling in any previously missing answers with newly extracted answers
 *  4. Preserving untouched chapters that exist in the existing bank
 *  5. Reusing the existing bank's ID so no duplicate bank entry is created
 */

import { Chapter, QuestionBank, QuestionItem } from '../types/questionBank.ts';
import {
  fixDegreeSymbolOcrErrors,
  normalizePdfMathGlyphs,
  sanitizeQuestionMathText,
  sanitizeBankMathText,
} from './mathTextSanitizer.ts';
import {
  normalizeQuestionBank,
  ensureUniqueQuestionIds,
  extractGradeKey,
  canonicalGradeLabel,
  deduceSubjectCode,
  normalizeSubjectName,
  getSubjectDedupKey,
} from '../services/dataLoader.ts';

export interface SmartMergeStats {
  mergedChapters: number;
  addedChapters: number;
  preservedChapters: number;
  addedQuestions: number;
  updatedAnswers: number;
  preservedImages: number;
  skippedDuplicates: number;
  totalQuestionsAfterMerge: number;
}

export interface SmartMergeResult {
  mergedBank: QuestionBank;
  stats: SmartMergeStats;
}

const MISSING_ANSWER_PATTERNS = [
  /^$/,
  /^ಉತ್ತರವನ್ನು\s*ಪರಿಶೀಲಿಸಿ\.?$/i,
  /^ಉತ್ತರ\s*ಲಭ್ಯವಿಲ್ಲ\.?$/i,
  /^answer\s*not\s*(?:available|found)\.?$/i,
  /^check\s*answer\.?$/i,
  /^n\/?a$/i,
  /^-+$/,
];

export function isAnswerMissing(answer?: string | null): boolean {
  const cleaned = String(answer || '').trim();
  if (!cleaned) return true;
  return MISSING_ANSWER_PATTERNS.some(rx => rx.test(cleaned));
}

const STUB_SUMMARY_ANSWER_REGEX =
  /^(?:proof|solution|sol|answer|ans|hint|note)\s*[:\-]?\s*(?:using|by|from|refer|see|apply|prove|proved|shown|derived|as\s+per|similar\s+to|follows\s+from|based\s+on)\b/i;

const DETAILED_QUESTION_REGEX =
  /\b(?:prove|show\s+that|derive|verify|justify|explain|construct|find\s+the\s+value|calculate|solve)\b|ಸಾಧಿಸಿ|ತೋರಿಸಿ|ವಿವರಿಸಿ|ನಿರ್ಣಯಿಸಿ|ಲೆಕ್ಕಾಚಾರ|ಬಿಡಿಸಿ/i;

/**
 * Detects lazy 1-line summarized proof/solution stubs (e.g. "Proof: Using incidence and reflection laws.")
 * where the LBA textbook actually contains a full multi-step explanation.
 */
export function isAnswerStubOrSummary(q: Partial<QuestionItem>): boolean {
  const ans = String(q.answer || '').trim();
  if (!ans) return true;

  // Explicit 1-line "Proof: Using ..." / "Refer diagram" / "See textbook" stub
  if (ans.length < 130 && STUB_SUMMARY_ANSWER_REGEX.test(ans) && !ans.includes('\n') && !ans.includes('=')) {
    return true;
  }

  // Generic placeholder phrases
  if (/^(?:refer\s+(?:to\s+)?(?:textbook|diagram|figure|book)|see\s+(?:textbook|figure|above)|self\s+explanatory|do\s+it\s+yourself|proved\.?)$/i.test(ans)) {
    return true;
  }

  // A 2M/3M/4M/5M proof/derivation question with a tiny single-line non-equation answer
  const marks = Number(q.marks || 1);
  if (
    marks >= 2 &&
    DETAILED_QUESTION_REGEX.test(String(q.question || '')) &&
    ans.length < 65 &&
    !ans.includes('\n') &&
    !/=/.test(ans)
  ) {
    return true;
  }

  return false;
}

export function isAnswerMissingOrIncomplete(q: Partial<QuestionItem>): boolean {
  return isAnswerMissing(q.answer) || isAnswerStubOrSummary(q);
}

const KANNADA_DIGITS_MAP: Record<string, string> = {
  '೦': '0',
  '೧': '1',
  '೨': '2',
  '೩': '3',
  '೪': '4',
  '೫': '5',
  '೬': '6',
  '೭': '7',
  '೮': '8',
  '೯': '9',
};

/**
 * Produces a canonical comparison key for a question so identical questions match reliably
 * even if leading numbers ("1.", "Q.12)", "೧."), trailing difficulty tags ("(AVERAGE)"),
 * PUA PDF Symbol glyphs ("", "", "⃦"), Mathematical Italic letters ("𝑙, 𝑚, 𝑥"),
 * whitespace, punctuation, or degree-symbol OCR fixes ("600" vs "60°") differ between extractions.
 */
export function normalizeQuestionFingerprint(text: string): string {
  if (!text) return '';
  // 1. Convert broken PUA Symbol/Wingdings glyphs & Math Italic Unicode letters to standard ASCII/Unicode
  let s = normalizePdfMathGlyphs(String(text));
  // 2. Fix degree OCR errors ("600" -> "60°", "200" -> "20°") so old & new extractions match
  s = fixDegreeSymbolOcrErrors(s, true);
  // 3. Convert Kannada digits to ASCII digits
  s = s.replace(/[೦-೯]/g, ch => KANNADA_DIGITS_MAP[ch] ?? ch);
  // 4. Strip leading question numbering like "1.", "Q.12)", "(a)", "iv)", "14 -"
  s = s.replace(/^\s*(?:q\.?\s*)?(?:\(\s*[a-z0-9ivx]+\s*\)|[0-9]+[.)\-:]|[ivx]+[.)])\s*/i, '');
  // 5. Strip difficulty/Bloom tags anywhere in parentheses/brackets: "(EASY)", "(AVERAGE)", "(DIFFICULT)"
  s = s.replace(/\s*[\[(]\s*(?:easy|average|difficult|hard|medium|remembering|understanding|applying|analyzing|evaluating|creating)\s*[\])]\s*\.?/gi, ' ');
  // 6. Normalize geometry/math operators consistently so "40⁰"/"40°", "∆ABC"/"ΔABC", "−4"/"-4", "AB || CD"/"AB∥CD" all match
  s = s
    .replace(/[°º˚⁰]/g, 'deg')
    .replace(/∠/g, ' ang ')
    .replace(/\bangles?\b/gi, ' ang ')
    .replace(/(?:∥|\|\||⃦)/g, ' parallel ')
    .replace(/⊥/g, ' perp ')
    .replace(/\bperpendicular\b/gi, ' perp ')
    .replace(/[△Δ∆]/g, ' tri ')
    .replace(/\btriangles?\b/gi, ' tri ')
    .replace(/≅/g, ' cong ')
    .replace(/√/g, ' sqrt ')
    .replace(/−/g, '-')
    .replace(/&/g, ' and ')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    // Normalize common figure phrasing variants ("in the given fig.", "in the adjacent figure", "in fig. 6.1")
    .replace(/\bin\s+(?:the\s+)?(?:given|adjacent|adjoining|following|below|above)?\s*(?:figure|fig\.?)\s*(?:\d+(?:\.\d+)*)?/gi, 'in figure')
    .replace(/\bproduced\s+to\s+(?:a\s+)?point\b/gi, 'produced to point')
    .replace(/[.,;:?!'"`“”‘’()[\]{}\-–—_/\\|+*=<>]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  // Remove spaces between a number/variable and "deg" ("60 deg" -> "60deg", "x deg" -> "xdeg")
  s = s.replace(/(\d+|[a-z])\s+deg\b/g, '$1deg');
  return s;
}

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'of', 'in', 'is', 'are', 'to', 'be', 'by', 'at', 'on', 'for', 'from',
  'given', 'adjacent', 'adjoining', 'shown', 'below', 'above', 'following', 'then', 'that',
  'if', 'it', 'its', 'as', 'with', 'two', 'such', 'figure', 'fig', 'find', 'value', 'measure',
  'prove', 'show', 'calculate', 'solve', 'write', 'compare', 'circle', 'centre', 'center',
]);

function isShortGenericFigureStem(fp: string): boolean {
  if (!fp || fp.length >= 46) return false;
  // Concrete numbers/angles or specific geometric relations (AB || CD, X+Y=W+Z, prove/justify, named angles) are NOT generic
  if (/\b\d+(?:deg)?\b/.test(fp)) return false;
  if (/\b(?:parallel|perp|prove|justify|show|tri|bisector|complement|supplement|reflex|obtuse|acute|collinear)\b/.test(fp)) {
    return false;
  }
  return /\b(?:figure|diagram|picture|graph|ಚಿತ್ರ)\b/.test(fp) || fp.length < 24;
}

function normalizeAnswerCompare(ans?: string | null): string {
  if (!ans || isAnswerMissing(ans)) return '';
  return normalizeQuestionFingerprint(ans);
}

function normalizeOptionsCompare(opts?: string[]): string {
  if (!Array.isArray(opts) || opts.length === 0) return '';
  return opts
    .map(o => normalizeQuestionFingerprint(String(o || '').replace(/^\s*(?:\(?[a-dA-D]\)|[a-dA-D][.)])\s*/, '')))
    .filter(Boolean)
    .sort()
    .join('|');
}

function extractNumericTokens(fp: string): string[] {
  return (fp.match(/\d+(?:deg)?/g) || []).sort();
}

/**
 * Determines whether two QuestionItems inside the same chapter represent the SAME question.
 * Guards short generic diagram stems (like Q.25 & Q.34 both reading "In the figure, the value of x is")
 * against false-positive merges while reliably catching PUA-glyph, Math-Italic, difficulty-tag,
 * degree-OCR, spacing, and minor-phrasing duplicates.
 */
export function areQuestionsDuplicates(a: QuestionItem, b: QuestionItem): boolean {
  if (!a || !b || a.id === b.id) return false;
  if (
    (Array.isArray(a.notDuplicateIds) && a.notDuplicateIds.includes(b.id)) ||
    (Array.isArray(b.notDuplicateIds) && b.notDuplicateIds.includes(a.id))
  ) {
    return false;
  }

  const fpA = normalizeQuestionFingerprint(a.question || '');
  const fpB = normalizeQuestionFingerprint(b.question || '');
  if (!fpA || !fpB) return false;

  const numA = typeof a.questionNumber === 'number' && a.questionNumber > 0 ? a.questionNumber : null;
  const numB = typeof b.questionNumber === 'number' && b.questionNumber > 0 ? b.questionNumber : null;

  // Guard: Two questions with DIFFERENT explicit official PDF serial numbers in the same chapter
  // (e.g. Q.5 1M MCQ vs Q.50 4M calculation, Q.25 1M VSA vs Q.57 5M proof, Q.25 vs Q.34 generic figure MCQ)
  // are distinct textbook questions unless their canonical text, marks, and options are literally identical!
  if (numA !== null && numB !== null && numA !== numB) {
    if (isShortGenericFigureStem(fpA) || isShortGenericFigureStem(fpB)) return false;
    if (fpA !== fpB) return false;
    if (Number(a.marks || 1) !== Number(b.marks || 1)) return false;
    const optsA = normalizeOptionsCompare(a.options);
    const optsB = normalizeOptionsCompare(b.options);
    if (optsA !== optsB) return false;
    return true;
  }

  // Guard short generic figure-dependent stems (e.g., "In the figure, the value of x is")
  if (isShortGenericFigureStem(fpA) || isShortGenericFigureStem(fpB)) {
    if (fpA !== fpB) return false;

    const optsA = normalizeOptionsCompare(a.options);
    const optsB = normalizeOptionsCompare(b.options);
    if (optsA && optsB && optsA !== optsB) {
      return false;
    }

    // If one is MCQ (has options) and the other is descriptive (no options) with different marks, keep separate
    const hasOptsA = Boolean(optsA);
    const hasOptsB = Boolean(optsB);
    if (hasOptsA !== hasOptsB && Number(a.marks || 1) !== Number(b.marks || 1)) {
      return false;
    }

    const ansA = normalizeAnswerCompare(a.answer);
    const ansB = normalizeAnswerCompare(b.answer);
    if (ansA && ansB && ansA !== ansB) {
      // Check if one answer is a step-by-step or degree-OCR ("200" vs "20°") version of the same value
      const numsAnsA = extractNumericTokens(ansA);
      const numsAnsB = extractNumericTokens(ansB);
      const degreeOcrTokenMatch = (t1: string, t2: string) => {
        if (!t1 || !t2) return false;
        if (t1 === t2) return true;
        const n1 = t1.replace(/deg$/i, '');
        const n2 = t2.replace(/deg$/i, '');
        if (n1 === n2) return true;
        if (t1.endsWith('deg') && n2 === `${n1}0`) return true;
        if (t2.endsWith('deg') && n1 === `${n2}0`) return true;
        return false;
      };
      const finalA = numsAnsA.length > 0 ? numsAnsA[numsAnsA.length - 1] : '';
      const finalB = numsAnsB.length > 0 ? numsAnsB[numsAnsB.length - 1] : '';
      const sharesAnswerCore =
        ansA.includes(ansB) ||
        ansB.includes(ansA) ||
        (finalA && numsAnsB.some(tb => degreeOcrTokenMatch(finalA, tb))) ||
        (finalB && numsAnsA.some(ta => degreeOcrTokenMatch(ta, finalB)));
      if (!sharesAnswerCore) {
        return false;
      }
    }

    return true;
  }

  // 1. Exact canonical fingerprint match
  if (fpA === fpB) return true;

  // 2. Compact space-stripped match (catches "ang aoc" vs "ang a o c", "ab parallel cd" vs "a b parallel c d")
  const compactA = fpA.replace(/\s+/g, '');
  const compactB = fpB.replace(/\s+/g, '');
  if (compactA.length >= 18 && compactA === compactB) return true;

  // 3. Never merge full questions with different explicit numeric values UNLESS one is an unnumbered
  //    abbreviated stub (no image, short non-explanation answer) matching a full official numbered question
  const numsA = extractNumericTokens(fpA);
  const numsB = extractNumericTokens(fpB);
  const exactNumsMatch =
    numsA.length === numsB.length && numsA.every((n, idx) => n === numsB[idx]);

  if (exactNumsMatch) {
    // 4. Content-token comparison (strips minor articles/prepositions like "a", "the", "given")
    const tokensA = fpA.split(' ').filter(t => t && !STOP_WORDS.has(t));
    const tokensB = fpB.split(' ').filter(t => t && !STOP_WORDS.has(t));
    if (tokensA.length > 0 && tokensB.length > 0) {
      const joinedA = tokensA.join('');
      const joinedB = tokensB.join('');
      if (Math.min(joinedA.length, joinedB.length) >= 22 && joinedA === joinedB) {
        return true;
      }

      // 5. High token overlap (Jaccard >= 0.85) for longer stems (>= 42 chars) with identical numbers
      if (Math.min(fpA.length, fpB.length) >= 42) {
        const setA = new Set(tokensA);
        const setB = new Set(tokensB);
        let intersection = 0;
        for (const t of setA) {
          if (setB.has(t)) intersection += 1;
        }
        const union = new Set([...setA, ...setB]).size;
        if (union > 0 && intersection / union >= 0.85) {
          return true;
        }

        // Prefix containment when one copy has trailing options/sub-note/table attached (e.g., "(Assume π = 22/7)")
        const shorter = compactA.length <= compactB.length ? compactA : compactB;
        const longer = compactA.length <= compactB.length ? compactB : compactA;
        if (shorter.length >= 42 && longer.startsWith(shorter)) {
          return true;
        }
      }
    }
  } else {
    // Prefix containment even if trailing "(Assume π = 22/7)" or appended table adds extra numbers to the longer copy
    const shorter = compactA.length <= compactB.length ? compactA : compactB;
    const longer = compactA.length <= compactB.length ? compactB : compactA;
    if (shorter.length >= 45 && longer.startsWith(shorter)) {
      return true;
    }
  }

  // 6. Abbreviated unnumbered stub (no image, no detailed explanation) vs Full official numbered question!
  //    Catches legacy summarized extractions (e.g. "Solve: 2x + 3 = 4x - 3" / "If ∠BOC = 100⁰, find x.")
  //    that duplicate the full numbered textbook question ("In the figure PQ and RS are equal chords...").
  const isStubVsFullDuplicate = (stub: QuestionItem, full: QuestionItem): boolean => {
    const stubHasNum = typeof stub.questionNumber === 'number' && stub.questionNumber > 0;
    const fullHasNum = typeof full.questionNumber === 'number' && full.questionNumber > 0;
    if (stubHasNum || !fullHasNum) return false;
    if (hasAnyUploadedImage(stub)) return false;

    // Check if stub's legacy id ("q-<ch>-<N>") matches full's official PDF questionNumber ("N")
    const idMatch = String(stub.id || '').match(/^q-\d+-(\d+)$/);
    const legacySerialMatches = Boolean(idMatch && parseInt(idMatch[1], 10) === full.questionNumber);

    const stubFp = normalizeQuestionFingerprint(stub.question || '');
    const fullFp = normalizeQuestionFingerprint(full.question || '');
    const stubAnsFp = normalizeAnswerCompare(stub.answer);
    const fullAnsFp = normalizeAnswerCompare(full.answer);
    const fullCombinedFp = `${fullFp} ${fullAnsFp}`.trim();

    // Stub must be genuinely less detailed (shorter question OR shorter/non-explanation answer)
    const stubAnsLen = String(stub.answer || '').trim().length;
    const fullAnsLen = String(full.answer || '').trim().length;
    const stubLacksExplanation =
      isAnswerMissingOrIncomplete(stub) ||
      (stubAnsLen < 90 && fullAnsLen >= stubAnsLen);
    if (!stubLacksExplanation && stubFp.length >= fullFp.length) return false;

    const stubTokens = stubFp.split(' ').filter(t => t && !STOP_WORDS.has(t) && t.length > 1);
    const fullCombinedSet = new Set(
      fullCombinedFp.split(' ').filter(t => t && !STOP_WORDS.has(t))
    );
    const fullQSet = new Set(fullFp.split(' ').filter(t => t && !STOP_WORDS.has(t)));

    let sharedInCombined = 0;
    let sharedInQ = 0;
    for (const t of stubTokens) {
      const bare = t.replace(/deg$/i, '');
      if (fullCombinedSet.has(t) || (bare !== t && fullCombinedSet.has(bare)) || fullCombinedFp.includes(t)) {
        sharedInCombined += 1;
      }
      if (fullQSet.has(t) || (bare !== t && fullQSet.has(bare))) {
        sharedInQ += 1;
      }
    }

    // Check if stub's concrete numbers appear inside full's question or answer
    const stubNums = extractNumericTokens(stubFp);
    const fullCombinedNums = new Set(
      extractNumericTokens(fullCombinedFp).flatMap(n => [n, n.replace(/deg$/i, '')])
    );
    const matchedStubNums = stubNums.filter(n =>
      fullCombinedNums.has(n) || fullCombinedNums.has(n.replace(/deg$/i, ''))
    );

    // Check answer numeric/core overlap (e.g., stub "135deg" or "x = 130deg" or "20 sqrt 3" inside full answer)
    const stubAnsNums = extractNumericTokens(stubAnsFp);
    const fullAnsNums = new Set(
      extractNumericTokens(fullAnsFp).flatMap(n => [n, n.replace(/deg$/i, '')])
    );
    const ansCoreMatches =
      Boolean(stubAnsFp && fullAnsFp) &&
      (fullAnsFp.includes(stubAnsFp) ||
        stubAnsFp.includes(fullAnsFp) ||
        (stubAnsNums.length > 0 &&
          stubAnsNums.every(n => fullAnsNums.has(n) || fullAnsNums.has(n.replace(/deg$/i, '')))));

    if (legacySerialMatches) {
      // Legacy q-<ch>-N matching official num=N: still require real semantic/math evidence so unrelated
      // questions that happened to share an index (like Ch 8 q-8-38 vs num=38) are NEVER falsely merged!
      const tokenRatio = stubTokens.length > 0 ? sharedInCombined / stubTokens.length : 0;
      const numRatio = stubNums.length > 0 ? matchedStubNums.length / stubNums.length : 1;
      if (ansCoreMatches && (sharedInCombined >= 1 || matchedStubNums.length >= 1)) return true;
      if (tokenRatio >= 0.45 && numRatio >= 0.5 && sharedInCombined >= 2) return true;
      // Theorem paraphrases (e.g., "isosceles trapezium is cyclic" vs "non-parallel sides of a trapezium are equal, prove that it is cyclic")
      const stubAnsTokens = stubAnsFp.split(' ').filter(t => t.length >= 3 && !STOP_WORDS.has(t));
      const sharedAnsTokens = stubAnsTokens.filter(t => fullCombinedFp.includes(t)).length;
      if (sharedInCombined >= 1 && sharedAnsTokens >= 2) return true;
      return false;
    }

    // Even without legacy ID match, catch obvious abbreviated stubs with strong numeric + token containment + matching answer
    if (
      stubFp.length < fullFp.length * 0.78 &&
      stubTokens.length >= 2 &&
      sharedInQ / stubTokens.length >= 0.72 &&
      (stubNums.length === 0 || matchedStubNums.length === stubNums.length) &&
      ansCoreMatches
    ) {
      return true;
    }

    return false;
  };

  if (isStubVsFullDuplicate(a, b) || isStubVsFullDuplicate(b, a)) {
    return true;
  }

  return false;
}

/**
 * Compares TWO questions strictly by COMPLETE CONTENT (full question + options + full answer),
 * NEVER flagging questions merely because their printed serial numbers repeat across sections.
 * Respects `notDuplicateIds` so any pair marked "Not Duplicate" never shows up again.
 * Returns a human-readable match reason string if possibly duplicate, or `null` otherwise.
 */
export function detectContentDuplicateReason(a: QuestionItem, b: QuestionItem): string | null {
  if (!a || !b || a.id === b.id) return null;
  if (
    (Array.isArray(a.notDuplicateIds) && a.notDuplicateIds.includes(b.id)) ||
    (Array.isArray(b.notDuplicateIds) && b.notDuplicateIds.includes(a.id))
  ) {
    return null;
  }

  const fpA = normalizeQuestionFingerprint(a.question || '');
  const fpB = normalizeQuestionFingerprint(b.question || '');
  if (!fpA || !fpB) return null;

  const optsA = normalizeOptionsCompare(a.options);
  const optsB = normalizeOptionsCompare(b.options);
  const ansA = normalizeAnswerCompare(a.answer);
  const ansB = normalizeAnswerCompare(b.answer);

  const fullA = [fpA, optsA, ansA].filter(Boolean).join(' ').trim();
  const fullB = [fpB, optsB, ansB].filter(Boolean).join(' ').trim();

  // 1. Exact complete Question + Options + Answer match
  if (fullA.length >= 20 && fullA === fullB) {
    return 'ಸಂಪೂರ್ಣ ಪ್ರಶ್ನೆ ಮತ್ತು ಉತ್ತರ ಒಂದೇ ಆಗಿವೆ (Exact Q & A Match)';
  }

  // Guard short generic figure-dependent stems unless options/answers also match
  const isGenericFig = isShortGenericFigureStem(fpA) || isShortGenericFigureStem(fpB);
  if (isGenericFig) {
    if (fpA === fpB && optsA === optsB && ansA && ansB && ansA === ansB) {
      return 'ಸಂಪೂರ್ಣ ಪ್ರಶ್ನೆ ಮತ್ತು ಉತ್ತರ ಒಂದೇ ಆಗಿವೆ (Exact Q & A Match)';
    }
    return null;
  }

  // 2. Identical question text (and options when both have options) with compatible answers
  if (fpA.length >= 18 && fpA === fpB && (!optsA || !optsB || optsA === optsB)) {
    if (!ansA || !ansB || ansA === ansB || ansA.includes(ansB) || ansB.includes(ansA)) {
      return 'ಒಂದೇ ಪ್ರಶ್ನೆ ಮತ್ತು ಉತ್ತರ (Identical Question & Answer)';
    }
    const ansTokA = new Set(ansA.split(' ').filter(t => t.length >= 2 && !STOP_WORDS.has(t)));
    const ansTokB = new Set(ansB.split(' ').filter(t => t.length >= 2 && !STOP_WORDS.has(t)));
    let sharedAns = 0;
    for (const t of ansTokA) {
      if (ansTokB.has(t)) sharedAns++;
    }
    const minAnsSize = Math.min(ansTokA.size, ansTokB.size);
    if (minAnsSize > 0 && sharedAns / minAnsSize >= 0.45) {
      return 'ಒಂದೇ ಪ್ರಶ್ನೆ ಪಠ್ಯ (Identical Question)';
    }
  }

  // 3. Structural content duplicate check (ignoring serial numbers completely)
  const cloneNoSerialA: QuestionItem = { ...a, questionNumber: undefined, printedSerial: undefined };
  const cloneNoSerialB: QuestionItem = { ...b, questionNumber: undefined, printedSerial: undefined };
  if (areQuestionsDuplicates(cloneNoSerialA, cloneNoSerialB)) {
    return 'ಹೋಲುವ ಪ್ರಶ್ನೆ ಮತ್ತು ಉತ್ತರ (Matching Question & Answer)';
  }

  // 4. High complete-content similarity across full Question + Options + Answer
  if (fpA.length >= 24 && fpB.length >= 24 && fullA.length >= 36 && fullB.length >= 36) {
    const numsA = extractNumericTokens(fpA);
    const numsB = extractNumericTokens(fpB);
    const sameNums = numsA.length === numsB.length && numsA.every((n, i) => n === numsB[i]);
    if (sameNums) {
      const setA = new Set(fullA.split(' ').filter(t => t.length >= 2 && !STOP_WORDS.has(t)));
      const setB = new Set(fullB.split(' ').filter(t => t.length >= 2 && !STOP_WORDS.has(t)));
      if (setA.size >= 4 && setB.size >= 4) {
        let inter = 0;
        for (const t of setA) {
          if (setB.has(t)) inter++;
        }
        const union = new Set([...setA, ...setB]).size;
        if (union > 0 && inter / union >= 0.8) {
          return 'ಸಂಪೂರ್ಣ ವಿಷಯ ಹೋಲುತ್ತಿದೆ (High Q & A Similarity)';
        }
      }
    }
  }

  // 5. Identical substantial full answer + strong question token overlap
  if (ansA.length >= 45 && ansA === ansB) {
    const qTokA = new Set(fpA.split(' ').filter(t => t.length >= 3 && !STOP_WORDS.has(t)));
    const qTokB = new Set(fpB.split(' ').filter(t => t.length >= 3 && !STOP_WORDS.has(t)));
    let sharedQ = 0;
    for (const t of qTokA) {
      if (qTokB.has(t)) sharedQ++;
    }
    const minQ = Math.min(qTokA.size, qTokB.size);
    if (sharedQ >= 2 && minQ > 0 && sharedQ / minQ >= 0.5) {
      return 'ಒಂದೇ ಉತ್ತರ ಮತ್ತು ಹೋಲುವ ಪ್ರಶ್ನೆ (Same Answer & Similar Question)';
    }
  }

  return null;
}

/**
 * Checks whether a chapter has repeating or restarting serial numbers (e.g. Prose #1, Grammar #1, Poem #1).
 */
export function hasRepeatingOrRestartingSerials(questions: QuestionItem[]): boolean {
  const seen = new Set<number>();
  let prev = 0;
  for (const q of questions || []) {
    const n = typeof q.questionNumber === 'number' && q.questionNumber > 0 ? q.questionNumber : null;
    if (n === null) continue;
    if (seen.has(n) || n < prev) return true;
    seen.add(n);
    prev = n;
  }
  return false;
}

/**
 * Assigns continuous serial numbers 1..N across each chapter while strictly preserving existing PDF order.
 */
export function assignContinuousSerialNumbers(chapters: Chapter[]): Chapter[] {
  return (chapters || []).map(ch => ({
    ...ch,
    questions: (ch.questions || []).map((q, idx) => ({
      ...q,
      questionNumber: idx + 1,
      printedSerial: String(idx + 1),
    })),
  }));
}

function normalizeChapterNameKey(name?: string): string {
  return String(name || '')
    .replace(/[೦-೯]/g, ch => KANNADA_DIGITS_MAP[ch] ?? ch)
    .replace(/^\s*(?:chapter|unit|lesson|ಅಧ್ಯಾಯ|ಘಟಕ|ಪಾಠ)\s*[-:.]?\s*\d*\s*[-:.]?\s*/i, '')
    .replace(/[\s.,;:?!'"()[\]{}\-–—_/]+/g, '')
    .toLowerCase()
    .trim();
}

function hasAnyUploadedImage(q: QuestionItem): boolean {
  return Boolean(q.imageUrl || q.diagramSvg || q.answerImageUrl || q.answerDiagramSvg);
}

/**
 * Merge a single existing question with a newly extracted matching question.
 * Existing uploaded images ALWAYS take priority over empty incoming image fields.
 */
function mergeMatchedQuestion(
  existing: QuestionItem,
  incoming: QuestionItem,
  subjectHint: string
): { merged: QuestionItem; answerUpdated: boolean; imagePreserved: boolean } {
  const sanitizedExisting = sanitizeQuestionMathText(existing, subjectHint);
  const sanitizedIncoming = sanitizeQuestionMathText(incoming, subjectHint);

  const existingHadImage = hasAnyUploadedImage(existing);
  const incomingHadImage = hasAnyUploadedImage(incoming);
  const existingHasNum = typeof existing.questionNumber === 'number' && existing.questionNumber > 0;
  const incomingHasNum = typeof incoming.questionNumber === 'number' && incoming.questionNumber > 0;

  const oldAnswerMissing = isAnswerMissing(sanitizedExisting.answer);
  const oldAnswerStub = isAnswerStubOrSummary(sanitizedExisting);
  const newAnswerAvailable = !isAnswerMissing(sanitizedIncoming.answer);
  const newAnswerStub = isAnswerStubOrSummary(sanitizedIncoming);
  const existingAnsLen = String(sanitizedExisting.answer || '').trim().length;
  const incomingAnsLen = String(sanitizedIncoming.answer || '').trim().length;

  // Protect an official numbered copy's non-stub explanation answer from being overwritten by an unnumbered legacy copy
  const incomingAllowedToReplaceAnswer =
    !(existingHasNum && !incomingHasNum && !oldAnswerMissing && !oldAnswerStub);

  const newAnswerIsRicher =
    incomingAllowedToReplaceAnswer &&
    newAnswerAvailable &&
    !newAnswerStub &&
    (incomingAnsLen > existingAnsLen + 15 ||
      (oldAnswerStub && incomingAnsLen > existingAnsLen) ||
      (!existingHasNum && incomingHasNum && !existingHadImage && incomingAnsLen >= existingAnsLen - 2));

  const answerUpdated =
    (oldAnswerMissing && newAnswerAvailable) ||
    newAnswerIsRicher;

  // Prefer fuller, cleaner textbook question text (strip trailing "(AVERAGE)" tags & leading "36. " duplicates)
  const cleanTagStripped = (t: string) =>
    t
      .replace(/^\s*\d+[.)]\s+/, '')
      .replace(/\s*[\[(]\s*(?:easy|average|difficult|hard|medium)\s*[\])]\s*$/i, '')
      .trim();
  const cleanExistingText = cleanTagStripped(sanitizedExisting.question || '');
  const cleanIncomingText = cleanTagStripped(sanitizedIncoming.question || '');

  // Prefer the numbered / image-bearing / fuller textbook question over an unnumbered abbreviated stub
  const preferIncomingQuestion =
    Boolean(cleanIncomingText) &&
    ((!existingHasNum && incomingHasNum && cleanIncomingText.length >= cleanExistingText.length * 0.85) ||
      (incomingAllowedToReplaceAnswer && cleanIncomingText.length > cleanExistingText.length + 12) ||
      (incomingHadImage && !existingHadImage && cleanIncomingText.length >= cleanExistingText.length * 0.85));

  const finalQuestionText = preferIncomingQuestion
    ? cleanIncomingText
    : cleanExistingText || sanitizedIncoming.question || sanitizedExisting.question;

  const finalOptions =
    Array.isArray(sanitizedIncoming.options) && sanitizedIncoming.options.length > 0 && incomingAllowedToReplaceAnswer
      ? sanitizedIncoming.options
      : Array.isArray(sanitizedExisting.options) && sanitizedExisting.options.length > 0
      ? sanitizedExisting.options
      : sanitizedIncoming.options;

  const finalItems =
    Array.isArray(sanitizedIncoming.items) && sanitizedIncoming.items.length > 0
      ? sanitizedIncoming.items
      : sanitizedExisting.items;

  // Preserve uploaded images from EITHER copy (existing takes priority if both exist)
  const imageUrl = existing.imageUrl || incoming.imageUrl;
  const imageUrl2 = existing.imageUrl2 || incoming.imageUrl2;
  const diagramSvg = existing.diagramSvg || incoming.diagramSvg;
  const answerImageUrl = existing.answerImageUrl || incoming.answerImageUrl;
  const answerImageUrl2 = existing.answerImageUrl2 || incoming.answerImageUrl2;
  const answerDiagramSvg = existing.answerDiagramSvg || incoming.answerDiagramSvg;
  const hasDiagram = Boolean(
    imageUrl || imageUrl2 || diagramSvg || answerImageUrl || answerImageUrl2 || answerDiagramSvg || existing.hasDiagram || incoming.hasDiagram
  );

  // Pick the fuller, higher-quality explanation answer between the two copies
  let chosenAnswer = sanitizedExisting.answer;
  if (answerUpdated) {
    chosenAnswer = sanitizedIncoming.answer;
  } else if (oldAnswerMissing) {
    chosenAnswer = sanitizedIncoming.answer || sanitizedExisting.answer;
  } else if (
    incomingAllowedToReplaceAnswer &&
    newAnswerAvailable &&
    !newAnswerStub &&
    incomingAnsLen > existingAnsLen + 20
  ) {
    chosenAnswer = sanitizedIncoming.answer;
  }

  // Prefer marks from the numbered official copy when merging an unnumbered stub with a numbered question
  const finalMarks =
    !existingHasNum && incomingHasNum && typeof sanitizedIncoming.marks === 'number' && sanitizedIncoming.marks > 0
      ? sanitizedIncoming.marks
      : sanitizedExisting.marks ?? sanitizedIncoming.marks;

  const mergedId = existingHadImage || !incomingHadImage ? existing.id : incoming.id;
  const mergedNotDupSet = new Set<string>([
    ...(Array.isArray(existing.notDuplicateIds) ? existing.notDuplicateIds : []),
    ...(Array.isArray(incoming.notDuplicateIds) ? incoming.notDuplicateIds : []),
  ]);
  mergedNotDupSet.delete(mergedId);
  const mergedNotDupIds = mergedNotDupSet.size > 0 ? Array.from(mergedNotDupSet) : undefined;

  const merged: QuestionItem = {
    ...sanitizedIncoming,
    ...sanitizedExisting,
    id: mergedId,
    marks: finalMarks,
    question: finalQuestionText,
    answer: chosenAnswer,
    options: finalOptions,
    items: finalItems,
    imageUrl,
    imageUrl2,
    diagramSvg,
    answerImageUrl,
    answerImageUrl2,
    answerDiagramSvg,
    hasDiagram,
    diagramDescription: existing.diagramDescription || incoming.diagramDescription,
    answerDiagramDescription: existing.answerDiagramDescription || incoming.answerDiagramDescription,
    needsImage: existing.needsImage !== undefined ? existing.needsImage : incoming.needsImage,
    sourcePage: incoming.sourcePage ?? existing.sourcePage,
    answerPage: incoming.answerPage ?? existing.answerPage,
    questionNumber: incoming.questionNumber ?? existing.questionNumber,
    printedSerial: incoming.printedSerial ?? existing.printedSerial,
    ...(mergedNotDupIds ? { notDuplicateIds: mergedNotDupIds } : {}),
    chapterId: existing.chapterId || incoming.chapterId,
    chapterName: existing.chapterName || incoming.chapterName,
    chapterNumber: existing.chapterNumber ?? incoming.chapterNumber,
  };

  return {
    merged,
    answerUpdated: answerUpdated || chosenAnswer !== sanitizedExisting.answer,
    imagePreserved: existingHadImage || incomingHadImage,
  };
}

export interface DeduplicateBankResult {
  cleanedBank: QuestionBank;
  removedDuplicates: number;
  preservedImages: number;
  chaptersAffected: number;
  totalQuestionsBefore: number;
  totalQuestionsAfter: number;
}

/**
 * Deduplicates duplicate questions inside EVERY chapter of a QuestionBank while:
 *  - Merging duplicate pairs via `mergeMatchedQuestion` so EVERY uploaded image (question or answer)
 *    from EITHER duplicate copy is 100% preserved!
 *  - Keeping the clean Unicode math text, valid PDF `questionNumber`/`printedSerial`, and fullest answer!
 *  - Sorting questions in natural PDF `questionNumber` order when numbers are present.
 */
export function deduplicateQuestionBank(bank: QuestionBank): DeduplicateBankResult {
  const subjectHint = [
    bank.metadata?.subject || '',
    bank.metadata?.subjectCode || '',
    bank.metadata?.title || '',
  ].join(' ');

  let removedDuplicates = 0;
  let preservedImages = 0;
  let chaptersAffected = 0;
  let totalQuestionsBefore = 0;
  let totalQuestionsAfter = 0;

  const cleanedChapters: Chapter[] = (bank.chapters || []).map(ch => {
    const rawQs = (ch.questions || []).map(q =>
      sanitizeQuestionMathText({ ...q, chapterName: q.chapterName || ch.chapterName }, subjectHint)
    );
    totalQuestionsBefore += rawQs.length;

    // Anchor higher-quality copies FIRST (uploaded image + official PDF questionNumber + detailed explanation)
    // so unnumbered/no-explanation/no-image duplicates always merge INTO the canonical complete copy!
    const qualityScore = (q: QuestionItem): number => {
      let score = 0;
      if (hasAnyUploadedImage(q)) score += 1000;
      if (typeof q.questionNumber === 'number' && q.questionNumber > 0) score += 500;
      if (!isAnswerMissingOrIncomplete(q)) score += 200;
      score += Math.min(180, String(q.answer || '').trim().length);
      return score;
    };

    const indexed = rawQs.map((q, origIdx) => ({ q, origIdx, score: qualityScore(q) }));
    indexed.sort((a, b) => b.score - a.score || a.origIdx - b.origIdx);

    let working = indexed.map(item => item.q);
    let chRemoved = 0;

    // Multi-pass convergence (max 3 passes) so 3-way duplicates (e.g., stub + unnumbered twin + numbered official)
    // collapse completely into one canonical question!
    for (let pass = 0; pass < 3; pass++) {
      const nextUnique: QuestionItem[] = [];
      let passRemoved = 0;
      for (const candidate of working) {
        const dupIdx = nextUnique.findIndex(existing => areQuestionsDuplicates(existing, candidate));
        if (dupIdx >= 0) {
          const { merged, imagePreserved } = mergeMatchedQuestion(
            nextUnique[dupIdx],
            candidate,
            subjectHint
          );
          nextUnique[dupIdx] = merged;
          if (imagePreserved) preservedImages += 1;
          passRemoved += 1;
        } else {
          nextUnique.push(candidate);
        }
      }
      working = nextUnique;
      chRemoved += passRemoved;
      if (passRemoved === 0) break;
    }

    const uniqueQs = working;

    if (chRemoved > 0) {
      chaptersAffected += 1;
      removedDuplicates += chRemoved;
    }

    // Restore exact PDF order: NEVER scramble order by sorting on repeating/restarting section numbers!
    const origPosMap = new Map<string, number>();
    rawQs.forEach((q, idx) => origPosMap.set(q.id, idx));

    const numberedQs = uniqueQs.filter(q => typeof q.questionNumber === 'number' && q.questionNumber > 0);
    const uniqueNumSet = new Set(numberedQs.map(q => q.questionNumber!));
    const hasStrictlyUniqueSerials =
      numberedQs.length >= Math.ceil(uniqueQs.length * 0.5) &&
      uniqueNumSet.size === numberedQs.length;

    if (hasStrictlyUniqueSerials) {
      uniqueQs.sort((a, b) => {
        const na = typeof a.questionNumber === 'number' && a.questionNumber > 0 ? a.questionNumber : 99999;
        const nb = typeof b.questionNumber === 'number' && b.questionNumber > 0 ? b.questionNumber : 99999;
        if (na !== nb) return na - nb;
        return (origPosMap.get(a.id) ?? 99999) - (origPosMap.get(b.id) ?? 99999);
      });
    } else {
      // Preserve exact PDF top-to-bottom order and assign continuous 1..N serial numbers
      uniqueQs.sort((a, b) => (origPosMap.get(a.id) ?? 99999) - (origPosMap.get(b.id) ?? 99999));
      if (hasRepeatingOrRestartingSerials(uniqueQs)) {
        uniqueQs.forEach((q, idx) => {
          q.questionNumber = idx + 1;
          q.printedSerial = String(idx + 1);
        });
      }
    }

    totalQuestionsAfter += uniqueQs.length;
    return {
      ...ch,
      questions: uniqueQs,
    };
  });

  const cleanedBank = ensureUniqueQuestionIds({
    ...bank,
    metadata: {
      ...bank.metadata,
      totalChapters: cleanedChapters.length,
      totalQuestions: totalQuestionsAfter,
    },
    chapters: cleanedChapters,
  });

  return {
    cleanedBank,
    removedDuplicates,
    preservedImages,
    chaptersAffected,
    totalQuestionsBefore,
    totalQuestionsAfter,
  };
}

/**
 * Smartly merges `incomingBank` into `existingBank`, preserving every uploaded image,
 * keeping untouched chapters, adding only new non-duplicate questions, and filling missing answers.
 */
export function smartMergeQuestionBanks(
  existingBank: QuestionBank,
  incomingBank: QuestionBank
): SmartMergeResult {
  const subjectHint = [
    existingBank.metadata?.subject || incomingBank.metadata?.subject || '',
    existingBank.metadata?.subjectCode || incomingBank.metadata?.subjectCode || '',
    existingBank.metadata?.title || incomingBank.metadata?.title || '',
  ].join(' ');

  const stats: SmartMergeStats = {
    mergedChapters: 0,
    addedChapters: 0,
    preservedChapters: 0,
    addedQuestions: 0,
    updatedAnswers: 0,
    preservedImages: 0,
    skippedDuplicates: 0,
    totalQuestionsAfterMerge: 0,
  };

  // Clone existing chapters so we never mutate input
  const existingChapters: Chapter[] = (existingBank.chapters || []).map(ch => ({
    ...ch,
    questions: (ch.questions || []).map(q => sanitizeQuestionMathText({ ...q }, subjectHint)),
  }));

  const matchedExistingChapterIndices = new Set<number>();
  const finalChapters: Chapter[] = [...existingChapters];

  const findMatchingChapterIndex = (incCh: Chapter): number => {
    const incNum = incCh.chapterNumber;
    const incNameKey = normalizeChapterNameKey(incCh.chapterName);

    // 1. Exact chapterNumber + similar chapterName, or exact chapterId
    for (let i = 0; i < finalChapters.length; i++) {
      const ex = finalChapters[i];
      if (ex.chapterId && incCh.chapterId && ex.chapterId === incCh.chapterId) {
        if (!incNum || !ex.chapterNumber || ex.chapterNumber === incNum) return i;
      }
    }
    // 2. Match by normalized chapter name
    if (incNameKey) {
      for (let i = 0; i < finalChapters.length; i++) {
        const exNameKey = normalizeChapterNameKey(finalChapters[i].chapterName);
        if (exNameKey && (exNameKey === incNameKey || exNameKey.includes(incNameKey) || incNameKey.includes(exNameKey))) {
          return i;
        }
      }
    }
    // 3. Match by chapterNumber
    if (incNum !== undefined && incNum !== null) {
      for (let i = 0; i < finalChapters.length; i++) {
        if (finalChapters[i].chapterNumber === incNum) return i;
      }
    }
    return -1;
  };

  // Track globally used IDs to guarantee zero duplicate React keys
  const usedIds = new Set<string>();
  for (const ch of finalChapters) {
    for (const q of ch.questions || []) {
      if (q.id) usedIds.add(q.id);
    }
  }

  const allocateUniqueId = (basePrefix: string, startNum: number): string => {
    let n = Math.max(1, startNum);
    let candidate = `${basePrefix}-q-${n}`;
    while (usedIds.has(candidate)) {
      n += 1;
      candidate = `${basePrefix}-q-${n}`;
    }
    usedIds.add(candidate);
    return candidate;
  };

  for (const rawIncCh of incomingBank.chapters || []) {
    const incCh: Chapter = {
      ...rawIncCh,
      questions: (rawIncCh.questions || []).map(q =>
        sanitizeQuestionMathText({ ...q, chapterName: q.chapterName || rawIncCh.chapterName }, subjectHint)
      ),
    };

    const matchIdx = findMatchingChapterIndex(incCh);

    if (matchIdx === -1) {
      // Brand new chapter: deduplicate internally using duplicate-safe matching and assign unique IDs
      const safePrefix = String(incCh.chapterId || `ch-${incCh.chapterNumber || finalChapters.length + 1}`).replace(
        /[^a-zA-Z0-9_-]/g,
        '_'
      );
      const uniqueQuestions: QuestionItem[] = [];
      for (const q of incCh.questions) {
        const dupIdx = uniqueQuestions.findIndex(ex => areQuestionsDuplicates(ex, q));
        if (dupIdx >= 0) {
          const { merged, imagePreserved } = mergeMatchedQuestion(uniqueQuestions[dupIdx], q, subjectHint);
          uniqueQuestions[dupIdx] = merged;
          if (imagePreserved) stats.preservedImages += 1;
          stats.skippedDuplicates += 1;
          continue;
        }
        const qId = q.id && !usedIds.has(q.id) ? (usedIds.add(q.id), q.id) : allocateUniqueId(safePrefix, uniqueQuestions.length + 1);
        uniqueQuestions.push({
          ...q,
          id: qId,
          chapterId: incCh.chapterId,
          chapterName: incCh.chapterName,
          chapterNumber: incCh.chapterNumber,
        });
      }
      finalChapters.push({
        ...incCh,
        questions: uniqueQuestions,
      });
      stats.addedChapters += 1;
      stats.addedQuestions += uniqueQuestions.length;
      continue;
    }

    // Existing chapter found -> smart question-by-question merge (with duplicate-safe PUA/generic-stem matching!)
    matchedExistingChapterIndices.add(matchIdx);
    stats.mergedChapters += 1;
    const exCh = finalChapters[matchIdx];

    // First deduplicate any pre-existing duplicates inside exCh itself!
    const mergedQuestions: QuestionItem[] = [];
    for (const exQ of exCh.questions || []) {
      const exDupIdx = mergedQuestions.findIndex(q => areQuestionsDuplicates(q, exQ));
      if (exDupIdx >= 0) {
        const { merged, imagePreserved } = mergeMatchedQuestion(mergedQuestions[exDupIdx], exQ, subjectHint);
        mergedQuestions[exDupIdx] = merged;
        if (imagePreserved) stats.preservedImages += 1;
        stats.skippedDuplicates += 1;
      } else {
        mergedQuestions.push(exQ);
      }
    }

    const safePrefix = String(exCh.chapterId || `ch-${exCh.chapterNumber || matchIdx + 1}`).replace(
      /[^a-zA-Z0-9_-]/g,
      '_'
    );
    const touchedExistingIndices = new Set<number>();

    for (const incQ of incCh.questions) {
      const existingIdx = mergedQuestions.findIndex(q => areQuestionsDuplicates(q, incQ));

      if (existingIdx !== undefined && existingIdx >= 0) {
        // Already exists -> merge preserving images & filling missing answers
        const { merged, answerUpdated, imagePreserved } = mergeMatchedQuestion(
          mergedQuestions[existingIdx],
          incQ,
          subjectHint
        );
        mergedQuestions[existingIdx] = merged;
        touchedExistingIndices.add(existingIdx);
        if (answerUpdated) stats.updatedAnswers += 1;
        if (imagePreserved) stats.preservedImages += 1;
        stats.skippedDuplicates += 1;
      } else {
        // Brand new question not in existing bank -> append!
        const newId = allocateUniqueId(safePrefix, mergedQuestions.length + 1);
        const newQ: QuestionItem = {
          ...incQ,
          id: newId,
          chapterId: exCh.chapterId,
          chapterName: exCh.chapterName,
          chapterNumber: exCh.chapterNumber ?? incCh.chapterNumber,
        };
        mergedQuestions.push(newQ);
        touchedExistingIndices.add(mergedQuestions.length - 1);
        stats.addedQuestions += 1;
      }
    }

    // Count preserved images on existing questions that weren't even touched by incoming
    for (let i = 0; i < mergedQuestions.length; i++) {
      if (!touchedExistingIndices.has(i) && hasAnyUploadedImage(mergedQuestions[i])) {
        stats.preservedImages += 1;
      }
    }

    finalChapters[matchIdx] = {
      ...exCh,
      questionPages: incCh.questionPages || exCh.questionPages,
      answerPages: incCh.answerPages || exCh.answerPages,
      printedPages: incCh.printedPages || exCh.printedPages,
      questions: mergedQuestions,
    };
  }

  // Count untouched chapters & their preserved images
  existingChapters.forEach((ch, idx) => {
    if (!matchedExistingChapterIndices.has(idx)) {
      stats.preservedChapters += 1;
      for (const q of ch.questions || []) {
        if (hasAnyUploadedImage(q)) stats.preservedImages += 1;
      }
    }
  });

  // Sort chapters by chapterNumber ascending
  finalChapters.sort((a, b) => (a.chapterNumber || 0) - (b.chapterNumber || 0));

  const totalQuestions = finalChapters.reduce((sum, ch) => sum + (ch.questions?.length || 0), 0);
  stats.totalQuestionsAfterMerge = totalQuestions;

  const mergedBank: QuestionBank = {
    metadata: {
      ...incomingBank.metadata,
      ...existingBank.metadata,
      // Prefer incoming PDF link if newly uploaded, otherwise keep existing
      source_pdf: incomingBank.metadata?.source_pdf || existingBank.metadata?.source_pdf,
      sourcePdfId: incomingBank.metadata?.sourcePdfId || existingBank.metadata?.sourcePdfId,
      sourcePdfUrl: incomingBank.metadata?.sourcePdfUrl || existingBank.metadata?.sourcePdfUrl,
      totalChapters: finalChapters.length,
      totalQuestions,
    },
    chapters: finalChapters,
  };

  return { mergedBank, stats };
}

export interface ParsedUploadedJsonResult {
  bank: QuestionBank;
  gradeKey: string;
  subjectCode: string;
  subject: string;
  hasExplicitGradeOrSubject: boolean;
  isSingleUnit: boolean;
}

/**
 * Parses any uploaded JSON file — whether a full multi-unit QuestionBank, a single-unit QuestionBank,
 * a standalone single-chapter object (`{ chapterName, questions }`), an array of chapters, or a raw
 * array of questions — and infers Grade / Subject / Medium from metadata -> filename -> fallback bank metadata.
 */
export function parseUploadedJsonToQuestionBank(
  rawParsed: unknown,
  fileName: string,
  fallbackMeta?: Partial<QuestionBank['metadata']>
): ParsedUploadedJsonResult {
  const cleanFileName = String(fileName || '').replace(/\.json$/i, '').trim();

  let rawBankObj: Record<string, unknown>;
  if (Array.isArray(rawParsed)) {
    if (rawParsed.length === 0) {
      throw new Error('JSON ಫೈಲ್ ಖಾಲಿಯಾಗಿದೆ (Empty JSON array).');
    }
    const first = rawParsed[0] as Record<string, unknown>;
    if (first && (Array.isArray(first.questions) || Array.isArray(first.sections))) {
      // Array of chapters
      rawBankObj = { metadata: {}, chapters: rawParsed };
    } else if (first && (typeof first.question === 'string' || typeof first.questionText === 'string' || typeof first.text === 'string')) {
      // Array of questions -> wrap in a single chapter
      rawBankObj = {
        metadata: {},
        chapters: [
          {
            chapterId: `ch_${Date.now()}`,
            chapterNumber: 1,
            chapterName: cleanFileName || 'ಅಧ್ಯಾಯ 1',
            questions: rawParsed,
          },
        ],
      };
    } else {
      throw new Error('ಅಮಾನ್ಯ ಪ್ರಶ್ನೆ ಬ್ಯಾಂಕ್ JSON ರಚನೆ.');
    }
  } else if (rawParsed && typeof rawParsed === 'object') {
    const obj = rawParsed as Record<string, unknown>;
    if (Array.isArray(obj.chapters)) {
      rawBankObj = obj;
    } else if (Array.isArray(obj.questions) || Array.isArray(obj.sections)) {
      // Standalone single-unit JSON object `{ chapterName, questions: [...] }`
      rawBankObj = {
        metadata: (obj.metadata || obj.meta || {}) as Record<string, unknown>,
        chapters: [obj],
      };
    } else if (obj.chapter && typeof obj.chapter === 'object') {
      rawBankObj = {
        metadata: (obj.metadata || obj.meta || {}) as Record<string, unknown>,
        chapters: [obj.chapter],
      };
    } else {
      throw new Error('ಅಮಾನ್ಯ ಪ್ರಶ್ನೆ ಬ್ಯಾಂಕ್ JSON (chapters ಅಥವಾ questions ರಚನೆ ಲಭ್ಯವಿಲ್ಲ).');
    }
  } else {
    throw new Error('ಅಮಾನ್ಯ JSON ಫೈಲ್.');
  }

  const rawMeta = (rawBankObj.metadata || rawBankObj.meta || {}) as Record<string, unknown>;

  // Detect whether metadata or filename explicitly specifies grade / subject (don't let default "6" shadow fallback!)
  const explicitGradeRaw = String(
    rawMeta.gradeKey || rawMeta.grade || rawMeta.class || rawMeta.standard || ''
  ).trim();
  const fileGradeMatch = cleanFileName.match(
    /(?:class|std|grade|ತರಗತಿ)?[_\s-]*([6-9]|10|11|12)(?:th|nd|st|rd)?(?:\b|_)/i
  );
  const titleGradeMatch = String(rawMeta.title || '').match(
    /(?:class|std|grade|ತರಗತಿ)?[_\s-]*([6-9]|10|11|12)(?:th|nd|st|rd)?(?:\b|_)/i
  );

  const hasExplicitGrade = Boolean(explicitGradeRaw || fileGradeMatch || titleGradeMatch);
  const gradeHint =
    explicitGradeRaw ||
    (fileGradeMatch ? fileGradeMatch[1] : '') ||
    (titleGradeMatch ? titleGradeMatch[1] : '') ||
    String(fallbackMeta?.gradeKey || fallbackMeta?.grade || '6');
  const resolvedGradeKey = extractGradeKey(gradeHint);

  const explicitSubjectRaw = String(rawMeta.subject || '').trim();
  const explicitSubjectCodeRaw = rawMeta.subjectCode ? String(rawMeta.subjectCode).trim() : '';
  const deducedFromFileOrMeta = deduceSubjectCode(
    explicitSubjectCodeRaw || undefined,
    `${explicitSubjectRaw} ${String(rawMeta.title || '')} ${cleanFileName}`
  );
  const hasExplicitSubject = Boolean(
    explicitSubjectRaw || explicitSubjectCodeRaw || deducedFromFileOrMeta !== 'GEN'
  );

  const resolvedSubjectCode = hasExplicitSubject
    ? deducedFromFileOrMeta
    : deduceSubjectCode(
        fallbackMeta?.subjectCode ? String(fallbackMeta.subjectCode) : undefined,
        fallbackMeta?.subject
      );

  const resolvedSubjectName = hasExplicitSubject
    ? normalizeSubjectName(
        resolvedSubjectCode !== 'GEN' && !explicitSubjectRaw
          ? `${resolvedSubjectCode} ${cleanFileName}`
          : explicitSubjectRaw || cleanFileName
      )
    : normalizeSubjectName(fallbackMeta?.subject || cleanFileName || 'ವಿಷಯ');

  const resolvedMedium = String(
    rawMeta.medium ||
      (/(\bem\b|english\s*medium|_em_|_em$)/i.test(cleanFileName)
        ? 'English Medium'
        : fallbackMeta?.medium || 'ಕನ್ನಡ ಮಾಧ್ಯಮ (State Syllabus)')
  );

  const normalized = sanitizeBankMathText(normalizeQuestionBank(rawBankObj));
  normalized.metadata.gradeKey = resolvedGradeKey;
  normalized.metadata.grade = canonicalGradeLabel(resolvedGradeKey);
  normalized.metadata.subjectCode = resolvedSubjectCode;
  normalized.metadata.subject = resolvedSubjectName;
  normalized.metadata.medium = resolvedMedium;

  const { cleanedBank: ensured } = deduplicateQuestionBank(ensureUniqueQuestionIds(normalized));

  return {
    bank: ensured,
    gradeKey: resolvedGradeKey,
    subjectCode: resolvedSubjectCode,
    subject: resolvedSubjectName,
    hasExplicitGradeOrSubject: hasExplicitGrade || hasExplicitSubject,
    isSingleUnit: ensured.chapters.length === 1,
  };
}

export interface MergeCandidateSummary {
  id?: string;
  grade?: string;
  gradeKey?: string;
  subject?: string;
  subjectCode?: string;
  medium?: string;
  totalChapters?: number;
  totalQuestions?: number;
}

/**
 * Selects the BEST previous saved Question Bank for the same Class + Subject + Medium to merge into.
 * Always prioritizes the bank with the MOST chapters (all-units bank) and then the MOST questions,
 * so uploading even a single-unit JSON file ALWAYS merges into the comprehensive all-units file!
 */
export function pickBestMatchingBankCandidate<T extends MergeCandidateSummary>(
  candidates: T[],
  incomingBank: QuestionBank
): T | null {
  if (!candidates || candidates.length === 0) return null;

  const gKey = extractGradeKey(
    incomingBank.metadata.gradeKey
      ? String(incomingBank.metadata.gradeKey)
      : incomingBank.metadata.grade
  );
  const sCode = deduceSubjectCode(
    incomingBank.metadata.subjectCode ? String(incomingBank.metadata.subjectCode) : undefined,
    incomingBank.metadata.subject
  );
  const targetDedupKey = getSubjectDedupKey({
    grade: canonicalGradeLabel(gKey),
    gradeKey: gKey,
    subject: incomingBank.metadata.subject,
    subjectCode: sCode,
    medium: incomingBank.metadata.medium || 'ಕನ್ನಡ ಮಾಧ್ಯಮ (State Syllabus)',
  });

  const matching = candidates.filter(c => {
    const cKey = getSubjectDedupKey({
      grade: c.grade,
      gradeKey: c.gradeKey,
      subject: c.subject,
      subjectCode: c.subjectCode,
      medium: c.medium,
    });
    if (cKey === targetDedupKey) return true;
    if (incomingBank.metadata.id && c.id && c.id === incomingBank.metadata.id) return true;
    return false;
  });

  if (matching.length === 0) return null;

  matching.sort((a, b) => {
    const chDiff = (b.totalChapters || 0) - (a.totalChapters || 0);
    if (chDiff !== 0) return chDiff;
    const qDiff = (b.totalQuestions || 0) - (a.totalQuestions || 0);
    if (qDiff !== 0) return qDiff;
    // Tie-breaker: prefer exact ID match
    const aExact = incomingBank.metadata.id && a.id === incomingBank.metadata.id ? 1 : 0;
    const bExact = incomingBank.metadata.id && b.id === incomingBank.metadata.id ? 1 : 0;
    return bExact - aExact;
  });

  return matching[0];
}

export function formatMergeSummaryKannada(stats: SmartMergeStats): string {
  const parts: string[] = [];
  if (stats.preservedChapters > 0) {
    parts.push(`ಉಳಿದ ಘಟಕಗಳು ಸುರಕ್ಷಿತ: ${stats.preservedChapters}`);
  }
  if (stats.mergedChapters > 0) {
    parts.push(`ನವೀಕರಿಸಿದ ಘಟಕಗಳು: ${stats.mergedChapters}`);
  }
  if (stats.addedChapters > 0) {
    parts.push(`ಹೊಸ ಘಟಕ ಸೇರ್ಪಡೆ: +${stats.addedChapters}`);
  }
  parts.push(`ಹೊಸ ಪ್ರಶ್ನೆಗಳು: +${stats.addedQuestions}`);
  if (stats.preservedImages > 0) {
    parts.push(`ಹಳೆಯ ಚಿತ್ರಗಳು ಉಳಿದಿವೆ: ${stats.preservedImages}`);
  }
  if (stats.updatedAnswers > 0) {
    parts.push(`ಉತ್ತರಗಳು ಭರ್ತಿ: ${stats.updatedAnswers}`);
  }
  parts.push(`ಒಟ್ಟು ಪ್ರಶ್ನೆಗಳು: ${stats.totalQuestionsAfterMerge}`);
  return `🔄 ಹಳೆಯ ಎಲ್ಲಾ ಘಟಕಗಳ ಫೈಲ್‌ನೊಂದಿಗೆ ಸ್ಮಾರ್ಟ್ ಮರ್ಜ್ ಪೂರ್ಣಗೊಂಡಿದೆ! (${parts.join(' • ')})`;
}

