export type ExerciseImage = { src: string; alt: string };

// Stable exercise IDs from the production catalog; options and cycles reuse them.
// Only reviewed illustrations are listed. Missing exercises keep text instructions.
export const exerciseImages: Record<string, ExerciseImage> = {
  '0bc6b11f-e81c-4ecf-a458-a5ce5c30159b': {
    src: '/exercises/side-plank-knees.webp',
    alt: 'Боковая планка с колен: исходное положение и подъём таза с опорой на предплечье и колени.',
  },
  '4ed9a903-4f90-4515-8fe0-1b12732aea48': {
    src: '/exercises/hack-squat.webp',
    alt: 'Гакк-присед: выпрямление и сгибание ног с опорой спины на тренажёр.',
  },
  'cedf5b70-8b0d-4f73-9402-7e8afef975e6': {
    src: '/exercises/goblet-squat.webp',
    alt: 'Гоблет-присед: стойка и присед с одной гантелью у груди.',
  },
  '2a6ab4ec-9973-444a-8ffd-cf3c5dd65b41': {
    src: '/exercises/seated-dumbbell-press.webp',
    alt: 'Жим гантелей вверх сидя: гантели у плеч и над головой.',
  },
  'b9088881-3199-46b7-883a-d68a71ec8d74': {
    src: '/exercises/dumbbell-floor-press.webp',
    alt: 'Жим гантелей лёжа на полу: локти на полу и выжимание гантелей над грудью.',
  },
  'd51bee53-e42b-48fe-bcfd-868fe9211e23': {
    src: '/exercises/flat-dumbbell-press.webp',
    alt: 'Жим гантелей на горизонтальной скамье: нижнее и верхнее положения.',
  },
  '880e4c1d-76f5-4bb8-9be0-f4c74482beb4': {
    src: '/exercises/incline-dumbbell-press.webp',
    alt: 'Жим гантелей на наклонной скамье: гантели у груди и выжимание вверх.',
  },
  'f31bdae8-bc61-4eaf-84a7-7ff73cb19075': {
    src: '/exercises/leg-press.webp',
    alt: 'Жим ногами: платформа приближена и отведена, колени слегка согнуты в верхней точке.',
  },
  '3e219fab-4d16-4387-9739-e623b45cc86a': {
    src: '/exercises/barbell-bench-press.webp',
    alt: 'Жим штанги лёжа, вид сбоку: гриф у груди и над грудью.',
  },
  '27358834-e6fd-47cf-8d9a-9f8cd1bc6947': {
    src: '/exercises/standing-calf-raise.webp',
    alt: 'Подъём на носки стоя в тренажёре: опущенные и поднятые пятки.',
  },
  'c92237bc-41c1-4aa1-a744-22f0ee72330e': {
    src: '/exercises/lateral-raise.webp',
    alt: 'Разведение гантелей в стороны: руки внизу и подняты до уровня плеч.',
  },
  '3a593420-18ae-4ed7-9b8c-3126c3b84b44': {
    src: '/exercises/dumbbell-romanian-deadlift.webp',
    alt: 'Румынская тяга с гантелями: стойка и наклон с отведением таза назад.',
  },
};
