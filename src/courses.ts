export type CourseStepKind = 'material' | 'practice' | 'question';

const stepKindLabel: Record<CourseStepKind, string> = {
  material: 'Материал',
  practice: 'Практика',
  question: 'Вопрос',
};

export const buildCourseStepCardText = ({
  courseTitle,
  stepPosition,
  totalSteps,
  stepKind,
  stepTitle,
  body,
}: {
  courseTitle: string;
  stepPosition: number;
  totalSteps: number;
  stepKind: CourseStepKind;
  stepTitle: string;
  body: string;
}) => {
  const title = stepTitle.trim();
  const content = body.trim();
  const header = [
    `Курс: ${courseTitle.trim()}`,
    `Шаг ${stepPosition} из ${totalSteps}`,
    stepKindLabel[stepKind],
  ];
  return [header.join(' · '), title, content].filter(Boolean).join('\n\n');
};

