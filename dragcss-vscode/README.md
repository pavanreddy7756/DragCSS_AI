# DragCSS — VS Code Extension

Auto-apply visual CSS changes from the [DragCSS Chrome extension](https://github.com/pavanreddy7756/DragCSS_AI) directly to your source files. No copy-paste needed.

## How It Works

```
Chrome (DragCSS) → WebSocket → VS Code Extension → Your CSS Files
```

1. Open any webpage in Chrome and activate DragCSS
2. Drag elements to adjust layout visually
3. Click **⚡ Send to VS Code** in the floating bar
4. VS Code finds matching CSS rules and applies the changes automatically

## Features

- **Auto-Apply**: Finds matching selectors in your `.css`, `.scss`, `.less` files and updates them
- **Copilot Chat**: Use `@dragcss /apply` in Copilot Chat for AI-assisted changes
- **Override File**: When no matching rules are found, generates a `dragcss-overrides.css` file
- **Status Bar**: Shows connection status (waiting → connected → changes received)

## Commands

| Command | Description |
|---------|-------------|
| `DragCSS: Start Server` | Start the WebSocket server |
| `DragCSS: Stop Server` | Stop the WebSocket server |
| `DragCSS: Apply Last Changes` | Apply the most recently received changes |
| `DragCSS: Show Pending Changes` | Preview changes before applying |

## Chat Commands

| Command | Description |
|---------|-------------|
| `@dragcss /apply` | Apply pending CSS changes to matching files |
| `@dragcss /show` | Preview pending changes in chat |
| `@dragcss /status` | Check server and connection status |

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `dragcss.port` | `9742` | WebSocket server port |
| `dragcss.autoApply` | `false` | Auto-apply changes without confirmation |
| `dragcss.autoStart` | `true` | Start server when VS Code opens |

## Requirements

- DragCSS Chrome Extension installed and active
- Both Chrome and VS Code running on the same machine
