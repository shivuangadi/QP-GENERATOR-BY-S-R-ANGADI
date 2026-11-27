/**
 * Universal Mathematical & Scientific Typography Renderer (<MathText />)
 * Renders:
 *  - Fractional superscripts with stacked vertical fractions positioned cleanly at the upper-right shoulder:
 *    (32)^(2/5), (32)^{\frac{2}{5}}, 9^(3/2), 9^{\frac{3}{2}}, x^(2/3), (256)^(-1/4)
 *  - Standard & parenthesized/braced superscripts:
 *    x^2, x^{n+1}, (ab)^(-2), a^2b², cm^2, 10^-5, x²
 *  - Subscripts: H_2O, CO_2, x_1, a_{n-1}, H₂O
 *  - Stacked vertical fractions: \frac{num}{den}
 *  - Common LaTeX/math symbols (\angle, \triangle, \pi, \times, \div, \pm, \le, \ge, \neq, \circ, \sqrt{})
 *
 * Layout note:
 *  - Uses CSS2.1 `inline-block` + `block` numerator/denominator (NEVER `inline-flex flex-col`),
 *    so the element baseline is anchored to the denominator rather than the numerator, and `static`
 *    overrides Tailwind Preflight's `sup { position: relative; top: -0.5em }`.
 *  - Glues each base token (e.g. `9`, `(32)`, `x`) and its superscript inside `<span dir="ltr" className="inline whitespace-nowrap">`
 *    so superscripts always stay immediately on the upper-right side of their base number.
 *
 * Security: Pure React element tree — zero dangerouslySetInnerHTML.
 */

import React from 'react';
import {
  normalizeLatexMathSymbols,
  parseSimpleFractionExponent,
} from '../utils/mathTextSanitizer.ts';

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
const UNICODE_SUP_SUB_REGEX = new RegExp(
  `([${UNICODE_SUP_CHARS}]+)|([${UNICODE_SUB_CHARS}]+)`,
  'g'
);

// Chemical formula subscripts like H_2O, H_2SO_4, Ca(OH)_2, Al_2(SO_4)_3
const CHEM_SUBSCRIPT_REGEX = /([A-Z][a-z]?|\))_([0-9]{1,3})(?=$|[^a-z0-9_])/g;
// Math variable subscripts like x_1, a_n, log_10 — only when NOT part of a URL or snake_case identifier
const SIMPLE_SUBSCRIPT_REGEX =
  /(^|[^a-zA-Z0-9_/])([A-Za-z]{1,3})_([0-9]{1,3}|[a-zA-Z])(?=$|[^a-zA-Z0-9_])/g;

const FRACTION_SUP_CLASS =
  'static inline-block align-[0.52em] text-[0.58em] leading-none font-semibold ml-[0.12em] mr-[0.14em] whitespace-nowrap';

const STANDARD_SUP_CLASS =
  'static inline-block align-[0.52em] text-[0.68em] leading-none font-semibold ml-[0.06em] mr-[0.06em]';

const STANDARD_SUB_CLASS =
  'static inline-block align-[-0.24em] text-[0.68em] leading-none font-medium ml-[0.04em] mr-[0.06em]';

function decodeUnicodeMap(str: string, map: Record<string, string>): string {
  let out = '';
  for (const ch of str) {
    out += map[ch] ?? ch;
  }
  return out;
}

/**
 * Read a balanced delimiter group (`{...}` or `(...)`) starting at `startIndex`.
 */
function readBalancedGroup(
  str: string,
  startIndex: number,
  openChar: '{' | '(',
  closeChar: '}' | ')'
): { content: string; nextIndex: number } | null {
  if (startIndex >= str.length || str[startIndex] !== openChar) return null;
  let depth = 0;
  for (let i = startIndex; i < str.length; i++) {
    const ch = str[i];
    if (ch === openChar) {
      depth++;
    } else if (ch === closeChar) {
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
 * Try reading `\frac{num}{den}` starting at `startIndex`.
 */
function readLatexFrac(
  str: string,
  startIndex: number
): { num: string; den: string; nextIndex: number } | null {
  if (!str.startsWith('\\frac', startIndex)) return null;
  let pos = startIndex + 5;
  while (pos < str.length && /\s/.test(str[pos])) pos++;
  const numGroup = readBalancedGroup(str, pos, '{', '}');
  if (!numGroup) return null;
  let denPos = numGroup.nextIndex;
  while (denPos < str.length && /\s/.test(str[denPos])) denPos++;
  const denGroup = readBalancedGroup(str, denPos, '{', '}');
  if (!denGroup) return null;
  return {
    num: numGroup.content.trim(),
    den: denGroup.content.trim(),
    nextIndex: denGroup.nextIndex,
  };
}

/**
 * Split the immediately preceding base token (`9`, `(32)`, `x`, `(√(x³))`, etc.) from `textBuffer`
 * so the base token and its superscript can be glued together inside a non-breaking LTR span.
 */
function extractTrailingBaseToken(buf: string): { prefix: string; base: string } {
  if (!buf) return { prefix: '', base: '' };
  const lastChar = buf[buf.length - 1];

  // Balanced closing parenthesis/bracket base like `(32)`, `(9)`, `(√(x³))`, `[a+b]`
  if (lastChar === ')' || lastChar === ']') {
    const openChar = lastChar === ')' ? '(' : '[';
    let depth = 0;
    for (let j = buf.length - 1; j >= 0; j--) {
      if (buf[j] === lastChar) {
        depth++;
      } else if (buf[j] === openChar) {
        depth--;
        if (depth === 0) {
          return {
            prefix: buf.slice(0, j),
            base: buf.slice(j),
          };
        }
      }
    }
    return {
      prefix: buf.slice(0, -1),
      base: lastChar,
    };
  }

  // Trailing numeric or variable token like `9`, `64`, `256`, `10`, `x`, `cm`, `π`
  const tokenMatch = buf.match(/([A-Za-z0-9.πθ√]+)$/);
  if (tokenMatch) {
    const base = tokenMatch[1];
    return {
      prefix: buf.slice(0, buf.length - base.length),
      base,
    };
  }

  return {
    prefix: buf.slice(0, -1),
    base: lastChar,
  };
}

/**
 * Render Unicode superscript/subscript runs inside a plain text leaf into crisp <sup>/<sub> tags.
 */
function renderUnicodeSuperSubLeaf(text: string, keyPrefix: string): React.ReactNode[] {
  if (!text) return [];
  const regex = new RegExp(UNICODE_SUP_SUB_REGEX.source, 'g');
  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;
  let idx = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }
    if (match[1] !== undefined) {
      const plainSup = decodeUnicodeMap(match[1], UNICODE_SUP_TO_PLAIN);
      nodes.push(
        <sup key={`${keyPrefix}-usup-${idx++}`} className={STANDARD_SUP_CLASS}>
          {plainSup}
        </sup>
      );
    } else if (match[2] !== undefined) {
      const plainSub = decodeUnicodeMap(match[2], UNICODE_SUB_TO_PLAIN);
      nodes.push(
        <sub key={`${keyPrefix}-usub-${idx++}`} className={STANDARD_SUB_CLASS}>
          {plainSub}
        </sub>
      );
    }
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }
  return nodes;
}

/**
 * Render a stacked vertical fraction (standard inline size OR compact superscript size).
 * Uses `inline-block` + `block` children (never `inline-flex flex-col`) so the CSS baseline
 * anchors cleanly to the denominator in superscripts and centers cleanly in inline math.
 */
function renderStackedFraction(
  numRaw: string,
  denRaw: string,
  depth: number,
  key: string,
  compact: boolean,
  sign?: string
): React.ReactNode {
  if (compact) {
    return (
      <React.Fragment key={key}>
        {sign ? (
          <span className="inline-block align-[0.52em] mr-[1.5px] font-semibold leading-none">
            {sign === '-' ? '−' : sign}
          </span>
        ) : null}
        <span className="inline-block align-baseline text-center leading-none">
          <span className="block border-b border-current px-[2px] pb-[1px] leading-[0.95] min-w-[0.8em]">
            {parseMathExpression(numRaw, depth + 1, `${key}-n`, true)}
          </span>
          <span className="block px-[2px] pt-[1.5px] leading-[0.95] min-w-[0.8em]">
            {parseMathExpression(denRaw, depth + 1, `${key}-d`, true)}
          </span>
        </span>
      </React.Fragment>
    );
  }

  return (
    <span
      key={key}
      dir="ltr"
      className="inline-block align-middle mx-0.5 my-[1px] whitespace-nowrap leading-none"
    >
      {sign ? (
        <span className="inline-block align-middle mr-0.5 font-medium">
          {sign === '-' ? '−' : sign}
        </span>
      ) : null}
      <span className="inline-block align-middle text-center text-[0.86em] font-medium leading-none">
        <span className="block border-b border-current px-1 pb-[1.5px] leading-[1.05] min-w-[0.9em]">
          {parseMathExpression(numRaw, depth + 1, `${key}-n`, false)}
        </span>
        <span className="block px-1 pt-[1.5px] leading-[1.05] min-w-[0.9em]">
          {parseMathExpression(denRaw, depth + 1, `${key}-d`, false)}
        </span>
      </span>
    </span>
  );
}

/**
 * Render a superscript expression cleanly on the upper-right shoulder of its base:
 * - Detects stacked fractions (`\frac{a}{b}`, `-\frac{a}{b}`, or `a/b`, `-a/b`) and raises them
 *   with `inline-block` denominator-anchored vertical alignment matching textbook typesetting.
 * - Renders standard exponents (`2`, `-2`, `n+1`, `x`) via native `<sup>`.
 */
function renderSuperscriptElement(
  rawExp: string,
  depth: number,
  key: string
): React.ReactNode {
  const trimmed = rawExp.trim();
  if (!trimmed) return null;

  if (trimmed === '°' || trimmed === 'º' || trimmed === '\\circ') {
    return <React.Fragment key={key}>°</React.Fragment>;
  }

  // Check for explicit LaTeX fraction inside exponent: `\frac{2}{5}`, `-\frac{2}{5}`, `+\frac{2}{5}`
  const signMatch = trimmed.match(/^([+-])\s*(\\frac[\s\S]*)$/);
  const candidateSign = signMatch ? signMatch[1] : '';
  const candidateFracBody = signMatch ? signMatch[2] : trimmed;
  const latexFrac = readLatexFrac(candidateFracBody, 0);
  if (latexFrac && latexFrac.nextIndex === candidateFracBody.length) {
    return (
      <sup key={key} className={FRACTION_SUP_CLASS}>
        {renderStackedFraction(
          latexFrac.num,
          latexFrac.den,
          depth + 1,
          `${key}-sf`,
          true,
          candidateSign
        )}
      </sup>
    );
  }

  // Check for slash fraction inside exponent: `2/5`, `-2/5`, `1/4`, `3/2`, `m/n`
  const simpleFrac = parseSimpleFractionExponent(trimmed);
  if (simpleFrac) {
    return (
      <sup key={key} className={FRACTION_SUP_CLASS}>
        {renderStackedFraction(
          simpleFrac.num,
          simpleFrac.den,
          depth + 1,
          `${key}-pf`,
          true,
          simpleFrac.sign
        )}
      </sup>
    );
  }

  const containsFrac = trimmed.includes('\\frac');
  return (
    <sup key={key} className={containsFrac ? FRACTION_SUP_CLASS : STANDARD_SUP_CLASS}>
      {parseMathExpression(trimmed, depth + 1, `${key}-in`, true)}
    </sup>
  );
}

/**
 * Recursive structural math parser:
 * Correctly handles nested `\frac` inside `^{...}` / `^(...)`, parenthesized exponents `(32)^(2/5)`,
 * braced exponents `(32)^{\frac{2}{5}}`, unbraced exponents `a^2b²`, subscripts `H_2O`, and Unicode runs.
 */
function parseMathExpression(
  str: string,
  depth: number,
  keyPrefix: string,
  compactFractions: boolean
): React.ReactNode[] {
  if (!str) return [];
  if (depth >= 5) {
    return renderUnicodeSuperSubLeaf(str, `${keyPrefix}-d`);
  }

  const nodes: React.ReactNode[] = [];
  let textBuffer = '';
  let i = 0;
  let tok = 0;

  const flushText = () => {
    if (!textBuffer) return;
    nodes.push(...renderUnicodeSuperSubLeaf(textBuffer, `${keyPrefix}-t${tok++}`));
    textBuffer = '';
  };

  /**
   * Glue the trailing base token (`9`, `(32)`, `x`, etc.) together with `supNode` inside a
   * non-breaking LTR span so the superscript always sits immediately on the upper-right side of its base.
   */
  const pushBaseWithSup = (supNode: React.ReactNode, trimSpacesBeforeCaret: boolean) => {
    if (!supNode) return;
    const cleanedBuf = trimSpacesBeforeCaret ? textBuffer.replace(/[ \t]+$/, '') : textBuffer;
    if (cleanedBuf) {
      const { prefix, base } = extractTrailingBaseToken(cleanedBuf);
      textBuffer = '';
      if (prefix) {
        nodes.push(...renderUnicodeSuperSubLeaf(prefix, `${keyPrefix}-p${tok++}`));
      }
      if (base) {
        nodes.push(
          <span
            key={`${keyPrefix}-bs${tok++}`}
            dir="ltr"
            className="inline whitespace-nowrap"
          >
            {renderUnicodeSuperSubLeaf(base, `${keyPrefix}-b${tok++}`)}
            {supNode}
          </span>
        );
        return;
      }
    } else {
      textBuffer = '';
    }
    nodes.push(supNode);
  };

  while (i < str.length) {
    const ch = str[i];

    // 0a. Underline tag: <u>...</u> (case-insensitive, pure React element, zero dangerouslySetInnerHTML)
    if (ch === '<' && /^<u>/i.test(str.slice(i, i + 3))) {
      const closeIdx = str.slice(i + 3).search(/<\/u>/i);
      if (closeIdx > 0) {
        const inner = str.slice(i + 3, i + 3 + closeIdx);
        flushText();
        nodes.push(
          <u
            key={`${keyPrefix}-u${tok++}`}
            className="underline decoration-2 underline-offset-4 decoration-current font-semibold"
          >
            {parseMathExpression(inner, depth + 1, `${keyPrefix}-ui${tok++}`, compactFractions)}
          </u>
        );
        i = i + 3 + closeIdx + 4;
        continue;
      }
    }

    // 0b. Double-underscore underline: __word__ (strictly 2 underscores; NEVER matches ___ fill-in-the-blank runs!)
    if (ch === '_' && str[i + 1] === '_' && str[i + 2] !== '_' && str[i - 1] !== '_') {
      const rest = str.slice(i + 2);
      const m = rest.match(/^([^_\n]{1,120})__(?!_)/);
      if (m && m[1].trim().length > 0) {
        flushText();
        nodes.push(
          <u
            key={`${keyPrefix}-du${tok++}`}
            className="underline decoration-2 underline-offset-4 decoration-current font-semibold"
          >
            {parseMathExpression(m[1], depth + 1, `${keyPrefix}-dui${tok++}`, compactFractions)}
          </u>
        );
        i += 2 + m[0].length;
        continue;
      }
    }

    // 1. \frac{num}{den}
    if (ch === '\\' && str.startsWith('\\frac', i)) {
      const frac = readLatexFrac(str, i);
      if (frac) {
        flushText();
        nodes.push(
          renderStackedFraction(
            frac.num,
            frac.den,
            depth,
            `${keyPrefix}-f${tok++}`,
            compactFractions
          )
        );
        i = frac.nextIndex;
        continue;
      }
    }

    // 2. Caret superscript `^` (must follow a valid math base char; strictly ignores Hindi "( ^ )")
    if (ch === '^' && i > 0) {
      const immediatePrev = str[i - 1];
      let prevIdx = i - 1;
      while (prevIdx >= 0 && (str[prevIdx] === ' ' || str[prevIdx] === '\t')) {
        prevIdx--;
      }
      const prevNonSpace = prevIdx >= 0 ? str[prevIdx] : '';
      const hasImmediateBase = Boolean(immediatePrev) && !/[\s([{-]/.test(immediatePrev);
      const hasSpacedBase = Boolean(prevNonSpace) && !/[\s([{-]/.test(prevNonSpace);

      let expPos = i + 1;
      while (expPos < str.length && (str[expPos] === ' ' || str[expPos] === '\t')) {
        expPos++;
      }
      const nextNonSpace = str[expPos];

      // Grouped exponents (`^{...}`, `^(...)`, `^\frac{...}{...}`) allow optional spaces around `^`
      if (hasSpacedBase && (hasImmediateBase || expPos >= i + 1)) {
        // 2a. Braced superscript `^{...}` (supports nested `\frac{2}{5}`!)
        if (nextNonSpace === '{') {
          const group = readBalancedGroup(str, expPos, '{', '}');
          if (group) {
            const supEl = renderSuperscriptElement(group.content, depth, `${keyPrefix}-sb${tok++}`);
            pushBaseWithSup(supEl, !hasImmediateBase);
            i = group.nextIndex;
            continue;
          }
        }

        // 2b. Parenthesized superscript `^(...)` — e.g. `(32)^(2/5)`, `9^(3/2)`, `(ab)^(-2)`
        if (nextNonSpace === '(') {
          const group = readBalancedGroup(str, expPos, '(', ')');
          if (group && group.content.trim().length > 0 && group.content.length <= 48) {
            const supEl = renderSuperscriptElement(group.content, depth, `${keyPrefix}-sp${tok++}`);
            pushBaseWithSup(supEl, !hasImmediateBase);
            i = group.nextIndex;
            continue;
          }
        }

        // 2c. Direct `\frac` after caret: `32^\frac{2}{5}`, `9^\frac{3}{2}`
        if (nextNonSpace === '\\' && str.startsWith('\\frac', expPos)) {
          const frac = readLatexFrac(str, expPos);
          if (frac) {
            const supEl = renderSuperscriptElement(
              `\\frac{${frac.num}}{${frac.den}}`,
              depth,
              `${keyPrefix}-sbf${tok++}`
            );
            pushBaseWithSup(supEl, !hasImmediateBase);
            i = frac.nextIndex;
            continue;
          }
        }
      }

      // Unbraced exponents require no space before `^` so prose/symbols stay untouched
      if (hasImmediateBase) {
        const nextChar = str[i + 1];

        // 2d. Caret degree `90^°` or `90^º`
        if (nextChar === '°' || nextChar === 'º') {
          flushText();
          nodes.push('°');
          i += 2;
          continue;
        }

        // 2e. Unbraced numeric exponent: `a^2b²`, `a^-2b⁻²`, `10^-5`, `x^2.5`
        const numMatch = str.slice(i + 1).match(/^(-?\d+(?:\.\d+)?)(?![0-9])/);
        if (numMatch) {
          const supEl = renderSuperscriptElement(numMatch[1], depth, `${keyPrefix}-sn${tok++}`);
          pushBaseWithSup(supEl, false);
          i += 1 + numMatch[1].length;
          continue;
        }

        // 2f. Unbraced single-letter exponent: `a^n`, `x^m`
        const varMatch = str.slice(i + 1).match(/^([a-zA-Z])(?![a-zA-Z0-9])/);
        if (varMatch) {
          const supEl = renderSuperscriptElement(varMatch[1], depth, `${keyPrefix}-sv${tok++}`);
          pushBaseWithSup(supEl, false);
          i += 1 + varMatch[1].length;
          continue;
        }
      }
    }

    // 3. Braced subscript `_{...}`
    if (ch === '_' && i > 0 && str[i + 1] === '{') {
      const prevChar = str[i - 1];
      if (prevChar && !/\s/.test(prevChar)) {
        const group = readBalancedGroup(str, i + 1, '{', '}');
        if (group) {
          flushText();
          nodes.push(
            <sub key={`${keyPrefix}-sub-${tok++}`} className={STANDARD_SUB_CLASS}>
              {parseMathExpression(group.content.trim(), depth + 1, `${keyPrefix}-subi${tok++}`, true)}
            </sub>
          );
          i = group.nextIndex;
          continue;
        }
      }
    }

    textBuffer += ch;
    i++;
  }

  flushText();
  return nodes;
}

/**
 * Parse a math/science string into a safe ReactNode array with stacked vertical fractions
 * (\frac{a}{b}), fractional superscripts ((32)^(2/5) / (32)^{\frac{2}{5}} / 9^{\frac{3}{2}}),
 * native HTML <sup> and <sub> tags, and clean Unicode math symbols.
 */
export function renderMathNodes(rawText: string): React.ReactNode[] {
  if (!rawText) return [];

  // Normalize LaTeX symbols & stray $ math wrappers, preserving \frac{num}{den}
  let prepared = normalizeLatexMathSymbols(rawText);

  // Convert safe chemical & math subscripts (H_2O, H_2SO_4, x_1, a_n) into _{...} form
  if (prepared.includes('_') && !/https?:\/\/|\/api\//i.test(prepared)) {
    prepared = prepared
      .replace(CHEM_SUBSCRIPT_REGEX, '$1_{$2}')
      .replace(SIMPLE_SUBSCRIPT_REGEX, '$1$2_{$3}');
  }

  return parseMathExpression(prepared, 0, 'm', false);
}

export const MathText: React.FC<MathTextProps> = ({ text, className }) => {
  if (!text) return null;
  const nodes = renderMathNodes(text);
  // Always wrap in a single inline <span> so flex/grid parents can never split text and <sup> nodes apart
  return <span className={className ? `inline ${className}` : 'inline'}>{nodes}</span>;
};
