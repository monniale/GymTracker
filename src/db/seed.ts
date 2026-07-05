import { db } from './db'
import { localDateStr } from '../lib/dates'
import type { Exercise, MuscleGroup } from '../types'

type SeedRow = [name: string, muscle: MuscleGroup, equipment: string, restSec: number]

const ROWS: SeedRow[] = [
  // Chest
  ['Bench Press', 'chest', 'barbell', 150],
  ['Incline Bench Press', 'chest', 'barbell', 150],
  ['Dumbbell Bench Press', 'chest', 'dumbbell', 120],
  ['Incline Dumbbell Press', 'chest', 'dumbbell', 120],
  ['Chest Press Machine', 'chest', 'machine', 120],
  ['Chest Fly', 'chest', 'dumbbell', 90],
  ['Cable Crossover', 'chest', 'cable', 90],
  ['Pec Deck', 'chest', 'machine', 90],
  ['Push-Up', 'chest', 'bodyweight', 90],
  ['Dips', 'chest', 'bodyweight', 120],
  // Back
  ['Deadlift', 'back', 'barbell', 180],
  ['Pull-Up', 'back', 'bodyweight', 150],
  ['Chin-Up', 'back', 'bodyweight', 150],
  ['Lat Pulldown', 'back', 'cable', 120],
  ['Barbell Row', 'back', 'barbell', 150],
  ['Dumbbell Row', 'back', 'dumbbell', 120],
  ['Seated Cable Row', 'back', 'cable', 120],
  ['T-Bar Row', 'back', 'barbell', 150],
  ['Straight-Arm Pulldown', 'back', 'cable', 90],
  ['Back Extension', 'back', 'bodyweight', 90],
  // Shoulders
  ['Overhead Press', 'shoulders', 'barbell', 150],
  ['Seated Dumbbell Press', 'shoulders', 'dumbbell', 120],
  ['Arnold Press', 'shoulders', 'dumbbell', 120],
  ['Lateral Raise', 'shoulders', 'dumbbell', 90],
  ['Cable Lateral Raise', 'shoulders', 'cable', 90],
  ['Front Raise', 'shoulders', 'dumbbell', 90],
  ['Rear Delt Fly', 'shoulders', 'dumbbell', 90],
  ['Face Pull', 'shoulders', 'cable', 90],
  ['Upright Row', 'shoulders', 'barbell', 90],
  ['Shrug', 'shoulders', 'dumbbell', 90],
  // Biceps
  ['Barbell Curl', 'biceps', 'barbell', 90],
  ['Dumbbell Curl', 'biceps', 'dumbbell', 90],
  ['Hammer Curl', 'biceps', 'dumbbell', 90],
  ['Incline Dumbbell Curl', 'biceps', 'dumbbell', 90],
  ['Preacher Curl', 'biceps', 'machine', 90],
  ['Cable Curl', 'biceps', 'cable', 90],
  // Triceps
  ['Close-Grip Bench Press', 'triceps', 'barbell', 120],
  ['Skull Crusher', 'triceps', 'barbell', 90],
  ['Triceps Pushdown', 'triceps', 'cable', 90],
  ['Overhead Triceps Extension', 'triceps', 'cable', 90],
  ['Triceps Dip Machine', 'triceps', 'machine', 90],
  // Legs
  ['Squat', 'legs', 'barbell', 180],
  ['Front Squat', 'legs', 'barbell', 180],
  ['Goblet Squat', 'legs', 'dumbbell', 120],
  ['Leg Press', 'legs', 'machine', 150],
  ['Hack Squat', 'legs', 'machine', 150],
  ['Romanian Deadlift', 'legs', 'barbell', 150],
  ['Sumo Deadlift', 'legs', 'barbell', 180],
  ['Leg Extension', 'legs', 'machine', 90],
  ['Leg Curl', 'legs', 'machine', 90],
  ['Bulgarian Split Squat', 'legs', 'dumbbell', 120],
  ['Walking Lunge', 'legs', 'dumbbell', 120],
  ['Standing Calf Raise', 'legs', 'machine', 60],
  ['Seated Calf Raise', 'legs', 'machine', 60],
  // Glutes
  ['Hip Thrust', 'glutes', 'barbell', 150],
  ['Glute Kickback', 'glutes', 'cable', 90],
  ['Hip Abduction', 'glutes', 'machine', 90],
  // Core
  ['Plank', 'core', 'bodyweight', 60],
  ['Crunch', 'core', 'bodyweight', 60],
  ['Cable Crunch', 'core', 'cable', 60],
  ['Hanging Leg Raise', 'core', 'bodyweight', 90],
  ['Russian Twist', 'core', 'bodyweight', 60],
  ['Ab Wheel Rollout', 'core', 'bodyweight', 90],
  // Cardio
  ['Treadmill Run', 'cardio', 'machine', 60],
  ['Rowing Machine', 'cardio', 'machine', 60],
  ['Stationary Bike', 'cardio', 'machine', 60],
  ['Jump Rope', 'cardio', 'bodyweight', 60],
]

export const DEFAULT_SETTINGS = {
  id: 1,
  bodyweightKg: 75,
  kcalTarget: 2500,
  proteinTarget: 160,
  carbsTarget: 280,
  fatTarget: 80,
  soundEnabled: true,
  defaultRestSec: 90,
  weeklySessionTarget: 3,
}

export async function ensureSeeded(): Promise<void> {
  const count = await db.exercises.count()
  if (count === 0) {
    const rows: Exercise[] = ROWS.map(([name, muscleGroup, equipment, defaultRestSec]) => ({
      name,
      nameLower: name.toLowerCase(),
      muscleGroup,
      equipment,
      defaultRestSec,
      isCustom: false,
    }))
    await db.exercises.bulkAdd(rows)
  }
  const settings = await db.settings.get(1)
  if (!settings) await db.settings.add(DEFAULT_SETTINGS)
  const rank = await db.rankState.get(1)
  if (!rank) {
    const today = localDateStr()
    await db.rankState.add({
      id: 1,
      seasonId: 1,
      seasonStart: today,
      points: 0,
      streakWeeks: 0,
      lastStreakWeek: '',
      idleDecayTaken: 0,
      lastDecayCheckDate: today,
    })
  }
}
