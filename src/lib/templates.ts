import type { GoalType, RoutineCadence } from './types'

export interface GoalTemplate {
  id: string
  emoji: string
  title: string
  type: GoalType
  description: string
  color: string
  category?: string
  /** quantitative */
  targetValue?: number
  unit?: string
  weeklyTarget?: number
  /** plan */
  steps?: string[]
}

export const TEMPLATES: GoalTemplate[] = [
  {
    id: 'books',
    emoji: '📚',
    title: 'Read a book a month',
    type: 'quantitative',
    description: 'Finish 12 books before the end of the year.',
    color: 'amber',
    category: 'Learning',
    targetValue: 12,
    unit: 'books',
  },
  {
    id: 'pages',
    emoji: '📖',
    title: 'Read 2,000 pages',
    type: 'quantitative',
    description: 'A page-count variant for mixed-length books.',
    color: 'orange',
    category: 'Learning',
    targetValue: 2000,
    unit: 'pages',
  },
  {
    id: 'guitar',
    emoji: '🎸',
    title: 'Learn guitar',
    type: 'plan',
    description: 'From first chord to playing full songs.',
    color: 'rose',
    category: 'Music',
    unit: 'sessions',
    weeklyTarget: 4,
    steps: [
      'Get a guitar and learn to hold & tune it',
      'Learn the basic open chords (G, C, D, Em, Am)',
      'Play chord changes smoothly at 60 bpm',
      'Learn 3 easy songs start to finish',
      'Learn strumming patterns and barre chords',
      'Record yourself playing a full song',
    ],
  },
  {
    id: 'mandarin',
    emoji: '🀄',
    title: 'Learn Mandarin',
    type: 'plan',
    description: 'Vocabulary, grammar, fluency and reading — tracked as a skill map.',
    color: 'violet',
    category: 'Language',
    unit: 'sessions',
    weeklyTarget: 5,
    steps: [
      'Finish the HSK1 textbook',
      'Build the 500-word core vocabulary',
      'Have a 15-minute conversation',
      'Read a graded reader without a dictionary',
    ],
  },
  {
    id: 'language',
    emoji: '🗣️',
    title: 'Learn a language',
    type: 'plan',
    description: 'Reach conversational basics step by step.',
    color: 'teal',
    category: 'Language',
    unit: 'sessions',
    weeklyTarget: 5,
    steps: [
      'Complete the beginner (A1) course',
      'Build a 500-word core vocabulary',
      'Have a 15-minute conversation with a native speaker',
      'Watch a movie without subtitles',
      'Write a one-page journal entry in the language',
    ],
  },
  {
    id: 'basketball',
    emoji: '🏀',
    title: 'Level up at basketball',
    type: 'plan',
    description: 'Shooting, handles and conditioning — a full skill map.',
    color: 'orange',
    category: 'Sport',
    unit: 'sessions',
    weeklyTarget: 4,
    steps: [
      'Fix shooting form with close-range form shots',
      'Learn basic dribbling moves with both hands',
      'Finish layups with the weak hand',
      'Play 10 pickup games applying the new skills',
    ],
  },
  {
    id: 'running',
    emoji: '🏃',
    title: 'Run 250 km',
    type: 'quantitative',
    description: 'Log every run and watch the total climb.',
    color: 'emerald',
    category: 'Fitness',
    targetValue: 250,
    unit: 'km',
  },
  {
    id: 'workouts',
    emoji: '💪',
    title: '100 workouts',
    type: 'quantitative',
    description: 'Show up, log it, keep the streak alive.',
    color: 'pink',
    category: 'Fitness',
    targetValue: 100,
    unit: 'workouts',
  },
  {
    id: 'meditate',
    emoji: '🧘',
    title: 'Meditate 150 sessions',
    type: 'quantitative',
    description: 'A calm mind, one session at a time.',
    color: 'lime',
    category: 'Wellbeing',
    targetValue: 150,
    unit: 'sessions',
  },
  {
    id: 'writing',
    emoji: '✍️',
    title: 'Write 50,000 words',
    type: 'quantitative',
    description: 'A book, a thesis, or a blog — keep the words flowing.',
    color: 'orange',
    category: 'Writing',
    targetValue: 50000,
    unit: 'words',
  },
]

// ---------------------------------------------------------------------------
// Demo seed data
// ---------------------------------------------------------------------------

export interface SeedStep {
  title: string
  status: 'pending' | 'in_progress' | 'done'
  completedDaysAgo?: number
}
export interface SeedLog {
  daysAgo: number
  amount: number
  note?: string
}
export interface SeedNote {
  content: string
  pinned?: boolean
}
export interface SeedPath {
  title: string
  icon: string
  unit?: string
  nodes: {
    title: string
    current: number
    target: number
    xp: number
    description?: string
    /** sub-checkpoints on the way to the target */
    milestones?: number[]
  }[]
}
export interface SeedRoutine {
  title: string
  cadence: RoutineCadence
  everyNDays?: number
  weekdays?: number[]
  durationMin?: number
  notes?: string
  startedDaysAgo?: number
  /** how many of the recent occurrences were done (1 = all) */
  doneRatio?: number
}
export interface SeedGoal {
  title: string
  description: string
  emoji: string
  color: string
  category: string
  type: GoalType
  targetValue?: number
  unit?: string
  weeklyTarget?: number
  createdDaysAgo: number
  steps: SeedStep[]
  logs: SeedLog[]
  notes?: SeedNote[]
  paths?: SeedPath[]
  routines?: SeedRoutine[]
}

/** Sample goals used by the "load demo data" action. */
export const SEED_GOALS: SeedGoal[] = [
  {
    title: 'Learn Mandarin',
    description: 'Read, write and hold conversations — tracked across four skill paths.',
    emoji: '🀄',
    color: 'violet',
    category: 'Language',
    type: 'plan',
    unit: 'sessions',
    weeklyTarget: 5,
    createdDaysAgo: 100,
    steps: [
      { title: 'Finish the HSK1 textbook', status: 'done', completedDaysAgo: 62 },
      { title: 'Build the 500-word core vocabulary', status: 'done', completedDaysAgo: 30 },
      { title: 'Have a 15-minute conversation', status: 'in_progress' },
      { title: 'Read a graded reader without a dictionary', status: 'pending' },
    ],
    logs: [
      { daysAgo: 45, amount: 1, note: 'First tutoring session' },
      { daysAgo: 38, amount: 2, note: 'Anki reviews + grammar drills' },
      { daysAgo: 30, amount: 2, note: 'HSK2 chapter 1' },
      { daysAgo: 22, amount: 3, note: 'Reading practice with graded stories' },
      { daysAgo: 15, amount: 2, note: 'Tone pairs practice' },
      { daysAgo: 8, amount: 3, note: 'Conversation practice with tutor' },
      { daysAgo: 3, amount: 2, note: 'HSK3 vocab batch 12' },
      { daysAgo: 1, amount: 1, note: 'Read aloud session' },
    ],
    notes: [
      { content: 'Textbook: HSK Standard Course 3. Tutor session every other Tuesday, 18:30.', pinned: true },
      { content: 'Tone pairs 2-3 and 1-4 still trip me up — drill these in Anki with audio.' },
    ],
    paths: [
      {
        title: 'Vocabulary',
        icon: '📖',
        unit: 'words',
        nodes: [
          { title: 'HSK1', current: 150, target: 150, xp: 20, milestones: [50, 100] },
          { title: 'HSK2', current: 300, target: 300, xp: 40, milestones: [100, 200] },
          {
            title: 'HSK3', current: 240, target: 600, xp: 60,
            description: 'Recall within 3 seconds, tones included',
            milestones: [100, 200, 300, 400, 500],
          },
        ],
      },
      {
        title: 'Grammar',
        icon: '🧩',
        unit: 'points',
        nodes: [
          { title: 'HSK1', current: 70, target: 70, xp: 20 },
          { title: 'HSK2', current: 65, target: 75, xp: 30, milestones: [25, 50] },
          { title: 'HSK3', current: 21, target: 96, xp: 40, milestones: [48] },
        ],
      },
      {
        title: 'Fluency',
        icon: '🗣️',
        unit: 'min',
        nodes: [
          { title: 'HSK1', current: 100, target: 100, xp: 20 },
          { title: 'HSK2', current: 80, target: 100, xp: 40, description: 'Minutes of unbroken conversation', milestones: [50] },
          { title: 'HSK3', current: 20, target: 100, xp: 60, milestones: [50] },
        ],
      },
      {
        title: 'Reading',
        icon: '📜',
        unit: 'pages',
        nodes: [
          { title: 'HSK1', current: 150, target: 150, xp: 20 },
          { title: 'HSK2', current: 280, target: 300, xp: 40, milestones: [150] },
          { title: 'HSK3', current: 80, target: 600, xp: 60, milestones: [200, 400] },
        ],
      },
    ],
    routines: [
      {
        title: 'Vocab drills',
        cadence: 'interval',
        everyNDays: 2,
        durationMin: 20,
        notes: 'Anki deck — focus on 3-star leeches',
        startedDaysAgo: 90,
        doneRatio: 0.8,
      },
      {
        title: 'Focused practice session',
        cadence: 'weekly',
        weekdays: [0],
        durationMin: 60,
        notes: 'New grammar chapter + read aloud + record myself',
        startedDaysAgo: 90,
        doneRatio: 0.7,
      },
    ],
  },
  {
    title: 'Read a book a month',
    description: '12 books before the end of the year — mixing fiction and non-fiction.',
    emoji: '📚',
    color: 'amber',
    category: 'Learning',
    type: 'quantitative',
    targetValue: 12,
    unit: 'books',
    createdDaysAgo: 60,
    steps: [],
    logs: [
      { daysAgo: 52, amount: 1, note: 'The Pragmatic Programmer' },
      { daysAgo: 40, amount: 1, note: 'Deep Work' },
      { daysAgo: 27, amount: 1, note: 'Project Hail Mary' },
      { daysAgo: 13, amount: 1, note: 'Thinking, Fast and Slow' },
      { daysAgo: 2, amount: 1, note: 'The Almanack of Naval Ravikant' },
    ],
    notes: [{ content: 'Next up: "Thinking in Systems" — already on the shelf.' }],
    routines: [
      {
        title: 'Evening reading',
        cadence: 'weekly',
        weekdays: [1, 2, 3, 4],
        durationMin: 30,
        notes: 'No phone in bed — book only',
        startedDaysAgo: 60,
        doneRatio: 0.75,
      },
    ],
  },
  {
    title: 'Level up at basketball',
    description: 'Deliberate practice: form shooting, handles and conditioning.',
    emoji: '🏀',
    color: 'orange',
    category: 'Sport',
    type: 'plan',
    unit: 'sessions',
    weeklyTarget: 4,
    createdDaysAgo: 45,
    steps: [
      { title: 'Fix shooting form with close-range form shots', status: 'done', completedDaysAgo: 20 },
      { title: 'Learn basic dribbling moves with both hands', status: 'in_progress' },
      { title: 'Finish layups with the weak hand', status: 'in_progress' },
      { title: 'Play 10 pickup games applying the new skills', status: 'pending' },
    ],
    logs: [
      { daysAgo: 40, amount: 1, note: 'Form shooting, 200 shots' },
      { daysAgo: 33, amount: 2, note: 'Stationary dribbling drills' },
      { daysAgo: 25, amount: 2, note: 'Crossover + between-the-legs' },
      { daysAgo: 18, amount: 3, note: 'Weak-hand layups + free throws' },
      { daysAgo: 11, amount: 2, note: 'Full-court dribble sprints' },
      { daysAgo: 6, amount: 2, note: 'Pickup game — used the new crossover twice' },
      { daysAgo: 2, amount: 1, note: 'Free throws: 7/10' },
    ],
    notes: [
      { content: 'Court near the office is free weekday mornings before 8am.', pinned: true },
    ],
    paths: [
      {
        title: 'Shooting',
        icon: '🎯',
        unit: 'makes',
        nodes: [
          { title: 'Free throws', current: 7, target: 10, xp: 20, description: 'Out of 10 attempts', milestones: [5] },
          { title: 'Midrange', current: 4, target: 10, xp: 30, milestones: [5] },
          { title: '3-pointers', current: 0, target: 10, xp: 50, milestones: [3, 7] },
        ],
      },
      {
        title: 'Handles',
        icon: '🏀',
        unit: 'moves',
        nodes: [
          { title: 'Crossover', current: 10, target: 10, xp: 20 },
          { title: 'Between legs', current: 6, target: 10, xp: 30, milestones: [5] },
          { title: 'Behind back', current: 2, target: 10, xp: 40, milestones: [5] },
        ],
      },
      {
        title: 'Finishing',
        icon: '🏀',
        unit: 'makes',
        nodes: [
          { title: 'Right layups', current: 10, target: 10, xp: 20 },
          { title: 'Left layups', current: 5, target: 10, xp: 30, milestones: [5] },
          { title: 'Euro step', current: 1, target: 10, xp: 40, milestones: [5] },
        ],
      },
    ],
    routines: [
      {
        title: 'Shooting drills',
        cadence: 'interval',
        everyNDays: 2,
        durationMin: 45,
        notes: '150 form shots + 50 free throws',
        startedDaysAgo: 40,
        doneRatio: 0.7,
      },
      {
        title: 'Handles + conditioning',
        cadence: 'weekly',
        weekdays: [2, 5],
        durationMin: 60,
        notes: 'Ladder drills, then full-speed moves',
        startedDaysAgo: 40,
        doneRatio: 0.6,
      },
      {
        title: 'Pickup game',
        cadence: 'weekly',
        weekdays: [6],
        durationMin: 90,
        startedDaysAgo: 40,
        doneRatio: 0.5,
      },
    ],
  },
  {
    title: 'Run 250 km',
    description: 'Three runs a week, building distance slowly.',
    emoji: '🏃',
    color: 'emerald',
    category: 'Fitness',
    type: 'quantitative',
    targetValue: 250,
    unit: 'km',
    createdDaysAgo: 60,
    steps: [],
    logs: [
      { daysAgo: 50, amount: 5, note: 'Easy first run' },
      { daysAgo: 47, amount: 6 },
      { daysAgo: 43, amount: 7 },
      { daysAgo: 39, amount: 8 },
      { daysAgo: 34, amount: 8, note: 'New route along the river' },
      { daysAgo: 29, amount: 10 },
      { daysAgo: 22, amount: 12 },
      { daysAgo: 15, amount: 14, note: 'Longest run yet' },
      { daysAgo: 8, amount: 12 },
      { daysAgo: 3, amount: 15 },
      { daysAgo: 1, amount: 10 },
    ],
    routines: [
      {
        title: 'Easy run',
        cadence: 'weekly',
        weekdays: [2, 4],
        durationMin: 40,
        startedDaysAgo: 60,
        doneRatio: 0.85,
      },
      {
        title: 'Long run',
        cadence: 'weekly',
        weekdays: [6],
        durationMin: 75,
        notes: 'Conversational pace, build +1km/week',
        startedDaysAgo: 60,
        doneRatio: 0.75,
      },
    ],
  },
]
