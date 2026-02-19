// AWS Account Label Helper - Popup Script
// Manages the popup UI for customizing license plate mappings

document.addEventListener('DOMContentLoaded', async () => {
  const mappingList = document.getElementById('mappingList');
  const licensePlateInput = document.getElementById('licensePlateInput');
  const productNameInput = document.getElementById('productNameInput');
  const addBtn = document.getElementById('addBtn');
  const statusMessage = document.getElementById('statusMessage');

  // Access Keys Sync elements
  const accessKeysToggle = document.getElementById('accessKeysToggle');
  const accessKeysSection = document.getElementById('accessKeysSection');
  const setupNotice = document.getElementById('setupNotice');
  const targetList = document.getElementById('targetList');
  const targetType = document.getElementById('targetType');
  const targetLabel = document.getElementById('targetLabel');
  const sshFields = document.getElementById('sshFields');
  const sshUser = document.getElementById('sshUser');
  const sshHost = document.getElementById('sshHost');
  const credPath = document.getElementById('credPath');
  const addTargetBtn = document.getElementById('addTargetBtn');

  // Load and display current mappings
  async function loadMappings() {
    return new Promise((resolve) => {
      chrome.storage.sync.get(['licensePlateMappings'], (result) => {
        if (result.licensePlateMappings) {
          resolve(result.licensePlateMappings);
        } else {
          // Load default mappings
          fetch(chrome.runtime.getURL('mapping.json'))
            .then(response => response.json())
            .then(defaultMappings => {
              chrome.storage.sync.set({ licensePlateMappings: defaultMappings });
              resolve(defaultMappings);
            })
            .catch(() => resolve({}));
        }
      });
    });
  }

  // Save mappings to storage
  function saveMappings(mappings) {
    return new Promise((resolve) => {
      chrome.storage.sync.set({ licensePlateMappings: mappings }, resolve);
    });
  }

  // Display mappings in the UI
  function displayMappings(mappings) {
    mappingList.innerHTML = '';

    const entries = Object.entries(mappings).sort((a, b) => a[0].localeCompare(b[0]));

    if (entries.length === 0) {
      mappingList.innerHTML = '<div class="empty-state">No mappings yet. Add one below!</div>';
      return;
    }

    entries.forEach(([licensePlate, productName]) => {
      const item = document.createElement('div');
      item.className = 'mapping-item';

      item.innerHTML = `
        <span class="license-plate">${licensePlate}</span>
        <span class="arrow">&rarr;</span>
        <span class="product-name">${productName}</span>
        <button class="delete-btn" data-license-plate="${licensePlate}" title="Delete mapping">&times;</button>
      `;

      mappingList.appendChild(item);
    });

    // Add delete button listeners
    document.querySelectorAll('.delete-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const licensePlate = e.target.getAttribute('data-license-plate');
        await deleteMapping(licensePlate);
      });
    });
  }

  // Show status message
  function showStatus(message, isError = false) {
    statusMessage.textContent = message;
    statusMessage.className = `status-message ${isError ? 'error' : 'success'}`;
    statusMessage.style.display = 'block';

    setTimeout(() => {
      statusMessage.style.display = 'none';
    }, 3000);
  }

  // Notify content script to refresh labels
  function notifyRefresh() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, { action: 'refreshLabels' });
      }
    });
  }

  // Add new mapping
  async function addMapping() {
    const licensePlate = licensePlateInput.value.trim().toLowerCase();
    const productName = productNameInput.value.trim();

    // Validation
    if (!licensePlate) {
      showStatus('Please enter a license plate code', true);
      licensePlateInput.focus();
      return;
    }

    if (!/^[a-z0-9]+$/.test(licensePlate)) {
      showStatus('License plate must contain only letters and numbers', true);
      licensePlateInput.focus();
      return;
    }

    if (!productName) {
      showStatus('Please enter a product name', true);
      productNameInput.focus();
      return;
    }

    // Load current mappings
    const mappings = await loadMappings();

    // Add new mapping
    mappings[licensePlate] = productName;

    // Save to storage
    await saveMappings(mappings);

    // Refresh display
    displayMappings(mappings);

    // Clear inputs
    licensePlateInput.value = '';
    productNameInput.value = '';
    licensePlateInput.focus();

    // Show success message
    showStatus('Mapping added successfully!');

    // Notify content script to refresh labels
    notifyRefresh();
  }

  // Delete mapping
  async function deleteMapping(licensePlate) {
    const mappings = await loadMappings();
    delete mappings[licensePlate];
    await saveMappings(mappings);
    displayMappings(mappings);
    showStatus('Mapping deleted');
    notifyRefresh();
  }

  // --- Access Keys Sync ---

  // Load targets from storage
  async function loadTargets() {
    return new Promise((resolve) => {
      chrome.storage.sync.get(['credentialTargets'], (result) => {
        resolve(result.credentialTargets || []);
      });
    });
  }

  // Save targets to storage
  function saveTargets(targets) {
    return new Promise((resolve) => {
      chrome.storage.sync.set({ credentialTargets: targets }, resolve);
    });
  }

  // Display credential targets
  function displayTargets(targets) {
    targetList.innerHTML = '';

    if (targets.length === 0) {
      targetList.innerHTML = '<div class="empty-state" style="padding: 20px;">No targets configured.</div>';
      return;
    }

    targets.forEach((target) => {
      const item = document.createElement('div');
      item.className = 'target-item';

      const typeClass = target.type === 'ssh' ? 'target-type-ssh' : 'target-type-local';
      const info = target.type === 'ssh'
        ? `${target.user}@${target.host}:${target.credentialsPath}`
        : target.credentialsPath;

      item.innerHTML = `
        <span class="target-type ${typeClass}">${target.type}</span>
        <span class="target-label">${target.label}</span>
        <span class="target-info">${info}</span>
        <button class="delete-btn delete-target-btn" data-target-id="${target.id}" title="Delete target">&times;</button>
      `;

      targetList.appendChild(item);
    });

    // Add delete listeners
    document.querySelectorAll('.delete-target-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const targetId = e.target.getAttribute('data-target-id');
        await deleteTarget(targetId);
      });
    });
  }

  // Add a new credential target
  async function addTarget() {
    const type = targetType.value;
    const label = targetLabel.value.trim();
    const path = credPath.value.trim();

    if (!label) {
      showStatus('Please enter a target label', true);
      targetLabel.focus();
      return;
    }
    if (!path) {
      showStatus('Please enter a credentials path', true);
      credPath.focus();
      return;
    }

    const target = {
      id: `${type}-${Date.now()}`,
      label: label,
      type: type,
      credentialsPath: path
    };

    if (type === 'ssh') {
      const user = sshUser.value.trim();
      const host = sshHost.value.trim();
      if (!user || !host) {
        showStatus('Please enter SSH user and host', true);
        return;
      }
      target.user = user;
      target.host = host;
    }

    const targets = await loadTargets();
    targets.push(target);
    await saveTargets(targets);
    displayTargets(targets);

    // Reset form
    targetLabel.value = '';
    credPath.value = '~/.aws/credentials';
    sshUser.value = '';
    sshHost.value = '';

    showStatus('Target added!');
  }

  // Delete a credential target
  async function deleteTarget(targetId) {
    const targets = await loadTargets();
    const filtered = targets.filter(t => t.id !== targetId);
    await saveTargets(filtered);
    displayTargets(filtered);
    showStatus('Target deleted');
  }

  // Toggle access keys feature
  async function toggleAccessKeys(enabled) {
    await new Promise((resolve) => {
      chrome.storage.sync.set({ accessKeysEnabled: enabled }, resolve);
    });
    accessKeysSection.style.display = enabled ? 'block' : 'none';

    if (enabled) {
      // Check if native host is available by sending a test message
      checkNativeHost();
      const targets = await loadTargets();
      displayTargets(targets);
    }

    notifyRefresh();
  }

  // Check if native host is installed
  function checkNativeHost() {
    try {
      chrome.runtime.sendNativeMessage(
        'com.bcgov.aws_credential_helper',
        { action: 'ping' },
        (response) => {
          if (chrome.runtime.lastError || !response) {
            setupNotice.style.display = 'block';
          } else {
            setupNotice.style.display = 'none';
          }
        }
      );
    } catch (e) {
      setupNotice.style.display = 'block';
    }
  }

  // Show/hide SSH fields based on type selection
  targetType.addEventListener('change', () => {
    sshFields.className = targetType.value === 'ssh' ? 'ssh-fields visible' : 'ssh-fields';
  });

  addTargetBtn.addEventListener('click', addTarget);

  accessKeysToggle.addEventListener('change', () => {
    toggleAccessKeys(accessKeysToggle.checked);
  });

  // Event listeners for mappings
  addBtn.addEventListener('click', addMapping);

  licensePlateInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      productNameInput.focus();
    }
  });

  productNameInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      addMapping();
    }
  });

  // Force lowercase for license plate input
  licensePlateInput.addEventListener('input', (e) => {
    e.target.value = e.target.value.toLowerCase();
  });

  // Initial load
  const mappings = await loadMappings();
  displayMappings(mappings);

  // Load access keys toggle state
  chrome.storage.sync.get(['accessKeysEnabled'], (result) => {
    const enabled = result.accessKeysEnabled === true;
    accessKeysToggle.checked = enabled;
    accessKeysSection.style.display = enabled ? 'block' : 'none';
    if (enabled) {
      checkNativeHost();
      loadTargets().then(displayTargets);
    }
  });
});
