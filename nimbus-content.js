// Nimbus AWS Login Helper - Content Script
// Adds an "Update Access Keys" button next to each account's "Click for Credentials"
// button on https://login.nimbus.cloud.gov.bc.ca/* and writes the resulting
// credentials to user-configured targets (local file or remote SSH host).

(function() {
  'use strict';

  const SOURCE = 'nimbus';

  let accessKeysEnabled = false;

  async function loadAccessKeysEnabled() {
    return new Promise((resolve) => {
      chrome.storage.sync.get(['accessKeysEnabled'], (result) => {
        accessKeysEnabled = result.accessKeysEnabled === true;
        resolve(accessKeysEnabled);
      });
    });
  }

  // Load Nimbus targets, filtered to those matching `env` (or env='*' wildcard).
  // {env} placeholders in the path are substituted before sending.
  async function loadTargets(env) {
    return new Promise((resolve) => {
      chrome.storage.sync.get(['credentialTargets'], (result) => {
        const all = result.credentialTargets || [];
        const matching = all
          .filter(t => (t.source || 'aws-sso') === SOURCE)
          .filter(t => !t.env || t.env === '*' || t.env === env)
          .map(t => ({ ...t, credentialsPath: (t.credentialsPath || '').replace(/\{env\}/g, env) }));
        resolve(matching);
      });
    });
  }

  // Extract `{plate: 'pil3ef', env: 'dev'}` from accordion header text like
  // " - pil3ef-dev 884963899124 - pil3ef-dev".
  function extractAccount(headerText) {
    const match = headerText.match(/([a-z0-9]+)-(dev|test|prod|tools)\b/i);
    if (!match) return null;
    return { plate: match[1].toLowerCase(), env: match[2].toLowerCase() };
  }

  function setButtonState(btn, state, message) {
    btn.className = 'aws-update-keys-btn';
    if (state === 'loading') {
      btn.classList.add('loading');
      btn.textContent = message || 'Updating...';
    } else if (state === 'success') {
      btn.classList.add('success');
      btn.textContent = message || 'Updated!';
      setTimeout(() => {
        btn.className = 'aws-update-keys-btn';
        btn.textContent = 'Update Access Keys';
      }, 3000);
    } else if (state === 'error') {
      btn.classList.add('error');
      btn.textContent = message || 'Error';
      setTimeout(() => {
        btn.className = 'aws-update-keys-btn';
        btn.textContent = 'Update Access Keys';
      }, 4000);
    }
  }

  function waitForElement(predicate, interval = 100, timeout = 8000) {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const check = () => {
        const el = predicate();
        if (el) return resolve(el);
        if (Date.now() - start > timeout) return reject(new Error('Timeout'));
        setTimeout(check, interval);
      };
      check();
    });
  }

  async function handleUpdate(btn, panel, account) {
    setButtonState(btn, 'loading', 'Opening...');

    try {
      const credsBtn = panel.querySelector('button.click-credentials');
      if (!credsBtn) throw new Error('No credentials button in panel');

      credsBtn.click();

      setButtonState(btn, 'loading', 'Reading credentials...');

      // Wait for the dialog's <pre> to contain shell exports
      const pre = await waitForElement(() => {
        const dialog = document.querySelector('.ui-dialog:not([style*="display: none"])');
        if (!dialog) return null;
        const p = dialog.querySelector('pre');
        if (p && /AWS_ACCESS_KEY_ID/.test(p.textContent)) return p;
        return null;
      });

      // Take the dialog's <pre> content verbatim — that's the same text the
      // page's "Click to copy" button puts on the clipboard.
      const block = pre.textContent.replace(/\r/g, '').trim() + '\n';

      // Close the dialog (scoped to whichever dialog is currently visible)
      const dialog = pre.closest('.ui-dialog');
      const closeBtn = dialog && dialog.querySelector('.ui-dialog-titlebar-close');
      if (closeBtn) closeBtn.click();

      setButtonState(btn, 'loading', 'Writing credentials...');
      const targets = await loadTargets(account.env);
      if (targets.length === 0) {
        throw new Error(`No Nimbus targets configured for env "${account.env}". Add one in the extension popup.`);
      }

      const response = await new Promise((resolve) => {
        chrome.runtime.sendMessage({
          action: 'updateCredentials',
          credentialsBlock: block,
          writeMode: 'overwrite',
          targets: targets.map(t => ({
            type: t.type,
            credentialsPath: t.credentialsPath,
            user: t.user,
            host: t.host
          }))
        }, resolve);
      });

      if (response && response.success) {
        const ok = response.results.filter(r => r.success).length;
        setButtonState(btn, 'success', `Updated ${ok}/${response.results.length} targets`);
      } else {
        const errMsg = response ? (response.error || 'Native host error') : 'No response from native host';
        setButtonState(btn, 'error', errMsg);
      }
    } catch (err) {
      setButtonState(btn, 'error', err.message);
    }
  }

  function createUpdateButton(panel, account) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'aws-update-keys-btn';
    btn.textContent = 'Update Access Keys';
    btn.title = `Update credentials for ${account.plate}-${account.env}`;
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      handleUpdate(btn, panel, account);
    });
    return btn;
  }

  function injectButtons() {
    if (!accessKeysEnabled) {
      document.querySelectorAll('.aws-update-keys-btn').forEach(b => b.remove());
      return;
    }

    const headers = document.querySelectorAll('h3.account-header');
    headers.forEach(header => {
      const panel = header.nextElementSibling;
      if (!panel || !panel.classList.contains('ui-accordion-content')) return;

      const credsBtn = panel.querySelector('button.click-credentials');
      if (!credsBtn) return;
      if (panel.querySelector('.aws-update-keys-btn')) return;

      const account = extractAccount(header.textContent);
      if (!account) return;
      const btn = createUpdateButton(panel, account);
      credsBtn.parentNode.insertBefore(btn, credsBtn.nextSibling);
    });
  }

  async function init() {
    await loadAccessKeysEnabled();
    injectButtons();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Re-inject when accounts render or accordion changes
  const observer = new MutationObserver(() => injectButtons());
  observer.observe(document.body, { childList: true, subtree: true });

  // Popup can request a refresh after settings change
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'refreshLabels') {
      document.querySelectorAll('.aws-update-keys-btn').forEach(b => b.remove());
      loadAccessKeysEnabled().then(injectButtons);
      sendResponse({ success: true });
    }
  });
})();
