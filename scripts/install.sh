#!/bin/sh
# Installs Blab from the latest release. One command, and the same one whether
# you are on a Mac or on Linux:
#
#   curl -fsSL https://raw.githubusercontent.com/jurecerkez-code/Blab/main/scripts/install.sh | sh
#
# This is one of only two things in the project that touch the network at all —
# the other is `npm run setup`, which you meet only if you build Blab yourself
# — and it touches it once. What it installs never does at all.
set -eu

REPO='jurecerkez-code/Blab'
API="https://api.github.com/repos/$REPO/releases/latest"

say() { printf '%s\n' "$*"; }
die() { printf 'blab: %s\n' "$*" >&2; exit 1; }

command -v curl >/dev/null 2>&1 || die 'this needs curl, which is not installed.'

case "$(uname -s)" in
  Darwin) OS=mac; WANT='\.dmg' ;;
  Linux) OS=linux; WANT='\.AppImage' ;;
  *) die "there is no build for $(uname -s). Windows has its own one-liner in the README." ;;
esac

# The Mac file carries both chips, so only Linux has a question to ask here.
if [ "$OS" = linux ]; then
  case "$(uname -m)" in
    x86_64 | amd64) : ;;
    *) die "the Linux build is x86_64 only for now, and this machine is $(uname -m)." ;;
  esac
fi

say 'Looking up the latest release...'
URL=$(curl -fsSL "$API" | grep -o "https://[^\"]*$WANT" | head -n 1)
[ -n "${URL:-}" ] || die 'the latest release has no installer for this system yet.'

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
NAME=$(basename "$URL")
say "Downloading $NAME..."
curl -fL --progress-bar -o "$TMP/$NAME" "$URL"

if [ "$OS" = mac ]; then
  # /Applications when it is writable, which it is for an admin account, and
  # the personal one otherwise. Either way this never needs sudo.
  DEST=/Applications
  [ -w "$DEST" ] || DEST="$HOME/Applications"
  mkdir -p "$DEST"

  MOUNT="$TMP/mnt"
  mkdir -p "$MOUNT"
  # Detach on the way out whatever happens: a failed copy that left the image
  # mounted would also stop the temporary directory being cleaned up.
  trap 'hdiutil detach "$MOUNT" -quiet 2>/dev/null || true; rm -rf "$TMP"' EXIT
  hdiutil attach "$TMP/$NAME" -nobrowse -quiet -mountpoint "$MOUNT"
  # Copy, not move: the disk image is read only and goes away with $TMP.
  rm -rf "$DEST/Blab.app"
  cp -R "$MOUNT/Blab.app" "$DEST/"
  hdiutil detach "$MOUNT" -quiet

  say ''
  say "Blab is in $DEST. Open it from Spotlight or Finder."
  say ''
  say 'You will not get the "Apple could not verify this app" screen, because'
  say 'that screen is for files a browser downloaded and curl does not mark'
  say 'them the same way. Nothing was switched off to manage it.'
else
  BIN="${XDG_BIN_HOME:-$HOME/.local/bin}"
  SHARE="${XDG_DATA_HOME:-$HOME/.local/share}"
  APP="$SHARE/blab"
  mkdir -p "$BIN" "$APP" "$SHARE/applications"

  cp "$TMP/$NAME" "$APP/Blab.AppImage"
  chmod +x "$APP/Blab.AppImage"

  # A wrapper rather than the AppImage itself on the path, and it settles two
  # things that would otherwise be the user's problem.
  #
  # --no-sandbox, because the menu entry the AppImage generates passes it and a
  # bare invocation does not, so without this `blab` would be the one way of
  # starting it that fails on Ubuntu 24.04. The README says why the sandbox is
  # off in the first place.
  #
  # And FUSE. An AppImage is a mounted filesystem, and Ubuntu has not shipped
  # libfuse2 since 22.04, so on a stock install the file simply refuses to run.
  # The runtime can unpack itself instead when asked; it is slower to start, so
  # it is only asked when the library is really absent.
  cat > "$BIN/blab" <<WRAPPER
#!/bin/sh
if ! ldconfig -p 2>/dev/null | grep -q 'libfuse\.so\.2'; then
  export APPIMAGE_EXTRACT_AND_RUN=1
fi
exec "$APP/Blab.AppImage" --no-sandbox "\$@"
WRAPPER
  chmod +x "$BIN/blab"

  # The icon is inside the AppImage. The copy at its root is a symlink into
  # usr/share, so pull the real file or you install a broken link. Referencing
  # it by absolute path saves guessing which hicolor size directory it belongs
  # in — freedesktop allows either, and only one of them can be wrong.
  ICON=blab
  (cd "$TMP" && "$APP/Blab.AppImage" --appimage-extract 'usr/share/icons/hicolor/*/apps/blab.png' >/dev/null 2>&1) || true
  FOUND=$(find "$TMP/squashfs-root" -name 'blab.png' -type f 2>/dev/null | head -n 1)
  if [ -n "$FOUND" ]; then
    cp "$FOUND" "$APP/blab.png"
    ICON="$APP/blab.png"
  fi

  cat > "$SHARE/applications/blab.desktop" <<DESKTOP
[Desktop Entry]
Type=Application
Name=Blab
Comment=Record a talk, type notes, get a transcript. All on your own machine.
Exec=$BIN/blab %U
Icon=$ICON
Terminal=false
Categories=AudioVideo;
StartupWMClass=blab
DESKTOP

  say ''
  say "Blab is installed. Run it with 'blab', or find it in your menu."
  case ":$PATH:" in
    *":$BIN:"*) : ;;
    *) say "" ; say "$BIN is not on your PATH, so 'blab' will not be found until you add it." ;;
  esac
  say ''
  say "To remove it: rm -rf '$APP' '$BIN/blab' '$SHARE/applications/blab.desktop'"
fi
