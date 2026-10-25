#!/usr/bin/env bash
# Puts Unveil on top of the Chromium source: branding files, our patches,
# then Chromium renamed to Unveil in the UI strings (rebrand.mjs). The
# tarball isn't a git checkout, so this runs once per unpacked source
# (fetch.sh unpacks a fresh one after a version change).
. "$(dirname "$0")/env.sh"

cd "$CHROMIUM_SRC"
if [ -f .unveil-applied ]; then
  echo "Unveil is already applied to $CHROMIUM_SRC"
  exit 0
fi

theme=chrome/app/theme
branding="$UNVEIL_CHROMIUM/branding"
step "branding"
cp "$branding/BRANDING" "$theme/chromium/BRANDING"
cp "$branding"/logo/*.png "$theme/chromium/"
for scale in default_100_percent default_200_percent; do
  cp "$branding/$scale/chromium/"*.png "$theme/$scale/chromium/"
done
if [ -d "$theme/chromium/linux" ]; then
  for size in 24 48 64 128 256; do
    [ -f "$theme/chromium/linux/product_logo_$size.png" ] && cp "$branding/logo/product_logo_$size.png" "$theme/chromium/linux/"
  done
fi

step "patches"
for patch in "$UNVEIL_CHROMIUM"/patches/*.patch; do
  echo "patch: $(basename "$patch")"
  git apply --whitespace=nowarn "$patch"
done

step "rebrand"
node "$UNVEIL_CHROMIUM/scripts/rebrand.mjs" "$CHROMIUM_SRC"

touch .unveil-applied
echo "Unveil applied to $CHROMIUM_SRC"
