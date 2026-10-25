#!/usr/bin/env bash
# Packages out/Release into dist/:
#   unveil-<version>-linux-x64.tar.xz   unpack anywhere and run ./unveil
#   SHA256SUMS-linux.txt
. "$(dirname "$0")/env.sh"

dist="$UNVEIL_ROOT/dist"
name="unveil-$UNVEIL_VERSION-linux-x64"
stage="$(mktemp -d)/unveil"
trap 'rm -rf "$(dirname "$stage")"' EXIT
mkdir -p "$stage" "$dist"

cd "$UNVEIL_OUT"
step "collect the browser's files"
# What Chromium's own Linux packages ship (chrome/installer/linux), minus
# what this build doesn't make.
files=(
  chrome chrome_crashpad_handler
  chrome_100_percent.pak chrome_200_percent.pak resources.pak
  icudtl.dat snapshot_blob.bin v8_context_snapshot.bin
  libEGL.so libGLESv2.so libvk_swiftshader.so vk_swiftshader_icd.json libvulkan.so.1
  initial_preferences
)
for f in "${files[@]}"; do
  [ -e "$f" ] && cp -a "$f" "$stage/"
done
cp -a locales unveil_shell "$stage/"
# The setuid sandbox helper, for systems without user namespaces; it only
# works when owned by root with mode 4755 (see the README in the archive).
cp -a chrome_sandbox "$stage/chrome-sandbox"
for size in 24 48 64 128 256; do
  cp "$UNVEIL_CHROMIUM/branding/logo/product_logo_$size.png" "$stage/product_logo_$size.png"
done
cp "$UNVEIL_CHROMIUM/scripts/linux/unveil" "$stage/unveil"
cp "$UNVEIL_CHROMIUM/scripts/linux/unveil.desktop" "$stage/unveil.desktop"
cp "$UNVEIL_CHROMIUM/scripts/linux/install.sh" "$stage/install.sh"
chmod +x "$stage/unveil" "$stage/install.sh"

step "dist/$name.tar.xz"
tar -C "$(dirname "$stage")" -cJf "$dist/$name.tar.xz" --transform "s,^unveil,$name," unveil
cd "$dist"
sha256sum "$name.tar.xz" > SHA256SUMS-linux.txt
cat SHA256SUMS-linux.txt
