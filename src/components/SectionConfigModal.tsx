/**
 * Section Configurator Modal: ವಿಭಾಗವಾರು ಪ್ರಶ್ನೆಗಳ ಹೊಂದಾಣಿಕೆ (Section-wise Configuration)
 * Allows teachers to customize question count and marks per section as requested by the user.
 * Author: M I Nilaji / S R Angadi
 */

import React, { useState } from 'react';
import { SectionBlueprint, STANDARD_QUESTION_FORMATS } from '../types/questionBank.ts';
import { X, Plus, Trash2, CheckCircle2, Sliders, Sparkles } from 'lucide-react';

interface SectionConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  sections: SectionBlueprint[];
  targetMarks: number;
  targetQuestionsCount: number;
  onApplySections: (newSections: SectionBlueprint[], updatedMarks: number, updatedCount: number) => void;
}

const ROMAN_NUMERALS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];

export const SectionConfigModal: React.FC<SectionConfigModalProps> = ({
  isOpen,
  onClose,
  sections: initialSections,
  targetMarks,
  targetQuestionsCount,
  onApplySections,
}) => {
  const [localSections, setLocalSections] = useState<SectionBlueprint[]>(() =>
    JSON.parse(JSON.stringify(initialSections))
  );

  if (!isOpen) return null;

  // Calculate live totals
  const totalQuestions = localSections.reduce((acc, s) => acc + (s.questionCount || 0), 0);
  const totalMarks = localSections.reduce(
    (acc, s) => acc + (s.questionCount || 0) * (s.marksPerQuestion || 1),
    0
  );

  const handleUpdateSection = (
    index: number,
    field: keyof SectionBlueprint,
    value: string | number
  ) => {
    setLocalSections(prev => {
      const copy = [...prev];
      copy[index] = {
        ...copy[index],
        [field]: value,
      };
      return copy;
    });
  };

  const handleDeleteSection = (index: number) => {
    if (localSections.length <= 1) {
      alert('ಕನಿಷ್ಠ ಒಂದು ವಿಭಾಗವಿರಬೇಕು (At least one section is required).');
      return;
    }
    setLocalSections(prev => {
      const filtered = prev.filter((_, i) => i !== index);
      return filtered.map((s, idx) => ({
        ...s,
        sectionRoman: ROMAN_NUMERALS[idx] || `${idx + 1}`,
        title: s.title.replace(/ವಿಭಾಗ - [IVXLCDM\d]+/, `ವಿಭಾಗ - ${ROMAN_NUMERALS[idx] || idx + 1}`),
      }));
    });
  };

  const handleAddSection = () => {
    const nextIdx = localSections.length;
    const newSec: SectionBlueprint = {
      id: `sec_custom_${Date.now()}_${nextIdx}`,
      sectionRoman: ROMAN_NUMERALS[nextIdx] || `${nextIdx + 1}`,
      title: `ವಿಭಾಗ - ${ROMAN_NUMERALS[nextIdx] || nextIdx + 1} : ಹೊಸ ವಿಭಾಗ`,
      instructionText: 'ಕೆಳಗಿನ ಪ್ರಶ್ನೆಗಳಿಗೆ ಉತ್ತರಿಸಿ:',
      questionType: 'ಕಿರು ಉತ್ತರ',
      formatCategoryId: 'short_2m',
      selectedChapterIds: [],
      selectedLearningOutcomes: ['all'],
      difficulty: 'all',
      marksPerQuestion: 2,
      questionCount: 3,
    };
    setLocalSections(prev => [...prev, newSec]);
  };

  // Presets
  const applyPreset = (presetType: '40m_24q_dsert1' | '40m_24q_dsert2' | '40m_23q' | '25m_16q' | '50m_26q' | '80m_38q') => {
    if (presetType === '40m_24q_dsert1') {
      setLocalSections([
        {
          id: `sec_mcq_${Date.now()}_1`,
          sectionRoman: 'I',
          title: 'ವಿಭಾಗ - I : ವಸ್ತುನಿಷ್ಠ ಪ್ರಶ್ನೆಗಳು (MCQ)',
          instructionText: 'ಕೆಳಗಿನ ಪ್ರಶ್ನೆಗಳಿಗೆ ನೀಡಲಾದ ನಾಲ್ಕು ಆಯ್ಕೆಗಳಲ್ಲಿ ಸರಿಯಾದ ಉತ್ತರವನ್ನು ಆರಿಸಿ ಬರೆಯಿರಿ:',
          questionType: 'ವಸ್ತುನಿಷ್ಠ (MCQ)',
          formatCategoryId: 'mcq',
          selectedChapterIds: [],
          selectedLearningOutcomes: ['all'],
          difficulty: 'all',
          marksPerQuestion: 1,
          questionCount: 4,
        },
        {
          id: `sec_vsa_${Date.now()}_2`,
          sectionRoman: 'II',
          title: 'ವಿಭಾಗ - II : ಕಿರು ಉತ್ತರ ಪ್ರಶ್ನೆಗಳು (1M)',
          instructionText: 'ಕೆಳಗಿನ ಪ್ರಶ್ನೆಗಳಿಗೆ ಒಂದು ವಾಕ್ಯದಲ್ಲಿ ಉತ್ತರಿಸಿ / ಬಿಟ್ಟ ಸ್ಥಳ ತುಂಬಿರಿ:',
          questionType: 'ಕಿರು ಉತ್ತರ - 1 (1M)',
          formatCategoryId: 'one_sentence',
          selectedChapterIds: [],
          selectedLearningOutcomes: ['all'],
          difficulty: 'all',
          marksPerQuestion: 1,
          questionCount: 11,
        },
        {
          id: `sec_sa_${Date.now()}_3`,
          sectionRoman: 'III',
          title: 'ವಿಭಾಗ - III : ಕಿರು ಉತ್ತರ ಪ್ರಶ್ನೆಗಳು (2M)',
          instructionText: 'ಕೆಳಗಿನ ಪ್ರಶ್ನೆಗಳಿಗೆ ೨-೩ ವಾಕ್ಯಗಳಲ್ಲಿ ಉತ್ತರಿಸಿ:',
          questionType: 'ಕಿರು ಉತ್ತರ - 2 (2M)',
          formatCategoryId: 'short_2m',
          selectedChapterIds: [],
          selectedLearningOutcomes: ['all'],
          difficulty: 'all',
          marksPerQuestion: 2,
          questionCount: 5,
        },
        {
          id: `sec_la1_${Date.now()}_4`,
          sectionRoman: 'IV',
          title: 'ವಿಭಾಗ - IV : ದೀರ್ಘ ಉತ್ತರ ಪ್ರಶ್ನೆಗಳು (3M)',
          instructionText: 'ಕೆಳಗಿನ ಪ್ರಶ್ನೆಗಳಿಗೆ ವಿವರವಾಗಿ ಉತ್ತರಿಸಿ:',
          questionType: 'ದೀರ್ಘ ಉತ್ತರ - 1 (3M)',
          formatCategoryId: 'short_3m',
          selectedChapterIds: [],
          selectedLearningOutcomes: ['all'],
          difficulty: 'all',
          marksPerQuestion: 3,
          questionCount: 1,
        },
        {
          id: `sec_la2_${Date.now()}_5`,
          sectionRoman: 'V',
          title: 'ವಿಭಾಗ - V : ದೀರ್ಘ ಉತ್ತರ / ಚಿತ್ರ / ರಚನೆ (4M)',
          instructionText: 'ಕೆಳಗಿನ ಪ್ರಶ್ನೆಗಳಿಗೆ ಸಮಗ್ರವಾಗಿ ಉತ್ತರಿಸಿ / ಚಿತ್ರ ರಚಿಸಿ:',
          questionType: 'ದೀರ್ಘ ಉತ್ತರ - 2 (4M)',
          formatCategoryId: 'long_4m',
          selectedChapterIds: [],
          selectedLearningOutcomes: ['all'],
          difficulty: 'all',
          marksPerQuestion: 4,
          questionCount: 3,
        },
      ]);
    } else if (presetType === '40m_24q_dsert2') {
      setLocalSections([
        {
          id: `sec_mcq_${Date.now()}_1`,
          sectionRoman: 'I',
          title: 'ವಿಭಾಗ - I : ಬಹು ಆಯ್ಕೆ ಪ್ರಶ್ನೆಗಳು (MCQ)',
          instructionText: 'ಕೆಳಗಿನ ಪ್ರಶ್ನೆಗಳಿಗೆ ಸರಿಯಾದ ಉತ್ತರವನ್ನು ಆರಿಸಿ ಬರೆಯಿರಿ:',
          questionType: 'ವಸ್ತುನಿಷ್ಠ (MCQ)',
          formatCategoryId: 'mcq',
          selectedChapterIds: [],
          selectedLearningOutcomes: ['all'],
          difficulty: 'all',
          marksPerQuestion: 1,
          questionCount: 4,
        },
        {
          id: `sec_vsa_${Date.now()}_2`,
          sectionRoman: 'II',
          title: 'ವಿಭಾಗ - II : ಒಂದು ವಾಕ್ಯದ ಪ್ರಶ್ನೆಗಳು (1M)',
          instructionText: 'ಕೆಳಗಿನ ಪ್ರಶ್ನೆಗಳಿಗೆ ಒಂದು ವಾಕ್ಯದಲ್ಲಿ ಉತ್ತರಿಸಿ:',
          questionType: 'ಕಿರು ಉತ್ತರ - 1 (1M)',
          formatCategoryId: 'one_sentence',
          selectedChapterIds: [],
          selectedLearningOutcomes: ['all'],
          difficulty: 'all',
          marksPerQuestion: 1,
          questionCount: 9,
        },
        {
          id: `sec_sa_${Date.now()}_3`,
          sectionRoman: 'III',
          title: 'ವಿಭಾಗ - III : ಕಿರು ಉತ್ತರ ಪ್ರಶ್ನೆಗಳು (2M)',
          instructionText: 'ಕೆಳಗಿನ ಪ್ರಶ್ನೆಗಳಿಗೆ ೨-೩ ವಾಕ್ಯಗಳಲ್ಲಿ ಉತ್ತರಿಸಿ:',
          questionType: 'ಕಿರು ಉತ್ತರ - 2 (2M)',
          formatCategoryId: 'short_2m',
          selectedChapterIds: [],
          selectedLearningOutcomes: ['all'],
          difficulty: 'all',
          marksPerQuestion: 2,
          questionCount: 7,
        },
        {
          id: `sec_la1_${Date.now()}_4`,
          sectionRoman: 'IV',
          title: 'ವಿಭಾಗ - IV : ೩ ಅಂಕದ ಪ್ರಶ್ನೆಗಳು (3M)',
          instructionText: 'ಕೆಳಗಿನ ಪ್ರಶ್ನೆಗಳಿಗೆ ಉತ್ತರಿಸಿ:',
          questionType: 'ದೀರ್ಘ ಉತ್ತರ - 1 (3M)',
          formatCategoryId: 'short_3m',
          selectedChapterIds: [],
          selectedLearningOutcomes: ['all'],
          difficulty: 'all',
          marksPerQuestion: 3,
          questionCount: 3,
        },
        {
          id: `sec_la2_${Date.now()}_5`,
          sectionRoman: 'V',
          title: 'ವಿಭಾಗ - V : ದೀರ್ಘ ಉತ್ತರ / ರಚನೆ (4M)',
          instructionText: 'ಕೆಳಗಿನ ಪ್ರಶ್ನೆಗೆ ಉತ್ತರಿಸಿ / ರಚಿಸಿ:',
          questionType: 'ದೀರ್ಘ ಉತ್ತರ - 2 (4M)',
          formatCategoryId: 'long_4m',
          selectedChapterIds: [],
          selectedLearningOutcomes: ['all'],
          difficulty: 'all',
          marksPerQuestion: 4,
          questionCount: 1,
        },
      ]);
    } else if (presetType === '40m_23q') {
      setLocalSections([
        {
          id: `sec_mcq_${Date.now()}_1`,
          sectionRoman: 'I',
          title: 'ವಿಭಾಗ - I : ಬಹು ಆಯ್ಕೆ ಪ್ರಶ್ನೆಗಳು (MCQ)',
          instructionText: 'ಸರಿಯಾದ ಉತ್ತರವನ್ನು ಆರಿಸಿ ಬರೆಯಿರಿ:',
          questionType: 'ವಸ್ತುನಿಷ್ಠ (MCQ)',
          formatCategoryId: 'mcq',
          selectedChapterIds: [],
          selectedLearningOutcomes: ['all'],
          difficulty: 'all',
          marksPerQuestion: 1,
          questionCount: 4,
        },
        {
          id: `sec_vsa_${Date.now()}_2`,
          sectionRoman: 'II',
          title: 'ವಿಭಾಗ - II : ಒಂದು ವಾಕ್ಯದ ಪ್ರಶ್ನೆಗಳು (1M)',
          instructionText: 'ಒಂದು ವಾಕ್ಯದಲ್ಲಿ ಉತ್ತರಿಸಿ:',
          questionType: 'ಕಿರು ಉತ್ತರ - 1 (1M)',
          formatCategoryId: 'one_sentence',
          selectedChapterIds: [],
          selectedLearningOutcomes: ['all'],
          difficulty: 'all',
          marksPerQuestion: 1,
          questionCount: 10,
        },
        {
          id: `sec_sa_${Date.now()}_3`,
          sectionRoman: 'III',
          title: 'ವಿಭಾಗ - III : ಕಿರು ಉತ್ತರ ಪ್ರಶ್ನೆಗಳು (2M)',
          instructionText: '೨-೩ ವಾಕ್ಯಗಳಲ್ಲಿ ಉತ್ತರಿಸಿ:',
          questionType: 'ಕಿರು ಉತ್ತರ - 2 (2M)',
          formatCategoryId: 'short_2m',
          selectedChapterIds: [],
          selectedLearningOutcomes: ['all'],
          difficulty: 'all',
          marksPerQuestion: 2,
          questionCount: 5,
        },
        {
          id: `sec_la1_${Date.now()}_4`,
          sectionRoman: 'IV',
          title: 'ವಿಭಾಗ - IV : ೩ ಅಂಕದ ಪ್ರಶ್ನೆಗಳು (3M)',
          instructionText: 'ವಿವರವಾಗಿ ಉತ್ತರಿಸಿ:',
          questionType: 'ದೀರ್ಘ ಉತ್ತರ - 1 (3M)',
          formatCategoryId: 'short_3m',
          selectedChapterIds: [],
          selectedLearningOutcomes: ['all'],
          difficulty: 'all',
          marksPerQuestion: 3,
          questionCount: 2,
        },
        {
          id: `sec_la2_${Date.now()}_5`,
          sectionRoman: 'V',
          title: 'ವಿಭಾಗ - V : ದೀರ್ಘ ಉತ್ತರ ಪ್ರಶ್ನೆಗಳು (4M)',
          instructionText: 'ಸಮಗ್ರವಾಗಿ ಉತ್ತರಿಸಿ:',
          questionType: 'ದೀರ್ಘ ಉತ್ತರ - 2 (4M)',
          formatCategoryId: 'long_4m',
          selectedChapterIds: [],
          selectedLearningOutcomes: ['all'],
          difficulty: 'all',
          marksPerQuestion: 4,
          questionCount: 2,
        },
      ]);
    } else if (presetType === '25m_16q') {
      setLocalSections([
        {
          id: `sec_mcq_${Date.now()}_1`,
          sectionRoman: 'I',
          title: 'ವಿಭಾಗ - I : ಬಹು ಆಯ್ಕೆ ಪ್ರಶ್ನೆಗಳು (MCQ)',
          instructionText: 'ಸರಿಯಾದ ಉತ್ತರವನ್ನು ಆರಿಸಿ ಬರೆಯಿರಿ:',
          questionType: 'ವಸ್ತುನಿಷ್ಠ (MCQ)',
          formatCategoryId: 'mcq',
          selectedChapterIds: [],
          selectedLearningOutcomes: ['all'],
          difficulty: 'all',
          marksPerQuestion: 1,
          questionCount: 4,
        },
        {
          id: `sec_vsa_${Date.now()}_2`,
          sectionRoman: 'II',
          title: 'ವಿಭಾಗ - II : ಒಂದು ವಾಕ್ಯದ ಪ್ರಶ್ನೆಗಳು (1M)',
          instructionText: 'ಒಂದು ವಾಕ್ಯದಲ್ಲಿ ಉತ್ತರಿಸಿ:',
          questionType: 'ಕಿರು ಉತ್ತರ - 1 (1M)',
          formatCategoryId: 'one_sentence',
          selectedChapterIds: [],
          selectedLearningOutcomes: ['all'],
          difficulty: 'all',
          marksPerQuestion: 1,
          questionCount: 5,
        },
        {
          id: `sec_sa_${Date.now()}_3`,
          sectionRoman: 'III',
          title: 'ವಿಭಾಗ - III : ಕಿರು ಉತ್ತರ ಪ್ರಶ್ನೆಗಳು (2M)',
          instructionText: '೨-೩ ವಾಕ್ಯಗಳಲ್ಲಿ ಉತ್ತರಿಸಿ:',
          questionType: 'ಕಿರು ಉತ್ತರ - 2 (2M)',
          formatCategoryId: 'short_2m',
          selectedChapterIds: [],
          selectedLearningOutcomes: ['all'],
          difficulty: 'all',
          marksPerQuestion: 2,
          questionCount: 4,
        },
        {
          id: `sec_la1_${Date.now()}_4`,
          sectionRoman: 'IV',
          title: 'ವಿಭಾಗ - IV : ೩ ಅಂಕದ ಪ್ರಶ್ನೆಗಳು (3M)',
          instructionText: 'ವಿವರವಾಗಿ ಉತ್ತರಿಸಿ:',
          questionType: 'ದೀರ್ಘ ಉತ್ತರ - 1 (3M)',
          formatCategoryId: 'short_3m',
          selectedChapterIds: [],
          selectedLearningOutcomes: ['all'],
          difficulty: 'all',
          marksPerQuestion: 3,
          questionCount: 2,
        },
        {
          id: `sec_la2_${Date.now()}_5`,
          sectionRoman: 'V',
          title: 'ವಿಭಾಗ - V : ದೀರ್ಘ ಪ್ರಶ್ನೆ / ನಕ್ಷೆ (2M)',
          instructionText: 'ಕೆಳಗಿನ ಪ್ರಶ್ನೆಗೆ ಉತ್ತರಿಸಿ:',
          questionType: 'ದೀರ್ಘ ಉತ್ತರ - 2 (2M)',
          formatCategoryId: 'short_2m',
          selectedChapterIds: [],
          selectedLearningOutcomes: ['all'],
          difficulty: 'all',
          marksPerQuestion: 2,
          questionCount: 1,
        },
      ]);
    } else if (presetType === '50m_26q') {
      setLocalSections([
        {
          id: `sec_mcq_${Date.now()}_1`,
          sectionRoman: 'I',
          title: 'ವಿಭಾಗ - I : ಬಹು ಆಯ್ಕೆ ಪ್ರಶ್ನೆಗಳು (MCQ)',
          instructionText: 'ಸರಿಯಾದ ಉತ್ತರವನ್ನು ಆರಿಸಿ ಬರೆಯಿರಿ:',
          questionType: 'ವಸ್ತುನಿಷ್ಠ (MCQ)',
          formatCategoryId: 'mcq',
          selectedChapterIds: [],
          selectedLearningOutcomes: ['all'],
          difficulty: 'all',
          marksPerQuestion: 1,
          questionCount: 6,
        },
        {
          id: `sec_vsa_${Date.now()}_2`,
          sectionRoman: 'II',
          title: 'ವಿಭಾಗ - II : ಒಂದು ವಾಕ್ಯದ ಪ್ರಶ್ನೆಗಳು (1M)',
          instructionText: 'ಒಂದು ವಾಕ್ಯದಲ್ಲಿ ಉತ್ತರಿಸಿ:',
          questionType: 'ಕಿರು ಉತ್ತರ - 1 (1M)',
          formatCategoryId: 'one_sentence',
          selectedChapterIds: [],
          selectedLearningOutcomes: ['all'],
          difficulty: 'all',
          marksPerQuestion: 1,
          questionCount: 8,
        },
        {
          id: `sec_sa_${Date.now()}_3`,
          sectionRoman: 'III',
          title: 'ವಿಭಾಗ - III : ಕಿರು ಉತ್ತರ ಪ್ರಶ್ನೆಗಳು (2M)',
          instructionText: '೨-೩ ವಾಕ್ಯಗಳಲ್ಲಿ ಉತ್ತರಿಸಿ:',
          questionType: 'ಕಿರು ಉತ್ತರ - 2 (2M)',
          formatCategoryId: 'short_2m',
          selectedChapterIds: [],
          selectedLearningOutcomes: ['all'],
          difficulty: 'all',
          marksPerQuestion: 2,
          questionCount: 6,
        },
        {
          id: `sec_la1_${Date.now()}_4`,
          sectionRoman: 'IV',
          title: 'ವಿಭಾಗ - IV : ೩ ಅಂಕದ ಪ್ರಶ್ನೆಗಳು (3M)',
          instructionText: 'ವಿವರವಾಗಿ ಉತ್ತರಿಸಿ:',
          questionType: 'ದೀರ್ಘ ಉತ್ತರ - 1 (3M)',
          formatCategoryId: 'short_3m',
          selectedChapterIds: [],
          selectedLearningOutcomes: ['all'],
          difficulty: 'all',
          marksPerQuestion: 3,
          questionCount: 4,
        },
        {
          id: `sec_la2_${Date.now()}_5`,
          sectionRoman: 'V',
          title: 'ವಿಭಾಗ - V : ದೀರ್ಘ ಉತ್ತರ ಪ್ರಶ್ನೆಗಳು (4M)',
          instructionText: 'ಸಮಗ್ರವಾಗಿ ಉತ್ತರಿಸಿ:',
          questionType: 'ದೀರ್ಘ ಉತ್ತರ - 2 (4M)',
          formatCategoryId: 'long_4m',
          selectedChapterIds: [],
          selectedLearningOutcomes: ['all'],
          difficulty: 'all',
          marksPerQuestion: 4,
          questionCount: 3,
        },
      ]);
    } else if (presetType === '80m_38q') {
      setLocalSections([
        {
          id: `sec_mcq_${Date.now()}_1`,
          sectionRoman: 'I',
          title: 'ವಿಭಾಗ - I : ಬಹು ಆಯ್ಕೆ ಪ್ರಶ್ನೆಗಳು (MCQ)',
          instructionText: 'ಸರಿಯಾದ ಉತ್ತರವನ್ನು ಆರಿಸಿ ಬರೆಯಿರಿ:',
          questionType: 'ವಸ್ತುನಿಷ್ಠ (MCQ)',
          formatCategoryId: 'mcq',
          selectedChapterIds: [],
          selectedLearningOutcomes: ['all'],
          difficulty: 'all',
          marksPerQuestion: 1,
          questionCount: 8,
        },
        {
          id: `sec_vsa_${Date.now()}_2`,
          sectionRoman: 'II',
          title: 'ವಿಭಾಗ - II : ಒಂದು ವಾಕ್ಯದ ಪ್ರಶ್ನೆಗಳು (1M)',
          instructionText: 'ಒಂದು ವಾಕ್ಯದಲ್ಲಿ ಉತ್ತರಿಸಿ:',
          questionType: 'ಕಿರು ಉತ್ತರ - 1 (1M)',
          formatCategoryId: 'one_sentence',
          selectedChapterIds: [],
          selectedLearningOutcomes: ['all'],
          difficulty: 'all',
          marksPerQuestion: 1,
          questionCount: 12,
        },
        {
          id: `sec_sa_${Date.now()}_3`,
          sectionRoman: 'III',
          title: 'ವಿಭಾಗ - III : ಕಿರು ಉತ್ತರ ಪ್ರಶ್ನೆಗಳು (2M)',
          instructionText: '೨-೩ ವಾಕ್ಯಗಳಲ್ಲಿ ಉತ್ತರಿಸಿ:',
          questionType: 'ಕಿರು ಉತ್ತರ - 2 (2M)',
          formatCategoryId: 'short_2m',
          selectedChapterIds: [],
          selectedLearningOutcomes: ['all'],
          difficulty: 'all',
          marksPerQuestion: 2,
          questionCount: 10,
        },
        {
          id: `sec_la1_${Date.now()}_4`,
          sectionRoman: 'IV',
          title: 'ವಿಭಾಗ - IV : ೩ ಅಂಕದ ಪ್ರಶ್ನೆಗಳು (3M)',
          instructionText: 'ವಿವರವಾಗಿ ಉತ್ತರಿಸಿ:',
          questionType: 'ದೀರ್ಘ ಉತ್ತರ - 1 (3M)',
          formatCategoryId: 'short_3m',
          selectedChapterIds: [],
          selectedLearningOutcomes: ['all'],
          difficulty: 'all',
          marksPerQuestion: 3,
          questionCount: 5,
        },
        {
          id: `sec_la2_${Date.now()}_5`,
          sectionRoman: 'V',
          title: 'ವಿಭಾಗ - V : ದೀರ್ಘ ಉತ್ತರ / ಚಿತ್ರ / ರಚನೆ (4M)',
          instructionText: 'ಸಮಗ್ರವಾಗಿ ಉತ್ತರಿಸಿ:',
          questionType: 'ದೀರ್ಘ ಉತ್ತರ - 2 (4M)',
          formatCategoryId: 'long_4m',
          selectedChapterIds: [],
          selectedLearningOutcomes: ['all'],
          difficulty: 'all',
          marksPerQuestion: 4,
          questionCount: 3,
        },
      ]);
    }
  };

  const handleApply = () => {
    onApplySections(localSections, totalMarks, totalQuestions);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-slate-900/60 backdrop-blur-xs font-kannada">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-slate-200 bg-linear-to-r from-slate-900 via-indigo-950 to-slate-900 text-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/10 border border-white/20 flex items-center justify-center">
              <Sliders className="w-5 h-5 text-amber-300" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-black tracking-tight text-white flex items-center gap-2">
                <span>ವಿಭಾಗವಾರು ಪ್ರಶ್ನೆಗಳ ಹೊಂದಾಣಿಕೆ (Section-wise Configuration)</span>
              </h2>
              <p className="text-2xs sm:text-xs text-slate-300 font-medium">
                ಪ್ರತಿ ವಿಭಾಗದ ಪ್ರಶ್ನೆಗಳ ಸಂಖ್ಯೆ ಹಾಗೂ ಅಂಕಗಳನ್ನು ನಿಮ್ಮ ಅವಶ್ಯಕತೆಗೆ ತಕ್ಕಂತೆ ಬದಲಾಯಿಸಿ.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Preset Quick Selection Bar */}
        <div className="px-4 sm:px-6 py-2.5 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center gap-2 shrink-0">
          <span className="text-2xs font-bold text-slate-600 flex items-center gap-1">
            <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
            <span>ಮಾದರಿಗಳು (Presets):</span>
          </span>
          <button
            type="button"
            onClick={() => applyPreset('40m_24q_dsert1')}
            className="px-2.5 py-1 text-2xs font-bold rounded-lg bg-emerald-50 text-emerald-800 border border-emerald-300 hover:bg-emerald-100 transition-colors cursor-pointer"
          >
            ೪೦ ಅಂಕ / ೨೪ ಪ್ರಶ್ನೆಗಳು (DSERT ಮಾದರಿ ೧)
          </button>
          <button
            type="button"
            onClick={() => applyPreset('40m_24q_dsert2')}
            className="px-2.5 py-1 text-2xs font-bold rounded-lg bg-indigo-50 text-indigo-800 border border-indigo-300 hover:bg-indigo-100 transition-colors cursor-pointer"
          >
            ೪೦ ಅಂಕ / ೨೪ ಪ್ರಶ್ನೆಗಳು (ಮಾದರಿ ೨)
          </button>
          <button
            type="button"
            onClick={() => applyPreset('40m_23q')}
            className="px-2.5 py-1 text-2xs font-bold rounded-lg bg-blue-50 text-blue-800 border border-blue-300 hover:bg-blue-100 transition-colors cursor-pointer"
          >
            ೪೦ ಅಂಕ / ೨೩ ಪ್ರಶ್ನೆಗಳು
          </button>
          <button
            type="button"
            onClick={() => applyPreset('25m_16q')}
            className="px-2.5 py-1 text-2xs font-bold rounded-lg bg-amber-50 text-amber-800 border border-amber-300 hover:bg-amber-100 transition-colors cursor-pointer"
          >
            ೨೫ ಅಂಕ (FA ಕಿರು ಪರೀಕ್ಷೆ)
          </button>
          <button
            type="button"
            onClick={() => applyPreset('50m_26q')}
            className="px-2.5 py-1 text-2xs font-bold rounded-lg bg-purple-50 text-purple-800 border border-purple-300 hover:bg-purple-100 transition-colors cursor-pointer"
          >
            ೫೦ ಅಂಕ
          </button>
          <button
            type="button"
            onClick={() => applyPreset('80m_38q')}
            className="px-2.5 py-1 text-2xs font-bold rounded-lg bg-rose-50 text-rose-800 border border-rose-300 hover:bg-rose-100 transition-colors cursor-pointer"
          >
            ೮೦ ಅಂಕ (ವಾರ್ಷಿಕ)
          </button>
        </div>

        {/* Scrollable Body: List of Section Cards */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-3.5 bg-slate-50/50">
          {localSections.map((sec, idx) => {
            const secTotalMarks = (sec.questionCount || 0) * (sec.marksPerQuestion || 1);

            return (
              <div
                key={sec.id || idx}
                className="bg-white border-2 border-slate-200 rounded-xl p-4 shadow-2xs hover:border-indigo-400 transition-all space-y-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2.5">
                  <div className="flex items-center gap-2">
                    <span className="w-7 h-7 rounded-lg bg-indigo-600 text-white font-black text-xs flex items-center justify-center">
                      {sec.sectionRoman}
                    </span>
                    <input
                      type="text"
                      value={sec.title}
                      onChange={e => handleUpdateSection(idx, 'title', e.target.value)}
                      className="font-bold text-slate-900 text-xs sm:text-sm bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1 focus:ring-1 focus:ring-indigo-600 focus:outline-hidden min-w-[200px]"
                    />
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="px-2.5 py-1 rounded-md text-xs font-black bg-amber-100 text-amber-900 border border-amber-300">
                      ವಿಭಾಗದ ಒಟ್ಟು: {secTotalMarks} ಅಂಕ
                    </span>
                    <button
                      type="button"
                      onClick={() => handleDeleteSection(idx)}
                      className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                      title="ವಿಭಾಗವನ್ನು ಅಳಿಸಿ"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-center text-xs">
                  {/* Format Category Selector */}
                  <div className="sm:col-span-5 space-y-1">
                    <label className="block text-2xs font-bold text-slate-600 uppercase">
                      ಪ್ರಶ್ನೆ ಪ್ರಕಾರ (Format)
                    </label>
                    <select
                      value={sec.formatCategoryId}
                      onChange={e => {
                        const fmtId = e.target.value;
                        const fmtDef = STANDARD_QUESTION_FORMATS.find(f => f.id === fmtId);
                        handleUpdateSection(idx, 'formatCategoryId', fmtId);
                        if (fmtDef) {
                          handleUpdateSection(idx, 'marksPerQuestion', fmtDef.marks);
                          handleUpdateSection(idx, 'questionType', fmtDef.name);
                        }
                      }}
                      className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 font-bold text-slate-800 focus:outline-hidden cursor-pointer"
                    >
                      {STANDARD_QUESTION_FORMATS.map(fmt => (
                        <option key={fmt.id} value={fmt.id}>
                          {fmt.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Number of Questions */}
                  <div className="sm:col-span-3 space-y-1">
                    <label className="block text-2xs font-bold text-slate-600 uppercase">
                      ಪ್ರಶ್ನೆಗಳ ಸಂಖ್ಯೆ
                    </label>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() =>
                          handleUpdateSection(idx, 'questionCount', Math.max(1, (sec.questionCount || 1) - 1))
                        }
                        className="w-7 h-7 rounded-lg bg-slate-100 hover:bg-slate-200 font-bold text-slate-800 flex items-center justify-center cursor-pointer"
                      >
                        -
                      </button>
                      <input
                        type="number"
                        min={1}
                        max={40}
                        value={sec.questionCount}
                        onChange={e =>
                          handleUpdateSection(idx, 'questionCount', Math.max(1, parseInt(e.target.value, 10) || 1))
                        }
                        className="w-14 text-center bg-slate-50 border border-slate-200 rounded-lg py-1 font-black text-slate-900 text-xs focus:outline-hidden"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          handleUpdateSection(idx, 'questionCount', (sec.questionCount || 1) + 1)
                        }
                        className="w-7 h-7 rounded-lg bg-slate-100 hover:bg-slate-200 font-bold text-slate-800 flex items-center justify-center cursor-pointer"
                      >
                        +
                      </button>
                    </div>
                  </div>

                  {/* Marks Per Question */}
                  <div className="sm:col-span-4 space-y-1">
                    <label className="block text-2xs font-bold text-slate-600 uppercase">
                      ಪ್ರತಿ ಪ್ರಶ್ನೆಗೆ ಅಂಕ
                    </label>
                    <div className="flex items-center gap-1.5">
                      <select
                        value={sec.marksPerQuestion}
                        onChange={e =>
                          handleUpdateSection(idx, 'marksPerQuestion', parseInt(e.target.value, 10) || 1)
                        }
                        className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 font-bold text-slate-900 focus:outline-hidden cursor-pointer"
                      >
                        <option value={1}>೧ ಅಂಕ (1 Mark)</option>
                        <option value={2}>೨ ಅಂಕಗಳು (2 Marks)</option>
                        <option value={3}>೩ ಅಂಕಗಳು (3 Marks)</option>
                        <option value={4}>೪ ಅಂಕಗಳು (4 Marks)</option>
                        <option value={5}>೫ ಅಂಕಗಳು (5 Marks)</option>
                      </select>
                    </div>
                  </div>
                </div>

                {/* Instruction Line */}
                <div className="pt-1">
                  <input
                    type="text"
                    value={sec.instructionText}
                    onChange={e => handleUpdateSection(idx, 'instructionText', e.target.value)}
                    placeholder="ಸೂಚನೆ (ಉದಾ: ಕೆಳಗಿನ ಪ್ರಶ್ನೆಗಳಿಗೆ ಉತ್ತರಿಸಿ:)"
                    className="w-full text-2xs text-slate-600 bg-slate-50/70 border border-slate-200/70 rounded-lg px-2.5 py-1 focus:outline-hidden"
                  />
                </div>
              </div>
            );
          })}

          <button
            type="button"
            onClick={handleAddSection}
            className="w-full py-2.5 border-2 border-dashed border-indigo-300 hover:border-indigo-500 rounded-xl text-indigo-700 bg-indigo-50/40 hover:bg-indigo-50 font-bold text-xs flex items-center justify-center gap-2 transition-colors cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>ಹೊಸ ವಿಭಾಗವನ್ನು ಸೇರಿಸಿ (+ Add Section)</span>
          </button>
        </div>

        {/* Footer Summary & Action Buttons */}
        <div className="p-4 sm:p-5 border-t border-slate-200 bg-white flex flex-col sm:flex-row items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3 text-xs font-bold">
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 border border-slate-200">
              <span className="text-slate-500">ಒಟ್ಟು ವಿಭಾಗಗಳು:</span>
              <span className="text-slate-900 font-black">{localSections.length}</span>
            </div>
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-50 border border-indigo-200">
              <span className="text-indigo-700">ಒಟ್ಟು ಪ್ರಶ್ನೆಗಳು:</span>
              <span className="text-indigo-950 font-black">{totalQuestions}</span>
            </div>
            <div
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border ${
                totalMarks === 40
                  ? 'bg-emerald-50 border-emerald-300 text-emerald-900'
                  : 'bg-amber-50 border-amber-300 text-amber-900'
              }`}
            >
              <span>ಒಟ್ಟು ಅಂಕಗಳು:</span>
              <span className="font-black text-sm">{totalMarks}</span>
            </div>
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 sm:flex-none px-4 py-2 border border-slate-300 hover:bg-slate-100 text-slate-700 font-bold text-xs rounded-xl transition-colors cursor-pointer"
            >
              ರದ್ದುಮಾಡಿ (Cancel)
            </button>
            <button
              type="button"
              onClick={handleApply}
              className="flex-1 sm:flex-none px-5 py-2 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white font-extrabold text-xs rounded-xl shadow-md transition-all flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>ಉಳಿಸಿ ಮತ್ತು ಅನ್ವಯಿಸಿ (Apply & Save)</span>
            </button>
          </div>
        </div>

      </div>
    </div>
  );
};
