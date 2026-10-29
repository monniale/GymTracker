import type { Dict } from '../en'

const notify: Dict['notify'] = {
  planner: {
    sessions: { one: '{n} allenamento', other: '{n} allenamenti' },
    moreSessions: { one: '{n} allenamento in più', other: '{n} allenamenti in più' },
    weekStreak: { one: 'streak di {n} settimana', other: 'streak di {n} settimane' },
    decayTitle: 'Da domani il rank inizia a calare',
    decayBody: 'Allenati oggi per non perdere punti: dopo una settimana ferma perdi il {pct}% al giorno (max {max}%).',
    decayBodyStreak: 'Allenati oggi per non perdere punti e la tua {streak}: {sessions} entro domenica.',
    streakTitle: 'Non perdere la tua {streak}',
    streakBody: '{sessions} entro domenica per tenerla viva.',
    streakBodyTrainingDay: '{sessions} entro domenica per tenerla viva. Oggi è giorno di allenamento.',
    workoutTitle: 'È ora di allenarsi',
    workoutBodyWeek: '{done} su {target} allenamenti questa settimana: tocca per iniziare.',
    workoutBody: 'Tocca per iniziare l’allenamento.',
    workoutBodyTemplate: 'Oggi {name} · {done} su {target} allenamenti questa settimana: tocca per iniziare.',
    workoutBodyTemplateDay: 'Oggi {name}: tocca per iniziare.',
    mealTitle: {
      breakfast: 'Registra la colazione',
      lunch: 'Registra il pranzo',
      snack: 'Registra lo spuntino',
      dinner: 'Registra la cena',
    },
    mealBody: {
      breakfast: 'Tocca per registrare la colazione.',
      lunch: 'Tocca per registrare il pranzo.',
      snack: 'Tocca per registrare lo spuntino.',
      dinner: 'Tocca per registrare la cena.',
    },
    waterTitle: 'Bevi un po’ d’acqua',
    waterBody: 'È il momento di bere.',
    recapTitle: 'Il tuo riepilogo settimanale',
    recapLastWeek: 'Settimana scorsa: {sessions}, +{points} pt.',
    recapLastWeekStreak: 'Settimana scorsa: {sessions}, +{points} pt, {streak}.',
    recapThisWeek: 'Questa settimana: {sessions}, +{points} pt.',
    recapThisWeekStreak: 'Questa settimana: {sessions}, +{points} pt, {streak}.',
    supplementTitle: 'Ora degli integratori',
    supplementBody: { one: 'Non ancora registrato: {names}. Tocca per registrarlo.', other: 'Non ancora registrati: {names}. Tocca per registrarli.' },
    weighInTitle: 'Giorno della pesata',
    weighInBody: 'Registra il tuo peso: mantiene preciso il punteggio di forza.',
    openSessionTitle: 'Allenamento ancora aperto',
    openSessionBody: 'Lo concludi o lo scarti? Tocca per aprirlo.',
    keepAliveTitle: 'Promemoria di GymTracker',
    keepAliveBody: 'Apri GymTracker per continuare a ricevere i promemoria.',
  },
}

export default notify
