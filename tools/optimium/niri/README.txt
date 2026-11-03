Optimium on Niri
===============

Use the native Wayland backend (--ozone-platform=wayland) and app-id optimium
(--class=optimium). In Settings > Appearance choose the panel opacity, then
restart Optimium. 100% is the default; 85%, 70% and 50% affect the native panel
background only, not the text or web content. Custom system GTK/Qt or image-based
extension themes can override this painting path; use the built-in color themes.

Niri normally draws the focus ring as a filled rectangle behind windows with
client-side decorations. That rectangle shows through translucent panels as a
solid color. The supplied optimium.kdl changes only this behavior for Optimium;
it preserves the focus ring around the window and does not fade the whole window.

To install, back up ~/.config/niri/config.kdl, then append the supplied window-rule
or add an include with an absolute path to optimium.kdl. Validate the candidate
with `niri validate --config PATH` before replacing the current config. Niri reloads
config changes automatically. Never overwrite existing user configuration.
To undo, remove only the Optimium window-rule/include.

Verify the app-id with `niri msg -j windows`; a process launched from another
application can inherit that application's desktop identity unless --class is set.

The setting gives real background transparency. Blur is a separate compositor
capability and is not enabled by this fragment. Do not use a window-rule opacity:
that fades text, controls and page contents as well.

Upstream explanation:
https://niri-wm.github.io/niri/FAQ.html
https://niri-wm.github.io/niri/Configuration%3A-Window-Rules.html#draw-border-with-background

Validation method: place an opaque red/blue test window behind an Optimium window,
compare panel pixels at 50% and 100%, and confirm text/web content remain opaque.
Native-window screenshots alone are insufficient: they can contain the correct
alpha even while Niri's focus-ring background hides the windows underneath.
