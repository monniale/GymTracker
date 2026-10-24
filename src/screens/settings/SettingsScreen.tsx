import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import {
  Volume2,
  VolumeX,
  Download,
  Upload,
  FileSpreadsheet,
  AlertTriangle,
  Film,
  ImageOff,
  FlaskConical,
  Calculator,
} from "lucide-react";
import { db } from "../../db/db";
import { exportBackup, importBackup } from "../../db/backup";
import { unlockAudio, beep } from "../../lib/audio";
import { localDateStr } from "../../lib/dates";
import { archiveCurrentSeason } from "../../lib/season";
import { DEFAULT_BAR_KG, DEFAULT_PLATES } from "../../lib/plates";
import NumberStepper from "../../components/NumberStepper";
import SyncSection from "./SyncSection";
import AiSection from "./AiSection";
import ImportHistorySheet from "./ImportHistorySheet";
import TargetsCalculatorSheet from "./TargetsCalculator";
import { isNative } from "../../native/platform";
import { useUiStore, type Lang } from "../../lib/uiStore";
import { clearDemoData } from "../../lib/demoData";
import type { Settings } from "../../types";
import { t } from "../../i18n";

const PLATE_CATALOG = [25, 20, 15, 10, 5, 2.5, 1.25, 1, 0.5];

// Android-only sections. `isNative` is a build-time false in the Pages build, so Rollup drops
// these chunks (and the plugins they import) from the PWA.
const NotificationsSection = isNative
  ? lazy(() => import("../../native/ui/NotificationsSection"))
  : null;
const RestTimerNativeSettings = isNative
  ? lazy(() => import("../../native/ui/RestTimerNativeSettings"))
  : null;
const WidgetSection = isNative
  ? lazy(() => import("../../native/ui/WidgetSection"))
  : null;
const UpdateSection = isNative
  ? lazy(() => import("../../native/ui/UpdateSection"))
  : null;

export default function SettingsScreen() {
  const settings = useLiveQuery(() => db.settings.get(1));
  const fileRef = useRef<HTMLInputElement>(null);
  const csvRef = useRef<HTMLInputElement>(null);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [historyCsv, setHistoryCsv] = useState<string | null>(null);
  const [calcOpen, setCalcOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  // Android's first-run card links here with `state.focus` ("sync" | "data").
  const focus = (location.state as { focus?: string } | null)?.focus;
  const loaded = !!settings;
  useEffect(() => {
    if (!loaded || !focus) return;
    const show = () =>
      document
        .getElementById(`settings-${focus}`)
        ?.scrollIntoView({ block: "start" });
    show();
    // The lazy native sections above the target finish loading after this
    // first paint; keep the target in view while the page settles.
    const ro = new ResizeObserver(show);
    ro.observe(document.body);
    const done = setTimeout(() => {
      ro.disconnect();
      navigate(location.pathname, { replace: true, state: null });
    }, 1500);
    return () => {
      clearTimeout(done);
      ro.disconnect();
    };
  }, [loaded, focus]);

  if (!settings) return null;
  const update = (patch: Partial<Settings>) => db.settings.update(1, patch);

  async function onImportFile(file: File) {
    if (
      !window.confirm(t("settings.data.importConfirm"))
    )
      return;
    try {
      await importBackup(await file.text());
      setImportMsg(t("settings.data.imported"));
    } catch (e) {
      setImportMsg(t("settings.data.importFailed", { error: (e as Error).message }));
    }
  }

  async function resetSeason() {
    if (
      !window.confirm(t("settings.danger.endSeasonConfirm"))
    )
      return;
    await archiveCurrentSeason(localDateStr());
  }

  return (
    <div className="pt-4">
      <h1 className="mb-4 font-display text-3xl font-bold">{t("settings.title")}</h1>

      <Section title={t("settings.profile.title")}>
        <div className="flex flex-wrap justify-around gap-3">
          <NumberStepper
            label={t("settings.profile.bodyweight")}
            compact="narrow"
            value={settings.bodyweightKg}
            onChange={(v) => {
              void update({ bodyweightKg: v });
              void db.bodyLog.put({ date: localDateStr(), weightKg: v });
            }}
            step={0.5}
            min={30}
            max={300}
            unit="kg"
          />
          <NumberStepper
            label={t("settings.profile.sessionsPerWeek")}
            compact="narrow"
            value={settings.weeklySessionTarget}
            onChange={(v) => update({ weeklySessionTarget: Math.round(v) })}
            step={1}
            min={1}
            max={7}
          />
        </div>
        <p className="mt-2 text-xs text-sub">
          {t("settings.profile.hint")}
        </p>
      </Section>

      <LanguageSection />

      <ExerciseMediaSection />

      <Section title={t("settings.targets.training")}>
        <div className="grid grid-cols-2 gap-y-4">
          <NumberStepper
            label={t("units.kcal")}
            compact="narrow"
            value={settings.kcalTarget}
            onChange={(v) => update({ kcalTarget: Math.round(v) })}
            step={50}
            min={800}
            max={8000}
          />
          <NumberStepper
            label={t("settings.targets.protein")}
            compact="narrow"
            value={settings.proteinTarget}
            onChange={(v) => update({ proteinTarget: Math.round(v) })}
            step={5}
            min={0}
            max={500}
          />
          <NumberStepper
            label={t("settings.targets.carbs")}
            compact="narrow"
            value={settings.carbsTarget}
            onChange={(v) => update({ carbsTarget: Math.round(v) })}
            step={5}
            min={0}
            max={1000}
          />
          <NumberStepper
            label={t("settings.targets.fat")}
            compact="narrow"
            value={settings.fatTarget}
            onChange={(v) => update({ fatTarget: Math.round(v) })}
            step={2}
            min={0}
            max={400}
          />
        </div>
        <div className="mt-4 flex justify-center border-t border-edge/50 pt-3">
          <button
            type="button"
            onClick={() => setCalcOpen(true)}
            className="flex min-h-[44px] items-center gap-2 whitespace-nowrap rounded-xl bg-muted/40 px-4 font-semibold active:bg-muted"
          >
            <Calculator size={18} className="shrink-0" />
            {t("settings.calc.button")}
          </button>
        </div>
        <TargetsCalculatorSheet
          open={calcOpen}
          onClose={() => setCalcOpen(false)}
          settings={settings}
        />
      </Section>

      <Section title={t("settings.targets.rest")}>
        <div className="grid grid-cols-2 gap-y-4">
          <NumberStepper
            label={t("units.kcal")}
            compact="narrow"
            value={settings.restKcalTarget ?? settings.kcalTarget}
            onChange={(v) => update({ restKcalTarget: Math.round(v) })}
            step={50}
            min={800}
            max={8000}
          />
          <NumberStepper
            label={t("settings.targets.protein")}
            compact="narrow"
            value={settings.restProteinTarget ?? settings.proteinTarget}
            onChange={(v) => update({ restProteinTarget: Math.round(v) })}
            step={5}
            min={0}
            max={500}
          />
          <NumberStepper
            label={t("settings.targets.carbs")}
            compact="narrow"
            value={settings.restCarbsTarget ?? settings.carbsTarget}
            onChange={(v) => update({ restCarbsTarget: Math.round(v) })}
            step={5}
            min={0}
            max={1000}
          />
          <NumberStepper
            label={t("settings.targets.fat")}
            compact="narrow"
            value={settings.restFatTarget ?? settings.fatTarget}
            onChange={(v) => update({ restFatTarget: Math.round(v) })}
            step={2}
            min={0}
            max={400}
          />
        </div>
        <div className="mt-4 flex justify-center border-t border-edge/50 pt-3">
          <NumberStepper
            label={t("settings.targets.water")}
            value={settings.waterTargetMl ?? 2500}
            onChange={(v) => update({ waterTargetMl: Math.round(v) })}
            step={250}
            min={500}
            max={8000}
            unit="ml"
          />
        </div>
        <p className="mt-2 text-xs text-sub">
          {t("settings.targets.hint")}
        </p>
      </Section>

      <Section title={t("settings.barbell.title")}>
        <div className="flex items-start justify-between gap-3">
          <NumberStepper
            label={t("settings.barbell.barWeight")}
            compact="narrow"
            value={settings.barWeightKg ?? DEFAULT_BAR_KG}
            onChange={(v) => update({ barWeightKg: v })}
            step={2.5}
            min={5}
            max={35}
            unit="kg"
          />
          <div className="flex-1">
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-sub">
              {t("settings.barbell.plates")}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {PLATE_CATALOG.map((p) => {
                const current = settings.platesAvailable ?? DEFAULT_PLATES;
                const active = current.includes(p);
                return (
                  <button
                    key={p}
                    onClick={() =>
                      update({
                        platesAvailable: active
                          ? current.filter((x) => x !== p)
                          : [...current, p].sort((a, b) => b - a),
                      })
                    }
                    aria-pressed={active}
                    className={`num min-h-[36px] rounded-lg px-2.5 text-sm font-semibold ${
                      active
                        ? "bg-primary/15 text-primary"
                        : "bg-muted/30 text-sub"
                    }`}
                  >
                    {p}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
        <p className="mt-2 text-xs text-sub">
          {t("settings.barbell.hint")}
        </p>
      </Section>

      <Section title={t("settings.restTimer.title")}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <NumberStepper
            label={t("settings.restTimer.defaultRest")}
            compact="narrow"
            value={settings.defaultRestSec}
            onChange={(v) => update({ defaultRestSec: Math.round(v) })}
            step={15}
            min={15}
            max={600}
            unit="s"
          />
          <button
            onClick={() => {
              unlockAudio();
              const next = !settings.soundEnabled;
              void update({ soundEnabled: next });
              if (next) beep(1);
            }}
            aria-pressed={settings.soundEnabled}
            className={`flex min-h-[48px] items-center gap-2 whitespace-nowrap rounded-xl px-4 font-semibold ${
              settings.soundEnabled
                ? "bg-primary/15 text-primary"
                : "bg-muted/40 text-sub"
            }`}
          >
            {settings.soundEnabled ? (
              <Volume2 size={20} />
            ) : (
              <VolumeX size={20} />
            )}
            {settings.soundEnabled
              ? t("settings.restTimer.soundOn")
              : t("settings.restTimer.soundOff")}
          </button>
        </div>
        <p className="mt-2 text-xs text-sub">
          {isNative
            ? t("settings.restTimer.hintNative")
            : t("settings.restTimer.hintWeb")}
        </p>
        {RestTimerNativeSettings && (
          <Suspense fallback={null}>
            <RestTimerNativeSettings />
          </Suspense>
        )}
      </Section>

      {NotificationsSection && (
        <Suspense fallback={null}>
          <NotificationsSection />
        </Suspense>
      )}

      {WidgetSection && (
        <Suspense fallback={null}>
          <WidgetSection />
        </Suspense>
      )}

      <div id="settings-sync" className={SCROLL_MARGIN}>
        <SyncSection />
      </div>

      <AiSection />

      <Section title={t("settings.data.title")} id="settings-data">
        <ClearDemoButton onMessage={setImportMsg} />
        <div className="flex gap-2">
          <button
            onClick={() =>
              // Android rethrows share failures (e.g. a second tap while the sheet is open).
              exportBackup().catch((e) =>
                setImportMsg(t("settings.data.exportFailed", { error: (e as Error).message })),
              )
            }
            className="flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-xl bg-muted/40 font-semibold active:bg-muted"
          >
            <Download size={18} className="shrink-0" /> {t("settings.data.export")}
          </button>
          <button
            onClick={() => fileRef.current?.click()}
            className="flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-xl bg-muted/40 font-semibold active:bg-muted"
          >
            <Upload size={18} className="shrink-0" /> {t("settings.data.import")}
          </button>
          <input
            ref={fileRef}
            type="file"
            // Native file pickers may label .json as octet-stream; import validates the content.
            accept={isNative ? undefined : "application/json"}
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onImportFile(f);
              e.target.value = "";
            }}
          />
        </div>
        <button
          onClick={() => csvRef.current?.click()}
          className="mt-2 flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-muted/40 px-3 text-center font-semibold active:bg-muted"
        >
          <FileSpreadsheet size={18} className="shrink-0" /> {t("settings.data.importCsv")}
        </button>
        <input
          ref={csvRef}
          type="file"
          // Same Android rule as the backup input: pickers mislabel .csv, the parser validates.
          accept={isNative ? undefined : ".csv,text/csv"}
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (!f) return;
            f.text()
              .then(setHistoryCsv)
              .catch((err) => setImportMsg(t("settings.data.readFailed", { error: (err as Error).message })));
          }}
        />
        {historyCsv !== null && (
          <ImportHistorySheet
            text={historyCsv}
            onClose={() => setHistoryCsv(null)}
            onDone={(msg) => {
              setHistoryCsv(null);
              setImportMsg(msg);
            }}
          />
        )}
        {importMsg && <p className="mt-2 text-sm text-sub">{importMsg}</p>}
        <p className="mt-2 text-xs text-sub">
          {isNative
            ? t("settings.data.hintNative")
            : t("settings.data.hintWeb")}
        </p>
      </Section>

      <Section title={t("settings.danger.title")}>
        <button
          onClick={resetSeason}
          className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl border border-danger/40 font-semibold text-danger active:bg-danger/10"
        >
          <AlertTriangle size={18} className="shrink-0" /> {t("settings.danger.endSeason")}
        </button>
      </Section>

      {UpdateSection && (
        <Suspense fallback={null}>
          <UpdateSection />
        </Suspense>
      )}

      <VersionFooter />
    </div>
  );
}

/** Web demo data (lib/demoData.ts): shown only while it is loaded. */
function ClearDemoButton({ onMessage }: { onMessage: (msg: string | null) => void }) {
  const demoLoaded = useUiStore((s) => s.demoLoaded);
  const [busy, setBusy] = useState(false);
  if (!demoLoaded) return null;

  async function onClear() {
    if (!window.confirm(t("settings.data.clearDemoConfirm"))) return;
    setBusy(true);
    onMessage(null);
    try {
      await clearDemoData();
    } catch (e) {
      onMessage(t("settings.data.clearDemoFailed", { error: (e as Error).message }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      onClick={() => void onClear()}
      disabled={busy}
      className="mb-2 flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl border border-danger/40 px-3 text-center font-semibold text-danger active:bg-danger/10 disabled:opacity-50"
    >
      <FlaskConical size={18} className="shrink-0" /> {t("settings.data.clearDemo")}
    </button>
  );
}

/** Build stamp, so you can tell which deploy the installed PWA is running. */
function VersionFooter() {
  const built = new Date(__BUILD_TIME__);
  // Android: the APK's versionName + versionCode (App.getInfo()), via a gated dynamic import.
  const [android, setAndroid] = useState<{
    version: string;
    build: string;
  } | null>(null);
  useEffect(() => {
    if (!isNative) return;
    let alive = true;
    void import("../../native/appInfo")
      .then((m) => m.getAppInfo())
      .then((info) => {
        if (alive) setAndroid(info);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  return (
    <footer className="space-y-0.5 py-6 text-center text-xs text-sub">
      <p>GymTracker v{__APP_VERSION__}</p>
      {android && (
        <p>
          Android {android.version}
          {android.build && ` (${android.build})`}
        </p>
      )}
      <p>
        {t("settings.version.build", {
          sha: __BUILD_SHA__,
          date: localDateStr(built),
          time: built.toTimeString().slice(0, 5),
        })}
      </p>
      <p>{t("settings.version.schema", { version: db.verno })}</p>
    </footer>
  );
}

/** Keeps a section scrolled into view clear of the status bar (Android draws edge to edge). */
const SCROLL_MARGIN = "scroll-mt-[calc(var(--safe-area-inset-top,0px)+1rem)]";

/** The UI language (device-local). Switching reloads the app so every screen, date and reminder follows. */
function LanguageSection() {
  const language = useUiStore((s) => s.language);
  const setLanguage = useUiStore((s) => s.setLanguage);
  const choose = (lang: Lang) => {
    if (lang === language) return;
    setLanguage(lang);
    window.location.reload();
  };
  return (
    <Section title={t("settings.language.title")}>
      <div className="flex gap-2" role="group" aria-label={t("settings.language.title")}>
        {(
          [
            ["en", "English"],
            ["it", "Italiano"],
          ] as const
        ).map(([lang, label]) => (
          <button
            key={lang}
            lang={lang}
            onClick={() => choose(lang)}
            aria-pressed={language === lang}
            className={`min-h-[44px] flex-1 rounded-xl font-semibold ${
              language === lang ? "bg-primary text-bg" : "bg-muted/40 text-sub active:bg-muted"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
    </Section>
  );
}

/** Exercise library animations (device-local, off by default): loaded from the dataset repo on GitHub. */
function ExerciseMediaSection() {
  const on = useUiStore((s) => s.showExerciseMedia);
  const setOn = useUiStore((s) => s.setShowExerciseMedia);
  return (
    <Section title={t("library.settings.title")}>
      <button
        onClick={() => setOn(!on)}
        aria-pressed={on}
        className={`flex min-h-[48px] items-center gap-2 whitespace-nowrap rounded-xl px-4 font-semibold ${
          on ? "bg-primary/15 text-primary" : "bg-muted/40 text-sub"
        }`}
      >
        {on ? <Film size={20} /> : <ImageOff size={20} />}
        {on ? t("library.settings.mediaOn") : t("library.settings.mediaOff")}
      </button>
      <p className="mt-2 text-xs text-sub">{t("library.settings.hint")}</p>
    </Section>
  );
}

function Section({
  title,
  id,
  children,
}: {
  title: string;
  id?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      className={`mb-4 rounded-2xl border border-edge bg-card p-4 ${SCROLL_MARGIN}`}
    >
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-sub">
        {title}
      </h2>
      {children}
    </section>
  );
}
