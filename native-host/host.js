#!/usr/bin/env node
// AWS Credential Helper - Native Messaging Host
// Reads credentials from the browser extension and writes them to local/remote files

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const os = require('os');

// --- Native Messaging I/O ---

function readMessage() {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let lengthBuffer = Buffer.alloc(0);

    // Read 4-byte length header
    const readLength = () => {
      const chunk = process.stdin.read(4 - lengthBuffer.length);
      if (!chunk) {
        process.stdin.once('readable', readLength);
        return;
      }
      lengthBuffer = Buffer.concat([lengthBuffer, chunk]);
      if (lengthBuffer.length < 4) {
        process.stdin.once('readable', readLength);
        return;
      }
      const messageLength = lengthBuffer.readUInt32LE(0);
      if (messageLength === 0) return resolve(null);
      readBody(messageLength);
    };

    // Read message body
    const readBody = (remaining) => {
      const chunk = process.stdin.read(remaining);
      if (!chunk) {
        process.stdin.once('readable', () => readBody(remaining));
        return;
      }
      chunks.push(chunk);
      remaining -= chunk.length;
      if (remaining > 0) {
        process.stdin.once('readable', () => readBody(remaining));
        return;
      }
      const body = Buffer.concat(chunks).toString('utf8');
      try {
        resolve(JSON.parse(body));
      } catch (e) {
        reject(new Error('Invalid JSON: ' + e.message));
      }
    };

    readLength();
  });
}

function sendMessage(msg) {
  const json = JSON.stringify(msg);
  const length = Buffer.byteLength(json, 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(length, 0);
  process.stdout.write(header);
  process.stdout.write(json);
}

// --- Credentials File Update ---

function expandHome(filepath) {
  if (filepath.startsWith('~/')) {
    return path.join(os.homedir(), filepath.slice(2));
  }
  return filepath;
}

// Extract profile name from credentials block (first line like [profile-name])
function extractProfileName(block) {
  const match = block.match(/^\[([^\]]+)\]/m);
  return match ? match[1] : null;
}

// Update a single profile in an INI-style credentials file
function updateCredentialsContent(existingContent, newBlock) {
  const profileName = extractProfileName(newBlock);
  if (!profileName) {
    throw new Error('Could not extract profile name from credentials block');
  }

  // Ensure newBlock ends with a newline
  const normalizedBlock = newBlock.trimEnd() + '\n';

  if (!existingContent || existingContent.trim() === '') {
    return normalizedBlock;
  }

  // Split into sections: find each [section] header
  const lines = existingContent.split('\n');
  const sections = [];
  let currentSection = null;

  for (const line of lines) {
    const headerMatch = line.match(/^\[([^\]]+)\]/);
    if (headerMatch) {
      if (currentSection) sections.push(currentSection);
      currentSection = { name: headerMatch[1], lines: [line] };
    } else if (currentSection) {
      currentSection.lines.push(line);
    } else {
      // Lines before any section header (comments, blank lines)
      if (!sections.length) {
        sections.push({ name: null, lines: [line] });
      }
    }
  }
  if (currentSection) sections.push(currentSection);

  // Find and replace the matching section
  let found = false;
  for (let i = 0; i < sections.length; i++) {
    if (sections[i].name === profileName) {
      sections[i] = { name: profileName, lines: normalizedBlock.trimEnd().split('\n') };
      found = true;
      break;
    }
  }

  if (!found) {
    // Append new section
    sections.push({ name: profileName, lines: normalizedBlock.trimEnd().split('\n') });
  }

  // Reconstruct the file
  const result = sections.map(s => s.lines.join('\n')).join('\n');
  // Ensure single trailing newline
  return result.trimEnd() + '\n';
}

// --- Target Handlers ---

function updateLocal(credentialsBlock, credentialsPath) {
  const filePath = expandHome(credentialsPath);
  const dir = path.dirname(filePath);

  // Ensure directory exists
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }

  let existing = '';
  if (fs.existsSync(filePath)) {
    existing = fs.readFileSync(filePath, 'utf8');
  }

  const updated = updateCredentialsContent(existing, credentialsBlock);
  fs.writeFileSync(filePath, updated, { mode: 0o600 });

  const profileName = extractProfileName(credentialsBlock);
  return { success: true, message: `Profile [${profileName}] updated` };
}

function updateSSH(credentialsBlock, user, host, credentialsPath) {
  const profileName = extractProfileName(credentialsBlock);
  const escapedPath = credentialsPath.replace(/'/g, "'\\''");
  const escapedBlock = credentialsBlock.replace(/\\/g, '\\\\').replace(/'/g, "'\\''").replace(/\n/g, '\\n');

  const script = `
set -e
CRED_PATH="${escapedPath}"
if echo "$CRED_PATH" | grep -q '^~/'; then
  CRED_PATH="$HOME/$(echo "$CRED_PATH" | sed 's|^~/||')"
fi
CRED_DIR=$(dirname "$CRED_PATH")
mkdir -p "$CRED_DIR"
chmod 700 "$CRED_DIR" 2>/dev/null || true
TMPFILE=$(mktemp)
trap 'rm -f "$TMPFILE"' EXIT
NEW_BLOCK=$(printf '%b' '${escapedBlock}')
PROFILE_NAME=$(echo "$NEW_BLOCK" | head -1 | sed 's/^\\[//;s/\\].*$//')
if [ -f "$CRED_PATH" ]; then
  awk -v profile="[$PROFILE_NAME]" -v newblock="$NEW_BLOCK" '
    BEGIN { found=0; inprofile=0; printed=0 }
    /^\\[/ {
      if (inprofile) { inprofile=0 }
      if ($0 == profile) { inprofile=1; found=1; if (!printed) { print newblock; printed=1 }; next }
    }
    inprofile { next }
    { print }
    END { if (!found) { if (NR > 0) print ""; print newblock } }
  ' "$CRED_PATH" > "$TMPFILE"
else
  printf '%s\\n' "$NEW_BLOCK" > "$TMPFILE"
fi
cp "$TMPFILE" "$CRED_PATH"
chmod 600 "$CRED_PATH"
`;

  try {
    execSync(
      `ssh -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10 '${user}@${host}' 'sh -s'`,
      {
        input: script,
        encoding: 'utf8',
        timeout: 30000
      }
    );
    return { success: true, message: `Profile [${profileName}] updated` };
  } catch (e) {
    return { success: false, message: `SSH error: ${e.message}` };
  }
}

// --- Main ---

async function main() {
  const message = await readMessage();

  if (!message) {
    sendMessage({ success: false, error: 'Empty message' });
    return;
  }

  if (message.action === 'ping') {
    sendMessage({ success: true, action: 'pong' });
    return;
  }

  if (message.action !== 'updateCredentials') {
    sendMessage({ success: false, error: `Unknown action: ${message.action}` });
    return;
  }

  const { credentialsBlock, targets } = message;

  if (!credentialsBlock || !targets || !targets.length) {
    sendMessage({ success: false, error: 'Missing credentialsBlock or targets' });
    return;
  }

  const results = [];

  for (const target of targets) {
    try {
      if (target.type === 'local') {
        const result = updateLocal(credentialsBlock, target.credentialsPath);
        results.push({ target: 'localhost', ...result });
      } else if (target.type === 'ssh') {
        const result = updateSSH(credentialsBlock, target.user, target.host, target.credentialsPath);
        results.push({ target: `${target.user}@${target.host}`, ...result });
      } else {
        results.push({ target: 'unknown', success: false, message: `Unknown target type: ${target.type}` });
      }
    } catch (e) {
      results.push({ target: target.type, success: false, message: e.message });
    }
  }

  const allSuccess = results.every(r => r.success);
  sendMessage({ success: allSuccess, results });
}

main().catch(e => {
  sendMessage({ success: false, error: e.message });
});
