#!/usr/bin/env bash
# Cuts the signed release APK for the phone. The only supported way to build an S25 install
# (ANDROID.md › Updates); never `npx cap build android` (v1-only signing).
#
#   scripts/android/release.sh                 # clean tree → test → build → sign → verify
#   GT_VERSION_CODE=42 scripts/android/release.sh
#   scripts/android/release.sh --verify APK    # only the checks below, on an existing APK
#
# Guards:
#   - no uncommitted change to a tracked file (the APK carries the commit SHA and count);
#   - versionCode (git commit count, or $GT_VERSION_CODE) not below the last one this script built
#     (~/.android-keys/gymtracker/last-version-code): Android refuses downgrades, and an
#     uninstall wipes every workout;
#   - the synced capacitor.config.json has no `server` block (live reload) and no inspectable
#     WebView (android/app/build.gradle checks the same);
#   - the APK is v2+v3 signed with the release key, zipaligned for 16 KiB pages, has the
#     permanent appId (ROUTEMAP invariant 15), the expected versionCode, and is not debuggable.
# Env: KEYSTORE_PROPERTIES (default ~/.android-keys/gymtracker/keystore.properties),
#      GT_VERSION_CODE, GRADLE_LOCK (optional flock file to serialize Gradle runs).
# Never prints the keystore passwords.
set -euo pipefail
cd "$(dirname "$0")/../.."
# shellcheck source=env.sh
. scripts/android/env.sh

APP_ID=io.github.monniale.gymtracker
KEY_DIR=$HOME/.android-keys/gymtracker
PROPS=${KEYSTORE_PROPERTIES:-$KEY_DIR/keystore.properties}
LAST_FILE=$KEY_DIR/last-version-code
BT=$ANDROID_HOME/build-tools/36.0.0

die() {
  echo "release.sh: $*" >&2
  exit 1
}

# verify APK [VERSION_CODE] — signature, alignment, identity, permissions.
verify() {
  local apk=$1 code=${2:-} sig badging
  [ -f "$apk" ] || die "no such APK: $apk"
  echo "== verify $apk"
  sig=$("$BT/apksigner" verify --verbose --print-certs "$apk" 2>&1) || { echo "$sig" >&2; die "apksigner: signature does not verify"; }
  printf '%s\n' "$sig" | grep -E '^Verifies|scheme \(APK Signature Scheme v[23]\)|certificate DN|certificate SHA-256'
  ! printf '%s\n' "$sig" | grep -q 'CN=Android Debug' || die "signed with the DEBUG key — not installable over the release app"
  printf '%s\n' "$sig" | grep -q 'v2 scheme (APK Signature Scheme v2): true' || die "not v2-signed"
  printf '%s\n' "$sig" | grep -q 'v3 scheme (APK Signature Scheme v3): true' || die "not v3-signed"
  "$BT/zipalign" -c -P 16 4 "$apk" >/dev/null || die "zipalign -c -P 16 failed"
  echo "zipalign: OK (16 KiB pages)"
  badging=$("$BT/aapt2" dump badging "$apk")
  printf '%s\n' "$badging" | grep -E "^package:|^application-label:|^launchable-activity:" | sed -E "s/ (platformBuild|compileSdk)[^ ]*//g"
  printf '%s\n' "$badging" | grep -q "^package: name='$APP_ID' " || die "package is not $APP_ID (invariant 15)"
  [ -z "$code" ] || printf '%s\n' "$badging" | grep -q "versionCode='$code'" || die "versionCode is not $code"
  ! printf '%s\n' "$badging" | grep -q '^application-debuggable' || die "release APK is debuggable"
  echo "permissions:"
  "$BT/aapt2" dump permissions "$apk" | grep -E 'uses-permission' | sed -E "s/^uses-permission: name='([^']+)'/  \1/"
  echo "size: $(du -h "$apk" | cut -f1) · sha256: $(sha256sum "$apk" | cut -d' ' -f1)"
}

if [ "${1:-}" = --verify ]; then
  [ $# -ge 2 ] || die "usage: release.sh --verify APK [VERSION_CODE]"
  verify "$2" "${3:-}"
  exit 0
fi
[ $# -eq 0 ] || die "unknown argument: $1 (see the header of this script)"

[ -f "$PROPS" ] || die "missing $PROPS — the release keystore properties (ANDROID.md › Signing key)"
[ -x "$BT/apksigner" ] || die "build-tools 36.0.0 not found under $ANDROID_HOME"
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  git status --short --untracked-files=no >&2
  die "uncommitted changes to tracked files — commit or stash first"
fi

CODE=${GT_VERSION_CODE:-$(git rev-list --count HEAD)}
[[ "$CODE" =~ ^[1-9][0-9]*$ ]] || die "versionCode '$CODE' is not a positive integer"
LAST=$(cat "$LAST_FILE" 2>/dev/null || echo 0)
[[ "$LAST" =~ ^[0-9]+$ ]] || die "$LAST_FILE does not hold a number"
[ "$CODE" -ge "$LAST" ] ||
  die "versionCode $CODE < last built $LAST — Android refuses downgrades. Use GT_VERSION_CODE=$LAST (or higher)."
VERSION=$(node -p 'require("./package.json").version')
echo "== GymTracker $VERSION ($CODE) from $(git rev-parse --short HEAD) on $(git rev-parse --abbrev-ref HEAD)"

npm test
npm run build:android
npx cap sync android

# Same guard as android/app/build.gradle (preReleaseBuild), before spending a Gradle run on it.
node -e '
const c = JSON.parse(require("fs").readFileSync("android/app/src/main/assets/capacitor.config.json", "utf8"))
if (c.appId !== "'"$APP_ID"'") { console.error("appId is " + c.appId); process.exit(1) }
if (c.server) { console.error("capacitor.config.json has a server block (live reload?)"); process.exit(1) }
if (c.android && c.android.webContentsDebuggingEnabled === true) { console.error("WebView debugging is enabled (CAP_WEBVIEW_DEBUG=1?)"); process.exit(1) }
' || die "refusing to build a release from this capacitor.config.json"

gradle() {
  if [ -n "${GRADLE_LOCK:-}" ]; then
    flock "$GRADLE_LOCK" -c "cd android && ./gradlew --console=plain $*"
  else
    (cd android && ./gradlew --console=plain "$@")
  fi
}
gradle assembleRelease "-PgtVersionCode=$CODE"

APK=android/app/build/outputs/apk/release/gymtracker-$VERSION-$CODE-release.apk
verify "$APK" "$CODE"

mkdir -p "$KEY_DIR"
echo "$CODE" >"$LAST_FILE"
echo
echo "Release APK: $APK"
echo "Install: adb install -r $APK   (never uninstall the app — it deletes all data)"
