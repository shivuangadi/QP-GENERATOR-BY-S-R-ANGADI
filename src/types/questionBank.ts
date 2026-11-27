/**
 * Data structures for Karnataka Question Paper Generator
 * Author: S R Angadi
 */

export interface QuestionFormatDef {
  id: string;
  name: string;
  marks: number;
}

export const STANDARD_QUESTION_FORMATS: QuestionFormatDef[] = [
  { id: 'mcq', name: '೧. ಬಹು ಆಯ್ಕೆ (1M)', marks: 1 },
  { id: 'fill_blank', name: '೨. ಖಾಲಿ ಜಾಗ ಭರ್ತಿ (1M)', marks: 1 },
  { id: 'true_false', name: '೩. ಸರಿ ಅಥವಾ ತಪ್ಪು (1M)', marks: 1 },
  { id: 'analogy', name: '೪. ಸಂಬಂಧ ಕಲ್ಪಿಸಿ (1M)', marks: 1 },
  { id: 'match', name: '೫. ಹೊಂದಿಸಿ ಬರೆಯಿರಿ (4M)', marks: 4 },
  { id: 'one_sentence', name: '೬. ಒಂದು ವಾಕ್ಯದ ಪ್ರಶ್ನೆ (1M)', marks: 1 },
  { id: 'short_2m', name: '೭. ೨-೩ ವಾಕ್ಯದ ಪ್ರಶ್ನೆ (2M)', marks: 2 },
  { id: 'who_said', name: '೮. ಯಾರು ಯಾರಿಗೆ ಹೇಳಿದರು (2M/3M)', marks: 2 },
  { id: 'passage_pic', name: '೯. ಗದ್ಯಭಾಗ / ಚಿತ್ರ ಪ್ರಶ್ನೆ (3M/4M)', marks: 3 },
  { id: 'grammar_section', name: '೧೦. ವ್ಯಾಕರಣ/ ಗದ್ಯಭಾಗ (3M/4M)', marks: 3 },
  { id: 'short_3m', name: '೧೧. ೪-೬ ವಾಕ್ಯದ ಪ್ರಶ್ನೆ (3M)', marks: 3 },
  { id: 'long_4m', name: '೧೨. ದೀರ್ಘ ಪ್ರಶ್ನೆ / ಚಿತ್ರ (4M)', marks: 4 },
];

/**
 * Checks if a subject is a language (Kannada, English, Hindi)
 */
export function isLanguageSubject(subjectOrCode: string | undefined | null): boolean {
  if (!subjectOrCode) return false;
  const s = String(subjectOrCode).toLowerCase();
  if (s === 'kan' || s.includes('ಕನ್ನಡ') || s.includes('kannada')) return true;
  if (s === 'eng' || s.includes('english') || s.includes('ಇಂಗ್ಲಿಷ್') || s.includes('ಆಂಗ್ಲ')) return true;
  if (s === 'hin' || s.includes('hindi') || s.includes('ಹಿಂದಿ') || s.includes('हिंदी')) return true;
  return false;
}

/**
 * Returns available question formats for a given subject.
 * Core subjects (Mathematics, Science, Social Science) NEVER include
 * language formats (who_said, passage_pic, grammar_section).
 */
export function getAvailableFormatsForSubject(subjectOrCode: string | undefined | null): QuestionFormatDef[] {
  const isLang = isLanguageSubject(subjectOrCode);
  if (isLang) {
    return STANDARD_QUESTION_FORMATS;
  }
  return STANDARD_QUESTION_FORMATS.filter(
    f => !['who_said', 'passage_pic', 'grammar_section'].includes(f.id)
  );
}

export interface QuestionItem {
  id: string;
  question: string;
  answer: string;
  questionType: string;
  formatCategoryId: string;
  formatCategoryName: string;
  marks: number;
  learningOutcome?: string;
  difficulty?: string;
  objective?: 'know' | 'und' | 'app' | 'skill' | string;
  objectiveName?: string;
  options?: string[];
  items?: Array<{ left: string; right: string }>;
  imageUrl?: string;
  imageUrl2?: string;
  diagramSvg?: string;
  answerImageUrl?: string;
  answerImageUrl2?: string;
  answerDiagramSvg?: string;
  hasDiagram?: boolean;
  needsImage?: boolean;
  diagramDescription?: string;
  answerDiagramDescription?: string;
  chapterId: string;
  chapterName: string;
  chapterNumber?: number;
  questionNumber?: number;
  printedSerial?: string;
  sourcePage?: number;
  answerPage?: number;
  notDuplicateIds?: string[];
  [key: string]: unknown;
}

export interface Chapter {
  chapterId: string;
  chapterNumber?: number;
  chapterName: string;
  semester?: 1 | 2;
  weightagePercent?: number;
  weightageMarks?: number;
  learningOutcomes?: string[];
  printedPages?: string;
  questionPages?: string;
  answerPages?: string;
  questions: QuestionItem[];
}

export interface QuestionBankMetadata {
  id?: string;
  title?: string;
  grade: string;
  gradeKey?: string;
  subject: string;
  subjectCode?: string;
  medium: string;
  board?: string;
  academicYear?: string;
  author?: string;
  totalChapters?: number;
  totalQuestions?: number;
  source_pdf?: string;
  sourcePdfId?: string;
  sourcePdfUrl?: string;
  [key: string]: unknown;
}

export interface QuestionBank {
  metadata: QuestionBankMetadata;
  chapters: Chapter[];
}

export interface IndexEntry {
  id: string;
  path: string;
  grade: string;
  gradeKey?: string;
  subject: string;
  subjectCode?: string;
  medium: string;
  academicYear?: string;
  totalChapters?: number;
  totalQuestions?: number;
  uploadedImageCount?: number;
  isUserGenerated?: boolean;
  createdAt?: string;
}

export interface BankIndex {
  version?: string;
  description?: string;
  files: IndexEntry[];
}

export interface SectionBlueprint {
  id: string;
  sectionRoman: string;
  title: string;
  instructionText: string;
  questionType: string;
  formatCategoryId: string;
  selectedChapterIds: string[];
  selectedLearningOutcomes: string[];
  difficulty: string;
  marksPerQuestion: number;
  questionCount: number;
}

export interface PaperHeader {
  schoolName: string;
  examName: string;
  academicYear: string;
  grade: string;
  subject: string;
  medium: string;
  date: string;
  time: string;
  maxMarks: number;
  generalInstructions: string[];
}

export interface GeneratedQuestionItem {
  uid: string;
  bankQuestionId: string;
  sectionId: string;
  displayNumber: number;
  question: string;
  answer: string;
  questionType: string;
  formatCategoryId: string;
  marks: number;
  options?: string[];
  items?: Array<{ left: string; right: string }>;
  imageUrl?: string;
  imageUrl2?: string;
  diagramSvg?: string;
  answerImageUrl?: string;
  answerImageUrl2?: string;
  answerDiagramSvg?: string;
  hasDiagram?: boolean;
  diagramDescription?: string;
  answerDiagramDescription?: string;
  chapterName: string;
  learningOutcome?: string;
  difficulty?: string;
  objective?: 'know' | 'und' | 'app' | 'skill' | string;
  objectiveName?: string;
  pageBreakBefore?: boolean;
}

export interface GeneratedSection {
  blueprint: SectionBlueprint;
  questions: GeneratedQuestionItem[];
}

export interface GeneratedPaper {
  id: string;
  createdAt: string;
  header: PaperHeader;
  sections: GeneratedSection[];
  totalQuestions: number;
  totalMarks: number;
}
