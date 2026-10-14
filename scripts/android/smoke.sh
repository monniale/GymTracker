#!/usr/bin/env bash
# Emulator smoke test for the Android app: spec §11 checks 1–10 (11–16 are semi-manual, see
# ANDROID.md › Smoke test). Drives the DEBUG build (io.github.monniale.gymtracker.debug) through
# adb and the WebView DevTools socket (scripts/android/cdp-eval.mjs). Never run it on the S25.
#
# Prerequisites
#   - npm run android:debug        → android/app/build/outputs/apk/debug/gymtracker-*-debug.apk
#   - a booted S25-like emulator: 1080 px wide at 480 dpi = 360 CSS px (ANDROID.md › Emulator)
#
# Usage
#   scripts/android/smoke.sh [--only "1 7 10"] [--apk PATH] [--keep-data] [--no-install]
#   ANDROID_SERIAL=emulator-5584 scripts/android/smoke.sh
#
#   --only        run a subset of the checks (setup and the sync-repo guard always run)
#   --apk         debug APK to install (default: the newest one in the Gradle output folder)
#   --keep-data   keep the app's data (default: `pm clear`, a fresh and deterministic install)
#   --no-install  do not reinstall the APK
#
# Safety
#   - Aborts (exit 2) before any check when the app's GitHub Sync store points at the real data
#     repo (repo name `gymtracker-data`; override with SMOKE_FORBIDDEN_REPO): a debug build must
#     never push test data into it (ROUTEMAP invariant 15). With --keep-data the guarded launch
#     runs in airplane mode: the app syncs on launch, which must not reach GitHub before the check.
#   - Refuses a serial that is not `emulator-*` unless SMOKE_ALLOW_DEVICE=1.
#   - Temporarily changes display density, font scale, stay-awake and the notification shade;
#     they are reset on exit.
#
# Output: PASS/FAIL lines; logs and dumps in .android-test/smoke-<timestamp>/ (gitignored).
# Exit 0 = every check passed, 1 = some failed, 2 = setup failure or safety abort.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."
ROOT=$PWD
# shellcheck source=env.sh
. scripts/android/env.sh

PKG=io.github.monniale.gymtracker.debug
ACT=$PKG/io.github.monniale.gymtracker.MainActivity
export CDP_PORT=${CDP_PORT:-9333}
FORBIDDEN_REPO=${SMOKE_FORBIDDEN_REPO:-gymtracker-data}
OUT=${OUT:-$ROOT/.android-test}

# ------------------------------------------------------------------------------------- results

PASSED=0
FAILED=()
check() { # NAME OK(1|0) [DETAIL]
  local name=$1 ok=$2 detail=${3:-}
  if [ "$ok" = 1 ]; then
    PASSED=$((PASSED + 1))
    echo "PASS  $name${detail:+  — $detail}"
  else
    FAILED+=("$name")
    echo "FAIL  $name${detail:+  — $detail}"
  fi
}
want() { case " $ONLY " in *" $1 "*) return 0 ;; esac; return 1; }
section() { printf '\n== %s\n' "$*"; }

# ----------------------------------------------------------------------------------------- adb

ash() { adb shell "$@" | tr -d '\r'; }
app_pid() { ash pidof "$PKG" | awk '{ print $1 }'; }
# Component of the resumed activity, e.g. com.google.android.apps.nexuslauncher/.NexusLauncherActivity
top_activity() {
  ash dumpsys activity activities | grep -m1 -E 'topResumedActivity|mResumedActivity' |
    sed -E 's/.*ActivityRecord\{[^ ]+ [^ ]+ ([^ }]+).*/\1/'
}
# Channel of our posted notification ID ('' when it is not posted).
notif_channel() {
  ash dumpsys notification --noredact | grep -E "NotificationRecord\(.*pkg=$PKG .*id=$1 " | head -1 |
    sed -E 's/.*channel=([^ )]+).*/\1/'
}
# "<rtc_wakeup> <exact> <allow_while_idle>" counts of our pending alarms (dump kept in $OUT).
# LABEL [TAG]: only alarms whose block contains TAG (e.g. resttimer.END = the rest-timer end alarm).
alarms() {
  local file=$OUT/dumpsys-alarm-$1.txt
  ash dumpsys alarm >"$file"
  node -e '
const [file, pkg, tag] = process.argv.slice(1)
const lines = require("fs").readFileSync(file, "utf8").split("\n")
const byId = new Map()
for (let i = 0; i < lines.length; i++) {
  const m = lines[i].match(/Alarm\{(\w+) type (\d+) [^}]*\}/)
  if (!m || !lines[i].includes(pkg) || byId.has(m[1])) continue
  let text = lines[i]
  for (let j = i + 1; j < Math.min(lines.length, i + 10) && !/Alarm\{/.test(lines[j]); j++) text += "\n" + lines[j]
  byId.set(m[1], { type: Number(m[2]), text })
}
let rtc = 0, exact = 0, idle = 0
for (const a of byId.values()) {
  if (a.type !== 0) continue // 0 = RTC_WAKEUP
  if (tag && !a.text.includes(tag)) continue
  rtc++
  if (/window=\+?0(ms)?\b|exactAllowReason=/.test(a.text)) exact++
  const f = a.text.match(/flags=0x([0-9a-f]+)/)
  if (f && (parseInt(f[1], 16) & 0x2c)) idle++ // FLAG_ALLOW_WHILE_IDLE 0x4 | _UNRESTRICTED 0x8 | _COMPAT 0x20
}
console.log(rtc, exact, idle)' "$file" "$PKG" "${2:-}"
}
# Taps the centre of the first on-screen view whose text is exactly $1 (uiautomator; the shade too).
tap_text() {
  local i tag b x1 y1 x2 y2
  for i in 1 2 3; do
    # A failed dump ("could not get idle state", e.g. while a chronometer ticks in the shade) leaves
    # the previous file in place: delete it first so stale bounds are never tapped.
    ash rm -f /sdcard/gt-smoke-ui.xml
    ash uiautomator dump /sdcard/gt-smoke-ui.xml >/dev/null 2>&1
    adb exec-out cat /sdcard/gt-smoke-ui.xml >"$OUT/ui-$i.xml" 2>/dev/null
    tag=$(grep -o "<node [^>]*text=\"$1\"[^>]*>" "$OUT/ui-$i.xml" | head -1)
    b=$(printf '%s' "$tag" | grep -o 'bounds="\[[0-9]*,[0-9]*\]\[[0-9]*,[0-9]*\]"' | head -1)
    if [ -n "$b" ]; then
      read -r x1 y1 x2 y2 <<<"$(printf '%s' "$b" | tr -c '0-9' ' ')"
      ash input tap $(((x1 + x2) / 2)) $(((y1 + y2) / 2))
      return 0
    fi
    sleep 1
  done
  return 1
}
# Kills the app process the way the system does (no force-stop, which would cancel its alarms).
kill_app() {
  local pid
  pid=$(app_pid)
  [ -n "$pid" ] || return 0
  ash am kill "$PKG" >/dev/null
  sleep 1
  [ -z "$(app_pid)" ] && return 0
  ash run-as "$PKG" kill -9 "$pid" >/dev/null 2>&1
  sleep 1
  [ -z "$(app_pid)" ] && return 0
  if adb root >/dev/null 2>&1; then
    adb wait-for-device
    sleep 2
    pid=$(app_pid)
    [ -n "$pid" ] && ash kill -9 "$pid"
    sleep 1
  fi
  [ -z "$(app_pid)" ]
}

# ----------------------------------------------------------------------------------------- CDP

cdp() { node "$ROOT/scripts/android/cdp-eval.mjs" "$@"; }
# Page helpers, (re)installed by every evaluation (a reload clears them).
H='if (!window.__gt) { window.__gt = 1;
  window.__q = (sel, text) => [...document.querySelectorAll(sel)].find(e => !text || (e.textContent || "").includes(text) || (e.getAttribute("aria-label") || "").includes(text));
  window.__click = (sel, text) => { const e = window.__q(sel, text); if (!e) return false; e.click(); return true };
  window.__sheets = () => document.querySelectorAll("div.fixed.inset-0.z-50").length;
  window.__rest = () => { try { return JSON.parse(localStorage.getItem("gymtracker-app") || "{}").state?.rest ?? null } catch { return null } };
  window.__plugin = name => Capacitor.Plugins[name] ?? Capacitor.registerPlugin(name);
  window.confirm = () => false; window.alert = () => {} }'
js() { cdp --raw "$H; $1"; }                              # prints the value (strings unquoted)
js_wait() { cdp --wait "$1" "$H; $2" >/dev/null 2>&1; } # status 0 once truthy within $1 ms
q() { printf '"%s"' "$1"; }                               # JS string literal (no quotes/backslashes inside)
# js_check NAME TIMEOUT_MS EXPR — EXPR (may await) yields { ok, detail }; retried until ok or timeout.
js_check() {
  local name=$1 ms=$2 expr=$3 out
  out=$(cdp --raw --timeout $((ms + 10000)) "(async () => { $H
    const t0 = Date.now(); let r
    for (;;) {
      try { r = await (async () => ($expr))() } catch (e) { r = { ok: false, detail: String((e && e.message) || e) } }
      if ((r && r.ok) || Date.now() - t0 > $ms) break
      await new Promise(f => setTimeout(f, 300))
    }
    return (r && r.ok ? '1' : '0') + '|' + String(r && r.detail != null ? r.detail : '')
  })()" 2>&1)
  if [ $? -ne 0 ] || ! [[ "$out" =~ ^[01]\| ]]; then
    check "$name" 0 "cdp: $(printf '%s' "$out" | head -2 | tr '\n' ' ')"
    return
  fi
  check "$name" "${out%%|*}" "${out#*|}"
}

# Forwards the DevTools socket of the running app and waits for the UI (nav rendered).
attach() {
  local deadline=$((SECONDS + ${1:-30})) pid
  while [ "$SECONDS" -lt "$deadline" ]; do
    pid=$(app_pid)
    if [ -n "$pid" ]; then
      adb forward --remove "tcp:$CDP_PORT" >/dev/null 2>&1
      if adb forward "tcp:$CDP_PORT" "localabstract:webview_devtools_remote_$pid" >/dev/null 2>&1 &&
        cdp --wait 4000 'location.origin === "https://localhost" && !!document.querySelector("nav")' >/dev/null 2>&1; then
        return 0
      fi
    fi
    sleep 1
  done
  return 1
}
# App in front (singleTask: no reload when it is already running) and attached.
front() {
  ash am start -n "$ACT" >/dev/null
  attach "${1:-30}"
}
goto() { js_wait 6000 "location.hash = $(q "#$1"); location.hash === $(q "#$1")"; }
click() { js_wait "${3:-8000}" "window.__click($(q "$1"), $(q "$2"))"; }
rest_ends_at() { js 'String(window.__rest()?.endsAt ?? "")'; }
# Starts Settings › Rest timer › "Test rest (15 s)" (startRest(15, 'Test rest')); prints endsAt.
test_rest() {
  goto /settings && click button 'Test rest (15 s)' 15000 && js_wait 3000 'window.__rest() !== null' && rest_ends_at
}
stop_native_rest() { js 'window.__plugin("RestTimer").stop().then(() => true)' >/dev/null 2>&1; }

# Device clock (ms) via CDP; sleep_until_dev waits on the host until the device clock reaches $1.
OFFSET=0
sync_clock() {
  local d
  d=$(js 'Date.now()') && [[ "$d" =~ ^[0-9]+$ ]] && OFFSET=$((d - $(date +%s%3N)))
}
sleep_until_dev() {
  local ms=$(($1 - ($(date +%s%3N) + OFFSET)))
  [ "$ms" -gt 0 ] && sleep "$(awk -v m="$ms" 'BEGIN { printf "%.3f", m / 1000 }')"
  return 0
}

# ------------------------------------------------------------------------------- check helpers

layout_pass() { # LABEL WIDTH
  local tab
  for tab in workout diet progress rank settings; do
    goto "/$tab"
    sleep 1
    js_check "3 layout $1 #/$tab" 3000 '(() => {
      const w = innerWidth, sw = document.documentElement.scrollWidth
      const off = sw > w ? [...document.querySelectorAll("body *")].filter(e => e.getBoundingClientRect().right > w + 0.5).slice(0, 4)
        .map(e => e.tagName.toLowerCase() + "." + String(e.className).trim().split(/\s+/).slice(0, 3).join(".")) : []
      return { ok: w === '"$2"' && sw <= w, detail: `innerWidth=${w} scrollWidth=${sw}` + (off.length ? ` overflow: ${off.join(" ")}` : "") }
    })()'
  done
}

font_sizes() { js '[getComputedStyle(document.body).fontSize, getComputedStyle(document.querySelector("nav a") || document.body).fontSize].join(" ")'; }

px() { # FILE XFRACTION Y → "r g b" (raw screencap: w, h, format[, dataspace] header, RGBA_8888)
  node -e '
const [f, fx, y] = process.argv.slice(1)
const b = require("fs").readFileSync(f)
const w = b.readUInt32LE(0), h = b.readUInt32LE(4), hdr = b.length - w * h * 4
if (hdr !== 12 && hdr !== 16) { console.log("? ? ?"); process.exit(0) }
const o = hdr + (Number(y) * w + Math.floor(w * Number(fx))) * 4
console.log(b[o], b[o + 1], b[o + 2])' "$@"
}

back() { ash input keyevent KEYCODE_BACK; }

# Sourced (e.g. to test the helpers): stop after the definitions.
[[ "${BASH_SOURCE[0]}" != "$0" ]] && return 0

# ----------------------------------------------------------------------------------------- main

ONLY="1 2 3 4 5 6 7 8 9 10"
APK=""
FRESH=1
INSTALL=1

while [ $# -gt 0 ]; do
  case "$1" in
    --only) ONLY=$2; shift 2 ;;
    --apk) APK=$2; shift 2 ;;
    --keep-data) FRESH=0; shift ;;
    --no-install) INSTALL=0; shift ;;
    -h | --help) sed -n '2,30p' "$0"; exit 0 ;;
    *) echo "smoke.sh: unknown option $1" >&2; exit 2 ;;
  esac
done

OUT=$ROOT/.android-test/smoke-$(date +%Y%m%d-%H%M%S)
mkdir -p "$OUT"
exec > >(tee -a "$OUT/smoke.log") 2>&1

die() {
  echo "smoke.sh: $*" >&2
  exit 2
}

# ---------------------------------------------------------------------------------------- setup

for t in adb node; do command -v "$t" >/dev/null || die "$t not on PATH (. scripts/android/env.sh)"; done
if [ -z "${ANDROID_SERIAL:-}" ]; then
  mapfile -t devs < <(adb devices | awk 'NR > 1 && $2 == "device" { print $1 }')
  [ "${#devs[@]}" -eq 1 ] || die "set ANDROID_SERIAL (found ${#devs[@]} devices: ${devs[*]:-none})"
  export ANDROID_SERIAL=${devs[0]}
fi
case "$ANDROID_SERIAL" in
  emulator-*) ;;
  *) [ "${SMOKE_ALLOW_DEVICE:-0}" = 1 ] || die "$ANDROID_SERIAL is not an emulator (never run this on the S25)" ;;
esac
[ "$(adb get-state 2>/dev/null)" = device ] || die "$ANDROID_SERIAL is not connected"

STAY_ON=$(ash settings get global stay_on_while_plugged_in)
OFFLINE=0
# Network off/on for the guarded launch (--keep-data): the launch sync must not run before the guard.
offline() {
  local i
  ash cmd connectivity airplane-mode enable >/dev/null 2>&1 && OFFLINE=1 || return 1
  for i in $(seq 1 25); do # the radios go down asynchronously: wait for no default network
    [[ "$(ash dumpsys connectivity)" == *"Active default network: none"* ]] && return 0
    sleep 0.2
  done
  return 1
}
online() { [ "$OFFLINE" = 1 ] && ash cmd connectivity airplane-mode disable >/dev/null 2>&1; OFFLINE=0; }
cleanup() {
  # Still offline = the guard did not pass (abort, CDP failure): stop the app BEFORE the network returns.
  if [ "$OFFLINE" = 1 ]; then
    adb shell am force-stop "$PKG" >/dev/null 2>&1
    adb shell cmd connectivity airplane-mode disable >/dev/null 2>&1
  fi
  adb shell wm density reset >/dev/null 2>&1
  adb shell settings put system font_scale 1.0 >/dev/null 2>&1
  adb shell cmd statusbar collapse >/dev/null 2>&1
  adb shell settings put global stay_on_while_plugged_in "${STAY_ON:-0}" >/dev/null 2>&1
  adb forward --remove "tcp:$CDP_PORT" >/dev/null 2>&1
}
trap cleanup EXIT

section "setup on $ANDROID_SERIAL ($(ash getprop ro.build.version.release), API $(ash getprop ro.build.version.sdk)) — log: $OUT"
if [ "$INSTALL" = 1 ]; then
  [ -n "$APK" ] || APK=$(ls -t android/app/build/outputs/apk/debug/gymtracker-*-debug.apk 2>/dev/null | head -1)
  [ -n "$APK" ] && [ -f "$APK" ] || die "no debug APK — run npm run android:debug (or pass --apk)"
  if command -v aapt2 >/dev/null; then
    # Not `aapt2 … | grep -q`: grep exits at the first match, aapt2 dies of SIGPIPE and pipefail fails the pipe.
    badging=$(aapt2 dump badging "$APK" 2>/dev/null)
    [[ "$badging" == "package: name='$PKG'"* ]] || die "$APK is not the debug build ($PKG)"
  fi
  echo "install $APK"
  adb install -r -g "$APK" >"$OUT/install.txt" 2>&1 || { cat "$OUT/install.txt"; die "adb install failed"; }
fi
[[ "$(ash pm path "$PKG")" == *package:* ]] || die "$PKG is not installed"
if [ "$FRESH" = 1 ]; then
  ash pm clear "$PKG" >/dev/null
  # -g at install time; a data clear may drop the grants on some builds.
  ash pm grant "$PKG" android.permission.POST_NOTIFICATIONS >/dev/null 2>&1
  ash pm grant "$PKG" android.permission.CAMERA >/dev/null 2>&1
fi
ash am force-stop "$PKG"
ash input keyevent KEYCODE_WAKEUP
ash wm dismiss-keyguard >/dev/null 2>&1
ash settings put global stay_on_while_plugged_in 7
ash wm density reset >/dev/null
ash settings put system font_scale 1.0
ash cmd statusbar collapse >/dev/null 2>&1
echo "display: $(ash wm size | tail -1) · $(ash wm density | tail -1)"
ash dumpsys webviewupdate | grep -m1 -E 'Current WebView package' | sed 's/^ */WebView: /'
adb logcat -c
adb logcat -b crash -c

# ------------------------------------------------------------------------------ 1. launch (+ guard)

if [ "$FRESH" = 0 ]; then
  [ "$(ash settings get global airplane_mode_on)" = 1 ] || offline || die "could not take the emulator offline for the guarded launch"
fi
LAUNCH=$(ash am start -W -n "$ACT")
echo "$LAUNCH" >"$OUT/launch.txt"
attach 40 || die "could not reach the WebView over CDP (debug build? see $OUT)"

# Safety guard, before anything else: never drive a build connected to the real data repo.
SYNC=$(js '(() => { try { const s = JSON.parse(localStorage.getItem("gymtracker-sync") || "{}").state || {}; return (s.owner || "") + "/" + (s.repo || "") } catch (e) { return "?" } })()') || SYNC="?"
REPO=${SYNC#*/}
if [ "$SYNC" = "?" ] || [ "$(printf '%s' "$REPO" | tr '[:upper:]' '[:lower:]')" = "$(printf '%s' "$FORBIDDEN_REPO" | tr '[:upper:]' '[:lower:]')" ]; then
  ash am force-stop "$PKG"
  die "ABORT: the debug app's GitHub Sync points at '$SYNC' (forbidden: $FORBIDDEN_REPO) or could not be read — disconnect it (or pm clear $PKG) first"
fi
[ "$SYNC" = "/" ] || echo "note: debug app is connected to the sync repo '$SYNC' (not the forbidden one)"
online

if want 1; then
  section "1. launch"
  state=$(printf '%s\n' "$LAUNCH" | sed -n 's/^LaunchState: //p')
  total=$(printf '%s\n' "$LAUNCH" | sed -n 's/^TotalTime: //p')
  check "1 cold launch under 2 s" "$([ "$state" = COLD ] && [ -n "$total" ] && [ "$total" -lt 2000 ] && echo 1 || echo 0)" \
    "LaunchState=${state:-?} TotalTime=${total:-?} ms"
  sleep 2
  crashes=$(adb logcat -d -b crash | grep -c "$PKG")
  check "1 no crash after launch" "$([ "$crashes" -eq 0 ] && echo 1 || echo 0)" "$crashes crash-buffer line(s)"
fi

# ------------------------------------------------------------------------------ 2. identity, no SW

if want 2; then
  section "2. identity, no service worker"
  js_check "2 origin https://localhost, platform android, no service worker" 3000 '(async () => {
    const regs = navigator.serviceWorker ? (await navigator.serviceWorker.getRegistrations()).length : 0
    const reg = !!document.getElementById("vite-plugin-pwa:register-sw"), man = !!document.querySelector("link[rel=manifest]")
    return { ok: location.origin === "https://localhost" && Capacitor.getPlatform() === "android" && Capacitor.isNativePlatform() && regs === 0 && !reg && !man,
      detail: `origin=${location.origin} platform=${Capacitor.getPlatform()} swRegistrations=${regs} registerSW=${reg} manifest=${man}` }
  })()'
fi

# ------------------------------------------------------------------------------------- 3. layout


if want 3; then
  section "3. layout at 360 and 320 px, font scale"
  front
  layout_pass "360px" 360
  ash wm density 540
  sleep 3
  attach 20
  layout_pass "320px (density 540)" 320
  ash wm density reset
  sleep 3
  attach 20
  goto /workout
  before=$(font_sizes)
  js 'window.__fontMark = 1; true' >/dev/null
  ash settings put system font_scale 1.3
  sleep 4 # fontScale|fontWeightAdjustment are in configChanges: the activity and the page survive
  attach 30
  after=$(font_sizes)
  # The page must NOT reload (typed values / open sheets would be lost) and the pinned textZoom
  # must keep the sizes. A missing page would also fail `font_sizes`, so check the marker first.
  reloaded=$(js 'window.__fontMark === undefined')
  check "3 One UI font scale 1.3 ignored (textZoom 100, no reload)" "$([ -n "$before" ] && [ "$before" = "$after" ] && [ "$reloaded" = false ] && echo 1 || echo 0)" \
    "body/nav font-size: $before → $after, page reloaded=$reloaded"
  ash settings put system font_scale 1.0
  sleep 4
  attach 30
fi

# -------------------------------------------------------------------------------------- 4. insets

if want 4; then
  section "4. edge-to-edge insets"
  front
  goto /workout
  js_check "4 --safe-area-inset-* CSS variables injected" 3000 '(() => {
    const cs = getComputedStyle(document.documentElement)
    const top = cs.getPropertyValue("--safe-area-inset-top").trim(), bottom = cs.getPropertyValue("--safe-area-inset-bottom").trim()
    return { ok: top !== "", detail: `top=${top || "∅"} bottom=${bottom || "∅"}` }
  })()'
  js_check "4 TabBar inside the viewport" 3000 '(() => {
    const n = document.querySelector("nav").getBoundingClientRect()
    return { ok: n.bottom <= innerHeight + 0.5 && n.top < innerHeight, detail: `nav ${n.top.toFixed(1)}–${n.bottom.toFixed(1)} innerHeight=${innerHeight}` }
  })()'
  for _ in 1 2 3; do # a transport hiccup can truncate the raw capture (px then prints "? ? ?"): retry
    adb exec-out screencap >"$OUT/screen.raw"
    read -r r1 g1 b1 <<<"$(px "$OUT/screen.raw" 0.5 10)"
    [ "$r1" != "?" ] && break
    sleep 1
  done
  read -r r2 g2 b2 <<<"$(px "$OUT/screen.raw" 0.3 10)"
  dark=$(node -e 'console.log(process.argv.slice(1).every(v => /^\d+$/.test(v) && +v <= 48) ? 1 : 0)' "$r1" "$g1" "$b1" "$r2" "$g2" "$b2")
  check "4 status-bar area is dark (#0B0F14 window, not white)" "$dark" "rgb($r1,$g1,$b1) at (w/2,10) · rgb($r2,$g2,$b2) at (0.3w,10)"
fi

# ------------------------------------------------------------------------------------ 5. channels

if want 5; then
  section "5. notification channels"
  front
  goto /settings # loads the native Settings sections (they register DeviceSettings)
  js_check "5 channels created with the right importance" 8000 '(async () => {
    const s = await window.__plugin("DeviceSettings").getStatus()
    const ch = Object.fromEntries(s.channels.map(c => [c.id, c.importance]))
    const want = { rest_countdown_v1: 3, rest_alert_v1: 4, rest_alert_quiet_v1: 4, workout_reminders_v1: 3, meal_reminders_v1: 3,
      water_reminders_v1: 2, rank_alerts_v1: 3, weekly_recap_v1: 2, app_status_v1: 2 }
    const bad = Object.entries(want).filter(([id, imp]) => ch[id] !== imp).map(([id, imp]) => `${id}=${ch[id] ?? "missing"} (want ${imp})`)
    if (!("default" in ch)) bad.push("default=missing")
    return { ok: bad.length === 0, detail: bad.length ? bad.join(", ") : Object.entries(ch).map(([id, imp]) => id + "=" + imp).join(" ") }
  })()'
fi

# ---------------------------------------------------------------------------------- 6. exact alarms

if want 6; then
  section "6. exact alarms without appops"
  front
  echo "appops SCHEDULE_EXACT_ALARM: $(ash appops get "$PKG" SCHEDULE_EXACT_ALARM | head -1) (not pre-granted; USE_EXACT_ALARM must suffice)"
  js_check "6 canScheduleExactAlarms via USE_EXACT_ALARM" 5000 '(async () => {
    const r = await window.__plugin("LocalNotifications").checkExactNotificationSetting()
    const s = await window.__plugin("DeviceSettings").getStatus()
    return { ok: r.exact_alarm === "granted" && s.canScheduleExactAlarms === true, detail: `exact_alarm=${r.exact_alarm} canScheduleExactAlarms=${s.canScheduleExactAlarms}` }
  })()'
  goto /settings
  if click button 'Reschedule now' 15000; then
    tops=""
    for _ in 1 2 3 4 5 6; do
      tops+="$(top_activity) "
      sleep 0.5
    done
    bounced=$(printf '%s\n' $tops | grep -vc "^$PKG/")
    check "6 full re-plan stays in the app (no Alarms & reminders screen)" "$([ "$bounced" -eq 0 ] && echo 1 || echo 0)" \
      "top activities: $(printf '%s\n' $tops | sort -u | tr '\n' ' ')"
    js_check "6 manual re-plan finished" 10000 '(() => {
      const p = [...document.querySelectorAll("p")].find(e => /^(Rescheduled \d+ reminder|Nothing scheduled|Re-plan failed)/.test(e.textContent || ""))
      return { ok: !!p && !/failed/.test(p.textContent), detail: p ? p.textContent : "no result line" }
    })()'
  else
    check "6 full re-plan stays in the app (no Alarms & reminders screen)" 0 "Reschedule now button not found"
  fi
fi

# ------------------------------------------------------------------------------------ 7. rest timer

if want 7; then
  section "7. rest timer (foreground: no heads-up; background: Rest over on the discreet channel)"
  front
  stop_native_rest
  ends=$(test_rest)
  if ! [[ "$ends" =~ ^[0-9]+$ ]]; then
    check "7 test rest started" 0 "no rest in the store (got '$ends')"
  else
    sleep 1.5
    js_check "7 countdown 4201 posted (chronometer counting down)" 4000 '(async () => {
      const { notifications } = await window.__plugin("LocalNotifications").getDeliveredNotifications()
      const n = notifications.find(x => x.id === 4201)
      return { ok: !!n && n.data?.["android.chronometerCountDown"] === true, detail: n ? `title=${n.title} body=${n.body}` : "4201 not posted" }
    })()'
    ch=$(notif_channel 4201)
    check "7 countdown on rest_countdown_v1" "$([ "$ch" = rest_countdown_v1 ] && echo 1 || echo 0)" "channel=${ch:-none}"
    # Only the rest-timer end alarm (tag *walarm*:…resttimer.END), not the reminders also pending.
    read -r rtc exact idle <<<"$(alarms rest resttimer.END)"
    check "7 end alarm is an exact RTC_WAKEUP alarm" "$([ "${rtc:-0}" -eq 1 ] && [ "${exact:-0}" -eq 1 ] && echo 1 || echo 0)" \
      "resttimer.END: rtc_wakeup=$rtc exact=$exact allow_while_idle=$idle (dumpsys-alarm-rest.txt)"
    sync_clock
    sleep_until_dev $((ends + 2500))
    js_check "7 foreground end: countdown gone, no heads-up (A5)" 3000 '(async () => {
      const ids = (await window.__plugin("LocalNotifications").getDeliveredNotifications()).notifications.map(n => n.id)
      return { ok: !ids.includes(4201) && !ids.includes(4202), detail: `delivered: [${ids.join(", ")}]` }
    })()'
    js_check "7 store rest cleared ~4 s after the end" 6000 '({ ok: window.__rest() === null, detail: JSON.stringify(window.__rest()) })'

    ends=$(test_rest)
    sync_clock
    sleep 1
    ash input keyevent KEYCODE_HOME
    sleep_until_dev $((ends + 2500))
    c1=$(notif_channel 4201)
    c2=$(notif_channel 4202)
    check "7 background end: 'Rest over' 4202 on rest_alert_quiet_v1, countdown gone" \
      "$([ -z "$c1" ] && [ "$c2" = rest_alert_quiet_v1 ] && echo 1 || echo 0)" "4201=${c1:-none} 4202=${c2:-none}"
    sleep 5
    c2=$(notif_channel 4202)
    check "7 'Rest over' survives the in-app 4 s auto-clear" "$([ "$c2" = rest_alert_quiet_v1 ] && echo 1 || echo 0)" "4202=${c2:-none}"
    front
    js_check "7 store rest cleared after the background end" 6000 '({ ok: window.__rest() === null, detail: JSON.stringify(window.__rest()) })'
    stop_native_rest
    sleep 0.5
    c2=$(notif_channel 4202)
    check "7 RestTimer.stop() removes the 'Rest over' alert" "$([ -z "$c2" ] && echo 1 || echo 0)" "4202=${c2:-none}"
  fi
fi

# ------------------------------------------------------------------------------- 8. process death

if want 8; then
  section "8. process death: the end alert comes from a fresh broadcast-only process"
  front
  stop_native_rest
  ends=$(test_rest)
  if ! [[ "$ends" =~ ^[0-9]+$ ]]; then
    check "8 test rest started" 0 "no rest in the store (got '$ends')"
  else
    sync_clock
    ash input keyevent KEYCODE_HOME
    sleep 1
    adb forward --remove "tcp:$CDP_PORT" >/dev/null 2>&1
    adb logcat -d >"$OUT/logcat-before-8.txt" # kept for the console-error summary at the end
    adb logcat -c
    kill_app
    check "8 app process killed (not force-stopped: alarms kept)" "$([ -z "$(app_pid)" ] && echo 1 || echo 0)" "pid=$(app_pid)"
    sleep_until_dev $((ends + 3000))
    c2=$(notif_channel 4202)
    check "8 'Rest over' posted on time with the app dead" "$([ "$c2" = rest_alert_quiet_v1 ] && echo 1 || echo 0)" "4202=${c2:-none}"
    adb logcat -d >"$OUT/logcat-process-death.txt"
    started=$(grep 'Start proc' "$OUT/logcat-process-death.txt" | grep "$PKG" | grep -i broadcast | head -1)
    check "8 logcat: process started for the RestTimerReceiver broadcast" "$([ -n "$started" ] && echo 1 || echo 0)" \
      "$(printf '%s' "${started:-no 'Start proc … broadcast' line}" | sed -E 's/^.*(Start proc)/\1/' | cut -c1-160)"
    front 40
    js_check "8 relaunch reconciles: store rest cleared" 10000 '({ ok: window.__rest() === null, detail: JSON.stringify(window.__rest()) })'
    stop_native_rest
  fi
fi

# ----------------------------------------------------------------------------------- 9. reminders

if want 9; then
  section "9. reminders: scheduled = plan, fire on time, tap routes"
  front
  # Lunch 60–120 s ahead (planner lead is 30 s) + water, written to the persisted prefs and applied
  # by a reload (launch re-plan = full). Atomic: no store write can land between setItem and reload.
  PLAN=$(js '(() => { const t = Math.ceil((Date.now() + 60e3) / 60e3) * 60e3, d = new Date(t), p = n => String(n).padStart(2, "0"); return t + " " + p(d.getHours()) + ":" + p(d.getMinutes()) })()')
  read -r T HHMM <<<"$PLAN"
  if ! [[ "${T:-}" =~ ^[0-9]+$ ]]; then
    check "9 reminder prefs applied" 0 "could not compute the lunch time ($PLAN)"
  else
    js '(() => { const k = "gymtracker-notify", o = JSON.parse(localStorage.getItem(k) || "{\"state\":{},\"version\":1}"); o.state = o.state || {}; const p = o.state.prefs || {}
      p.enabled = true; p.meals = { ...(p.meals || {}), lunch: { enabled: true, time: '"$(q "$HHMM")"' } }; p.water = { enabled: true, start: "09:00", end: "21:00", intervalMin: 120 }
      o.state.prefs = p; localStorage.setItem(k, JSON.stringify(o)); location.reload(); return true })()' >/dev/null 2>&1
    sleep 2
    attach 30
    js_check "9 lunch reminders scheduled = planner window (lunch at $HHMM)" 15000 '(async () => {
      const T = '"$T"', [hh, mm] = '"$(q "$HHMM")"'.split(":").map(Number), now = Date.now(), base = new Date(now), want = []
      for (let k = 0; k < 7; k++) {
        const day = new Date(base.getFullYear(), base.getMonth(), base.getDate() + k)
        const at = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hh, mm).getTime()
        if (at > now + 30e3) want.push(110000000 + Math.round((Date.UTC(day.getFullYear(), day.getMonth(), day.getDate()) - Date.UTC(2026, 0, 1)) / 864e5) * 100 + 1)
      }
      const all = (await window.__plugin("LocalNotifications").getAll({ state: "SCHEDULED" })).notifications
      const got = all.filter(n => Math.floor(n.id / 1e7) === 11 && n.id % 100 === 1).map(n => n.id).sort()
      const first = all.find(n => n.id === want[0])
      const same = got.length === want.length && want.slice().sort().every((id, i) => id === got[i])
      return { ok: same && first?.extra?.atMs === T, detail: `want [${want.join(",")}] got [${got.join(",")}] first.atMs=${first?.extra?.atMs} (T=${T})` }
    })()'
    js_check "9 water reminders scheduled; every id planner-managed and exact" 5000 '(async () => {
      const all = (await window.__plugin("LocalNotifications").getAll({ state: "SCHEDULED" })).notifications
      const water = all.filter(n => Math.floor(n.id / 1e7) === 12).length
      const foreign = all.filter(n => !((n.id >= 100000000 && n.id < 190000000) || n.id === 990000000)).map(n => n.id)
      const inexact = all.filter(n => n.isExactNotification !== true).map(n => n.id)
      return { ok: water > 0 && foreign.length === 0 && inexact.length === 0,
        detail: `${all.length} scheduled, water=${water}, outside planner range=[${foreign.join(",")}], inexact=[${inexact.join(",")}]` }
    })()'
    read -r rtc exact idle <<<"$(alarms reminders)"
    check "9 AlarmManager: RTC_WAKEUP + allow-while-idle alarms" "$([ "${rtc:-0}" -ge 2 ] && [ "${idle:-0}" -ge 1 ] && echo 1 || echo 0)" \
      "rtc_wakeup=$rtc exact=$exact allow_while_idle=$idle (dumpsys-alarm-reminders.txt)"

    LUNCH_ID=$(js '(() => { const d = new Date('"$T"'); return 110000000 + Math.round((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(2026, 0, 1)) / 864e5) * 100 + 1 })()')
    goto /rank
    sync_clock
    ash input keyevent KEYCODE_HOME
    sleep_until_dev $((T + 2000))
    ch=""
    for _ in $(seq 1 20); do
      ch=$(notif_channel "$LUNCH_ID")
      [ -n "$ch" ] && break
      sleep 1
    done
    check "9 lunch reminder fired on time ($HHMM)" "$([ "$ch" = meal_reminders_v1 ] && echo 1 || echo 0)" "id=$LUNCH_ID channel=${ch:-not posted}"
    ash cmd statusbar expand-notifications
    sleep 2
    if tap_text 'Log your lunch'; then
      sleep 2
      attach 30
      js_check "9 tapping the reminder opens #/diet" 8000 '({ ok: location.hash === "#/diet", detail: location.hash })'
    else
      check "9 tapping the reminder opens #/diet" 0 "'Log your lunch' not found in the shade (ui-*.xml)"
    fi
    ash cmd statusbar collapse >/dev/null 2>&1
  fi
fi

# ------------------------------------------------------------------------------------ 10. back key

if want 10; then
  section "10. back button"
  front
  goto /diet
  if click button 'Add food to Lunch' && js_wait 4000 'window.__sheets() === 1'; then
    js 'document.activeElement && document.activeElement.blur(); true' >/dev/null # no IME to swallow the key
    sleep 0.7
    back
    js_check "10a back closes the Add food sheet, route unchanged" 4000 '({ ok: window.__sheets() === 0 && location.hash === "#/diet", detail: `sheets=${window.__sheets()} hash=${location.hash}` })'
  else
    check "10a back closes the Add food sheet, route unchanged" 0 "could not open the Add food sheet"
  fi

  goto /workout
  if click a 'History' && js_wait 5000 'location.hash === "#/workout/history"'; then
    back
    js_check "10b back on #/workout/history → #/workout" 4000 '({ ok: location.hash === "#/workout", detail: location.hash })'
  else
    check "10b back on #/workout/history → #/workout" 0 "could not open History"
  fi

  goto /diet
  back
  js_check "10c back on #/diet → #/workout" 4000 '({ ok: location.hash === "#/workout", detail: location.hash })'

  ends=$(test_rest)
  goto /workout
  pid0=$(app_pid)
  back
  sleep 1.5
  top=$(top_activity)
  pid1=$(app_pid)
  check "10d back on #/workout minimizes the app" "$([ -n "$top" ] && [ "${top%%/*}" != "$PKG" ] && echo 1 || echo 0)" "top=$top"
  check "10d process still alive" "$([ -n "$pid0" ] && [ "$pid0" = "$pid1" ] && echo 1 || echo 0)" "pid $pid0 → ${pid1:-dead}"
  front
  js_check "10d rest timer and route preserved" 3000 '({ ok: window.__rest() !== null && location.hash === "#/workout", detail: `rest=${JSON.stringify(window.__rest())} hash=${location.hash}` })'
  js 'window.__click("button", "Skip rest")' >/dev/null
  stop_native_rest
fi

# ------------------------------------------------------------------------------------------ end

section "crash check"
adb logcat -d -b crash >"$OUT/logcat-crash.txt"
crashes=$(grep -c "$PKG" "$OUT/logcat-crash.txt")
check "no app crash during the run" "$([ "$crashes" -eq 0 ] && echo 1 || echo 0)" "$crashes crash-buffer line(s) (logcat-crash.txt)"
# Informational: WebView console errors (Capacitor/Console E lines), deduplicated by message.
adb logcat -d >"$OUT/logcat-end.txt"
console=$(cat "$OUT"/logcat-before-8.txt "$OUT/logcat-end.txt" 2>/dev/null | grep -E ' E Capacitor/Console' |
  sed -E 's/^.* E Capacitor\/Console: //' | sort | uniq -c | sort -rn)
if [ -n "$console" ]; then
  echo "note: WebView console errors (count, message):"
  printf '%s\n' "$console" | cut -c1-220 | sed 's/^/  /'
else
  echo "note: no WebView console errors"
fi

section "summary"
echo "$PASSED passed, ${#FAILED[@]} failed — $OUT"
for f in "${FAILED[@]}"; do echo "  ✗ $f"; done
[ "${#FAILED[@]}" -eq 0 ]
