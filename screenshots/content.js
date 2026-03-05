// Layout Shifter — Content Script
// Handles: edit mode, hover highlight, drag-and-drop, CSS tracking, export panel

(function () {
  // Prevent double injection
  if (window.__layoutShifterInjected) return;
  window.__layoutShifterInjected = true;

  const ATTR = 'data-layout-shifter';
  const TRACKED_PROPS = [
    'position', 'top', 'left', 'right', 'bottom',
    'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
    'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
    'width', 'height', 'max-width', 'max-height', 'min-width', 'min-height',
    'transform', 'display', 'z-index', 'float', 'clear',
    'flex-direction', 'flex-wrap', 'justify-content', 'align-items', 'align-self',
    'flex-grow', 'flex-shrink', 'flex-basis', 'order',
    'grid-column', 'grid-row', 'gap'
  ];

  let isActive = false;
  let isDragging = false;
  let dragTarget = null;
  let dragOffsetX = 0;
  let dragOffsetY = 0;
  let dragStartX = 0;
  let dragStartY = 0;

  // Map of element → { selector, before: {prop: val}, after: {prop: val} }
  const changes = new Map();

  // ─── Shadow DOM Host for all extension UI ───
  let shadowHost = null;
  let shadow = null;
  let hoverOverlay = null;
  let selectedOverlay = null;
  let exportPanel = null;
  let floatingBar = null;

  function createUI() {
    shadowHost = document.createElement('div');
    shadowHost.setAttribute(ATTR, 'host');
    shadowHost.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647;pointer-events:none;';
    document.documentElement.appendChild(shadowHost);

    shadow = shadowHost.attachShadow({ mode: 'closed' });

    const style = document.createElement('style');
    style.textContent = `
      * { box-sizing: border-box; margin: 0; padding: 0; }

      .ls-hover-overlay {
        position: fixed;
        pointer-events: none;
        border: 2px solid #2196F3;
        background: rgba(33, 150, 243, 0.08);
        transition: all 0.05s ease;
        display: none;
        z-index: 2147483640;
        border-radius: 2px;
      }

      .ls-selected-overlay {
        position: fixed;
        pointer-events: none;
        border: 2px dashed #FF5722;
        background: rgba(255, 87, 34, 0.06);
        display: none;
        z-index: 2147483641;
        border-radius: 2px;
      }

      .ls-label {
        position: absolute;
        top: -22px;
        left: -2px;
        font: 11px/1 'SF Mono', 'Consolas', 'Monaco', monospace;
        color: #fff;
        padding: 3px 6px;
        border-radius: 3px 3px 0 0;
        white-space: nowrap;
        max-width: 300px;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .ls-hover-overlay .ls-label { background: #2196F3; }
      .ls-selected-overlay .ls-label { background: #FF5722; }

      .ls-floating-bar {
        position: fixed;
        bottom: 20px;
        left: 50%;
        transform: translateX(-50%);
        background: #1a1a2e;
        color: #eee;
        border-radius: 12px;
        padding: 8px 12px;
        display: flex;
        align-items: center;
        gap: 8px;
        font: 13px/1.4 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        box-shadow: 0 8px 32px rgba(0,0,0,0.4);
        pointer-events: auto;
        z-index: 2147483645;
        user-select: none;
      }

      .ls-floating-bar button {
        background: #2d2d44;
        color: #eee;
        border: 1px solid #3d3d5c;
        padding: 6px 14px;
        border-radius: 8px;
        font: 12px/1 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        cursor: pointer;
        transition: background 0.15s;
        white-space: nowrap;
      }

      .ls-floating-bar button:hover { background: #3d3d5c; }
      .ls-floating-bar button.ls-primary { background: #4CAF50; border-color: #4CAF50; color: #fff; }
      .ls-floating-bar button.ls-primary:hover { background: #43A047; }
      .ls-floating-bar button.ls-danger { background: #d32f2f; border-color: #d32f2f; color: #fff; }
      .ls-floating-bar button.ls-danger:hover { background: #b71c1c; }

      .ls-floating-bar .ls-status {
        color: #aaa;
        font-size: 12px;
        padding: 0 4px;
      }

      .ls-export-panel {
        position: fixed;
        top: 0; right: 0;
        width: 420px;
        height: 100vh;
        background: #0d1117;
        color: #c9d1d9;
        font: 13px/1.5 'SF Mono', 'Consolas', 'Monaco', monospace;
        z-index: 2147483646;
        pointer-events: auto;
        display: none;
        flex-direction: column;
        box-shadow: -4px 0 24px rgba(0,0,0,0.5);
      }

      .ls-export-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 16px;
        border-bottom: 1px solid #21262d;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      }

      .ls-export-header h2 {
        font-size: 15px;
        font-weight: 600;
        color: #f0f6fc;
      }

      .ls-export-tabs {
        display: flex;
        gap: 0;
        border-bottom: 1px solid #21262d;
      }

      .ls-export-tab {
        padding: 8px 16px;
        background: none;
        border: none;
        color: #8b949e;
        font: 12px/1 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        cursor: pointer;
        border-bottom: 2px solid transparent;
      }

      .ls-export-tab.active {
        color: #f0f6fc;
        border-bottom-color: #4CAF50;
      }

      .ls-export-body {
        flex: 1;
        overflow-y: auto;
        padding: 16px;
      }

      .ls-export-body pre {
        white-space: pre-wrap;
        word-break: break-all;
        font: 12px/1.6 'SF Mono', 'Consolas', 'Monaco', monospace;
        color: #c9d1d9;
      }

      .ls-export-footer {
        display: flex;
        gap: 8px;
        padding: 12px 16px;
        border-top: 1px solid #21262d;
      }

      .ls-export-footer button {
        flex: 1;
        padding: 8px 12px;
        border-radius: 6px;
        border: 1px solid #30363d;
        background: #21262d;
        color: #c9d1d9;
        font: 13px/1 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        cursor: pointer;
        transition: background 0.15s;
      }

      .ls-export-footer button:hover { background: #30363d; }
      .ls-export-footer button.ls-copy-btn { background: #238636; border-color: #238636; color: #fff; }
      .ls-export-footer button.ls-copy-btn:hover { background: #2ea043; }

      .ls-close-btn {
        background: none;
        border: none;
        color: #8b949e;
        font-size: 20px;
        cursor: pointer;
        padding: 4px 8px;
        line-height: 1;
      }

      .ls-close-btn:hover { color: #f0f6fc; }

      .ls-toast {
        position: fixed;
        bottom: 80px;
        left: 50%;
        transform: translateX(-50%);
        background: #238636;
        color: #fff;
        padding: 8px 20px;
        border-radius: 8px;
        font: 13px/1.4 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        pointer-events: none;
        z-index: 2147483647;
        opacity: 0;
        transition: opacity 0.2s;
      }

      .ls-toast.show { opacity: 1; }
    `;
    shadow.appendChild(style);

    // Hover overlay
    hoverOverlay = document.createElement('div');
    hoverOverlay.className = 'ls-hover-overlay';
    hoverOverlay.innerHTML = '<span class="ls-label"></span>';
    shadow.appendChild(hoverOverlay);

    // Selected overlay
    selectedOverlay = document.createElement('div');
    selectedOverlay.className = 'ls-selected-overlay';
    selectedOverlay.innerHTML = '<span class="ls-label"></span>';
    shadow.appendChild(selectedOverlay);

    // Floating toolbar
    floatingBar = document.createElement('div');
    floatingBar.className = 'ls-floating-bar';
    floatingBar.innerHTML = `
      <span class="ls-status">DragCSS — <strong>Edit Mode</strong></span>
      <button class="ls-primary" id="ls-export-btn">Export Changes</button>
      <button class="ls-danger" id="ls-reset-btn">Reset All</button>
    `;
    shadow.appendChild(floatingBar);

    // Wire up floating bar buttons
    shadow.getElementById('ls-export-btn').addEventListener('click', showExportPanel);
    shadow.getElementById('ls-reset-btn').addEventListener('click', resetAll);

    // Export side panel
    exportPanel = document.createElement('div');
    exportPanel.className = 'ls-export-panel';
    exportPanel.innerHTML = `
      <div class="ls-export-header">
        <h2>CSS Changes</h2>
        <button class="ls-close-btn" id="ls-close-export">&times;</button>
      </div>
      <div class="ls-export-tabs">
        <button class="ls-export-tab active" data-tab="css">CSS Diff</button>
        <button class="ls-export-tab" data-tab="ai">AI Prompt</button>
      </div>
      <div class="ls-export-body"><pre id="ls-export-content"></pre></div>
      <div class="ls-export-footer">
        <button class="ls-copy-btn" id="ls-copy-btn">Copy to Clipboard</button>
        <button id="ls-close-export-2">Close</button>
      </div>
    `;
    shadow.appendChild(exportPanel);

    // Toast
    const toast = document.createElement('div');
    toast.className = 'ls-toast';
    toast.id = 'ls-toast';
    shadow.appendChild(toast);

    // Export panel events
    shadow.getElementById('ls-close-export').addEventListener('click', hideExportPanel);
    shadow.getElementById('ls-close-export-2').addEventListener('click', hideExportPanel);
    shadow.getElementById('ls-copy-btn').addEventListener('click', copyToClipboard);

    // Tab switching
    exportPanel.querySelectorAll('.ls-export-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        exportPanel.querySelectorAll('.ls-export-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        renderExportContent(tab.dataset.tab);
      });
    });
  }

  function destroyUI() {
    if (shadowHost && shadowHost.parentNode) {
      shadowHost.parentNode.removeChild(shadowHost);
    }
    shadowHost = null;
    shadow = null;
    hoverOverlay = null;
    selectedOverlay = null;
    exportPanel = null;
    floatingBar = null;
  }

  // ─── CSS Selector Generator ───

  function getSelector(el) {
    if (el.id) return '#' + CSS.escape(el.id);

    const parts = [];
    let current = el;

    while (current && current !== document.body && current !== document.documentElement) {
      if (current.id) {
        parts.unshift('#' + CSS.escape(current.id));
        break;
      }

      let tag = current.tagName.toLowerCase();
      if (current.classList.length > 0) {
        const safeClasses = Array.from(current.classList)
          .filter(c => !c.startsWith('ls-'))
          .slice(0, 2);
        if (safeClasses.length > 0) {
          tag += '.' + safeClasses.map(c => CSS.escape(c)).join('.');
        }
      }

      // Add nth-of-type if there are siblings with the same tag
      const parent = current.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter(
          s => s.tagName === current.tagName
        );
        if (siblings.length > 1) {
          const index = siblings.indexOf(current) + 1;
          tag += ':nth-of-type(' + index + ')';
        }
      }

      parts.unshift(tag);
      current = current.parentElement;
    }

    if (parts.length === 0) return el.tagName.toLowerCase();
    // Limit selector depth to avoid overly long selectors
    if (parts.length > 4) {
      return parts.slice(-4).join(' > ');
    }
    return parts.join(' > ');
  }

  // ─── CSS Snapshot ───

  function snapshotStyles(el) {
    const computed = window.getComputedStyle(el);
    const snap = {};
    for (const prop of TRACKED_PROPS) {
      snap[prop] = computed.getPropertyValue(prop);
    }
    return snap;
  }

  // ─── Overlay Positioning ───

  function positionOverlay(overlay, el) {
    const rect = el.getBoundingClientRect();
    overlay.style.display = 'block';
    overlay.style.top = rect.top + 'px';
    overlay.style.left = rect.left + 'px';
    overlay.style.width = rect.width + 'px';
    overlay.style.height = rect.height + 'px';
    overlay.querySelector('.ls-label').textContent = getSelector(el);
  }

  function hideOverlay(overlay) {
    overlay.style.display = 'none';
  }

  // ─── Element Filtering ───

  function isExtensionElement(el) {
    if (!el || el === document || el === document.documentElement) return true;
    if (el === shadowHost) return true;
    if (el.hasAttribute && el.hasAttribute(ATTR)) return true;
    return false;
  }

  function isValidTarget(el) {
    if (!el || isExtensionElement(el)) return false;
    const tag = el.tagName.toLowerCase();
    // Skip html, body, script, style, noscript, head, meta, link, br, hr
    const skip = ['html', 'body', 'head', 'script', 'style', 'noscript', 'meta', 'link', 'br'];
    return !skip.includes(tag);
  }

  // ─── Event Handlers ───

  function onMouseMove(e) {
    if (!isActive || isDragging) return;
    if (e.target === shadowHost) { hideOverlay(hoverOverlay); return; }

    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || !isValidTarget(el)) {
      hideOverlay(hoverOverlay);
      return;
    }

    positionOverlay(hoverOverlay, el);
  }

  function onMouseDown(e) {
    if (!isActive) return;
    if (e.target === shadowHost) return; // Don't intercept our own UI

    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || !isValidTarget(el)) return;

    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    dragTarget = el;
    isDragging = true;

    const rect = el.getBoundingClientRect();
    dragOffsetX = e.clientX - rect.left;
    dragOffsetY = e.clientY - rect.top;
    dragStartX = e.clientX;
    dragStartY = e.clientY;

    // Snapshot original styles if first time touching this element
    if (!changes.has(el)) {
      changes.set(el, {
        selector: getSelector(el),
        before: snapshotStyles(el),
        after: {}
      });
    }

    // Ensure element can be moved
    const pos = window.getComputedStyle(el).position;
    if (pos === 'static') {
      el.style.position = 'relative';
    }

    positionOverlay(selectedOverlay, el);
    hideOverlay(hoverOverlay);
    document.body.style.cursor = 'grabbing';
  }

  function onMouseMoveDrag(e) {
    if (!isDragging || !dragTarget) return;
    if (e.target === shadowHost) return;

    e.preventDefault();
    e.stopPropagation();

    const deltaX = e.clientX - dragStartX;
    const deltaY = e.clientY - dragStartY;

    const pos = window.getComputedStyle(dragTarget).position;
    if (pos === 'relative' || pos === 'sticky') {
      // For relative/sticky, top and left are offsets from normal position
      const currentTop = parseFloat(dragTarget.style.top) || 0;
      const currentLeft = parseFloat(dragTarget.style.left) || 0;

      dragTarget.style.top = (currentTop + (e.clientY - dragStartY)) + 'px';
      dragTarget.style.left = (currentLeft + (e.clientX - dragStartX)) + 'px';

      dragStartX = e.clientX;
      dragStartY = e.clientY;
    } else if (pos === 'absolute' || pos === 'fixed') {
      const rect = dragTarget.getBoundingClientRect();
      dragTarget.style.top = (e.clientY - dragOffsetY) + 'px';
      dragTarget.style.left = (e.clientX - dragOffsetX) + 'px';
      dragTarget.style.right = 'auto';
      dragTarget.style.bottom = 'auto';
    }

    positionOverlay(selectedOverlay, dragTarget);
  }

  function onMouseUp(e) {
    if (!isDragging || !dragTarget) return;
    if (e.target === shadowHost) return;

    e.preventDefault();
    e.stopPropagation();

    isDragging = false;
    document.body.style.cursor = '';

    // Record final state
    const entry = changes.get(dragTarget);
    if (entry) {
      entry.after = snapshotStyles(dragTarget);
    }

    positionOverlay(selectedOverlay, dragTarget);
    dragTarget = null;

    updateBadge();
    updateStatusText();
  }

  function onClick(e) {
    if (!isActive) return;
    if (e.target === shadowHost) return; // Don't intercept our own UI
    // Prevent navigation, form submission, etc. during edit mode
    e.preventDefault();
    e.stopPropagation();
  }

  // ─── Badge & Status ───

  function updateBadge() {
    const count = getModifiedCount();
    try {
      chrome.runtime.sendMessage({ action: 'updateBadge', count });
    } catch (_) { /* extension context may be invalidated */ }
  }

  function getModifiedCount() {
    let count = 0;
    changes.forEach((entry) => {
      if (Object.keys(entry.after).length > 0) {
        // Check if anything actually changed
        for (const prop of TRACKED_PROPS) {
          if (entry.before[prop] !== entry.after[prop]) {
            count++;
            break;
          }
        }
      }
    });
    return count;
  }

  function updateStatusText() {
    if (!floatingBar) return;
    const count = getModifiedCount();
    const status = floatingBar.querySelector('.ls-status');
    if (count > 0) {
      status.innerHTML = 'DragCSS — <strong>' + count + ' element' + (count !== 1 ? 's' : '') + ' modified</strong>';
    } else {
      status.innerHTML = 'DragCSS — <strong>Edit Mode</strong>';
    }
  }

  // ─── Export ───

  function getChangedEntries() {
    const entries = [];
    changes.forEach((entry) => {
      if (Object.keys(entry.after).length === 0) return;
      const diffs = {};
      let hasDiff = false;
      for (const prop of TRACKED_PROPS) {
        if (entry.before[prop] !== entry.after[prop]) {
          diffs[prop] = { before: entry.before[prop], after: entry.after[prop] };
          hasDiff = true;
        }
      }
      if (hasDiff) {
        entries.push({ selector: entry.selector, diffs });
      }
    });
    return entries;
  }

  function generateCSSDiff() {
    const entries = getChangedEntries();
    if (entries.length === 0) return '/* No changes detected */';

    let output = '/* DragCSS — CSS Changes */\n\n';

    for (const entry of entries) {
      output += '/* ─── ' + entry.selector + ' ─── */\n\n';

      output += '/* BEFORE */\n';
      output += entry.selector + ' {\n';
      for (const [prop, val] of Object.entries(entry.diffs)) {
        output += '  ' + prop + ': ' + val.before + ';\n';
      }
      output += '}\n\n';

      output += '/* AFTER (apply this) */\n';
      output += entry.selector + ' {\n';
      for (const [prop, val] of Object.entries(entry.diffs)) {
        output += '  ' + prop + ': ' + val.after + ';\n';
      }
      output += '}\n\n';
    }

    return output;
  }

  function generateAIPrompt() {
    const entries = getChangedEntries();
    if (entries.length === 0) return 'No layout changes to report.';

    let output = 'I made the following CSS layout changes to a webpage. ';
    output += 'Please update my code to match these changes:\n\n';

    for (const entry of entries) {
      output += 'Element: `' + entry.selector + '`\n';
      for (const [prop, val] of Object.entries(entry.diffs)) {
        output += '  - ' + prop + ': ' + val.before + ' → ' + val.after + '\n';
      }
      output += '\n';
    }

    output += 'Apply the AFTER values to the corresponding CSS selectors in my codebase.';
    return output;
  }

  function renderExportContent(tab) {
    const content = shadow.getElementById('ls-export-content');
    if (tab === 'ai') {
      content.textContent = generateAIPrompt();
    } else {
      content.textContent = generateCSSDiff();
    }
  }

  function showExportPanel() {
    exportPanel.style.display = 'flex';
    const activeTab = exportPanel.querySelector('.ls-export-tab.active');
    renderExportContent(activeTab ? activeTab.dataset.tab : 'css');
  }

  function hideExportPanel() {
    exportPanel.style.display = 'none';
  }

  function copyToClipboard() {
    const content = shadow.getElementById('ls-export-content').textContent;
    navigator.clipboard.writeText(content).then(() => {
      showToast('Copied to clipboard!');
    }).catch(() => {
      // Fallback: select and copy
      const textarea = document.createElement('textarea');
      textarea.value = content;
      textarea.style.cssText = 'position:fixed;top:-9999px;';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      showToast('Copied to clipboard!');
    });
  }

  function showToast(message) {
    const toast = shadow.getElementById('ls-toast');
    toast.textContent = message;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 2000);
  }

  // ─── Reset ───

  function resetAll() {
    changes.forEach((entry, el) => {
      // Restore original inline styles by removing what we added
      for (const prop of TRACKED_PROPS) {
        el.style.removeProperty(prop);
      }
    });
    changes.clear();
    hideOverlay(selectedOverlay);
    updateBadge();
    updateStatusText();
    showToast('All changes reset!');
  }

  // ─── Activate / Deactivate ───

  function activate() {
    if (isActive) return;
    isActive = true;

    createUI();

    document.addEventListener('mousemove', onMouseMove, true);
    document.addEventListener('mousedown', onMouseDown, true);
    document.addEventListener('mousemove', onMouseMoveDrag, true);
    document.addEventListener('mouseup', onMouseUp, true);
    document.addEventListener('click', onClick, true);
    // Also block other click-like events
    document.addEventListener('auxclick', onClick, true);
    document.addEventListener('dblclick', onClick, true);
    document.addEventListener('contextmenu', onClick, true);
  }

  function deactivate() {
    if (!isActive) return;
    isActive = false;
    isDragging = false;
    dragTarget = null;

    document.removeEventListener('mousemove', onMouseMove, true);
    document.removeEventListener('mousedown', onMouseDown, true);
    document.removeEventListener('mousemove', onMouseMoveDrag, true);
    document.removeEventListener('mouseup', onMouseUp, true);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('auxclick', onClick, true);
    document.removeEventListener('dblclick', onClick, true);
    document.removeEventListener('contextmenu', onClick, true);

    document.body.style.cursor = '';

    // Don't clear changes — user might want to re-enable and export
    destroyUI();
  }

  // ─── Message Listener ───

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'activate') {
      activate();
      sendResponse({ ok: true });
    } else if (message.action === 'deactivate') {
      deactivate();
      sendResponse({ ok: true });
    } else if (message.action === 'getChanges') {
      sendResponse({
        css: generateCSSDiff(),
        ai: generateAIPrompt(),
        count: getModifiedCount()
      });
    } else if (message.action === 'exportChanges') {
      showExportPanel();
      sendResponse({ ok: true });
    } else if (message.action === 'resetAll') {
      resetAll();
      sendResponse({ ok: true });
    }
    return true;
  });
})();
