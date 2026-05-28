// AWS Account Label Helper - Content Script
// Adds friendly labels to AWS license plates on the BC Gov AWS SSO portal

(function() {
  'use strict';

  let accessKeysEnabled = false;

  // Load mappings from storage
  async function loadMappings() {
    return new Promise((resolve) => {
      chrome.storage.sync.get(['licensePlateMappings'], (result) => {
        if (result.licensePlateMappings) {
          resolve(result.licensePlateMappings);
        } else {
          // Load default mappings if none exist
          fetch(chrome.runtime.getURL('mapping.json'))
            .then(response => response.json())
            .then(defaultMappings => {
              // Save defaults to storage
              chrome.storage.sync.set({ licensePlateMappings: defaultMappings });
              resolve(defaultMappings);
            })
            .catch(() => resolve({}));
        }
      });
    });
  }

  // Load access keys feature toggle
  async function loadAccessKeysEnabled() {
    return new Promise((resolve) => {
      chrome.storage.sync.get(['accessKeysEnabled'], (result) => {
        accessKeysEnabled = result.accessKeysEnabled === true;
        resolve(accessKeysEnabled);
      });
    });
  }

  // Extract license plate code from account name (e.g., "b0ec6c-dev" -> {code: "b0ec6c", env: "dev"})
  function extractLicensePlate(text) {
    const match = text.match(/^([a-z0-9]+)-(dev|prod|test)$/i);
    if (match) {
      return {
        code: match[1].toLowerCase(),
        env: match[2].toLowerCase()
      };
    }
    return null;
  }

  // Create and style the label element
  function createLabel(productName, env) {
    const label = document.createElement('span');
    const envType = (env === 'prod') ? 'prod' : 'dev';
    const envLabel = (env === 'prod') ? '(prod)' : '(dev/test)';
    label.className = `aws-account-label aws-account-label-${envType}`;
    label.textContent = `${productName} ${envLabel}`;
    return label;
  }

  // Create the "Update Access Keys" button
  function createUpdateKeysButton(accountName) {
    const btn = document.createElement('button');
    btn.className = 'aws-update-keys-btn';
    btn.textContent = 'Update Access Keys';
    btn.title = `Update AWS credentials for ${accountName}`;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      handleUpdateAccessKeys(btn, accountName);
    });
    return btn;
  }

  // Set button state with auto-reset
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

  // Poll for an element matching a predicate, with timeout
  function waitForElement(predicate, interval = 100, timeout = 5000) {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const check = () => {
        const el = predicate();
        if (el) return resolve(el);
        if (Date.now() - start > timeout) return reject(new Error('Timeout waiting for element'));
        setTimeout(check, interval);
      };
      check();
    });
  }

  // Handle the "Update Access Keys" button click
  async function handleUpdateAccessKeys(btn, accountName) {
    setButtonState(btn, 'loading', 'Opening...');

    try {
      // Step 1: Find the account row in the treegrid.
      // The portal renders accounts as <tr aria-level="1"> inside table[role=treegrid].
      const accountRow = btn.closest('tr');
      if (!accountRow) {
        throw new Error('Could not find account row');
      }

      // Step 2: Ensure the row is expanded.
      // When expanded, role rows (aria-level="2") appear as subsequent siblings.
      // If not expanded, click the toggle button inside the expandable cell.
      const isExpanded = () => {
        const next = accountRow.nextElementSibling;
        return next && next.tagName === 'TR' && next.getAttribute('aria-level') === '2';
      };

      if (!isExpanded()) {
        const expandCell = accountRow.querySelector('[class*="body-cell-expandable"]');
        const expandBtn = expandCell ? expandCell.querySelector('button') : null;
        if (expandBtn) {
          expandBtn.click();
          await new Promise(r => setTimeout(r, 500));
        }
      }

      // Step 3: Find the "Access keys" link inside the expanded child rows.
      const accessKeysLink = findAccessKeysLink(accountRow);
      if (!accessKeysLink) {
        throw new Error('Could not find "Access keys" link. Is the account expanded?');
      }

      // Step 4: Click "Access keys" to open the credentials modal.
      setButtonState(btn, 'loading', 'Loading keys...');
      accessKeysLink.click();

      // Step 5: Wait for the credentials dialog heading to appear.
      const dialogHeading = await waitForElement(() => {
        const headings = document.querySelectorAll('h2');
        for (const h of headings) {
          if (h.textContent.includes('Get credentials for')) return h;
        }
        return null;
      });

      // Step 6: Wait for the Option 2 section and extract credentials.
      setButtonState(btn, 'loading', 'Reading credentials...');

      const credentials = await waitForElement(() => {
        // Find the Option 2 h3 header
        const h3s = document.querySelectorAll('h3');
        let option2H3 = null;
        for (const h of h3s) {
          if (h.textContent.includes('Option 2')) { option2H3 = h; break; }
        }
        if (!option2H3) return null;

        // Walk up to the Option 2 expandable section container.
        // It has a class containing "root_gwq0h" (AWS CloudScape ExpandableSection).
        let section = option2H3.closest('[class*="root_gwq0h"]');
        if (!section) {
          // Fallback: walk up a few levels
          section = option2H3.parentElement?.parentElement?.parentElement;
        }
        if (!section) return null;

        // Find the table within this section that holds the credentials code block.
        // The table has a class containing "code-table".
        const table = section.querySelector('table[class*="code-table"]');
        if (!table) return null;

        // table.textContent gives us the clean credentials block
        const text = table.textContent.replace(/\r/g, '').trim();
        if (text.includes('aws_access_key_id')) return text;
        return null;
      });

      if (!credentials) {
        throw new Error('Could not extract credentials');
      }

      // Step 7: Close the dialog. Scope the Close button lookup to the modal
      // (rooted at the heading's ancestor) to avoid clicking an unrelated Close
      // button elsewhere on the page.
      const modalRoot = dialogHeading.closest('[role="dialog"]')
        || dialogHeading.closest('[class*="awsui_root"]')
        || document;
      const closeBtn = modalRoot.querySelector('button[aria-label="Close"]');
      if (closeBtn) closeBtn.click();

      // Step 8: Load targets (filter to this script's source) and send to background.
      setButtonState(btn, 'loading', 'Writing credentials...');
      const targets = await new Promise((resolve) => {
        chrome.storage.sync.get(['credentialTargets'], (result) => {
          const all = result.credentialTargets || [];
          // Targets without an explicit source predate this field and default
          // to 'aws-sso' so existing user setups keep working.
          resolve(all.filter(t => (t.source || 'aws-sso') === 'aws-sso'));
        });
      });

      if (targets.length === 0) {
        throw new Error('No AWS SSO targets configured. Add targets in the extension popup.');
      }

      // Step 9: Send to background service worker.
      const response = await new Promise((resolve) => {
        chrome.runtime.sendMessage({
          action: 'updateCredentials',
          credentialsBlock: credentials,
          targets: targets.map(t => ({
            type: t.type,
            credentialsPath: t.credentialsPath,
            user: t.user,
            host: t.host
          }))
        }, resolve);
      });

      // Step 10: Show result.
      if (response && response.success) {
        const successCount = response.results.filter(r => r.success).length;
        setButtonState(btn, 'success', `Updated ${successCount}/${response.results.length} targets`);
      } else {
        const errMsg = response ? response.error : 'No response from native host';
        setButtonState(btn, 'error', errMsg);
      }

    } catch (err) {
      setButtonState(btn, 'error', err.message);
    }
  }

  // Find the "Access keys" link in the role rows that follow an expanded account row.
  // Role rows are sibling <tr aria-level="2"> elements after the <tr aria-level="1"> account row.
  function findAccessKeysLink(accountRow) {
    let sibling = accountRow.nextElementSibling;
    while (sibling && sibling.tagName === 'TR') {
      const level = sibling.getAttribute('aria-level');
      if (level === '1') break;
      if (level === '2') {
        const link = sibling.querySelector('a[data-testid="role-creation-action-button"]');
        if (link) return link;
        const byText = sibling.querySelector('a[role="button"]');
        if (byText && byText.textContent.trim().toLowerCase().startsWith('access key')) return byText;
      }
      sibling = sibling.nextElementSibling;
    }
    return null;
  }

  // Find and label all license plates on the page
  async function labelLicensePlates() {
    const mappings = await loadMappings();
    await loadAccessKeysEnabled();

    // Find all account name elements
    const accountElements = document.querySelectorAll('*');

    accountElements.forEach(element => {
      if (element.childNodes.length > 0) {
        element.childNodes.forEach(node => {
          if (node.nodeType === Node.TEXT_NODE) {
            const text = node.textContent.trim();
            const result = extractLicensePlate(text);

            if (result && mappings[result.code]) {
              // Check if we haven't already added a label
              const nextSibling = node.nextSibling;
              if (!nextSibling || !nextSibling.classList || !nextSibling.classList.contains('aws-account-label')) {
                const label = createLabel(mappings[result.code], result.env);
                node.parentNode.insertBefore(label, node.nextSibling);
              }

              // Insert "Update Access Keys" button in the last cell of the row
              // so it appears at the far right and isn't cramped in the Account Name cell.
              if (accessKeysEnabled) {
                const row = element.closest('tr');
                if (row) {
                  const cells = row.querySelectorAll('th, td');
                  const lastCell = cells[cells.length - 1];
                  if (lastCell && !lastCell.querySelector('.aws-update-keys-btn')) {
                    const btn = createUpdateKeysButton(text);
                    lastCell.appendChild(btn);
                  }
                }
              }
            }
          }
        });
      }
    });

    // Remove buttons if feature is disabled
    if (!accessKeysEnabled) {
      document.querySelectorAll('.aws-update-keys-btn').forEach(btn => btn.remove());
    }
  }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', labelLicensePlates);
  } else {
    labelLicensePlates();
  }

  // Re-run when content changes (for dynamic loading)
  const observer = new MutationObserver(() => {
    labelLicensePlates();
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true
  });

  // Listen for updates from popup
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'refreshLabels') {
      // Clear existing labels and buttons
      document.querySelectorAll('.aws-account-label').forEach(label => label.remove());
      document.querySelectorAll('.aws-update-keys-btn').forEach(btn => btn.remove());
      // Re-apply labels with updated mappings
      labelLicensePlates();
      sendResponse({ success: true });
    }
  });
})();
