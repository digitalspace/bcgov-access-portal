// AWS Account Label Helper - Popup Script
// Manages the popup UI for customizing license plate mappings

document.addEventListener('DOMContentLoaded', async () => {
  const mappingList = document.getElementById('mappingList');
  const licensePlateInput = document.getElementById('licensePlateInput');
  const productNameInput = document.getElementById('productNameInput');
  const addBtn = document.getElementById('addBtn');
  const statusMessage = document.getElementById('statusMessage');

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
        <span class="arrow">→</span>
        <span class="product-name">${productName}</span>
        <button class="delete-btn" data-license-plate="${licensePlate}" title="Delete mapping">×</button>
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
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, { action: 'refreshLabels' });
      }
    });
  }

  // Delete mapping
  async function deleteMapping(licensePlate) {
    const mappings = await loadMappings();
    delete mappings[licensePlate];
    await saveMappings(mappings);
    displayMappings(mappings);
    showStatus('Mapping deleted');
    
    // Notify content script to refresh labels
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, { action: 'refreshLabels' });
      }
    });
  }

  // Event listeners
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
});
