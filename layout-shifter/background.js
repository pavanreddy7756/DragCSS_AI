// Layout Shifter — Background Service Worker

// Track which tabs have the content script injected and active
const activeTabs = new Set();

// Listen for messages from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'getState') {
    const tabId = message.tabId;
    sendResponse({ active: activeTabs.has(tabId) });
    return true;
  }

  if (message.action === 'toggle') {
    const tabId = message.tabId;
    if (activeTabs.has(tabId)) {
      // Deactivate — send message to content script
      chrome.tabs.sendMessage(tabId, { action: 'deactivate' }, () => {
        activeTabs.delete(tabId);
        chrome.action.setBadgeText({ text: '', tabId });
        sendResponse({ active: false });
      });
    } else {
      // Activate — inject content script first, then send activate
      chrome.scripting.executeScript({
        target: { tabId },
        files: ['content.js']
      }).then(() => {
        chrome.tabs.sendMessage(tabId, { action: 'activate' }, () => {
          activeTabs.add(tabId);
          chrome.action.setBadgeText({ text: 'ON', tabId });
          chrome.action.setBadgeBackgroundColor({ color: '#4CAF50', tabId });
          sendResponse({ active: true });
        });
      }).catch((err) => {
        console.error('Failed to inject content script:', err);
        sendResponse({ active: false, error: err.message });
      });
    }
    return true; // Keep message channel open for async response
  }

  if (message.action === 'updateBadge') {
    const tabId = sender.tab?.id;
    if (tabId) {
      const count = message.count;
      chrome.action.setBadgeText({
        text: count > 0 ? String(count) : 'ON',
        tabId
      });
      chrome.action.setBadgeBackgroundColor({
        color: count > 0 ? '#FF9800' : '#4CAF50',
        tabId
      });
    }
    return false;
  }
});

// Clean up when a tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
  activeTabs.delete(tabId);
});

// Clean up when a tab navigates
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading' && activeTabs.has(tabId)) {
    activeTabs.delete(tabId);
    chrome.action.setBadgeText({ text: '', tabId });
  }
});
