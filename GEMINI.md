# TWSE eVoting Automation Project

## Project Overview
The TWSE eVoting project is a desktop application built with Electron designed to automate the shareholder voting process on the Taiwan Depository & Clearing Corporation (TDCC) e-Voting platform. It automates logging in with a national ID, identifying pending or completed votes for specified or all companies, casting votes according to predefined preferences (e.g., agree, against, abstained), capturing full-page screenshot proofs of the voting results, and securely logging out.

### Architecture
- **Main Process (`main.js`)**: Manages the application window, sets up a `BrowserView` for loading the target website, and handles IPC communication with the frontend.
- **Preload (`preload.js`)**: Acts as a secure bridge between the renderer process and the main process using `contextBridge`.
- **Renderer (`src/renderer/`)**: Contains the user interface built with plain HTML, Vanilla CSS, and JavaScript.
- **Automation Engine (`src/automation/`)**: Contains modular scripts for interacting with the target website:
  - `main_flow.js`: Orchestrates the overall logic, handles session isolation (clearing cookies/cache), and respects TDCC's system maintenance hours (00:00 - 07:00 UTC+8).
  - `login.js`: Automates login, certificate selection, and handles unexpected "duplicate login" or "no pending votes" native dialogs.
  - `voting.js`: Scrapes the list of target companies, navigates through the voting forms, and submits votes based on the user's selected preference.
  - `screenshot.js`: Captures full-page proofs of the voting completion and saves them locally.
  - `logout.js`: Safely ends the session by finding and clicking logout controls and confirmation dialogs.

## Building and Running
The project is built on Node.js and Electron. Use the following commands to manage the application:

*   **Install Dependencies:**
    ```bash
    npm install
    ```
*   **Run the Application (Development):**
    ```bash
    npm start
    # or
    npm run dev
    ```

## Development Conventions
When modifying or extending this codebase, adhere to the following established practices:

*   **Readability & Maintainability**: Keep code clean and modular. Extract complex logic into smaller, well-named helper functions (e.g., `isScreenshotExists`, `navigateBackToList`). Document functions using JSDoc.
*   **Variable Declarations**: Use `const` as much as possible for variables and references that do not get reassigned. Only use `let` when mutation is strictly necessary.
*   **Early Returns**: Avoid deep `if/else` nesting. Use early `return`, `continue`, or `break` statements to exit functions or loops as soon as a condition fails (e.g., if a DOM element is not found).
*   **Performance & Speed Up**: Minimize arbitrary, long `delay()` calls. Prefer active polling (checking for an element in a loop with a small delay) so the script can proceed immediately when the condition is met. Use efficient array methods like `.some()` or `.find()` for text matching.
*   **Module System**: The backend (Main Process) and Automation logic use CommonJS (`require` / `module.exports`).
*   **DOM Interaction**: All interactions with the TDCC website are executed securely within the `BrowserView` via `webContents.executeJavaScript`.
*   **Asynchronous Flow**: Web automation heavily relies on `async` / `await` and manual polling or `delay()` functions to wait for dynamic elements and page loads.
*   **Native Dialog Prevention**: Native dialogs like `window.alert` and `window.confirm` block the `executeJavaScript` thread. Scripts interacting with pages that may trigger these (like `login.js` and `logout.js`) proactively override these methods at the start of their injected scripts.
*   **Error Handling**: Wrap automation steps in `try/catch` blocks. Errors should be logged to the UI using the provided `sendLog` callback rather than crashing the main loop, allowing the system to proceed to the next company or account.
*   **Constants**: Hardcoded URLs and configuration strings should be placed in `src/constants.js`.
*   **UI Framework**: Stick to Vanilla JavaScript and pure CSS for the frontend in `src/renderer/`. TailwindCSS or other large frameworks are not used.

## Usage (AI Context)
This file serves as the primary system context for AI agents interacting with the repository. When implementing new features or fixing bugs, prioritize maintaining the robustness of the automation engine, especially regarding DOM parsing (which can fail if the target website changes) and asynchronous timing.