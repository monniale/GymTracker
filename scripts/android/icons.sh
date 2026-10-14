#!/usr/bin/env bash
# Regenerates the Android launcher icons and splash PNGs from assets/logo.png
# (1024 px, transparent, glyph only = the PWA dumbbell from public/icons, re-drawn at 2x).
#
#   scripts/android/icons.sh
#
# @capacitor/assets runs ad hoc (never a dependency: it nests @capacitor/cli 5). Always pass --android,
# or its PWA generator rewrites a web manifest that clashes with vite-plugin-pwa.
# Afterwards this script re-applies what the generator overwrites or never emits:
#  - mipmap-anydpi-v26/ic_launcher{,_round}.xml with a <monochrome> layer (themed icons, Android 13+);
#    the generator's 16.7 % inset is kept on the foreground only (logo canvas = 72 dp centre; the glyph
#    stays inside the 66 dp safe circle), the background is full-bleed;
#  - AndroidManifest.xml is restored (the generator re-serialises it to set icon attributes that are
#    already there).
# Hand-written vectors are untouched: drawable/ic_launcher_monochrome.xml, ic_stat_gymtracker.xml,
# ic_stat_timer.xml, ic_splash_logo.xml.
set -euo pipefail
cd "$(dirname "$0")/../.."

RES=android/app/src/main/res
MANIFEST=android/app/src/main/AndroidManifest.xml
BG='#0B0F14'

[ -f assets/logo.png ] || { echo "icons.sh: assets/logo.png missing" >&2; exit 1; }
[ -d "$RES" ] || { echo "icons.sh: $RES missing (run npx cap add android first)" >&2; exit 1; }

manifest_backup=$(mktemp)
trap 'rm -f "$manifest_backup"' EXIT
cp "$MANIFEST" "$manifest_backup"

npx --yes @capacitor/assets@3.0.5 generate --android --assetPath assets \
  --iconBackgroundColor "$BG" --iconBackgroundColorDark "$BG" \
  --splashBackgroundColor "$BG" --splashBackgroundColorDark "$BG"

cp "$manifest_backup" "$MANIFEST"

for name in ic_launcher ic_launcher_round; do
  cat > "$RES/mipmap-anydpi-v26/$name.xml" <<'XML'
<?xml version="1.0" encoding="utf-8"?>
<!-- Written by scripts/android/icons.sh (re-run it instead of editing by hand). -->
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@mipmap/ic_launcher_background" />
    <foreground>
        <inset android:drawable="@mipmap/ic_launcher_foreground" android:inset="16.7%" />
    </foreground>
    <monochrome android:drawable="@drawable/ic_launcher_monochrome" />
</adaptive-icon>
XML
done

# Legacy launcher PNGs (only used below API 26): logo mode renders the glyph on transparent, so put it
# on the app background (rounded square / circle). Optional: needs ImageMagick 6 (convert + identify).
if command -v convert >/dev/null 2>&1 && command -v identify >/dev/null 2>&1; then
  for dir in "$RES"/mipmap-*dpi; do
    for name in ic_launcher ic_launcher_round; do
      png="$dir/$name.png"
      [ -f "$png" ] || continue
      s=$(identify -format %w "$png")
      if [ "$name" = ic_launcher ]; then
        shape="roundrectangle 0,0 $((s - 1)),$((s - 1)) $((s / 6)),$((s / 6))"
      else
        shape="circle $((s / 2)),$((s / 2)) $((s / 2)),0"
      fi
      convert -size "${s}x${s}" xc:none -fill "$BG" -draw "$shape" "$png" -composite "$png"
    done
  done
else
  echo "icons.sh: ImageMagick not found — legacy (API < 26) launcher PNGs keep a transparent background" >&2
fi

echo "icons.sh: done — review with: git status -- $RES"
