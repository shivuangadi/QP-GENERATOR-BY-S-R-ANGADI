/**
 * Karnataka DSERT 5-Stage Blueprint Engine
 * Recreates the authentic 5-stage blueprint matrix with full interconnectivity and exact tallying across all 5 steps.
 * Step 5 features 4 Objectives (ಜ್ಞಾನ, ತಿಳುವಳಿಕೆ, ಅನ್ವಯ, ಕೌಶಲ), each with 3 Question Type sub-columns
 * matching Step 2: ವಸ್ತುನಿಷ್ಠ/ಕಿರು ಉತ್ತರ (short_objective), ದೀರ್ಘ ಉತ್ತರ (long), and ಪ್ರಬಂಧ ಮಾದರಿ (essay).
 * Author: M I Nilaji / S R Angadi
 */

import {
  Chapter,
  QuestionBank,
  QuestionItem,
  SectionBlueprint,
  GeneratedPaper,
  STANDARD_QUESTION_FORMATS,
} from '../types/questionBank.ts';

export interface ObjectiveWeightage {
  id: string;
  name: string;
  percentage: number;
  marks: number;
  questionsCount: number;
}

export type Step2CategoryId = 'short_objective' | 'long' | 'essay';

export interface QuestionTypeWeightage {
  id: Step2CategoryId | string;
  name: string;
  subtitle?: string;
  percentage: number;
  marks: number;
  questionsCount: number;
  marksPerQuestion: number;
}

export interface DifficultyWeightage {
  id: string;
  name: string;
  marks: number;
  percentage: number;
  questionsCount?: number;
}

export interface ChapterWeightage {
  chapterId: string;
  chapterNumber: number;
  chapterName: string;
  questionsCount: number;
  marks: number;
  percentage: number;
}

export interface ObjectiveDiffCell {
  questionsCount: number;
  marksPerQuestion: number;
  totalMarks: number;
  questionIds?: string[];
}

export interface MasterGridRow {
  chapterId: string;
  chapterNumber?: number;
  chapterName: string;
  // ಜ್ಞಾನ (Knowledge): ವಸ್ತುನಿಷ್ಠ/ಕಿರು, ದೀರ್ಘ, ಪ್ರಬಂಧ
  knowledgeShort: ObjectiveDiffCell | null;
  knowledgeLong: ObjectiveDiffCell | null;
  knowledgeEssay: ObjectiveDiffCell | null;
  // ತಿಳುವಳಿಕೆ (Understanding): ವಸ್ತುನಿಷ್ಠ/ಕಿರು, ದೀರ್ಘ, ಪ್ರಬಂಧ
  understandingShort: ObjectiveDiffCell | null;
  understandingLong: ObjectiveDiffCell | null;
  understandingEssay: ObjectiveDiffCell | null;
  // ಅನ್ವಯ (Application): ವಸ್ತುನಿಷ್ಠ/ಕಿರು, ದೀರ್ಘ, ಪ್ರಬಂಧ
  applicationShort: ObjectiveDiffCell | null;
  applicationLong: ObjectiveDiffCell | null;
  applicationEssay: ObjectiveDiffCell | null;
  // ಕೌಶಲ (Skill): ವಸ್ತುನಿಷ್ಠ/ಕಿರು, ದೀರ್ಘ, ಪ್ರಬಂಧ
  skillShort: ObjectiveDiffCell | null;
  skillLong: ObjectiveDiffCell | null;
  skillEssay: ObjectiveDiffCell | null;
  // Totals for this chapter
  totalMarks: number;
  totalQuestions: number;
}

export interface CompleteBlueprint {
  title: string;
  grade: string;
  subject: string;
  totalMarks: number;
  totalQuestions: number;
  step1Objectives: ObjectiveWeightage[];
  step2QuestionTypes: QuestionTypeWeightage[];
  step3Difficulty: DifficultyWeightage[];
  step4Chapters: ChapterWeightage[];
  step5MasterGrid: MasterGridRow[];
}

/**
 * Detects whether a subject is a Language subject (Kannada, English, Hindi, Sanskrit, Urdu, etc.)
 * vs a Core subject (Mathematics, Science, Social Science, etc.).
 */
export function isLanguageSubject(subject?: string | null, subjectCode?: string | null): boolean {
  const combined = `${subject || ''} ${subjectCode || ''}`.toLowerCase();
  return /(kannada|english|hindi|sanskrit|urdu|marathi|tamil|telugu|language|ಕನ್ನಡ|ಇಂಗ್ಲಿಷ್|ಇಂಗ್ಲೀಷ್|ಹಿಂದಿ|ಸಂಸ್ಕೃತ|ಉರ್ದು|ಮರಾಠಿ|ತಮಿಳು|ತೆಲುಗು|ಭಾಷೆ|ಪ್ರಥಮ|ದ್ವಿತೀಯ|ತೃತೀಯ|\bfl\b|\bsl\b|\btl\b|\bkan\b|\beng\b|\bhin\b|\bsan\b|\burd\b)/i.test(
    combined
  );
}

/**
 * Default Step 2 percentages (editable in Blueprint View):
 * 1. ವಸ್ತುನಿಷ್ಠ / ಕಿರು ಉತ್ತರ (1 ಅಂಕದ ಪ್ರಶ್ನೆಗಳು) - 30%
 * 2. ದೀರ್ಘ ಉತ್ತರ (2 ಮತ್ತು 3 ಅಂಕದ ಪ್ರಶ್ನೆಗಳು) - 50%
 * 3. ಪ್ರಬಂಧ ಮಾದರಿ ಉತ್ತರ (4 ಅಂಕದ ಪ್ರಶ್ನೆಗಳು) - 20%
 */
export const DEFAULT_STEP2_PERCENTAGES: Record<Step2CategoryId, number> = {
  short_objective: 30,
  long: 50,
  essay: 20,
};

/**
 * Largest-remainder integer apportionment so distributed whole integers ALWAYS sum strictly to `total`.
 */
export function apportionExactIntegers(
  weights: number[],
  total: number,
  minPerNonZero = 0
): number[] {
  const n = weights.length;
  if (n === 0) return [];
  const safeTotal = Math.max(0, Math.round(total));
  if (safeTotal === 0) return weights.map(() => 0);

  const positiveWeights = weights.map(w => Math.max(0, Number(w) || 0));
  const sumWeights = positiveWeights.reduce((s, w) => s + w, 0);
  const effectiveWeights = sumWeights > 0 ? positiveWeights : weights.map(() => 1);
  const effSum = effectiveWeights.reduce((s, w) => s + w, 0);

  const exact = effectiveWeights.map(w => (w / effSum) * safeTotal);
  const floored = exact.map((val, idx) => {
    const base = Math.floor(val);
    return positiveWeights[idx] > 0 ? Math.max(minPerNonZero, base) : 0;
  });

  let currentSum = floored.reduce((s, v) => s + v, 0);

  if (currentSum < safeTotal) {
    const remainders = exact
      .map((val, idx) => ({ idx, rem: val - Math.floor(val), weight: effectiveWeights[idx] }))
      .sort((a, b) => b.rem - a.rem || b.weight - a.weight);
    let r = 0;
    while (currentSum < safeTotal && remainders.length > 0) {
      const target = remainders[r % remainders.length];
      if (target.weight > 0 || sumWeights === 0) {
        floored[target.idx] += 1;
        currentSum += 1;
      }
      r += 1;
      if (r > safeTotal + n * 2) break;
    }
  } else if (currentSum > safeTotal) {
    // Trim excess from items with largest floor above minPerNonZero
    const order = floored
      .map((v, idx) => ({ idx, v }))
      .sort((a, b) => b.v - a.v);
    let guard = 0;
    while (currentSum > safeTotal && guard < safeTotal + n * 2) {
      let reduced = false;
      for (const entry of order) {
        if (currentSum <= safeTotal) break;
        if (floored[entry.idx] > minPerNonZero) {
          floored[entry.idx] -= 1;
          currentSum -= 1;
          reduced = true;
        }
      }
      if (!reduced) {
        for (const entry of order) {
          if (currentSum <= safeTotal) break;
          if (floored[entry.idx] > 0) {
            floored[entry.idx] -= 1;
            currentSum -= 1;
          }
        }
      }
      guard += 1;
    }
  }

  return floored;
}

/**
 * Apportions whole-number question counts summing strictly to `totalQ`,
 * respecting `0 <= q[i] <= marksArr[i]` and `marksArr[i] === 0 => q[i] === 0`
 * (and `q[i] >= 1` for every positive-mark row whenever `totalQ` permits).
 */
export function apportionBoundedQuestions(
  marksArr: number[],
  totalQ: number,
  prefWeights?: number[]
): number[] {
  const n = marksArr.length;
  if (n === 0) return [];

  const maxQ = marksArr.map(m => Math.max(0, Math.round(Number(m) || 0)));
  const totalM = maxQ.reduce((s, m) => s + m, 0);
  const safeTotalQ = Math.max(0, Math.min(totalM, Math.round(totalQ)));
  if (safeTotalQ === 0) return maxQ.map(() => 0);

  const minQ: number[] = maxQ.map(m => (m > 0 ? 1 : 0));
  let sumMin = minQ.reduce((s, v) => s + v, 0);
  if (sumMin > safeTotalQ) {
    // Drop minimum from smallest-mark rows first so sumMin === safeTotalQ
    const bySmallest = maxQ
      .map((m, idx) => ({ idx, m }))
      .filter(e => e.m > 0)
      .sort((a, b) => a.m - b.m || b.idx - a.idx);
    for (const entry of bySmallest) {
      if (sumMin <= safeTotalQ) break;
      minQ[entry.idx] = 0;
      sumMin -= 1;
    }
  }

  const q = [...minQ];
  let remaining = safeTotalQ - sumMin;
  const weights = maxQ.map((m, idx) => {
    if (m <= 0) return 0;
    const pref = prefWeights && typeof prefWeights[idx] === 'number' ? prefWeights[idx] : m;
    return Math.max(0.0001, pref);
  });

  let guard = 0;
  while (remaining > 0 && guard < n + 5) {
    guard += 1;
    const caps = maxQ.map((m, idx) => Math.max(0, m - q[idx]));
    const activeWeights = caps.map((cap, idx) => (cap > 0 ? weights[idx] : 0));
    const activeCapSum = caps.reduce((s, c) => s + c, 0);
    if (activeCapSum <= 0) break;

    const alloc = apportionExactIntegers(activeWeights, Math.min(remaining, activeCapSum), 0);
    let addedThisPass = 0;
    for (let i = 0; i < n; i++) {
      const add = Math.min(caps[i], alloc[i]);
      q[i] += add;
      addedThisPass += add;
    }
    remaining -= addedThisPass;
    if (addedThisPass === 0) {
      for (let i = 0; i < n && remaining > 0; i++) {
        if (q[i] < maxQ[i]) {
          q[i] += 1;
          remaining -= 1;
        }
      }
      break;
    }
  }

  return q;
}

/**
 * Solves an exact non-negative integer contingency table (R x C) with strict rowSums and colSums
 * using Iterative Proportional Fitting + largest-remainder closure.
 */
export function solveIntegerContingencyTable(
  rowSums: number[],
  colSums: number[],
  priorWeights?: number[][]
): number[][] {
  const R = rowSums.length;
  const C = colSums.length;
  const grid = Array.from({ length: R }, () => Array(C).fill(0));
  if (R === 0 || C === 0) return grid;

  const rSum = rowSums.map(v => Math.max(0, Math.round(v)));
  const cSum = colSums.map(v => Math.max(0, Math.round(v)));
  const total = rSum.reduce((s, v) => s + v, 0);
  if (total === 0) return grid;

  // Build smooth float targets via IPF
  const target: number[][] = Array.from({ length: R }, (_, r) =>
    Array.from({ length: C }, (_, c) => {
      if (rSum[r] === 0 || cSum[c] === 0) return 0;
      const p = priorWeights?.[r]?.[c];
      return typeof p === 'number' && p > 0 ? p + 0.02 : (rSum[r] * cSum[c]) / total;
    })
  );

  for (let iter = 0; iter < 10; iter++) {
    for (let r = 0; r < R; r++) {
      const s = target[r].reduce((a, b) => a + b, 0);
      if (s > 0) {
        const factor = rSum[r] / s;
        for (let c = 0; c < C; c++) target[r][c] *= factor;
      }
    }
    for (let c = 0; c < C; c++) {
      let s = 0;
      for (let r = 0; r < R; r++) s += target[r][c];
      if (s > 0) {
        const factor = cSum[c] / s;
        for (let r = 0; r < R; r++) target[r][c] *= factor;
      }
    }
  }

  const remR = [...rSum];
  const remC = [...cSum];

  for (let r = 0; r < R; r++) {
    for (let c = 0; c < C; c++) {
      const base = Math.min(Math.floor(target[r][c]), remR[r], remC[c]);
      if (base > 0) {
        grid[r][c] = base;
        remR[r] -= base;
        remC[c] -= base;
      }
    }
  }

  let left = remR.reduce((s, v) => s + v, 0);
  let guard = 0;
  while (left > 0 && guard < total + R * C + 20) {
    guard += 1;
    let bestR = -1;
    let bestC = -1;
    let bestScore = -Infinity;

    for (let r = 0; r < R; r++) {
      if (remR[r] <= 0) continue;
      for (let c = 0; c < C; c++) {
        if (remC[c] <= 0) continue;
        const score = target[r][c] - grid[r][c];
        if (score > bestScore) {
          bestScore = score;
          bestR = r;
          bestC = c;
        }
      }
    }

    if (bestR === -1 || bestC === -1) break;
    grid[bestR][bestC] += 1;
    remR[bestR] -= 1;
    remC[bestC] -= 1;
    left -= 1;
  }

  return grid;
}

/**
 * Solves paired (Questions, Marks) integer matrices (R x C) such that:
 * - Q has exact rowSums = rowQ and colSums = colQ
 * - M has exact rowSums = rowM and colSums = colM
 * - Every cell satisfies M[r][c] >= Q[r][c] and (Q[r][c] === 0 => M[r][c] === 0)
 */
export function solvePairedQMMatrix(
  rowQ: number[],
  colQ: number[],
  rowM: number[],
  colM: number[],
  priorQ?: number[][],
  priorM?: number[][]
): { Q: number[][]; M: number[][] } {
  const R = rowQ.length;
  const C = colQ.length;
  const Q = solveIntegerContingencyTable(rowQ, colQ, priorQ);

  const rowExtra = rowM.map((m, r) => Math.max(0, Math.round(m) - Math.round(rowQ[r])));
  const colExtra = colM.map((m, c) => Math.max(0, Math.round(m) - Math.round(colQ[c])));
  const totalExtra = rowExtra.reduce((s, v) => s + v, 0);

  const buildZeroExtra = () => Array.from({ length: R }, () => Array(C).fill(0));
  if (totalExtra === 0 || R === 0 || C === 0) {
    return {
      Q,
      M: Q.map(row => [...row]),
    };
  }

  // Max-flow solver routing extra marks strictly through active cells (Q[r][c] > 0)
  const routeExtraMarks = (qMat: number[][]) => {
    const flow = buildZeroExtra();
    const remR = [...rowExtra];
    const remC = [...colExtra];

    // 1. Seed proportionally along active cells for natural distribution
    const activeTargets: Array<{ r: number; c: number; weight: number }> = [];
    for (let r = 0; r < R; r++) {
      for (let c = 0; c < C; c++) {
        if (qMat[r][c] > 0 && remR[r] > 0 && remC[c] > 0) {
          const pM = priorM?.[r]?.[c];
          const pQ = priorQ?.[r]?.[c];
          const pExtra =
            typeof pM === 'number' && typeof pQ === 'number' ? Math.max(0, pM - pQ) : 0;
          activeTargets.push({ r, c, weight: pExtra > 0 ? pExtra : qMat[r][c] });
        }
      }
    }

    // Greedy proportional fill by row
    for (let r = 0; r < R; r++) {
      if (remR[r] <= 0) continue;
      const rowCols = activeTargets.filter(t => t.r === r && remC[t.c] > 0);
      if (rowCols.length === 0) continue;
      const wArr = rowCols.map(t => t.weight);
      const alloc = apportionExactIntegers(wArr, remR[r], 0);
      rowCols.forEach((t, idx) => {
        const push = Math.min(alloc[idx], remR[r], remC[t.c]);
        if (push > 0) {
          flow[r][t.c] += push;
          remR[r] -= push;
          remC[t.c] -= push;
        }
      });
    }

    // 2. Edmonds-Karp BFS augmenting paths on residual bipartite graph
    const runAugment = () => {
      let pushedAny = true;
      let iterGuard = 0;
      while (pushedAny && iterGuard < totalExtra + 20) {
        iterGuard += 1;
        pushedAny = false;

        // Nodes: 0..R-1 are rows, R..R+C-1 are cols
        const parent = Array(R + C).fill(-1);
        const visited = Array(R + C).fill(false);
        const queue: number[] = [];

        for (let r = 0; r < R; r++) {
          if (remR[r] > 0) {
            visited[r] = true;
            queue.push(r);
          }
        }

        let sinkCol = -1;
        let head = 0;
        while (head < queue.length && sinkCol === -1) {
          const u = queue[head++];
          if (u < R) {
            // Row u -> Col c via active edge Q[u][c] > 0
            for (let c = 0; c < C; c++) {
              const v = R + c;
              if (!visited[v] && qMat[u][c] > 0) {
                visited[v] = true;
                parent[v] = u;
                if (remC[c] > 0) {
                  sinkCol = c;
                  break;
                }
                queue.push(v);
              }
            }
          } else {
            // Col c -> Row r via backward edge flow[r][c] > 0
            const c = u - R;
            for (let r = 0; r < R; r++) {
              if (!visited[r] && flow[r][c] > 0) {
                visited[r] = true;
                parent[r] = u;
                queue.push(r);
              }
            }
          }
        }

        if (sinkCol !== -1) {
          // Find bottleneck along path
          let bottle = remC[sinkCol];
          let cur = R + sinkCol;
          while (parent[cur] !== -1) {
            const p = parent[cur];
            if (cur < R) {
              // p is col, cur is row -> backward edge flow[cur][p - R]
              bottle = Math.min(bottle, flow[cur][p - R]);
            }
            cur = p;
          }
          bottle = Math.min(bottle, remR[cur]);

          if (bottle > 0) {
            remC[sinkCol] -= bottle;
            remR[cur] -= bottle;
            let node = R + sinkCol;
            while (parent[node] !== -1) {
              const p = parent[node];
              if (node >= R) {
                flow[p][node - R] += bottle;
              } else {
                flow[node][p - R] -= bottle;
              }
              node = p;
            }
            pushedAny = true;
          }
        } else {
          return { flow, remR, remC, visited };
        }
      }

      // Compute final reachability for cut inspection if residual remains
      const visited = Array(R + C).fill(false);
      const queue: number[] = [];
      for (let r = 0; r < R; r++) {
        if (remR[r] > 0) {
          visited[r] = true;
          queue.push(r);
        }
      }
      let head = 0;
      while (head < queue.length) {
        const u = queue[head++];
        if (u < R) {
          for (let c = 0; c < C; c++) {
            if (!visited[R + c] && qMat[u][c] > 0) {
              visited[R + c] = true;
              queue.push(R + c);
            }
          }
        } else {
          const c = u - R;
          for (let r = 0; r < R; r++) {
            if (!visited[r] && flow[r][c] > 0) {
              visited[r] = true;
              queue.push(r);
            }
          }
        }
      }
      return { flow, remR, remC, visited };
    };

    return runAugment();
  };

  let res = routeExtraMarks(Q);
  let swapGuard = 0;
  while (res.remR.some(v => v > 0) && res.remC.some(v => v > 0) && swapGuard < 60) {
    swapGuard += 1;
    // Perform a margin-preserving 2x2 Q swap connecting an unsatisfied row r to an unsatisfied col c
    const rUnsat = res.remR.findIndex(v => v > 0);
    const cUnsat = res.remC.findIndex(v => v > 0);
    if (rUnsat === -1 || cUnsat === -1) break;

    let c1 = -1;
    for (let c = 0; c < C; c++) {
      if (Q[rUnsat][c] > 0 && c !== cUnsat) {
        c1 = c;
        if (res.visited[R + c]) break;
      }
    }
    let r1 = -1;
    for (let r = 0; r < R; r++) {
      if (Q[r][cUnsat] > 0 && r !== rUnsat) {
        r1 = r;
        if (!res.visited[r]) break;
      }
    }

    if (c1 === -1 || r1 === -1) break;
    Q[rUnsat][c1] -= 1;
    Q[r1][cUnsat] -= 1;
    Q[rUnsat][cUnsat] += 1;
    Q[r1][c1] += 1;

    res = routeExtraMarks(Q);
  }

  const M = Array.from({ length: R }, (_, r) =>
    Array.from({ length: C }, (_, c) => Q[r][c] + res.flow[r][c])
  );

  return { Q, M };
}

const MASTER_CELL_KEYS: Array<keyof MasterGridRow> = [
  'knowledgeShort',
  'knowledgeLong',
  'knowledgeEssay',
  'understandingShort',
  'understandingLong',
  'understandingEssay',
  'applicationShort',
  'applicationLong',
  'applicationEssay',
  'skillShort',
  'skillLong',
  'skillEssay',
];

/**
 * Builds a 100% mathematically synchronized Step 5 Master 12-Column Grid whose:
 * - Every chapter row sums strictly to Step 4 (Chapters) [both Q and M]
 * - Every 3-column objective group sums strictly to Step 1 (Objectives) [both Q and M]
 * - Every 4-column question-type group (ವಸ್ತುನಿಷ್ಠ/ಕಿರು, ದೀರ್ಘ, ಪ್ರಬಂಧ) sums strictly to Step 2 [both Q and M]
 * - Grand total sums strictly to Step 2 & Document Header [both Q and M]
 */
export function buildSynchronizedMasterGrid(
  step1Objectives: ObjectiveWeightage[],
  step2QuestionTypes: QuestionTypeWeightage[],
  step4Chapters: ChapterWeightage[],
  existingGrid?: MasterGridRow[]
): MasterGridRow[] {
  const C = step4Chapters.length;
  if (C === 0) return [];

  const cleanChKey = (s: string) =>
    (s || '')
      .replace(/^[0-9೦-೯\.\s\-–_:]+/, '')
      .replace(/\s+/g, '')
      .toLowerCase();

  const findExistingRow = (ch: ChapterWeightage): MasterGridRow | undefined => {
    if (!existingGrid || existingGrid.length === 0) return undefined;
    return existingGrid.find(r => {
      if (r.chapterId === ch.chapterId) return true;
      const k1 = cleanChKey(r.chapterName);
      const k2 = cleanChKey(ch.chapterName);
      return Boolean(k1 && k2 && (k1 === k2 || k1.includes(k2) || k2.includes(k1)));
    });
  };

  // Ordered objective targets: know, und, app, skill
  const objOrder = ['know', 'und', 'app', 'skill'];
  const objItems = objOrder.map(
    (id, idx) => step1Objectives.find(o => o.id === id) || step1Objectives[idx] || { marks: 0, questionsCount: 0 }
  );

  // Ordered Step 2 question-type targets: short_objective, long, essay
  const qTypeOrder: Step2CategoryId[] = ['short_objective', 'long', 'essay'];
  const qTypeItems = qTypeOrder.map(
    (id, idx) => step2QuestionTypes.find(t => t.id === id) || step2QuestionTypes[idx] || { marks: 0, questionsCount: 0 }
  );

  // Fast path: if existingGrid already tallies 100% with Step 1, Step 2, and Step 4, keep it untouched
  if (existingGrid && existingGrid.length === C) {
    const matchedRows = step4Chapters.map(ch => findExistingRow(ch));
    if (matchedRows.every(Boolean)) {
      const rows = matchedRows as MasterGridRow[];
      const oQ = [0, 0, 0, 0];
      const oM = [0, 0, 0, 0];
      const dQ = [0, 0, 0];
      const dM = [0, 0, 0];
      let rowsMatch = true;

      rows.forEach((row, rIdx) => {
        let rQ = 0;
        let rM = 0;
        MASTER_CELL_KEYS.forEach((key, kIdx) => {
          const cell = row[key] as ObjectiveDiffCell | null;
          if (cell && cell.questionsCount > 0) {
            rQ += cell.questionsCount;
            rM += cell.totalMarks;
            const oIdx = Math.floor(kIdx / 3);
            const dIdx = kIdx % 3;
            oQ[oIdx] += cell.questionsCount;
            oM[oIdx] += cell.totalMarks;
            dQ[dIdx] += cell.questionsCount;
            dM[dIdx] += cell.totalMarks;
          }
        });
        if (rQ !== step4Chapters[rIdx].questionsCount || rM !== step4Chapters[rIdx].marks) {
          rowsMatch = false;
        }
      });

      const objMatch = objItems.every(
        (o, idx) => oQ[idx] === (o.questionsCount || 0) && oM[idx] === (o.marks || 0)
      );
      const qTypeMatch = qTypeItems.every(
        (t, idx) => dQ[idx] === (t.questionsCount || 0) && dM[idx] === (t.marks || 0)
      );

      if (rowsMatch && objMatch && qTypeMatch) {
        return rows.map((row, idx) => ({
          ...row,
          chapterId: step4Chapters[idx].chapterId,
          chapterNumber: step4Chapters[idx].chapterNumber,
          chapterName: step4Chapters[idx].chapterName,
          totalQuestions: step4Chapters[idx].questionsCount,
          totalMarks: step4Chapters[idx].marks,
        }));
      }
    }
  }

  // Extract priors from existingGrid for Stage 5A (4x3) and Stage 5B (Cx12)
  const prior4x3Q = Array.from({ length: 4 }, () => Array(3).fill(0));
  const prior4x3M = Array.from({ length: 4 }, () => Array(3).fill(0));
  const priorCx12Q = Array.from({ length: C }, () => Array(12).fill(0));
  const priorCx12M = Array.from({ length: C }, () => Array(12).fill(0));
  const existingRows = step4Chapters.map(ch => findExistingRow(ch));

  existingRows.forEach((row, rIdx) => {
    if (!row) return;
    MASTER_CELL_KEYS.forEach((key, kIdx) => {
      const cell = row[key] as ObjectiveDiffCell | null;
      if (cell && cell.questionsCount > 0) {
        const oIdx = Math.floor(kIdx / 3);
        const dIdx = kIdx % 3;
        prior4x3Q[oIdx][dIdx] += cell.questionsCount;
        prior4x3M[oIdx][dIdx] += cell.totalMarks;
        priorCx12Q[rIdx][kIdx] = cell.questionsCount;
        priorCx12M[rIdx][kIdx] = cell.totalMarks;
      }
    });
  });

  // Harmonize marginal totals (using Step 4 as chapter sum reference, Step 1 for obj, Step 3 for diff)
  const targetM = step4Chapters.reduce((s, c) => s + Math.max(0, Math.round(c.marks)), 0);
  const targetQ = Math.min(
    targetM,
    step4Chapters.reduce((s, c) => s + Math.max(0, Math.round(c.questionsCount)), 0)
  );

  // Ensure row/col marginals strictly sum to (targetM, targetQ) and obey m >= q
  const harmonizeMarginals = (items: Array<{ marks: number; questionsCount?: number }>) => {
    const rawM = items.map(i => Math.max(0, Math.round(i.marks || 0)));
    const rawQ = items.map(i => Math.max(0, Math.round(i.questionsCount || 0)));
    const mArr =
      rawM.reduce((s, v) => s + v, 0) === targetM
        ? rawM
        : apportionExactIntegers(rawM, targetM, 0);
    const validRawQ =
      rawQ.reduce((s, v) => s + v, 0) === targetQ &&
      rawQ.every((q, idx) => q <= mArr[idx] && (mArr[idx] === 0 ? q === 0 : true));
    const qArr = validRawQ ? rawQ : apportionBoundedQuestions(mArr, targetQ, rawQ);
    return { mArr, qArr };
  };

  const { mArr: oM, qArr: oQ } = harmonizeMarginals(objItems);
  const { mArr: dM, qArr: dQ } = harmonizeMarginals(qTypeItems);
  const { mArr: chM, qArr: chQ } = harmonizeMarginals(step4Chapters);

  // Stage 5A: Exact 4 x 3 (Objectives x Difficulties) column totals
  const { Q: colQ4x3, M: colM4x3 } = solvePairedQMMatrix(
    oQ,
    dQ,
    oM,
    dM,
    prior4x3Q,
    prior4x3M
  );

  const flatColQ: number[] = [];
  const flatColM: number[] = [];
  for (let o = 0; o < 4; o++) {
    for (let d = 0; d < 3; d++) {
      flatColQ.push(colQ4x3[o][d]);
      flatColM.push(colM4x3[o][d]);
    }
  }

  // Stage 5B: Exact C x 12 (Chapters x 12 Objective-Difficulty columns)
  const { Q: cellQ, M: cellM } = solvePairedQMMatrix(
    chQ,
    flatColQ,
    chM,
    flatColM,
    priorCx12Q,
    priorCx12M
  );

  // Assemble MasterGridRow[]
  return step4Chapters.map((ch, rIdx) => {
    const existing = existingRows[rIdx];
    const rowObj: any = {
      chapterId: ch.chapterId,
      chapterNumber: ch.chapterNumber,
      chapterName: ch.chapterName,
      totalQuestions: chQ[rIdx],
      totalMarks: chM[rIdx],
    };

    MASTER_CELL_KEYS.forEach((key, kIdx) => {
      const qVal = cellQ[rIdx][kIdx];
      const mVal = cellM[rIdx][kIdx];
      const existingCell = existing ? (existing[key] as ObjectiveDiffCell | null) : null;
      if (qVal <= 0) {
        rowObj[key] = null;
      } else {
        rowObj[key] = {
          questionsCount: qVal,
          totalMarks: mVal,
          marksPerQuestion: Math.max(1, Math.round(mVal / qVal)),
          questionIds: existingCell?.questionIds ? [...existingCell.questionIds] : [],
        } as ObjectiveDiffCell;
      }
    });

    return rowObj as MasterGridRow;
  });
}

/**
 * Classifies any question into one of the 3 permanent Blueprint Step 2 & Step 5 categories
 * strictly based on marks:
 * 1. short_objective -> ವಸ್ತುನಿಷ್ಠ / ಕಿರು ಉತ್ತರ (1 ಅಂಕದ ಪ್ರಶ್ನೆಗಳು)
 * 2. long            -> ದೀರ್ಘ ಉತ್ತರ (2 ಮತ್ತು 3 ಅಂಕದ ಪ್ರಶ್ನೆಗಳು)
 * 3. essay           -> ಪ್ರಬಂಧ ಮಾದರಿ ಉತ್ತರ (4 ಮತ್ತು ಅದಕ್ಕಿಂತ ಹೆಚ್ಚಿನ ಅಂಕದ ಪ್ರಶ್ನೆಗಳು)
 */
export function classifyQuestionToStep2Category(q: {
  formatCategoryId?: string;
  questionType?: string;
  marks?: number;
  options?: unknown[];
  items?: unknown[];
}): Step2CategoryId {
  const rawMarks = Number(q.marks);
  const marks = Number.isFinite(rawMarks) && rawMarks > 0 ? rawMarks : 1;

  // Strictly mark-authoritative classification so 2M/3M ALWAYS go to ದೀರ್ಘ and 4M+ ALWAYS go to ಪ್ರಬಂಧ
  if (marks >= 4) return 'essay';
  if (marks >= 2) return 'long';
  return 'short_objective';
}

/**
 * Returns the 3 permanent Step 2 category definitions with default 30% / 50% / 20% weights.
 */
export function getPermanentStep2Categories(): Array<{
  id: Step2CategoryId;
  name: string;
  subtitle: string;
  defaultPercentage: number;
  defaultMarksPerQuestion: number;
}> {
  return [
    {
      id: 'short_objective',
      name: 'ವಸ್ತುನಿಷ್ಠ / ಕಿರು ಉತ್ತರ',
      subtitle: '1 ಅಂಕದ ಪ್ರಶ್ನೆಗಳು (MCQ, ಒಂದು ಪದ/ವಾಕ್ಯ, ಬಿಟ್ಟ ಸ್ಥಳ, ಸರಿ-ತಪ್ಪು)',
      defaultPercentage: 30,
      defaultMarksPerQuestion: 1,
    },
    {
      id: 'long',
      name: 'ದೀರ್ಘ ಉತ್ತರ',
      subtitle: '2 ಮತ್ತು 3 ಅಂಕದ ಪ್ರಶ್ನೆಗಳು',
      defaultPercentage: 50,
      defaultMarksPerQuestion: 2,
    },
    {
      id: 'essay',
      name: 'ಪ್ರಬಂಧ ಮಾದರಿ ಉತ್ತರ',
      subtitle: '4 ಅಂಕದ ಪ್ರಶ್ನೆಗಳು (ಪ್ರಬಂಧ, ವಿವರಣೆ, ಹೊಂದಿಸಿ ಬರೆಯಿರಿ)',
      defaultPercentage: 20,
      defaultMarksPerQuestion: 4,
    },
  ];
}

/**
 * Computes a mathematically valid whole-number question count for a given Step 2 category and mark budget.
 */
export function computeStep2QuestionCountForMarks(
  id: Step2CategoryId,
  marks: number,
  preferredCount?: number
): number {
  const safeMarks = Math.max(0, Math.round(marks));
  if (safeMarks <= 0) return 0;

  if (id === 'short_objective') {
    return safeMarks; // 1 mark per question
  }

  if (id === 'long') {
    // 2-mark and 3-mark questions: feasible question count is within [ceil(marks/3), floor(marks/2)]
    if (safeMarks === 1) return 1;
    const minQ = Math.max(1, Math.ceil(safeMarks / 3));
    const maxQ = Math.max(minQ, Math.floor(safeMarks / 2));
    if (typeof preferredCount === 'number' && Number.isFinite(preferredCount)) {
      return Math.max(minQ, Math.min(maxQ, Math.round(preferredCount)));
    }
    const ideal = Math.round(safeMarks / 2.5);
    return Math.max(minQ, Math.min(maxQ, ideal));
  }

  // essay: 4 marks per question
  return Math.max(1, Math.round(safeMarks / 4));
}

/**
 * Builds the 3 permanent Step 2 rows from a target mark total and percentages (default 30% / 50% / 20%).
 * Automatically calculates exact marks and mathematically consistent question counts.
 */
export function buildStep2FromPercentages(
  totalMarks: number,
  percentages: Partial<Record<Step2CategoryId, number>> = DEFAULT_STEP2_PERCENTAGES,
  preferredTotalQuestions?: number
): QuestionTypeWeightage[] {
  const cats = getPermanentStep2Categories();
  const pcts = cats.map(c =>
    typeof percentages[c.id] === 'number' ? Math.max(0, percentages[c.id]!) : c.defaultPercentage
  );
  const pctSum = pcts.reduce((s, p) => s + p, 0);

  // If percentages sum to 100%, apportion exact integer marks summing strictly to totalMarks;
  // otherwise compute directly from each percentage against totalMarks.
  const allocatedMarks =
    Math.abs(pctSum - 100) < 0.01
      ? apportionExactIntegers(pcts, totalMarks, 0)
      : pcts.map(p => Math.round((totalMarks * p) / 100));

  const qShort = computeStep2QuestionCountForMarks('short_objective', allocatedMarks[0]);
  const qEssay = computeStep2QuestionCountForMarks('essay', allocatedMarks[2]);
  const preferredLong =
    typeof preferredTotalQuestions === 'number' && preferredTotalQuestions > 0
      ? preferredTotalQuestions - qShort - qEssay
      : undefined;
  const qLong = computeStep2QuestionCountForMarks('long', allocatedMarks[1], preferredLong);

  const qCounts = [qShort, qLong, qEssay];

  return cats.map((cat, idx) => {
    const m = allocatedMarks[idx];
    const q = qCounts[idx];
    return {
      id: cat.id,
      name: cat.name,
      subtitle: cat.subtitle,
      percentage: pcts[idx],
      marks: m,
      questionsCount: q,
      marksPerQuestion: q > 0 ? Math.max(1, Math.round(m / q)) : cat.defaultMarksPerQuestion,
    };
  });
}

/**
 * Builds the 3 permanent Step 2 rows strictly honoring an exact (totalMarks, targetQuestions) target.
 * - When targetQuestions >= totalMarks (e.g. 10 marks, 10 questions), allocates 100% to 1-mark
 *   ವಸ್ತುನಿಷ್ಠ / ಕಿರು ಉತ್ತರ (short_objective) so all 10 questions are 1 mark each!
 * - Otherwise uses default percentages if they hit targetQuestions, or falls back to the exact integer solver.
 */
export function buildStep2ForTarget(
  totalMarks: number,
  targetQuestions: number,
  percentages: Partial<Record<Step2CategoryId, number>> = DEFAULT_STEP2_PERCENTAGES
): QuestionTypeWeightage[] {
  const safeMarks = Math.max(1, Math.round(totalMarks));
  const safeQ = Math.max(1, Math.min(safeMarks, Math.round(targetQuestions)));
  const cats = getPermanentStep2Categories();

  // Exact 1-mark-per-question case (e.g. 10 marks, 10 questions)
  if (safeQ >= safeMarks) {
    return [
      {
        id: 'short_objective',
        name: cats[0].name,
        subtitle: cats[0].subtitle,
        percentage: 100,
        marks: safeMarks,
        questionsCount: safeMarks,
        marksPerQuestion: 1,
      },
      {
        id: 'long',
        name: cats[1].name,
        subtitle: cats[1].subtitle,
        percentage: 0,
        marks: 0,
        questionsCount: 0,
        marksPerQuestion: 2,
      },
      {
        id: 'essay',
        name: cats[2].name,
        subtitle: cats[2].subtitle,
        percentage: 0,
        marks: 0,
        questionsCount: 0,
        marksPerQuestion: 4,
      },
    ];
  }

  // First try default percentages with preferredTotalQuestions
  const pctBased = buildStep2FromPercentages(safeMarks, percentages, safeQ);
  const pctTotalQ = pctBased.reduce((s, x) => s + x.questionsCount, 0);
  const pctTotalM = pctBased.reduce((s, x) => s + x.marks, 0);
  if (pctTotalQ === safeQ && pctTotalM === safeMarks) {
    return pctBased;
  }

  // Otherwise solve exact integer distribution matching (safeMarks, safeQ)
  const solved = solveExactQuestionTypes(safeMarks, safeQ);
  const qShort = solved.mcq + solved.vsa;
  const mShort = qShort * 1;
  const qLong = solved.sa + solved.la1;
  const mLong = solved.sa * 2 + solved.la1 * 3;
  const qEssay = solved.la2;
  const mEssay = solved.la2 * 4;

  const rows: QuestionTypeWeightage[] = [
    {
      id: 'short_objective',
      name: cats[0].name,
      subtitle: cats[0].subtitle,
      percentage: Math.round((mShort / safeMarks) * 100),
      marks: mShort,
      questionsCount: qShort,
      marksPerQuestion: 1,
    },
    {
      id: 'long',
      name: cats[1].name,
      subtitle: cats[1].subtitle,
      percentage: Math.round((mLong / safeMarks) * 100),
      marks: mLong,
      questionsCount: qLong,
      marksPerQuestion: qLong > 0 ? Math.max(2, Math.round(mLong / qLong)) : 2,
    },
    {
      id: 'essay',
      name: cats[2].name,
      subtitle: cats[2].subtitle,
      percentage: Math.round((mEssay / safeMarks) * 100),
      marks: mEssay,
      questionsCount: qEssay,
      marksPerQuestion: 4,
    },
  ];
  return normalizeStepPercentages(rows, safeMarks);
}

/**
 * Balances percentages across an array of weightages so that the sum is strictly 100%
 * and never assigns non-zero percentage to a 0-mark row due to discrete rounding.
 */
export function normalizeStepPercentages<T extends { marks: number; percentage: number }>(
  items: T[],
  totalMarks: number
): T[] {
  if (items.length === 0 || totalMarks <= 0) return items;

  let lastNonZeroIdx = -1;
  items.forEach((item, idx) => {
    if (item.marks > 0) lastNonZeroIdx = idx;
  });

  if (lastNonZeroIdx === -1) {
    items.forEach(item => {
      item.percentage = 0;
    });
    return items;
  }

  let remaining = 100;
  items.forEach((item, idx) => {
    if (item.marks <= 0) {
      item.percentage = 0;
    } else if (idx === lastNonZeroIdx) {
      item.percentage = Math.max(0, remaining);
    } else {
      item.percentage = Math.round((item.marks / totalMarks) * 100);
      remaining -= item.percentage;
    }
  });
  return items;
}

/**
 * Suggests the standard Karnataka DSERT recommended question count based on total marks
 */
export function getRecommendedQuestionCount(targetMarks: number): number {
  if (targetMarks <= 10) return Math.max(1, Math.round(targetMarks));
  if (targetMarks <= 15) return Math.min(targetMarks, 10);
  if (targetMarks <= 20) return 12;
  if (targetMarks <= 25) return 16;
  if (targetMarks <= 35) return 20;
  if (targetMarks <= 40) return 24;
  if (targetMarks <= 50) return 28;
  if (targetMarks <= 60) return 32;
  if (targetMarks <= 80) return 38;
  if (targetMarks <= 100) return 42;
  return Math.max(10, Math.round(targetMarks * 0.45));
}

/**
 * Solves exact integer distribution of question types for given marks and question count
 */
export function solveExactQuestionTypes(
  targetMarks: number,
  targetQuestions: number
): { mcq: number; vsa: number; sa: number; la1: number; la2: number } {
  const safeMarks = Math.max(1, Math.round(targetMarks));
  const safeQuestions = Math.max(1, Math.min(safeMarks, Math.round(targetQuestions)));
  const diff = safeMarks - safeQuestions;

  // All 1-mark questions (e.g. 10 marks, 10 questions -> 10 one-mark questions!)
  if (diff <= 0) {
    const mcq = Math.ceil(safeMarks / 2);
    const vsa = safeMarks - mcq;
    return { mcq, vsa, sa: 0, la1: 0, la2: 0 };
  }

  let best: { q1: number; q2: number; q3: number; q4: number } | null = null;
  let minCost = Infinity;

  const maxQ4 = Math.min(safeQuestions, Math.floor(diff / 3));
  for (let q4 = 0; q4 <= maxQ4; q4++) {
    const maxQ3 = Math.min(safeQuestions - q4, Math.floor((diff - 3 * q4) / 2));
    for (let q3 = 0; q3 <= maxQ3; q3++) {
      const q2 = diff - 3 * q4 - 2 * q3;
      const q1 = safeQuestions - q2 - q3 - q4;
      if (q1 >= 0 && q2 >= 0 && q1 + q2 + q3 + q4 === safeQuestions) {
        const cost =
          Math.abs((q1 * 1) / safeMarks - 0.3) +
          Math.abs((q2 * 2 + q3 * 3) / safeMarks - 0.5) +
          Math.abs((q4 * 4) / safeMarks - 0.2) +
          Math.abs((q2 * 2) / safeMarks - 0.25) * 0.2 +
          (safeMarks >= 25 && q4 === 0 ? 0.4 : 0) +
          (safeMarks >= 20 && q1 === 0 ? 0.5 : 0);

        if (cost < minCost) {
          minCost = cost;
          best = { q1, q2, q3, q4 };
        }
      }
    }
  }

  if (!best) {
    // Mathematical fallback for extreme diff > 3 * safeQuestions
    const q4 = Math.min(safeQuestions, Math.floor(safeMarks / 4));
    const remM = safeMarks - q4 * 4;
    const remQ = safeQuestions - q4;
    best = { q1: Math.max(0, remQ), q2: 0, q3: 0, q4: Math.max(0, q4) };
    if (remM > remQ && remQ > 0) {
      best.q2 = Math.min(remQ, remM - remQ);
      best.q1 = remQ - best.q2;
    }
  }

  const mcq = best.q1 <= 1 ? best.q1 : Math.max(1, Math.min(best.q1 - 1, Math.round(best.q1 * 0.45)));
  const vsa = Math.max(0, best.q1 - mcq);

  return {
    mcq,
    vsa,
    sa: Math.max(0, best.q2),
    la1: Math.max(0, best.q3),
    la2: Math.max(0, best.q4),
  };
}

/**
 * Builds the official 5-Step Blue Print matching Karnataka DSERT standards.
 * If paper is provided, derives the exact tallies from the actual chosen questions.
 * Ensures complete interconnectivity across all 5 steps.
 */
export function generateOfficialBlueprint(
  bank: QuestionBank,
  selectedChapterIds: string[],
  targetMarks = 40,
  targetQuestions = 24,
  paper?: GeneratedPaper | null,
  customChapterPercentages?: Record<string, number>
): CompleteBlueprint {
  const activeChapters =
    selectedChapterIds.length === 0
      ? bank.chapters
      : bank.chapters.filter(c => selectedChapterIds.includes(c.chapterId));

  // If a real paper is generated and has questions, derive exact blueprint from the actual paper
  if (paper && paper.sections && paper.sections.length > 0) {
    const allPaperQuestions = paper.sections.flatMap(s => s.questions);
    if (allPaperQuestions.length > 0) {
      // 1. Map questions to (objective, difficulty)
      // Categorize objectives: know, und, app, skill
      // Categorize difficulties: easy, avg, diff
      type ObjKey = 'know' | 'und' | 'app' | 'skill';
      type DiffKey = 'easy' | 'avg' | 'diff';

      const getObjective = (q: any, idx: number): ObjKey => {
        // Direct explicit tag
        const rawObj = (q.objective || q.objectiveName || '').toLowerCase();
        if (rawObj.includes('know') || rawObj.includes('ಜ್ಞಾನ') || rawObj.includes('ಸ್ಮರಣೆ')) return 'know';
        if (rawObj.includes('und') || rawObj.includes('ತಿಳುವಳಿಕೆ') || rawObj.includes('ಗ್ರಹಿಕೆ')) return 'und';
        if (rawObj.includes('app') || rawObj.includes('ಅನ್ವಯ') || rawObj.includes('ಅಭಿವ್ಯಕ್ತಿ')) return 'app';
        if (rawObj.includes('skill') || rawObj.includes('ಕೌಶಲ') || rawObj.includes('ಚಿತ್ರ') || rawObj.includes('ನಕ್ಷೆ')) return 'skill';

        // Check learningOutcome
        const lo = (q.learningOutcome || '').toLowerCase();
        if (lo.includes('ಜ್ಞಾನ') || lo.includes('knowledge') || lo.includes('ಸ್ಮರಣೆ')) return 'know';
        if (lo.includes('ಅನ್ವಯ') || lo.includes('application') || lo.includes('ಅಭಿವ್ಯಕ್ತಿ')) return 'app';
        if (lo.includes('ಕೌಶಲ') || lo.includes('skill') || lo.includes('ಚಿತ್ರ') || lo.includes('ನಕ್ಷೆ') || q.hasDiagram) return 'skill';
        if (lo.includes('ತಿಳುವಳಿಕೆ') || lo.includes('understanding') || lo.includes('ಗ್ರಹಿಕೆ')) return 'und';

        // Check question text content
        const text = (q.question || '').toLowerCase();
        if (text.includes('ಚಿತ್ರ') || text.includes('ರೇಖಾಚಿತ್ರ') || text.includes('ನಕ್ಷೆ') || text.includes('ಗುರುತಿಸಿ') || text.includes('ರಚಿಸಿ') || text.includes('ಡ್ರಾಯಿಂಗ್') || q.hasDiagram) return 'skill';
        if (text.includes('ಲೆಕ್ಕ') || text.includes('ಕಂಡುಹಿಡಿಯಿರಿ') || text.includes('ಬೆಲೆ') || text.includes('ಸಾಧಿಸಿ') || text.includes('ಸಮಸ್ಯೆ') || text.includes('ಅನ್ವಯ') || text.includes('ಪ್ರಯೋಗ')) return 'app';
        if (text.includes('ಕಾರಣ') || text.includes('ವ್ಯತ್ಯಾಸ') || text.includes('ವಿವರಿಸಿ') || text.includes('ಹೋಲಿಸಿ') || text.includes('ಗ್ರಹಿಸಿ') || text.includes('ಏಕೆಂದರೆ')) return 'und';

        // DSERT Standard Objective Proportions Distribution Fallback:
        // ~25% Knowledge (know), ~45% Understanding (und), ~20% Application (app), ~10% Skill (skill)
        const mod = idx % 10;
        if (mod === 9) return 'skill';
        if (mod === 6 || mod === 7) return 'app';
        if (mod >= 2 && mod <= 5) return 'und';
        return 'know';
      };

      const getDifficulty = (q: any, idx: number): DiffKey => {
        const d = (q.difficulty || '').toLowerCase();
        if (d.includes('ಸುಲಭ') || d.includes('easy')) return 'easy';
        if (d.includes('ಕಠಿಣ') || d.includes('hard') || d.includes('diff')) return 'diff';
        if (d.includes('ಸಾಧಾರಣ') || d.includes('medium') || d.includes('avg') || d.includes('ಮಧ್ಯಮ')) return 'avg';

        // DSERT Standard Difficulty Distribution Fallback: 30% easy, 50% avg, 20% diff
        const mod = idx % 10;
        if (mod <= 2) return 'easy';
        if (mod <= 7) return 'avg';
        return 'diff';
      };

      // 2. Build Step 5 rows by Chapter x (Objective x Step 2 Question Type: short_objective, long, essay)
      // AND independently tally Step 3 Difficulty from the actual paper questions
      const qTypeKeys: Step2CategoryId[] = ['short_objective', 'long', 'essay'];
      const diffTallies: Record<DiffKey, { q: number; m: number }> = {
        easy: { q: 0, m: 0 },
        avg: { q: 0, m: 0 },
        diff: { q: 0, m: 0 },
      };

      const chMap = new Map<string, {
        chapterName: string;
        chapterNumber: number;
        grid: Record<`${ObjKey}_${Step2CategoryId}`, { count: number; totalMarks: number; questionIds: string[] }>;
      }>();

      // Initialize all active chapters
      activeChapters.forEach((ch, idx) => {
        const gridObj: any = {};
        (['know', 'und', 'app', 'skill'] as ObjKey[]).forEach(o => {
          qTypeKeys.forEach(qt => {
            gridObj[`${o}_${qt}`] = { count: 0, totalMarks: 0, questionIds: [] };
          });
        });
        chMap.set(ch.chapterName, {
          chapterName: ch.chapterName,
          chapterNumber: ch.chapterNumber || idx + 1,
          grid: gridObj,
        });
      });

      // Populate from actual paper questions
      allPaperQuestions.forEach((q, idx) => {
        const chName = q.chapterName || activeChapters[0]?.chapterName || 'ಸಾಮಾನ್ಯ';
        if (!chMap.has(chName)) {
          const gridObj: any = {};
          (['know', 'und', 'app', 'skill'] as ObjKey[]).forEach(o => {
            qTypeKeys.forEach(qt => {
              gridObj[`${o}_${qt}`] = { count: 0, totalMarks: 0, questionIds: [] };
            });
          });
          chMap.set(chName, {
            chapterName: chName,
            chapterNumber: chMap.size + 1,
            grid: gridObj,
          });
        }

        const entry = chMap.get(chName)!;
        const obj = getObjective(q, idx);
        const diff = getDifficulty(q, idx);
        const qType = classifyQuestionToStep2Category(q);

        const cell = entry.grid[`${obj}_${qType}`];
        cell.count += 1;
        cell.totalMarks += q.marks;
        const qId = q.bankQuestionId || q.uid || (q as any).id || `q_${idx}`;
        cell.questionIds.push(qId);

        diffTallies[diff].q += 1;
        diffTallies[diff].m += q.marks;

        // Tag back onto question for consistency across views
        q.objective = obj;
        q.objectiveName = obj === 'know' ? 'ಜ್ಞಾನ' : obj === 'und' ? 'ತಿಳುವಳಿಕೆ' : obj === 'app' ? 'ಅನ್ವಯ' : 'ಕೌಶಲ';
        q.difficulty = diff === 'easy' ? 'ಸುಲಭ' : diff === 'diff' ? 'ಕಠಿಣ' : 'ಸಾಧಾರಣ';
      });

      // Build MasterGridRows (Objectives x Step 2 Question Types)
      const step5MasterGrid: MasterGridRow[] = Array.from(chMap.entries()).map(([chName, item]) => {
        const mkCell = (k: `${ObjKey}_${Step2CategoryId}`): ObjectiveDiffCell | null => {
          const c = item.grid[k];
          if (c.count === 0) return null;
          const avgMarks = Math.max(1, Math.round(c.totalMarks / c.count));
          return {
            questionsCount: c.count,
            marksPerQuestion: avgMarks,
            totalMarks: c.totalMarks,
            questionIds: [...c.questionIds],
          };
        };

        const totalQ = Object.values(item.grid).reduce((s, c) => s + c.count, 0);
        const totalM = Object.values(item.grid).reduce((s, c) => s + c.totalMarks, 0);
        const chObj = activeChapters.find(c => c.chapterName === chName);

        return {
          chapterId: chObj?.chapterId || `ch_${item.chapterNumber}`,
          chapterNumber: item.chapterNumber,
          chapterName: chName,
          knowledgeShort: mkCell('know_short_objective'),
          knowledgeLong: mkCell('know_long'),
          knowledgeEssay: mkCell('know_essay'),
          understandingShort: mkCell('und_short_objective'),
          understandingLong: mkCell('und_long'),
          understandingEssay: mkCell('und_essay'),
          applicationShort: mkCell('app_short_objective'),
          applicationLong: mkCell('app_long'),
          applicationEssay: mkCell('app_essay'),
          skillShort: mkCell('skill_short_objective'),
          skillLong: mkCell('skill_long'),
          skillEssay: mkCell('skill_essay'),
          totalQuestions: totalQ,
          totalMarks: totalM,
        };
      });

      const paperTotalMarks = allPaperQuestions.reduce((s, q) => s + q.marks, 0);
      const paperTotalQ = allPaperQuestions.length;

      // Step 4 Chapters
      const step4Chapters: ChapterWeightage[] = step5MasterGrid.map((row, idx) => ({
        chapterId: row.chapterId,
        chapterNumber: row.chapterNumber || idx + 1,
        chapterName: row.chapterName,
        questionsCount: row.totalQuestions,
        marks: row.totalMarks,
        percentage: paperTotalMarks > 0 ? Math.round((row.totalMarks / paperTotalMarks) * 100) : 0,
      }));

      // Step 1 Objectives - Strictly Tallying with Step 5 objective column groups
      const sumGrid = (filterPrefix: string) => {
        let q = 0;
        let m = 0;
        step5MasterGrid.forEach(row => {
          Object.entries(row).forEach(([k, cell]) => {
            if (k.startsWith(filterPrefix) && cell && typeof cell === 'object' && 'questionsCount' in cell) {
              q += (cell as ObjectiveDiffCell).questionsCount;
              m += (cell as ObjectiveDiffCell).totalMarks;
            }
          });
        });
        return { q, m };
      };

      const knowTally = sumGrid('knowledge');
      const undTally = sumGrid('understanding');
      const appTally = sumGrid('application');
      const skillTally = sumGrid('skill');

      const step1Objectives: ObjectiveWeightage[] = [
        {
          id: 'know',
          name: 'ಜ್ಞಾನ / ಸ್ಮರಣೆ (Knowledge)',
          percentage: paperTotalMarks > 0 ? Math.round((knowTally.m / paperTotalMarks) * 100) : 25,
          marks: knowTally.m,
          questionsCount: knowTally.q,
        },
        {
          id: 'und',
          name: 'ಗ್ರಹಿಕೆ / ತಿಳುವಳಿಕೆ (Understanding)',
          percentage: paperTotalMarks > 0 ? Math.round((undTally.m / paperTotalMarks) * 100) : 45,
          marks: undTally.m,
          questionsCount: undTally.q,
        },
        {
          id: 'app',
          name: 'ಅಭಿವ್ಯಕ್ತಿ / ಅನ್ವಯ (Application)',
          percentage: paperTotalMarks > 0 ? Math.round((appTally.m / paperTotalMarks) * 100) : 20,
          marks: appTally.m,
          questionsCount: appTally.q,
        },
        {
          id: 'skill',
          name: 'ಪ್ರಶಂಸೆ / ಕೌಶಲ / ನಕ್ಷೆ (Skill)',
          percentage: paperTotalMarks > 0 ? Math.round((skillTally.m / paperTotalMarks) * 100) : 10,
          marks: skillTally.m,
          questionsCount: skillTally.q,
        },
      ];

      // Step 2 Question Types - Strictly Tallying 100% with Step 5 sub-columns (Short, Long, Essay)
      const sumQType = (suffix: 'Short' | 'Long' | 'Essay') => {
        let q = 0;
        let m = 0;
        step5MasterGrid.forEach(row => {
          Object.entries(row).forEach(([k, cell]) => {
            if (k.endsWith(suffix) && cell && typeof cell === 'object' && 'questionsCount' in cell) {
              q += (cell as ObjectiveDiffCell).questionsCount;
              m += (cell as ObjectiveDiffCell).totalMarks;
            }
          });
        });
        return { q, m };
      };

      const shortTally = sumQType('Short');
      const longTally = sumQType('Long');
      const essayTally = sumQType('Essay');
      const permanentCats = getPermanentStep2Categories();

      const step2QuestionTypes: QuestionTypeWeightage[] = [
        {
          id: 'short_objective',
          name: permanentCats[0].name,
          subtitle: permanentCats[0].subtitle,
          percentage: paperTotalMarks > 0 ? Math.round((shortTally.m / paperTotalMarks) * 100) : 0,
          marks: shortTally.m,
          questionsCount: shortTally.q,
          marksPerQuestion: shortTally.q > 0 ? Math.max(1, Math.round(shortTally.m / shortTally.q)) : 1,
        },
        {
          id: 'long',
          name: permanentCats[1].name,
          subtitle: permanentCats[1].subtitle,
          percentage: paperTotalMarks > 0 ? Math.round((longTally.m / paperTotalMarks) * 100) : 0,
          marks: longTally.m,
          questionsCount: longTally.q,
          marksPerQuestion: longTally.q > 0 ? Math.max(2, Math.round(longTally.m / longTally.q)) : 2,
        },
        {
          id: 'essay',
          name: permanentCats[2].name,
          subtitle: permanentCats[2].subtitle,
          percentage: paperTotalMarks > 0 ? Math.round((essayTally.m / paperTotalMarks) * 100) : 0,
          marks: essayTally.m,
          questionsCount: essayTally.q,
          marksPerQuestion: essayTally.q > 0 ? Math.max(4, Math.round(essayTally.m / essayTally.q)) : 4,
        },
      ];

      // Step 3 Difficulty - Tallied from the exact paper questions
      const step3Difficulty: DifficultyWeightage[] = [
        {
          id: 'easy',
          name: 'ಸುಲಭ (Easy)',
          marks: diffTallies.easy.m,
          percentage: paperTotalMarks > 0 ? Math.round((diffTallies.easy.m / paperTotalMarks) * 100) : 30,
          questionsCount: diffTallies.easy.q,
        },
        {
          id: 'avg',
          name: 'ಸಾಧಾರಣ (Avg)',
          marks: diffTallies.avg.m,
          percentage: paperTotalMarks > 0 ? Math.round((diffTallies.avg.m / paperTotalMarks) * 100) : 50,
          questionsCount: diffTallies.avg.q,
        },
        {
          id: 'diff',
          name: 'ಕಠಿಣ (Diff)',
          marks: diffTallies.diff.m,
          percentage: paperTotalMarks > 0 ? Math.round((diffTallies.diff.m / paperTotalMarks) * 100) : 20,
          questionsCount: diffTallies.diff.q,
        },
      ];

      // Strict 100% balancing across all steps so percentages strictly sum to 100%
      normalizeStepPercentages(step1Objectives, paperTotalMarks);
      normalizeStepPercentages(step2QuestionTypes, paperTotalMarks);
      normalizeStepPercentages(step3Difficulty, paperTotalMarks);
      normalizeStepPercentages(step4Chapters, paperTotalMarks);

      return {
        title: `${bank.metadata.grade} ${bank.metadata.subject} - ಅಧಿಕೃತ ಪರೀಕ್ಷಾ ನೀಲನಕಾಶೆ (Blue Print)`,
        grade: bank.metadata.grade,
        subject: bank.metadata.subject,
        totalMarks: paperTotalMarks,
        totalQuestions: paperTotalQ,
        step1Objectives,
        step2QuestionTypes,
        step3Difficulty,
        step4Chapters,
        step5MasterGrid,
      };
    }
  }

  // BASELINE BLUEPRINT GENERATION (When paper is not yet generated)
  // Step 2 strictly honors exact (targetMarks, targetQuestions) — e.g., 10 marks / 10 questions => 10 x 1-mark questions!
  const step2QuestionTypes: QuestionTypeWeightage[] = buildStep2ForTarget(
    targetMarks,
    targetQuestions,
    DEFAULT_STEP2_PERCENTAGES
  );
  const syncedBaselineTotalQ =
    step2QuestionTypes.reduce((s, x) => s + x.questionsCount, 0) || targetQuestions;

  // Step 4 Chapter Weightages (exact integer marks and bounded questions summing strictly to targetMarks & syncedBaselineTotalQ)
  const totalCustomWeight = customChapterPercentages
    ? Object.values(customChapterPercentages).reduce((s, p) => s + p, 0)
    : 0;

  const chWeights = activeChapters.map(ch => {
    if (customChapterPercentages && customChapterPercentages[ch.chapterId]) {
      return (customChapterPercentages[ch.chapterId] || 1) / (totalCustomWeight || 100);
    }
    if (ch.weightagePercent && ch.weightagePercent > 0) {
      return ch.weightagePercent / 100;
    }
    return Math.max(5, ch.questions?.length || 10);
  });

  const minChMark = targetMarks >= activeChapters.length ? 1 : 0;
  const chMarksArr = apportionExactIntegers(chWeights, targetMarks, minChMark);
  const chQArr = apportionBoundedQuestions(chMarksArr, syncedBaselineTotalQ, chWeights);

  const step4Chapters: ChapterWeightage[] = activeChapters.map((ch, idx) => ({
    chapterId: ch.chapterId,
    chapterNumber: ch.chapterNumber || idx + 1,
    chapterName: ch.chapterName,
    marks: chMarksArr[idx],
    questionsCount: chQArr[idx],
    percentage: targetMarks > 0 ? Math.round((chMarksArr[idx] / targetMarks) * 100) : 0,
  }));

  // Step 1 Objectives (DSERT standard 25% / 45% / 20% / 10%) strictly summing to targetMarks & syncedBaselineTotalQ
  const objBase = [
    { id: 'know', name: 'ಜ್ಞಾನ / ಸ್ಮರಣೆ (Knowledge)', pct: 25 },
    { id: 'und', name: 'ಗ್ರಹಿಕೆ / ತಿಳುವಳಿಕೆ (Understanding)', pct: 45 },
    { id: 'app', name: 'ಅಭಿವ್ಯಕ್ತಿ / ಅನ್ವಯ (Application)', pct: 20 },
    { id: 'skill', name: 'ಪ್ರಶಂಸೆ / ಕೌಶಲ / ನಕ್ಷೆ (Skill)', pct: 10 },
  ];
  const objMarksArr = apportionExactIntegers(objBase.map(o => o.pct), targetMarks, 0);
  const objQArr = apportionBoundedQuestions(objMarksArr, syncedBaselineTotalQ, objBase.map(o => o.pct));
  const step1Objectives: ObjectiveWeightage[] = objBase.map((o, idx) => ({
    id: o.id,
    name: o.name,
    percentage: o.pct,
    marks: objMarksArr[idx],
    questionsCount: objQArr[idx],
  }));

  // Step 3 Difficulty (DSERT standard 30% / 50% / 20%) strictly summing to targetMarks & syncedBaselineTotalQ
  const diffBase = [
    { id: 'easy', name: 'ಸುಲಭ (Easy)', pct: 30 },
    { id: 'avg', name: 'ಸಾಧಾರಣ (Avg)', pct: 50 },
    { id: 'diff', name: 'ಕಠಿಣ (Diff)', pct: 20 },
  ];
  const diffMarksArr = apportionExactIntegers(diffBase.map(d => d.pct), targetMarks, 0);
  const diffQArr = apportionBoundedQuestions(diffMarksArr, syncedBaselineTotalQ, diffBase.map(d => d.pct));
  const step3Difficulty: DifficultyWeightage[] = diffBase.map((d, idx) => ({
    id: d.id,
    name: d.name,
    percentage: d.pct,
    marks: diffMarksArr[idx],
    questionsCount: diffQArr[idx],
  }));

  normalizeStepPercentages(step1Objectives, targetMarks);
  normalizeStepPercentages(step2QuestionTypes, targetMarks);
  normalizeStepPercentages(step3Difficulty, targetMarks);
  normalizeStepPercentages(step4Chapters, targetMarks);

  // Step 5 Master 12-Column Grid — 100% mathematically synchronized with Steps 1, 2 (Question Types), and 4
  const step5MasterGrid: MasterGridRow[] = buildSynchronizedMasterGrid(
    step1Objectives,
    step2QuestionTypes,
    step4Chapters
  );

  return {
    title: `${bank.metadata.grade} ${bank.metadata.subject} - ಅಧಿಕೃತ ಪರೀಕ್ಷಾ ನೀಲನಕಾಶೆ (Blue Print)`,
    grade: bank.metadata.grade,
    subject: bank.metadata.subject,
    totalMarks: targetMarks,
    totalQuestions: syncedBaselineTotalQ,
    step1Objectives,
    step2QuestionTypes,
    step3Difficulty,
    step4Chapters,
    step5MasterGrid,
  };
}

/**
 * Generates section blueprints matching the official Karnataka blueprint format
 */
export function buildSectionsFromBlueprint(
  bank: QuestionBank,
  selectedChapterIds: string[],
  targetMarks = 40,
  targetQuestions = 24
): SectionBlueprint[] {
  const qTypes = solveExactQuestionTypes(targetMarks, targetQuestions);
  const isLang = isLanguageSubject(bank.metadata.subject, bank.metadata.subjectCode);
  const romanMap = ['I', 'II', 'III', 'IV', 'V'];

  const specs = [
    {
      id: 'mcq',
      name: 'ವಸ್ತುನಿಷ್ಠ (MCQ)',
      fmtCat: 'mcq',
      instruction: 'ಕೆಳಗಿನ ಪ್ರಶ್ನೆಗಳಿಗೆ ನಾಲ್ಕು ಆಯ್ಕೆಗಳನ್ನು ನೀಡಲಾಗಿದೆ. ಸರಿಯಾದ ಉತ್ತರವನ್ನು ಆರಿಸಿ ಬರೆಯಿರಿ:',
      marksPerQuestion: 1,
      questionCount: qTypes.mcq,
    },
    {
      id: 'vsa',
      name: 'ಕಿರು ಉತ್ತರ (1 ಅಂಕ)',
      fmtCat: 'one_sentence',
      instruction: 'ಕೆಳಗಿನ ಪ್ರಶ್ನೆಗಳಿಗೆ ಒಂದು ಪದ ಅಥವಾ ಒಂದು ವಾಕ್ಯದಲ್ಲಿ ಉತ್ತರಿಸಿ / ಬಿಟ್ಟ ಸ್ಥಳ ತುಂಬಿರಿ:',
      marksPerQuestion: 1,
      questionCount: qTypes.vsa,
    },
    {
      id: 'sa',
      name: 'ದೀರ್ಘ ಉತ್ತರ (2 ಅಂಕ)',
      fmtCat: 'short_2m',
      instruction: 'ಕೆಳಗಿನ ಪ್ರಶ್ನೆಗಳಿಗೆ ಎರಡು ಅಥವಾ ಮೂರು ವಾಕ್ಯಗಳಲ್ಲಿ ಉತ್ತರಿಸಿ:',
      marksPerQuestion: 2,
      questionCount: qTypes.sa,
    },
    {
      id: 'la1',
      name: 'ದೀರ್ಘ ಉತ್ತರ (3 ಅಂಕ)',
      fmtCat: 'short_3m',
      instruction: 'ಕೆಳಗಿನ ಪ್ರಶ್ನೆಗಳಿಗೆ ವಿವರವಾಗಿ ಉತ್ತರಿಸಿ:',
      marksPerQuestion: 3,
      questionCount: qTypes.la1,
    },
    {
      id: 'la2',
      name: isLang ? 'ಪ್ರಬಂಧ ಮಾದರಿ ಉತ್ತರ (4 ಅಂಕ)' : 'ವಿವರಣಾತ್ಮಕ ಉತ್ತರ (4 ಅಂಕ)',
      fmtCat: 'long_4m',
      instruction: isLang
        ? 'ಕೆಳಗಿನ ಪ್ರಶ್ನೆಗಳಿಗೆ ಪ್ರಬಂಧ ಮಾದರಿಯಲ್ಲಿ ವಿವರವಾಗಿ ಉತ್ತರಿಸಿ:'
        : 'ಕೆಳಗಿನ ಪ್ರಶ್ನೆಗಳಿಗೆ ವಿವರಣಾತ್ಮಕವಾಗಿ ಉತ್ತರಿಸಿ / ಚಿತ್ರ ರಚಿಸಿ:',
      marksPerQuestion: 4,
      questionCount: qTypes.la2,
    },
  ].filter(s => s.questionCount > 0);

  return specs.map((spec, idx) => ({
    id: `sec_${spec.id}_${Date.now()}_${idx}`,
    sectionRoman: romanMap[idx] || `${idx + 1}`,
    title: `ವಿಭಾಗ - ${romanMap[idx] || idx + 1} : ${spec.name}`,
    instructionText: spec.instruction,
    questionType: spec.name,
    formatCategoryId: spec.fmtCat,
    selectedChapterIds,
    selectedLearningOutcomes: ['all'],
    difficulty: 'all',
    marksPerQuestion: spec.marksPerQuestion,
    questionCount: spec.questionCount,
  }));
}
