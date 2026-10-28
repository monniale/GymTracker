import type { Dict } from '../en'

const data: Dict['data'] = {
  backup: {
    invalidJson: 'Non è un file JSON valido.',
    notBackup: 'Non è un file di backup di GymTracker.',
  },
  github: {
    network: 'Rete non raggiungibile',
    tokenInvalid: 'Token non valido o scaduto',
    rateLimit: 'Limite di richieste GitHub raggiunto — riprova più tardi',
    forbidden: 'Accesso negato (controlla i permessi del token)',
    conflict: 'I dati remoti sono cambiati nel frattempo',
    rejected: 'GitHub ha rifiutato la richiesta ({status})',
    error: 'Errore GitHub {status}',
    cannotReadUser: 'Il token non può leggere l’utente',
    notFound: 'Repository o percorso non trovato',
  },
  cloud: {
    network: 'Errore di rete — controlla la connessione.',
    auth: 'Accesso al cloud scaduto — accedi di nuovo nelle Impostazioni.',
    rateLimit: 'Il cloud sta limitando le richieste — riprova tra un minuto.',
    paused: 'Il progetto cloud è in pausa (piano gratuito, inattivo da una settimana). Riattivalo dalla dashboard Supabase, poi sincronizza di nuovo.',
    badCode: 'Codice errato o scaduto — richiedine uno nuovo.',
    error: 'Errore cloud {status}: {detail}',
    notSignedIn: 'Non hai effettuato l’accesso alla sincronizzazione cloud.',
    demoLoaded: 'Ci sono dati demo. Cancellali in Impostazioni › Dati prima di accedere alla sincronizzazione cloud.',
  },
  sync: {
    remoteInvalidJson: 'Il file di dati remoto non è un JSON valido',
    remoteNotSnapshot: 'Il file remoto non è uno snapshot di GymTracker',
    keptChanging: 'I dati remoti continuano a cambiare — riprova',
    tokenRejected: 'Token GitHub rifiutato — forse è scaduto. Incollane uno nuovo nelle Impostazioni.',
    repoNotFound: 'Repository {owner}/{repo} non trovato. Prima crealo su GitHub come repo PRIVATO.',
    demoLoaded: 'Ci sono dati demo. Cancellali in Impostazioni › Dati prima di collegare la sincronizzazione.',
  },
  demo: {
    connected: 'La sincronizzazione è collegata, quindi la demo non può sostituire i tuoi dati.',
    notEmpty: 'Questo dispositivo ha già i tuoi dati, quindi la demo non può sostituirli.',
  },
  import: {
    noWorkouts: 'Il file non contiene allenamenti.',
    unknownFormat: 'Non è un export di Strong o Hevy (colonne sconosciute).',
    noSets: 'Nessuna serie trovata nel file.',
    badDates: {
      one: '{n} riga con una data illeggibile è stata saltata.',
      other: '{n} righe con una data illeggibile sono state saltate.',
    },
  },
  shareCard: {
    points: 'PUNTI',
    pointsPrs: { one: 'PUNTI · {n} PR', other: 'PUNTI · {n} PR' },
    rankUp: 'NUOVO RANK!',
    volumePr: 'PR VOL.',
    e1rmPr: 'PR e1RM',
    setsBest: '{sets} · migliore {set}',
    moreExercises: { one: '+ {n} altro esercizio', other: '+ altri {n} esercizi' },
    statSets: { one: 'serie', other: 'serie' },
    statVolume: 'volume',
    statTime: 'tempo',
    statStreak: 'striscia',
    streakWeeks: '{n} sett.',
    shareTitle: 'Condividi allenamento',
    noCanvas: 'Canvas non disponibile',
    encodeFailed: 'Impossibile creare l’immagine',
    readFailed: 'Impossibile leggere l’immagine',
  },
}

export default data
