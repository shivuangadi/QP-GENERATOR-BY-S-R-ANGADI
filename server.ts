/**
 * Full-Stack Server: Express + Vite Middleware with Gemini Multimodal LBA PDF Extraction
 * Author: S R Angadi / M I Nilaji
 */

import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import nodemailer from 'nodemailer';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import {
  fixDegreeSymbolOcrErrors,
  sanitizeQuestionMathText,
} from './src/utils/mathTextSanitizer.ts';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

// Generous JSON body parser limit for large PDF base64 payloads
app.use(express.json({ limit: '60mb' }));
app.use(express.urlencoded({ extended: true, limit: '60mb' }));

// Ensure user_banks, question_images, and uploaded_pdfs directories exist
const userBanksDir = path.join(__dirname, 'public', 'assets', 'user_banks');
if (!fs.existsSync(userBanksDir)) {
  fs.mkdirSync(userBanksDir, { recursive: true });
}
const questionImagesDir = path.join(__dirname, 'public', 'assets', 'question_images');
if (!fs.existsSync(questionImagesDir)) {
  fs.mkdirSync(questionImagesDir, { recursive: true });
}
const uploadedPdfsDir = path.join(__dirname, 'public', 'assets', 'uploaded_pdfs');
if (!fs.existsSync(uploadedPdfsDir)) {
  fs.mkdirSync(uploadedPdfsDir, { recursive: true });
}
const uploadedPdfsIndexPath = path.join(uploadedPdfsDir, 'index.json');
if (!fs.existsSync(uploadedPdfsIndexPath)) {
  fs.writeFileSync(uploadedPdfsIndexPath, JSON.stringify({ files: [] }, null, 2), 'utf8');
}

// User banks index file
const userBanksIndexPath = path.join(userBanksDir, 'index.json');
if (!fs.existsSync(userBanksIndexPath)) {
  fs.writeFileSync(userBanksIndexPath, JSON.stringify({ files: [] }, null, 2), 'utf8');
}

// Initialize Gemini Client per @google/genai guidelines
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    },
  },
});

/**
 * Health check & Gemini API Key verification
 */
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    hasGeminiKey: Boolean(process.env.GEMINI_API_KEY),
    port: PORT,
  });
});

/**
 * Safely parse JSON from Gemini response, stripping markdown fences or stray prose if present
 */
function parseGeminiJson(rawText: string): any {
  if (!rawText || !rawText.trim()) return {};
  let cleaned = rawText.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
  }
  try {
    return JSON.parse(cleaned);
  } catch {
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      return JSON.parse(cleaned.slice(firstBrace, lastBrace + 1));
    }
    throw new Error('AI response was not valid JSON. Please retry this chapter.');
  }
}

/**
 * Supported active Gemini models (per gemini-api guidelines).
 * gemini-3.1-flash-lite is placed first because it provides much higher free-tier
 * daily request quota for multi-chapter PDF OCR, with gemini-4-hydrogen as fallback.
 */
const CANDIDATE_MODELS = [
  'gemini-3.1-flash-lite',
  'gemini-4-hydrogen',
];

// In-memory cooldown tracker so quota-exhausted models are skipped cleanly without repeated 429 failures
const modelCooldownUntil = new Map<string, number>();

function extractRetryDelayMs(err: any): number {
  const msg = String(err?.message || '');
  const retryMatch = msg.match(/"retryDelay"\s*:\s*"(\d+)s"/i) || msg.match(/retry in\s+(\d+)h/i);
  if (msg.includes('PerDay') || msg.includes('per day')) {
    if (retryMatch && retryMatch[1]) {
      const secs = parseInt(retryMatch[1], 10);
      if (!isNaN(secs) && secs > 60) {
        return Math.min(secs * 1000, 6 * 60 * 60 * 1000); // cap at 6h in-memory
      }
    }
    return 60 * 60 * 1000; // 1 hour cooldown on daily quota exhaustion
  }
  if (retryMatch && retryMatch[1]) {
    const secs = parseInt(retryMatch[1], 10);
    if (!isNaN(secs) && secs > 0) {
      return Math.min(Math.max(secs * 1000, 15_000), 10 * 60 * 1000);
    }
  }
  return 60_000; // 1 minute cooldown for per-minute rate limit
}

function isQuotaOrRateLimitError(err: any): boolean {
  const msg = String(err?.message || '');
  const code = err?.status || err?.code;
  return (
    code === 429 ||
    msg.includes('429') ||
    msg.includes('RESOURCE_EXHAUSTED') ||
    msg.includes('quota') ||
    msg.includes('rate-limits')
  );
}

/**
 * Execute Gemini content generation with smart cooldown & automatic fallback on 429/503/timeout.
 */
async function generateWithFallback(options: {
  contents: any[];
  config?: any;
}): Promise<{ text: string; modelUsed: string }> {
  let lastError: any = null;
  const now = Date.now();

  // Try models that are NOT currently in cooldown first; if all are in cooldown, try the one expiring soonest
  const readyModels = CANDIDATE_MODELS.filter(m => (modelCooldownUntil.get(m) || 0) <= now);
  const modelsToTry =
    readyModels.length > 0
      ? readyModels
      : [...CANDIDATE_MODELS].sort(
          (a, b) => (modelCooldownUntil.get(a) || 0) - (modelCooldownUntil.get(b) || 0)
        );

  for (const model of modelsToTry) {
    try {
      console.log(`[Gemini SDK] Requesting with model: ${model}`);
      const baseConfig = { ...(options.config || {}) };
      if (model === 'gemini-4-hydrogen' && !baseConfig.thinkingConfig) {
        baseConfig.thinkingConfig = { thinkingLevel: ThinkingLevel.LOW };
      }

      const response = await ai.models.generateContent({
        model,
        contents: options.contents,
        config: baseConfig,
      });
      // Clear any stale cooldown on success
      modelCooldownUntil.delete(model);
      console.log(`[Gemini SDK] Model ${model} succeeded!`);
      return { text: response.text || '{}', modelUsed: model };
    } catch (err: any) {
      lastError = err;
      const msg = String(err?.message || '');
      const code = err?.status || err?.code;
      const isQuota = isQuotaOrRateLimitError(err);

      if (isQuota) {
        const cooldownMs = extractRetryDelayMs(err);
        modelCooldownUntil.set(model, Date.now() + cooldownMs);
        console.log(
          `[Gemini SDK] Model ${model} hit rate/quota limit (cooldown ${Math.round(
            cooldownMs / 1000
          )}s). Switching to next available model...`
        );
        continue;
      }

      if (
        code === 503 ||
        code === 504 ||
        code === 404 ||
        msg.includes('503') ||
        msg.includes('504') ||
        msg.includes('timeout') ||
        msg.includes('DEADLINE_EXCEEDED')
      ) {
        console.log(`[Gemini SDK] Model ${model} temporarily unavailable (${code || 'timeout'}). Switching to next model...`);
        continue;
      }
      throw err;
    }
  }

  if (isQuotaOrRateLimitError(lastError)) {
    const quotaErr: any = new Error(
      'Gemini API ಉಚಿತ ದೈನಂದಿನ ಕೋಟಾ (Free Tier Quota) ಮುಗಿದಿದೆ. ದಯವಿಟ್ಟು ಸ್ವಲ್ಪ ಸಮಯದ ನಂತರ ಪ್ರಯತ್ನಿಸಿ ಅಥವಾ AI Studio Settings > Secrets ನಲ್ಲಿ ಬಿಲ್ಲಿಂಗ್ ಸಕ್ರಿಯ API ಕೀ ಆಯ್ಕೆಮಾಡಿ.'
    );
    quotaErr.status = 429;
    quotaErr.quotaExhausted = true;
    throw quotaErr;
  }

  throw lastError || new Error('All available Gemini models are currently busy or unavailable.');
}

/**
 * API: Scan LBA PDF Table of Contents & Structure
 * Uses Gemini multimodal vision to analyze syllabus, chapters, printed question/answer ranges, and exact prelim offset.
 */
app.post('/api/ai/scan-lba-pdf', async (req, res) => {
  console.log(`[/api/ai/scan-lba-pdf] Received scan request`);
  try {
    const { base64Pdf, fileName, totalPages, scannedPageNumbers } = req.body;

    if (!base64Pdf) {
      return res.status(400).json({ error: 'PDF data is required (PDF ಡೇಟಾ ಅಗತ್ಯವಿದೆ).' });
    }

    const cleanBase64 = base64Pdf.replace(/^data:application\/pdf;base64,/, '');
    const byteLength = Buffer.byteLength(cleanBase64, 'base64');
    console.log(
      `[/api/ai/scan-lba-pdf] Payload size: ${(byteLength / 1024).toFixed(1)} KB for ${fileName || 'unnamed.pdf'} (totalPages=${totalPages || '?'})`
    );

    const pageInfoNote = totalPages
      ? `The FULL PDF has ${totalPages} total physical pages. The attached slice contains physical PDF pages: ${scannedPageNumbers || 'first pages'}.`
      : '';

    const prompt = `Analyze this Karnataka DSERT LBA (Learning Outcomes Based Assessment / ಕಲಿಕಾಫಲ ಆಧಾರಿತ ಮೌಲ್ಯಾಂಕನ) or Karnataka State Textbook PDF document.
${pageInfoNote}

CRITICAL INSTRUCTIONS FOR ACCURATE TABLE OF CONTENTS (ಪರಿವಿಡಿ) & ANSWER PAGE DETECTION:
1. READ THE TABLE OF CONTENTS (ಪರಿವಿಡಿ / ಅನುಕ್ರಮಣಿಕೆ / विषय सूची / CONTENTS) WITH 100% PRECISION:
   - List EVERY single unit/chapter/lesson in order.
   - Capture the EXACT printed page numbers shown in the Table of Contents!
   - IMPORTANT: Many Karnataka LBA books have TWO page numbers in the TOC (either two columns on the same row, OR a second section in the TOC titled "ಮಾದರಿ ಉತ್ತರಗಳು / ಉತ್ತರ ಸೂಚಿ / उत्तरमाला / Model Answers / Answer Key"):
     * "printedQuestionPages": the PRINTED page number or range for that unit's questions as printed in the TOC (e.g., "1-6" or "1" if only start page is printed).
     * "printedAnswerPages": the PRINTED page number or range for that unit's answers as printed in the TOC (e.g., "85-88" or "85" if only start page is printed). Leave "" ONLY if the TOC truly does not list per-chapter answer pages.
   - If the TOC lists a single combined Model Answers / ಉತ್ತರ ಸೂಚಿ / उत्तरमाला range (e.g., "85-115" or "85"), put it in "metadata.printedGlobalAnswerPages".
   - If the TOC only lists starting page numbers (e.g. Ch1=1, Ch2=7, Ch3=14), compute each chapter's printed end page as (next chapter's start page - 1)!

2. EXACT PHYSICAL PDF PAGE OFFSET (prelimOffset):
   - Look through the pages of this PDF slice and find the page where PRINTED page number "1" (or Chapter 1's printed starting page) actually appears.
   - Calculate: prelimOffset = (physical PDF page number where printed page 1 appears) - 1.
   - Example: If cover + preface + TOC take physical PDF pages 1 to 6, and Chapter 1 (printed page 1) starts on physical PDF page 7, then prelimOffset = 6!
   - Also compute physical PDF page ranges by adding prelimOffset to printed page numbers:
     * "questionPages" = printedQuestionPages shifted by +prelimOffset
     * "answerPages" = printedAnswerPages shifted by +prelimOffset (if present)
     * "globalAnswerPages" = printedGlobalAnswerPages shifted by +prelimOffset (if present, ending at totalPages if no end page was printed)

Return STRICT JSON matching this exact structure:
{
  "metadata": {
    "title": "String title in Kannada/English/Hindi",
    "grade": "e.g. 7 ನೇ ತರಗತಿ (Class 7)",
    "gradeKey": "7",
    "subject": "e.g. ವಿಜ್ಞಾನ (Science)",
    "subjectCode": "SCI",
    "medium": "ಕನ್ನಡ ಮಾಧ್ಯಮ (State Syllabus)",
    "academicYear": "2026-27",
    "department": "ಕರ್ನಾಟಕ ಸರ್ಕಾರ, ಶಾಲಾ ಶಿಕ್ಷಣ ಮತ್ತು ಸಾಕ್ಷರತಾ ಇಲಾಖೆ",
    "institution": "DSERT ಬೆಂಗಳೂರು",
    "totalChapters": 0,
    "prelimOffset": 0,
    "printedGlobalAnswerPages": "85-115",
    "globalAnswerPages": "91-121"
  },
  "learningOutcomes": [
    { "code": "LO 1", "title": "ಕಲಿವಿನ ಫಲ ಶೀರ್ಷಿಕೆ" }
  ],
  "chapters": [
    {
      "chapterNumber": 1,
      "chapterId": "ch-1",
      "chapterName": "ಪಾಠದ ಹೆಸರು",
      "sectionType": "ಗದ್ಯಭಾಗ / ಪದ್ಯಭಾಗ / ಘಟಕ",
      "semester": 1,
      "weightagePercent": 15,
      "weightageMarks": 10,
      "learningOutcomes": ["LO 1", "LO 2"],
      "printedPages": "1-6",
      "printedAnswerPages": "85-87",
      "questionPages": "7-12",
      "answerPages": "91-93",
      "qaDetected": true
    }
  ]
}
Do not include markdown fences outside the JSON.`;

    const { text, modelUsed } = await generateWithFallback({
      contents: [
        {
          role: 'user',
          parts: [
            {
              inlineData: {
                mimeType: 'application/pdf',
                data: cleanBase64,
              },
            },
            {
              text: prompt,
            },
          ],
        },
      ],
      config: {
        responseMimeType: 'application/json',
      },
    });

    const parsed = parseGeminiJson(text);
    console.log(`[/api/ai/scan-lba-pdf] Scan successful via ${modelUsed}: found ${parsed.chapters?.length || 0} chapters, prelimOffset=${parsed.metadata?.prelimOffset}`);
    return res.json({ success: true, data: parsed, modelUsed });
  } catch (error: any) {
    const status = error?.status === 429 ? 429 : 500;
    console.error('Error scanning LBA PDF:', error?.message || error);
    return res.status(status).json({
      error: error.message || 'Failed to analyze LBA PDF structure.',
      quotaExhausted: Boolean(error?.quotaExhausted || status === 429),
    });
  }
});

/**
 * In-memory Async AI Job Manager
 * Prevents reverse-proxy / Cloud Run 60s HTTP connection drops ("TypeError: Failed to fetch")
 * during long multi-page Gemini OCR extractions by returning a jobId immediately and letting
 * the client poll lightweight status responses every ~1.8s.
 */
interface AiExtractionJob {
  id: string;
  kind: 'extract-chapter' | 'match-missing-answers';
  status: 'running' | 'done' | 'error' | 'cancelled';
  createdAt: number;
  updatedAt: number;
  data?: any;
  answers?: any[];
  modelUsed?: string;
  error?: string;
  quotaExhausted?: boolean;
}

const aiJobs = new Map<string, AiExtractionJob>();
const AI_JOB_TTL_MS = 15 * 60 * 1000;

function pruneExpiredAiJobs() {
  const cutoff = Date.now() - AI_JOB_TTL_MS;
  for (const [id, job] of aiJobs.entries()) {
    if (job.updatedAt < cutoff) {
      aiJobs.delete(id);
    }
  }
}

function createAiJob(kind: AiExtractionJob['kind']): AiExtractionJob {
  pruneExpiredAiJobs();
  const id = `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const now = Date.now();
  const job: AiExtractionJob = {
    id,
    kind,
    status: 'running',
    createdAt: now,
    updatedAt: now,
  };
  aiJobs.set(id, job);
  return job;
}

async function runExtractChapterTask(body: any): Promise<{ data: any; modelUsed: string }> {
  const {
    base64Pdf,
    chapterName,
    chapterNumber,
    questionPages,
    answerPages,
    slicePageMap,
    chunkInfo,
    metadata,
  } = body || {};

  if (!base64Pdf) {
    const err: any = new Error('PDF data is required.');
    err.status = 400;
    throw err;
  }

  const cleanBase64 = String(base64Pdf).replace(/^data:application\/pdf;base64,/, '');
  const byteLength = Buffer.byteLength(cleanBase64, 'base64');
  console.log(
    `[/api/ai/extract-chapter] Processing Ch ${chapterNumber}: "${chapterName}" ${chunkInfo || ''}, slice size: ${(byteLength / 1024).toFixed(1)} KB`
  );

  const subjectHint = [
    metadata?.subject || '',
    metadata?.subjectCode || '',
    metadata?.title || '',
    chapterName || '',
  ].join(' ');

  const pageMapText =
    typeof slicePageMap === 'string' && slicePageMap.trim()
      ? `\nPHYSICAL PDF PAGE MAP FOR THIS ATTACHED SLICE:\n${slicePageMap.trim()}\nUse this map to record the exact original physical PDF page number in "sourcePage" (where the question appears) and "answerPage" (where its answer appears) for EVERY question!\n`
      : '';

  const prompt = `You are a high-precision multilingual (Kannada, Hindi, English) OCR and Karnataka DSERT LBA educational assessment extractor.
Extract 100% OF ALL QUESTIONS and their COMPLETE, VERBATIM, UNABRIDGED answers for Chapter ${chapterNumber}: "${chapterName}" from the attached PDF slice.
Subject / Book Context: ${subjectHint || 'Karnataka State Syllabus'}
Target Question Pages in this slice: ${questionPages || 'Entire Chapter'} ${chunkInfo ? `(${chunkInfo})` : ''}
Target Answer Key Pages included in this slice: ${answerPages || 'Back of chapter or end of book'}
${pageMapText}
CRITICAL RULES FOR 100% FIDELITY TO THE LBA PDF BOOK:
1. ZERO-OMISSION EXHAUSTIVE EXTRACTION:
   - Scan EVERY single question page in this slice from top-left to bottom-right (including multi-column layouts, tables, boxed exercises, and questions near the bottom margin).
   - Extract EVERY SINGLE numbered question and sub-question — every MCQ, fill-in-the-blank, true/false, analogy, match-the-following, 1M/2M/3M/4M/5M problem, proof, derivation, and diagram-based question. NEVER truncate or stop early!
   - Extract ONLY questions that appear on the Target Question Pages (${questionPages || 'this slice'}), NOT questions from Answer Key pages.
2. EXACT PRINTED PDF SERIAL NUMBERS (CRITICAL — NEVER RENUMBER FROM 1!):
   - Copy the EXACT question number printed on the PDF page into BOTH "question_number" (integer) AND "printedSerial" (exact string label as printed in the book, e.g., "38", "42", "12(a)", "15(i)").
   - If this PDF page starts at question 38, the first extracted item MUST have "question_number": 38 and "printedSerial": "38" — NEVER reset to 1!
   - Do NOT prepend the serial number again inside the "question" text itself if it is already captured in "printedSerial".
3. COMPLETE VERBATIM FULL ANSWERS — NEVER SUMMARIZE OR SHORTEN!:
   - Copy the ENTIRE detailed official answer from the Answer Key pages WORD-FOR-WORD and STEP-BY-STEP!
   - STRICTLY FORBIDDEN: NEVER write 1-line summaries or shortcuts such as "Proof: Using incidence and reflection laws.", "Proved using ASA congruence.", "By Pythagoras theorem.", "Refer diagram.", or "Solve similarly."!
   - For EVERY proof, derivation, theorem, numerical calculation, or descriptive answer (2M/3M/4M/5M), transcribe EVERY SINGLE LINE printed in the PDF answer key using newline (\\n) separators:
     * Given / ದತ್ತ, To Prove / ಸಾಧನೀಯ, Construction / ರಚನೆ, Proof / ಸಾಧನೆ — EVERY equation, EVERY step, EVERY reason in brackets, and the final conclusion!
   - For MCQs, include BOTH the correct option letter and answer value (e.g., "B) 60°" or "ಅ) x² + 2x + 1").
   - Only if an answer is genuinely absent from ALL attached pages in this slice, write "ಉತ್ತರವನ್ನು ಪರಿಶೀಲಿಸಿ".
4. EXACT TEXTBOOK MATH TYPOGRAPHY — REAL SUPERSCRIPTS, SUBSCRIPTS & DEGREE SYMBOLS (NEVER x^2 OR 600!):
   - NEVER output raw ASCII caret exponents like x^2, y^3, (a+b)^2, cm^2, m^3, 10^-5, x^n, or LaTeX $...$!
   - ALWAYS write real Unicode superscripts & subscripts exactly as printed in the LBA PDF book:
     * Powers/Exponents: x², x³, x⁴, xⁿ, (a + b)², cm², m³, m/s², 10⁻⁵, 2ⁿ⁺¹
     * Subscripts: H₂O, CO₂, H₂SO₄, x₁, x₂, aₙ, log₁₀
   - DEGREE SYMBOL (°): NEVER misread the superscript degree symbol (°) as digit "0" or letter "o"!
     * Write 60° (NOT 600), 90° (NOT 900), 180° (NOT 1800), 360° (NOT 3600), 45° (NOT 450), 30° (NOT 300), 120° (NOT 1200), x° (NOT x0), (2x + 10)° (NOT (2x + 10)0).
   - Preserve mathematical symbols cleanly: ∠, △, ∥, ⊥, ≅, ~, π, √, ∴, ∵, ×, ÷, ±, ≤, ≥, ≠, °.
5. COMPLETE COVERAGE & DISCRETE SUB-QUESTIONS:
   - If a heading contains multiple numbered sub-questions (1, 2, 3... 15), DO NOT bundle them into one item! Extract EACH numbered sub-question as its own object with its exact "question_number" and "printedSerial".
6. EXACT PAGE NUMBERS:
   - Record "sourcePage" = original physical PDF page number (integer from page map above) where the question is printed.
   - Record "answerPage" = original physical PDF page number (integer from page map above) where its answer is printed.
7. QUESTION FORMAT CATEGORY & ACCURATE MARKS:
   - "mcq" (1M), "fill_blank" (1M), "true_false" (1M), "analogy" (1M), "match" (items array, marks = pair count), "one_sentence" (1M), "short_2m" (2M), "short_3m" (3M), "long_4m" (4M/5M).
8. EDUCATIONAL OBJECTIVE (ಉದ್ದಿಷ್ಟ): "ಜ್ಞಾನ", "ತಿಳುವಳಿಕೆ", "ಅನ್ವಯ", or "ಕೌಶಲ".
9. DIFFICULTY (ಕ್ಲಿಷ್ಟತೆ): "ಸುಲಭ", "ಸಾಧಾರಣ", or "ಕಠಿಣ".
10. DIAGRAM DETECTION: If a question refers to a figure/diagram/graph/map ("In the given figure...", "ಚಿತ್ರದಲ್ಲಿ..."), set "hasDiagram": true and describe it in "diagramDescription".

Return a JSON object:
{
  "chapterId": "ch-${chapterNumber}",
  "chapterNumber": ${chapterNumber},
  "chapterName": "${chapterName}",
  "semester": ${chapterNumber > 5 ? 2 : 1},
  "extractedQuestionsCount": 0,
  "questions": [
    {
      "id": "q-${chapterNumber}-38",
      "question_number": 38,
      "printedSerial": "38",
      "sourcePage": 45,
      "answerPage": 122,
      "type": "mcq / fill_blank / one_sentence / short_2m / short_3m / long_4m / match",
      "formatCategoryId": "mcq",
      "formatCategoryName": "೧. ಬಹು ಆಯ್ಕೆ (1M)",
      "question": "ನಿಖರವಾದ ಪ್ರಶ್ನೆ (x², 60° ಇತ್ಯಾದಿ ಪಠ್ಯಪುಸ್ತಕದಂತೆಯೇ)",
      "options": ["ಅ) ಆಯ್ಕೆ ೧", "ಆ) ಆಯ್ಕೆ ೨", "ಇ) ಆಯ್ಕೆ ೩", "ಈ) ಆಯ್ಕೆ ೪"],
      "items": [{"left": "1. ಎಡ", "right": "ಅ. ಬಲ"}],
      "marks": 1,
      "objective": "ಜ್ಞಾನ / ತಿಳುವಳಿಕೆ / ಅನ್ವಯ / ಕೌಶಲ",
      "difficulty": "ಸುಲಭ / ಸಾಧಾರಣ / ಕಠಿಣ",
      "learning_outcome": "LO 1",
      "answer": "PDF ನಲ್ಲಿರುವ ಸಂಪೂರ್ಣ ವಿವರವಾದ ಉತ್ತರ (ಪ್ರತಿ ಹಂತವನ್ನೂ ಪೂರ್ತಿಯಾಗಿ ಬರೆಯಿರಿ)",
      "hasDiagram": false,
      "diagramDescription": "ಚಿತ್ರದ ವಿವರಣೆ (ಚಿತ್ರ ಆಧಾರಿತ ಪ್ರಶ್ನೆಯಾಗಿದ್ದರೆ)"
    }
  ]
}
Do not output markdown codeblocks outside the JSON.`;

  const { text, modelUsed } = await generateWithFallback({
    contents: [
      {
        role: 'user',
        parts: [
          {
            inlineData: {
              mimeType: 'application/pdf',
              data: cleanBase64,
            },
          },
          {
            text: prompt,
          },
        ],
      },
    ],
    config: {
      responseMimeType: 'application/json',
    },
  });

  const parsed = parseGeminiJson(text);

  // Server-side safety pass: fix any caret superscripts/subscripts (x^2 -> x²) AND degree-symbol OCR errors (600 -> 60°)
  if (Array.isArray(parsed?.questions)) {
    parsed.questions = parsed.questions.map((q: any) =>
      sanitizeQuestionMathText(
        { ...q, chapterName: q.chapterName || chapterName },
        subjectHint
      )
    );
    parsed.extractedQuestionsCount = parsed.questions.length;
  }

  console.log(
    `[/api/ai/extract-chapter] Ch ${chapterNumber} ${chunkInfo || ''} complete via ${modelUsed}: ${parsed.questions?.length || 0} questions`
  );
  return { data: parsed, modelUsed };
}

async function runMatchMissingAnswersTask(body: any): Promise<{ answers: any[]; modelUsed: string }> {
  const {
    base64Pdf,
    chapterName,
    chapterNumber,
    missingQuestions,
    answerPageMap,
    metadata,
  } = body || {};

  if (!base64Pdf || !Array.isArray(missingQuestions) || missingQuestions.length === 0) {
    return { answers: [], modelUsed: 'none' };
  }

  const cleanBase64 = String(base64Pdf).replace(/^data:application\/pdf;base64,/, '');
  const subjectHint = [
    metadata?.subject || '',
    metadata?.subjectCode || '',
    metadata?.title || '',
    chapterName || '',
  ].join(' ');

  const questionsListText = missingQuestions
    .map(
      (mq: any, idx: number) =>
        `[${idx + 1}] id="${mq.id}" | PDF Q#${mq.printedSerial ?? mq.questionNumber ?? idx + 1} | (${mq.marks || 1}M) | ${String(mq.question || '').slice(0, 360)}${
          Array.isArray(mq.options) && mq.options.length > 0
            ? ` | Options: ${mq.options.join(' / ')}`
            : ''
        }`
    )
    .join('\n');

  const prompt = `You are a precision Karnataka DSERT LBA Answer Key Transcriber for Chapter ${chapterNumber}: "${chapterName}" (${subjectHint}).
The attached PDF contains the official Answer Key / Detailed Solutions pages for this chapter.
${answerPageMap ? `\nPHYSICAL PDF PAGE MAP OF ATTACHED ANSWER PAGES:\n${answerPageMap}\n` : ''}
Below is the list of questions whose answers were either missing OR overly summarized in the first pass.
Locate EVERY SINGLE question below in the attached Answer Key PDF and transcribe its COMPLETE, FULL, WORD-FOR-WORD explanation/proof/solution!

QUESTIONS NEEDING COMPLETE VERBATIM ANSWERS:
${questionsListText}

CRITICAL RULES:
1. ZERO SUMMARIZATION: NEVER write short 1-line summaries like "Proof: Using incidence and reflection laws." or "By theorem..." or "Refer diagram.". Copy EVERY SINGLE LINE, step, equation, Given/To Prove/Construction/Proof statement, formula, substitution, and final conclusion verbatim from the attached PDF! Separate steps cleanly with newlines (\\n).
2. Match carefully by the exact PDF question number (PDF Q#), topic, and wording.
3. For MCQs, include both the option letter and answer value (e.g., "B) 60°").
4. REAL SUPERSCRIPTS & DEGREE SYMBOLS: NEVER write x^2, cm^2, 10^-5, H_2O, or 600 for 60°! Always output authentic Unicode superscripts/subscripts & degree symbols (x², x³, cm², 10⁻⁵, H₂O, 60°, 90°, 180°, 360°, ∠, △, ∥, ⊥, ∴, ∵).
5. Include "answerPage" (original physical PDF page number from the map above) where each answer appears.
6. Only if an answer truly does not exist anywhere in the attached pages, omit it.

Return strictly JSON:
{
  "answers": [
    {
      "id": "exact question id from list above",
      "answer": "COMPLETE verbatim multi-line official answer from the PDF (never summarized)",
      "answerPage": 122
    }
  ]
}`;

  const { text, modelUsed } = await generateWithFallback({
    contents: [
      {
        role: 'user',
        parts: [
          {
            inlineData: {
              mimeType: 'application/pdf',
              data: cleanBase64,
            },
          },
          {
            text: prompt,
          },
        ],
      },
    ],
    config: {
      responseMimeType: 'application/json',
    },
  });

  const parsed = parseGeminiJson(text);
  const rawAnswers: any[] = Array.isArray(parsed?.answers) ? parsed.answers : [];
  const mqMap = new Map<string, any>();
  missingQuestions.forEach((mq: any) => mqMap.set(String(mq.id), mq));

  const cleanedAnswers = rawAnswers
    .filter(a => a && a.id && typeof a.answer === 'string' && a.answer.trim().length > 0)
    .map(a => {
      const refQ = mqMap.get(String(a.id));
      const contextStr = `${chapterName || ''} ${refQ?.question || ''} ${a.answer || ''}`;
      const sanitized = sanitizeQuestionMathText(
        {
          question: refQ?.question || '',
          options: refQ?.options,
          answer: a.answer,
          chapterName,
        },
        subjectHint
      );
      return {
        id: String(a.id),
        answer: fixDegreeSymbolOcrErrors(String(sanitized.answer || a.answer), /∠|angle|ಕೋನ|degree|ಡಿಗ್ರಿ/i.test(contextStr)),
        answerPage:
          typeof a.answerPage === 'number' && !isNaN(a.answerPage) && a.answerPage > 0
            ? Math.floor(a.answerPage)
            : undefined,
      };
    });

  console.log(
    `[/api/ai/match-missing-answers] Ch ${chapterNumber} matched ${cleanedAnswers.length}/${missingQuestions.length} missing/stub answers via ${modelUsed}`
  );
  return { answers: cleanedAnswers, modelUsed };
}

/**
 * API: Start Non-Blocking Async Chapter Extraction Job (avoids proxy 60s timeout)
 */
app.post('/api/ai/extract-chapter-job', (req, res) => {
  if (!req.body?.base64Pdf) {
    return res.status(400).json({ error: 'PDF data is required.' });
  }
  const job = createAiJob('extract-chapter');
  const payloadCopy = req.body;

  void (async () => {
    try {
      const result = await runExtractChapterTask(payloadCopy);
      if (job.status === 'cancelled') return;
      job.status = 'done';
      job.data = result.data;
      job.modelUsed = result.modelUsed;
      job.updatedAt = Date.now();
    } catch (error: any) {
      if (job.status === 'cancelled') return;
      console.error(`Async extract job ${job.id} failed:`, error?.message || error);
      job.status = 'error';
      job.error = error?.message || 'Failed to extract questions from chapter.';
      job.quotaExhausted = Boolean(error?.quotaExhausted || error?.status === 429);
      job.updatedAt = Date.now();
    }
  })();

  return res.status(202).json({
    success: true,
    jobId: job.id,
    status: job.status,
  });
});

/**
 * API: Start Non-Blocking Async Missing-Answer Matching Job (avoids proxy 60s timeout)
 */
app.post('/api/ai/match-missing-answers-job', (req, res) => {
  if (!req.body?.base64Pdf || !Array.isArray(req.body?.missingQuestions) || req.body.missingQuestions.length === 0) {
    return res.json({ success: true, immediate: true, answers: [] });
  }
  const job = createAiJob('match-missing-answers');
  const payloadCopy = req.body;

  void (async () => {
    try {
      const result = await runMatchMissingAnswersTask(payloadCopy);
      if (job.status === 'cancelled') return;
      job.status = 'done';
      job.answers = result.answers;
      job.modelUsed = result.modelUsed;
      job.updatedAt = Date.now();
    } catch (error: any) {
      if (job.status === 'cancelled') return;
      console.error(`Async answer-match job ${job.id} failed:`, error?.message || error);
      job.status = 'error';
      job.error = error?.message || 'Failed to match missing answers.';
      job.quotaExhausted = Boolean(error?.quotaExhausted || error?.status === 429);
      job.updatedAt = Date.now();
    }
  })();

  return res.status(202).json({
    success: true,
    jobId: job.id,
    status: job.status,
  });
});

/**
 * API: Poll status/result of an Async AI Extraction Job
 */
app.get('/api/ai/job/:jobId', (req, res) => {
  const job = aiJobs.get(req.params.jobId);
  if (!job) {
    return res.status(404).json({
      success: false,
      status: 'not_found',
      error: 'Extraction job expired or not found. Please retry.',
    });
  }
  return res.json({
    success: job.status === 'done',
    jobId: job.id,
    status: job.status,
    data: job.status === 'done' ? job.data : undefined,
    answers: job.status === 'done' ? job.answers : undefined,
    modelUsed: job.modelUsed,
    error: job.error,
    quotaExhausted: job.quotaExhausted,
    elapsedMs: Date.now() - job.createdAt,
  });
});

/**
 * API: Cancel a running Async AI Extraction Job
 */
app.post('/api/ai/job/:jobId/cancel', (req, res) => {
  const job = aiJobs.get(req.params.jobId);
  if (job && job.status === 'running') {
    job.status = 'cancelled';
    job.updatedAt = Date.now();
  }
  return res.json({ success: true });
});

/**
 * API: Extract Questions & Match Answers for a Chapter/Page Range (Synchronous fallback)
 */
app.post('/api/ai/extract-chapter', async (req, res) => {
  try {
    const result = await runExtractChapterTask(req.body);
    return res.json({ success: true, data: result.data, modelUsed: result.modelUsed });
  } catch (error: any) {
    const status = error?.status === 400 ? 400 : error?.status === 429 ? 429 : 500;
    console.error('Error extracting chapter:', error?.message || error);
    return res.status(status).json({
      error: error.message || 'Failed to extract questions from chapter.',
      quotaExhausted: Boolean(error?.quotaExhausted || status === 429),
    });
  }
});

/**
 * API: Match Missing or Summarized Answers for Already-Extracted Questions (Synchronous fallback)
 */
app.post('/api/ai/match-missing-answers', async (req, res) => {
  try {
    const result = await runMatchMissingAnswersTask(req.body);
    return res.json({ success: true, answers: result.answers, modelUsed: result.modelUsed });
  } catch (error: any) {
    const status = error?.status === 429 ? 429 : 500;
    console.error('Error matching missing answers:', error?.message || error);
    return res.status(status).json({
      error: error.message || 'Failed to match missing answers.',
      quotaExhausted: Boolean(error?.quotaExhausted || status === 429),
    });
  }
});

/**
 * API: Pull a Single Question's Complete Verbatim Detailed Answer directly from Selected PDF Page(s)
 * Designed for direct teacher editing when copy-pasting fractions/equations from PDF breaks layout.
 */
app.post('/api/ai/pull-single-answer', async (req, res) => {
  try {
    const body = req.body || {};
    const rawBase64 = typeof body.base64Pdf === 'string' ? body.base64Pdf.trim() : '';
    if (!rawBase64) {
      return res.status(400).json({ error: 'PDF ಪುಟದ ಡೇಟಾ ಅಗತ್ಯವಿದೆ (PDF page data is required).' });
    }

    const cleanBase64 = rawBase64.replace(/^data:application\/pdf;base64,/, '');
    const byteLength = Buffer.byteLength(cleanBase64, 'base64');
    if (byteLength === 0 || byteLength > 18 * 1024 * 1024) {
      return res.status(400).json({
        error: 'ಆಯ್ಕೆ ಮಾಡಿದ PDF ಪುಟಗಳ ಗಾತ್ರ ತುಂಬಾ ದೊಡ್ಡದಾಗಿದೆ (Max 18MB). ದಯವಿಟ್ಟು 1–3 ಪುಟಗಳನ್ನು ಮಾತ್ರ ಆಯ್ಕೆಮಾಡಿ.',
      });
    }

    const chapterNumber = String(body.chapterNumber ?? '').trim().slice(0, 20);
    const chapterName = String(body.chapterName ?? '').trim().slice(0, 200);
    const questionNumber = String(body.questionNumber ?? '').trim().slice(0, 20);
    const questionText = String(body.questionText ?? '').trim().slice(0, 1500);
    const marks = Number.isFinite(Number(body.marks)) ? Math.max(1, Math.min(20, Number(body.marks))) : 2;
    const subject = String(body.subject ?? 'Mathematics').trim().slice(0, 120);
    const medium = String(body.medium ?? '').trim().slice(0, 120);
    const pageRangeLabel = String(body.pageRangeLabel ?? '').trim().slice(0, 80);
    const physicalPages: number[] = Array.isArray(body.physicalPages)
      ? body.physicalPages
          .map((n: any) => parseInt(String(n), 10))
          .filter((n: number) => Number.isFinite(n) && n > 0)
          .slice(0, 5)
      : [];
    const pullQuestionToo = Boolean(body.pullQuestionToo);

    console.log(
      `[/api/ai/pull-single-answer] Ch ${chapterNumber || '?'} (${chapterName}) Q#${questionNumber || '?'} pages=${physicalPages.join(',') || pageRangeLabel} (${(byteLength / 1024).toFixed(1)} KB)`
    );

    const pagesNote =
      physicalPages.length > 0
        ? `The attached PDF contains physical page(s): ${physicalPages.join(', ')} (in that exact order).`
        : pageRangeLabel
          ? `The attached PDF slice is from: ${pageRangeLabel}.`
          : 'Inspect the attached PDF page(s) carefully.';

    const prompt = `You are a precision Mathematics & Science textbook OCR transcription engine for Karnataka DSERT LBA / State Syllabus books.
${pagesNote}

TARGET TO EXTRACT:
- Subject: ${subject}${medium ? ` (${medium})` : ''}
- Chapter: ${chapterNumber ? `Chapter ${chapterNumber}` : ''}${chapterName ? ` — ${chapterName}` : ''}
- Target Question Number: ${questionNumber ? `#${questionNumber}` : '(identify from the question text below)'}
- Marks: ${marks}
${questionText ? `- Reference Question Text (to verify you match the exact right answer):\n"""\n${questionText}\n"""` : ''}

STRICT TRANSCRIPTION RULES:
1. LOCATE THE EXACT ANSWER:
   - Scan the attached PDF page(s) and locate the answer / model solution / proof for Chapter ${chapterNumber || ''} Question No. ${questionNumber || '(matched by text)'}.
   - Cross-check against the Reference Question Text above so you NEVER pick the wrong question's answer.
   - If the answer spans onto the second attached page, combine ALL lines completely without truncating!

2. 100% VERBATIM & COMPLETE STEP-BY-STEP SOLUTION:
   - Transcribe EVERY SINGLE LINE of the printed solution/proof word-for-word: Given (ದತ್ತ), To Prove (ಸಾಧನೀಯ), Construction (ರಚನೆ), Proof/Steps (ಸಾಧನೆ/ಹಂತಗಳು), formulas, substitutions, intermediate calculations, and final answer.
   - NEVER summarize or shorten! NEVER write "Proof: Using..." when full steps are printed.
   - Put each step / equation on its own newline (\\n).
   - Keep the EXACT language/script printed in the PDF (Kannada / English / Hindi).

3. CRITICAL FRACTION & MATHEMATICAL FORMATTING (MOST IMPORTANT!):
   - Write EVERY mathematical fraction strictly using LaTeX \\frac{numerator}{denominator} syntax!
     Examples:
     * \\frac{1}{2}, \\frac{22}{7}, \\frac{4}{3}, \\frac{3}{4}
     * \\frac{1}{2}(\\angle Q - \\angle R)
     * \\frac{x^2 + 1}{2}
     * \\frac{AB}{DE} = \\frac{BC}{EF}
     * Mixed fractions: 2\\frac{1}{3}
   - NEVER break a fraction across two lines (never put numerator on one line and denominator on the next line). Keep \\frac{numerator}{denominator} inline inside the equation!
   - Write powers/exponents cleanly using ^ (e.g., x^2, r^2, cm^2, a^3, 10^-5, (a+b)^2).
   - Write degrees strictly using ° (e.g., 60°, 90°, 180°, 360°, x° — NEVER misread ° as trailing 0 like 600!).
   - Use authentic math symbols: ∠, ∥, ⊥, △, ≅, ∼, √, π, ×, ÷, ±, ≤, ≥, ≠, ∴, ∵, ⇒.
   - Do NOT wrap equations in $...$ or markdown backticks.

4. ${pullQuestionToo ? 'ALSO TRANSCRIBE THE QUESTION: Populate "question" with the complete verbatim question text (and "options" if MCQ) using the same \\frac{numerator}{denominator} formatting.' : 'Focus primarily on "answer". Leave "question" empty string unless needed.'}

5. IF NOT FOUND ON ATTACHED PAGE(S):
   - Set "found": false, "answer": "", and in "notes" clearly list which chapter/question numbers ARE visible on the attached page(s) so the teacher knows whether to try an earlier or later page number.`;

    const { text, modelUsed } = await generateWithFallback({
      contents: [
        {
          role: 'user',
          parts: [
            {
              inlineData: {
                mimeType: 'application/pdf',
                data: cleanBase64,
              },
            },
            { text: prompt },
          ],
        },
      ],
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            found: { type: Type.BOOLEAN },
            matchedQuestionNumber: { type: Type.STRING },
            answer: { type: Type.STRING },
            question: { type: Type.STRING },
            options: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
            },
            pageFound: { type: Type.INTEGER },
            notes: { type: Type.STRING },
          },
          required: ['found', 'answer'],
        },
      },
    });

    const parsed = parseGeminiJson(text);
    const found = Boolean(parsed?.found && typeof parsed?.answer === 'string' && parsed.answer.trim().length > 0);
    const subjectHint = `${subject} ${chapterName}`;
    const contextStr = `${chapterName} ${questionText} ${parsed?.answer || ''}`;
    const hasAngleCtx = /∠|angle|ಕೋನ|degree|ಡಿಗ್ರಿ/i.test(contextStr);

    let finalAnswer = typeof parsed?.answer === 'string' ? parsed.answer.trim() : '';
    let finalQuestion = typeof parsed?.question === 'string' ? parsed.question.trim() : '';
    let finalOptions: string[] | undefined = Array.isArray(parsed?.options)
      ? parsed.options.map((o: any) => String(o || '').trim()).filter(Boolean)
      : undefined;

    if (finalAnswer || finalQuestion) {
      const sanitized = sanitizeQuestionMathText(
        {
          question: finalQuestion || questionText,
          answer: finalAnswer,
          options: finalOptions,
          chapterName,
        },
        subjectHint
      );
      if (finalAnswer) {
        finalAnswer = fixDegreeSymbolOcrErrors(String(sanitized.answer || finalAnswer), hasAngleCtx);
      }
      if (finalQuestion) {
        finalQuestion = fixDegreeSymbolOcrErrors(String(sanitized.question || finalQuestion), hasAngleCtx);
      }
      if (finalOptions && Array.isArray(sanitized.options)) {
        finalOptions = sanitized.options;
      }
    }

    let resolvedPageFound: number | undefined = undefined;
    if (typeof parsed?.pageFound === 'number' && Number.isFinite(parsed.pageFound) && parsed.pageFound > 0) {
      // If Gemini returned relative index (1..physicalPages.length) instead of physical page, map it safely
      if (
        physicalPages.length > 0 &&
        !physicalPages.includes(parsed.pageFound) &&
        parsed.pageFound <= physicalPages.length
      ) {
        resolvedPageFound = physicalPages[parsed.pageFound - 1];
      } else {
        resolvedPageFound = Math.floor(parsed.pageFound);
      }
    } else if (physicalPages.length > 0 && found) {
      resolvedPageFound = physicalPages[0];
    }

    return res.json({
      success: true,
      found,
      matchedQuestionNumber: String(parsed?.matchedQuestionNumber || questionNumber || '').trim(),
      answer: finalAnswer,
      question: pullQuestionToo ? finalQuestion : '',
      options: pullQuestionToo && finalOptions && finalOptions.length > 0 ? finalOptions : undefined,
      pageFound: resolvedPageFound,
      notes: typeof parsed?.notes === 'string' ? parsed.notes.trim() : '',
      modelUsed,
    });
  } catch (error: any) {
    const status = error?.status === 400 ? 400 : error?.status === 429 ? 429 : 500;
    console.error('[/api/ai/pull-single-answer] Error:', error?.message || error);
    return res.status(status).json({
      error: error?.message || 'PDF ಪುಟದಿಂದ ಉತ್ತರ ಎಳೆದುಕೊಳ್ಳುವಲ್ಲಿ ದೋಷ ಸಂಭವಿಸಿದೆ.',
      quotaExhausted: Boolean(error?.quotaExhausted || status === 429),
    });
  }
});

/**
 * API: Save Generated Question Bank JSON to Server
 * Writes to public/assets/user_banks and registers in index so it can be loaded into Question Paper Generator!
 */
// Static file serving for user banks and public assets
app.use('/assets/user_banks', express.static(userBanksDir));
app.use('/assets', express.static(path.join(__dirname, 'public', 'assets')));

/**
 * Dynamically scans user_banks directory on disk, parses JSON files,
 * deduces proper Grade and Subject codes, and synchronizes index.json.
 * This guarantees that ANY question bank JSON file placed on disk or uploaded
 * is permanently indexed and immediately available in the UI dropdowns.
 */
function extractServerGradeKey(raw: string): string {
  const kannadaDigits = ['೦', '೧', '೨', '೩', '೪', '೫', '೬', '೭', '೮', '೯'];
  const devanagariDigits = ['०', '१', '२', '३', '४', '५', '६', '७', '८', '९'];
  let s = String(raw || '');
  kannadaDigits.forEach((kd, idx) => {
    s = s.replaceAll(kd, String(idx));
  });
  devanagariDigits.forEach((dd, idx) => {
    s = s.replaceAll(dd, String(idx));
  });
  const m = s.match(/(\d+)/);
  if (m) return m[1];
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
  return '7';
}

function deduceServerSubjectCode(rawCode: string | undefined, rawSubject: string): string {
  const combined = `${rawCode || ''} ${rawSubject || ''}`.trim().toLowerCase();
  const token = String(rawCode || '').trim().toLowerCase().split(/[-_\s/()]+/)[0];
  if (token === 'soc' || token === 'ss' || token === 'sst' || combined.includes('ಸಮಾಜ') || combined.includes('ಸಾಮಾಜಿಕ') || combined.includes('social')) return 'SOC';
  if (token === 'sci' || combined.includes('ವಿಜ್ಞಾನ') || combined.includes('science')) return 'SCI';
  if (token === 'math' || token === 'maths' || token === 'mat' || combined.includes('ಗಣಿತ') || combined.includes('math')) return 'MATH';
  if (token === 'kan' || combined.includes('ಕನ್ನಡ') || combined.includes('kannada')) return 'KAN';
  if (token === 'eng' || combined.includes('ಇಂಗ್ಲಿಷ್') || combined.includes('english')) return 'ENG';
  if (token === 'hin' || combined.includes('ಹಿಂದಿ') || combined.includes('hindi') || combined.includes('हिंदी') || combined.includes('हिन्दी')) return 'HIN';
  if (token === 'san' || token === 'sans' || combined.includes('ಸಂಸ್ಕೃತ') || combined.includes('sanskrit') || combined.includes('संस्कृत')) return 'SAN';
  if (token === 'urd' || combined.includes('ಉರ್ದು') || combined.includes('urdu')) return 'URD';
  if (token === 'mar' || combined.includes('ಮರಾಠಿ') || combined.includes('marathi')) return 'MAR';
  if (token === 'tam' || combined.includes('ತಮಿಳು') || combined.includes('tamil')) return 'TAM';
  if (token === 'tel' || combined.includes('ತೆಲುಗು') || combined.includes('telugu')) return 'TEL';
  if (token === 'comp' || token === 'cs' || combined.includes('ಕಂಪ್ಯೂಟರ್') || combined.includes('computer')) return 'COMP';
  if (token === 'pe' || combined.includes('ದೈಹಿಕ') || combined.includes('physical education')) return 'PE';
  return rawCode ? String(rawCode).trim().toUpperCase() : 'GEN';
}

function syncUserBanks(): { files: any[] } {
  if (!fs.existsSync(userBanksDir)) {
    fs.mkdirSync(userBanksDir, { recursive: true });
  }
  const diskFiles = fs.readdirSync(userBanksDir).filter(f => f.endsWith('.json') && f !== 'index.json');
  const entries: any[] = [];

  for (const filename of diskFiles) {
    try {
      const fullPath = path.join(userBanksDir, filename);
      const raw = fs.readFileSync(fullPath, 'utf8');
      const content = JSON.parse(raw);
      if (content && content.chapters && Array.isArray(content.chapters)) {
        const meta = content.metadata || {};
        const rawGrade = String(meta.gradeKey || meta.grade || meta.class || filename || '');
        const gradeKey = extractServerGradeKey(rawGrade);
        const grade = meta.grade || `${gradeKey} ನೇ ತರಗತಿ (Class ${gradeKey})`;
        const subject = meta.subject || filename.replace('.json', '');
        const subjectCode = deduceServerSubjectCode(meta.subjectCode, subject);

        const id = meta.id || `bank_${filename.replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9_]/g, '_')}`;
        entries.push({
          id,
          path: `/assets/user_banks/${encodeURI(filename)}`,
          filename,
          grade,
          gradeKey,
          subject,
          subjectCode,
          medium: meta.medium || 'ಕನ್ನಡ ಮಾಧ್ಯಮ (State Syllabus)',
          academicYear: meta.academicYear || '2026-27',
          totalChapters: content.chapters.length,
          totalQuestions: content.chapters.reduce(
            (sum: number, c: any) => sum + (c.questions?.length || 0),
            0
          ),
          isUserGenerated: true,
          createdAt: meta.updatedAt || meta.createdAt || new Date().toISOString(),
        });
      }
    } catch (e: any) {
      console.error(`Error indexing user bank ${filename}:`, e.message);
    }
  }

  // Sort: newest first or alphabetical
  entries.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));

  const result = { files: entries };
  try {
    fs.writeFileSync(userBanksIndexPath, JSON.stringify(result, null, 2), 'utf8');
  } catch (e: any) {
    console.error('Error updating index.json:', e.message);
  }
  return result;
}

// Initial sync on server start
syncUserBanks();

/**
 * API: Save Generated Question Bank JSON to Server
 * Writes to public/assets/user_banks and registers in index so it can be loaded into Question Paper Generator!
 */
app.post('/api/save-question-bank', (req, res) => {
  try {
    const { questionBank } = req.body;

    if (!questionBank || !questionBank.metadata || !questionBank.chapters) {
      return res.status(400).json({ error: 'Invalid question bank JSON schema.' });
    }

    const grade = questionBank.metadata.grade || '7ನೇ ತರಗತಿ';
    const subject = questionBank.metadata.subject || 'ವಿಷಯ';
    const safeSub = subject.replace(/[^a-zA-Z0-9_\u0C80-\u0CFF\u0900-\u097F]/g, '_').slice(0, 30);
    const id = questionBank.metadata.id || `bank_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const nowIso = new Date().toISOString();
    const enrichedBank = {
      ...questionBank,
      metadata: {
        ...questionBank.metadata,
        id,
        createdAt: questionBank.metadata.createdAt || nowIso,
        updatedAt: nowIso,
      },
    };
    // If a file for this exact bank ID already exists on disk, overwrite it in-place (avoid duplicates)
    let filename = `${safeSub}_${id}.json`;
    try {
      const existingIndex = syncUserBanks();
      const existingMatch = existingIndex.files.find(f => f.id === id && f.filename);
      if (existingMatch && existingMatch.filename) {
        filename = existingMatch.filename;
      }
    } catch {
      // use generated filename
    }
    const filePath = path.join(userBanksDir, filename);

    // Save JSON file
    fs.writeFileSync(filePath, JSON.stringify(enrichedBank, null, 2), 'utf8');

    // Run dynamic sync across disk files to update index.json
    const indexData = syncUserBanks();
    const createdEntry = indexData.files.find(f => f.filename === filename) || {
      id,
      path: `/assets/user_banks/${encodeURI(filename)}`,
      filename,
      grade,
      subject,
    };

    return res.json({
      success: true,
      message: 'Question bank saved permanently and indexed!',
      entry: createdEntry,
      downloadUrl: `/assets/user_banks/${encodeURI(filename)}`,
    });
  } catch (error: any) {
    console.error('Error saving question bank:', error);
    return res.status(500).json({ error: error.message || 'Failed to save question bank.' });
  }
});

/**
 * API: List User-Saved Question Banks
 */
app.get('/api/saved-question-banks', (req, res) => {
  try {
    const data = syncUserBanks();
    return res.json(data);
  } catch (error: any) {
    return res.json({ files: [] });
  }
});

/**
 * API: Permanently Delete a Saved/Duplicate Question Bank JSON file from server disk
 */
app.delete('/api/saved-question-bank/:bankId', (req, res) => {
  try {
    const { bankId } = req.params;
    const rawFilename = typeof req.query.filename === 'string' ? req.query.filename : '';
    const decodedId = decodeURIComponent(bankId || '').trim();
    const decodedFilename = rawFilename ? path.basename(decodeURIComponent(rawFilename).trim()) : '';

    if (!decodedId && !decodedFilename) {
      return res.status(400).json({ error: 'Bank ID or filename is required.' });
    }

    const indexData = syncUserBanks();
    const matched = indexData.files.find(
      f =>
        (decodedId && (f.id === decodedId || f.filename === decodedId)) ||
        (decodedFilename && f.filename === decodedFilename)
    );

    const targetFilename = matched?.filename || (decodedFilename.endsWith('.json') ? decodedFilename : '');
    let deletedFilename: string | null = null;

    if (targetFilename) {
      const safeName = path.basename(targetFilename);
      const resolvedPath = path.resolve(userBanksDir, safeName);
      const resolvedDir = path.resolve(userBanksDir);
      if (!resolvedPath.startsWith(resolvedDir + path.sep) || !safeName.endsWith('.json') || safeName === 'index.json') {
        return res.status(400).json({ error: 'Invalid question bank filename.' });
      }
      if (fs.existsSync(resolvedPath)) {
        fs.unlinkSync(resolvedPath);
        deletedFilename = safeName;
      }
    }

    const updatedIndex = syncUserBanks();
    return res.json({
      success: true,
      deleted: Boolean(deletedFilename),
      deletedFilename,
      remainingCount: updatedIndex.files.length,
    });
  } catch (error: any) {
    console.error('Error deleting question bank:', error);
    return res.status(500).json({ error: error.message || 'Failed to delete question bank.' });
  }
});

/**
 * Helper: Load Firebase applet config for read-through image serving from Firestore `question_images`
 */
let cachedFirebaseConfig: {
  projectId?: string;
  firestoreDatabaseId?: string;
  apiKey?: string;
} | null = null;
function getFirebaseAppletConfig() {
  if (cachedFirebaseConfig) return cachedFirebaseConfig;
  try {
    const cfgPath = path.join(__dirname, 'firebase-applet-config.json');
    if (fs.existsSync(cfgPath)) {
      cachedFirebaseConfig = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    }
  } catch (e) {
    console.warn('Could not read firebase-applet-config.json:', e);
  }
  return cachedFirebaseConfig || {};
}

const MIME_TO_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
};

const EXT_TO_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  svg: 'image/svg+xml',
};

/**
 * API: Cache / Store Uploaded Question or Answer Image locally alongside Firebase storage.
 * When `imageId` is provided (saved in Firebase `question_images/{imageId}`), caches under
 * `public/assets/question_images/{imageId}.{ext}` and returns `/api/question-image/{imageId}`.
 */
app.post('/api/upload-question-image', (req, res) => {
  try {
    const {
      imageId,
      imageBase64,
      gradeKey,
      subjectCode,
      chapterId,
      questionId,
      role,
    } = req.body || {};

    if (!imageBase64 || typeof imageBase64 !== 'string') {
      return res.status(400).json({ error: 'ಚಿತ್ರದ ಡೇಟಾ ಅಗತ್ಯವಿದೆ (Image data is required).' });
    }

    const match = imageBase64.match(/^data:(image\/(?:png|jpeg|jpg|webp|svg\+xml));base64,(.+)$/i);
    if (!match) {
      return res.status(400).json({
        error: 'ಅಮಾನ್ಯ ಚಿತ್ರದ ಮಾದರಿ. ಕೇವಲ PNG, JPG, WebP ಅಥವಾ SVG ಫೈಲ್‌ಗಳನ್ನು ಬೆಂಬಲಿಸಲಾಗುತ್ತದೆ.',
      });
    }

    const mimeType = match[1].toLowerCase();
    const rawBase64 = match[2];
    const buffer = Buffer.from(rawBase64, 'base64');

    if (buffer.length > 5 * 1024 * 1024) {
      return res.status(413).json({
        error: 'ಚಿತ್ರದ ಗಾತ್ರ 5 MB ಗಿಂತ ಹೆಚ್ಚಿದೆ. ದಯವಿಟ್ಟು ಚಿಕ್ಕ ಚಿತ್ರವನ್ನು ಬಳಸಿ.',
      });
    }

    const ext = MIME_TO_EXT[mimeType] || 'webp';

    if (imageId && typeof imageId === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(imageId)) {
      const fullPath = path.join(questionImagesDir, `${imageId}.${ext}`);
      fs.writeFileSync(fullPath, buffer);
      return res.json({
        success: true,
        imageId,
        imageUrl: `/api/question-image/${imageId}`,
        sizeKB: +(buffer.length / 1024).toFixed(1),
        mimeType,
      });
    }

    const cleanGrade = String(gradeKey || 'general').replace(/[^a-zA-Z0-9]/g, '').slice(0, 12) || 'general';
    const gradeFolder = /^\d+$/.test(cleanGrade) ? `class${cleanGrade}` : cleanGrade.toLowerCase();
    const cleanSubject = String(subjectCode || 'gen').replace(/[^a-zA-Z0-9]/g, '').toLowerCase().slice(0, 16) || 'gen';
    const cleanChapter = String(chapterId || 'ch').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 24) || 'ch';
    const cleanQuestion = String(questionId || 'q').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 28) || 'q';
    const cleanRole = role === 'answer' ? 'ans' : 'q';

    const targetDir = path.join(questionImagesDir, gradeFolder, cleanSubject);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    const filename = `${cleanChapter}_${cleanQuestion}_${cleanRole}_${Date.now()}.${ext}`;
    const fullPath = path.join(targetDir, filename);
    fs.writeFileSync(fullPath, buffer);

    const imageUrl = `/assets/question_images/${gradeFolder}/${cleanSubject}/${filename}`;
    return res.json({
      success: true,
      imageUrl,
      sizeKB: +(buffer.length / 1024).toFixed(1),
      mimeType,
    });
  } catch (error: any) {
    console.error('Error uploading question image:', error);
    return res.status(500).json({
      error: error.message || 'ಚಿತ್ರವನ್ನು ಉಳಿಸುವಲ್ಲಿ ದೋಷ ಸಂಭವಿಸಿದೆ.',
    });
  }
});

/**
 * API: Serve a Question/Answer Image by Firebase imageId.
 * Checks local disk cache first; on miss (e.g. fresh server restart), fetches directly
 * from Firebase Firestore `question_images/{imageId}`, caches locally, and streams binary image bytes.
 */
app.get('/api/question-image/:imageId', async (req, res) => {
  try {
    const { imageId } = req.params;
    if (!imageId || !/^[a-zA-Z0-9_-]{1,128}$/.test(imageId)) {
      return res.status(400).json({ error: 'Invalid image ID' });
    }

    // 1. Check local disk cache across supported extensions
    for (const ext of ['webp', 'png', 'jpg', 'svg']) {
      const candidate = path.join(questionImagesDir, `${imageId}.${ext}`);
      if (fs.existsSync(candidate)) {
        res.setHeader('Content-Type', EXT_TO_MIME[ext] || 'image/webp');
        res.setHeader('Cache-Control', 'public, max-age=31536000');
        return res.sendFile(candidate);
      }
    }

    // 2. Fallback read-through from Firebase Firestore REST API
    const fb = getFirebaseAppletConfig();
    if (!fb.projectId) {
      return res.status(404).json({ error: 'Image not found' });
    }
    const dbId = fb.firestoreDatabaseId || '(default)';
    const keyQuery = fb.apiKey ? `?key=${encodeURIComponent(fb.apiKey)}` : '';
    const firestoreUrl = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
      fb.projectId
    )}/databases/${encodeURIComponent(dbId)}/documents/question_images/${encodeURIComponent(
      imageId
    )}${keyQuery}`;

    const fbRes = await fetch(firestoreUrl);
    if (!fbRes.ok) {
      return res.status(404).json({ error: 'Image not found in Firebase' });
    }
    const docJson: any = await fbRes.json();
    const dataUrl: string | undefined = docJson?.fields?.dataUrl?.stringValue;
    if (!dataUrl) {
      return res.status(404).json({ error: 'Image data missing in Firebase' });
    }

    const match = dataUrl.match(/^data:(image\/(?:png|jpeg|jpg|webp|svg\+xml));base64,(.+)$/i);
    if (!match) {
      return res.status(500).json({ error: 'Corrupt image payload' });
    }

    const mimeType = match[1].toLowerCase();
    const ext = MIME_TO_EXT[mimeType] || 'webp';
    const buffer = Buffer.from(match[2], 'base64');

    // Cache locally for fast subsequent reads
    try {
      fs.writeFileSync(path.join(questionImagesDir, `${imageId}.${ext}`), buffer);
    } catch {
      // ignore cache write failure
    }

    res.setHeader('Content-Type', mimeType);
    res.setHeader('Cache-Control', 'public, max-age=31536000');
    return res.send(buffer);
  } catch (error: any) {
    console.error('Error serving question image:', error);
    return res.status(500).json({ error: 'Failed to serve question image' });
  }
});

/**
 * API: Delete cached Question/Answer Image from disk
 */
app.delete('/api/question-image/:imageId', (req, res) => {
  try {
    const { imageId } = req.params;
    if (!imageId || !/^[a-zA-Z0-9_-]{1,128}$/.test(imageId)) {
      return res.status(400).json({ error: 'Invalid image ID' });
    }
    for (const ext of ['webp', 'png', 'jpg', 'svg']) {
      const candidate = path.join(questionImagesDir, `${imageId}.${ext}`);
      if (fs.existsSync(candidate)) {
        fs.unlinkSync(candidate);
      }
    }
    return res.json({ success: true });
  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'Failed to delete image' });
  }
});

/**
 * Helper: Read & sync permanently stored PDFs metadata index on disk
 */
function readUploadedPdfsIndex(): Array<{
  id: string;
  fileName: string;
  fileSizeMB: string;
  totalPages: number;
  grade?: string;
  subject?: string;
  pdfUrl: string;
  uploadedAt: string;
}> {
  let existing: any[] = [];
  try {
    if (fs.existsSync(uploadedPdfsIndexPath)) {
      const parsed = JSON.parse(fs.readFileSync(uploadedPdfsIndexPath, 'utf8'));
      if (Array.isArray(parsed?.files)) existing = parsed.files;
    }
  } catch {
    existing = [];
  }

  const byId = new Map<string, any>();
  for (const item of existing) {
    if (item?.id && fs.existsSync(path.join(uploadedPdfsDir, `${item.id}.pdf`))) {
      byId.set(item.id, item);
    }
  }

  // Also discover any .pdf files directly on disk that aren't in index.json yet
  try {
    const diskPdfs = fs.readdirSync(uploadedPdfsDir).filter(f => f.endsWith('.pdf'));
    for (const file of diskPdfs) {
      const id = file.replace(/\.pdf$/i, '');
      if (!byId.has(id)) {
        const stat = fs.statSync(path.join(uploadedPdfsDir, file));
        byId.set(id, {
          id,
          fileName: file,
          fileSizeMB: (stat.size / (1024 * 1024)).toFixed(2),
          totalPages: 0,
          pdfUrl: `/api/uploaded-pdf/${id}`,
          uploadedAt: stat.mtime.toISOString(),
        });
      }
    }
  } catch {
    // ignore
  }

  const list = Array.from(byId.values()).sort((a, b) =>
    String(b.uploadedAt || '').localeCompare(String(a.uploadedAt || ''))
  );
  try {
    fs.writeFileSync(uploadedPdfsIndexPath, JSON.stringify({ files: list }, null, 2), 'utf8');
  } catch {
    // ignore
  }
  return list;
}

/**
 * API: Permanently Upload & Store a PDF file on server disk (raw binary application/pdf)
 */
app.post(
  '/api/upload-pdf',
  express.raw({ type: ['application/pdf', 'application/octet-stream'], limit: '80mb' }),
  (req, res) => {
    try {
      const rawBody = req.body;
      if (!Buffer.isBuffer(rawBody) || rawBody.length === 0) {
        return res.status(400).json({ error: 'PDF binary data is required.' });
      }

      const rawId = String(req.headers['x-pdf-id'] || `pdf_${Date.now()}`).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 110);
      const pdfId = rawId || `pdf_${Date.now()}`;
      const fileName = decodeURIComponent(String(req.headers['x-file-name'] || `${pdfId}.pdf`));
      const totalPages = parseInt(String(req.headers['x-total-pages'] || '0'), 10) || 0;
      const grade = req.headers['x-grade'] ? decodeURIComponent(String(req.headers['x-grade'])) : undefined;
      const subject = req.headers['x-subject'] ? decodeURIComponent(String(req.headers['x-subject'])) : undefined;

      const fullPath = path.join(uploadedPdfsDir, `${pdfId}.pdf`);
      fs.writeFileSync(fullPath, rawBody);

      const fileSizeMB = (rawBody.length / (1024 * 1024)).toFixed(2);
      const entry = {
        id: pdfId,
        fileName,
        fileSizeMB,
        totalPages,
        grade,
        subject,
        pdfUrl: `/api/uploaded-pdf/${pdfId}`,
        uploadedAt: new Date().toISOString(),
      };

      const existing = readUploadedPdfsIndex().filter(f => f.id !== pdfId);
      const updated = [entry, ...existing];
      fs.writeFileSync(uploadedPdfsIndexPath, JSON.stringify({ files: updated }, null, 2), 'utf8');

      return res.json({
        success: true,
        id: pdfId,
        pdfUrl: entry.pdfUrl,
        fileSizeMB,
        entry,
      });
    } catch (error: any) {
      console.error('Error uploading PDF:', error);
      return res.status(500).json({ error: error.message || 'Failed to save PDF.' });
    }
  }
);

/**
 * API: List all permanently stored PDF files on server disk
 */
app.get('/api/uploaded-pdfs', (req, res) => {
  try {
    const files = readUploadedPdfsIndex();
    return res.json({ files });
  } catch (error: any) {
    return res.json({ files: [] });
  }
});

/**
 * API: Stream a permanently stored PDF file by ID
 */
app.get('/api/uploaded-pdf/:pdfId', (req, res) => {
  try {
    const { pdfId } = req.params;
    if (!pdfId || !/^[a-zA-Z0-9_-]{1,128}$/.test(pdfId)) {
      return res.status(400).json({ error: 'Invalid PDF ID' });
    }
    const fullPath = path.join(uploadedPdfsDir, `${pdfId}.pdf`);
    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({ error: 'PDF file not found on server' });
    }
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.sendFile(fullPath);
  } catch (error: any) {
    console.error('Error streaming PDF:', error);
    return res.status(500).json({ error: 'Failed to load PDF' });
  }
});

/**
 * API: Delete a permanently stored PDF file from server disk
 */
app.delete('/api/uploaded-pdf/:pdfId', (req, res) => {
  try {
    const { pdfId } = req.params;
    if (!pdfId || !/^[a-zA-Z0-9_-]{1,128}$/.test(pdfId)) {
      return res.status(400).json({ error: 'Invalid PDF ID' });
    }
    const fullPath = path.join(uploadedPdfsDir, `${pdfId}.pdf`);
    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
    }
    const remaining = readUploadedPdfsIndex().filter(f => f.id !== pdfId);
    fs.writeFileSync(uploadedPdfsIndexPath, JSON.stringify({ files: remaining }, null, 2), 'utf8');
    return res.json({ success: true });
  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'Failed to delete PDF' });
  }
});

/**
 * Helper: Escape HTML special characters to prevent HTML injection in emailed reports
 */
function escapeEmailHtml(input: unknown): string {
  return String(input ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getEmailDeliveryProvider(): { configured: boolean; provider: 'resend' | 'smtp' | 'none' } {
  if (process.env.RESEND_API_KEY && process.env.RESEND_API_KEY.trim().length > 5) {
    return { configured: true, provider: 'resend' };
  }
  const smtpUser = (process.env.SMTP_USER || '').trim();
  const smtpPass = (process.env.SMTP_PASS || '').trim();
  if (smtpUser && smtpPass) {
    return { configured: true, provider: 'smtp' };
  }
  return { configured: false, provider: 'none' };
}

/**
 * API: Check whether automated email delivery (SMTP or Resend) is configured
 */
app.get('/api/online-test/email-status', (req, res) => {
  return res.json(getEmailDeliveryProvider());
});

/**
 * API: Send Online Test Result & Solved Questions/Answers Copy to Student's Email ID
 */
app.post('/api/online-test/send-report', async (req, res) => {
  try {
    const body = req.body || {};
    const studentName = String(body.studentName || '').trim().slice(0, 120);
    const studentEmail = String(body.studentEmail || '').trim().toLowerCase().slice(0, 160);
    const schoolName = String(body.schoolName || 'Karnataka State Syllabus Online Test').trim().slice(0, 160);
    const grade = String(body.grade || '').trim().slice(0, 80);
    const subject = String(body.subject || '').trim().slice(0, 80);
    const chapters: string[] = Array.isArray(body.chapters)
      ? body.chapters.map((c: unknown) => String(c || '').trim().slice(0, 120)).filter(Boolean).slice(0, 40)
      : [];
    const totalQuestions = Math.min(100, Math.max(1, Number(body.totalQuestions) || 1));
    const score = Math.min(totalQuestions, Math.max(0, Number(body.score) || 0));
    const correctCount = Math.min(totalQuestions, Math.max(0, Number(body.correctCount ?? score) || 0));
    const wrongCount = Math.min(totalQuestions, Math.max(0, Number(body.wrongCount) || 0));
    const unansweredCount = Math.min(totalQuestions, Math.max(0, Number(body.unansweredCount) || 0));
    const percentage = Math.min(100, Math.max(0, Number(body.percentage) || Math.round((score / totalQuestions) * 100)));
    const timeTakenSeconds = Math.max(0, Math.min(86400, Number(body.timeTakenSeconds) || 0));

    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    if (!studentName || !emailRegex.test(studentEmail)) {
      return res.status(400).json({
        ok: false,
        emailSent: false,
        error: 'ದಯವಿಟ್ಟು ಮಾನ್ಯವಾದ ವಿದ್ಯಾರ್ಥಿ ಹೆಸರು ಮತ್ತು ಇಮೇಲ್ ವಿಳಾಸವನ್ನು ನಮೂದಿಸಿ.',
      });
    }

    interface SanitizedReportItem {
      number: number;
      chapterName: string;
      question: string;
      selectedOption: string;
      correctOption: string;
      isCorrect: boolean;
      isUnanswered: boolean;
      explanation: string;
    }

    const rawItems: unknown[] = Array.isArray(body.items) ? body.items.slice(0, 100) : [];
    const sanitizedItems: SanitizedReportItem[] = rawItems.map((rawItem: unknown, idx: number) => {
      const item = (rawItem && typeof rawItem === 'object' ? rawItem : {}) as Record<string, unknown>;
      return {
        number: idx + 1,
        chapterName: String(item.chapterName || '').trim().slice(0, 140),
        question: String(item.question || '').trim().slice(0, 1200),
        selectedOption: String(item.selectedOption || '').trim().slice(0, 400),
        correctOption: String(item.correctOption || '').trim().slice(0, 400),
        isCorrect: Boolean(item.isCorrect),
        isUnanswered: Boolean(item.isUnanswered),
        explanation: String(item.explanation || '').trim().slice(0, 1200),
      };
    });

    const providerStatus = getEmailDeliveryProvider();
    if (!providerStatus.configured) {
      return res.json({
        ok: true,
        emailSent: false,
        reason: 'not_configured',
        provider: 'none',
        message:
          'ಸ್ವಯಂಚಾಲಿತ ಇಮೇಲ್ ಕಳುಹಿಸಲು SMTP_USER / SMTP_PASS ಅಥವಾ RESEND_API_KEY ಸೆಟ್ಟಿಂಗ್ಸ್ (Secrets) ನಲ್ಲಿ ಸೇರಿಸಬೇಕು. ಅಲ್ಲಿಯವರೆಗೆ ಕೆಳಗಿನ "ಇಮೇಲ್ ಆ್ಯಪ್‌ನಲ್ಲಿ ಕಳುಹಿಸಿ" ಅಥವಾ "PDF ಮುದ್ರಿಸಿ" ಆಯ್ಕೆಯನ್ನು ಬಳಸಿ.',
      });
    }

    const mins = Math.floor(timeTakenSeconds / 60);
    const secs = timeTakenSeconds % 60;
    const formattedDuration = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    const submittedDateStr = new Date().toLocaleString('en-IN', {
      dateStyle: 'medium',
      timeStyle: 'short',
    });

    const emailSubject = `ಆನ್‌ಲೈನ್ ಪರೀಕ್ಷಾ ಫಲಿತಾಂಶ (${score}/${totalQuestions} - ${percentage}%) | ${subject} - ${grade}`;

    const rowsHtml = sanitizedItems
      .map(item => {
        const statusBadge = item.isCorrect
          ? `<span style="display:inline-block;padding:2px 8px;border-radius:4px;background:#ecfdf5;color:#047857;font-weight:700;font-size:12px;">✓ ಸರಿ (Correct)</span>`
          : item.isUnanswered
            ? `<span style="display:inline-block;padding:2px 8px;border-radius:4px;background:#f1f5f9;color:#475569;font-weight:700;font-size:12px;">— ಉತ್ತರಿಸಿಲ್ಲ (Unanswered)</span>`
            : `<span style="display:inline-block;padding:2px 8px;border-radius:4px;background:#fef2f2;color:#b91c1c;font-weight:700;font-size:12px;">✕ ತಪ್ಪು (Wrong)</span>`;

        const explanationBlock = item.explanation
          ? `<div style="margin-top:6px;padding:8px 10px;background:#f8fafc;border-radius:6px;font-size:13px;color:#334155;"><strong>ವಿವರಣೆ (Explanation):</strong> ${escapeEmailHtml(item.explanation).replace(/\n/g, '<br/>')}</div>`
          : '';

        return `
          <div style="margin-bottom:14px;padding:14px;border:1px solid #e2e8f0;border-radius:10px;background:#ffffff;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;gap:8px;">
              <span style="font-size:12px;color:#64748b;font-weight:600;">ಪ್ರಶ್ನೆ ${item.number}${item.chapterName ? ` · ${escapeEmailHtml(item.chapterName)}` : ''}</span>
              ${statusBadge}
            </div>
            <div style="font-size:15px;font-weight:600;color:#0f172a;margin-bottom:10px;line-height:1.5;">
              ${escapeEmailHtml(item.question).replace(/\n/g, '<br/>')}
            </div>
            <div style="font-size:13px;line-height:1.6;color:#334155;">
              <div><strong>ನಿಮ್ಮ ಉತ್ತರ (Your Answer):</strong> <span style="color:${item.isCorrect ? '#047857' : item.isUnanswered ? '#64748b' : '#b91c1c'};font-weight:600;">${escapeEmailHtml(item.selectedOption || 'ಉತ್ತರಿಸಿಲ್ಲ')}</span></div>
              <div><strong>ಸರಿಯಾದ ಉತ್ತರ (Correct Answer):</strong> <span style="color:#047857;font-weight:700;">${escapeEmailHtml(item.correctOption)}</span></div>
            </div>
            ${explanationBlock}
          </div>
        `;
      })
      .join('\n');

    const htmlBody = `
      <!DOCTYPE html>
      <html lang="kn">
      <head><meta charset="utf-8" /></head>
      <body style="margin:0;padding:20px;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Noto Sans Kannada',sans-serif;color:#0f172a;">
        <div style="max-width:680px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:14px;overflow:hidden;">
          <div style="background:#181c3d;color:#ffffff;padding:22px 24px;">
            <div style="font-size:12px;letter-spacing:0.06em;text-transform:uppercase;color:#a5b4fc;font-weight:700;">${escapeEmailHtml(schoolName)}</div>
            <h1 style="margin:6px 0 4px;font-size:20px;font-weight:800;">ಆನ್‌ಲೈನ್ ಪರೀಕ್ಷಾ ಫಲಿತಾಂಶ ಮತ್ತು ಉತ್ತರ ಪತ್ರಿಕೆ</h1>
            <div style="font-size:13px;color:#cbd5e1;">${escapeEmailHtml(grade)} · ${escapeEmailHtml(subject)} · ${escapeEmailHtml(submittedDateStr)}</div>
          </div>

          <div style="padding:20px 24px;">
            <div style="margin-bottom:16px;font-size:14px;color:#334155;">
              <strong>ವಿದ್ಯಾರ್ಥಿ:</strong> ${escapeEmailHtml(studentName)} (${escapeEmailHtml(studentEmail)})<br/>
              ${chapters.length > 0 ? `<strong>ಪಾಠಗಳು:</strong> ${escapeEmailHtml(chapters.join(', '))}` : ''}
            </div>

            <table role="presentation" style="width:100%;border-collapse:collapse;margin-bottom:20px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;">
              <tr>
                <td style="padding:12px;text-align:center;border-right:1px solid #e2e8f0;">
                  <div style="font-size:11px;color:#64748b;font-weight:700;">ಅಂಕಗಳು (Score)</div>
                  <div style="font-size:22px;font-weight:800;color:#1e293b;">${score} / ${totalQuestions}</div>
                </td>
                <td style="padding:12px;text-align:center;border-right:1px solid #e2e8f0;">
                  <div style="font-size:11px;color:#64748b;font-weight:700;">ಶೇಕಡಾವಾರು</div>
                  <div style="font-size:22px;font-weight:800;color:#4f46e5;">${percentage}%</div>
                </td>
                <td style="padding:12px;text-align:center;border-right:1px solid #e2e8f0;">
                  <div style="font-size:11px;color:#64748b;font-weight:700;">ಸರಿ / ತಪ್ಪು / ಬಾಕಿ</div>
                  <div style="font-size:15px;font-weight:700;color:#0f172a;">${correctCount} / ${wrongCount} / ${unansweredCount}</div>
                </td>
                <td style="padding:12px;text-align:center;">
                  <div style="font-size:11px;color:#64748b;font-weight:700;">ಸಮಯ (Time)</div>
                  <div style="font-size:16px;font-weight:700;color:#0f172a;">${formattedDuration}</div>
                </td>
              </tr>
            </table>

            <h2 style="font-size:16px;font-weight:800;color:#0f172a;margin:0 0 12px;">ಬಿಡಿಸಿದ ಪ್ರಶ್ನೆಗಳು ಮತ್ತು ಉತ್ತರಗಳು (Solved Q&amp;A Copy)</h2>
            ${rowsHtml}
          </div>

          <div style="padding:14px 24px;background:#f8fafc;border-top:1px solid #e2e8f0;font-size:12px;color:#64748b;text-align:center;">
            ${escapeEmailHtml(schoolName)} · ಸ್ವಯಂಚಾಲಿತ ಆನ್‌ಲೈನ್ ಪರೀಕ್ಷಾ ವರದಿ
          </div>
        </div>
      </body>
      </html>
    `;

    const plainTextLines = [
      `${schoolName}`,
      `ಆನ್‌ಲೈನ್ ಪರೀಕ್ಷಾ ಫಲಿತಾಂಶ ಮತ್ತು ಉತ್ತರ ಪತ್ರಿಕೆ`,
      `ವಿದ್ಯಾರ್ಥಿ: ${studentName} (${studentEmail})`,
      `ತರಗತಿ / ವಿಷಯ: ${grade} - ${subject}`,
      chapters.length > 0 ? `ಪಾಠಗಳು: ${chapters.join(', ')}` : '',
      `ಅಂಕಗಳು: ${score} / ${totalQuestions} (${percentage}%) | ಸರಿ: ${correctCount}, ತಪ್ಪು: ${wrongCount}, ಉತ್ತರಿಸಿಲ್ಲ: ${unansweredCount} | ಸಮಯ: ${formattedDuration}`,
      '',
      '--- ಬಿಡಿಸಿದ ಪ್ರಶ್ನೆಗಳು ಮತ್ತು ಉತ್ತರಗಳು ---',
      ...sanitizedItems.map(item => {
        const status = item.isCorrect ? 'ಸರಿ' : item.isUnanswered ? 'ಉತ್ತರಿಸಿಲ್ಲ' : 'ತಪ್ಪು';
        return [
          `Q${item.number}. ${item.question}`,
          `   ನಿಮ್ಮ ಉತ್ತರ: ${item.selectedOption || 'ಉತ್ತರಿಸಿಲ್ಲ'} (${status})`,
          `   ಸರಿಯಾದ ಉತ್ತರ: ${item.correctOption}`,
          item.explanation ? `   ವಿವರಣೆ: ${item.explanation}` : '',
        ]
          .filter(Boolean)
          .join('\n');
      }),
    ].filter(Boolean);
    const textBody = plainTextLines.join('\n');

    if (providerStatus.provider === 'resend') {
      const apiKey = process.env.RESEND_API_KEY!.trim();
      const fromAddress = (process.env.SMTP_FROM || 'Online Test <onboarding@resend.dev>').trim();
      const resendResp = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: fromAddress,
          to: [studentEmail],
          subject: emailSubject,
          html: htmlBody,
          text: textBody,
        }),
      });
      if (!resendResp.ok) {
        const errText = await resendResp.text();
        console.error('Resend API delivery error:', errText);
        return res.status(502).json({
          ok: false,
          emailSent: false,
          provider: 'resend',
          error: 'ಇಮೇಲ್ ಕಳುಹಿಸಲು ಸಾಧ್ಯವಾಗಲಿಲ್ಲ. ದಯವಿಟ್ಟು RESEND_API_KEY / SMTP_FROM ಪರಿಶೀಲಿಸಿ.',
        });
      }
      return res.json({
        ok: true,
        emailSent: true,
        provider: 'resend',
        message: `ನಿಮ್ಮ ಇಮೇಲ್ (${studentEmail}) ಗೆ ಫಲಿತಾಂಶ ಮತ್ತು ಉತ್ತರ ಪತ್ರಿಕೆಯ ಪ್ರತಿ ಯಶಸ್ವಿಯಾಗಿ ಕಳುಹಿಸಲಾಗಿದೆ.`,
      });
    }

    // Nodemailer SMTP transport
    const smtpHost = (process.env.SMTP_HOST || 'smtp.gmail.com').trim();
    const smtpPort = Number(process.env.SMTP_PORT) || 587;
    const smtpUser = (process.env.SMTP_USER || '').trim();
    const smtpPass = (process.env.SMTP_PASS || '').trim();
    const fromAddress = (process.env.SMTP_FROM || `${schoolName} <${smtpUser}>`).trim();

    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpPort === 465,
      auth: {
        user: smtpUser,
        pass: smtpPass,
      },
    });

    await transporter.sendMail({
      from: fromAddress,
      to: studentEmail,
      subject: emailSubject,
      text: textBody,
      html: htmlBody,
    });

    return res.json({
      ok: true,
      emailSent: true,
      provider: 'smtp',
      message: `ನಿಮ್ಮ ಇಮೇಲ್ (${studentEmail}) ಗೆ ಫಲಿತಾಂಶ ಮತ್ತು ಉತ್ತರ ಪತ್ರಿಕೆಯ ಪ್ರತಿ ಯಶಸ್ವಿಯಾಗಿ ಕಳುಹಿಸಲಾಗಿದೆ.`,
    });
  } catch (error: any) {
    console.error('Error sending online test report email:', error?.message || error);
    return res.status(500).json({
      ok: false,
      emailSent: false,
      error: 'ಇಮೇಲ್ ಕಳುಹಿಸುವಾಗ ದೋಷ ಸಂಭವಿಸಿದೆ. ದಯವಿಟ್ಟು SMTP ವಿವರಗಳನ್ನು ಪರಿಶೀಲಿಸಿ ಅಥವಾ ಕೆಳಗಿನ ಮುದ್ರಣ/ಇಮೇಲ್ ಆಯ್ಕೆ ಬಳಸಿ.',
    });
  }
});

// Guarantee all /api/* 404s and errors return JSON (never fall through to Vite HTML)
app.use('/api', (req, res) => {
  res.status(404).json({ error: `API endpoint not found: ${req.originalUrl}` });
});

app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (req.path.startsWith('/api')) {
    console.error(`[API Error] ${req.method} ${req.path}:`, err?.message || err);
    const status = err?.status || err?.statusCode || 500;
    return res.status(status).json({
      error: err?.message || 'Internal server error processing API request.',
    });
  }
  next(err);
});

// Setup Vite Dev Middleware in Dev, or Static Hosting in Prod
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const { createServer } = await import('vite');
    const vite = await createServer({
      server: {
        middlewareMode: true,
        host: '0.0.0.0',
        port: PORT,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, 'dist')));
    app.get('*', (req, res) => {
      res.sendFile(path.join(__dirname, 'dist', 'index.html'));
    });
  }

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running at http://0.0.0.0:${PORT}`);
  });
  server.requestTimeout = 300000;
  server.headersTimeout = 305000;
  server.keepAliveTimeout = 65000;
}

startServer().catch(err => {
  console.error('Failed to start server:', err);
});
