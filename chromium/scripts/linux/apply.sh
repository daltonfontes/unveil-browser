#!/usr/bin/env bash
# Puts Unveil on top of the Chromium source: branding files, our patches,
# then Chromium renamed to Unveil in the UI strings (rebrand.mjs). The
# tarball isn't a git checkout, so this runs once per unpacked source
# (fetch.sh unpacks a fresh one after a version change). .unveil-applied
# lists the patches applied, with their sha256: on a source patched before (a
# resumed CI build) only the patches that came after are added, so a fix
# needs no build from scratch. A patch that changed needs a fresh source.
. "$(dirname "$0")/env.sh"

cd "$CHROMIUM_SRC"
stamp=.unveil-applied
patch_sum() { sha256sum "$1" | cut -d' ' -f1; }
if [ -f "$stamp" ]; then
  # An older stamp is empty: then a patch is new only if it applies and isn't
  # applied already (some patches would apply twice).
  legacy=$([ -s "$stamp" ] || echo 1)
  for patch in "$UNVEIL_CHROMIUM"/patches/*.patch; do
    name=$(basename "$patch")
    sum=$(patch_sum "$patch")
    recorded=$(awk -v n="$name" '$1 == n { print $2 }' "$stamp")
    if [ -n "$recorded" ]; then
      [ "$recorded" = "$sum" ] && continue
      echo "$name changed after $CHROMIUM_SRC was patched: it needs a fresh source" >&2
      exit 1
    fi
    if [ -z "$legacy" ] || { git apply --check "$patch" 2>/dev/null &&
        ! git apply --reverse --check "$patch" 2>/dev/null; }; then
      echo "patch (new since this source was patched): $name"
      git apply --whitespace=nowarn "$patch"
    fi
    echo "$name $sum" >> "$stamp"
  done
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
applied=""
for patch in "$UNVEIL_CHROMIUM"/patches/*.patch; do
  echo "patch: $(basename "$patch")"
  git apply --whitespace=nowarn "$patch"
  applied+="$(basename "$patch") $(patch_sum "$patch")"$'\n'
done

step "rebrand"
node "$UNVEIL_CHROMIUM/scripts/rebrand.mjs" "$CHROMIUM_SRC"

printf '%s' "$applied" > "$stamp"
echo "Unveil applied to $CHROMIUM_SRC"
