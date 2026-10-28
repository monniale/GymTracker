/** `lib` namespace (rules in src/i18n/index.ts). Keys: screen.element, camelCase. */
export default {
  dates: {
    /** Short weekday names, Sunday first (Date.getDay order). */
    dayShort: { sun: 'Sun', mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat' },
    /** Headers of the Monday-first month grid (must be 7 distinct strings: they are React keys). */
    weekdayHeader: { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' },
    /** Full weekday names (accessible names of the short day chips). */
    weekdayFull: { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' },
    monthShort: {
      jan: 'Jan', feb: 'Feb', mar: 'Mar', apr: 'Apr', may: 'May', jun: 'Jun',
      jul: 'Jul', aug: 'Aug', sep: 'Sep', oct: 'Oct', nov: 'Nov', dec: 'Dec',
    },
    /** Month names as written in running text (a month heading capitalizes the first letter). */
    monthFull: {
      jan: 'January', feb: 'February', mar: 'March', apr: 'April', may: 'May', jun: 'June',
      jul: 'July', aug: 'August', sep: 'September', oct: 'October', nov: 'November', dec: 'December',
    },
    /** "July 2026": calendar heading. */
    monthYear: '{month} {year}',
    /** "Thu 15 Oct". */
    dayMonth: '{weekday} {day} {month}',
    /** "Thu 15 Oct 2026". */
    dayMonthYear: '{weekday} {day} {month} {year}',
    /** "Today, 14:05". */
    dateTime: '{date}, {time}',
  },
  ranks: {
    copper: 'Copper',
    bronze: 'Bronze',
    silver: 'Silver',
    gold: 'Gold',
    platinum: 'Platinum',
    emerald: 'Emerald',
    diamond: 'Diamond',
    champion: 'Champion',
  },
  achievements: {
    firstSession: { name: 'First blood', desc: 'Finish your first session' },
    sessions10: { name: 'Regular', desc: '10 sessions finished' },
    sessions50: { name: 'Gym rat', desc: '50 sessions finished' },
    sessions100: { name: 'Iron veteran', desc: '100 sessions finished' },
    volume100k: { name: 'Ton mover', desc: '{kg} kg lifetime volume' },
    volume1m: { name: 'Million club', desc: '{kg} kg lifetime volume' },
    streak4: { name: 'Habit formed', desc: '4-week training streak' },
    streak12: { name: 'Unstoppable', desc: '12-week training streak' },
    prs10: { name: 'Record breaker', desc: '10 personal records' },
    prs50: { name: 'PR machine', desc: '50 personal records' },
    benchBw: { name: 'Bodyweight bench', desc: 'Bench press e1RM ≥ 1× bodyweight' },
    squat15Bw: { name: 'Squat 1.5×', desc: 'Squat e1RM ≥ 1.5× bodyweight' },
    deadlift2Bw: { name: 'Deadlift 2×', desc: 'Deadlift e1RM ≥ 2× bodyweight' },
    nutrition7: { name: 'Fuel logger', desc: 'Log food on 7 different days' },
    nutrition30: { name: 'Precision eater', desc: 'Log food on 30 different days' },
    bigSession: { name: 'Monster session', desc: 'Score 200+ points in one session' },
  },
  quests: {
    sessions: 'Finish 3 sessions',
    legs2: 'Train legs or glutes twice',
    prs2: 'Set 2 personal records',
    protein5: 'Hit your protein target on 5 days',
    volume15k: 'Move {kg} kg of volume',
    logFood5: 'Log your food on 5 days',
    /** A quest's score event in the rank history. */
    eventLabel: 'Quest: {label}',
  },
  standards: {
    untrained: 'Untrained',
    novice: 'Novice',
    intermediate: 'Intermediate',
    advanced: 'Advanced',
    elite: 'Elite',
  },
  equipment: {
    barbell: 'Barbell',
    dumbbell: 'Dumbbell',
    machine: 'Machine',
    cable: 'Cable',
    bodyweight: 'Bodyweight',
    other: 'Other',
  },
  muscles: {
    chest: 'Chest',
    back: 'Back',
    shoulders: 'Shoulders',
    biceps: 'Biceps',
    triceps: 'Triceps',
    legs: 'Legs',
    glutes: 'Glutes',
    core: 'Core',
    cardio: 'Cardio',
    other: 'Other',
  },
} as const
