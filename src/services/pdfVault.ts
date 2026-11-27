/**
 * Permanent PDF Vault Service
 * Stores uploaded LBA / Textbook PDFs permanently across THREE layers:
 *  1. Browser IndexedDB (instant 0ms reload after page refresh or offline)
 *  2. Server Disk (`public/assets/uploaded_pdfs/{pdfId}.pdf` via `/api/upload-pdf`)
 *  3. Firebase Firestore (`uploaded_pdfs/{pdfId}`) metadata & scanned chapter TOC
 *
 * Users never have to re-upload the same PDF again!
 */

import {
  UploadedPdfRecord,
  saveUploadedPdfToFirebase,
  getUploadedPdfsFromFirebase,
  deleteUploadedPdfFromFirebase,
  getQuestionBanksFromFirebase,
  deleteQuestionBankFromFirebase,
} from './firebase.ts';
import { QuestionBank, IndexEntry } from '../types/questionBank.ts';
import {
  extractGradeKey,
  canonicalGradeLabel,
  normalizeSubjectName,
  deduceSubjectCode,
  loadQuestionBankByPath,
  ensureUniqueQuestionIds,
  countBankUploadedImages,
  BUILTIN_CLASS6_INDEX_FILES,
} from './dataLoader.ts';

export interface SavedPdfEntry extends UploadedPdfRecord {
  hasLocalCache?: boolean;
  hasServerFile?: boolean;
}

const IDB_NAME = 'qpg_permanent_pdf_vault';
const IDB_VERSION = 1;
const IDB_STORE = 'pdf_blobs';

interface IdbPdfBlobRecord {
  id: string;
  fileName: string;
  fileSizeMB: string;
  totalPages: number;
  grade?: string;
  gradeKey?: string;
  subject?: string;
  subjectCode?: string;
  serverPdfUrl?: string;
  uploadedAt: string;
  buffer: ArrayBuffer;
}

// Fast in-memory session cache so repeated modal opens are instantaneous
const memoryPdfCache = new Map<string, ArrayBuffer>();

function openVaultDb(): Promise<IDBDatabase | null> {
  if (typeof window === 'undefined' || !('indexedDB' in window)) {
    return Promise.resolve(null);
  }
  return new Promise(resolve => {
    try {
      const req = window.indexedDB.open(IDB_NAME, IDB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          db.createObjectStore(IDB_STORE, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function putPdfInIdb(record: IdbPdfBlobRecord): Promise<void> {
  const db = await openVaultDb();
  if (!db) return;
  return new Promise(resolve => {
    try {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      const store = tx.objectStore(IDB_STORE);
      // Clone buffer so storing in IDB never detaches the active ArrayBuffer
      const cloned = record.buffer.slice(0);
      store.put({ ...record, buffer: cloned });
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

async function getPdfFromIdb(pdfId: string): Promise<IdbPdfBlobRecord | null> {
  const db = await openVaultDb();
  if (!db) return null;
  return new Promise(resolve => {
    try {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).get(pdfId);
      req.onsuccess = () => resolve((req.result as IdbPdfBlobRecord) || null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function listAllIdbRecords(): Promise<Array<Omit<IdbPdfBlobRecord, 'buffer'>>> {
  const db = await openVaultDb();
  if (!db) return [];
  return new Promise(resolve => {
    try {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).getAll();
      req.onsuccess = () => {
        const rows = Array.isArray(req.result) ? (req.result as IdbPdfBlobRecord[]) : [];
        resolve(
          rows.map(({ buffer: _buf, ...meta }) => meta)
        );
      };
      req.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  });
}

async function deletePdfFromIdb(pdfId: string): Promise<void> {
  const db = await openVaultDb();
  if (!db) return;
  return new Promise(resolve => {
    try {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).delete(pdfId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

/**
 * Generates a clean, filesystem-safe PDF ID.
 */
export function generatePdfId(fileName: string): string {
  const stem = fileName
    .replace(/\.pdf$/i, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 28) || 'lba';
  const rand = Math.random().toString(36).slice(2, 6);
  return `pdf_${stem}_${Date.now()}_${rand}`.slice(0, 100);
}

/**
 * Permanently save a PDF binary + metadata to:
 *  1. Memory cache
 *  2. Browser IndexedDB
 *  3. Server Disk (`POST /api/upload-pdf`)
 *  4. Firebase Firestore (`uploaded_pdfs/{pdfId}`)
 */
export async function savePdfPermanently(params: {
  pdfId?: string;
  buffer: ArrayBuffer;
  fileName: string;
  totalPages: number;
  grade?: string;
  gradeKey?: string;
  subject?: string;
  subjectCode?: string;
  detectedDoc?: any;
  linkedBankId?: string;
}): Promise<SavedPdfEntry> {
  const pdfId =
    params.pdfId && /^[a-zA-Z0-9_-]{3,120}$/.test(params.pdfId)
      ? params.pdfId
      : generatePdfId(params.fileName);

  const fileSizeMB = (params.buffer.byteLength / (1024 * 1024)).toFixed(2);
  const uploadedAt = new Date().toISOString();
  const clonedForMem = params.buffer.slice(0);
  memoryPdfCache.set(pdfId, clonedForMem);

  // 1. Save to IndexedDB immediately for instant reload recovery
  await putPdfInIdb({
    id: pdfId,
    fileName: params.fileName,
    fileSizeMB,
    totalPages: params.totalPages,
    grade: params.grade,
    gradeKey: params.gradeKey,
    subject: params.subject,
    subjectCode: params.subjectCode,
    serverPdfUrl: `/api/uploaded-pdf/${pdfId}`,
    uploadedAt,
    buffer: params.buffer,
  });

  // 2. Upload raw PDF bytes to server disk (fast binary upload, zero base64 bloat)
  let serverPdfUrl: string | undefined = `/api/uploaded-pdf/${pdfId}`;
  let hasServerFile = false;
  try {
    const uploadRes = await fetch('/api/upload-pdf', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/pdf',
        'X-Pdf-Id': pdfId,
        'X-File-Name': encodeURIComponent(params.fileName),
        'X-Total-Pages': String(params.totalPages || 0),
        'X-Grade': encodeURIComponent(params.grade || ''),
        'X-Subject': encodeURIComponent(params.subject || ''),
      },
      body: params.buffer.slice(0),
    });
    if (uploadRes.ok) {
      const json = await uploadRes.json();
      if (json?.pdfUrl) {
        serverPdfUrl = json.pdfUrl;
        hasServerFile = true;
      }
    }
  } catch (err) {
    console.warn('Server PDF disk upload skipped (IndexedDB copy preserved):', err);
  }

  // 3. Save metadata & scanned TOC to Firebase Firestore
  const entry: SavedPdfEntry = {
    id: pdfId,
    fileName: params.fileName,
    fileSizeMB,
    totalPages: params.totalPages,
    grade: params.grade,
    gradeKey: params.gradeKey,
    subject: params.subject,
    subjectCode: params.subjectCode,
    serverPdfUrl,
    linkedBankId: params.linkedBankId,
    detectedDoc: params.detectedDoc,
    uploadedAt,
    hasLocalCache: true,
    hasServerFile,
  };

  try {
    await saveUploadedPdfToFirebase(entry);
  } catch (err) {
    console.warn('Firebase uploaded_pdfs metadata write skipped:', err);
  }

  return entry;
}

/**
 * Load a permanently saved PDF binary ArrayBuffer from Memory -> IndexedDB -> Server Disk.
 */
export async function loadPdfBufferPermanently(
  pdfId: string,
  serverPdfUrl?: string
): Promise<ArrayBuffer | null> {
  if (!pdfId && !serverPdfUrl) return null;

  // 1. Memory cache
  if (pdfId && memoryPdfCache.has(pdfId)) {
    return memoryPdfCache.get(pdfId)!.slice(0);
  }

  // 2. IndexedDB cache (survives page refresh even offline)
  if (pdfId) {
    const idbRec = await getPdfFromIdb(pdfId);
    if (idbRec?.buffer && idbRec.buffer.byteLength > 0) {
      memoryPdfCache.set(pdfId, idbRec.buffer.slice(0));
      return idbRec.buffer.slice(0);
    }
  }

  // 3. Server Disk fallback (`/api/uploaded-pdf/{pdfId}`)
  const url = serverPdfUrl || (pdfId ? `/api/uploaded-pdf/${encodeURIComponent(pdfId)}` : '');
  if (!url) return null;

  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const contentType = (res.headers.get('content-type') || '').toLowerCase();
    if (contentType.includes('text/html') || contentType.includes('application/json')) {
      return null;
    }
    const buf = await res.arrayBuffer();
    if (!buf || buf.byteLength === 0) return null;

    if (pdfId) {
      memoryPdfCache.set(pdfId, buf.slice(0));
      // Warm IndexedDB so future loads are instant
      putPdfInIdb({
        id: pdfId,
        fileName: `${pdfId}.pdf`,
        fileSizeMB: (buf.byteLength / (1024 * 1024)).toFixed(2),
        totalPages: 0,
        serverPdfUrl: url,
        uploadedAt: new Date().toISOString(),
        buffer: buf,
      }).catch(() => {});
    }
    return buf.slice(0);
  } catch (err) {
    console.warn('Could not load saved PDF from server:', err);
    return null;
  }
}

/**
 * Merge and return ALL permanently saved PDFs across Server Disk, IndexedDB, and Firebase Firestore.
 * Prioritizes entries that have an actual downloadable/cached PDF binary.
 */
export async function listSavedPdfsCombined(): Promise<SavedPdfEntry[]> {
  const [fbRes, serverRes, idbRes] = await Promise.allSettled([
    getUploadedPdfsFromFirebase(),
    fetch('/api/uploaded-pdfs').then(r => (r.ok ? r.json() : { files: [] })),
    listAllIdbRecords(),
  ]);

  const fbList: UploadedPdfRecord[] = fbRes.status === 'fulfilled' ? fbRes.value : [];
  const serverList: any[] =
    serverRes.status === 'fulfilled' && Array.isArray(serverRes.value?.files)
      ? serverRes.value.files
      : [];
  const idbList = idbRes.status === 'fulfilled' ? idbRes.value : [];

  const byId = new Map<string, SavedPdfEntry>();
  const idbIds = new Set(idbList.map(r => r.id));
  const serverIds = new Set(serverList.map(r => r.id));

  // Add server disk records first
  for (const s of serverList) {
    if (!s?.id) continue;
    byId.set(s.id, {
      id: s.id,
      fileName: s.fileName || `${s.id}.pdf`,
      fileSizeMB: s.fileSizeMB || '0',
      totalPages: Number(s.totalPages) || 0,
      grade: s.grade || undefined,
      subject: s.subject || undefined,
      serverPdfUrl: s.pdfUrl || `/api/uploaded-pdf/${s.id}`,
      uploadedAt: s.uploadedAt || new Date().toISOString(),
      hasServerFile: true,
      hasLocalCache: idbIds.has(s.id),
    });
  }

  // Merge IndexedDB records
  for (const loc of idbList) {
    const existing = byId.get(loc.id);
    if (existing) {
      byId.set(loc.id, {
        ...existing,
        fileName: existing.fileName || loc.fileName,
        totalPages: existing.totalPages || loc.totalPages,
        grade: existing.grade || loc.grade,
        subject: existing.subject || loc.subject,
        hasLocalCache: true,
      });
    } else {
      byId.set(loc.id, {
        id: loc.id,
        fileName: loc.fileName,
        fileSizeMB: loc.fileSizeMB,
        totalPages: loc.totalPages,
        grade: loc.grade,
        gradeKey: loc.gradeKey,
        subject: loc.subject,
        subjectCode: loc.subjectCode,
        serverPdfUrl: loc.serverPdfUrl,
        uploadedAt: loc.uploadedAt,
        hasLocalCache: true,
        hasServerFile: serverIds.has(loc.id),
      });
    }
  }

  // Merge Firebase records (richest metadata + detectedDoc)
  for (const fb of fbList) {
    const existing = byId.get(fb.id);
    if (existing) {
      byId.set(fb.id, {
        ...existing,
        ...fb,
        serverPdfUrl: fb.serverPdfUrl || existing.serverPdfUrl,
        hasLocalCache: idbIds.has(fb.id) || existing.hasLocalCache,
        hasServerFile: serverIds.has(fb.id) || existing.hasServerFile,
      });
    } else {
      byId.set(fb.id, {
        ...fb,
        hasLocalCache: idbIds.has(fb.id),
        hasServerFile: serverIds.has(fb.id),
      });
    }
  }

  // Sort: entries with actual PDF binary available first, then newest uploadedAt first
  return Array.from(byId.values()).sort((a, b) => {
    const aHas = a.hasLocalCache || a.hasServerFile ? 1 : 0;
    const bHas = b.hasLocalCache || b.hasServerFile ? 1 : 0;
    if (aHas !== bHas) return bHas - aHas;
    return String(b.uploadedAt || '').localeCompare(String(a.uploadedAt || ''));
  });
}

/**
 * Permanently delete a saved PDF from IndexedDB, Server Disk, and Firebase Firestore.
 */
export async function deleteSavedPdfPermanently(pdfId: string): Promise<void> {
  if (!pdfId) return;
  memoryPdfCache.delete(pdfId);
  await Promise.allSettled([
    deletePdfFromIdb(pdfId),
    fetch(`/api/uploaded-pdf/${encodeURIComponent(pdfId)}`, { method: 'DELETE' }),
    deleteUploadedPdfFromFirebase(pdfId),
  ]);
}

/**
 * Automatically finds the best matching permanently saved PDF for a given Question Bank
 * (by linked sourcePdfId, source_pdf filename, or matching grade + subject).
 */
export function findMatchingSavedPdf(
  pdfs: SavedPdfEntry[],
  bank: QuestionBank | null | undefined
): SavedPdfEntry | null {
  if (!bank || !pdfs || pdfs.length === 0) return null;
  const availablePdfs = pdfs.filter(p => p.hasLocalCache || p.hasServerFile);
  if (availablePdfs.length === 0) return null;

  const meta = bank.metadata || ({} as any);

  // 1. Exact sourcePdfId match
  if (meta.sourcePdfId) {
    const exactId = availablePdfs.find(p => p.id === meta.sourcePdfId);
    if (exactId) return exactId;
  }

  // 2. Exact linkedBankId match
  if (meta.id) {
    const linked = availablePdfs.find(p => p.linkedBankId === meta.id);
    if (linked) return linked;
  }

  // 3. Exact source_pdf fileName match
  if (meta.source_pdf) {
    const targetName = String(meta.source_pdf).trim().toLowerCase();
    const byName = availablePdfs.find(p => p.fileName.trim().toLowerCase() === targetName);
    if (byName) return byName;
  }

  // 4. Grade + Subject match
  const bGrade = extractGradeKey(meta.gradeKey || meta.grade);
  const bSub = deduceSubjectCode(
    meta.subjectCode ? String(meta.subjectCode) : undefined,
    meta.subject ? String(meta.subject) : undefined
  );
  if (bGrade && bSub && bSub !== 'GEN') {
    const bySubject = availablePdfs.find(p => {
      const pGrade = extractGradeKey(p.gradeKey || p.grade || p.fileName);
      const pSub = deduceSubjectCode(p.subjectCode, `${p.subject || ''} ${p.fileName || ''}`);
      return pGrade === bGrade && pSub === bSub;
    });
    if (bySubject) return bySubject;
  }

  return null;
}

export interface SavedBankSummary {
  id: string;
  title: string;
  grade: string;
  gradeKey: string;
  subject: string;
  subjectCode: string;
  medium: string;
  totalChapters: number;
  totalQuestions: number;
  uploadedImageCount?: number;
  source: 'firebase' | 'server' | 'builtin';
  path: string;
  filename?: string;
  alsoOnServer?: boolean;
  serverPath?: string;
  updatedAt?: string;
  sourcePdfId?: string;
  sourcePdfName?: string;
  bank?: QuestionBank;
}

/**
 * Fetches ALL permanently saved Question Banks (from Firebase Firestore AND Server Disk `user_banks`)
 * WITHOUT deduplicating away multiple saved files of the same subject, so users can re-open ANY
 * previously saved JSON file OR spot & delete duplicate JSON files classwise!
 */
export async function listAllSavedQuestionBanks(): Promise<SavedBankSummary[]> {
  const [fbRes, serverRes] = await Promise.allSettled([
    getQuestionBanksFromFirebase(),
    fetch('/api/saved-question-banks').then(r => (r.ok ? r.json() : { files: [] })),
  ]);

  const byId = new Map<string, SavedBankSummary>();

  if (fbRes.status === 'fulfilled') {
    for (const bank of fbRes.value) {
      const id = String(bank.metadata.id || `fb_${Date.now()}`);
      const gKey = extractGradeKey(bank.metadata.gradeKey || bank.metadata.grade);
      const sCode = deduceSubjectCode(
        bank.metadata.subjectCode ? String(bank.metadata.subjectCode) : undefined,
        bank.metadata.subject
      );
      const totalQ = bank.chapters.reduce((sum, ch) => sum + (ch.questions?.length || 0), 0);
      const uploadedImgCount = countBankUploadedImages(bank);
      byId.set(id, {
        id,
        title: String(bank.metadata.title || `${canonicalGradeLabel(gKey)} - ${normalizeSubjectName(bank.metadata.subject)}`),
        grade: canonicalGradeLabel(gKey),
        gradeKey: gKey,
        subject: normalizeSubjectName(bank.metadata.subject),
        subjectCode: sCode,
        medium: bank.metadata.medium || 'ಕನ್ನಡ ಮಾಧ್ಯಮ (State Syllabus)',
        totalChapters: bank.chapters.length,
        totalQuestions: totalQ,
        uploadedImageCount: uploadedImgCount,
        source: 'firebase',
        path: `firebase://${id}`,
        updatedAt: String((bank.metadata as any).updatedAt || (bank.metadata as any).createdAt || ''),
        sourcePdfId: bank.metadata.sourcePdfId,
        sourcePdfName: bank.metadata.source_pdf,
        bank: ensureUniqueQuestionIds(bank),
      });
    }
  }

  if (serverRes.status === 'fulfilled' && Array.isArray(serverRes.value?.files)) {
    for (const f of serverRes.value.files as Array<IndexEntry & { filename?: string }>) {
      const id = String(f.id || f.path);
      const existing = byId.get(id);
      if (existing) {
        // Same exact bank ID synced to both Firebase & Server disk -> track both so Delete removes both cleanly
        existing.alsoOnServer = true;
        existing.serverPath = f.path;
        existing.filename = f.filename || existing.filename;
        const serverImgs = f.uploadedImageCount || 0;
        const existingImgs = existing.uploadedImageCount || 0;
        const serverUpdatedAt = String(f.createdAt || '');
        if (serverImgs > existingImgs) {
          existing.uploadedImageCount = serverImgs;
        }
        if (
          serverImgs >= existingImgs &&
          serverUpdatedAt &&
          (!existing.updatedAt || serverUpdatedAt > existing.updatedAt)
        ) {
          existing.source = 'server';
          existing.path = f.path;
          existing.updatedAt = serverUpdatedAt;
          existing.totalChapters = f.totalChapters || existing.totalChapters;
          existing.totalQuestions = f.totalQuestions || existing.totalQuestions;
          delete existing.bank;
        }
        continue;
      }
      const gKey = extractGradeKey(f.gradeKey || f.grade);
      const sCode = deduceSubjectCode(f.subjectCode, f.subject);
      byId.set(id, {
        id,
        title: `${canonicalGradeLabel(gKey)} - ${normalizeSubjectName(f.subject)}`,
        grade: canonicalGradeLabel(gKey),
        gradeKey: gKey,
        subject: normalizeSubjectName(f.subject),
        subjectCode: sCode,
        medium: f.medium || 'ಕನ್ನಡ ಮಾಧ್ಯಮ (State Syllabus)',
        totalChapters: f.totalChapters || 0,
        totalQuestions: f.totalQuestions || 0,
        uploadedImageCount: f.uploadedImageCount || 0,
        source: 'server',
        path: f.path,
        filename: f.filename,
        serverPath: f.path,
        updatedAt: f.createdAt,
      });
    }
  }

  // Also include all built-in Class 6 JSON files whenever not yet overridden by a Firebase/Server entry
  // so Admin can open any Class 6 subject directly to select/upload diagram images
  const existingClassSubjectKeys = new Set<string>();
  byId.forEach(item => {
    existingClassSubjectKeys.add(`${item.gradeKey}::${item.subjectCode}`);
  });

  for (const bf of BUILTIN_CLASS6_INDEX_FILES) {
    const gKey = extractGradeKey(bf.gradeKey || bf.grade);
    const sCode = deduceSubjectCode(bf.subjectCode, bf.subject);
    if (byId.has(bf.id) || existingClassSubjectKeys.has(`${gKey}::${sCode}`)) {
      continue;
    }
    const fileName = bf.path.split('/').pop() || `${bf.id}.json`;
    byId.set(bf.id, {
      id: bf.id,
      title: `${canonicalGradeLabel(gKey)} - ${normalizeSubjectName(bf.subject)} (ಅಧಿಕೃತ ಮೂಲ JSON)`,
      grade: canonicalGradeLabel(gKey),
      gradeKey: gKey,
      subject: normalizeSubjectName(bf.subject),
      subjectCode: sCode,
      medium: bf.medium || 'ಕನ್ನಡ ಮಾಧ್ಯಮ (State Syllabus)',
      totalChapters: bf.totalChapters || 0,
      totalQuestions: bf.totalQuestions || 0,
      uploadedImageCount: 0,
      source: 'builtin',
      path: bf.path,
      filename: fileName,
      updatedAt: '',
    });
  }

  return Array.from(byId.values()).sort((a, b) => {
    const numA = parseInt(a.gradeKey, 10);
    const numB = parseInt(b.gradeKey, 10);
    if (!isNaN(numA) && !isNaN(numB) && numA !== numB) return numA - numB;
    const subCmp = a.subject.localeCompare(b.subject);
    if (subCmp !== 0) return subCmp;
    const imgDiff = (b.uploadedImageCount || 0) - (a.uploadedImageCount || 0);
    if (imgDiff !== 0) return imgDiff;
    return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
  });
}

/**
 * Loads the full QuestionBank JSON for a SavedBankSummary item.
 */
export async function loadSavedQuestionBank(summary: SavedBankSummary): Promise<QuestionBank> {
  if (summary.bank) return ensureUniqueQuestionIds(summary.bank);
  return ensureUniqueQuestionIds(await loadQuestionBankByPath(summary.path));
}

/**
 * Permanently deletes a saved or duplicate Question Bank JSON file from Firebase Firestore
 * and/or Server Disk (`public/assets/user_banks`).
 */
export async function deleteSavedQuestionBankPermanently(
  summary: SavedBankSummary
): Promise<{ deletedFirebase: boolean; deletedServer: boolean }> {
  let deletedFirebase = false;
  let deletedServer = false;

  if (summary.source === 'firebase') {
    await deleteQuestionBankFromFirebase(summary.id);
    deletedFirebase = true;
  }

  if (summary.source === 'server' || summary.alsoOnServer) {
    const query = summary.filename
      ? `?filename=${encodeURIComponent(summary.filename)}`
      : '';
    const res = await fetch(
      `/api/saved-question-bank/${encodeURIComponent(summary.id)}${query}`,
      { method: 'DELETE' }
    );
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData?.error || 'Failed to delete server JSON file.');
    }
    deletedServer = true;
  }

  return { deletedFirebase, deletedServer };
}
