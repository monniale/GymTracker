import type { Dict } from '../en'

const ai: Dict['ai'] = {
  gemini: {
    network: 'Rete non raggiungibile — controlla la connessione.',
    requestFailed: 'Richiesta a Gemini non riuscita ({status})',
    requestFailedDetail: 'Errore di Gemini: {detail}',
    blocked: 'Gemini non è riuscito a generare una risposta — riprova.',
    empty: 'Gemini ha restituito una risposta vuota — riprova.',
    noKey: 'Prima aggiungi una chiave Gemini nelle Impostazioni.',
  },
  note: {
    defaultHeadline: 'Analisi completata',
    cutOff: 'La nota del coach si è interrotta — tocca Rigenera.',
  },
  macro: {
    defaultHeadline: 'Idee per chiudere la giornata',
    cutOff: 'Il suggerimento si è interrotto — tocca Rigenera.',
  },
}

export default ai
