/**
 * Intelligent Question Paper Generator Engine
 * Strictly follows Karnataka DSERT Blueprint weightages, ensures valid answers, and matches target marks.
 * Author: M I Nilaji / S R Angadi
 */

import {
  QuestionBank,
  SectionBlueprint,
  PaperHeader,
  GeneratedPaper,
  GeneratedSection,
  GeneratedQuestionItem,
  QuestionItem,
  STANDARD_QUESTION_FORMATS,
} from '../types/questionBank.ts';
import {
  generateOfficialBlueprint,
  buildSectionsFromBlueprint,
  solveExactQuestionTypes,
} from './blueprintEngine.ts';
import { deduceSubjectCode } from './dataLoader.ts';

export interface SectionValidationResult {
  sectionId: string;
  sectionTitle: string;
  requiredCount: number;
  availableCount: number;
  isSufficient: boolean;
  message?: string;
}

export interface ValidationSummary {
  isValid: boolean;
  sections: SectionValidationResult[];
  totalRequired: number;
  totalAvailable: number;
}

const ROMAN_NUMERALS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];

/**
 * Returns localized section titles and instructions based on subject (English, Hindi, Kannada)
 */
export function getLocalizedSectionHeading(
  formatId: string,
  sectionRoman: string,
  subjectCode: string,
  marksPerQuestion: number,
  fallbackKannadaName: string
): { title: string; instructionText: string } {
  const isEng = subjectCode === 'ENG';
  const isHin = subjectCode === 'HIN';

  if (isEng) {
    switch (formatId) {
      case 'mcq':
        return {
          title: `Section - ${sectionRoman} : Multiple Choice Questions (${marksPerQuestion} Mark Each)`,
          instructionText: `I. Four alternatives are given for each of the following questions / incomplete statements. Choose the correct answer and write it with its letter of alphabet:`,
        };
      case 'fill_blank':
        return {
          title: `Section - ${sectionRoman} : Fill in the Blanks (${marksPerQuestion} Mark Each)`,
          instructionText: `II. Fill in the blanks with suitable words:`,
        };
      case 'true_false':
        return {
          title: `Section - ${sectionRoman} : True or False (${marksPerQuestion} Mark Each)`,
          instructionText: `III. State whether the following statements are True or False:`,
        };
      case 'analogy':
        return {
          title: `Section - ${sectionRoman} : Analogy / Related Words (${marksPerQuestion} Mark Each)`,
          instructionText: `IV. Observe the relationship in the first pair and complete the second pair:`,
        };
      case 'match':
        return {
          title: `Section - ${sectionRoman} : Match the Following (${marksPerQuestion} Marks)`,
          instructionText: `V. Match the words / items in Column 'A' with Column 'B':`,
        };
      case 'one_sentence':
        return {
          title: `Section - ${sectionRoman} : One Sentence Answers (${marksPerQuestion} Mark Each)`,
          instructionText: `VI. Answer the following questions in one sentence each:`,
        };
      case 'short_2m':
        return {
          title: `Section - ${sectionRoman} : 2-3 Sentences Answers (${marksPerQuestion} Marks Each)`,
          instructionText: `VII. Answer the following questions in two to three sentences each:`,
        };
      case 'who_said':
        return {
          title: `Section - ${sectionRoman} : Reference to Context (${marksPerQuestion} Marks Each)`,
          instructionText: `VIII. Explain with reference to context / Who said to whom:`,
        };
      case 'passage_pic':
        return {
          title: `Section - ${sectionRoman} : Comprehension / Picture Study (${marksPerQuestion} Marks Each)`,
          instructionText: `IX. Read the following passage / study the picture and answer the questions:`,
        };
      case 'grammar_section':
        return {
          title: `Section - ${sectionRoman} : Grammar & Vocabulary (${marksPerQuestion} Marks Each)`,
          instructionText: `X. Do as directed / Grammar and Vocabulary:`,
        };
      case 'short_3m':
        return {
          title: `Section - ${sectionRoman} : Descriptive Answers (${marksPerQuestion} Marks Each)`,
          instructionText: `XI. Answer the following questions in four to six sentences each:`,
        };
      case 'long_4m':
        return {
          title: `Section - ${sectionRoman} : Long Answers / Essay (${marksPerQuestion} Marks Each)`,
          instructionText: `XII. Answer the following questions in detail:`,
        };
      default:
        return {
          title: `Section - ${sectionRoman} (${marksPerQuestion} Marks)`,
          instructionText: `Answer the following questions:`,
        };
    }
  }

  if (isHin) {
    switch (formatId) {
      case 'mcq':
        return {
          title: `खण्ड - ${sectionRoman} : बहुविकल्पीय प्रश्न (प्रत्येक ${marksPerQuestion} अंक)`,
          instructionText: `I. निम्नलिखित प्रत्येक प्रश्न के लिए चार विकल्प दिए गए हैं। सही विकल्प चुनकर उसके क्रमांक सहित उत्तर लिखिए:`,
        };
      case 'fill_blank':
        return {
          title: `खण्ड - ${sectionRoman} : रिक्त स्थान भरिए (प्रत्येक ${marksPerQuestion} अंक)`,
          instructionText: `II. कोष्ठक में दिए गए सही शब्दों से रिक्त स्थानों की पूर्ति कीजिए:`,
        };
      case 'true_false':
        return {
          title: `खण्ड - ${sectionRoman} : सही या गलत (प्रत्येक ${marksPerQuestion} अंक)`,
          instructionText: `III. निम्नलिखित वाक्य सही हैं या गलत लिखिए:`,
        };
      case 'analogy':
        return {
          title: `खण्ड - ${sectionRoman} : संबंध जोड़िए (प्रत्येक ${marksPerQuestion} अंक)`,
          instructionText: `IV. पहले जोड़े के संबंध को देखकर दूसरे जोड़े को पूरा कीजिए:`,
        };
      case 'match':
        return {
          title: `खण्ड - ${sectionRoman} : सही मिलान कीजिए (${marksPerQuestion} अंक)`,
          instructionText: `V. 'अ' भाग के शब्दों को 'आ' भाग के शब्दों के साथ सही मिलान कीजिए:`,
        };
      case 'one_sentence':
        return {
          title: `खण्ड - ${sectionRoman} : एक वाक्य में उत्तर (प्रत्येक ${marksPerQuestion} अंक)`,
          instructionText: `VI. निम्नलिखित प्रश्नों के उत्तर एक वाक्य में लिखिए:`,
        };
      case 'short_2m':
        return {
          title: `खण्ड - ${sectionRoman} : दो-तीन वाक्यों में उत्तर (प्रत्येक ${marksPerQuestion} अंक)`,
          instructionText: `VII. निम्नलिखित प्रश्नों के उत्तर दो या तीन वाक्यों में लिखिए:`,
        };
      case 'who_said':
        return {
          title: `खण्ड - ${sectionRoman} : किसने किससे कहा (प्रत्येक ${marksPerQuestion} अंक)`,
          instructionText: `VIII. निम्नलिखित वाक्य किसने किससे कहे लिखिए:`,
        };
      case 'passage_pic':
        return {
          title: `खण्ड - ${sectionRoman} : गद्यांश / चित्र आधारित प्रश्न (प्रत्येक ${marksPerQuestion} अंक)`,
          instructionText: `IX. निम्नलिखित गद्यांश पढ़कर पूछे गए प्रश्नों के उत्तर लिखिए:`,
        };
      case 'grammar_section':
        return {
          title: `खण्ड - ${sectionRoman} : व्याकरण भाग (${marksPerQuestion} अंक)`,
          instructionText: `X. सूचना के अनुसार लिखिए / व्याकरण भाग:`,
        };
      case 'short_3m':
        return {
          title: `खण्ड - ${sectionRoman} : तीन-चार वाक्यों में उत्तर (प्रत्येक ${marksPerQuestion} अंक)`,
          instructionText: `XI. निम्नलिखित प्रश्नों के उत्तर तीन या चार वाक्यों में लिखिए:`,
        };
      case 'long_4m':
        return {
          title: `खण्ड - ${sectionRoman} : सविस्तार उत्तर (प्रत्येक ${marksPerQuestion} अंक)`,
          instructionText: `XII. निम्नलिखित प्रश्नों के सविस्तार उत्तर लिखिए:`,
        };
      default:
        return {
          title: `खण्ड - ${sectionRoman} (${marksPerQuestion} अंक)`,
          instructionText: `निम्नलिखित प्रश्नों के उत्तर लिखिए:`,
        };
    }
  }

  // Kannada and Core Kannada-Medium standard
  switch (formatId) {
    case 'mcq':
      return {
        title: `ವಿಭಾಗ - ${sectionRoman} : ಬಹು ಆಯ್ಕೆ ಪ್ರಶ್ನೆಗಳು (MCQ)`,
        instructionText: `ಕೆಳಗಿನ ಅಪೂರ್ಣ ಹೇಳಿಕೆಗಳಿಗೆ/ಪ್ರಶ್ನೆಗಳಿಗೆ ನಾಲ್ಕು ಪರ್ಯಾಯ ಉತ್ತರಗಳನ್ನು ನೀಡಲಾಗಿದೆ. ಅವುಗಳಲ್ಲಿ ಸೂಕ್ತವಾದ ಉತ್ತರವನ್ನು ಆರಿಸಿ, ಕ್ರಮಾಕ್ಷರದೊಂದಿಗೆ ಪೂರ್ಣ ಉತ್ತರವನ್ನು ಬರೆಯಿರಿ:`,
      };
    case 'fill_blank':
      return {
        title: `ವಿಭಾಗ - ${sectionRoman} : ಖಾಲಿ ಜಾಗ ಭರ್ತಿ ಮಾಡಿ`,
        instructionText: `ಕೆಳಗಿನ ವಾಕ್ಯಗಳಲ್ಲಿ ಬಿಟ್ಟ ಸ್ಥಳಗಳನ್ನು ಸೂಕ್ತ ಪದಗಳಿಂದ ಭರ್ತಿ ಮಾಡಿ:`,
      };
    case 'true_false':
      return {
        title: `ವಿಭಾಗ - ${sectionRoman} : ಸರಿ ಅಥವಾ ತಪ್ಪು`,
        instructionText: `ಕೆಳಗಿನ ಹೇಳಿಕೆಗಳು ಸರಿಯೋ ಅಥವಾ ತಪ್ಪೋ ಗುರುತಿಸಿ ಬರೆಯಿರಿ:`,
      };
    case 'analogy':
      return {
        title: `ವಿಭಾಗ - ${sectionRoman} : ಸಂಬಂಧ ಕಲ್ಪಿಸಿ`,
        instructionText: `ಮೊದಲೆರಡು ಪದಗಳಿಗಿರುವ ಸಂಬಂಧದಂತೆ ಮೂರನೆಯ ಪದಕ್ಕೆ ಸರಿಹೊಂದುವ ಸಂಬಂಧಿ ಪದ ಬರೆಯಿರಿ:`,
      };
    case 'match':
      return {
        title: `ವಿಭಾಗ - ${sectionRoman} : ಹೊಂದಿಸಿ ಬರೆಯಿರಿ`,
        instructionText: `'ಅ' ಪಟ್ಟಿಯಲ್ಲಿರುವ ಅಂಶಗಳಿಗೆ 'ಆ' ಪಟ್ಟಿಯಲ್ಲಿರುವ ಸೂಕ್ತ ಅಂಶಗಳನ್ನು ಹೊಂದಿಸಿ ಬರೆಯಿರಿ:`,
      };
    case 'one_sentence':
      return {
        title: `ವಿಭಾಗ - ${sectionRoman} : ಒಂದು ವಾಕ್ಯದಲ್ಲಿ ಉತ್ತರಿಸಿ`,
        instructionText: `ಕೆಳಗಿನ ಪ್ರಶ್ನೆಗಳಿಗೆ ಒಂದೊಂದು ವಾಕ್ಯದಲ್ಲಿ ಉತ್ತರಿಸಿ:`,
      };
    case 'short_2m':
      return {
        title: `ವಿಭಾಗ - ${sectionRoman} : ಎರಡು-ಮೂರು ವಾಕ್ಯಗಳಲ್ಲಿ ಉತ್ತರಿಸಿ (2M)`,
        instructionText: `ಕೆಳಗಿನ ಪ್ರಶ್ನೆಗಳಿಗೆ ಎರಡರಿಂದ ಮೂರು ವಾಕ್ಯಗಳಲ್ಲಿ ಉತ್ತರಿಸಿ:`,
      };
    case 'who_said':
      return {
        title: `ವಿಭಾಗ - ${sectionRoman} : ಯಾರು ಯಾರಿಗೆ ಹೇಳಿದರು / ಸಂದರ್ಭ`,
        instructionText: `ಕೆಳಗಿನ ಮಾತುಗಳನ್ನು ಯಾರು ಯಾರಿಗೆ ಹೇಳಿದರು / ಸಂದರ್ಭ ಸಹಿತ ವಿವರಿಸಿ:`,
      };
    case 'passage_pic':
      return {
        title: `ವಿಭಾಗ - ${sectionRoman} : ಗದ್ಯಭಾಗ / ಚಿತ್ರ ಆಧಾರಿತ ಪ್ರಶ್ನೆ`,
        instructionText: `ಕೆಳಗಿನ ಗದ್ಯಭಾಗವನ್ನು ಓದಿ / ಚಿತ್ರವನ್ನು ಗಮನಿಸಿ ಕೇಳಲಾದ ಪ್ರಶ್ನೆಗಳಿಗೆ ಉತ್ತರಿಸಿ:`,
      };
    case 'grammar_section':
      return {
        title: `ವಿಭಾಗ - ${sectionRoman} : ವ್ಯಾಕರಣ ಮತ್ತು ಭಾಷಾಭ್ಯಾಸ`,
        instructionText: `ಸೂಚನೆಯಂತೆ ಉತ್ತರಿಸಿ / ವ್ಯಾಕರಣಾಂಶಗಳನ್ನು ಗುರುತಿಸಿ ಬರೆಯಿರಿ:`,
      };
    case 'short_3m':
      return {
        title: `ವಿಭಾಗ - ${sectionRoman} : ನಾಲ್ಕು-ಐದು ವಾಕ್ಯಗಳಲ್ಲಿ ಉತ್ತರಿಸಿ (3M)`,
        instructionText: `ಕೆಳಗಿನ ಪ್ರಶ್ನೆಗಳಿಗೆ ನಾಲ್ಕರಿಂದ ಐದು ವಾಕ್ಯಗಳಲ್ಲಿ ಉತ್ತರಿಸಿ:`,
      };
    case 'long_4m':
      return {
        title: `ವಿಭಾಗ - ${sectionRoman} : ವಿವರವಾಗಿ ಉತ್ತರಿಸಿ / ರೇಖಾಚಿತ್ರ ರಚಿಸಿ (4M)`,
        instructionText: `ಕೆಳಗಿನ ಪ್ರಶ್ನೆಗಳಿಗೆ ವಿವರವಾಗಿ ಉತ್ತರಿಸಿ / ರೇಖಾಚಿತ್ರ ಬರೆದು ಭಾಗಗಳನ್ನು ಗುರುತಿಸಿ:`,
      };
    default:
      return {
        title: `ವಿಭಾಗ - ${sectionRoman} : ${fallbackKannadaName}`,
        instructionText: `ಕೆಳಗಿನ ಪ್ರಶ್ನೆಗಳಿಗೆ ಉತ್ತರಿಸಿ:`,
      };
  }
}

/**
 * Checks if question has a valid, non-empty, meaningful answer
 */
export function hasValidAnswer(q: QuestionItem): boolean {
  if (!q.answer) return false;
  const a = q.answer.trim();
  return a.length > 0 && a !== 'null' && a !== 'undefined' && a !== 'ಉತ್ತರ ಲಭ್ಯವಿಲ್ಲ';
}

/**
 * Authoritative detector for Match-the-Following questions.
 * Used to guarantee at most ONE Match question per paper and zero leaks into other sections.
 */
export function isMatchQuestion(
  q: Pick<QuestionItem, 'formatCategoryId' | 'questionType' | 'items' | 'question'>
): boolean {
  if (q.formatCategoryId === 'match') return true;
  if (Array.isArray(q.items) && q.items.length > 0) return true;
  const combined = `${q.questionType || ''} ${q.question || ''}`;
  return /(?:ಹೊಂದಿಸಿ\s*ಬರೆಯಿರಿ|ಸರಿ\s*ಹೊಂದಿಸಿ|match\s*the\s*following|ಸಹಿ\s*ಮಿಲಾನ|मिलान)/i.test(combined);
}

/**
 * Strict format category matcher so ONLY selected question formats appear in the generated paper.
 */
export function matchesFormatCategory(q: QuestionItem, bpCat: string): boolean {
  if (!bpCat || bpCat === 'all') return true;

  const qCat = q.formatCategoryId;
  const qMarks = q.marks || 1;
  const qText = q.question || '';
  const isMatch = isMatchQuestion(q);

  if (bpCat === 'match') {
    return isMatch;
  }

  // Non-match sections MUST NEVER pull Match-the-Following questions
  if (isMatch) {
    return false;
  }

  const isMcq = qCat === 'mcq' || Boolean(q.options && q.options.length >= 2);
  const hasBlank =
    qText.includes('_____') ||
    qText.includes('-----') ||
    qText.includes('ಬಿಟ್ಟ ಸ್ಥಳ') ||
    qText.includes('ಖಾಲಿ ಜಾಗ') ||
    /fill\s*in\s*the\s*blank/i.test(qText);
  const isTf =
    (qText.includes('ಸರಿ') && qText.includes('ತಪ್ಪು')) ||
    /true\s*or\s*false/i.test(qText);
  const isAnalogy =
    qText.includes('::') ||
    qText.includes('ಸಂಬಂಧ ಕಲ್ಪಿಸಿ') ||
    /analogy/i.test(qText);

  if (bpCat === 'mcq') {
    return isMcq;
  }
  if (bpCat === 'fill_blank') {
    return !isMcq && (qCat === 'fill_blank' || (qMarks === 1 && hasBlank));
  }
  if (bpCat === 'true_false') {
    return !isMcq && (qCat === 'true_false' || (qMarks === 1 && isTf));
  }
  if (bpCat === 'analogy') {
    return !isMcq && (qCat === 'analogy' || (qMarks === 1 && isAnalogy));
  }
  if (bpCat === 'one_sentence') {
    return (
      (qCat === 'one_sentence' || qMarks === 1) &&
      !isMcq &&
      !hasBlank &&
      !isTf &&
      !isAnalogy &&
      qCat !== 'fill_blank' &&
      qCat !== 'true_false' &&
      qCat !== 'analogy' &&
      qCat !== 'who_said' &&
      qCat !== 'passage_pic' &&
      qCat !== 'grammar_section'
    );
  }
  if (bpCat === 'short_2m') {
    return (
      !isMcq &&
      !hasBlank &&
      !isTf &&
      !isAnalogy &&
      (qCat === 'short_2m' || qMarks === 2) &&
      qCat !== 'who_said' &&
      qCat !== 'passage_pic' &&
      qCat !== 'grammar_section'
    );
  }
  if (bpCat === 'short_3m') {
    return (
      !isMcq &&
      !hasBlank &&
      !isTf &&
      !isAnalogy &&
      (qCat === 'short_3m' || qMarks === 3) &&
      qCat !== 'passage_pic' &&
      qCat !== 'grammar_section'
    );
  }
  if (bpCat === 'long_4m') {
    return (
      !isMcq &&
      !hasBlank &&
      !isTf &&
      !isAnalogy &&
      (qCat === 'long_4m' || qMarks >= 4) &&
      qCat !== 'passage_pic' &&
      qCat !== 'grammar_section'
    );
  }
  if (bpCat === 'who_said') {
    return (
      !isMcq &&
      (qCat === 'who_said' ||
        qText.includes('ಯಾರು ಯಾರಿಗೆ') ||
        qText.includes('ಸಂದರ್ಭ') ||
        /who\s*said/i.test(qText))
    );
  }
  if (bpCat === 'passage_pic') {
    return qCat === 'passage_pic';
  }
  if (bpCat === 'grammar_section') {
    return qCat === 'grammar_section';
  }

  return qCat === bpCat;
}

/**
 * Filters bank questions matching a section blueprint and chapter weightage constraints.
 * Strictly honors blueprint.formatCategoryId so unselected formats never leak into the paper.
 */
export function filterQuestionsForBlueprint(
  bank: QuestionBank,
  blueprint: SectionBlueprint,
  alreadyUsedQuestionIds: Set<string> = new Set()
): QuestionItem[] {
  const selectedChapterIds = new Set(blueprint.selectedChapterIds || []);
  const useAllChapters = selectedChapterIds.size === 0;

  const selectedLOs = new Set(blueprint.selectedLearningOutcomes || []);
  const useAllLOs = selectedLOs.size === 0 || selectedLOs.has('all');

  const selectedDiff = (blueprint.difficulty || 'all').toLowerCase();
  const hasStrictFormat = Boolean(blueprint.formatCategoryId && blueprint.formatCategoryId !== 'all');

  const candidates: QuestionItem[] = [];

  for (const chapter of bank.chapters) {
    if (!useAllChapters && !selectedChapterIds.has(chapter.chapterId)) {
      continue;
    }

    for (const q of chapter.questions) {
      if (alreadyUsedQuestionIds.has(q.id)) {
        continue;
      }

      // CRITICAL: Filter out incomplete or empty questions or missing answers
      if (!q.question || q.question.trim().length < 4) {
        continue;
      }

      if (!hasValidAnswer(q)) {
        continue;
      }

      // Check format category strictly
      if (hasStrictFormat) {
        if (!matchesFormatCategory(q, blueprint.formatCategoryId!)) {
          continue;
        }
      } else {
        // Even in generic sections, do not pull Match-the-Following questions accidentally
        if (isMatchQuestion(q)) continue;
        if (
          blueprint.questionType &&
          blueprint.questionType !== 'all' &&
          blueprint.questionType !== 'ಎಲ್ಲಾ ವಿಧಗಳು' &&
          q.questionType !== blueprint.questionType &&
          q.formatCategoryName !== blueprint.questionType
        ) {
          continue;
        }
      }

      // Check learning outcome
      if (!useAllLOs && q.learningOutcome && !selectedLOs.has(q.learningOutcome)) {
        continue;
      }

      // Check difficulty
      if (selectedDiff !== 'all' && q.difficulty && q.difficulty.toLowerCase() !== selectedDiff) {
        continue;
      }

      candidates.push(q);
    }
  }

  // Fallback: If LO/difficulty filters left too few candidates, relax ONLY LO/difficulty
  // while STILL strictly enforcing the selected formatCategoryId (never leaking unselected formats!)
  if (candidates.length < blueprint.questionCount) {
    const targetMark = blueprint.marksPerQuestion || 1;
    const fallbackPool: QuestionItem[] = [];

    for (const chapter of bank.chapters) {
      if (!useAllChapters && !selectedChapterIds.has(chapter.chapterId)) {
        continue;
      }
      for (const q of chapter.questions) {
        if (alreadyUsedQuestionIds.has(q.id) || candidates.some(c => c.id === q.id)) {
          continue;
        }
        if (!q.question || q.question.trim().length < 4) continue;
        if (!hasValidAnswer(q)) continue;

        if (hasStrictFormat) {
          if (!matchesFormatCategory(q, blueprint.formatCategoryId!)) continue;
        } else {
          if (isMatchQuestion(q)) continue;
        }

        fallbackPool.push(q);
      }
    }

    fallbackPool.sort((a, b) => Math.abs((a.marks || 1) - targetMark) - Math.abs((b.marks || 1) - targetMark));
    candidates.push(...fallbackPool);
  }

  // For Match-the-Following, strongly prioritize true multi-pair match tables (items.length >= 2)
  if (blueprint.formatCategoryId === 'match') {
    candidates.sort((a, b) => {
      const aScore = Array.isArray(a.items) && a.items.length >= 2 ? 2 : Array.isArray(a.items) && a.items.length === 1 ? 1 : 0;
      const bScore = Array.isArray(b.items) && b.items.length >= 2 ? 2 : Array.isArray(b.items) && b.items.length === 1 ? 1 : 0;
      return bScore - aScore;
    });
  }

  return candidates;
}

/**
 * Validates whether all sections have sufficient matching questions in the bank
 */
export function validateSectionsAvailability(
  bank: QuestionBank,
  blueprints: SectionBlueprint[]
): ValidationSummary {
  const sections: SectionValidationResult[] = [];
  let isValid = true;
  let totalRequired = 0;
  let totalAvailable = 0;

  const simulatedUsed = new Set<string>();

  for (const bp of blueprints) {
    totalRequired += bp.questionCount;
    const matches = filterQuestionsForBlueprint(bank, bp, simulatedUsed);
    const count = matches.length;
    totalAvailable += count;

    const isSufficient = count >= bp.questionCount;
    if (!isSufficient) {
      isValid = false;
    }

    for (let i = 0; i < Math.min(count, bp.questionCount); i++) {
      simulatedUsed.add(matches[i].id);
    }

    sections.push({
      sectionId: bp.id,
      sectionTitle: bp.title || `ವಿಭಾಗ ${bp.sectionRoman}`,
      requiredCount: bp.questionCount,
      availableCount: count,
      isSufficient,
      message: isSufficient
        ? undefined
        : `ಈ ವಿಭಾಗಕ್ಕೆ ${bp.questionCount} ಪ್ರಶ್ನೆಗಳು ಬೇಕು, ಆದರೆ ಕೇವಲ ${count} ಲಭ್ಯವಿವೆ.`,
    });
  }

  return {
    isValid,
    sections,
    totalRequired,
    totalAvailable,
  };
}

/**
 * Fisher-Yates shuffle algorithm for truly randomized, unbiased selection
 */
function shuffle<T>(array: T[]): T[] {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/**
 * Builds sections automatically from selected Question Formats and target marks/counts.
 * Strictly uses ONLY the user's selected formats (never injects unselected formats)
 * and guarantees AT MOST 1 "Match the Following" question per paper.
 */
export function buildBlueprintsFromSelectedFormats(
  bank: QuestionBank,
  selectedFormatIds: string[],
  selectedChapterIds: string[],
  targetTotalMarks: number,
  targetQuestionCount: number,
  excludeQuestionIds: Set<string> = new Set()
): SectionBlueprint[] {
  // If no formats selected, fall back to official blueprint structure
  if (selectedFormatIds.length === 0) {
    return buildSectionsFromBlueprint(bank, selectedChapterIds, targetTotalMarks, targetQuestionCount);
  }

  const sCode = deduceSubjectCode(
    typeof bank.metadata.subjectCode === 'string'
      ? bank.metadata.subjectCode
      : typeof bank.metadata.subject === 'string'
      ? bank.metadata.subject
      : ''
  );

  // Count both total available questions AND fresh (unused) questions per selected format in selected chapters
  const selectedChSet = new Set(selectedChapterIds || []);
  const useAllChs = selectedChSet.size === 0;
  const availableCountByFormat = new Map<string, number>();
  const freshCountByFormat = new Map<string, number>();

  for (const ch of bank.chapters) {
    if (!useAllChs && !selectedChSet.has(ch.chapterId)) continue;
    for (const q of ch.questions) {
      if (!q.question || q.question.trim().length < 4 || !hasValidAnswer(q)) continue;
      const isFresh = !excludeQuestionIds.has(q.id);
      for (const fmtId of selectedFormatIds) {
        if (matchesFormatCategory(q, fmtId)) {
          availableCountByFormat.set(fmtId, (availableCountByFormat.get(fmtId) || 0) + 1);
          if (isFresh) {
            freshCountByFormat.set(fmtId, (freshCountByFormat.get(fmtId) || 0) + 1);
          }
        }
      }
    }
  }

  // Keep only selected formats that have >= 1 matching question (if none match, fall back to selectedFormatIds as-is)
  const effectiveSelectedIds = selectedFormatIds.filter(
    id => (availableCountByFormat.get(id) || 0) > 0
  );
  const activeFormatIds = effectiveSelectedIds.length > 0 ? effectiveSelectedIds : selectedFormatIds;

  // 1. Separate Match the following (STRICTLY AT MOST 1 question per paper, 4 marks)
  // On Regenerate, if no fresh unused match question remains and other formats are selected, skip match so it won't repeat!
  const hasNonMatchFormats = activeFormatIds.some(id => id !== 'match');
  const freshMatchCount = freshCountByFormat.get('match') || 0;
  const canUseFreshMatch = excludeQuestionIds.size === 0 || freshMatchCount > 0 || !hasNonMatchFormats;
  const includesMatch =
    activeFormatIds.includes('match') &&
    canUseFreshMatch &&
    targetTotalMarks >= 4 &&
    (!hasNonMatchFormats || targetTotalMarks >= 10);
  const matchCount = includesMatch ? 1 : 0;
  const matchMarks = matchCount * 4;

  // If ONLY 'match' is selected, return strictly 1 Match the Following section (max 1 question)
  if (!hasNonMatchFormats && matchCount === 1) {
    const matchFmt = STANDARD_QUESTION_FORMATS.find(f => f.id === 'match')!;
    const localized = getLocalizedSectionHeading('match', 'I', sCode, 4, matchFmt.name);
    return [
      {
        id: `sec_match_0_${Date.now()}`,
        sectionRoman: 'I',
        title: localized.title,
        instructionText: localized.instructionText,
        questionType: matchFmt.name,
        formatCategoryId: 'match',
        selectedChapterIds,
        selectedLearningOutcomes: ['all'],
        difficulty: 'all',
        marksPerQuestion: 4,
        questionCount: 1,
      },
    ];
  }

  const remainingMarks = Math.max(0, targetTotalMarks - matchMarks);
  const remainingCount = Math.max(1, targetQuestionCount - matchCount);

  // Group ONLY the user's selected non-match formats by mark tiers
  const tier1Formats = STANDARD_QUESTION_FORMATS.filter(
    f => f.id !== 'match' && f.marks === 1 && activeFormatIds.includes(f.id)
  );
  const tier2Formats = STANDARD_QUESTION_FORMATS.filter(
    f => f.marks === 2 && activeFormatIds.includes(f.id)
  );
  const tier3Formats = STANDARD_QUESTION_FORMATS.filter(
    f => f.marks === 3 && activeFormatIds.includes(f.id)
  );
  const tier4Formats = STANDARD_QUESTION_FORMATS.filter(
    f => f.id !== 'match' && f.marks >= 4 && activeFormatIds.includes(f.id)
  );

  const has1M = tier1Formats.length > 0;
  const has2M = tier2Formats.length > 0;
  const has3M = tier3Formats.length > 0;
  const has4M = tier4Formats.length > 0;

  // 2. Solve exact integer distribution STRICTLY using ONLY selected tiers
  let bestAllocation = { q1: 0, q2: 0, q3: 0, q4: 0 };
  let minCost = Infinity;

  const diff = remainingMarks - remainingCount;
  const maxQ4 = has4M && diff >= 0 ? Math.min(remainingCount, Math.floor(diff / 3)) : 0;

  for (let q4 = 0; q4 <= maxQ4; q4++) {
    const maxQ3 = has3M && diff >= 3 * q4 ? Math.min(remainingCount - q4, Math.floor((diff - 3 * q4) / 2)) : 0;
    for (let q3 = 0; q3 <= maxQ3; q3++) {
      const q2 = has2M ? diff - 3 * q4 - 2 * q3 : 0;
      if (q2 < 0) continue;
      const q1 = remainingCount - q2 - q3 - q4;
      if (q1 < 0) continue;
      if (!has1M && q1 > 0) continue;

      const totalM = q1 * 1 + q2 * 2 + q3 * 3 + q4 * 4;
      if (totalM === remainingMarks) {
        const denomM = Math.max(1, remainingMarks);
        const denomQ = Math.max(1, remainingCount);
        const cost =
          Math.abs(q1 / denomQ - 0.38) +
          Math.abs((q2 * 2) / denomM - 0.25) +
          Math.abs((q3 * 3) / denomM - 0.15) +
          Math.abs((q4 * 4) / denomM - 0.22);

        if (cost < minCost) {
          minCost = cost;
          bestAllocation = { q1, q2, q3, q4 };
        }
      }
    }
  }

  // If no exact (remainingMarks, remainingCount) exists with ONLY the selected tiers,
  // find the closest integer allocation STRICTLY within ONLY the selected tiers
  // (NEVER inject unselected question formats!)
  if (minCost === Infinity) {
    let bestApproxCost = Infinity;
    const maxSearchQ = Math.max(remainingCount, remainingMarks, 1);
    const maxT4 = has4M ? Math.min(maxSearchQ, Math.ceil(remainingMarks / 4) + 1) : 0;
    const maxT3 = has3M ? Math.min(maxSearchQ, Math.ceil(remainingMarks / 3) + 1) : 0;
    const maxT2 = has2M ? Math.min(maxSearchQ, Math.ceil(remainingMarks / 2) + 1) : 0;

    // Prioritize matching remainingCount across the selected tiers, then matching remainingMarks
    for (let q4 = 0; q4 <= maxT4; q4++) {
      for (let q3 = 0; q3 <= maxT3; q3++) {
        for (let q2 = 0; q2 <= maxT2; q2++) {
          const usedSoFar = q2 + q3 + q4;
          const q1Options = has1M
            ? Array.from(
                new Set([
                  Math.max(0, remainingCount - usedSoFar),
                  Math.max(0, remainingMarks - (q2 * 2 + q3 * 3 + q4 * 4)),
                ])
              )
            : [0];

          for (const q1 of q1Options) {
            const totalQ = q1 + q2 + q3 + q4;
            if (totalQ <= 0) continue;
            const totalM = q1 * 1 + q2 * 2 + q3 * 3 + q4 * 4;

            // Strongly prefer using every selected tier at least once if possible
            const missingSelectedTiers =
              (has1M && q1 === 0 ? 1 : 0) +
              (has2M && q2 === 0 ? 1 : 0) +
              (has3M && q3 === 0 ? 1 : 0) +
              (has4M && q4 === 0 ? 1 : 0);

            const approxCost =
              Math.abs(totalM - remainingMarks) * 3 +
              Math.abs(totalQ - remainingCount) * 2 +
              missingSelectedTiers * 1.5;

            if (approxCost < bestApproxCost) {
              bestApproxCost = approxCost;
              bestAllocation = { q1, q2, q3, q4 };
            }
          }
        }
      }
    }

    // Ultimate guard: if still all zeros, assign remainingCount to the first selected tier
    if (bestAllocation.q1 + bestAllocation.q2 + bestAllocation.q3 + bestAllocation.q4 === 0) {
      if (has1M) bestAllocation.q1 = remainingCount;
      else if (has2M) bestAllocation.q2 = remainingCount;
      else if (has3M) bestAllocation.q3 = remainingCount;
      else if (has4M) bestAllocation.q4 = remainingCount;
    }
  }

  const blueprints: SectionBlueprint[] = [];
  let sectionIndex = 0;

  // Helper to distribute tier count strictly among the selected formats in that tier,
  // prioritizing formats that actually have FRESH unused questions on Regenerate!
  const allocateTierFormats = (
    formats: typeof STANDARD_QUESTION_FORMATS,
    totalCount: number,
    marks: number
  ) => {
    if (formats.length === 0 || totalCount <= 0) return;

    const countsByFmt = new Map<string, number>();
    formats.forEach(f => countsByFmt.set(f.id, 0));

    // Pass 1: Distribute up to each format's available FRESH question capacity (prevents repeating exhausted formats!)
    let rem = totalCount;
    const freshOrder = shuffle(
      formats.filter(f => (freshCountByFormat.get(f.id) || 0) > 0)
    );
    if (freshOrder.length > 0) {
      // Round-robin across fresh formats respecting each format's fresh capacity
      let progressed = true;
      while (rem > 0 && progressed) {
        progressed = false;
        for (const fmt of freshOrder) {
          if (rem <= 0) break;
          const cap = freshCountByFormat.get(fmt.id) || 0;
          const cur = countsByFmt.get(fmt.id) || 0;
          if (cur < cap) {
            countsByFmt.set(fmt.id, cur + 1);
            rem -= 1;
            progressed = true;
          }
        }
      }
    }

    // Pass 2: If fresh questions in this tier were fewer than totalCount, distribute remainder up to total available capacity
    if (rem > 0) {
      const availOrder = shuffle(
        formats.filter(f => (availableCountByFormat.get(f.id) || 0) > 0)
      );
      let progressed = true;
      while (rem > 0 && progressed) {
        progressed = false;
        for (const fmt of availOrder) {
          if (rem <= 0) break;
          const cap = availableCountByFormat.get(fmt.id) || 0;
          const cur = countsByFmt.get(fmt.id) || 0;
          if (cur < cap) {
            countsByFmt.set(fmt.id, cur + 1);
            rem -= 1;
            progressed = true;
          }
        }
      }
    }

    // Pass 3: Emit sections in standard canonical order
    formats.forEach(fmt => {
      const count = countsByFmt.get(fmt.id) || 0;
      if (count > 0) {
        const roman = ROMAN_NUMERALS[sectionIndex] || `${sectionIndex + 1}`;
        const localized = getLocalizedSectionHeading(fmt.id, roman, sCode, marks, fmt.name);
        blueprints.push({
          id: `sec_${fmt.id}_${sectionIndex}_${Date.now()}`,
          sectionRoman: roman,
          title: localized.title,
          instructionText: localized.instructionText,
          questionType: fmt.name,
          formatCategoryId: fmt.id,
          selectedChapterIds,
          selectedLearningOutcomes: ['all'],
          difficulty: 'all',
          marksPerQuestion: marks,
          questionCount: count,
        });
        sectionIndex++;
      }
    });
  };

  // Add ONLY selected 1M formats
  if (bestAllocation.q1 > 0 && tier1Formats.length > 0) {
    allocateTierFormats(tier1Formats, bestAllocation.q1, 1);
  }

  // Add ONLY selected 2M formats
  if (bestAllocation.q2 > 0 && tier2Formats.length > 0) {
    allocateTierFormats(tier2Formats, bestAllocation.q2, 2);
  }

  // Add ONLY selected 3M formats
  if (bestAllocation.q3 > 0 && tier3Formats.length > 0) {
    allocateTierFormats(tier3Formats, bestAllocation.q3, 3);
  }

  // Add ONLY selected 4M non-match formats
  if (bestAllocation.q4 > 0 && tier4Formats.length > 0) {
    allocateTierFormats(tier4Formats, bestAllocation.q4, 4);
  }

  // Add STRICTLY ONE Match the following question (if selected)
  if (matchCount === 1) {
    const matchFmt = STANDARD_QUESTION_FORMATS.find(f => f.id === 'match')!;
    const roman = ROMAN_NUMERALS[sectionIndex] || `${sectionIndex + 1}`;
    const localized = getLocalizedSectionHeading('match', roman, sCode, 4, matchFmt.name);
    blueprints.push({
      id: `sec_match_${sectionIndex}_${Date.now()}`,
      sectionRoman: roman,
      title: localized.title,
      instructionText: localized.instructionText,
      questionType: matchFmt.name,
      formatCategoryId: 'match',
      selectedChapterIds,
      selectedLearningOutcomes: ['all'],
      difficulty: 'all',
      marksPerQuestion: 4,
      questionCount: 1, // STRICTLY 1 question
    });
    sectionIndex++;
  }

  return blueprints;
}

/**
 * Generates the complete Question Paper with unique non-duplicate questions:
 * - Strictly enforces selected question formats (never leaks unselected formats)
 * - Strictly limits Match-the-Following to AT MOST 1 question per paper
 * - On Regenerate ("ಪುನಃ ರಚಿಸಿ"), prioritizes 100% fresh unseen questions (excludeQuestionIds)
 *   so zero questions from the previous paper repeat whenever fresh questions exist in the bank.
 */
export function generateQuestionPaper(
  bank: QuestionBank,
  header: PaperHeader,
  blueprints: SectionBlueprint[],
  excludeQuestionIds: Set<string> = new Set(),
  currentPaperQuestionIds: Set<string> = new Set(),
  currentPaperQuestionTexts: Set<string> = new Set(),
  questionUsageCounts: Map<string, number> = new Map()
): GeneratedPaper {
  // Clamp Match-the-Following across blueprints so at most ONE match section with questionCount === 1 exists
  let seenMatchSection = false;
  const validBlueprints: SectionBlueprint[] = [];
  for (const bp of blueprints) {
    if (bp.formatCategoryId === 'match') {
      if (seenMatchSection) continue;
      seenMatchSection = true;
      validBlueprints.push({ ...bp, questionCount: Math.min(1, Math.max(1, bp.questionCount)) });
    } else {
      validBlueprints.push(bp);
    }
  }

  // 1. Calculate blueprint chapter targets to enforce chapter weightages
  const allSelectedChIds = Array.from(
    new Set(validBlueprints.flatMap(bp => bp.selectedChapterIds || []))
  );
  const totalRequestedQ = validBlueprints.reduce((sum, b) => sum + b.questionCount, 0);
  const targetMaxMarks = header.maxMarks || 40;

  const officialBp = generateOfficialBlueprint(
    bank,
    allSelectedChIds,
    targetMaxMarks,
    totalRequestedQ
  );

  // Chapter question quotas from blueprint Step 4
  const remainingChapterCounts: Record<string, number> = {};
  for (const ch of officialBp.step4Chapters) {
    remainingChapterCounts[ch.chapterId] = Math.max(1, ch.questionsCount);
  }

  const normalizeQText = (text: string) =>
    String(text || '')
      .replace(/^[0-9೦-೯]+[\.\)\-:\s]+/, '')
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();

  const globalUsedQuestionIds = new Set<string>();
  const globalUsedQuestionTexts = new Set<string>();
  let matchIncludedInPaper = false;
  const chaptersRepresented = new Set<string>();
  const generatedSections: GeneratedSection[] = [];
  let currentDisplayNumber = 1;

  for (const bp of validBlueprints) {
    const isMatchSection = bp.formatCategoryId === 'match';
    if (isMatchSection && matchIncludedInPaper) {
      continue;
    }

    const sectionTargetCount = isMatchSection ? 1 : bp.questionCount;
    const allMatching = filterQuestionsForBlueprint(bank, bp, globalUsedQuestionIds).filter(q => {
      if (!isMatchSection && isMatchQuestion(q)) return false;
      const normText = normalizeQText(q.question);
      if (normText && globalUsedQuestionTexts.has(normText)) return false;
      return true;
    });

    // Partition candidates into strict freshness tiers so Regenerate NEVER repeats previous questions:
    // Tier 1: 100% brand-new (never shown before: usageCount === 0, not in excludeIds, not in currentPaperIds/Texts)
    // Tier 2: Older previously shown (not in currentPaperIds/Texts), grouped by ascending usageCount
    // Tier 3: Last resort from currentPaper (ONLY if selected chapters physically have fewer unique questions than needed)
    const tier1: QuestionItem[] = [];
    const tier2: QuestionItem[] = [];
    const tier3: QuestionItem[] = [];

    for (const q of allMatching) {
      const normText = normalizeQText(q.question);
      const inCurrent =
        currentPaperQuestionIds.has(q.id) ||
        (normText.length >= 6 && currentPaperQuestionTexts.has(normText));
      const usageCount = questionUsageCounts.get(q.id) || 0;
      const inExcluded = excludeQuestionIds.has(q.id) || usageCount > 0;

      if (!inCurrent && !inExcluded) {
        tier1.push(q);
      } else if (!inCurrent) {
        tier2.push(q);
      } else {
        tier3.push(q);
      }
    }

    // Sort Tier 2 and Tier 3 by ascending usageCount (with random shuffle within same usage count)
    const sortByLeastUsed = (arr: QuestionItem[]) => {
      const shuffled = shuffle(arr);
      shuffled.sort((a, b) => (questionUsageCounts.get(a.id) || 0) - (questionUsageCounts.get(b.id) || 0));
      return shuffled;
    };

    const orderedTier2 = sortByLeastUsed(tier2);
    const orderedTier3 = sortByLeastUsed(tier3);

    const selected: QuestionItem[] = [];
    let needed = sectionTargetCount;

    const pickFromPool = (pool: QuestionItem[], preserveOrder = false) => {
      if (needed <= 0 || pool.length === 0) return;

      // Group pool by chapter
      const questionsByChapter = new Map<string, QuestionItem[]>();
      for (const q of pool) {
        if (globalUsedQuestionIds.has(q.id)) continue;
        const normText = normalizeQText(q.question);
        if (normText && globalUsedQuestionTexts.has(normText)) continue;
        if (!isMatchSection && isMatchQuestion(q)) continue;

        const chId = q.chapterId || 'unknown';
        if (!questionsByChapter.has(chId)) {
          questionsByChapter.set(chId, []);
        }
        questionsByChapter.get(chId)!.push(q);
      }

      // Shuffle within each chapter (preserving multi-row match table priority or least-used order)
      for (const [chId, qList] of questionsByChapter.entries()) {
        if (isMatchSection) {
          const multiRow = preserveOrder
            ? qList.filter(q => Array.isArray(q.items) && q.items.length >= 2)
            : shuffle(qList.filter(q => Array.isArray(q.items) && q.items.length >= 2));
          const otherMatch = preserveOrder
            ? qList.filter(q => !Array.isArray(q.items) || q.items.length < 2)
            : shuffle(qList.filter(q => !Array.isArray(q.items) || q.items.length < 2));
          questionsByChapter.set(chId, [...multiRow, ...otherMatch]);
        } else if (!preserveOrder) {
          questionsByChapter.set(chId, shuffle(qList));
        }
      }

      while (needed > 0) {
        const eligibleChs = Array.from(questionsByChapter.keys()).filter(
          chId => (questionsByChapter.get(chId)?.length || 0) > 0
        );
        if (eligibleChs.length === 0) break;

        const shuffledEligible = shuffle(eligibleChs);
        shuffledEligible.sort((a, b) => {
          const notRepA = !chaptersRepresented.has(a) ? 1 : 0;
          const notRepB = !chaptersRepresented.has(b) ? 1 : 0;
          if (notRepA !== notRepB) return notRepB - notRepA;
          const remA = remainingChapterCounts[a] !== undefined ? remainingChapterCounts[a] : 0;
          const remB = remainingChapterCounts[b] !== undefined ? remainingChapterCounts[b] : 0;
          return remB - remA;
        });

        const chosenChId = shuffledEligible[0];
        const qList = questionsByChapter.get(chosenChId)!;
        const q = qList.shift()!;

        if (globalUsedQuestionIds.has(q.id)) continue;
        const normText = normalizeQText(q.question);
        if (normText && globalUsedQuestionTexts.has(normText)) continue;

        selected.push(q);
        globalUsedQuestionIds.add(q.id);
        if (normText) globalUsedQuestionTexts.add(normText);
        if (isMatchSection || isMatchQuestion(q)) {
          matchIncludedInPaper = true;
        }
        chaptersRepresented.add(chosenChId);

        if (remainingChapterCounts[chosenChId] !== undefined) {
          remainingChapterCounts[chosenChId] = Math.max(0, remainingChapterCounts[chosenChId] - 1);
        }
        needed--;
      }
    };

    // Fill strictly Tier 1 (brand new) -> Tier 2 (least-used non-current) -> Tier 3 (last resort)
    pickFromPool(tier1, false);
    if (needed > 0) pickFromPool(orderedTier2, true);
    if (needed > 0) pickFromPool(orderedTier3, true);

    if (selected.length === 0) {
      continue;
    }

    const generatedItems: GeneratedQuestionItem[] = selected.map(q => {
      globalUsedQuestionIds.add(q.id);
      return {
        uid: `gen_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        bankQuestionId: q.id,
        sectionId: bp.id,
        displayNumber: currentDisplayNumber++,
        question: q.question,
        answer: q.answer,
        questionType: q.questionType,
        formatCategoryId: q.formatCategoryId,
        marks: bp.marksPerQuestion || q.marks || 1,
        options: q.options ? [...q.options] : undefined,
        items: q.items ? [...q.items] : undefined,
        imageUrl: q.imageUrl,
        diagramSvg: q.diagramSvg,
        answerImageUrl: q.answerImageUrl,
        answerDiagramSvg: q.answerDiagramSvg,
        hasDiagram: q.hasDiagram,
        diagramDescription: q.diagramDescription,
        answerDiagramDescription: q.answerDiagramDescription,
        chapterName: q.chapterName || 'ಸಾಮಾನ್ಯ',
        learningOutcome: q.learningOutcome,
        difficulty: q.difficulty || (q.marks === 1 ? 'ಸುಲಭ' : q.marks >= 3 ? 'ಕಠಿಣ' : 'ಸಾಧಾರಣ'),
        objective: q.objective,
        objectiveName: q.objectiveName,
        pageBreakBefore: false,
      };
    });

    generatedSections.push({
      blueprint: {
        ...bp,
        questionCount: generatedItems.length,
      },
      questions: generatedItems,
    });
  }

  // Re-number sectionRoman sequentially after dropping any empty sections
  generatedSections.forEach((sec, idx) => {
    const newRoman = ROMAN_NUMERALS[idx] || `${idx + 1}`;
    const oldRoman = sec.blueprint.sectionRoman;
    sec.blueprint.sectionRoman = newRoman;
    if (oldRoman && oldRoman !== newRoman && sec.blueprint.title) {
      sec.blueprint.title = sec.blueprint.title.replace(
        new RegExp(`(ವಿಭಾಗ|Section|खण्ड)\\s*-\\s*${oldRoman}\\b`),
        `$1 - ${newRoman}`
      );
    }
  });

  let totalQuestions = 0;
  let totalMarks = 0;

  for (const sec of generatedSections) {
    totalQuestions += sec.questions.length;
    for (const q of sec.questions) {
      totalMarks += q.marks;
    }
  }

  return {
    id: `paper_${Date.now()}`,
    createdAt: new Date().toISOString(),
    header: {
      ...header,
      maxMarks: totalMarks,
    },
    sections: generatedSections,
    totalQuestions,
    totalMarks,
  };
}

/**
 * Finds alternative replacement questions for a specific question inside a section
 */
export function getAlternativeQuestions(
  bank: QuestionBank,
  blueprint: SectionBlueprint,
  currentlyUsedIds: Set<string>
): QuestionItem[] {
  const matches = filterQuestionsForBlueprint(bank, blueprint, currentlyUsedIds);
  return shuffle(matches);
}
