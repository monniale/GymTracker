import type { Dict } from '../en'

const schemes: Dict['schemes'] = {
  kind: {
    double: 'Doppia progressione',
    linear: 'Lineare',
    percent: '% del massimale di allenamento',
    rpe: 'RPE',
  },
  repRange: '{min}–{max} rip.',
  linear: 'Lineare +{kg} kg',
  stage: 'Fase {n}/{total} · {sets}×{reps}',
  stageAmrap: 'Fase {n}/{total} · {sets}×{reps}+',
  pctSet: '{pct}\u00a0%\u00a0×{reps}',
  pctSetAmrap: '{pct}\u00a0%\u00a0×{reps}+',
  pctGroup: '{pct}\u00a0%\u00a0{sets}×{reps}',
  pctGroupAmrap: '{pct}\u00a0%\u00a0{sets}×{reps}+',
  needTm: 'Imposta un massimale di allenamento',
  outcome: {
    pass: 'Superato',
    fail: 'Mancato',
    deload: 'Scarico',
  },
}

export default schemes
