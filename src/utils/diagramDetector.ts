/**
 * Smart Multi-Language Diagram & Image Requirement Detector
 * Identifies questions requiring diagrams/figures/maps/graphs across Kannada, Hindi, and English,
 * even in previously saved JSON files that do not have `hasDiagram: true` pre-populated.
 * Computes chapter-wise (unit-wise) pending vs. uploaded image counts.
 */

import { QuestionBank, QuestionItem } from '../types/questionBank.ts';

export type ImageFilterMode = 'all' | 'pending' | 'uploaded' | 'all_diagram';

export interface QuestionImageRequirement {
  needsImage: boolean;
  hasImage: boolean;
  hasQuestionImage: boolean;
  hasAnswerImage: boolean;
  isPending: boolean;
  isManuallyDismissed: boolean;
  suggestedSlot: 'question' | 'answer' | 'both';
  reason: string;
}

export interface ChapterImageStat {
  chapterId: string;
  chapterNumber: number;
  chapterName: string;
  totalQuestions: number;
  neededTotal: number;
  uploadedCount: number;
  pendingCount: number;
  questionPages?: string;
  answerPages?: string;
}

export interface BankImageAudit {
  totalQuestions: number;
  totalNeeded: number;
  totalUploaded: number;
  totalPending: number;
  chapters: ChapterImageStat[];
}

// High-precision patterns indicating a question REFERENCES a given image/figure/graph/map
const QUESTION_IMAGE_PATTERNS: Array<{ regex: RegExp; label: string }> = [
  // Kannada: given / shown / observe figure, picture, map, graph, number line
  {
    regex:
      /(ಕೊಟ್ಟಿರುವ\s*(?:ಚಿತ್ರ|ಆಕೃತಿ|ನಕ್ಷೆ|ಭೂಪಟ|ನಕಾಶೆ|ಗ್ರಾಫ್|ಆಕಾರ|ಕೋನ|ತ್ರಿಭುಜ|ವೃತ್ತ|ಆಯತ|ಚೌಕ|ರೇಖೆ|ರೇಖಾಚಿತ್ರ|ಪಟ|ಸಂಖ್ಯಾರೇಖೆ|ಸಂಖ್ಯಾ\s*ರೇಖೆ)|ಕೆಳಗಿನ\s*(?:ಚಿತ್ರ|ಆಕೃತಿ|ನಕ್ಷೆ|ಭೂಪಟ|ನಕಾಶೆ|ಗ್ರಾಫ್|ಆಕಾರ|ಕೋನ|ತ್ರಿಭುಜ|ವೃತ್ತ|ರೇಖಾಚಿತ್ರ|ಪಟ)|ಪಕ್ಕದ\s*(?:ಚಿತ್ರ|ಆಕೃತಿ|ನಕ್ಷೆ|ಪಟ)|ಪಕ್ಕದಲ್ಲಿ\s*ತೋರಿಸಿರುವ|ಮೇಲಿನ\s*(?:ಚಿತ್ರ|ಆಕೃತಿ)|ಚಿತ್ರವನ್ನು\s*(?:ಗಮನಿಸಿ|ನೋಡಿ|ಪರಿಶೀಲಿಸಿ|ವೀಕ್ಷಿಸಿ|ಪೂರ್ಣಗೊಳಿಸಿ)|ಚಿತ್ರದಲ್ಲಿ|ಚಿತ್ರದ\s*ಸಹಾಯದಿಂದ|ಚಿತ್ರಕ್ಕೆ\s*ಸಂಬಂಧಿಸಿದ|ಆಕೃತಿಯಲ್ಲಿ|ಆಕೃತಿಯನ್ನು\s*(?:ಗಮನಿಸಿ|ನೋಡಿ)|ನಕ್ಷೆಯಲ್ಲಿ|ಭೂಪಟದಲ್ಲಿ|ಗ್ರಾಫ್\s*(?:ನೋಡಿ|ಗಮನಿಸಿ|ನಲ್ಲಿ))/i,
    label: 'ಕೊಟ್ಟಿರುವ ಚಿತ್ರ / ಆಕೃತಿ ಆಧಾರಿತ ಪ್ರಶ್ನೆ',
  },
  // Kannada: general figure / map / diagram / graph mention
  {
    regex: /(ರೇಖಾಚಿತ್ರ|ಭೂಪಟ|ನಕಾಶೆ|ಗ್ರಾಫ್|ಸ್ತಂಭ\s*ನಕ್ಷೆ|ವೃತ್ತ\s*ನಕ್ಷೆ|ಚಿತ್ರ\s*ನೋಡಿ|ಚಿತ್ರ\s*ಗಮನಿಸಿ)/i,
    label: 'ನಕ್ಷೆ / ಗ್ರಾಫ್ / ರೇಖಾಚಿತ್ರ ಪ್ರಶ್ನೆ',
  },
  // Hindi: given / observe picture, figure, map, graph
  {
    regex:
      /(दिए\s*गए\s*(?:चित्र|आकृति|मानचित्र|नक्शे|नक्शा|आरेख|ग्राफ|कोण|त्रिभुज)|नीचे\s*दिए\s*गए\s*(?:चित्र|आकृति|मानचित्र)|चित्र\s*(?:देखकर|को\s*देखकर|में|का\s*अवलोकन)|आकृति\s*(?:में|देखकर|को\s*देखकर)|मानचित्र\s*(?:में|पर)|नक्शे\s*(?:में|पर)|रेखाचित्र|ग्राफ)/i,
    label: 'चित्र / आकृति आधारित प्रश्न',
  },
  // English: observe / given / shown figure, diagram, picture, map, graph, chart
  {
    regex:
      /(\b(?:given\s+(?:figure|fig\.?|diagram|picture|image|graph|map|chart|number\s*line)|observe\s+the\s+(?:figure|fig\.?|diagram|picture|image|graph|map|chart)|look\s+at\s+the\s+(?:figure|fig\.?|diagram|picture|image|graph|map)|shown\s+(?:below|above|beside|alongside|in\s+the\s+(?:figure|fig\.?|diagram|picture|map|graph))|from\s+the\s+(?:figure|fig\.?|diagram|graph|map|chart)|in\s+the\s+(?:figure|fig\.?|diagram|picture|map|graph)|adjoining\s+(?:figure|fig\.?|diagram))\b|\bfig\.\s*\d+)/i,
    label: 'Figure / Diagram-based Question',
  },
  // English general diagram nouns
  {
    regex:
      /\b(bar\s*graph|pie\s*chart|histogram|pictograph|number\s*line|ray\s*diagram|circuit\s*diagram|outline\s*map|flowchart|venn\s*diagram)\b/i,
    label: 'Graph / Chart / Map Question',
  },
];

// High-precision patterns indicating the student must DRAW / LABEL a diagram (Answer Key diagram helpful)
const DRAW_OR_LABEL_PATTERNS: Array<{ regex: RegExp; label: string }> = [
  // Kannada draw/label cues
  {
    regex:
      /(ಅಂದವಾದ\s*ಚಿತ್ರ|ಚಿತ್ರ\s*(?:ಬರೆಯಿರಿ|ಬರೆದು|ರಚಿಸಿ|ಎಳೆಯಿರಿ|ಬಿಡಿಸಿ)|ಭಾಗಗಳನ್ನು\s*ಗುರುತಿಸಿ|ಭಾಗವನ್ನು\s*ಗುರುತಿಸಿ|ನಕ್ಷೆ\s*(?:ಬರೆಯಿರಿ|ರಚಿಸಿ|ಯಲ್ಲಿ\s*ಗುರುತಿಸಿ)|ಭೂಪಟದಲ್ಲಿ\s*ಗುರುತಿಸಿ|ಆಕೃತಿ\s*(?:ರಚಿಸಿ|ಬರೆಯಿರಿ|ಬಿಡಿಸಿ)|ರೇಖಾಚಿತ್ರ\s*(?:ಬರೆಯಿರಿ|ರಚಿಸಿ))/i,
    label: 'ಚಿತ್ರ ಬರೆಯಿರಿ / ಭಾಗಗಳನ್ನು ಗುರುತಿಸಿ (ಉತ್ತರ ಚಿತ್ರ)',
  },
  // Hindi draw/label cues
  {
    regex:
      /(नामांकित\s*चित्र|चित्र\s*(?:बनाइए|बनाओ|बनाकर|खींचिए)|आरेख\s*(?:बनाइए|बनाओ)|मानचित्र\s*(?:बनाइए|में\s*दर्शाइए))/i,
    label: 'चित्र बनाइए / नामांकित चित्र',
  },
  // English draw/label cues
  {
    regex:
      /\b(draw\s+(?:a|an|the)?\s*(?:neat|clean|labelled|labeled|suitable|schematic|ray|circuit)?\s*(?:diagram|figure|picture|graph|map|sketch|chart|angle|triangle|circle|number\s*line)|label\s+the\s+(?:parts|diagram|figure)|mark\s+(?:on|in)\s+the\s+(?:map|outline\s*map)|construct\s+(?:a|an|the)\s*(?:triangle|angle|circle|perpendicular|bisector)|plot\s+the\s+(?:graph|points))\b/i,
    label: 'Draw / Label Diagram (Answer Key Image)',
  },
];

// Non-diagram compound words that contain substrings like "ಚಿತ್ರ", "ಆಕೃತಿ", "ನಕ್ಷೆ", "figure", "picture"
// Stripping these prevents hundreds of ordinary text questions from falsely appearing as "ಚಿತ್ರ ಬಾಕಿ"!
const FALSE_POSITIVE_COMPOUND_REGEX =
  /(ವಿಚಿತ್ರ|ಚಲನಚಿತ್ರ|ಚಿತ್ರದುರ್ಗ|ಚಿತ್ರಣ|ಚಿತ್ರಕಲೆ|ಚಿತ್ರಕಾರ|ಚಿತ್ರಗುಪ್ತ|ಚಿತ್ರಪಟ|ಭಾವಚಿತ್ರ|ಸಚಿತ್ರ|ಚಿತ್ರಸಂತೆ|ಚಿತ್ರಹಿಂಸೆ|ನೀಲನಕ್ಷೆ|ನಕ್ಷತ್ರ|ಪ್ರಕೃತಿ|ವಿಕೃತಿ|ಸಂಸ್ಕೃತಿ|ಆಕೃತಿಗೊಳಿಸ|ಚಿತ್ರಿಸು|ಚಿತ್ರಿಸಿ|\bfigure\s+out\b|\bfigures?\s+of\s+speech\b|\bsignificant\s+figures?\b|\bpicture\s+of\s+(?:health|innocence|calm)\b)/gi;

// Broad secondary mention of standalone "ಚಿತ್ರ" / "ಆಕೃತಿ" / "ನಕ್ಷೆ" / "ಭೂಪಟ" / "ಗ್ರಾಫ್" / "diagram"
const GENERAL_IMAGE_MENTION_REGEX =
  /(?:^|[\s,.;:()'"“”‘’\-–])(ಚಿತ್ರ(?:ವನ್ನು|ದಲ್ಲಿ|ದ|ಕ್ಕೆ|ಗಳ|ಗಳು)?|ಆಕೃತಿ(?:ಯನ್ನು|ಯಲ್ಲಿ|ಯ|ಗಳ)?|ನಕ್ಷೆ(?:ಯನ್ನು|ಯಲ್ಲಿ|ಯ)?|ಭೂಪಟ(?:ವನ್ನು|ದಲ್ಲಿ|ದ)?|ಗ್ರಾಫ್|चित्र|आकृति|मानचित्र|\bdiagram\b|\bfigure\b|\bgraph\b|\bmap\b)(?=$|[\s,.;:?()'"“”‘’\-–])/i;

/**
 * Checks whether a question already has at least one uploaded or SVG image attached.
 */
export function hasUploadedImage(q: QuestionItem): boolean {
  return Boolean(
    (typeof q.imageUrl === 'string' && q.imageUrl.trim().length > 0) ||
      (typeof q.imageUrl2 === 'string' && q.imageUrl2.trim().length > 0) ||
      (typeof q.diagramSvg === 'string' && q.diagramSvg.trim().length > 0) ||
      (typeof q.answerImageUrl === 'string' && q.answerImageUrl.trim().length > 0) ||
      (typeof q.answerImageUrl2 === 'string' && q.answerImageUrl2.trim().length > 0) ||
      (typeof q.answerDiagramSvg === 'string' && q.answerDiagramSvg.trim().length > 0)
  );
}

/**
 * Evaluates whether a question needs an image, whether one is already uploaded,
 * and whether it is pending upload.
 */
export function detectImageRequirement(q: QuestionItem): QuestionImageRequirement {
  const hasQuestionImage = Boolean(
    (typeof q.imageUrl === 'string' && q.imageUrl.trim().length > 0) ||
      (typeof q.imageUrl2 === 'string' && q.imageUrl2.trim().length > 0) ||
      (typeof q.diagramSvg === 'string' && q.diagramSvg.trim().length > 0)
  );
  const hasAnswerImage = Boolean(
    (typeof q.answerImageUrl === 'string' && q.answerImageUrl.trim().length > 0) ||
      (typeof q.answerImageUrl2 === 'string' && q.answerImageUrl2.trim().length > 0) ||
      (typeof q.answerDiagramSvg === 'string' && q.answerDiagramSvg.trim().length > 0)
  );
  const hasImage = hasQuestionImage || hasAnswerImage;

  // User explicitly dismissed this question as "No image needed" (unless they later uploaded an image)
  if (q.needsImage === false && !hasImage) {
    return {
      needsImage: false,
      hasImage: false,
      hasQuestionImage: false,
      hasAnswerImage: false,
      isPending: false,
      isManuallyDismissed: true,
      suggestedSlot: 'question',
      reason: '',
    };
  }

  const qText = String(q.question || '');
  const cleanedQText = qText.replace(FALSE_POSITIVE_COMPOUND_REGEX, ' ');
  const aText = String(q.answer || '');
  const cleanedAText = aText.replace(FALSE_POSITIVE_COMPOUND_REGEX, ' ');
  const qType = String(q.questionType || '');
  const optsText = Array.isArray(q.options) ? q.options.join(' ') : '';
  const combinedQuestion = `${cleanedQText} ${optsText.replace(FALSE_POSITIVE_COMPOUND_REGEX, ' ')}`;

  let matchedQuestionCue: string | null = null;
  for (const p of QUESTION_IMAGE_PATTERNS) {
    if (p.regex.test(combinedQuestion)) {
      matchedQuestionCue = p.label;
      break;
    }
  }

  let matchedDrawCue: string | null = null;
  for (const p of DRAW_OR_LABEL_PATTERNS) {
    if (p.regex.test(combinedQuestion)) {
      matchedDrawCue = p.label;
      break;
    }
  }

  const explicitFlag =
    q.needsImage === true ||
    q.hasDiagram === true ||
    Boolean(q.diagramDescription && String(q.diagramDescription).trim()) ||
    Boolean(q.answerDiagramDescription && String(q.answerDiagramDescription).trim());

  const typeIndicatesPicture =
    q.formatCategoryId === 'passage_pic' &&
    /(ಚಿತ್ರ|picture|चित्र|diagram|image)/i.test(`${qType} ${cleanedQText}`);

  const generalMentionInQ = GENERAL_IMAGE_MENTION_REGEX.test(cleanedQText);
  const answerMentionsDiagram =
    /(ಚಿತ್ರದಲ್ಲಿ|ಚಿತ್ರವನ್ನು|ಮೇಲಿನ\s*ಚಿತ್ರ|ಕೆಳಗಿನ\s*ಚಿತ್ರ|ಅಂದವಾದ\s*ಚಿತ್ರ|diagram\s+shown|figure\s+shown|चित्र\s*में)/i.test(
      cleanedAText
    );

  const needsImage = Boolean(
    hasImage ||
      explicitFlag ||
      matchedQuestionCue ||
      matchedDrawCue ||
      typeIndicatesPicture ||
      generalMentionInQ ||
      answerMentionsDiagram
  );

  let suggestedSlot: 'question' | 'answer' | 'both' = 'question';
  if (matchedQuestionCue && matchedDrawCue) {
    suggestedSlot = 'both';
  } else if (matchedDrawCue && !matchedQuestionCue) {
    suggestedSlot = 'answer';
  } else if (
    !matchedQuestionCue &&
    !generalMentionInQ &&
    (answerMentionsDiagram || Boolean(q.answerDiagramDescription))
  ) {
    suggestedSlot = 'answer';
  }

  let reason = '';
  if (q.diagramDescription && String(q.diagramDescription).trim()) {
    reason = String(q.diagramDescription).trim();
  } else if (matchedQuestionCue) {
    reason = matchedQuestionCue;
  } else if (matchedDrawCue) {
    reason = matchedDrawCue;
  } else if (typeIndicatesPicture) {
    reason = 'ಚಿತ್ರ ಆಧಾರಿತ ಪ್ರಶ್ನೆ';
  } else if (generalMentionInQ) {
    reason = 'ಪ್ರಶ್ನೆಯಲ್ಲಿ ಚಿತ್ರ / ಆಕೃತಿ ಉಲ್ಲೇಖವಿದೆ';
  } else if (answerMentionsDiagram) {
    reason = 'ಉತ್ತರದಲ್ಲಿ ಚಿತ್ರ / ಆಕೃತಿ ಉಲ್ಲೇಖವಿದೆ';
  } else if (explicitFlag) {
    reason = 'ಚಿತ್ರ ಅಗತ್ಯ ಎಂದು ಗುರುತಿಸಲಾಗಿದೆ';
  } else if (hasImage) {
    reason = 'ಚಿತ್ರ ಜೋಡಿಸಲಾಗಿದೆ';
  }

  return {
    needsImage,
    hasImage,
    hasQuestionImage,
    hasAnswerImage,
    isPending: needsImage && !hasImage,
    isManuallyDismissed: false,
    suggestedSlot,
    reason,
  };
}

/**
 * Checks whether a question matches the active ImageFilterMode.
 */
export function matchesImageFilter(q: QuestionItem, mode: ImageFilterMode): boolean {
  if (mode === 'all') return true;
  const req = detectImageRequirement(q);
  if (mode === 'pending') return req.isPending;
  if (mode === 'uploaded') return req.hasImage;
  if (mode === 'all_diagram') return req.needsImage || req.hasImage;
  return true;
}

/**
 * Computes overall and chapter-wise (unit-wise) image upload statistics for a QuestionBank.
 */
export function computeBankImageAudit(bank: QuestionBank | null | undefined): BankImageAudit {
  if (!bank || !Array.isArray(bank.chapters)) {
    return {
      totalQuestions: 0,
      totalNeeded: 0,
      totalUploaded: 0,
      totalPending: 0,
      chapters: [],
    };
  }

  let totalQuestions = 0;
  let totalNeeded = 0;
  let totalUploaded = 0;
  let totalPending = 0;

  const chapters: ChapterImageStat[] = bank.chapters.map((ch, idx) => {
    const qs = Array.isArray(ch.questions) ? ch.questions : [];
    let chNeeded = 0;
    let chUploaded = 0;
    let chPending = 0;

    for (const q of qs) {
      const req = detectImageRequirement(q);
      if (req.hasImage) {
        chUploaded++;
        chNeeded++;
      } else if (req.isPending) {
        chPending++;
        chNeeded++;
      }
    }

    totalQuestions += qs.length;
    totalNeeded += chNeeded;
    totalUploaded += chUploaded;
    totalPending += chPending;

    return {
      chapterId: ch.chapterId,
      chapterNumber: ch.chapterNumber ?? idx + 1,
      chapterName: ch.chapterName,
      totalQuestions: qs.length,
      neededTotal: chNeeded,
      uploadedCount: chUploaded,
      pendingCount: chPending,
      questionPages: ch.questionPages,
      answerPages: ch.answerPages,
    };
  });

  return {
    totalQuestions,
    totalNeeded,
    totalUploaded,
    totalPending,
    chapters,
  };
}
