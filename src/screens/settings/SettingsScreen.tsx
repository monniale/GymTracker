import { useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Volume2, VolumeX, Download, Upload, AlertTriangle } from 'lucide-react'
import { db } from '../../db/db'
import { exportBackup, importBackup } from '../../db/backup'
import { unlockAudio, beep } from '../../lib/audio'
import { localDateStr } from '../../lib/dates'
import { rankForPoints, rankLabel, SEASON_CARRYOVER } from '../../lib/ranks'
import { DEFAULT_BAR_KG, DEFAULT_PLATES } from '../../lib/plates'
import NumberStepper from '../../components/NumberStepper'
import type { Settings } from '../../types'

const PLATE_CATALOG = [25, 20, 15, 10, 5, 2.5, 1.25, 1, 0.5]

export default function SettingsScreen() {
  const settings = useLiveQuery(() => db.settings.get(1))
  const fileRef = useRef<HTMLInputElement>(null)
  const [importMsg, setImportMsg] = useState<string | null>(null)

  if (!settings) return null
  const update = (patch: Partial<Settings>) => db.settings.update(1, patch)

  async function onImportFile(file: File) {
    if (!window.confirm('Importing replaces ALL current data with the backup. Continue?')) return
    try {
      await importBackup(await file.text())
      setImportMsg('Backup imported successfully.')
    } catch (e) {
      setImportMsg(`Import failed: ${(e as Error).message}`)
    }
  }

  async function resetSeason() {
    if (!window.confirm('End the current season now? Points carry over at 20%.')) return
    const state = await db.rankState.get(1)
    if (!state) return
    const info = rankForPoints(state.points)
    await db.seasons.add({
      seasonId: state.seasonId,
      startDate: state.seasonStart,
      endDate: localDateStr(),
      finalPoints: Math.round(state.points),
      finalRank: rankLabel(info.tier),
    })
    await db.rankState.put({
      ...state,
      seasonId: state.seasonId + 1,
      seasonStart: localDateStr(),
      points: Math.round(state.points * SEASON_CARRYOVER),
      streakWeeks: 0,
      lastStreakWeek: '',
      idleDecayTaken: 0,
    })
  }

  return (
    <div className="pt-4">
      <h1 className="mb-4 font-display text-3xl font-bold">Settings</h1>

      <Section title="Profile">
        <div className="flex justify-around">
          <NumberStepper
            label="Bodyweight"
            value={settings.bodyweightKg}
            onChange={v => update({ bodyweightKg: v })}
            step={0.5}
            min={30}
            max={300}
            unit="kg"
          />
          <NumberStepper
            label="Sessions / week"
            value={settings.weeklySessionTarget}
            onChange={v => update({ weeklySessionTarget: Math.round(v) })}
            step={1}
            min={1}
            max={7}
          />
        </div>
        <p className="mt-2 text-xs text-sub">
          Bodyweight normalizes your score (relative strength). The weekly target drives the streak multiplier.
        </p>
      </Section>

      <Section title="Training day targets">
        <div className="grid grid-cols-2 gap-y-4">
          <NumberStepper label="kcal" value={settings.kcalTarget} onChange={v => update({ kcalTarget: Math.round(v) })} step={50} min={800} max={8000} />
          <NumberStepper label="Protein g" value={settings.proteinTarget} onChange={v => update({ proteinTarget: Math.round(v) })} step={5} min={0} max={500} />
          <NumberStepper label="Carbs g" value={settings.carbsTarget} onChange={v => update({ carbsTarget: Math.round(v) })} step={5} min={0} max={1000} />
          <NumberStepper label="Fat g" value={settings.fatTarget} onChange={v => update({ fatTarget: Math.round(v) })} step={2} min={0} max={400} />
        </div>
      </Section>

      <Section title="Rest day targets">
        <div className="grid grid-cols-2 gap-y-4">
          <NumberStepper label="kcal" value={settings.restKcalTarget ?? settings.kcalTarget} onChange={v => update({ restKcalTarget: Math.round(v) })} step={50} min={800} max={8000} />
          <NumberStepper label="Protein g" value={settings.restProteinTarget ?? settings.proteinTarget} onChange={v => update({ restProteinTarget: Math.round(v) })} step={5} min={0} max={500} />
          <NumberStepper label="Carbs g" value={settings.restCarbsTarget ?? settings.carbsTarget} onChange={v => update({ restCarbsTarget: Math.round(v) })} step={5} min={0} max={1000} />
          <NumberStepper label="Fat g" value={settings.restFatTarget ?? settings.fatTarget} onChange={v => update({ restFatTarget: Math.round(v) })} step={2} min={0} max={400} />
        </div>
        <p className="mt-2 text-xs text-sub">
          The Diet tab switches automatically: a day with a logged workout uses training targets.
          Tap the Training/Rest chip on the Diet tab to override a specific day.
        </p>
      </Section>

      <Section title="Barbell">
        <div className="flex items-start justify-between gap-3">
          <NumberStepper
            label="Bar weight"
            value={settings.barWeightKg ?? DEFAULT_BAR_KG}
            onChange={v => update({ barWeightKg: v })}
            step={2.5}
            min={5}
            max={35}
            unit="kg"
          />
          <div className="flex-1">
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-sub">Plates you own</p>
            <div className="flex flex-wrap gap-1.5">
              {PLATE_CATALOG.map(p => {
                const current = settings.platesAvailable ?? DEFAULT_PLATES
                const active = current.includes(p)
                return (
                  <button
                    key={p}
                    onClick={() =>
                      update({
                        platesAvailable: active
                          ? current.filter(x => x !== p)
                          : [...current, p].sort((a, b) => b - a),
                      })
                    }
                    aria-pressed={active}
                    className={`num min-h-[36px] rounded-lg px-2.5 text-sm font-semibold ${
                      active ? 'bg-primary/15 text-primary' : 'bg-muted/30 text-sub'
                    }`}
                  >
                    {p}
                  </button>
                )
              })}
            </div>
          </div>
        </div>
        <p className="mt-2 text-xs text-sub">
          Used by the plate calculator shown when adjusting a barbell set's weight.
        </p>
      </Section>

      <Section title="Rest timer">
        <div className="flex items-center justify-between">
          <NumberStepper
            label="Default rest"
            value={settings.defaultRestSec}
            onChange={v => update({ defaultRestSec: Math.round(v) })}
            step={15}
            min={15}
            max={600}
            unit="s"
          />
          <button
            onClick={() => {
              unlockAudio()
              const next = !settings.soundEnabled
              void update({ soundEnabled: next })
              if (next) beep(1)
            }}
            aria-pressed={settings.soundEnabled}
            className={`flex min-h-[48px] items-center gap-2 rounded-xl px-4 font-semibold ${
              settings.soundEnabled ? 'bg-primary/15 text-primary' : 'bg-muted/40 text-sub'
            }`}
          >
            {settings.soundEnabled ? <Volume2 size={20} /> : <VolumeX size={20} />}
            Sound {settings.soundEnabled ? 'on' : 'off'}
          </button>
        </div>
        <p className="mt-2 text-xs text-sub">
          Toggling sound on plays a test beep. iOS only allows audio while the app is open — the screen stays
          awake during workouts so the timer keeps running.
        </p>
      </Section>

      <Section title="Data">
        <div className="flex gap-2">
          <button
            onClick={() => exportBackup()}
            className="flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-xl bg-muted/40 font-semibold active:bg-muted"
          >
            <Download size={18} /> Export
          </button>
          <button
            onClick={() => fileRef.current?.click()}
            className="flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-xl bg-muted/40 font-semibold active:bg-muted"
          >
            <Upload size={18} /> Import
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={e => {
              const f = e.target.files?.[0]
              if (f) void onImportFile(f)
              e.target.value = ''
            }}
          />
        </div>
        {importMsg && <p className="mt-2 text-sm text-sub">{importMsg}</p>}
        <p className="mt-2 text-xs text-sub">
          All data lives on this device. Export a JSON backup now and then (share it to Files/iCloud).
        </p>
      </Section>

      <Section title="Danger zone">
        <button
          onClick={resetSeason}
          className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl border border-danger/40 font-semibold text-danger active:bg-danger/10"
        >
          <AlertTriangle size={18} /> End season now
        </button>
      </Section>

      <p className="py-6 text-center text-xs text-sub">GymTracker v1.0 — made for Federico 💪</p>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-4 rounded-2xl border border-edge bg-card p-4">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-sub">{title}</h2>
      {children}
    </section>
  )
}
