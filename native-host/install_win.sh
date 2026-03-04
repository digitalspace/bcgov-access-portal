#!/usr/bin/env bash
# Install the native messaging host for the AWS Credential Helper extension
# Windows 11 only — run from Git Bash, MSYS2, or Cygwin
# For Linux, use install.sh instead

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HOST_NAME="com.bcgov.aws_credential_helper"
HOST_JS="$SCRIPT_DIR/host.js"

# --- Verify we're on Windows ---

case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*) ;;
  *)
    echo "Error: This script is for Windows only. Use install.sh on Linux."
    exit 1
    ;;
esac

# --- Helper: convert Unix-style path to native Windows path ---

to_win_path() {
  local p="$1"
  if command -v cygpath &> /dev/null; then
    cygpath -w "$p"
  else
    echo "$p" | sed -e 's|^/\([a-zA-Z]\)/|\1:\\|' -e 's|/|\\|g'
  fi
}

# --- Check Node.js ---

if ! command -v node &> /dev/null; then
  echo "Error: Node.js is not installed. Please install Node.js first."
  exit 1
fi

NODE_PATH="$(command -v node)"
WIN_NODE="$(to_win_path "$NODE_PATH")"
echo "Node.js found: $(node --version) ($WIN_NODE)"

# --- Get the extension ID ---

echo ""
echo "To complete setup, you need the extension ID."
echo "1. Open edge://extensions/ (or chrome://extensions/ or brave://extensions/)"
echo "2. Find 'AWS Account Label Helper' and copy its ID"
echo ""
read -p "Enter the extension ID: " EXTENSION_ID

if [ -z "$EXTENSION_ID" ]; then
  echo "Error: Extension ID is required."
  exit 1
fi

# --- Generate host.bat ---
# Windows cannot execute .js files directly as native messaging hosts.
# The .bat wrapper calls node.exe with the full path so it works regardless
# of the browser's PATH environment.

HOST_BAT="$SCRIPT_DIR/host.bat"
printf '@echo off\r\n"%s" "%%~dp0host.js"\r\n' "$WIN_NODE" > "$HOST_BAT"
echo "  Created: host.bat (using $WIN_NODE)"

# --- Generate the manifest JSON ---

WIN_HOST_BAT="$(to_win_path "$HOST_BAT")"
# Escape backslashes for valid JSON
WIN_HOST_BAT_JSON="${WIN_HOST_BAT//\\/\\\\}"

MANIFEST_FILE="$SCRIPT_DIR/$HOST_NAME.json"
WIN_MANIFEST="$(to_win_path "$MANIFEST_FILE")"

cat > "$MANIFEST_FILE" << EOF
{
  "name": "$HOST_NAME",
  "description": "AWS Credential Helper for BC Gov Access Portal Extension",
  "path": "$WIN_HOST_BAT_JSON",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://$EXTENSION_ID/"
  ]
}
EOF
echo "  Created: $HOST_NAME.json"

# --- Register in Windows Registry ---

REG_PATHS=(
  "HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\$HOST_NAME"
  "HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\$HOST_NAME"
  "HKCU\\Software\\BraveSoftware\\Brave-Browser\\NativeMessagingHosts\\$HOST_NAME"
)

REG_LABELS=(
  "Microsoft Edge"
  "Google Chrome"
  "Brave Browser"
)

INSTALLED_COUNT=0

for i in "${!REG_PATHS[@]}"; do
  REG_KEY="${REG_PATHS[$i]}"
  LABEL="${REG_LABELS[$i]}"

  if MSYS_NO_PATHCONV=1 reg add "$REG_KEY" /ve /t REG_SZ /d "$WIN_MANIFEST" /f > /dev/null 2>&1; then
    echo "  Registered: $LABEL"
    INSTALLED_COUNT=$((INSTALLED_COUNT + 1))
  else
    echo "  Skipped: $LABEL (not installed or access denied)"
  fi
done

if [ "$INSTALLED_COUNT" -eq 0 ]; then
  echo ""
  echo "Error: Could not register with any browser."
  echo "Try running Git Bash as Administrator."
  exit 1
fi

# --- Diagnostic: verify everything looks correct ---

echo ""
echo "========================================="
echo " Installation complete!"
echo "========================================="
echo ""
echo "Manifest: $WIN_MANIFEST"
echo "Host:     $WIN_HOST_BAT"
echo "Node:     $WIN_NODE"
echo ""
echo "Restart your browser, then enable 'Access Keys Sync' in the extension popup."
echo ""
echo "--- Troubleshooting ---"
echo "If it still doesn't work, test the host manually in Command Prompt:"
echo "  cd $(to_win_path "$SCRIPT_DIR")"
echo "  echo {\"action\":\"ping\"} | node host.js"
echo ""
echo "You should NOT see any output (native messaging uses binary framing)."
echo "If you see an error, that's the problem to fix."
