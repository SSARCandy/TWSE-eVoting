# CLAUDE.md - TWSE eVoting Project

Taiwan Shareholder Voting Automation system using Electron.

## Build and Run Commands

### Development
- `npm start`: Launch the Electron application.
- `npm run dev`: Launch the Electron application (alias for start).

### Dependencies
- `npm install`: Install required dependencies (Electron).

## Coding Guidelines

### Architecture
- **Main Process**: `main.js` handles window management, BrowserView setup, and IPC.
- **Preload**: `preload.js` bridges Electron IPC to the renderer.
- **Renderer**: `src/renderer/` contains HTML/CSS/JS for the UI.
- **Automation**: `src/automation/` contains the logic for site interaction, login, and voting.

### Code Style
- **JavaScript**: CommonJS (`require`/`module.exports`) is used for the main and automation logic.
- **Indentation**: 2 spaces in `main.js`, 4 spaces in `src/` (automation and renderer).
- **Naming**: Use `camelCase` for variables and functions.
- **Error Handling**: Use `try/catch` blocks for automation flows and IPC handlers.
- **Communication**: Use `ipcMain.handle` / `ipcRenderer.invoke` (via preload) for main-renderer communication.

### Automation Specifics
- Uses `webContents.executeJavaScript` for DOM interaction.
- Handles Taiwan-specific business logic (e.g., maintenance hours 00:00-07:00).
- Implements session isolation by clearing storage and cache between account runs.
- **Screenshots**: Screenshots of voting results are saved to `./screenshots/` (implemented in `src/automation/screenshot.js`).

### UI & Styling
- Pure HTML and Vanilla CSS.
- Modern CSS variables for styling.
- Responsive layout with a fixed sidebar (400px) and a dynamic BrowserView for the target website.
