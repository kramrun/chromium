#!/bin/sh
# Install beside the packaged Rustinium executable as "optimium".
set -eu
app_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
export CHROME_DESKTOP=optimium-rust-origin.desktop

# Keep the original profile and Rust policy features. Explicit caller flags
# remain last to replace a whole switch value for diagnostics. Use standard
# mode to remove the exclusions; --enable-features alone cannot override them.
case "${RUSTINIUM_MEMORY_MODE:-balanced}" in
  balanced)
    set -- --disable-field-trial-config \
      --disable-features=PreloadTopChromeWebUI,SpareRendererForSitePerProcess,Prewarm,WebUIOmniboxPopup,WebUIOmniboxAimPopup,WebUIOmniboxFullPopup \
      "$@"
    ;;
  standard) ;;
  *) printf '%s\n' 'RUSTINIUM_MEMORY_MODE must be balanced or standard.' >&2; exit 2 ;;
esac
exec "$app_dir/Rustinium" \
  "--user-data-dir=${XDG_CONFIG_HOME:-$HOME/.config}/optimium-rust-origin-20261109" \
  --enable-features=ChildProcessSecurityPolicyRust,ChildProcessSecurityPolicyRustProcessState \
  "$@"
