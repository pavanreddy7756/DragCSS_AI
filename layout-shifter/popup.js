// Layout Shifter — Popup Script

const toggleBtn = document.getElementById('toggle-btn');
const exportBtn = document.getElementById('export-btn');
const resetBtn = document.getElementById('reset-btn');
const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');

let currentTabId = null;
let isActive = false;

// Get current tab
async function getCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

// Update UI to reflect state
function updateUI(active) {
  isActive = active;

  if (active) {
    toggleBtn.textContent = 'Disable Edit Mode';
    toggleBtn.classList.add('active');
    statusDot.classList.add('active');
    statusText.textContent = 'Edit Mode Active';
    exportBtn.disabled = false;
    resetBtn.disabled = false;
  } else {
    toggleBtn.textContent = 'Enable Edit Mode';
    toggleBtn.classList.remove('active');
    statusDot.classList.remove('active');
    statusText.textContent = 'Inactive';
    exportBtn.disabled = true;
    resetBtn.disabled = true;
  }
}

// Initialize
async function init() {
  const tab = await getCurrentTab();
  if (!tab) return;

  currentTabId = tab.id;

  // Check if the tab has a URL we can inject into
  const url = tab.url || '';
  if (url.startsWith('chrome://') || url.startsWith('chrome-extension://') || url.startsWith('about:')) {
    toggleBtn.disabled = true;
    statusText.textContent = 'Cannot edit this page';
    return;
  }

  // Ask background for current state
  chrome.runtime.sendMessage(
    { action: 'getState', tabId: currentTabId },
    (response) => {
      if (response) {
        updateUI(response.active);
      }
    }
  );
}

// Toggle edit mode
toggleBtn.addEventListener('click', async () => {
  if (!currentTabId) return;

  toggleBtn.disabled = true;
  toggleBtn.textContent = 'Working...';

  chrome.runtime.sendMessage(
    { action: 'toggle', tabId: currentTabId },
    (response) => {
      toggleBtn.disabled = false;
      if (response && !response.error) {
        updateUI(response.active);
      } else {
        statusText.textContent = 'Error — try refreshing the page';
        toggleBtn.textContent = 'Enable Edit Mode';
      }
    }
  );
});

// Export changes
exportBtn.addEventListener('click', async () => {
  if (!currentTabId) return;

  chrome.tabs.sendMessage(currentTabId, { action: 'exportChanges' }, () => {
    // Close the popup so the user can see the export panel on the page
    window.close();
  });
});

// Reset all
resetBtn.addEventListener('click', async () => {
  if (!currentTabId) return;

  chrome.tabs.sendMessage(currentTabId, { action: 'resetAll' });
});

init();
