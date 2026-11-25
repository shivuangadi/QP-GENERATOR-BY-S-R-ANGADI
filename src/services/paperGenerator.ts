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
 * Filters bank questions matching a section blueprint and chapter weightage constraints
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

      // Check format category or marks matching strictly
      if (blueprint.formatCategoryId && blueprint.formatCategoryId !== 'all') {
        const bpCat = blueprint.formatCategoryId;
        const qCat = q.formatCategoryId;
        const qMarks = q.marks || 1;

        let matchesFormat = false;

        if (bpCat === 'mcq') {
          matchesFormat = qCat === 'mcq' || Boolean(q.options && q.options.length >= 2);
        } else if (bpCat === 'fill_blank') {
          matchesFormat =
            qCat === 'fill_blank' ||
            (qMarks === 1 &&
              (q.question.includes('_____') ||
                q.question.includes('-----') ||
                q.question.includes('ಬಿಟ್ಟ ಸ್ಥಳ') ||
                q.question.includes('ಖಾಲಿ ಜಾಗ')));
        } else if (bpCat === 'true_false') {
          matchesFormat =
            qCat === 'true_false' ||
            (qMarks === 1 && q.question.includes('ಸರಿ') && q.question.includes('ತಪ್ಪು'));
        } else if (bpCat === 'analogy') {
          matchesFormat =
            qCat === 'analogy' ||
            (qMarks === 1 && (q.question.includes('::') || q.question.includes('ಸಂಬಂಧ')));
        } else if (bpCat === 'match') {
          matchesFormat =
            qCat === 'match' ||
            Boolean(q.items && q.items.length > 0) ||
            q.question.includes('ಹೊಂದಿಸಿ') ||
            q.question.includes('ಮಿಲಾನ');
        } else if (bpCat === 'one_sentence') {
          // STRICT: One sentence MUST NOT have options, must not be a fill-in-the-blank, must not be true/false, must not have match items
          const hasBlank =
            q.question.includes('_____') ||
            q.question.includes('-----') ||
            q.question.includes('ಬಿಟ್ಟ ಸ್ಥಳ') ||
            q.question.includes('ಖಾಲಿ ಜಾಗ');
          const isTf = q.question.includes('ಸರಿ') && q.question.includes('ತಪ್ಪು');
          const isAnalogy = q.question.includes('::') || q.question.includes('ಸಂಬಂಧ ಕಲ್ಪಿಸಿ');
          const hasOpts = Boolean(q.options && q.options.length > 0);
          const hasItms = Boolean(q.items && q.items.length > 0);
          matchesFormat =
            (qCat === 'one_sentence' || qMarks === 1) &&
            !hasBlank &&
            !isTf &&
            !isAnalogy &&
            !hasOpts &&
            !hasItms;
        } else if (bpCat === 'short_2m') {
          matchesFormat = (qCat === 'short_2m' || qMarks === 2) && qCat !== 'who_said';
        } else if (bpCat === 'short_3m') {
          matchesFormat = (qCat === 'short_3m' || qMarks === 3) && qCat !== 'passage_pic';
        } else if (bpCat === 'long_4m') {
          matchesFormat = (qCat === 'long_4m' || qMarks >= 4) && qCat !== 'match';
        } else if (bpCat === 'who_said') {
          matchesFormat = qCat === 'who_said' || q.question.includes('ಯಾರು ಯಾರಿಗೆ');
        } else if (bpCat === 'passage_pic') {
          matchesFormat = qCat === 'passage_pic';
        } else if (bpCat === 'grammar_section') {
          matchesFormat = qCat === 'grammar_section';
        } else {
          matchesFormat = qCat === bpCat;
        }

        if (!matchesFormat) {
          continue;
        }
      } else if (
        blueprint.questionType &&
        blueprint.questionType !== 'all' &&
        blueprint.questionType !== 'ಎಲ್ಲಾ ವಿಧಗಳು' &&
        q.questionType !== blueprint.questionType &&
        q.formatCategoryName !== blueprint.questionType
      ) {
        continue;
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

  // Fallback: If strict format left too few candidates, include other verified answer questions
  if (candidates.length < blueprint.questionCount) {
    const isMcqSection = blueprint.formatCategoryId === 'mcq' || blueprint.questionType?.includes('ಆಯ್ಕೆ');
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

        const isQMcq = Boolean(q.options && q.options.length > 0) || q.formatCategoryId === 'mcq';
        if (isMcqSection && !isQMcq) continue;
        if (!isMcqSection && isQMcq && (blueprint.marksPerQuestion || 1) > 1) continue;

        candidates.push(q);
      }
    }
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
 * Builds sections automatically from selected Question Formats and target marks/counts
 * Following Chapter Weightage from the Blueprint, guaranteeing EXACT total marks
 * and allowing AT MOST 1 "Match the Following" question.
 */
export function buildBlueprintsFromSelectedFormats(
  bank: QuestionBank,
  selectedFormatIds: string[],
  selectedChapterIds: string[],
  targetTotalMarks: number,
  targetQuestionCount: number
): SectionBlueprint[] {
  // If no formats selected, fall back to official blueprint structure
  if (selectedFormatIds.length === 0) {
    return buildSectionsFromBlueprint(bank, selectedChapterIds, targetTotalMarks, targetQuestionCount);
  }

  // 1. Separate Match the following (at most 1 question, 4 marks)
  const includesMatch = selectedFormatIds.includes('match') && targetTotalMarks >= 20;
  const matchCount = includesMatch ? 1 : 0;
  const matchMarks = matchCount * 4;

  let remainingMarks = Math.max(0, targetTotalMarks - matchMarks);
  let remainingCount = Math.max(1, targetQuestionCount - matchCount);

  // Group selected non-match formats by mark tiers
  const tier1Formats = STANDARD_QUESTION_FORMATS.filter(
    f => f.id !== 'match' && f.marks === 1 && selectedFormatIds.includes(f.id)
  );
  const tier2Formats = STANDARD_QUESTION_FORMATS.filter(
    f => f.marks === 2 && selectedFormatIds.includes(f.id)
  );
  const tier3Formats = STANDARD_QUESTION_FORMATS.filter(
    f => f.marks === 3 && selectedFormatIds.includes(f.id)
  );
  const tier4Formats = STANDARD_QUESTION_FORMATS.filter(
    f => f.id !== 'match' && f.marks >= 4 && selectedFormatIds.includes(f.id)
  );

  // Fallbacks if user didn't select certain tiers
  const has1M = tier1Formats.length > 0;
  const has2M = tier2Formats.length > 0;
  const has3M = tier3Formats.length > 0;
  const has4M = tier4Formats.length > 0;

  // 2. Solve exact integer distribution: q1 + q2 + q3 + q4 = remainingCount and 1*q1 + 2*q2 + 3*q3 + 4*q4 = remainingMarks
  let bestAllocation = { q1: remainingCount, q2: 0, q3: 0, q4: 0 };
  let minCost = Infinity;

  const diff = remainingMarks - remainingCount;
  const maxQ4 = has4M ? Math.floor(diff / 3) : 0;

  for (let q4 = 0; q4 <= maxQ4; q4++) {
    const maxQ3 = has3M ? Math.floor((diff - 3 * q4) / 2) : 0;
    for (let q3 = 0; q3 <= maxQ3; q3++) {
      const q2 = has2M ? diff - 3 * q4 - 2 * q3 : 0;
      if (q2 < 0) continue;
      const q1 = remainingCount - q2 - q3 - q4;
      if (q1 < 0) continue;

      if (!has1M && q1 > 0) continue;

      // Verify exact marks
      const totalM = q1 * 1 + q2 * 2 + q3 * 3 + q4 * 4;
      if (totalM === remainingMarks) {
        // Ideal pedagogical distribution cost
        const cost =
          Math.abs(q1 / remainingCount - 0.38) +
          Math.abs((q2 * 2) / remainingMarks - 0.25) +
          Math.abs((q3 * 3) / remainingMarks - 0.15) +
          Math.abs((q4 * 4) / remainingMarks - 0.22);

        if (cost < minCost) {
          minCost = cost;
          bestAllocation = { q1, q2, q3, q4 };
        }
      }
    }
  }

  // If strict exact solver found no solution with user's restricted tiers,
  // solve across standard tiers to strictly guarantee exact target marks and question count
  if (minCost === Infinity) {
    const solved = solveExactQuestionTypes(remainingMarks, remainingCount);
    bestAllocation = {
      q1: solved.mcq + solved.vsa,
      q2: solved.sa,
      q3: solved.la1,
      q4: solved.la2,
    };
  }

  const sCode = deduceSubjectCode(
    typeof bank.metadata.subjectCode === 'string'
      ? bank.metadata.subjectCode
      : typeof bank.metadata.subject === 'string'
      ? bank.metadata.subject
      : ''
  );
  const blueprints: SectionBlueprint[] = [];
  let sectionIndex = 0;

  // Helper to distribute tier count among selected formats in that tier
  const allocateTierFormats = (formats: typeof STANDARD_QUESTION_FORMATS, totalCount: number, marks: number) => {
    if (formats.length === 0 || totalCount <= 0) return;
    let rem = totalCount;
    formats.forEach((fmt, idx) => {
      if (rem <= 0) return;
      const isLast = idx === formats.length - 1;
      const count = isLast ? rem : Math.max(1, Math.floor(totalCount / formats.length));
      rem -= count;

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

  // Add 1M formats
  if (bestAllocation.q1 > 0) {
    const fmts = tier1Formats.length > 0 ? tier1Formats : STANDARD_QUESTION_FORMATS.filter(f => f.marks === 1);
    allocateTierFormats(fmts, bestAllocation.q1, 1);
  }

  // Add 2M formats
  if (bestAllocation.q2 > 0) {
    const fmts = tier2Formats.length > 0 ? tier2Formats : STANDARD_QUESTION_FORMATS.filter(f => f.marks === 2);
    allocateTierFormats(fmts, bestAllocation.q2, 2);
  }

  // Add 3M formats
  if (bestAllocation.q3 > 0) {
    const fmts = tier3Formats.length > 0 ? tier3Formats : STANDARD_QUESTION_FORMATS.filter(f => f.marks === 3);
    allocateTierFormats(fmts, bestAllocation.q3, 3);
  }

  // Add 4M non-match formats
  if (bestAllocation.q4 > 0) {
    const fmts = tier4Formats.length > 0 ? tier4Formats : STANDARD_QUESTION_FORMATS.filter(f => f.id !== 'match' && f.marks === 4);
    allocateTierFormats(fmts, bestAllocation.q4, 4);
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
 * Generates the complete Question Paper with unique non-duplicate questions
 * Ensuring chapter weightage distribution and 100% verified answers
 */
export function generateQuestionPaper(
  bank: QuestionBank,
  header: PaperHeader,
  blueprints: SectionBlueprint[]
): GeneratedPaper {
  // Use blueprints directly without reducing question counts
  const validBlueprints = blueprints;

  // 1. Calculate blueprint chapter targets to enforce chapter weightages
  const allSelectedChIds = Array.from(
    new Set(blueprints.flatMap(bp => bp.selectedChapterIds || []))
  );
  const totalRequestedQ = blueprints.reduce((sum, b) => sum + b.questionCount, 0);
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

  const globalUsedQuestionIds = new Set<string>();
  const chaptersRepresented = new Set<string>();
  const generatedSections: GeneratedSection[] = [];
  let currentDisplayNumber = 1;

  for (const bp of validBlueprints) {
    const matchingQuestions = filterQuestionsForBlueprint(bank, bp, globalUsedQuestionIds);

    // Group available questions by chapter
    const questionsByChapter = new Map<string, QuestionItem[]>();
    for (const q of matchingQuestions) {
      const chId = q.chapterId || 'unknown';
      if (!questionsByChapter.has(chId)) {
        questionsByChapter.set(chId, []);
      }
      questionsByChapter.get(chId)!.push(q);
    }

    // Shuffle within each chapter for fresh sets
    for (const [chId, qList] of questionsByChapter.entries()) {
      questionsByChapter.set(chId, shuffle(qList));
    }

    const selected: QuestionItem[] = [];
    let needed = bp.questionCount;

    // Pick questions prioritizing chapters with 0 representations first, then remaining quota
    while (needed > 0) {
      const eligibleChs = Array.from(questionsByChapter.keys()).filter(
        chId => (questionsByChapter.get(chId)?.length || 0) > 0
      );

      if (eligibleChs.length === 0) break;

      // Prioritize chapters with NO questions picked yet, then higher quota
      eligibleChs.sort((a, b) => {
        const notRepA = !chaptersRepresented.has(a) ? 1 : 0;
        const notRepB = !chaptersRepresented.has(b) ? 1 : 0;
        if (notRepA !== notRepB) return notRepB - notRepA;
        const remA = remainingChapterCounts[a] !== undefined ? remainingChapterCounts[a] : 0;
        const remB = remainingChapterCounts[b] !== undefined ? remainingChapterCounts[b] : 0;
        return remB - remA;
      });

      const chosenChId = eligibleChs[0];
      const qList = questionsByChapter.get(chosenChId)!;
      const q = qList.shift()!;
      selected.push(q);
      globalUsedQuestionIds.add(q.id);
      chaptersRepresented.add(chosenChId);

      if (remainingChapterCounts[chosenChId] !== undefined) {
        remainingChapterCounts[chosenChId] = Math.max(0, remainingChapterCounts[chosenChId] - 1);
      }
      needed--;
    }

    // If still need more questions for this section, pick from unused verified questions strictly matching format
    if (needed > 0) {
      const isMcqSection = bp.formatCategoryId === 'mcq' || bp.questionType?.includes('ಆಯ್ಕೆ');
      for (const ch of bank.chapters) {
        if (allSelectedChIds.length > 0 && !allSelectedChIds.includes(ch.chapterId)) continue;
        for (const q of shuffle(ch.questions)) {
          if (globalUsedQuestionIds.has(q.id)) continue;
          if (!hasValidAnswer(q) || !q.question || q.question.trim().length < 4) continue;
          const isQMcq = Boolean(q.options && q.options.length > 0) || q.formatCategoryId === 'mcq';
          if (isMcqSection && !isQMcq) continue;
          if (!isMcqSection && isQMcq && (bp.marksPerQuestion || 1) > 1) continue;

          // Strict format isolation in fallback
          if (bp.formatCategoryId === 'one_sentence') {
            const hasBlank = q.question.includes('_____') || q.question.includes('-----') || q.question.includes('ಬಿಟ್ಟ ಸ್ಥಳ') || q.question.includes('ಖಾಲಿ');
            if (hasBlank || isQMcq || Boolean(q.items && q.items.length > 0)) continue;
          } else if (bp.formatCategoryId === 'fill_blank') {
            const hasBlank = q.question.includes('_____') || q.question.includes('-----') || q.question.includes('ಬಿಟ್ಟ ಸ್ಥಳ') || q.question.includes('ಖಾಲಿ');
            if (!hasBlank && q.formatCategoryId !== 'fill_blank') continue;
          } else if (bp.formatCategoryId === 'match') {
            if (!q.items || q.items.length === 0) continue;
          }

          selected.push(q);
          globalUsedQuestionIds.add(q.id);
          chaptersRepresented.add(ch.chapterId);
          needed--;
          if (needed === 0) break;
        }
        if (needed === 0) break;
      }
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
      blueprint: { ...bp },
      questions: generatedItems,
    });
  }

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
