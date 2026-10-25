#!/bin/sh
# Adds Unveil to your applications menu (for you only, no sudo): a launcher in
# ~/.local/bin, the menu entry and the icons. Unveil stays in this folder;
# run this again if you move it.
set -eu
here="$(dirname "$(readlink -f "$0")")"
data="${XDG_DATA_HOME:-$HOME/.local/share}"
mkdir -p "$HOME/.local/bin" "$data/applications"
ln -sf "$here/unveil" "$HOME/.local/bin/unveil"
for size in 24 48 64 128 256; do
  mkdir -p "$data/icons/hicolor/${size}x$size/apps"
  cp "$here/product_logo_$size.png" "$data/icons/hicolor/${size}x$size/apps/unveil.png"
done
sed "s|^Exec=unveil|Exec=$here/unveil|" "$here/unveil.desktop" > "$data/applications/unveil.desktop"
command -v update-desktop-database >/dev/null && update-desktop-database "$data/applications" || true
echo "Unveil is in your applications menu."
