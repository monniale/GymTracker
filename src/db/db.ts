import Dexie, { type Table } from 'dexie'
import type {
  Exercise, WorkoutTemplate, Session, SetRow, Food, FoodLog,
  SavedMeal, Settings, RankState, ScoreEvent, Season, DayType,
} from '../types'

export class GymDB extends Dexie {
  exercises!: Table<Exercise, number>
  templates!: Table<WorkoutTemplate, number>
  sessions!: Table<Session, number>
  sets!: Table<SetRow, number>
  foods!: Table<Food, number>
  foodLogs!: Table<FoodLog, number>
  savedMeals!: Table<SavedMeal, number>
  settings!: Table<Settings, number>
  rankState!: Table<RankState, number>
  scoreEvents!: Table<ScoreEvent, number>
  seasons!: Table<Season, number>
  dayTypes!: Table<DayType, string>

  constructor() {
    super('gymtracker')
    this.version(1).stores({
      exercises: '++id, nameLower, muscleGroup',
      templates: '++id, name, position',
      sessions: '++id, startedAt, templateId',
      sets: '++id, sessionId, exerciseId, [exerciseId+completedAt]',
      foods: '++id, nameLower, &offId, lastUsedAt',
      foodLogs: '++id, date, [date+meal], foodId',
      savedMeals: '++id, name, lastUsedAt',
      settings: 'id',
      rankState: 'id',
      scoreEvents: '++id, date, sessionId',
      seasons: '++id, startDate',
    })
    this.version(2).stores({
      dayTypes: 'date',
    })
  }
}

export const db = new GymDB()
