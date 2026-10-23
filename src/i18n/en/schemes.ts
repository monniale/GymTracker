/** Progression scheme names and labels (src/lib/prescription.ts). `{pct}` is a percentage number. */
export default {
  kind: {
    double: 'Double progression',
    linear: 'Linear',
    percent: '% of training max',
    rpe: 'RPE',
  },
  /** A rep range: "8–12 reps". */
  repRange: '{min}–{max} reps',
  /** Linear progression step: "Linear +2.5 kg". */
  linear: 'Linear +{kg} kg',
  /** GZCLP-style stage: "Stage 2/3 · 6×2". */
  stage: 'Stage {n}/{total} · {sets}×{reps}',
  /** Same, last set as many reps as possible: "Stage 1/3 · 5×3+". */
  stageAmrap: 'Stage {n}/{total} · {sets}×{reps}+',
  /** One set at a percentage of the training max: "65 % ×5". */
  pctSet: '{pct}\u00a0%\u00a0×{reps}',
  /** Same, as many reps as possible: "85 % ×5+". */
  pctSetAmrap: '{pct}\u00a0%\u00a0×{reps}+',
  /** Several equal sets: "50 % 5×10". */
  pctGroup: '{pct}\u00a0%\u00a0{sets}×{reps}',
  /** Several equal AMRAP sets: "65 % 3×8+". */
  pctGroupAmrap: '{pct}\u00a0%\u00a0{sets}×{reps}+',
  /** Percentage item on an exercise without a training max. */
  needTm: 'Set a training max',
  /** Outcome of the last workout for an item. */
  outcome: {
    pass: 'Passed',
    fail: 'Missed',
    deload: 'Deload',
  },
} as const
