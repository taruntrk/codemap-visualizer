# CodeMap Visualizer

> **Visualize your entire codebase as an interactive map — files, folders, imports, function calls, CSS, environment variables, and database connections, all in one place.**

---

## What is this?

CodeMap Visualizer is a VS Code extension that scans your project and renders a **live, interactive graph** of your codebase. Instead of reading code file by file, you can see the entire structure at a glance — how files connect to each other, which files are entry points, which are unused, and where your database/env/CSS dependencies live.

Built with tree-sitter for accurate parsing (no regex hacks), rendered as SVG with full pan, zoom, drag, and isolate interactions.

---

## Features

### 🗂️ Folder Boxes
- Every folder in your project is rendered as a **rounded, colored box**
- Files are placed **inside** their folder box — structure mirrors your actual project layout
- Each folder gets a **unique color** deterministically derived from its name (consistent across runs)
- Folder boxes are **draggable** — move them anywhere on the canvas
- Folder-to-folder connections are shown as **thick curved edges** when any files across two folders import each other

### 🔗 Edges — Import & Call Connections
- **Import edges** — blue curved bezier lines
- **Call edges** — orange dashed curved lines (when an imported function is actually called)
- **Folder-to-folder edges** — thick colored curves summarizing cross-folder dependencies
- Every edge has a **circle dot** at the source end and an **arrowhead** at the target end
- Edges are bezier curves — they never overlap confusingly like straight lines

### 📁 Folder Collapse / Expand
- **Double-click** any folder box → folder **collapses** to just its header bar
- All nodes inside hide, but **connections are preserved** — edges reroute to the collapsed box center
- **Double-click again** → folder expands back, edges restore to original positions
- Useful for hiding irrelevant parts of the graph while focusing on what matters

### 🎨 CSS / Style Files
- `.css`, `.scss`, `.sass`, `.less` files are scanned and shown in a dedicated **🎨 CSS / Styles** section (purple)
- `@import` connections between CSS files are tracked as edges
- JS/TS files that `import './App.css'` get a purple edge connecting them to the CSS file
- Tooltip shows class names defined in the file

### 🔑 Environment Files
- `.env`, `.env.local`, `.env.development`, `.env.production`, `.env.test` etc. shown in a dedicated **🔑 Environment** section (yellow)
- Only **key names** are scanned — **values are never read or shown** (security by design)
- Keys are categorized in the tooltip:
  - **DB keys** — `DB_HOST`, `DATABASE_URL`, `MONGO_URI`, `REDIS_URL` etc.
  - **API/Secret keys** — `JWT_SECRET`, `API_KEY`, `OAUTH_TOKEN` etc.
- Files using `dotenv` get a yellow edge connecting them to the `.env` node

### 🗄️ Database / Schema Files
- `.sql`, `.prisma`, and Python ORM files shown in a dedicated **🗄️ Database** section (teal)
- Content-based detection — **filename alone is never enough** to classify a file as a DB file
- What is detected:
  - SQL — `CREATE TABLE` statements → table names extracted
  - Prisma — `model User { }` blocks → model names extracted
  - Python ORM — classes inheriting from `Base`, `db.Model`, `Document`, `DeclarativeBase` etc.
- What is **correctly excluded**:
  - **Pydantic `BaseModel`** — these are API schemas, not database models
  - FastAPI request/response models are NOT classified as DB files
- Code files that import DB clients (`mongoose`, `prisma`, `@prisma/client`, `sequelize`, `typeorm`, `knex`, `pg`, `mysql2`, `sqlite3`, `redis`, `ioredis`, `pymongo`, `motor`, `sqlalchemy`, `tortoise`, `peewee`, `mongoengine`, `django.db`) get a **🗄️ badge** on their node and a teal edge to the schema file

### ⭐ Entry Point Detection
- Files with **0 incoming imports** (nothing imports them) get a **gold border**
- These are your app entry points — `index.ts`, `main.py`, `app.js` etc.
- Helps you understand where execution starts

### 🔴 Unused File Detection
- Files with **no connections at all** (neither imports nor imported by anything) are collected into a dedicated **🗑 Unused Files** section at the bottom of the graph
- The section is **collapsed by default** — double-click to expand and browse all unused files
- This keeps the main graph clean — only connected files are visible on load
- The section is **draggable** — reposition it anywhere on the canvas
- Unused files are rendered with a gray dimmed style inside the section
- Tooltip shows a ⚠️ unused badge on each file inside

### 🖱️ Full Interaction Model

| Action | Result |
|---|---|
| **Click** file node | Isolate — blur everything else, highlight only this node and its direct connections |
| **Click again** same node | Reset — restore full view |
| **Ctrl+Click** file node | Open that file in VS Code beside the current editor |
| **Click** any edge/arrow | Isolate that single connection — show only source, target, and that edge |
| **Click** folder border | Isolate that folder — show all its files and their external connections |
| **Double-click** folder | Collapse folder to header bar, edges reroute to box center |
| **Double-click** collapsed folder | Expand folder back to full size |
| **Double-click** CSS / ENV / DB / Unused section | Expand section to show all its nodes |
| **Double-click** expanded section | Collapse section back to pill bar |
| **Drag** file node | Reposition node anywhere, all connected edges follow live |
| **Drag** folder box | Move entire folder with all its nodes, all edges (including folder-to-folder) follow live |
| **Drag** CSS / ENV / DB / Unused section | Move the entire section anywhere on the canvas |
| **Scroll wheel** | Zoom in/out, anchored to cursor position |
| **Drag background** | Pan the entire canvas |
| **Click empty area** | Deselect / reset isolation |
| **Reset View button** | Restore original layout and zoom |

### 💬 Rich Tooltips
- **File node hover** → filename, folder path, LOC, function count, function names (up to 10), DB usage badge
- **Edge hover** → source file → target file, edge type (import/call/db-use/env-use/css-import), imported symbol names
- **Folder box hover** → folder name, file count, "click to isolate" hint
- **CSS node hover** → class count, class names, `@import` list
- **ENV node hover** → total keys, DB keys list, API/Secret keys list (values always hidden)
- **DB node hover** → table names (SQL), model names (Prisma/ORM)

### 🔍 Drilldown Folder Mode

- **Right-click any folder** in the VS Code Explorer sidebar → select **"Generate CodeMap for this Folder"**
- The map is scoped **only to that folder** — perfect for large monorepos where you want to focus on one app or module
- Same 3-step folder picker as the full project command, but anchored to the selected folder as root
- **Step 1** — pick which top-level subfolders inside the selected folder to include
- **Step 2** — for each picked subfolder that has further subfolders, choose specific subfolders, "📄 root files only", or "✅ Select ALL" recursively
- **Step 3** — for each Step 2 subfolder that has even deeper subfolders, choose specific sub-subfolders, "📄 root files only", or "✅ Select ALL"
- If a subfolder has no further subfolders → included directly, the next step is skipped for it
- Dismissing any step → the **entire folder** is included
- Implemented via `codemap-visualizer.generateForFolder` command registered in `extension.ts`, wired to the `explorer/context` menu in `package.json`

---

## Supported Languages

| Language | Imports | Functions | Exports | Special |
|---|---|---|---|---|
| TypeScript / TSX | ✅ | ✅ | ✅ | — |
| JavaScript / JSX | ✅ | ✅ | ✅ | — |
| Python | ✅ | ✅ | ✅ | ORM detection |
| CSS / SCSS / LESS | ✅ `@import` | — | — | Class names |
| SQL | — | — | — | Table names |
| Prisma | — | — | — | Model names |
| `.env` | — | — | — | Key names only |

---

## How to Use

### Option 1 — Command Palette (full project)

1. Open any project folder in VS Code
2. Press `Ctrl+Shift+P`
3. Type **`Generate Codebase Map`** → press Enter
4. **Step 1 of 3:** A folder picker appears — select one or more top-level folders to explore (multi-select supported)
5. **Step 2 of 3:** For each selected folder that has subfolders, a second picker appears — choose specific subfolders, root files only, or "Select ALL"
6. **Step 3 of 3:** For each subfolder picked in Step 2 that has further subfolders, a third picker appears — choose specific sub-subfolders, root files only, or "Select ALL"
7. The interactive map opens in a webview panel beside your editor

### Option 2 — Right-click any folder (drilldown mode)

1. Right-click **any folder** in the VS Code Explorer sidebar
2. Select **"Generate CodeMap for this Folder"**
3. Same 3-step folder picker appears, scoped to the folder you right-clicked
4. Useful for large monorepos — drill into a specific app or module without scanning everything

### 3-Step Folder Picker — How it works

| Step | What you see | What you pick |
|---|---|---|
| **Step 1** | All top-level folders + root files | One or more folders to include |
| **Step 2** | Subfolders inside each selected folder | Specific subfolders, "root files only", or "✅ Select ALL" |
| **Step 3** | Sub-subfolders inside each Step 2 subfolder | Specific sub-subfolders, "root files only", or "✅ Select ALL" |

- If a folder has **no subfolders** → it's added directly, the next step is skipped for it
- Dismissing any step → the **entire folder** is included
- Picking **"✅ Select ALL"** → entire folder included recursively
- Picking **"📄 root files"** → only files directly in that folder (no subdirectory recursion)

---

## Running in Development

```bash
# Clone and install
git clone https://github.com/taruntrk/codemap-visualizer.git
cd codemap-visualizer
npm install

# Build
node esbuild.js

# Open in VS Code and press F5 to launch Extension Development Host
code .
```

To test on a specific project:
```bash
code --new-window \
  --extensionDevelopmentPath="/path/to/codemap-visualizer" \
  "/path/to/your/project"
```

---

## Project Structure

```
src/
  extension.ts          ← entry point, registers commands
  scanner/
    scanner.ts          ← walks folder tree, filters files by type
    graphBuilder.ts     ← builds graph from parsed results
  parsers/
    jstsParser.ts       ← JS/TS/JSX/TSX parser (tree-sitter)
    pythonParser.ts     ← Python parser (tree-sitter)
    cssParser.ts        ← CSS/SCSS/LESS parser (@import + classes)
    envParser.ts        ← .env parser (keys only, never values)
    dbParser.ts         ← SQL/Prisma/Python ORM parser
  webview/
    panel.ts            ← VS Code webview panel + full SVG visualization
grammars/
  tree-sitter-typescript.wasm
  tree-sitter-javascript.wasm
  tree-sitter-python.wasm
  web-tree-sitter.wasm
```

---

## Requirements & Dependencies

### For Using the Extension
- **VS Code** `^1.115.0` — minimum version required
- **No manual installs needed** — everything is bundled inside the extension

### For Development / Building from Source

**System Requirements:**
- **Node.js** `v18+` — [Download](https://nodejs.org)
- **npm** `v8+` — comes with Node.js
- **Git** — for cloning

**Install all dependencies:**
```bash
git clone https://github.com/taruntrk/codemap-visualizer.git
cd codemap-visualizer
npm install
```

**Runtime dependencies** (bundled automatically):

| Package | Version | Purpose |
|---|---|---|
| `web-tree-sitter` | `^0.26.10` | WASM-based parser engine |
| `tree-sitter-python` | `^0.25.0` | Python grammar for tree-sitter |

**Dev dependencies** (only needed for building):

| Package | Version | Purpose |
|---|---|---|
| `esbuild` | `^0.28.1` | Bundler — compiles TS to single JS file |
| `typescript` | `^6.0.3` | TypeScript compiler |
| `typescript-eslint` | `^8.61.1` | Linting |
| `eslint` | `^10.5.0` | Code quality |
| `npm-run-all` | `^4.1.5` | Run multiple npm scripts |
| `@types/vscode` | `^1.125.0` | VS Code API type definitions |
| `@types/node` | `24.x` | Node.js type definitions |
| `@types/mocha` | `^10.0.10` | Test type definitions |
| `@vscode/test-cli` | `^0.0.15` | VS Code test runner |
| `@vscode/test-electron` | `^3.0.0` | Electron-based test environment |

**Bundled WASM grammars** (no install needed, already in `/grammars`):

| File | Purpose |
|---|---|
| `web-tree-sitter.wasm` | Core tree-sitter engine |
| `tree-sitter-typescript.wasm` | TypeScript/TSX parsing |
| `tree-sitter-javascript.wasm` | JavaScript/JSX parsing |
| `tree-sitter-python.wasm` | Python parsing |

**Build commands:**
```bash
# Development build
node esbuild.js

# Production build (minified)
node esbuild.js --production

# Watch mode (auto-rebuild on save)
node esbuild.js --watch
```

**To publish on VS Code Marketplace:**
```bash
npm install -g @vscode/vsce
vsce login <publisher-name>
vsce publish
```

---

## Pending Work / TODO

> This section tracks what is planned next.

---

### 🔮 FUTURE — Planned Features

---

#### 1. 🌐 Frontend ↔ Backend API Call Matching

**What:** Automatically match `fetch('/api/users')` in JS/TS frontend with `@app.get('/api/users')` in Python/Node backend and draw an edge between them.

**How:**
- Detect `fetch()`, `axios.get()`, `axios.post()` in JS parser — extract URL
- Detect FastAPI/Flask route decorators `@app.get(...)`, `@router.post(...)` in Python parser — extract route path
- Match both in `graphBuilder.ts` — new edge type `'api-call'` (pink/magenta)
- Style as dashed pink line in `panel.ts`

**Files to change:** `jstsParser.ts`, `pythonParser.ts`, `graphBuilder.ts`, `panel.ts`

---

#### 2. 🤖 AI Enrichment Layer

**What:** Show an AI-generated summary on each node — "what this file does", category (auth/db/api/util etc.)

**How:**
- Integrate Claude API / VS Code LLM API in the extension
- Send file content (or function list), receive summary
- Fill `summary` and `category` fields on each node (currently `null`)
- Show summary in tooltip; category-based color/grouping option in layout

**Files to change:** `extension.ts` (API call), `graphBuilder.ts` (add fields), `panel.ts` (tooltip + display)

---

#### 3. 🔍 Search / Filter Bar

**What:** A search box in the toolbar — type a filename, only matching nodes highlight/focus, rest dim.

**How:**
- Add `<input id="searchBox" placeholder="Search file...">` in `getToolbar()`
- On `input` event, filter `nodes` array by `fileName`
- Matching nodes bright, non-matching dim (same CSS classes used in isolation)
- `Escape` → clear search, restore full view

**Files to change:** `panel.ts` only

---

#### 4. 📦 Performance — Large Projects (1000+ files)

**What:** Very large projects scan slowly and SVG becomes laggy.

**Improvements planned:**
- Better skip of `node_modules`, `.git`, `dist`, `build`, `__pycache__` (configurable ignore list)
- SVG virtualization — only render nodes in the visible viewport
- Compute graph layout in a Web Worker so the UI thread doesn't block

---

#### 5. ⚙️ Settings / Configuration

**What:** Let users control via VS Code settings:
- Which file extensions to scan
- Which folders to ignore (custom `.codemapignore` file support)
- Max file count limit
- Default zoom level
- Auto-collapse on/off toggle

**Files to change:** `package.json` (contributes.configuration), `extension.ts` (read settings), `scanner.ts` (apply filters)

---

#### 6. 🗺️ Minimap

**What:** A small overview minimap in the corner of the canvas — shows the full graph scaled down with a viewport rectangle. Click/drag on minimap → jump to that area.

**How:** Second smaller SVG element, scaled-down render of same graph data, viewport rect overlay.

**Files to change:** `panel.ts` only

---

#### 7. 📸 Export Graph as Image / JSON

**What:**
- **PNG/SVG export** — toolbar button → save current graph SVG to file
- **JSON export** — download raw graph JSON (`nodes[]` + `edges[]`) for external tools

**How:**
- SVG serialization → `Blob` → download link
- `vscode.postMessage` → extension writes file

**Files to change:** `panel.ts`, `extension.ts`

---

## Known Issues

- Very large projects (1000+ files) may take a few seconds to scan
- Frappe / Django projects with many apps — open a specific app subfolder for faster and more focused results
- Frappe `Document` base class not yet detected as ORM (coming soon)

---

## Release Notes

### 0.0.2
- **Unused Files section** — collapsed pill bar by default at bottom of graph, double-click to expand; unused nodes no longer rendered in folder boxes
- **CSS / Styles, Environment, Database sections** — now collapsed by default as pill bars; double-click to expand/collapse
- **Draggable sections** — CSS, ENV, DB, and Unused Files sections can be dragged anywhere on the canvas
- **No overlap between sections** — pill width is now calculated from label text length so sections never overlap each other
- **Sections on separate rows** — CSS/ENV/DB on first row, Unused Files on its own row below
- **fitView fix** — initial zoom/pan now fits only connected code nodes; large unused file counts no longer cause extreme zoom-out with graph in top-left corner
- **Double-click expand fix** — `pointer-events: all` on section rects ensures double-click works reliably on transparent backgrounds

### 0.0.1
- Initial release
- JS/TS/Python scanning with tree-sitter (WASM, no native bindings)
- Interactive SVG visualization with folder boxes and curved bezier edges
- Folder collapse/expand with edge rerouting to collapsed box center
- Folder drag moves all contained nodes + updates all connected edges live
- CSS, ENV, Database file support with dedicated sections
- Content-based DB file detection — Pydantic BaseModel correctly excluded
- 20+ DB client detections for usage badge (mongoose, prisma, sqlalchemy, etc.)
- Isolate on click for nodes, edges, and folders
- Ctrl+Click opens file in VS Code beside current editor
- Entry point gold border, unused files collected in dedicated section
- Tooltip on hover for all element types
- Reset View button
- **Drilldown folder mode** — right-click any folder in Explorer → "Generate CodeMap for this Folder" → scoped 3-step picker for that folder only
- **3-step folder picker** — Step 1: pick top-level folders; Step 2: pick specific subfolders, root files only, or select all recursively; Step 3: pick specific sub-subfolders, root files only, or select all recursively
