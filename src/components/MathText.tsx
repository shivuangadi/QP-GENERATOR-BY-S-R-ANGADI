/**
 * Universal Mathematical & Scientific Typography Renderer (<MathText />)
 * Renders superscripts (x^2, x^{n+1}, (a+b)^2, cm^2, 10^-5, x²), subscripts (H_2O, CO_2, x_1, a_{n-1}, H₂O),
 * and common LaTeX/math symbols (\angle, \triangle, \pi, \times, \div, \pm, \le, \ge, \neq, \circ, \sqrt{})
 * using native HTML <sup> and <sub> elements so equations look identical to the printed LBA textbook
 * across the entire application (Preview, Print, Answer Key, Explorer, AI Generator, Image Modal).
 *
 * Security: Pure React element tree — zero dangerouslySetInnerHTML.
 */

import React from 'react';
import { normalizeLatexMathSymbols } from '../utils/mathTextSanitizer.ts';

interface MathTextProps {
  text?: string | null;
  className?: string;
}

const UNICODE_SUP_TO_PLAIN: Record<string, string> = {
  '⁰': '0',
  '¹': '1',
  '²': '2',
  '³': '3',
  '⁴': '4',
  '⁵': '5',
  '⁶': '6',
  '⁷': '7',
  '⁸': '8',
  '⁹': '9',
  '⁺': '+',
  '⁻': '-',
  '⁼': '=',
  '⁽': '(',
  '⁾': ')',
  'ⁿ': 'n',
  'ⁱ': 'i',
  'ᵃ': 'a',
  'ᵇ': 'b',
  'ᶜ': 'c',
  'ᵈ': 'd',
  'ᵉ': 'e',
  'ᶠ': 'f',
  'ᵍ': 'g',
  'ʰ': 'h',
  'ʲ': 'j',
  'ᵏ': 'k',
  'ˡ': 'l',
  'ᵐ': 'm',
  'ᵒ': 'o',
  'ᵖ': 'p',
  'ʳ': 'r',
  'ˢ': 's',
  'ᵗ': 't',
  'ᵘ': 'u',
  'ᵛ': 'v',
  'ʷ': 'w',
  'ˣ': 'x',
  'ʸ': 'y',
  'ᶻ': 'z',
};

const UNICODE_SUB_TO_PLAIN: Record<string, string> = {
  '₀': '0',
  '₁': '1',
  '₂': '2',
  '₃': '3',
  '₄': '4',
  '₅': '5',
  '₆': '6',
  '₇': '7',
  '₈': '8',
  '₉': '9',
  '₊': '+',
  '₋': '-',
  '₌': '=',
  '₍': '(',
  '₎': ')',
  'ₐ': 'a',
  'ₑ': 'e',
  'ₕ': 'h',
  'ᵢ': 'i',
  'ⱼ': 'j',
  'ₖ': 'k',
  'ₗ': 'l',
  'ₘ': 'm',
  'ₙ': 'n',
  'ₒ': 'o',
  'ₚ': 'p',
  'ᵣ': 'r',
  'ₛ': 's',
  'ₜ': 't',
  'ᵤ': 'u',
  'ᵥ': 'v',
  'ₓ': 'x',
};

const UNICODE_SUP_CHARS = Object.keys(UNICODE_SUP_TO_PLAIN).join('');
const UNICODE_SUB_CHARS = Object.keys(UNICODE_SUB_TO_PLAIN).join('');

// Matches:
// 1. Caret with braces: ^{...}
// 2. Caret without braces: ^(-?[0-9]+(?:\.[0-9]+)?|[a-zA-Z])  (e.g. x^2, 10^-5, a^n, cm^2)
// 3. Underscore with braces: _{...} (preceded by short math/chem token)
// 4. Underscore single/numeric subscript: _([0-9]+|[a-zA-Z]) when preceded by a 1-4 char chem/math symbol (not snake_case!)
// 5. Existing Unicode superscripts run (e.g., ², ³, ⁻⁵, ⁿ⁺¹)
// 6. Existing Unicode subscripts run (e.g., ₂, ₁, ₙ)
const MATH_TOKEN_REGEX = new RegExp(
  [
    // Group 1: ^{...}
    '\\^\\{([^}]+)\\}',
    // Group 2: ^exponent (number with optional leading sign, or single variable like a^n, x^m)
    '\\^(-?\\d+(?:\\.\\d+)?|[a-zA-Z])(?![a-zA-Z0-9])',
    // Group 3: _{...}
    '_\\{([^}]+)\\}',
    // Group 4: Unicode superscript run (rendered via <sup> for crisp textbook alignment in Kannada fonts too)
    `([${UNICODE_SUP_CHARS}]+)`,
    // Group 5: Unicode subscript run
    `([${UNICODE_SUB_CHARS}]+)`,
  ].join('|'),
  'g'
);

// Chemical formula subscripts like H_2O, H_2SO_4, Ca(OH)_2, Al_2(SO_4)_3
const CHEM_SUBSCRIPT_REGEX = /([A-Z][a-z]?|\))_([0-9]{1,3})(?=$|[^a-z0-9_])/g;
// Math variable subscripts like x_1, a_n, log_10 — only when NOT part of a URL or snake_case identifier
const SIMPLE_SUBSCRIPT_REGEX = /(^|[^a-zA-Z0-9_/])([A-Za-z]{1,3})_([0-9]{1,3}|[a-zA-Z])(?=$|[^a-zA-Z0-9_])/g;

function decodeUnicodeMap(str: string, map: Record<string, string>): string {
  let out = '';
  for (const ch of str) {
    out += map[ch] ?? ch;
  }
  return out;
}

/**
 * Read a balanced `{...}` group starting at `startIndex` (which must point to `{`).
 * Returns `{ content, nextIndex }` or `null` if braces are unbalanced.
 */
function readBalancedBraceGroup(
  str: string,
  startIndex: number
): { content: string; nextIndex: number } | null {
  if (startIndex >= str.length || str[startIndex] !== '{') return null;
  let depth = 0;
  for (let i = startIndex; i < str.length; i++) {
    const ch = str[i];
    if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) {
        return {
          content: str.slice(startIndex + 1, i),
          nextIndex: i + 1,
        };
      }
    }
  }
  return null;
}

/**
 * Render inline superscripts & subscripts inside a fraction-free text segment.
 */
function renderInlineSuperSubNodes(
  segment: string,
  keyPrefix: string
): React.ReactNode[] {
  if (!segment) return [];

  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;
  let keyCounter = 0;

  const regex = new RegExp(MATH_TOKEN_REGEX.source, 'g');
  let match: RegExpExecArray | null;

  while ((match = regex.exec(segment)) !== null) {
    const matchStart = match.index;
    const matchEnd = matchStart + match[0].length;

    // Avoid converting standalone carets at the very start of text or after whitespace unless preceded by a base token
    const prevChar = matchStart > 0 ? segment[matchStart - 1] : '';
    const isCaretMatch = match[1] !== undefined || match[2] !== undefined;
    if (isCaretMatch && (!prevChar || /\s/.test(prevChar))) {
      continue;
    }

    if (matchStart > lastIndex) {
      nodes.push(segment.slice(lastIndex, matchStart));
    }

    if (match[1] !== undefined || match[2] !== undefined) {
      const supContent = match[1] ?? match[2];
      if (supContent === '°' || supContent === 'º' || supContent === '\\circ') {
        nodes.push('°');
      } else {
        nodes.push(
          <sup
            key={`${keyPrefix}-sup-${keyCounter++}`}
            className="text-[0.72em] leading-none font-semibold align-baseline relative -top-[0.38em] px-[0.5px]"
          >
            {supContent}
          </sup>
        );
      }
    } else if (match[3] !== undefined) {
      nodes.push(
        <sub
          key={`${keyPrefix}-sub-${keyCounter++}`}
          className="text-[0.72em] leading-none align-baseline relative top-[0.25em] px-[0.5px]"
        >
          {match[3]}
        </sub>
      );
    } else if (match[4] !== undefined) {
      const plainSup = decodeUnicodeMap(match[4], UNICODE_SUP_TO_PLAIN);
      nodes.push(
        <sup
          key={`${keyPrefix}-usup-${keyCounter++}`}
          className="text-[0.72em] leading-none font-semibold align-baseline relative -top-[0.38em] px-[0.5px]"
        >
          {plainSup}
        </sup>
      );
    } else if (match[5] !== undefined) {
      const plainSub = decodeUnicodeMap(match[5], UNICODE_SUB_TO_PLAIN);
      nodes.push(
        <sub
          key={`${keyPrefix}-usub-${keyCounter++}`}
          className="text-[0.72em] leading-none align-baseline relative top-[0.25em] px-[0.5px]"
        >
          {plainSub}
        </sub>
      );
    }

    lastIndex = matchEnd;
  }

  if (lastIndex < segment.length) {
    nodes.push(segment.slice(lastIndex));
  }

  return nodes;
}

/**
 * Recursively parses balanced `\frac{numerator}{denominator}` expressions into textbook
 * stacked vertical fractions, while rendering superscripts/subscripts inside and around them.
 */
function parseFractionsAndMath(
  prepared: string,
  depth: number,
  keyPrefix: string
): React.ReactNode[] {
  if (!prepared) return [];
  if (depth >= 4 || !prepared.includes('\\frac')) {
    return renderInlineSuperSubNodes(prepared, keyPrefix);
  }

  const nodes: React.ReactNode[] = [];
  let cursor = 0;
  let segIdx = 0;

  while (cursor < prepared.length) {
    const fracIdx = prepared.indexOf('\\frac', cursor);
    if (fracIdx === -1) {
      nodes.push(
        ...renderInlineSuperSubNodes(prepared.slice(cursor), `${keyPrefix}-t${segIdx++}`)
      );
      break;
    }

    // Advance past `\frac` and optional whitespace
    let pos = fracIdx + 5;
    while (pos < prepared.length && /\s/.test(prepared[pos])) pos++;

    const numGroup = readBalancedBraceGroup(prepared, pos);
    if (!numGroup) {
      // Unclosed / incomplete \frac while typing — emit verbatim up to fracIdx + 5 and continue
      nodes.push(
        ...renderInlineSuperSubNodes(prepared.slice(cursor, fracIdx + 5), `${keyPrefix}-u${segIdx++}`)
      );
      cursor = fracIdx + 5;
      continue;
    }

    let denPos = numGroup.nextIndex;
    while (denPos < prepared.length && /\s/.test(prepared[denPos])) denPos++;

    const denGroup = readBalancedBraceGroup(prepared, denPos);
    if (!denGroup) {
      nodes.push(
        ...renderInlineSuperSubNodes(prepared.slice(cursor, fracIdx + 5), `${keyPrefix}-u${segIdx++}`)
      );
      cursor = fracIdx + 5;
      continue;
    }

    if (fracIdx > cursor) {
      nodes.push(
        ...renderInlineSuperSubNodes(prepared.slice(cursor, fracIdx), `${keyPrefix}-p${segIdx++}`)
      );
    }

    const fracKey = `${keyPrefix}-f${segIdx++}`;
    nodes.push(
      <span
        key={fracKey}
        className="inline-flex flex-col items-center justify-center align-middle mx-0.5 my-[1px] leading-tight text-[0.88em] font-medium"
      >
        <span className="border-b border-current px-1 pb-[1px] text-center leading-tight min-w-[0.9em]">
          {parseFractionsAndMath(numGroup.content.trim(), depth + 1, `${fracKey}-n`)}
        </span>
        <span className="px-1 pt-[1px] text-center leading-tight min-w-[0.9em]">
          {parseFractionsAndMath(denGroup.content.trim(), depth + 1, `${fracKey}-d`)}
        </span>
      </span>
    );

    cursor = denGroup.nextIndex;
  }

  return nodes;
}

/**
 * Parse a math/science string into a safe ReactNode array with stacked vertical fractions
 * (\frac{a}{b}), native HTML <sup> and <sub> tags, and clean Unicode math symbols.
 */
export function renderMathNodes(rawText: string): React.ReactNode[] {
  if (!rawText) return [];

  // Normalize LaTeX symbols & stray $ math wrappers, preserving \frac{num}{den}
  let prepared = normalizeLatexMathSymbols(rawText);

  // Convert safe chemical & math subscripts (H_2O, H_2SO_4, x_1, a_n) into _{...} form so the single tokenizer handles them cleanly
  if (prepared.includes('_') && !/https?:\/\/|\/api\//i.test(prepared)) {
    prepared = prepared
      .replace(CHEM_SUBSCRIPT_REGEX, '$1_{$2}')
      .replace(SIMPLE_SUBSCRIPT_REGEX, '$1$2_{$3}');
  }

  return parseFractionsAndMath(prepared, 0, 'm');
}

export const MathText: React.FC<MathTextProps> = ({ text, className }) => {
  if (!text) return null;
  const nodes = renderMathNodes(text);
  if (className) {
    return <span className={className}>{nodes}</span>;
  }
  return <>{nodes}</>;
};
