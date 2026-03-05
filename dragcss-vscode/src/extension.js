// DragCSS VS Code Extension — Main Entry Point
// Connects to DragCSS Chrome Extension via WebSocket,
// receives CSS changes, finds matching files, and auto-applies edits.

const vscode = require('vscode');
const { DragCSSServer } = require('./server');
const { CSSFileFinder } = require('./finder');
const { CSSApplier } = require('./applier');
const { registerChatParticipant } = require('./chat');

/** @type {DragCSSServer | null} */
let server = null;
/** @type {vscode.StatusBarItem} */
let statusBarItem;
/** @type {Array} */
let pendingChanges = [];

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
  const config = vscode.workspace.getConfiguration('dragcss');

  // Status bar
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.command = 'dragcss.startServer';
  updateStatusBar('disconnected');
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  // Commands
  context.subscriptions.push(
    vscode.commands.registerCommand('dragcss.startServer', () => startServer(config)),
    vscode.commands.registerCommand('dragcss.stopServer', stopServer),
    vscode.commands.registerCommand('dragcss.applyLastChanges', () => applyChanges()),
    vscode.commands.registerCommand('dragcss.showChanges', () => showChanges())
  );

  // Chat participant
  registerChatParticipant(context, {
    getPendingChanges: () => pendingChanges,
    getServerStatus: () => (server ? 'running' : 'stopped'),
    applyChanges,
    clearChanges: () => { pendingChanges = []; }
  });

  // Auto-start
  if (config.get('autoStart')) {
    startServer(config);
  }
}

function startServer(config) {
  if (server) {
    vscode.window.showInformationMessage('DragCSS server is already running.');
    return;
  }

  const port = config ? config.get('port', 9742) : 9742;
  const autoApply = config ? config.get('autoApply', false) : false;

  server = new DragCSSServer(port);

  server.on('connected', () => {
    updateStatusBar('connected');
    vscode.window.showInformationMessage('DragCSS: Chrome extension connected!');
  });

  server.on('disconnected', () => {
    updateStatusBar('listening');
  });

  server.on('changes', async (changes) => {
    pendingChanges = changes;
    updateStatusBar('received', changes.length);

    if (autoApply) {
      await applyChanges();
    } else {
      const action = await vscode.window.showInformationMessage(
        `DragCSS: Received ${changes.length} CSS change(s) from Chrome.`,
        'Apply Now',
        'Show Changes',
        'Send to Copilot'
      );

      if (action === 'Apply Now') {
        await applyChanges();
      } else if (action === 'Show Changes') {
        showChanges();
      } else if (action === 'Send to Copilot') {
        // Open chat with @dragcss /apply
        vscode.commands.executeCommand('workbench.action.chat.open', {
          query: '@dragcss /apply'
        });
      }
    }
  });

  server.on('error', (err) => {
    vscode.window.showErrorMessage(`DragCSS server error: ${err.message}`);
    updateStatusBar('error');
  });

  server.start();
  updateStatusBar('listening');
  vscode.window.showInformationMessage(`DragCSS: Server listening on port ${port}`);
}

function stopServer() {
  if (!server) {
    vscode.window.showInformationMessage('DragCSS server is not running.');
    return;
  }
  server.stop();
  server = null;
  updateStatusBar('disconnected');
  vscode.window.showInformationMessage('DragCSS: Server stopped.');
}

async function applyChanges() {
  if (pendingChanges.length === 0) {
    vscode.window.showInformationMessage('DragCSS: No pending changes to apply.');
    return;
  }

  const finder = new CSSFileFinder();
  const applier = new CSSApplier();
  let applied = 0;
  let notFound = 0;

  for (const change of pendingChanges) {
    const matches = await finder.findFilesForSelector(change.selector);

    if (matches.length === 0) {
      // No matching file — create a new rule or warn user
      notFound++;
      continue;
    }

    for (const match of matches) {
      const success = await applier.applyChange(match.uri, match.range, change);
      if (success) applied++;
    }
  }

  if (applied > 0) {
    vscode.window.showInformationMessage(
      `DragCSS: Applied ${applied} change(s).` +
      (notFound > 0 ? ` ${notFound} selector(s) not found in workspace.` : '')
    );
  } else if (notFound > 0) {
    // No files matched — offer to create a new CSS file with all changes
    const action = await vscode.window.showWarningMessage(
      `DragCSS: No matching CSS rules found for ${notFound} selector(s). Create a new file?`,
      'Create dragcss-overrides.css',
      'Send to Copilot'
    );

    if (action === 'Create dragcss-overrides.css') {
      await applier.createOverrideFile(pendingChanges);
    } else if (action === 'Send to Copilot') {
      vscode.commands.executeCommand('workbench.action.chat.open', {
        query: '@dragcss /apply'
      });
    }
  }

  pendingChanges = [];
  updateStatusBar(server ? 'connected' : 'disconnected');
}

function showChanges() {
  if (pendingChanges.length === 0) {
    vscode.window.showInformationMessage('DragCSS: No pending changes.');
    return;
  }

  // Open a virtual document showing the changes
  const content = formatChangesForPreview(pendingChanges);
  vscode.workspace.openTextDocument({ content, language: 'css' }).then(doc => {
    vscode.window.showTextDocument(doc, { preview: true });
  });
}

function formatChangesForPreview(changes) {
  let output = '/* DragCSS — Pending CSS Changes */\n\n';
  for (const change of changes) {
    output += `/* ─── ${change.selector} ─── */\n\n`;
    output += `/* BEFORE */\n${change.selector} {\n`;
    for (const [prop, val] of Object.entries(change.diffs)) {
      output += `  ${prop}: ${val.before};\n`;
    }
    output += '}\n\n';
    output += `/* AFTER (to apply) */\n${change.selector} {\n`;
    for (const [prop, val] of Object.entries(change.diffs)) {
      output += `  ${prop}: ${val.after};\n`;
    }
    output += '}\n\n';
  }
  return output;
}

function updateStatusBar(state, count) {
  switch (state) {
    case 'disconnected':
      statusBarItem.text = '$(plug) DragCSS: Off';
      statusBarItem.tooltip = 'Click to start DragCSS server';
      statusBarItem.command = 'dragcss.startServer';
      statusBarItem.backgroundColor = undefined;
      break;
    case 'listening':
      statusBarItem.text = '$(radio-tower) DragCSS: Waiting...';
      statusBarItem.tooltip = 'WebSocket server running — waiting for Chrome extension';
      statusBarItem.command = 'dragcss.stopServer';
      statusBarItem.backgroundColor = undefined;
      break;
    case 'connected':
      statusBarItem.text = '$(check) DragCSS: Connected';
      statusBarItem.tooltip = 'Chrome extension connected';
      statusBarItem.command = 'dragcss.showChanges';
      statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.prominentBackground');
      break;
    case 'received':
      statusBarItem.text = `$(edit) DragCSS: ${count} change(s)`;
      statusBarItem.tooltip = 'Click to view pending changes';
      statusBarItem.command = 'dragcss.showChanges';
      statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
      break;
    case 'error':
      statusBarItem.text = '$(error) DragCSS: Error';
      statusBarItem.tooltip = 'Server error — click to restart';
      statusBarItem.command = 'dragcss.startServer';
      statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
      break;
  }
}

function deactivate() {
  if (server) {
    server.stop();
    server = null;
  }
}

module.exports = { activate, deactivate };
