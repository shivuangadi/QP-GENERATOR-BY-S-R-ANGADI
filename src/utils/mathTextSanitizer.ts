/**
 * Smart Math & Geometry OCR Text Sanitizer
 * Fixes common textbook PDF OCR mistakes where the superscript degree symbol (°)
 * is misread as a trailing zero (e.g. 60° -> 600, 90° -> 900, 180° -> 1800, 360° -> 3600,
 * x° -> x0, (2x+10)° -> (2x+10)0, 60o -> 60°) across Mathematics & Science chapters,
 * while strictly protecting real numeric quantities (Rs. 600, 600 cm, 1800 students, years, etc.).
 */

import { QuestionBank, QuestionItem } from '../types/questionBank.ts';

const MATH_OR_SCIENCE_SUBJECT_REGEX =
  /(math|ಗಣಿತ|ganita|science|ವಿಜ್ಞಾನ|physics|ಭೌತ|geometry|ರೇಖಾಗಣಿತ|trigonometry|ತ್ರಿಕೋನಮಿತಿ)/i;

const ANGLE_OR_DEGREE_CONTEXT_REGEX =
  /(∠|∡|∢|\([^()]{1,28}\)0(?![0-9a-zA-Z])|\bangles?\b|\bacute\b|\bobtuse\b|\bright\s+angle\b|\bstraight\s+angle\b|\breflex\b|\bcomplementary\b|\bsupplementary\b|\blinear\s+pair\b|\bvertically\s+opposite\b|\bcorresponding\b|\balternate\b|\binterior\b|\bexterior\b|\btriangles?\b|\bquadrilaterals?\b|\bparallelograms?\b|\brhombus\b|\btrapezium\b|\bpolygons?\b|\bparallel\b|\btransversal\b|\bbisector\b|\bsector\b|\bsubtend(?:s|ed)?\b|\bcyclic\b|\btangent\b|\bdegree(?:s)?\b|\bprotractor\b|\brotation\b|\bclockwise\b|\banticlockwise\b|\belevation\b|\bdepression\b|\bsin\b|\bcos\b|\btan\b|\bcot\b|\bsec\b|\bcosec\b|\bcsc\b|\blines?\s+and\s+angles?\b|\btemperature\b|\bcelsius\b|\bfahrenheit\b|ಕೋನ|ಲಂಬಕೋನ|ಲಘುಕೋನ|ವಿಶಾಲಕೋನ|ಸರಳಕೋನ|ಸಂಪೂರ್ಣ\s*ಕೋನ|ಪ್ರತಿವರ್ತಿ|ಪೂರಕ|ಪರಿಪೂರಕ|ರೇಖಾತ್ಮಕ\s*ಜೋಡಿ|ಶೃಂಗಾಭಿಮುಖ|ಅನುರೂಪ|ಪರ್ಯಾಯ|ಅಂತರ್|ಬಾಹ್ಯ|ತ್ರಿಭುಜ|ಚತುರ್ಭುಜ|ಸಮಾಂತರ|ಛೇದಕ|ಕೋನಾರ್ಧಕ|ಡಿಗ್ರಿ|ಅಂಶ|ತ್ರಿಜ್ಯಾಂತರ|ಕಂಸ|ರೇಖೆಗಳು\s*ಮತ್ತು\s*ಕೋನಗಳು|ತ್ರಿಕೋನಮಿತಿ|ಉಷ್ಣತೆ|ಸೆಲ್ಸಿಯಸ್)/i;

const NON_DEGREE_PREFIX_REGEX =
  /(?:rs\.?|inr|₹|ರೂ\.?|rupees?|\$|€|£|year|ಇಸವಿ|ಸನ್|no\.|q\.|page|ಪುಟ|ex\.|fig\.|ಚಿತ್ರ|code|pin)\s*$/i;

const NON_DEGREE_SUFFIX_REGEX =
  /^\s*(?:cm|mm|dm|km|m\b|kg|mg|gm|g\b|ml|l\b|litres?|liters?|sec\b|secs\b|min\b|mins\b|hr\b|hrs\b|hours?|days?|weeks?|months?|years?|%|percent|sq\.?|cubic|cu\.?|rs\.?|₹|rupees?|students?|boys?|girls?|people|persons?|men|women|children|trees?|books?|apples?|mangoes?|pens?|balls?|cars?|times?|steps?|marks?|points?|questions?|pages?|words?|notes?|coins?|packs?|boxes?|bags?|units?|watts?|volts?|amps?|ohms?|hz|khz|mhz|nm|pa|bar|cal|kcal|joules?|newton|ಸೆಂ\.?ಮೀ|ಮೀ\.?|ಕಿ\.?ಮೀ|ಕೆ\.?ಜಿ|ಗ್ರಾಂ|ಲೀ\.?|ರೂಪಾಯಿ|ರೂ\.?|ವಿದ್ಯಾರ್ಥಿ|ದಿನ|ವರ್ಷ|ಗಂಟೆ|ನಿಮಿಷ|ಸೆಕೆಂಡ್|ಶೇ|ಅಂಕ|ಪುಟ|ಜನ)/i;

// Common years or non-angle multiples that should not be rewritten unless explicitly preceded by ∠ or trig fn
const PROTECTED_YEAR_NUMBERS = new Set([1900, 1910, 1920, 1930, 1940, 1950, 1960, 1970, 1980, 1990, 2000, 2010, 2020, 2030]);

const KANNADA_TO_ASCII_DIGITS: Record<string, string> = {
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

const ASCII_TO_KANNADA_DIGITS: Record<string, string> = {
  '0': '೦',
  '1': '೧',
  '2': '೨',
  '3': '೩',
  '4': '೪',
  '5': '೫',
  '6': '೬',
  '7': '೭',
  '8': '೮',
  '9': '೯',
};

function kannadaDigitsToAscii(str: string): string {
  return str.replace(/[೦-೯]/g, ch => KANNADA_TO_ASCII_DIGITS[ch] ?? ch);
}

function asciiDigitsToKannada(str: string): string {
  return str.replace(/[0-9]/g, ch => ASCII_TO_KANNADA_DIGITS[ch] ?? ch);
}

export function isMathOrScienceSubject(subjectHint?: string | null): boolean {
  if (!subjectHint) return false;
  return MATH_OR_SCIENCE_SUBJECT_REGEX.test(subjectHint);
}

export function hasAngleOrDegreeContext(text: string): boolean {
  if (!text) return false;
  return ANGLE_OR_DEGREE_CONTEXT_REGEX.test(text);
}

/**
 * Checks if a numeric candidate (already ending with '0') in `text` at `[matchStart, matchEnd)`
 * is a genuine OCR-corrupted degree value (e.g., 600 -> 60°, 900 -> 90°, 1800 -> 180°, 3600 -> 360°).
 */
function shouldConvertTrailingZeroToDegree(
  fullText: string,
  matchStart: number,
  matchEnd: number,
  numericStr: string,
  strictDirectOnly: boolean
): boolean {
  if (!numericStr.endsWith('0')) return false;
  if (numericStr.length < 2 || numericStr.length > 4) return false;
  // Never touch leading zeros like "00" or "060"
  if (numericStr.startsWith('0')) return false;

  const fullVal = parseInt(numericStr, 10);
  const baseAngle = Math.floor(fullVal / 10);

  // Valid geometry angle range: 1° to 360° (in practice 2-digit/3-digit angles like 10°..360° or 5°..360°)
  if (isNaN(baseAngle) || baseAngle < 1 || baseAngle > 360) return false;

  // Inspect surrounding context
  const before = fullText.slice(Math.max(0, matchStart - 24), matchStart);
  const after = fullText.slice(matchEnd, Math.min(fullText.length, matchEnd + 24));

  // Never touch decimals (e.g., 12.50, 0.60) or comma-grouped thousands (1,800) or values already having °
  if (
    /\d\.$/.test(before) ||
    /^\.\d/.test(after) ||
    /\d,$/.test(before) ||
    /^,\d/.test(after)
  ) {
    return false;
  }
  if (after.startsWith('°') || after.startsWith('º')) return false;

  // Reject explicit currency, length, mass, time, count, year prefixes/suffixes
  if (NON_DEGREE_PREFIX_REGEX.test(before)) return false;
  if (NON_DEGREE_SUFFIX_REGEX.test(after)) return false;

  // Check if directly attached to a strong angle/trig marker immediately before
  const directTrigOrAngleBefore =
    /(?:∠\s*[A-Za-z0-9]{0,4}\s*(?:=|is|of|:)?\s*|(?:\bsin|\bcos|\btan|\bcot|\bsec|\bcosec|\bcsc)\s*\(?\s*|\bangle\s+[A-Za-z0-9]{0,4}\s*(?:=|is|of)?\s*|ಕೋನ\s*[A-Za-z0-9]{0,4}\s*(?:=|:)?\s*)$/i.test(
      before
    );

  // Protect year-like numbers (1900, 2000, etc.) unless directly after ∠ / trig / angle=
  if (PROTECTED_YEAR_NUMBERS.has(fullVal) && !directTrigOrAngleBefore) {
    return false;
  }

  if (strictDirectOnly) {
    return directTrigOrAngleBefore;
  }

  // For 2-digit numbers like "20", "30", "40", "50", "60", "70", "80", "90":
  // DO NOT turn "60" into "6°"! Only convert 2-digit numbers ending in 0 if they are NOT common multiples of 10?
  // Wait: "60" is 60 (NOT 6°)! In real textbooks, 6° rarely occurs as "60", whereas 60° occurs as "600", 45° as "450", 90° as "900", 180° as "1800", 360° as "3600", 15° as "150", 30° as "300", 120° as "1200", 135° as "1350", 75° as "750", 5° as "50"?
  // CRITICAL SAFETY: NEVER turn 2-digit numbers (10, 20, 30, 40, 50, 60, 70, 80, 90) into 1°..9°!
  // Because in "Find the complement of 60", "60" means 60°, NOT 6°!
  // Only 3-digit and 4-digit numbers ending in '0' (100..3600 -> 10°..360°) are OCR superscript-zero errors!
  if (numericStr.length < 3) {
    return false;
  }

  // Now numericStr has 3 or 4 digits ending in '0', so baseAngle is in 10..360 (e.g. 100->10°, 150->15°, 300->30°, 450->45°, 600->60°, 900->90°, 1200->120°, 1350->135°, 1800->180°, 2700->270°, 3600->360°).
  // Wait: what about 100, 120, 150, 180, 200, 240, 270, 300, 360?
  // Wait carefully! In "∠A + ∠B = 180", 180 is 180° (NOT 18°)!
  // In "supplementary angles sum to 180", 180 is 180° (NOT 18°)!
  // In "sum of angles in a quadrilateral is 360", 360 is 360° (NOT 36°)!
  // In "if one angle is 120, find the other", 120 is 120° (NOT 12°)!
  // Let's handle this with extreme precision!
  const VALID_ACTUAL_ANGLES_WITHOUT_DEGREE = new Set([100, 110, 120, 130, 140, 150, 160, 170, 180, 200, 210, 220, 240, 270, 300, 360]);

  // If fullVal is > 360 (i.e. 370..3600, like 450, 600, 750, 900, 1050, 1200, 1350, 1500, 1800, 2700, 3600):
  // An angle in school geometry is ALWAYS <= 360°, so any angle value > 360 ending in '0' (where /10 <= 360) is 100% CERTAINLY an OCR degree error!
  if (fullVal > 360 && baseAngle <= 360) {
    return true;
  }

  // What if fullVal is between 100 and 360 (like 300 -> 30°, 250 -> 25°, 150 -> 15°, 200 -> 20°, 350 -> 35°)?
  // For example:
  //   - `sin 300` -> sin 30° (since sin 300° is rarely in Class 8-10, and if 300 is paired with 450/600/900 in same text, it's definitely 30°!)
  //   - `250`, `350`, `150`, `200`, `300`: check if the same text ALSO contains another clear >360 OCR-degree value (like `600`, `900`, `450`, `1800`, `1200`) OR ends with `0` right after a non-zero tens digit like `250`, `350`, `150`, `320`, `280`?
  //   - Be careful: `120`, `150`, `180`, `360` could be actual angles written without `°` if the text has NO `>360` corrupted degrees.
  //   - Conversely, if the text has sibling corrupted degrees (e.g. `A) 300  B) 450  C) 600  D) 900` or `If ∠A = 300 and ∠B = 600` or `x + 250 = 900`), then `300` and `250` are definitely `30°` and `25°`!
  const hasSiblingCorruptedDegree =
    /\b(?:[4-9]\d0|[12]\d{2}0|3[0-5]\d0|3600)\b/.test(fullText) ||
    /(?:sin|cos|tan|cot|sec|cosec)\s*\(?\s*300\b/i.test(fullText);

  if (fullVal >= 100 && fullVal <= 360) {
    if (hasSiblingCorruptedDegree) {
      // Only convert if not 180 or 360 in a standalone equation like "= 180" unless 1800 isn't used
      // Wait: if sibling has 600 or 900, then 180° would have been OCR'd as 1800, so 180 in that text is 18°!
      // Still, check if `fullVal` is `180` or `360` right after `=` — be conservative on 180/360 alone,
      // while 100..350 (like 300, 200, 150, 250, 350) when paired with 450/600/900 are clearly 30°, 20°, 15°, 25°, 35°!
      if ((fullVal === 180 || fullVal === 360) && !directTrigOrAngleBefore) {
        return false;
      }
      return true;
    }

    // In a complementary-angle problem (two angles sum to 90°), any 3-digit angle ending in 0 (e.g. 200, 300, 150, 250)
    // is impossible as a real angle and is 100% an OCR degree error (20°, 30°, 15°, 25°)!
    if (/\bcomplementary\b|ಪೂರಕ\s*ಕೋನ/i.test(fullText) && baseAngle < 90) {
      return true;
    }

    // Without sibling >360 corrupted degrees, only convert obvious non-standard obtuse numbers like 250, 350, 320
    // if directly attached to trig (`sin 300`, `cos 300`, `tan 300`)
    if (/(?:\bsin|\bcos|\btan|\bcot|\bsec|\bcosec|\bcsc)\s*\(?\s*$/i.test(before) && fullVal === 300) {
      return true;
    }

    if (VALID_ACTUAL_ANGLES_WITHOUT_DEGREE.has(fullVal)) {
      return false;
    }
  }

  return false;
}

/**
 * Fix superscript degree symbol (°) OCR errors in a single string.
 * @param text Input text (question, option, or answer)
 * @param forceAngleContext Pass true when the parent question/chapter is known to be about angles/geometry/trigonometry
 */
export function fixDegreeSymbolOcrErrors(
  text: string,
  forceAngleContext: boolean = false
): string {
  if (!text || typeof text !== 'string') return text;

  const inAngleContext = forceAngleContext || hasAngleOrDegreeContext(text);
  let out = text;

  // 1. Fix explicit caret/letter degree typos: 60^o, 60^0, 90^°, 60 o -> 60° (safe in math/angle contexts)
  if (inAngleContext) {
    out = out.replace(/(\d{1,3})\s*\^\s*[0oO°º]/g, '$1°');
    out = out.replace(/(\d{1,3})\s*[º˚]/g, '$1°');
    // Match `60o` or `90O` (not followed by letters like "60oz" or "30ohm")
    out = out.replace(/\b(\d{1,3})[oO](?![a-zA-Z0-9])/g, (m, num, offset) => {
      const val = parseInt(num, 10);
      if (val >= 0 && val <= 360) {
        const before = out.slice(Math.max(0, offset - 12), offset);
        if (!NON_DEGREE_PREFIX_REGEX.test(before)) {
          return `${num}°`;
        }
      }
      return m;
    });

    // 2. Fix algebraic expression degrees like (2x + 10)0 -> (2x + 10)°, (3x - 5)0 -> (3x - 5)°, x0 -> x°
    out = out.replace(/(\([^()]{1,28}\))0(?![0-9a-zA-Z])/g, '$1°');
    // Single variable angle like `∠A = x0` or `x0 + y0 = 180°` or `a0 + b0`
    out = out.replace(/(^|[\s=(+,∠])([xyzabcXYZABC])0(?=$|[\s),.+=\-;:?])/g, '$1$2°');
  }

  // 3. Fix ASCII numeric trailing-0 degree OCR errors (e.g. 600 -> 60°, 900 -> 90°, 1800 -> 180°, 3600 -> 360°, 450 -> 45°)
  out = out.replace(/\b(\d{3,4})\b/g, (match, digits: string, offset: number) => {
    const endOffset = offset + match.length;
    if (shouldConvertTrailingZeroToDegree(out, offset, endOffset, digits, !inAngleContext)) {
      return `${digits.slice(0, -1)}°`;
    }
    return match;
  });

  // 4. Fix Kannada-numeral trailing-೦ degree OCR errors (e.g., ೬೦೦ -> ೬೦°, ೯೦೦ -> ೯೦°, ೧೮೦೦ -> ೧೮೦°, ೩೬೦೦ -> ೩೬೦°)
  if (inAngleContext && /[೦-೯]/.test(out)) {
    out = out.replace(/[೧-೯][೦-೯]{1,2}೦(?![೦-೯0-9])/g, (match, offset: number) => {
      const ascii = kannadaDigitsToAscii(match);
      const endOffset = offset + match.length;
      if (shouldConvertTrailingZeroToDegree(out, offset, endOffset, ascii, false)) {
        const fixedBase = ascii.slice(0, -1);
        return `${asciiDigitsToKannada(fixedBase)}°`;
      }
      return match;
    });
  }

  return out;
}

const PLAIN_TO_UNICODE_SUP: Record<string, string> = {
  '0': '⁰',
  '1': '¹',
  '2': '²',
  '3': '³',
  '4': '⁴',
  '5': '⁵',
  '6': '⁶',
  '7': '⁷',
  '8': '⁸',
  '9': '⁹',
  '+': '⁺',
  '-': '⁻',
  '=': '⁼',
  '(': '⁽',
  ')': '⁾',
  n: 'ⁿ',
  i: 'ⁱ',
  a: 'ᵃ',
  b: 'ᵇ',
  c: 'ᶜ',
  d: 'ᵈ',
  e: 'ᵉ',
  f: 'ᶠ',
  g: 'ᵍ',
  h: 'ʰ',
  j: 'ʲ',
  k: 'ᵏ',
  l: 'ˡ',
  m: 'ᵐ',
  o: 'ᵒ',
  p: 'ᵖ',
  r: 'ʳ',
  s: 'ˢ',
  t: 'ᵗ',
  u: 'ᵘ',
  v: 'ᵛ',
  w: 'ʷ',
  x: 'ˣ',
  y: 'ʸ',
  z: 'ᶻ',
};

const PLAIN_TO_UNICODE_SUB: Record<string, string> = {
  '0': '₀',
  '1': '₁',
  '2': '₂',
  '3': '₃',
  '4': '₄',
  '5': '₅',
  '6': '₆',
  '7': '₇',
  '8': '₈',
  '9': '₉',
  '+': '₊',
  '-': '₋',
  '=': '₌',
  '(': '₍',
  ')': '₎',
  a: 'ₐ',
  e: 'ₑ',
  h: 'ₕ',
  i: 'ᵢ',
  j: 'ⱼ',
  k: 'ₖ',
  l: 'ₗ',
  m: 'ₘ',
  n: 'ₙ',
  o: 'ₒ',
  p: 'ₚ',
  r: 'ᵣ',
  s: 'ₛ',
  t: 'ₜ',
  u: 'ᵤ',
  v: 'ᵥ',
  x: 'ₓ',
};

function tryMapAllChars(str: string, map: Record<string, string>): string | null {
  const trimmed = str.replace(/\s+/g, '');
  if (!trimmed) return null;
  let result = '';
  for (const ch of trimmed) {
    if (!(ch in map)) return null;
    result += map[ch];
  }
  return result;
}

/**
 * Replaces broken Private-Use Area (Symbol/Wingdings) PDF glyphs (e.g.,  -> ∠,  -> ⊥, ⃦ -> ∥)
 * and Unicode Mathematical Alphanumeric Italic/Bold Latin letters (𝑥 -> x, 𝑙 -> l, 𝐴 -> A)
 * without touching authentic Unicode superscripts/subscripts (x², H₂O).
 */
export function normalizePdfMathGlyphs(text: string): string {
  if (!text || typeof text !== 'string') return text;
  let out = text
    .replace(/\uF0D0/g, '∠')
    .replace(/\uF05E/g, '⊥')
    .replace(/\uF0B0/g, '°')
    .replace(/\u20E6/g, '∥')
    .replace(/\uF0B4/g, '×')
    .replace(/\uF0B8/g, '÷')
    .replace(/\uF0B1/g, '±')
    .replace(/\uF0A3/g, '≤')
    .replace(/\uF0B3/g, '≥')
    .replace(/\uF0B9/g, '≠')
    .replace(/\uF044/g, '△')
    .replace(/\uF070/g, 'π')
    .replace(/\uF0D6/g, '√')
    .replace(/\uF05C/g, '∴')
    .replace(/\uF066/g, '∵')
    .replace(/\u210E/g, 'h');

  // Convert Mathematical Alphanumeric Symbols (U+1D400..U+1D7FF, e.g. 𝑥, 𝑙, 𝑚, 𝐴) to standard ASCII
  out = out.replace(/[\u{1D400}-\u{1D7FF}]/gu, ch => ch.normalize('NFKD'));
  // Clean stray space immediately after ∠ before a single letter/number label (e.g. "∠ AOC" -> "∠AOC", "∠ 1" -> "∠1")
  out = out.replace(/∠\s+([A-Za-z0-9]{1,4}\b)/g, '∠$1');
  return out;
}

/**
 * Clean up common LaTeX commands and inline $...$ wrappers into readable textbook Unicode
 * (used both during extraction sanitization and in the universal <MathText /> renderer).
 */
export function normalizeLatexMathSymbols(text: string): string {
  if (!text || typeof text !== 'string') return text;
  let out = normalizePdfMathGlyphs(text);

  // Unwrap inline LaTeX math delimiters like $x^2 + 3x + 2$ or \(a^2 + b^2\) without touching currency ($50)
  out = out.replace(/\\\(([^)]+)\\\)/g, '$1');
  out = out.replace(/\$([^$\n]{1,120})\$/g, (m, inner: string) => {
    // Keep genuine currency if inner looks like "50 and $60"
    if (/^\d+(?:\.\d+)?\s+(?:and|to|or|for)\b/i.test(inner.trim())) return m;
    return inner;
  });

  // Normalize LaTeX fraction & delimiter variants while PRESERVING \frac{num}{den}
  // so <MathText /> renders authentic textbook stacked vertical fractions
  out = out
    .replace(/\u000crac\s*\{/g, '\\frac{')
    .replace(/\\(?:dfrac|tfrac|cfrac)\s*\{/g, '\\frac{')
    .replace(/\\left\s*([([{|])/g, '$1')
    .replace(/\\right\s*([\])}|])/g, '$1')
    .replace(/\\text\{([^{}]+)\}/g, '$1')
    .replace(/\\mathrm\{([^{}]+)\}/g, '$1')
    .replace(/\\(?:quad|qquad|,|;|!)/g, ' ')
    .replace(/\\(?:circ|degree)\b/g, '°')
    .replace(/\^\{\s*\\circ\s*\}/g, '°')
    .replace(/\^\\circ\b/g, '°')
    .replace(/\\angle\b/g, '∠')
    .replace(/\\triangle\b/g, '△')
    .replace(/\\pi\b/g, 'π')
    .replace(/\\times\b/g, '×')
    .replace(/\\cdot\b/g, '·')
    .replace(/\\div\b/g, '÷')
    .replace(/\\pm\b/g, '±')
    .replace(/\\(?:leq|le)\b/g, '≤')
    .replace(/\\(?:geq|ge)\b/g, '≥')
    .replace(/\\(?:neq|ne)\b/g, '≠')
    .replace(/\\parallel\b/g, '∥')
    .replace(/\\perp\b/g, '⊥')
    .replace(/\\cong\b/g, '≅')
    .replace(/\\sim\b/g, '∼')
    .replace(/\\approx\b/g, '≈')
    .replace(/\\therefore\b/g, '∴')
    .replace(/\\because\b/g, '∵')
    .replace(/\\(?:implies|Rightarrow)\b/g, '⇒')
    .replace(/\\theta\b/g, 'θ')
    .replace(/\\alpha\b/g, 'α')
    .replace(/\\beta\b/g, 'β')
    .replace(/\\gamma\b/g, 'γ')
    .replace(/\\Delta\b/g, 'Δ')
    .replace(/\\infty\b/g, '∞')
    .replace(/\\sqrt\{([A-Za-z0-9]{1,3})\}/g, '√$1')
    .replace(/\\sqrt\{([^{}]+)\}/g, '√($1)');

  return out;
}

/**
 * Parse a simple fraction inside an exponent like "2/5", "-1/4", "+3/2", "m/n", "3x/2"
 * into `{ sign, num, den }`, or return null if it is not a clean single fraction.
 */
export function parseSimpleFractionExponent(
  rawExp: string
): { sign: string; num: string; den: string } | null {
  const trimmed = rawExp.trim();
  if (!trimmed || !trimmed.includes('/')) return null;

  // Strip a single redundant outer pair of parentheses if balanced, e.g. "(2/5)" -> "2/5"
  let inner = trimmed;
  if (inner.startsWith('(') && inner.endsWith(')')) {
    let depth = 0;
    let wrapsAll = true;
    for (let i = 0; i < inner.length; i++) {
      if (inner[i] === '(') depth++;
      else if (inner[i] === ')') depth--;
      if (depth === 0 && i < inner.length - 1) {
        wrapsAll = false;
        break;
      }
    }
    if (wrapsAll) {
      inner = inner.slice(1, -1).trim();
    }
  }

  // Match optional leading sign + clean numerator / clean denominator (no stray slashes or spaces around sentences)
  const fracMatch = inner.match(
    /^([+-])?\s*([A-Za-z0-9.√π²³⁴⁵⁶⁷⁸⁹⁰]+(?:\s*[+-]\s*[A-Za-z0-9.√π²³⁴⁵⁶⁷⁸⁹⁰]+)?)\s*\/\s*([A-Za-z0-9.√π²³⁴⁵⁶⁷⁸⁹⁰]+(?:\s*[+-]\s*[A-Za-z0-9.√π²³⁴⁵⁶⁷⁸⁹⁰]+)?)$/
  );
  if (!fracMatch) return null;

  const sign = fracMatch[1] || '';
  const num = fracMatch[2].trim();
  const den = fracMatch[3].trim();
  if (!num || !den || num.length > 16 || den.length > 16) return null;
  return { sign, num, den };
}

/**
 * Convert raw caret superscripts:
 *  - Fractional exponents: (32)^(2/5) -> (32)^{\frac{2}{5}}, 9^(3/2) -> 9^{\frac{3}{2}}, x^(-2/3) -> x^{-\frac{2}{3}}
 *  - Parenthesized exponents: (ab)^(-2) -> (ab)⁻², 2^(n+1) -> 2ⁿ⁺¹, x^(3+y) -> x³⁺ʸ
 *  - Braced exponents: x^{2} -> x², 10^{-5} -> 10⁻⁵, a^{2/5} -> a^{\frac{2}{5}}
 *  - Unbraced exponents: x^2 -> x², a^2b² -> a²b², a^-2b⁻² -> a⁻²b⁻², cm^2 -> cm², 90^° -> 90°
 * and safe chemical/math subscripts (H_2O -> H₂O, CO_2 -> CO₂, x_1 -> x₁) into clean textbook math
 * so stored JSON files and rendered equations match printed textbooks cleanly.
 */
export function formatMathSuperSubUnicode(text: string): string {
  if (!text || typeof text !== 'string') return text;
  let out = normalizeLatexMathSymbols(text);

  // 0. Fix explicit caret degree markers like 90^°, 1^°, x^° -> 90°, 1°, x°
  out = out.replace(/([^\s(])\^\s*[°º]/g, '$1°');

  // 1. Parenthesized superscripts: (32)^(2/5), 9^(3/2), 9 ^ (3/2), (ab)^(-2), 2^(n+1), (√(x³))^(2/3)
  //    Strictly requires a valid non-delimiter base token before `^` (never touches Hindi "( ^ )")
  out = out.replace(/([^\s([{-])[ \t]*\^[ \t]*\(([^()]{1,40})\)/g, (match, base: string, exp: string) => {
    const cleanExp = exp.trim();
    if (!cleanExp) return match;
    if (cleanExp === '°' || cleanExp === 'º' || cleanExp === '\\circ') {
      return `${base}°`;
    }
    const frac = parseSimpleFractionExponent(cleanExp);
    if (frac) {
      return `${base}^{${frac.sign}\\frac{${frac.num}}{${frac.den}}}`;
    }
    const mapped = tryMapAllChars(cleanExp, PLAIN_TO_UNICODE_SUP);
    if (mapped) {
      return `${base}${mapped}`;
    }
    return `${base}^{${cleanExp}}`;
  });

  // 2. Braced superscripts: x^{2}, 10^{-5}, a^{m+n}, (32)^{2/5}, (32)^{\frac{2}{5}}
  out = out.replace(/([^\s([{-])[ \t]*\^[ \t]*\{([^{}]+)\}/g, (match, base: string, exp: string) => {
    const cleanExp = exp.trim();
    if (cleanExp === '°' || cleanExp === 'º' || cleanExp === '\\circ') {
      return `${base}°`;
    }
    const frac = parseSimpleFractionExponent(cleanExp);
    if (frac) {
      return `${base}^{${frac.sign}\\frac{${frac.num}}{${frac.den}}}`;
    }
    const mapped = tryMapAllChars(cleanExp, PLAIN_TO_UNICODE_SUP);
    return mapped ? `${base}${mapped}` : match;
  });

  // 3a. Unbraced numeric superscripts (including immediately before variables like a^2b², a^-2b⁻², x^2y^3)
  out = out.replace(/([^\s([{-])\^(-?\d+)(?![0-9])/g, (match, base: string, exp: string) => {
    const mapped = tryMapAllChars(exp, PLAIN_TO_UNICODE_SUP);
    return mapped ? `${base}${mapped}` : match;
  });

  // 3b. Unbraced single-letter superscripts: a^n, x^m
  out = out.replace(/([^\s([{-])\^([a-zA-Z])(?![a-zA-Z0-9])/g, (match, base: string, exp: string) => {
    const mapped = tryMapAllChars(exp, PLAIN_TO_UNICODE_SUP);
    return mapped ? `${base}${mapped}` : match;
  });

  // 4. Braced subscripts: H_{2}O, log_{10}, a_{n-1}
  out = out.replace(/([^\s])_\{([^}]+)\}/g, (match, base: string, sub: string) => {
    const mapped = tryMapAllChars(sub.trim(), PLAIN_TO_UNICODE_SUB);
    return mapped ? `${base}${mapped}` : match;
  });

  // 5. Safe chemical/math unbraced subscripts (H_2O, H_2SO_4, Ca(OH)_2, CO_2, x_1, a_n) — strictly skip URLs/paths
  if (out.includes('_') && !/https?:\/\/|\/api\//i.test(out)) {
    // 5a. Chemical formulas where an uppercase element symbol or closing ')' is followed by _digits (e.g. H_2O, H_2CO_3, Al_2(SO_4)_3)
    out = out.replace(
      /([A-Z][a-z]?|\))_([0-9]{1,3})(?=$|[^a-z0-9_])/g,
      (match, base: string, sub: string) => {
        const mapped = tryMapAllChars(sub, PLAIN_TO_UNICODE_SUB);
        return mapped ? `${base}${mapped}` : match;
      }
    );
    // 5b. Math variable / log subscripts (e.g. x_1, y_2, a_n, log_10) without touching snake_case identifiers
    out = out.replace(
      /(^|[^a-zA-Z0-9_/])([A-Za-z]{1,3})_([0-9]{1,3}|[a-zA-Z])(?=$|[^a-zA-Z0-9_])/g,
      (match, prefix: string, base: string, sub: string) => {
        const mapped = tryMapAllChars(sub, PLAIN_TO_UNICODE_SUB);
        return mapped ? `${prefix}${base}${mapped}` : match;
      }
    );
  }

  return out;
}

/**
 * Lightweight math superscript/subscript normalizer for an entire QuestionBank
 * (safe for ALL subjects; transforms caret exponents like (32)^(2/5) -> (32)^{\frac{2}{5}},
 * (ab)^(-2) -> (ab)⁻², a^2b² -> a²b², 90^° -> 90° without altering unrelated prose).
 */
export function formatBankMathExpressions(bank: QuestionBank): QuestionBank {
  if (!bank || !Array.isArray(bank.chapters)) return bank;
  return {
    ...bank,
    chapters: bank.chapters.map(ch => ({
      ...ch,
      questions: (ch.questions || []).map(q => ({
        ...q,
        question: typeof q.question === 'string' ? formatMathSuperSubUnicode(q.question) : q.question,
        answer: typeof q.answer === 'string' ? formatMathSuperSubUnicode(q.answer) : q.answer,
        ...(Array.isArray(q.options)
          ? { options: q.options.map(opt => formatMathSuperSubUnicode(String(opt ?? ''))) }
          : {}),
        ...(Array.isArray(q.items)
          ? {
              items: q.items.map(it => ({
                left: formatMathSuperSubUnicode(String(it.left ?? '')),
                right: formatMathSuperSubUnicode(String(it.right ?? '')),
              })),
            }
          : {}),
      })),
    })),
  };
}

/**
 * Sanitize a single QuestionItem (question text, MCQ options, answer, match items):
 *  - Always formats caret superscripts/subscripts & LaTeX symbols (x^2 -> x², cm^2 -> cm², H_2O -> H₂O)
 *  - Fixes degree symbol OCR errors (600 -> 60°, 900 -> 90°, 1800 -> 180°) in Mathematics/Science or angle questions
 */
export function sanitizeQuestionMathText<T extends Partial<QuestionItem>>(
  question: T,
  subjectHint?: string | null
): T {
  const combinedForContext = [
    question.chapterName || '',
    question.question || '',
    question.answer || '',
    Array.isArray(question.options) ? question.options.join(' ') : '',
  ].join(' ');

  const isAngleQuestion = hasAngleOrDegreeContext(combinedForContext);
  const isMathSubj = isMathOrScienceSubject(subjectHint);
  const shouldFixDegrees = isMathSubj || isAngleQuestion;
  const forceAngle = isAngleQuestion;

  const cleanText = (val: string, forceDeg: boolean): string => {
    const withSuperSub = formatMathSuperSubUnicode(val);
    return shouldFixDegrees ? fixDegreeSymbolOcrErrors(withSuperSub, forceDeg) : withSuperSub;
  };

  // For options, inspect all options together so sibling >360 degrees (e.g., 300 alongside 450, 600, 900) are detected!
  let sanitizedOptions = question.options;
  if (Array.isArray(question.options) && question.options.length > 0) {
    const joinedOpts = question.options.join(' | ');
    const hasSiblingCorruptedInOptionsOrStem =
      /\b(?:[4-9]\d0|[12]\d{2}0|3[0-5]\d0|3600)\b/.test(`${question.question || ''} ${joinedOpts}`);

    sanitizedOptions = question.options.map(opt => {
      let cleaned = cleanText(String(opt || ''), forceAngle);
      // Handle 3-digit option like "A) 300" when sibling options are 450/600/900
      if (shouldFixDegrees && forceAngle && hasSiblingCorruptedInOptionsOrStem) {
        cleaned = cleaned.replace(/\b([1-3]\d)0\b(?!°)/g, (m, base: string, offset: number) => {
          const val = parseInt(m, 10);
          if (val === 180 || val === 360) return m;
          const before = cleaned.slice(Math.max(0, offset - 10), offset);
          const after = cleaned.slice(offset + m.length, offset + m.length + 12);
          if (NON_DEGREE_PREFIX_REGEX.test(before) || NON_DEGREE_SUFFIX_REGEX.test(after)) {
            return m;
          }
          return `${base}°`;
        });
      }
      return cleaned;
    });
  }

  let sanitizedAnswer =
    typeof question.answer === 'string'
      ? cleanText(question.answer, forceAngle)
      : question.answer;

  // If answer matches one of the pre-sanitized options (e.g. "A) 300" -> "A) 30°"), keep it consistent
  if (
    shouldFixDegrees &&
    forceAngle &&
    typeof sanitizedAnswer === 'string' &&
    Array.isArray(question.options) &&
    Array.isArray(sanitizedOptions)
  ) {
    const trimmedAns = sanitizedAnswer.trim();
    const rawIdx = question.options.findIndex(o => String(o || '').trim() === trimmedAns);
    if (rawIdx >= 0 && sanitizedOptions[rawIdx]) {
      sanitizedAnswer = sanitizedOptions[rawIdx];
    }
  }

  const sanitizedItems = Array.isArray(question.items)
    ? question.items.map(it => ({
        left: cleanText(String(it.left || ''), forceAngle),
        right: cleanText(String(it.right || ''), forceAngle),
      }))
    : question.items;

  return {
    ...question,
    question:
      typeof question.question === 'string'
        ? cleanText(question.question, forceAngle)
        : question.question,
    answer: sanitizedAnswer,
    ...(sanitizedOptions !== undefined ? { options: sanitizedOptions } : {}),
    ...(sanitizedItems !== undefined ? { items: sanitizedItems } : {}),
  };
}

/**
 * Sanitize an entire QuestionBank for superscripts/subscripts and degree symbol OCR errors across all chapters.
 */
export function sanitizeBankMathText(bank: QuestionBank): QuestionBank {
  const subjectHint = [
    bank.metadata?.subject || '',
    bank.metadata?.subjectCode || '',
    bank.metadata?.title || '',
  ].join(' ');

  return {
    ...bank,
    chapters: (bank.chapters || []).map(ch => ({
      ...ch,
      questions: (ch.questions || []).map(q =>
        sanitizeQuestionMathText(
          { ...q, chapterName: q.chapterName || ch.chapterName },
          subjectHint
        )
      ),
    })),
  };
}
