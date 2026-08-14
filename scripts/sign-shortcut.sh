#!/usr/bin/env bash
#
# Download a generated shortcut and sign it so an iPhone will accept it.
#
# iOS 15 removed unsigned shortcut import, and the "Allow Untrusted Shortcuts"
# setting with it — the phone answers "importing unsigned shortcut file is not
# supported" and gives you no way past it. Apple's `shortcuts` CLI is the only
# thing that produces a file it will take, and it exists only on macOS, which
# is why this cannot run on the server that generates the file.
#
# Run this ON THE MAC:
#
#   ./scripts/sign-shortcut.sh <api-token> [full|quick]
#
# Then AirDrop the result to the iPhone and tap it.

set -euo pipefail

TOKEN="${1:-}"
WHICH="${2:-full}"
BASE="${SPLIT_API_BASE:-https://pinaka.tail2f85bc.ts.net:10000/api}"

if [ -z "$TOKEN" ]; then
  cat >&2 <<'USAGE'
usage: sign-shortcut.sh <api-token> [full|quick]

Get the token from the app: Account -> Back Tap to add -> Generate a token.
Set SPLIT_API_BASE to override the server URL.
USAGE
  exit 64
fi

case "$WHICH" in
  full)  PATH_SEG="shortcut/full.shortcut"; NAME="Add expense" ;;
  quick) PATH_SEG="shortcut.shortcut";      NAME="Log expense" ;;
  *) echo "Second argument must be 'full' or 'quick', not '$WHICH'." >&2; exit 64 ;;
esac

if [ "$(uname -s)" != "Darwin" ]; then
  echo "This has to run on a Mac: the 'shortcuts' CLI is macOS-only." >&2
  echo "On anything else, build the shortcut by hand — the app lists the steps." >&2
  exit 1
fi

if ! command -v shortcuts >/dev/null 2>&1; then
  echo "No 'shortcuts' command found. It ships with macOS 12 (Monterey) and later." >&2
  exit 1
fi

# A directory rather than mktemp's file, so appending the extension the signer
# expects does not leave the original empty temp file behind.
WORK="$(mktemp -d)"
UNSIGNED="${WORK}/${NAME}.shortcut"
SIGNED="${HOME}/Desktop/${NAME}.shortcut"
# Leave nothing token-bearing lying around if this exits early.
trap 'rm -rf "$WORK"' EXIT

echo "Downloading from ${BASE}/${PATH_SEG} ..."
# --fail so an HTML error page never gets fed to the signer as if it were a
# shortcut; the failure should name the real problem.
if ! curl --fail --silent --show-error --location \
        --output "$UNSIGNED" "${BASE}/${PATH_SEG}?token=${TOKEN}"; then
  echo "Download failed. Is the token still valid, and the server reachable?" >&2
  exit 1
fi

# A shortcut is a plist; anything else means we were handed an error body.
if ! plutil -lint "$UNSIGNED" >/dev/null 2>&1; then
  echo "What came back is not a property list:" >&2
  head -c 200 "$UNSIGNED" >&2
  echo >&2
  exit 1
fi
echo "Downloaded $(wc -c < "$UNSIGNED" | tr -d ' ') bytes, valid plist."

# The server emits XML because that is what is readable and testable there.
# `shortcuts sign` wants the binary form and reports an XML file as simply
# "not in the correct format", which says nothing about why.
BINARY="${WORK}/${NAME}-binary.shortcut"
cp "$UNSIGNED" "$BINARY"
if plutil -convert binary1 "$BINARY" 2>/dev/null; then
  echo "Converted to a binary plist."
else
  echo "Could not convert to binary; trying the XML as-is." >&2
  cp "$UNSIGNED" "$BINARY"
fi

echo "Signing ..."
# 'anyone' rather than the default 'people-who-know-me': the latter binds the
# file to your contacts and is refused when the receiving device cannot match
# the sender.
if ! shortcuts sign --mode anyone --input "$BINARY" --output "$SIGNED"; then
  echo >&2
  echo "Signing failed. Falling back to the XML form ..." >&2
  shortcuts sign --mode anyone --input "$UNSIGNED" --output "$SIGNED"
fi

echo
echo "Signed:  $SIGNED"
echo
echo "Next:  AirDrop it to the iPhone and tap it. Shortcuts will import it."
echo "Then:  Settings -> Accessibility -> Touch -> Back Tap -> Double Tap -> $NAME"
echo
echo "The file contains your API token — treat it like a password."
