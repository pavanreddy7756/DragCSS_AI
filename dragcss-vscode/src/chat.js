// DragCSS — Copilot Chat Participant
// Registers @dragcss chat participant with /apply, /show, /status commands

const vscode = require('vscode');

/**
 * @param {vscode.ExtensionContext} context
 * @param {Object} bridge — Shared state from extension.js
 */
function registerChatParticipant(context, bridge) {
  const participant = vscode.chat.createChatParticipant('dragcss.chat', async (request, chatContext, stream, token) => {
    const command = request.command;

    if (command === 'status') {
      const status = bridge.getServerStatus();
      const changes = bridge.getPendingChanges();
      stream.markdown(`**DragCSS Server:** ${status === 'running' ? '🟢 Running' : '🔴 Stopped'}\n\n`);
      stream.markdown(`**Pending Changes:** ${changes.length}\n`);
      if (changes.length > 0) {
        stream.markdown('\nUse `/apply` to apply them or `/show` to preview.\n');
      }
      return;
    }

    if (command === 'show') {
      const changes = bridge.getPendingChanges();
      if (changes.length === 0) {
        stream.markdown('No pending CSS changes. Make some visual edits in the DragCSS Chrome extension first.\n');
        return;
      }

      stream.markdown(`## ${changes.length} Pending CSS Change(s)\n\n`);
      for (const change of changes) {
        stream.markdown(`### \`${change.selector}\`\n\n`);
        stream.markdown('| Property | Before | After |\n');
        stream.markdown('|----------|--------|-------|\n');
        for (const [prop, val] of Object.entries(change.diffs)) {
          stream.markdown(`| \`${prop}\` | \`${val.before}\` | \`${val.after}\` |\n`);
        }
        stream.markdown('\n');
      }
      return;
    }

    if (command === 'apply') {
      const changes = bridge.getPendingChanges();
      if (changes.length === 0) {
        stream.markdown('No pending CSS changes to apply.\n');
        return;
      }

      stream.markdown(`## Applying ${changes.length} CSS Change(s)\n\n`);
      stream.markdown('I will find matching CSS rules in your workspace and apply the visual changes:\n\n');

      for (const change of changes) {
        stream.markdown(`**\`${change.selector}\`**\n`);
        for (const [prop, val] of Object.entries(change.diffs)) {
          stream.markdown(`- \`${prop}\`: \`${val.before}\` → \`${val.after}\`\n`);
        }
        stream.markdown('\n');
      }

      stream.markdown('\n---\n\nApplying changes...\n');

      // Trigger the actual apply logic
      await bridge.applyChanges();

      stream.markdown('\n✅ Done! Check your CSS files for the applied changes.\n');
      return;
    }

    // Default: no command — show help
    const changes = bridge.getPendingChanges();

    stream.markdown('# DragCSS — Visual CSS → Code\n\n');
    stream.markdown('I bridge your DragCSS Chrome extension with your codebase.\n\n');
    stream.markdown('**Commands:**\n');
    stream.markdown('- `/apply` — Apply pending CSS changes to matching files\n');
    stream.markdown('- `/show` — Preview pending changes\n');
    stream.markdown('- `/status` — Check server and connection status\n\n');

    if (changes.length > 0) {
      stream.markdown(`📦 **${changes.length} change(s) pending.** Use \`/apply\` to apply them.\n`);
    } else {
      stream.markdown('No pending changes. Start by:\n');
      stream.markdown('1. Open a webpage in Chrome\n');
      stream.markdown('2. Click the DragCSS extension icon\n');
      stream.markdown('3. Drag elements to adjust layout\n');
      stream.markdown('4. Click "Send to VS Code" in the export panel\n');
    }

    if (request.prompt && request.prompt.trim()) {
      // User asked a freeform question with context of changes
      stream.markdown('\n---\n\n');
      if (changes.length > 0) {
        stream.markdown('Here are the current changes for context:\n\n');
        stream.markdown('```css\n');
        for (const change of changes) {
          stream.markdown(`${change.selector} {\n`);
          for (const [prop, val] of Object.entries(change.diffs)) {
            stream.markdown(`  ${prop}: ${val.after};\n`);
          }
          stream.markdown('}\n\n');
        }
        stream.markdown('```\n');
      }
    }
  });

  participant.iconPath = vscode.Uri.joinPath(context.extensionUri, 'icon.png');

  context.subscriptions.push(participant);
}

module.exports = { registerChatParticipant };
