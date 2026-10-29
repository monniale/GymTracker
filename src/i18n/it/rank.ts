import type { Dict } from '../en'

const rank: Dict['rank'] = {
  screen: {
    title: 'Rank',
    toNext: { one: '{n} pt per {rank}', other: '{n} pt per {rank}' },
    streak: { one: '{n} sett. di fila', other: '{n} sett. di fila' },
    seasonLeft: { one: 'Stagione {season} · {n} g rimasto', other: 'Stagione {season} · {n} gg rimasti' },
    ghostNow: 'Giorno {day}: {pts} vs',
    ghostLast: '{pts} la scorsa stagione',
  },
  quests: {
    title: 'Sfide settimanali',
    bonusEach: '+{n} pt l’una',
  },
  scoring: {
    toggle: 'Come funziona il punteggio',
    volume: '**Carico di volume** (serie × ripetizioni × peso ÷ il tuo peso corporeo): è la base, perché è l’indicatore scientifico standard dello stimolo allenante, con una relazione dose–risposta dimostrata per la crescita muscolare.',
    intensity: '**Peso dell’intensità**: ogni serie conta in base a quanto è pesante rispetto al tuo massimale stimato (formula di Epley). Le serie sotto il 30% del massimale valgono quasi zero: il volume spazzatura non costruisce muscoli, e nemmeno punti.',
    prBonus: '**Bonus PR** (+25 per ogni record di e1RM, +10 per ogni record di volume, max 75): il sovraccarico progressivo, cioè battere il tuo record, è il meccanismo dell’adattamento, quindi vale di più.',
    streak: '**Moltiplicatore costanza** (+5% per ogni settimana di fila in cui raggiungi il tuo obiettivo di sedute, max +30%): la costanza è il miglior predittore dei risultati, quindi moltiplica tutto.',
    caps: '**Limiti**: max 6 serie conteggiate per esercizio, 24 per seduta, 150 punti base: i rendimenti decrescenti esistono, e macinare all’infinito serie facili non ti fa salire di rank. Una seconda seduta nello stesso giorno vale il 25%. Dopo 7 giorni di riposo i punti calano del 3% al giorno (max −25%). Le stagioni durano 12 settimane; si riparte con il 20% dei punti.',
  },
  recent: {
    title: 'Punteggi recenti',
    empty: 'Completa un allenamento per guadagnare i primi punti.',
    adjustment: 'Correzione punti',
  },
  achievements: {
    title: 'Traguardi',
  },
  seasons: {
    title: 'Stagioni passate',
    season: 'Stagione {season}',
    sessions: { one: '{n} seduta', other: '{n} sedute' },
    lifted: '{kg} kg sollevati',
    best: 'migliore: {name} {e1rm} e1RM',
  },
  tiers: {
    title: 'Tutti i rank',
    reached: 'Raggiunto',
    toGo: { one: 'manca {n} pt', other: 'mancano {n} pt' },
  },
}

export default rank
