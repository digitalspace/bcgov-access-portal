// AWS Account Label Helper - Content Script
// Adds friendly labels to AWS license plates on the BC Gov AWS SSO portal

(function() {
  'use strict';

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

  // Find and label all license plates on the page
  async function labelLicensePlates() {
    const mappings = await loadMappings();
    
    // Find all account name elements
    // Based on the screenshot, these appear to be in a list structure
    // We'll search for elements containing the license plate pattern
    const accountElements = document.querySelectorAll('*');
    
    accountElements.forEach(element => {
      // Check if element contains text matching license plate pattern
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
            }
          }
        });
      }
    });
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
      // Clear existing labels
      document.querySelectorAll('.aws-account-label').forEach(label => label.remove());
      // Re-apply labels with updated mappings
      labelLicensePlates();
      sendResponse({ success: true });
    }
  });
})();
