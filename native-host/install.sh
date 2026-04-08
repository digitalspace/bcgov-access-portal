#!/usr/bin/env bash
# Install the native messaging host for the AWS Credential Helper extension
# Run this script once from the extension's native-host directory

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HOST_NAME="com.bcgov.aws_credential_helper"
HOST_JS="$SCRIPT_DIR/host.js"
HOST_WRAPPER="$SCRIPT_DIR/host-wrapper.sh"
MANIFEST_TEMPLATE="$SCRIPT_DIR/$HOST_NAME.json"

# Detect browser config directories to install the manifest into.
# Chromium looks for NativeMessagingHosts in the user-data-dir, which may
# differ from the default config path (e.g. when launched with --user-data-dir).
# We install into all detected locations to cover both cases.
MANIFEST_DIRS=()

# Default config directories
for dir in "$HOME/.config/microsoft-edge" "$HOME/.config/google-chrome" "$HOME/.config/chromium" "$HOME/.config/BraveSoftware/Brave-Browser"; do
  if [ -d "$dir" ]; then
    MANIFEST_DIRS+=("$dir/NativeMessagingHosts")
  fi
done

# Also detect any custom user-data-dir from running browser processes
for data_dir in $(ps aux | grep -oP -- '--user-data-dir=\K[^ ]+' 2>/dev/null | sort -u); do
  if [ -d "$data_dir" ]; then
    MANIFEST_DIRS+=("$data_dir/NativeMessagingHosts")
  fi
done

if [ ${#MANIFEST_DIRS[@]} -eq 0 ]; then
  echo "Error: Could not find a supported Chromium-based browser config directory."
  echo "Supported: Microsoft Edge, Google Chrome, Chromium, Brave"
  exit 1
fi

# Check Node.js is installed
if ! command -v node &> /dev/null; then
  echo "Error: Node.js is not installed. Please install Node.js first."
  exit 1
fi

NODE_PATH="$(command -v node)"
BASH_PATH="$(command -v bash)"
echo "Node.js found: $(node --version) at $NODE_PATH"

# Make host.js executable
chmod +x "$HOST_JS"

# Create a wrapper script that uses absolute paths for both bash and node.
# Browsers launch native messaging hosts with a minimal PATH that may not
# include node or bash (e.g. on NixOS), so we resolve paths at install time.
cat > "$HOST_WRAPPER" << WRAPPER
#!$BASH_PATH
exec "$NODE_PATH" "$HOST_JS" "\$@"
WRAPPER
chmod +x "$HOST_WRAPPER"

# Get the extension ID - prompt user
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

# Generate and install the manifest into all detected directories
for MANIFEST_DIR in "${MANIFEST_DIRS[@]}"; do
  mkdir -p "$MANIFEST_DIR"
  cat > "$MANIFEST_DIR/$HOST_NAME.json" << EOF
{
  "name": "$HOST_NAME",
  "description": "AWS Credential Helper for BC Gov Access Portal Extension",
  "path": "$HOST_WRAPPER",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://$EXTENSION_ID/"
  ]
}
EOF
  echo "  Installed: $MANIFEST_DIR/$HOST_NAME.json"
done

echo ""
echo "Native messaging host installed successfully!"
echo "  Wrapper: $HOST_WRAPPER"
echo "  Host: $HOST_JS"
echo ""
echo "You can now enable 'Access Keys Sync' in the extension popup."
