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
- Files with **no connections at all** (neither imports nor imported by anything) are shown with a **red background and red border**
- These are candidates for cleanup — dead code, forgotten files
- Tooltip shows a ⚠️ unused badge

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
| **Drag** file node | Reposition node anywhere, all connected edges follow live |
| **Drag** folder box | Move entire folder with all its nodes, all edges (including folder-to-folder) follow live |
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

1. Open any project folder in VS Code
2. Press `Ctrl+Shift+P`
3. Type **`Generate Codebase Map`** → press Enter
4. Wait a moment while your project is scanned
5. The interactive map opens in a webview panel beside your editor

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

> Yeh section track karta hai — **abhi kya implement karna baaki hai**, aur **aage kya banana hai**.

---

### ⏳ IMMEDIATE — Abhi implement karna hai (code ready hai, sirf paste karna hai)

---

#### 1. 🔁 Smart Auto-Collapse on Load

**Problem:** Jab bhi map open hota hai, saari folders expanded hoti hain — large projects mein bahut cluttered dikhta hai.

**Solution — `src/webview/panel.ts` → `renderRoot()` function:**

`topFolders.forEach(fp => drawFolderBox(fp));` (line ~1229) ke baad, `// 3. Folder-to-folder aggregated edges` se pehle yeh block insert karo:

```js
// 2b. Auto-collapse folders that have no connected files
{
  const allFoldersSorted = [...folders].sort((a, b) => {
    const da = a.split('/').length, db = b.split('/').length;
    return db - da; // deeper folders first
  });

  allFoldersSorted.forEach(fp => {
    const filesUnder = getAllFilesUnder(fp);
    const hasConnection = filesUnder.some(n => connectedIds.has(n.id));
    if (!hasConnection) {
      setFolderCollapsed(fp, true);
    }
  });
}
```

**Variables already available:** `folders`, `getAllFilesUnder()`, `connectedIds`, `setFolderCollapsed()`

**Result:** Sirf woh folders open rehte hain jinke files ke beech edges hain. Unused/disconnected folders by default collapsed.

---

#### 2. 🔘 "Collapse All / Expand All" Toggle Button

**File:** `src/webview/panel.ts` — 4 jagah changes:

**CSS** (`getStyles()` → `#resetBtn:hover` ke baad):
```css
#collapseAllBtn {
  margin-top: 6px;
  margin-left: 6px;
  background: #3c3c5a;
  border: none;
  color: #9cdcfe;
  padding: 4px 12px;
  border-radius: 5px;
  cursor: pointer;
  font-size: 11px;
}
#collapseAllBtn:hover { background: #4c4c7a; }
```

**HTML** (`getToolbar()` → `<button id="resetBtn">` ke baad):
```html
<button id="collapseAllBtn">&#9654; Collapse All</button>
```

**JS variable** (`getJs1()` → `const resetBtn` ke baad):
```js
const collapseAllBtn = document.getElementById('collapseAllBtn');
```

**Event listener** (`resetBtn.addEventListener` ke baad):
```js
let _allCollapsed = false;
collapseAllBtn.addEventListener('click', () => {
  if (viewMode !== 'root') return;
  _allCollapsed = !_allCollapsed;
  collapseAllBtn.textContent = _allCollapsed ? '▼ Expand All' : '▶ Collapse All';
  folders.forEach(fp => setFolderCollapsed(fp, _allCollapsed));
  redrawAllEdges();
});
```

**Build command after changes:** `node esbuild.js`

---

### 🔮 FUTURE — Aage banana hai (planned features)

---

#### 3. 🌐 Frontend ↔ Backend API Call Matching

**What:** JS/TS frontend mein `fetch('/api/users')` aur Python/Node backend mein `@app.get('/api/users')` ko automatically match karke ek edge draw karo.

**How:**
- JS parser mein `fetch()`, `axios.get()`, `axios.post()` calls detect karo — URL extract karo
- Python parser mein FastAPI/Flask route decorators `@app.get(...)`, `@router.post(...)` detect karo — route path extract karo
- `graphBuilder.ts` mein dono ko match karo — ek nayi edge type `'api-call'` (pink/magenta color)
- `panel.ts` mein is edge type ke liye alag styling (dashed pink line)

**Files to change:** `jstsParser.ts`, `pythonParser.ts`, `graphBuilder.ts`, `panel.ts`

---

#### 4. 🤖 AI Enrichment Layer

**What:** Har node pe ek AI-generated summary dikhao — "ye file kya karti hai", category (auth/db/api/util etc.)

**How:**
- Extension mein Claude API / VS Code LLM API integrate karo
- Har file ka content (ya functions list) bhejo, summary wapas lo
- Node ke `summary` aur `category` fields fill karo (abhi `null` hain)
- Tooltip mein summary dikhao; layout mein category-based color/grouping option

**Files to change:** `extension.ts` (API call), `graphBuilder.ts` (fields add), `panel.ts` (tooltip + display)

---

#### 5. 🔍 Search / Filter Bar

**What:** Toolbar mein ek search box — filename type karo, sirf matching nodes highlight/focus ho jaayein, baaki dim.

**How:**
- `getToolbar()` mein `<input id="searchBox" placeholder="Search file...">` add karo
- `input` event pe `nodes` array filter karo by `fileName`
- Matching nodes bright, non-matching dim (same CSS classes jo isolation mein use hoti hain)
- `Escape` press → search clear, full view restore

**Files to change:** `panel.ts` only

---

#### 6. 📦 Performance — Large Projects (1000+ files)

**What:** Very large projects pe scan slow hota hai aur SVG laggy hoti hai.

**Improvements planned:**
- Scanner mein `node_modules`, `.git`, `dist`, `build`, `__pycache__` better skip karo (configurable ignore list)
- SVG rendering mein virtualization — sirf visible viewport ke nodes render karo (off-screen nodes ka DOM element create na karo)
- Web Worker mein graph layout compute karo taaki UI thread block na ho

---

#### 7. ⚙️ Settings / Configuration

**What:** User VS Code settings se control kar sake:
- Kaunsi file extensions scan hon
- Kaunse folders ignore hon (custom `.codemapignore` file support)
- Max file count limit
- Default zoom level
- Auto-collapse on/off toggle (instead of always-on)

**Files to change:** `package.json` (contributes.configuration), `extension.ts` (read settings), `scanner.ts` (apply filters)

---

#### 8. 🗺️ Minimap

**What:** Canvas ke corner mein ek chhota overview minimap — pura graph chhota dikhao, aur current viewport ka rectangle dikhao. Click/drag on minimap → jump to that area.

**How:** Second smaller SVG element, same graph data se scaled-down render, viewport rect overlay.

**Files to change:** `panel.ts` only

---

#### 9. 📸 Export Graph as Image / JSON

**What:**
- **PNG/SVG export** — toolbar button → current graph SVG ko file mein save karo
- **JSON export** — raw graph JSON (`nodes[]` + `edges[]`) download karo for external tools

**How:**
- SVG serialization → `Blob` → download link
- `vscode.postMessage` → extension side pe file write

**Files to change:** `panel.ts`, `extension.ts`

---

## Known Issues

- Very large projects (1000+ files) may take a few seconds to scan
- Frappe / Django projects with many apps — open a specific app subfolder for faster and more focused results
- Frappe `Document` base class not yet detected as ORM (coming soon)

---

## Release Notes

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
- Entry point gold border, unused files red
- Tooltip on hover for all element types
- Reset View button
