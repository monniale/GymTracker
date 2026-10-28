/** `data` namespace (rules in src/i18n/index.ts): backup, sync, import, share card and other lib copy. */
export default {
  /** Backup file import (db/backup.ts). */
  backup: {
    invalidJson: 'Not a valid JSON file.',
    notBackup: 'Not a GymTracker backup file.',
  },
  /** GitHub REST errors (lib/githubApi.ts), shown in Settings › Sync. */
  github: {
    network: 'Network unreachable',
    tokenInvalid: 'Token invalid or expired',
    rateLimit: 'GitHub rate limit reached — try later',
    forbidden: 'Access forbidden (check token permissions)',
    conflict: 'Remote changed underneath us',
    rejected: 'GitHub rejected the request ({status})',
    error: 'GitHub error {status}',
    cannotReadUser: 'Token cannot read the user',
    notFound: 'Repository or path not found',
  },
  /** Sync engine errors (lib/sync.ts). */
  cloud: {
    network: 'Network error — check your connection.',
    auth: 'Cloud sign-in expired — sign in again in Settings.',
    rateLimit: 'The cloud is rate-limiting requests — try again in a minute.',
    paused: 'The cloud project is paused (free tier, idle for a week). Resume it in the Supabase dashboard, then sync again.',
    badCode: 'Wrong or expired code — request a new one.',
    error: 'Cloud error {status}: {detail}',
    notSignedIn: 'Not signed in to cloud sync.',
    demoLoaded: 'Demo data is loaded. Clear it in Settings › Data before signing in to cloud sync.',
  },
  sync: {
    remoteInvalidJson: 'Remote data file is not valid JSON',
    remoteNotSnapshot: 'Remote file is not a GymTracker snapshot',
    keptChanging: 'Remote kept changing — try again',
    tokenRejected: 'GitHub token rejected — it may have expired. Paste a fresh one in Settings.',
    repoNotFound: 'Repository {owner}/{repo} not found. Create it as a PRIVATE repo on GitHub first.',
    demoLoaded: 'Demo data is loaded. Clear it in Settings › Data before connecting sync.',
  },
  /** Loading the web demo (lib/demoData.ts) refused. */
  demo: {
    connected: 'Sync is connected, so the demo cannot replace your data.',
    notEmpty: 'This device already has your data, so the demo cannot replace it.',
  },
  /** Strong / Hevy CSV import (lib/importHistory.ts). */
  import: {
    noWorkouts: 'The file has no workouts in it.',
    unknownFormat: 'Not a Strong or Hevy export (unknown columns).',
    noSets: 'No sets found in the file.',
    badDates: {
      one: '{n} row with an unreadable date was skipped.',
      other: '{n} rows with an unreadable date were skipped.',
    },
  },
  /** The workout share image (lib/shareCard.ts), drawn on a 1080 px canvas. */
  shareCard: {
    points: 'POINTS',
    pointsPrs: { one: 'POINTS · {n} PR', other: 'POINTS · {n} PRS' },
    rankUp: 'RANK UP!',
    volumePr: 'VOL PR',
    e1rmPr: 'e1RM PR',
    /** `{sets}` is the counted sets ("3 sets"), `{set}` the best set ("80 kg × 8", "BW+10 kg × 8"). */
    setsBest: '{sets} · best {set}',
    moreExercises: { one: '+ {n} more exercise', other: '+ {n} more exercises' },
    /** Footer stat labels (drawn upper-case). */
    statSets: { one: 'set', other: 'sets' },
    statVolume: 'volume',
    statTime: 'time',
    statStreak: 'streak',
    streakWeeks: '{n} wk',
    shareTitle: 'Share workout',
    noCanvas: 'Canvas is not available',
    encodeFailed: 'Could not encode the image',
    readFailed: 'Could not read the image',
  },
} as const
