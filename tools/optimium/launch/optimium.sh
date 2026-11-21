#!/bin/sh
# Main Optimium launcher: keep its original profile and Linux keyring identity.
set -eu
app_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
export CHROME_DESKTOP=optimium.desktop
enabled_features=ChildProcessSecurityPolicyRust,ChildProcessSecurityPolicyRustProcessState
case "${OPTIMIUM_MEMORY_MODE:-balanced}" in
  balanced)
    enabled_features="$enabled_features,OptimiumForegroundStringCompression,OptimiumReleaseConsumedCodeCache"
    # Keep young JS heaps compact while leaving the total heap adaptive.
    set -- '--js-flags=--memory-saver-mode --max-semi-space-size=4' \
      --disable-field-trial-config \
      --disable-features=PreloadTopChromeWebUI,SpareRendererForSitePerProcess,Prewarm,WebUIOmniboxPopup,WebUIOmniboxAimPopup,WebUIOmniboxFullPopup,PartitionAllocLargeThreadCacheSize \
      "$@"
    ;;
  standard) ;;
  *) printf '%s\n' 'OPTIMIUM_MEMORY_MODE must be balanced or standard.' >&2; exit 2 ;;
esac
browser="$app_dir/Rustinium"
if [ ! -x "$browser" ]; then
  browser="$app_dir/chrome"
fi
exec "$browser" \
  "--user-data-dir=${XDG_CONFIG_HOME:-$HOME/.config}/optimium" \
  "--enable-features=$enabled_features" \
  "$@"
