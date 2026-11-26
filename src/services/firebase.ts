/**
 * Firebase Client Service
 * Initializes Firebase App and Firestore using firebase-applet-config.json
 * Provides cloud persistence for Question Banks and Question Papers
 */

import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  User,
} from 'firebase/auth';
import {
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  doc,
  setDoc,
  getDoc,
  getDocs,
  collection,
  deleteDoc,
  getDocFromServer,
  query,
  orderBy,
  where,
  limit,
  Firestore,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import { QuestionBank, GeneratedPaper } from '../types/questionBank.ts';

// Initialize Firebase App singleton
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
export const auth = getAuth(app);

// Initialize Firestore forcing HTTP long-polling in browser environments so buffering proxies,
// antivirus software, mobile carriers, and iframe fetch wrappers cannot stall WebChannel streams
// for 10 seconds ("Could not reach Cloud Firestore backend"). Also enables IndexedDB local cache.
function createResilientFirestore(): Firestore {
  const dbId = firebaseConfig.firestoreDatabaseId || undefined;
  const isBrowser = typeof window !== 'undefined';

  if (isBrowser) {
    try {
      return initializeFirestore(
        app,
        {
          experimentalForceLongPolling: true,
          experimentalLongPollingOptions: { timeoutSeconds: 20 },
          ignoreUndefinedProperties: true,
          localCache: persistentLocalCache({
            tabManager: persistentMultipleTabManager(),
          }),
        },
        dbId
      );
    } catch {
      try {
        // Retry without persistentLocalCache if IndexedDB is blocked in strict iframe/private mode
        return initializeFirestore(
          app,
          {
            experimentalForceLongPolling: true,
            experimentalLongPollingOptions: { timeoutSeconds: 20 },
            ignoreUndefinedProperties: true,
          },
          dbId
        );
      } catch {
        // Fallback if Firestore instance was already initialized in this module context
        return dbId ? getFirestore(app, dbId) : getFirestore(app);
      }
    }
  }

  try {
    return initializeFirestore(app, { ignoreUndefinedProperties: true }, dbId);
  } catch {
    return dbId ? getFirestore(app, dbId) : getFirestore(app);
  }
}

export const db: Firestore = createResilientFirestore();

// Test connection on boot
export async function testFirestoreConnection(): Promise<boolean> {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
    console.log('Firebase Firestore connection verified successfully.');
    return true;
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.warn('Firebase client is offline. Check network or configuration.');
    } else {
      console.log('Firebase connection initialized:', (error as Error).message);
    }
    return false;
  }
}

// Automatically test connection
testFirestoreConnection();

/**
 * Extract numeric grade key from Kannada/Devanagari/English/Roman grade strings
 */
export function extractGradeKeyFirebase(gradeStr: string | undefined | null): string {
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
 * Deduce standardized subject code inspecting BOTH subjectCode and subject name.
 * Handles prefixed codes (KAN-L1, ENG-SL, HIN-L3, MAT, SS, SCI-9) and Kannada variants (ಸಾಮಾಜಿಕ ವಿಜ್ಞಾನ).
 */
export function deduceSubjectCodeFirebase(
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
  if (codeToken === 'urd' || combined.includes('ಉರ್ದು') || combined.includes('urdu')) {
    return 'URD';
  }
  if (codeToken === 'mar' || combined.includes('ಮರಾಠಿ') || combined.includes('marathi')) {
    return 'MAR';
  }
  if (codeToken === 'tam' || combined.includes('ತಮಿಳು') || combined.includes('tamil')) {
    return 'TAM';
  }
  if (codeToken === 'tel' || combined.includes('ತೆಲುಗು') || combined.includes('telugu')) {
    return 'TEL';
  }
  if (codeToken === 'comp' || codeToken === 'cs' || combined.includes('ಕಂಪ್ಯೂಟರ್') || combined.includes('computer')) {
    return 'COMP';
  }
  if (codeToken === 'pe' || combined.includes('ದೈಹಿಕ') || combined.includes('physical education')) {
    return 'PE';
  }
  return 'GEN';
}

/**
 * Recursively strips all `undefined` values from objects/arrays because Firestore
 * rejects `undefined` anywhere inside a `setDoc()` payload.
 */
function stripUndefinedDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    return value
      .filter(item => item !== undefined)
      .map(item => stripUndefinedDeep(item)) as unknown as T;
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v !== undefined) {
        out[k] = stripUndefinedDeep(v);
      }
    }
    return out as T;
  }
  return value;
}

function utf8ByteLength(obj: unknown): number {
  try {
    const json = JSON.stringify(obj);
    return typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(json).length : json.length * 2;
  } catch {
    return 0;
  }
}

const FIRESTORE_SINGLE_DOC_SAFE_BYTES = 720_000;
const FIRESTORE_CHUNK_TARGET_BYTES = 480_000;

/**
 * Save a Question Bank to Firebase Firestore.
 * Automatically sanitizes `undefined` fields and splits large banks (> 720 KB, e.g. 9th STD 33-chapter LBA books)
 * into `question_banks/{bankId}/chapter_chunks/chunk_{i}` so they never hit Firestore's 1 MiB document limit.
 */
export async function saveQuestionBankToFirebase(bank: QuestionBank): Promise<string> {
  const rawBankId =
    typeof bank.metadata.id === 'string' && bank.metadata.id.trim()
      ? bank.metadata.id.trim()
      : `bank_${Date.now()}`;
  const bankId: string =
    rawBankId.replace(/[^a-zA-Z0-9_-]/g, '_').replace(/_+/g, '_').slice(0, 120) || `bank_${Date.now()}`;
  const docRef = doc(db, 'question_banks', bankId);

  const safeGrade = String(bank.metadata.grade || '7 ನೇ ತರಗತಿ (Class 7)');
  const safeGradeKey = extractGradeKeyFirebase(
    bank.metadata.gradeKey ? String(bank.metadata.gradeKey) : safeGrade
  );
  const safeSubject = String(bank.metadata.subject || 'ವಿಷಯ');
  const subjectCode = deduceSubjectCodeFirebase(
    bank.metadata.subjectCode ? String(bank.metadata.subjectCode) : undefined,
    safeSubject
  );
  const safeMedium = String(bank.metadata.medium || 'ಕನ್ನಡ ಮಾಧ್ಯಮ (State Syllabus)');
  const safeTitle = String(bank.metadata.title || `${safeGrade} ${safeSubject}`);
  const safeYear = String(bank.metadata.academicYear || '2026-27');
  const nowIso = new Date().toISOString();

  const cleanMeta = stripUndefinedDeep({
    ...bank.metadata,
    id: bankId,
    title: safeTitle,
    grade: safeGrade,
    gradeKey: safeGradeKey,
    subject: safeSubject,
    subjectCode,
    medium: safeMedium,
    academicYear: safeYear,
    updatedAt: nowIso,
    createdAt: String((bank.metadata as any).createdAt || nowIso),
  });

  const cleanChapters = stripUndefinedDeep(Array.isArray(bank.chapters) ? bank.chapters : []);
  const totalQuestions = cleanChapters.reduce((sum, ch) => sum + (ch.questions?.length || 0), 0);

  const basePayload = {
    id: bankId,
    title: safeTitle,
    grade: safeGrade,
    gradeKey: safeGradeKey,
    subject: safeSubject,
    subjectCode,
    medium: safeMedium,
    academicYear: safeYear,
    totalChapters: cleanChapters.length,
    totalQuestions,
    metadata: cleanMeta,
    createdAt: String((bank.metadata as any).createdAt || nowIso),
    updatedAt: nowIso,
  };

  const singleDocPayload = {
    ...basePayload,
    isChunked: false,
    chunkCount: 0,
    chapters: cleanChapters,
  };

  if (utf8ByteLength(singleDocPayload) <= FIRESTORE_SINGLE_DOC_SAFE_BYTES) {
    await setDoc(docRef, singleDocPayload);
    return bankId;
  }

  // Large Question Bank (> 720 KB): split chapters into size-bounded subcollection chunks
  const chunks: Array<typeof cleanChapters> = [];
  let currentChunk: typeof cleanChapters = [];
  let currentBytes = 0;

  for (const ch of cleanChapters) {
    const chBytes = utf8ByteLength(ch);
    if (currentChunk.length > 0 && currentBytes + chBytes > FIRESTORE_CHUNK_TARGET_BYTES) {
      chunks.push(currentChunk);
      currentChunk = [];
      currentBytes = 0;
    }
    // If an individual chapter itself is > 450 KB, split its questions into bounded sub-chunks
    if (chBytes > 450_000 && Array.isArray(ch.questions) && ch.questions.length > 1) {
      if (currentChunk.length > 0) {
        chunks.push(currentChunk);
        currentChunk = [];
        currentBytes = 0;
      }
      let qBatch: typeof ch.questions = [];
      let qBatchBytes = 0;
      for (const q of ch.questions) {
        const qBytes = utf8ByteLength(q);
        if (qBatch.length > 0 && qBatchBytes + qBytes > 320_000) {
          chunks.push([{ ...ch, questions: qBatch }]);
          qBatch = [];
          qBatchBytes = 0;
        }
        qBatch.push(q);
        qBatchBytes += qBytes;
      }
      if (qBatch.length > 0) {
        chunks.push([{ ...ch, questions: qBatch }]);
      }
    } else {
      currentChunk.push(ch);
      currentBytes += chBytes;
    }
  }
  if (currentChunk.length > 0) {
    chunks.push(currentChunk);
  }

  // Write parent document first (metadata + chunk manifest)
  await setDoc(docRef, {
    ...basePayload,
    isChunked: true,
    chunkCount: chunks.length,
    chapters: [],
  });

  // Write each chunk to question_banks/{bankId}/chapter_chunks/chunk_{idx}
  const chunksColRef = collection(db, 'question_banks', bankId, 'chapter_chunks');
  await Promise.all(
    chunks.map((chunkChapters, idx) =>
      setDoc(doc(chunksColRef, `chunk_${idx}`), {
        chunkIndex: idx,
        chapters: chunkChapters,
        updatedAt: nowIso,
      })
    )
  );

  // Clean up any leftover chunks from an earlier larger save
  try {
    const existingChunks = await getDocs(chunksColRef);
    const staleDeletes: Promise<void>[] = [];
    existingChunks.forEach(cd => {
      const cIdx = Number(cd.data()?.chunkIndex);
      if (!Number.isFinite(cIdx) || cIdx >= chunks.length) {
        staleDeletes.push(deleteDoc(cd.ref));
      }
    });
    if (staleDeletes.length > 0) {
      await Promise.allSettled(staleDeletes);
    }
  } catch {
    // Non-fatal cleanup
  }

  return bankId;
}

let inFlightQuestionBanksPromise: Promise<QuestionBank[]> | null = null;

/**
 * Fetch all Question Banks saved in Firebase Firestore (supporting both inline and chunked large banks).
 * Deduplicates simultaneous startup calls and bounds subcollection concurrency so Firestore's
 * long-polling channel is never saturated on slow/mobile connections.
 */
export async function getQuestionBanksFromFirebase(): Promise<QuestionBank[]> {
  if (inFlightQuestionBanksPromise) {
    return inFlightQuestionBanksPromise;
  }

  const runFetch = async (): Promise<QuestionBank[]> => {
    try {
      const colRef = collection(db, 'question_banks');
      const snapshot = await getDocs(colRef);
      const rawDocs = snapshot.docs;

      const results: Array<QuestionBank | null> = new Array(rawDocs.length).fill(null);
      const CONCURRENCY = 3;
      let cursor = 0;

      const worker = async () => {
        while (cursor < rawDocs.length) {
          const idx = cursor++;
          const d = rawDocs[idx];
          const data = d.data();
          if (!data) continue;

          let chapters = Array.isArray(data.chapters) ? data.chapters : [];
          if (data.isChunked && Number(data.chunkCount) > 0) {
            try {
              const chunksSnap = await getDocs(collection(db, 'question_banks', d.id, 'chapter_chunks'));
              const chunkRecords: Array<{ idx: number; chapters: any[] }> = [];
              chunksSnap.forEach(cd => {
                const cData = cd.data();
                if (Array.isArray(cData?.chapters)) {
                  chunkRecords.push({
                    idx: Number(cData.chunkIndex) || 0,
                    chapters: cData.chapters,
                  });
                }
              });
              chunkRecords.sort((a, b) => a.idx - b.idx);
              const mergedMap = new Map<string, any>();
              const orderedIds: string[] = [];
              for (const rec of chunkRecords) {
                for (const ch of rec.chapters) {
                  const key = String(ch.chapterId || ch.chapterName || orderedIds.length);
                  if (mergedMap.has(key)) {
                    const prev = mergedMap.get(key);
                    mergedMap.set(key, {
                      ...prev,
                      questions: [...(prev.questions || []), ...(ch.questions || [])],
                    });
                  } else {
                    orderedIds.push(key);
                    mergedMap.set(key, ch);
                  }
                }
              }
              chapters = orderedIds.map(id => mergedMap.get(id));
            } catch (chunkErr) {
              console.warn(`Could not load chapter_chunks for ${d.id}:`, chunkErr);
            }
          }

          if (!chapters || chapters.length === 0) continue;

          const rawMeta = (data.metadata || {}) as Record<string, unknown>;
          const docId = String(d.id || data.id || rawMeta.id || '');
          const rawGrade = String(rawMeta.grade || data.grade || '7 ನೇ ತರಗತಿ (Class 7)');
          const gradeKey = extractGradeKeyFirebase(
            String(rawMeta.gradeKey || data.gradeKey || rawGrade)
          );
          const rawSubject = String(rawMeta.subject || data.subject || 'ವಿಷಯ');
          const subjectCode = deduceSubjectCodeFirebase(
            String(rawMeta.subjectCode || data.subjectCode || ''),
            rawSubject
          );

          results[idx] = {
            metadata: {
              ...rawMeta,
              title: String(rawMeta.title || data.title || `${rawGrade} ${rawSubject}`.trim()),
              grade: rawGrade,
              gradeKey,
              subject: rawSubject,
              subjectCode,
              medium: String(rawMeta.medium || data.medium || 'ಕನ್ನಡ ಮಾಧ್ಯಮ (State Syllabus)'),
              academicYear: String(rawMeta.academicYear || data.academicYear || '2026-27'),
              totalChapters: chapters.length,
              totalQuestions: chapters.reduce(
                (sum: number, ch: any) => sum + (ch.questions?.length || 0),
                0
              ),
              id: docId,
              updatedAt: String(rawMeta.updatedAt || data.updatedAt || data.createdAt || ''),
              createdAt: String(rawMeta.createdAt || data.createdAt || ''),
            },
            chapters,
          };
        }
      };

      await Promise.all(
        Array.from({ length: Math.min(CONCURRENCY, Math.max(1, rawDocs.length)) }, () => worker())
      );

      return results.filter((b): b is QuestionBank => b !== null);
    } catch (err) {
      console.error('Error fetching question banks from Firebase:', err);
      return [];
    }
  };

  inFlightQuestionBanksPromise = runFetch().finally(() => {
    inFlightQuestionBanksPromise = null;
  });
  return inFlightQuestionBanksPromise;
}

/**
 * Delete a Saved / Duplicate Question Bank from Firebase Firestore (`question_banks/{bankId}` + any `chapter_chunks`)
 */
export async function deleteQuestionBankFromFirebase(bankId: string): Promise<void> {
  if (!bankId || typeof bankId !== 'string' || bankId.trim().length === 0) return;
  const cleanId = bankId.trim();
  const docPath = `question_banks/${cleanId}`;
  try {
    // Delete any subcollection chapter_chunks first
    try {
      const chunksSnap = await getDocs(collection(db, 'question_banks', cleanId, 'chapter_chunks'));
      if (!chunksSnap.empty) {
        await Promise.allSettled(chunksSnap.docs.map(cd => deleteDoc(cd.ref)));
      }
    } catch {
      // Ignore if no chunks exist
    }
    await deleteDoc(doc(db, 'question_banks', cleanId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, docPath);
  }
}

/**
 * Save a Generated Question Paper to Firebase Firestore
 */
export async function saveQuestionPaperToFirebase(paper: GeneratedPaper): Promise<string> {
  const paperId = paper.id || `paper_${Date.now()}`;
  const docRef = doc(db, 'question_papers', paperId);

  const payload = {
    id: paperId,
    schoolName: paper.header.schoolName,
    examName: paper.header.examName,
    grade: paper.header.grade,
    subject: paper.header.subject,
    academicYear: paper.header.academicYear,
    totalMarks: paper.totalMarks,
    totalQuestions: paper.totalQuestions,
    header: paper.header,
    sections: paper.sections,
    createdAt: paper.createdAt || new Date().toISOString(),
  };

  await setDoc(docRef, payload);
  return paperId;
}

/**
 * Fetch all saved Question Papers from Firebase Firestore
 */
export async function getQuestionPapersFromFirebase(): Promise<GeneratedPaper[]> {
  try {
    const colRef = collection(db, 'question_papers');
    const snapshot = await getDocs(query(colRef, orderBy('createdAt', 'desc')));
    const papers: GeneratedPaper[] = [];

    snapshot.forEach(d => {
      const data = d.data() as GeneratedPaper;
      papers.push(data);
    });

    return papers;
  } catch (err) {
    console.error('Error fetching question papers from Firebase:', err);
    return [];
  }
}

/**
 * Delete a Question Paper from Firebase Firestore
 */
export async function deleteQuestionPaperFromFirebase(paperId: string): Promise<void> {
  const docRef = doc(db, 'question_papers', paperId);
  await deleteDoc(docRef);
}

export interface UploadedPdfRecord {
  id: string;
  fileName: string;
  fileSizeMB: string;
  totalPages: number;
  grade?: string;
  gradeKey?: string;
  subject?: string;
  subjectCode?: string;
  serverPdfUrl?: string;
  linkedBankId?: string;
  detectedDoc?: any;
  uploadedAt: string;
}

/**
 * Save or merge an uploaded PDF record to Firebase Firestore
 */
export async function saveUploadedPdfToFirebase(record: UploadedPdfRecord): Promise<string> {
  const pdfId = record.id || `pdf_${Date.now()}`;
  const docRef = doc(db, 'uploaded_pdfs', pdfId);
  const cleanPayload: Record<string, unknown> = {
    id: pdfId,
    fileName: record.fileName,
    fileSizeMB: record.fileSizeMB || '0',
    totalPages: Number(record.totalPages) || 0,
    uploadedAt: record.uploadedAt || new Date().toISOString(),
  };
  if (record.grade !== undefined) cleanPayload.grade = record.grade;
  if (record.gradeKey !== undefined) cleanPayload.gradeKey = record.gradeKey;
  if (record.subject !== undefined) cleanPayload.subject = record.subject;
  if (record.subjectCode !== undefined) cleanPayload.subjectCode = record.subjectCode;
  if (record.serverPdfUrl !== undefined) cleanPayload.serverPdfUrl = record.serverPdfUrl;
  if (record.linkedBankId !== undefined) cleanPayload.linkedBankId = record.linkedBankId;
  if (record.detectedDoc !== undefined) cleanPayload.detectedDoc = record.detectedDoc;

  await setDoc(docRef, cleanPayload, { merge: true });
  return pdfId;
}

/**
 * Fetch all saved Uploaded PDF records from Firebase Firestore
 */
export async function getUploadedPdfsFromFirebase(): Promise<UploadedPdfRecord[]> {
  try {
    const colRef = collection(db, 'uploaded_pdfs');
    const snapshot = await getDocs(query(colRef, orderBy('uploadedAt', 'desc')));
    const list: UploadedPdfRecord[] = [];
    snapshot.forEach(d => {
      const data = d.data() as UploadedPdfRecord;
      if (data && data.fileName) {
        list.push({ ...data, id: data.id || d.id });
      }
    });
    return list;
  } catch (err) {
    console.error('Error fetching uploaded PDFs from Firebase:', err);
    return [];
  }
}

/**
 * Delete an Uploaded PDF record from Firebase Firestore
 */
export async function deleteUploadedPdfFromFirebase(pdfId: string): Promise<void> {
  if (!pdfId || !/^[a-zA-Z0-9_-]+$/.test(pdfId)) return;
  try {
    await deleteDoc(doc(db, 'uploaded_pdfs', pdfId));
  } catch (err) {
    console.warn(`Could not delete uploaded_pdfs/${pdfId}:`, err);
  }
}

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map(provider => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error:', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export interface QuestionImageRecord {
  id: string;
  dataUrl: string;
  mimeType: string;
  sizeKB: number;
  width?: number;
  height?: number;
  gradeKey?: string;
  subjectCode?: string;
  chapterId?: string;
  questionId?: string;
  role: 'question' | 'answer';
  createdAt: string;
}

/**
 * Extracts Firebase question_images document ID from a question image URL
 * e.g. "/api/question-image/img_7_sci_ch1_q1_q_123456" -> "img_7_sci_ch1_q1_q_123456"
 */
export function extractImageIdFromUrl(url: string | undefined | null): string | null {
  if (!url) return null;
  const match = String(url).match(/\/api\/question-image\/([a-zA-Z0-9_-]+)/);
  return match ? match[1] : null;
}

/**
 * Save a compressed Question or Answer Diagram image to Firebase Firestore (`question_images/{imageId}`).
 * Only the resulting short URL `/api/question-image/{imageId}` is stored inside the Question Bank JSON.
 */
export async function saveQuestionImageToFirebase(params: {
  dataUrl: string;
  mimeType: string;
  sizeKB: number;
  width?: number;
  height?: number;
  gradeKey?: string;
  subjectCode?: string;
  chapterId?: string;
  questionId?: string;
  role: 'question' | 'answer';
}): Promise<{ imageId: string; imageUrl: string; sizeKB: number }> {
  const cleanGrade = String(params.gradeKey || 'g').replace(/[^a-zA-Z0-9]/g, '').slice(0, 8) || 'g';
  const cleanSub = String(params.subjectCode || 'gen').replace(/[^a-zA-Z0-9]/g, '').toLowerCase().slice(0, 10) || 'gen';
  const cleanCh = String(params.chapterId || 'ch').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 16) || 'ch';
  const cleanQ = String(params.questionId || 'q').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 20) || 'q';
  const roleTag = params.role === 'answer' ? 'ans' : 'q';
  const rand = Math.random().toString(36).slice(2, 6);
  const imageId = `img_${cleanGrade}_${cleanSub}_${cleanCh}_${cleanQ}_${roleTag}_${Date.now()}_${rand}`.slice(0, 120);

  if (params.dataUrl.length > 345000) {
    throw new Error('ಚಿತ್ರದ ಗಾತ್ರ ತುಂಬಾ ದೊಡ್ಡದಾಗಿದೆ (250 KB ಗಿಂತ ಕಡಿಮೆ ಇರಬೇಕು). ದಯವಿಟ್ಟು ಕಡಿಮೆ KB ಗಾತ್ರ ಆಯ್ಕೆಮಾಡಿ.');
  }

  const record: QuestionImageRecord = {
    id: imageId,
    dataUrl: params.dataUrl,
    mimeType: params.mimeType,
    sizeKB: params.sizeKB,
    width: params.width,
    height: params.height,
    gradeKey: cleanGrade,
    subjectCode: cleanSub,
    chapterId: cleanCh,
    questionId: cleanQ,
    role: params.role,
    createdAt: new Date().toISOString(),
  };

  const docPath = `question_images/${imageId}`;
  try {
    await setDoc(doc(db, 'question_images', imageId), record);
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, docPath);
  }

  return {
    imageId,
    imageUrl: `/api/question-image/${imageId}`,
    sizeKB: params.sizeKB,
  };
}

/**
 * Fetch a single stored Question Image record from Firebase Firestore
 */
export async function getQuestionImageFromFirebase(imageId: string): Promise<QuestionImageRecord | null> {
  const docPath = `question_images/${imageId}`;
  try {
    const snap = await getDoc(doc(db, 'question_images', imageId));
    if (!snap.exists()) return null;
    return snap.data() as QuestionImageRecord;
  } catch (error) {
    console.warn(`Could not fetch ${docPath}:`, error);
    return null;
  }
}

/**
 * Delete a stored Question Image from Firebase Firestore
 */
export async function deleteQuestionImageFromFirebase(imageId: string): Promise<void> {
  if (!imageId || !/^[a-zA-Z0-9_-]+$/.test(imageId)) return;
  const docPath = `question_images/${imageId}`;
  try {
    await deleteDoc(doc(db, 'question_images', imageId));
  } catch (error) {
    console.warn(`Could not delete ${docPath}:`, error);
  }
}

/**
 * Student Google Sign-In for Online Test (Popup-based for iframe compatibility)
 */
export async function signInStudentWithGoogle(): Promise<User> {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  const result = await signInWithPopup(auth, provider);
  return result.user;
}

/**
 * Sign out current Firebase Auth user
 */
export async function signOutStudent(): Promise<void> {
  if (auth.currentUser) {
    await signOut(auth);
  }
}

export interface OnlineTestSolvedItem {
  questionId: string;
  chapterName: string;
  question: string;
  options: string[];
  selectedOptionIndex: number;
  selectedOption: string;
  correctOptionIndex: number;
  correctOption: string;
  isCorrect: boolean;
  isUnanswered: boolean;
  explanation?: string;
  imageUrl?: string;
  answerImageUrl?: string;
}

export interface OnlineTestAttemptRecord {
  id: string;
  studentUid: string;
  studentName: string;
  studentEmail: string;
  grade: string;
  subject: string;
  chapters: string[];
  score: number;
  totalQuestions: number;
  correctCount: number;
  wrongCount: number;
  unansweredCount: number;
  percentage: number;
  timeTakenSeconds: number;
  emailSent: boolean;
  items: OnlineTestSolvedItem[];
  submittedAt: string;
}

/**
 * Save a completed student Online Test attempt to Firebase Firestore (`online_test_attempts/{attemptId}`).
 */
export async function saveOnlineTestAttemptToFirebase(
  attempt: OnlineTestAttemptRecord
): Promise<string> {
  const safeId =
    (attempt.id || `test_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`)
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .slice(0, 120);

  const studentUid = auth.currentUser?.uid || 'email_guest';

  const cleanItems = (attempt.items || []).slice(0, 100).map(item =>
    stripUndefinedDeep({
      questionId: String(item.questionId || '').slice(0, 120),
      chapterName: String(item.chapterName || '').slice(0, 140),
      question: String(item.question || '').slice(0, 1200),
      options: Array.isArray(item.options)
        ? item.options.slice(0, 6).map(o => String(o || '').slice(0, 400))
        : [],
      selectedOptionIndex: Number.isInteger(item.selectedOptionIndex)
        ? item.selectedOptionIndex
        : -1,
      selectedOption: String(item.selectedOption || '').slice(0, 400),
      correctOptionIndex: Number.isInteger(item.correctOptionIndex)
        ? item.correctOptionIndex
        : 0,
      correctOption: String(item.correctOption || '').slice(0, 400),
      isCorrect: Boolean(item.isCorrect),
      isUnanswered: Boolean(item.isUnanswered),
      explanation: item.explanation ? String(item.explanation).slice(0, 1200) : '',
      imageUrl: item.imageUrl ? String(item.imageUrl).slice(0, 300) : '',
      answerImageUrl: item.answerImageUrl ? String(item.answerImageUrl).slice(0, 300) : '',
    })
  );

  const payload = {
    id: safeId,
    studentUid,
    studentName: String(attempt.studentName || 'Student').trim().slice(0, 120),
    studentEmail: String(attempt.studentEmail || '').trim().toLowerCase().slice(0, 160),
    grade: String(attempt.grade || '').trim().slice(0, 80),
    subject: String(attempt.subject || '').trim().slice(0, 80),
    chapters: (attempt.chapters || []).slice(0, 60).map(c => String(c || '').slice(0, 140)),
    score: Math.max(0, Math.round(Number(attempt.score) || 0)),
    totalQuestions: Math.max(1, Math.min(100, Math.round(Number(attempt.totalQuestions) || 1))),
    correctCount: Math.max(0, Math.round(Number(attempt.correctCount) || 0)),
    wrongCount: Math.max(0, Math.round(Number(attempt.wrongCount) || 0)),
    unansweredCount: Math.max(0, Math.round(Number(attempt.unansweredCount) || 0)),
    percentage: Math.max(0, Math.min(100, Number(attempt.percentage) || 0)),
    timeTakenSeconds: Math.max(0, Math.round(Number(attempt.timeTakenSeconds) || 0)),
    emailSent: Boolean(attempt.emailSent),
    items: cleanItems,
    submittedAt: attempt.submittedAt || new Date().toISOString(),
  };

  const docPath = `online_test_attempts/${safeId}`;
  try {
    await setDoc(doc(db, 'online_test_attempts', safeId), payload);
    return safeId;
  } catch (error) {
    console.warn(`Could not save ${docPath} to Firestore:`, error);
    return safeId;
  }
}

/**
 * Fetch logged-in student's past Online Test attempts from Firestore (requires Firebase Auth session).
 */
export async function getStudentOnlineTestAttemptsFromFirebase(): Promise<OnlineTestAttemptRecord[]> {
  const user = auth.currentUser;
  if (!user) return [];

  try {
    const colRef = collection(db, 'online_test_attempts');
    const q = query(
      colRef,
      where('studentUid', '==', user.uid),
      limit(30)
    );
    const snap = await getDocs(q);
    const list: OnlineTestAttemptRecord[] = [];
    snap.forEach(d => {
      const data = d.data() as OnlineTestAttemptRecord;
      if (data && data.id) {
        list.push(data);
      }
    });
    list.sort((a, b) => String(b.submittedAt || '').localeCompare(String(a.submittedAt || '')));
    return list;
  } catch (error) {
    console.warn('Could not load student online test attempts from Firestore:', error);
    return [];
  }
}

export const ADMIN_EMAIL = 'shivu.angadi@gmail.com';

export function isVerifiedAdminUser(user: User | null | undefined): boolean {
  if (!user || !user.email) return false;
  return user.email.trim().toLowerCase() === ADMIN_EMAIL && Boolean(user.emailVerified);
}

export interface SchoolRegistrationRecord {
  id: string;
  ownerUid: string;
  schoolName: string;
  teacherName: string;
  email: string;
  taluk?: string;
  district?: string;
  diseCode?: string;
  medium?: string;
  role: 'teacher' | 'admin';
  registeredAt: string;
  updatedAt?: string;
}

/**
 * Save or update a School Registration profile in Firebase Firestore (`school_registrations/{id}`).
 */
export async function saveSchoolRegistrationToFirebase(
  input: Omit<SchoolRegistrationRecord, 'id' | 'ownerUid' | 'role' | 'registeredAt' | 'updatedAt'> & {
    id?: string;
  }
): Promise<SchoolRegistrationRecord> {
  const currentUser = auth.currentUser;
  const isAdmin = isVerifiedAdminUser(currentUser);
  const ownerUid = currentUser?.uid || 'school_guest';
  const normalizedEmail = String(input.email || '').trim().toLowerCase().slice(0, 160);
  const nowIso = new Date().toISOString();

  const regId = currentUser
    ? `uid_${currentUser.uid}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120)
    : `sch_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`.slice(0, 120);

  const payload: SchoolRegistrationRecord = {
    id: regId,
    ownerUid,
    schoolName: String(input.schoolName || '').trim().slice(0, 180),
    teacherName: String(input.teacherName || '').trim().slice(0, 120),
    email: normalizedEmail,
    taluk: String(input.taluk || '').trim().slice(0, 100),
    district: String(input.district || '').trim().slice(0, 100),
    diseCode: String(input.diseCode || '').trim().slice(0, 32),
    medium: String(input.medium || 'ಕನ್ನಡ ಮಾಧ್ಯಮ (State Syllabus)').trim().slice(0, 80),
    role: isAdmin ? 'admin' : 'teacher',
    registeredAt: nowIso,
    updatedAt: nowIso,
  };

  try {
    await setDoc(doc(db, 'school_registrations', regId), payload, { merge: true });
  } catch (error) {
    console.warn(`Could not save school_registrations/${regId} to Firestore:`, error);
  }

  return payload;
}

/**
 * Fetch an authenticated user's saved School Registration profile from Firestore.
 */
export async function getMySchoolRegistrationFromFirebase(): Promise<SchoolRegistrationRecord | null> {
  const currentUser = auth.currentUser;
  if (!currentUser) return null;

  const regId = `uid_${currentUser.uid}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120);
  try {
    const snap = await getDoc(doc(db, 'school_registrations', regId));
    if (snap.exists()) {
      return snap.data() as SchoolRegistrationRecord;
    }
    if (currentUser.email) {
      const q = query(
        collection(db, 'school_registrations'),
        where('email', '==', currentUser.email.toLowerCase()),
        limit(1)
      );
      const qSnap = await getDocs(q);
      if (!qSnap.empty) {
        return qSnap.docs[0].data() as SchoolRegistrationRecord;
      }
    }
    return null;
  } catch (error) {
    console.warn('Could not fetch school registration from Firestore:', error);
    return null;
  }
}


