# CodeMap Visualizer — Project Context (Updated)

> Ye file project ka living context document hai — har session ke baad update hota hai. Sabse latest changes sabse neeche "UPDATE LOG" mein milenge.

## 🎯 Goal (unchanged)
Ek **VS Code extension** banani hai jo kisi bhi project folder ko scan karke uska **visual map** banaye — files, imports, function-level connections, aur (future mein) frontend↔backend API call connections, aur AI-based summaries.

Working name: **`codemap-visualizer`**

---

## 🗺️ Overall Architecture (3 Phases) — status update

1. ✅ **Phase 1 — Scanning**: Folder traversal + Python parsing (Tree-sitter) — **DONE**
2. ✅ **Phase 2 — JSON Graph**: `nodes[]` + `edges[]` schema, dono `import` aur `call` edge types — **DONE**
3. ✅ **Phase 3 — Visualization**: VS Code Webview panel, 2D interactive graph — **DONE (v1)**
4. ⏳ **(Later) AI Enrichment**: Node summaries/categories AI (Claude API) se fill karna — abhi nahi shuru kiya
5. ⏳ **(Later) JS/TS/JSX parsing**: abhi sirf `.py` files scan ho rahi hain — `frontend/` folder abhi cover nahi hota
6. ⏳ **(Later) Frontend↔Backend API matching**: abhi shuru nahi hua

---

## 🐛 UPDATE LOG — is session mein kya hua

### 1️⃣ BUG FIXED: `Parser.init is not a function`

**Root cause pakda gaya:** `web-tree-sitter` npm package **v0.26.10** (jo `package.json` mein confirm hua) ab default class export nahi karta — ab named exports deta hai:
```
{ Parser, Language, Node, Tree, Query, ... }
```
Purana code galat assumption kar raha tha:
```ts
const ParserModule = require('web-tree-sitter');
const Parser = ParserModule.default || ParserModule;   // ❌ .default poora module hai, class nahi
```

**Fix (verified via `node -e` module inspection, npm registry se same version install karke):**

`src/parsers/pythonParser.ts` mein top ki lines change hui:
```ts
const { Parser, Language }: any = require('web-tree-sitter');
```

Aur `initializeParser()` ke andar:
```ts
async function initializeParser(extensionPath: string): Promise<void> {
    if (parserInitialized) {
        return;
    }
    await Parser.init({
        locateFile: () => path.join(extensionPath, 'grammars', 'web-tree-sitter.wasm')
    });
    pythonLanguage = await Language.load(
        path.join(extensionPath, 'grammars', 'tree-sitter-python.wasm')
    );
    parserInitialized = true;
}
```

**Result confirmed working:** `Done! Parsed 39 Python files. Found 75 functions, 176 imports.`

Baaki poori `pythonParser.ts` file (parsing logic, `walk`, `findCalls`, interfaces) **same rahi**, koi change nahi.

---

### 2️⃣ Phase 2 — `graphBuilder.ts` (NAYI FILE, `src/scanner/graphBuilder.ts`)

`FileParseResult[]` (parser ka raw output) ko final `CodeGraph` schema mein convert karta hai:

```ts
export interface CodeGraph {
    projectName: string;
    generatedAt: string;
    nodes: GraphNode[];
    edges: GraphEdge[];
}
```

**Do tarah ke edges banata hai:**

- **`type: 'import'`** — file-level import connections. `resolvePythonModule()` function Python module strings (jaise `"model.sql"`) ko actual file-id (`"model/sql.py"`) se resolve karta hai. External/stdlib imports (jaise `os`, `redis`, `anthropic`) skip ho jaate hain (koi match nahi milta to edge nahi banta).

- **`type: 'call'`** *(v2 mein add hua)* — cross-file function-call connections. Logic: har file ke liye `importedSymbol → targetFileId` ka map banaya jaata hai, phir har function ke `calls[]` array mein dekha jaata hai ki koi call name kisi imported symbol se match karta hai ya nahi — agar haan, to us function se target file tak ek `call` edge banta hai.

**Verified via Developer Tools console (`Final Graph:` log):**
- 39 files → **54 import edges**, saare sahi (`pipeline/nodes.py` → 9 alag files, `api/main.py` → `api/models.py`/`main.py`/`pipeline/*`, etc.)
- External packages (fastapi, langchain_core, qdrant_client, etc.) correctly edges mein exclude ho gaye

---

### 3️⃣ Phase 3 — Webview Visualization (NAYI FILE, `src/webview/panel.ts` — folder `src/webview/` bhi naya banaya)

`CodeMapPanel` class jo VS Code webview panel banata/manage karta hai. Poora visual (HTML + inline CSS + inline vanilla JS, **koi external library nahi** — D3.js ya kuch aur, CSP issues avoid karne ke liye) ek hi TypeScript file ke andar embedded string ke roop mein hai.

**Kya banaya (iteratively, user feedback ke hisaab se):**

**v1 — basic static graph:**
- File = colored dot/circle (color = folder ke hisaab se hash), size = function count ke hisaab se
- Import edges = solid blue line, call edges = dashed orange line
- Click node → connected nodes/edges highlight, baaki dim
- Hover node → tooltip (fileName, folderPath, LOC, function count, import count, function names list)
- Node drag karke reposition kar sakte ho
- Layout: apna khud ka simple force-directed physics simulation (repulsion + spring attraction + centering, 400 iterations synchronous run on load) — koi D3 dependency nahi

**v2 — pan/zoom + fluid animations + glow (user request: "zoom nahi ho raha, static hai, lighting achi ho jaaye fluid"):**
- Mouse **scroll = zoom** (cursor-centered zoom)
- **Background drag = pan**
- **Node click = smooth animated zoom-in** (0.6s cubic-bezier transition) center pe le aata hai us node ko, saath mein connections isolate bhi hote hain
- **"Reset View" button** (toolbar mein) — wapas default zoom/pan pe le aata hai
- **Glow effect**: har node ke peeche ek blurred bada circle (`filter: blur(6px)`), hover/active pe `drop-shadow(currentColor)` se glow intensify hota hai — "fluid glassy" look
- Zoom % indicator bottom-left corner mein
- Sab transitions CSS-based smooth animations (edges/nodes ke opacity, stroke-width, filter sab transition karte hain)

**v3 — directional arrows (user request: "arrow nahi hai, kaun kisko import/output kar raha hai pata nahi chalta"):**
- SVG `<marker>` defs add kiye — arrowhead shapes, import ke liye blue, call ke liye orange, har ek ke 3 variants (`default`, `-active`, `-dim`) taaki jab node select ho to arrowheads bhi highlight/dim ho saath mein
- `computeEdgeEndpoints()` helper — line ka start/end point node ke radius ke hisaab se trim karta hai taaki **arrowhead circle ke andar chhupe nahi**, balki bilkul bahar tip pe dikhe
- Drag hone par bhi edges ke endpoints dynamically recompute hote hain (`refreshEdgesFor()`)
- Ab arrow **source → target** direction dikhata hai: `A ──→ B` ka matlab hai A, B ko import kar raha hai / B se data le raha hai

---

### 4️⃣ `extension.ts` update

`codemap-visualizer.generate` command ab ye poora flow chalata hai:
```
walkFolder → filterCodeFiles → parsePythonFile (har .py file pe) 
    → buildGraph (nodes+edges banata hai)
    → CodeMapPanel.createOrShow(graph)   ← naya, automatically visual panel khol deta hai
```
Popup message mein ab import-edges aur call-edges ka count bhi dikhta hai:
```
Done! Parsed 39 Python files. Found 75 functions, 176 imports, 54 import-edges, X call-edges.
```

---

## 📁 Current File Structure (updated)

```
codemap-visualizer/
├── src/
│   ├── extension.ts              ← updated (buildGraph + CodeMapPanel wire-up)
│   ├── scanner/
│   │   ├── scanner.ts            ← unchanged (walkFolder, filterCodeFiles)
│   │   └── graphBuilder.ts       ← NAYA (Phase 2 — nodes/edges JSON builder)
│   ├── parsers/
│   │   └── pythonParser.ts       ← bug-fixed (web-tree-sitter v0.26 import syntax)
│   └── webview/                  ← NAYA folder
│       └── panel.ts              ← NAYA (Phase 3 — 2D visual webview, v3)
├── grammars/
│   ├── web-tree-sitter.wasm
│   └── tree-sitter-python.wasm
├── package.json                  (web-tree-sitter: ^0.26.10, tree-sitter-python: ^0.25.0)
└── esbuild.js                    (external: ['vscode', 'web-tree-sitter'])
```

---

## ✅ Milestones achieved (updated list)

1. ✅ "Hello World" command
2. ✅ Phase 1 basic scanning (639 total files, 45 code files filtered)
3. ✅ Tree-sitter Python parsing bug fixed (39 Python files parse successfully — 75 functions, 176 imports)
4. ✅ Phase 2 — JSON graph builder (`nodes[]` + `edges[]`, 54 import-edges resolved correctly)
5. ✅ Phase 2.5 — cross-file function-call edges (`type: 'call'`) added to graph
6. ✅ Phase 3 v1 — basic interactive webview (click/hover/drag, force-directed layout)
7. ✅ Phase 3 v2 — pan/zoom, click-to-zoom animation, glow/lighting effects
8. ✅ Phase 3 v3 — directional arrowheads on edges (import vs call, radius-aware trimming)

---

## 🔮 Next steps (unchanged from original plan, reprioritized)

1. **JS/TS/JSX parsing** — abhi sirf Python scan hota hai; `frontend/` folder cover karne ke liye `tree-sitter-javascript`/`tree-sitter-typescript` grammars add karni hongi (same pattern jo Python parser mein use hua)
2. **Frontend↔Backend API call matching** — `fetch('/api/x')` ↔ `@app.post("/api/x")` pattern matching
3. **AI enrichment layer** — Claude API se har node ka `summary`/`category` field fill karna (abhi `null` hai)
4. Possible polish items on visualization: legend ko toggle-able banana, search/filter by filename, folder-based clustering/grouping in layout

---

## 🧑‍💻 Dev workflow reminders (unchanged)

- Edit code in Antigravity (ya kisi bhi editor) `codemap-visualizer/` folder ke andar
- Har `.ts` file change ke baad:
  ```bash
  npm run compile
  ```
- Test karne ke liye, **purani Extension Development Host window band karo**, phir:
  ```bash
  code --extensionDevelopmentPath="/home/tarun/Downloads/My projects/VS Code visualizer/codemap-visualizer"
  ```
- Naye window mein `iitmis-nl2vis` folder open karo, `Ctrl+Shift+P` → `Generate Codebase Map`
- Detailed console output (parsed JSON, Final Graph JSON) dekhne ke liye: `Ctrl+Shift+P` → `Developer: Toggle Developer Tools` → Console tab
- `package.json` engines field `"vscode": "^1.115.0"` — dusri machine pe move karte waqt `code --version` check karke adjust karna

---

## 🐛 UPDATE LOG (continued) — v4 aur v5 changes

### 5️⃣ Phase 3 v4 — Folder clustering layout (user request: "map messy hai, folder structure jaisa organized dikhe")

`panel.ts` mein physics simulation update hui:
- Har unique `folderPath` ke liye ek **anchor point** decide kiya gaya (root center mein, baaki folders ek circle mein uske around bikhre hue)
- Simulation mein ek naya **clustering force** add kiya — har file node apne folder ke anchor ki taraf khinchta hai, isliye same-folder files apne aap gather ho jaati hain
- Visual: har folder cluster ke peeche halka translucent background circle + folder ka naam label

Result: layout ab random nahi, balki folder-wise organized dikhta hai — lekin abhi bhi saari 39 files ek saath dikh rahi thi, jo dense/crowded lag sakta tha bade projects mein.

### 6️⃣ Phase 3 v5 — Drill-down folder/file view (user request: "pehle folder structure dikhe, click karke andar ki files dikhein, aur folder-level connections bhi dikhein")

Ye sabse bada UX change tha — poora `render()` function-based dynamic re-render architecture introduce kiya gaya:

**Default (collapsed) state:**
- Sirf **folder-level circles** dikhte hain — folder naam, file count, aur color-coded
- Folders ke beech **aggregated edges** — do folders ke beech jitni bhi file-to-file connections hain, unko count karke ek hi line draw hoti hai, jiski **thickness connection-count ke hisaab se scale** hoti hai
- Internal (same-folder) connections tab tak hidden rehte hain jab tak wo folder expand na ho

**Expand/collapse mechanism:**
- `expandedFolders` — ek `Set<string>` jo track karta hai konse folders abhi khule hain
- Folder circle pe click → `toggleFolder(f)` → us folder ko set mein add/remove karke `render()` dobara call hota hai
- Jab folder expand hota hai: uske circle ki jagah **individual file nodes** render hote hain (jo already physics simulation se positioned the), plus ek background halo + "click to collapse" label
- Edges dynamically recompute hoti hain based on current expand state:
  - Dono folders collapsed → **one aggregated line** (folder-to-folder)
  - Ek ya dono expanded → **individual file-to-file edges** (jaisa pehle tha, exact source/target ke saath)
  - Same-folder internal edges → sirf tab dikhte hain jab wo folder expand ho

**Key implementation detail:** `render()` function har baar `content` (`<g id="content">`) ka innerHTML clear karke poora graph (edges + folder-circles + file-nodes) dobara banata hai based on current `expandedFolders` state — isse UI hamesha consistent rehta hai, chahe kitni baar bhi expand/collapse karo.

**Baaki sab preserved:**
- Pan (drag background) / zoom (scroll) same
- File pe click → zoom + isolate connections (jaise pehle) — ab folder pehle se expanded hona chahiye tabhi file dikhegi aur click hogi
- Reset View button / empty-space click → sab folders collapse + selection clear + zoom reset
- Tooltips: folder pe hover karne se uske andar ki files ki list dikhti hai; file pe hover karne se function/import details (jaisa pehle tha)

---

## 📁 Current File Structure (v5, updated)

```
codemap-visualizer/
├── src/
│   ├── extension.ts              ← unchanged since v1 wiring (Phase 3 section)
│   ├── scanner/
│   │   ├── scanner.ts            ← unchanged
│   │   └── graphBuilder.ts       ← unchanged since Phase 2.5 (import + call edges)
│   ├── parsers/
│   │   └── pythonParser.ts       ← unchanged since bug-fix
│   └── webview/
│       └── panel.ts              ← v5: drill-down folder/file view (biggest file, most iterated)
├── grammars/
│   ├── web-tree-sitter.wasm
│   └── tree-sitter-python.wasm
├── package.json
└── esbuild.js
```

---

## ✅ Milestones achieved (updated, full list)

1. ✅ "Hello World" command
2. ✅ Phase 1 basic scanning (639 total files, 45 code files filtered)
3. ✅ Tree-sitter Python parsing bug fixed (39 Python files parse successfully — 75 functions, 176 imports)
4. ✅ Phase 2 — JSON graph builder (`nodes[]` + `edges[]`, 54 import-edges resolved correctly)
5. ✅ Phase 2.5 — cross-file function-call edges (`type: 'call'`) added to graph
6. ✅ Phase 3 v1 — basic interactive webview (click/hover/drag, force-directed layout)
7. ✅ Phase 3 v2 — pan/zoom, click-to-zoom animation, glow/lighting effects
8. ✅ Phase 3 v3 — directional arrowheads on edges (import vs call, radius-aware trimming)
9. ✅ Phase 3 v4 — folder-clustering physics (files grouped visually by folder)
10. ✅ Phase 3 v5 — drill-down folder/file view (collapsed folder overview by default, aggregated folder-edges, click-to-expand individual files)

---

## 🔮 Next steps (unchanged, still pending)

1. **JS/TS/JSX parsing** — abhi sirf Python scan hota hai; `frontend/` folder cover karne ke liye `tree-sitter-javascript`/`tree-sitter-typescript` grammars add karni hongi
2. **Frontend↔Backend API call matching** — `fetch('/api/x')` ↔ `@app.post("/api/x")` pattern matching
3. **AI enrichment layer** — Claude API se har node ka `summary`/`category` field fill karna (abhi `null` hai)
4. Possible polish: nested sub-folder support (abhi sirf ek level flat folder grouping hai, `pipeline/subfolder/` jaise deeper nesting collapse nahi hoti recursively), search/filter by filename, multi-folder simultaneous expand ka UX aur bhi refine karna

---

## 🐛 UPDATE LOG (continued) — v6: Horizontal execution-flow layout

### 7️⃣ Phase 3 v6 — Layered horizontal layout (user request: "center-based nahi, jaise code run hota hai — npm run se server.js, phir aage jaise jaise code jaata hai, horizontal style")

Poora layout paradigm badla gaya — folder-radial clustering aur folder drill-down (v4/v5) ki jagah ab ek **dependency-depth based horizontal flow** hai:

**Entry point detection:**
- Jo files **kisi ke bhi through import nahi hoti** (0 incoming import edges) unhe "entry point" mana jaata hai — real-world equivalent `main.py` / `server.js` / `extension.ts` jaisi files ke
- In files ko **Layer 0** mila (sabse left column), aur visually **gold ring** se highlight kiya gaya

**Layering algorithm:**
- Bellman-Ford-jaisa relaxation approach: har import edge ke liye, agar `layer[target] < layer[source] + 1`, to update karo. Ye process bounded iterations (`min(nodes.length, 60)`) tak repeat hota hai — import cycles hone par bhi safe hai (infinite loop nahi hota, kyunki iteration count fixed hai)
- Har node ka final layer = "entry point se kitne import-hops door hai" (uske saare "parents" mein se max)

**Layout:**
- Har layer apna vertical column hai (`x = 160 + layer * 260px`)
- Us layer ke andar nodes ko `folderPath + fileName` se sort karke evenly vertically spread kiya gaya (halka sa folder-grouping bhi implicitly ban jaata hai isse)
- Column ke top pe label ("Entry point", "Layer 1", "Layer 2"...) aur halki vertical divider line

**Kya hata (v4/v5 se):**
- Folder-radial clustering physics simulation (force-directed) hata diya — ab layout deterministic hai (layer-based), random physics nahi
- Folder collapse/expand drill-down feature (v5) bhi hata diya — abhi saari files hamesha visible hain, koi collapse nahi hota (conceptually flow-order aur folder-grouping dono ek saath complex ho jaate; future mein hybrid ban sakta hai agar chahiye)

**Kya same raha:**
- Import (solid blue) vs call (dashed orange) edges, arrows, radius-aware trimming
- Click node → isolate connections + smooth zoom
- Hover tooltip (ab layer number bhi dikhta hai)
- Pan (drag background) / scroll to zoom
- Node drag to reposition
- Reset View button
- Color-by-folder (bas ab folders "cluster" nahi karte, sirf color-coding ke liye reh gaye)

---

## 📁 Current File Structure (v6, updated)

```
codemap-visualizer/
├── src/
│   ├── extension.ts              ← unchanged
│   ├── scanner/
│   │   ├── scanner.ts            ← unchanged
│   │   └── graphBuilder.ts       ← unchanged
│   ├── parsers/
│   │   └── pythonParser.ts       ← unchanged
│   └── webview/
│       └── panel.ts              ← v6: horizontal layered execution-flow layout
├── grammars/
├── package.json
└── esbuild.js
```

---

## ✅ Milestones achieved (updated, full list)

1. ✅ "Hello World" command
2. ✅ Phase 1 basic scanning (639 total files, 45 code files filtered)
3. ✅ Tree-sitter Python parsing bug fixed
4. ✅ Phase 2 — JSON graph builder (import edges)
5. ✅ Phase 2.5 — cross-file function-call edges
6. ✅ Phase 3 v1 — basic interactive webview
7. ✅ Phase 3 v2 — pan/zoom, click-to-zoom animation, glow/lighting
8. ✅ Phase 3 v3 — directional arrowheads
9. ✅ Phase 3 v4 — folder-clustering physics (superseded by v6)
10. ✅ Phase 3 v5 — drill-down folder/file view (superseded by v6)
11. ✅ Phase 3 v6 — **horizontal execution-flow layout** (entry-point detection, layered dependency-depth positioning) — current active version

---

## 🔮 Next steps (updated)

1. ✅ ~~**JS/TS/JSX parsing**~~ — **DONE** (`jstsParser.ts` + wasm grammars)
2. **Frontend↔Backend API call matching** — `fetch('/api/x')` ↔ `@app.post("/api/x")` pattern matching
3. **AI enrichment layer** — Claude API se har node ka `summary`/`category` fill karna (abhi `null` hai)
4. Possible polish: agar layer ke andar bahut zyada files ho jaayein (dense column) to unko sub-group/scroll karna; multiple entry points ko better visually distinguish karna

---

## 🐛 UPDATE LOG (continued) — v7: Hybrid — folder grouping bands inside horizontal flow

### 8️⃣ Phase 3 v7 (user request: "horizontal flow sahi hai, lekin isme folder structure bhi implement kar sakte ho kya?")

v6 ka horizontal execution-flow layout **as-is rakha** (koi layering logic change nahi hua) — bas ek visual addition:

- Har layer/column ke andar, files pehle se `folderPath + fileName` se sorted thi (v6 mein), isliye same-folder files already ek doosre ke paas (contiguous) hoti hain
- Ab har aise **contiguous same-folder run** ke peeche ek halka **colored background band** (rounded rectangle, folder ke color se match karta stroke/fill) draw hota hai
- Band ke upar **folder ka naam label** (chhota text, folder color mein)

Isse **dono cheezein ek saath dikhti hain**: overall diagram left-to-right execution order follow karta hai (entry point → deeper imports), aur har column ke andar tumhe saaf pata chalta hai ki kaunsi files kis folder (`model/`, `pipeline/`, `testing/`, etc.) se belong karti hain — bina flow-order disturb kiye.

**Implementation detail:** `layerGroups[l]` array (already sorted) ko iterate karke consecutive same-`folderPath` runs dhoonde jaate hain, har run ke `y` range (min/max node position + padding) ke around ek `<rect>` aur `<text>` label draw hota hai — layer headers ke turant baad, edges/nodes se pehle (taaki bands sabse peeche render hon, z-order sahi rahe).

**Koi structural change nahi hua** — layering algorithm, entry-point detection, pan/zoom, click-isolate, tooltip, drag — sab v6 jaisa hi hai. Sirf visual grouping overlay add hui.

---

## ✅ Milestones achieved (updated, full list)

1. ✅ "Hello World" command
2. ✅ Phase 1 basic scanning
3. ✅ Tree-sitter Python parsing bug fixed
4. ✅ Phase 2 — JSON graph builder (import edges)
5. ✅ Phase 2.5 — cross-file function-call edges
6. ✅ Phase 3 v1 — basic interactive webview
7. ✅ Phase 3 v2 — pan/zoom, click-to-zoom animation, glow/lighting
8. ✅ Phase 3 v3 — directional arrowheads
9. ✅ Phase 3 v4 — folder-clustering physics (superseded)
10. ✅ Phase 3 v5 — drill-down folder/file view (superseded)
11. ✅ Phase 3 v6 — horizontal execution-flow layout (entry-point detection, layered dependency-depth positioning)
12. ✅ Phase 3 v7 — **hybrid: folder-grouping bands inside the horizontal flow** — current active version
13. ✅ **Ctrl+Click to open file** — node pe Ctrl+Click karo, file VS Code mein khul jaati hai (`vscode.postMessage` → `openTextDocument`) — dblclick hata diya, click = isolate, Ctrl+Click = open
14. ✅ **JS/TS/JSX/TSX parsing** — `src/parsers/jstsParser.ts` (naya file); ES module imports, CommonJS require(), arrow functions, class methods, exports sab cover; `tree-sitter-javascript.wasm` + `tree-sitter-typescript.wasm` grammars folder mein add kiye; `extension.ts` updated to parse all 4 language types

---

## 🐛 UPDATE LOG (continued) — JS/TS/JSX/TSX parsing + Ctrl+Click

### 9️⃣ Ctrl+Click to open file (panel.ts fix)

**Problem:** `dblclick` event kaam nahi kar raha tha (drag ke saath conflict, aur `acquireVsCodeApi()` multiple call issue).

**Fix:**
- `dblclick` listener hata diya completely
- `click` listener mein `ev.ctrlKey || ev.metaKey` check add kiya
- **Normal click** = isolate + zoom (purana behaviour)
- **Ctrl+Click** = `vscode.postMessage({ command: 'openFile', fileId: n.id })` → file VS Code mein khulti hai beside panel
- Toolbar aur tooltip hint bhi update: "Ctrl+Click = open file"

### 🔟 JS/TS/JSX/TSX Parsing — `src/parsers/jstsParser.ts` (NAYA FILE)

**Wasm files add kiye** (`grammars/` folder mein):
- `tree-sitter-javascript.wasm` (351KB)
- `tree-sitter-typescript.wasm` (1.4MB)

**`jstsParser.ts` kya parse karta hai:**
- `import { x } from 'y'` — ES module imports (named, default, namespace)
- `const x = require('y')` — CommonJS require()
- `function foo() {}` — function declarations
- `const foo = () => {}` / `const foo = function() {}` — arrow + anonymous functions
- `class` ke andar `method()` — method definitions
- `export { x }` / `export default` / `export function` — exports track

**`extension.ts` update:**
- Ab `.py`, `.js`, `.jsx`, `.ts`, `.tsx` — sab parse hote hain
- Progress message mein teeno counts dikhte hain: `Parsed X py, Y js, Z ts files`

## 📁 Current File Structure (v8, updated)

```
codemap-visualizer/
├── src/
│   ├── extension.ts              ← updated (JS/TS/JSX/TSX parsing added)
│   ├── scanner/
│   │   ├── scanner.ts            ← unchanged
│   │   └── graphBuilder.ts       ← unchanged
│   ├── parsers/
│   │   ├── pythonParser.ts       ← unchanged since bug-fix
│   │   └── jstsParser.ts         ← NAYA (JS/TS/JSX/TSX parser)
│   └── webview/
│       └── panel.ts              ← v7 + Ctrl+Click to open file
├── grammars/
│   ├── web-tree-sitter.wasm
│   ├── tree-sitter-python.wasm
│   ├── tree-sitter-javascript.wasm  ← NAYA
│   └── tree-sitter-typescript.wasm  ← NAYA
├── package.json
└── esbuild.js
```

## 🔮 Next steps (current)

1. ✅ ~~JS/TS/JSX/TSX parsing~~ — DONE
2. ✅ ~~Ctrl+Click to open file~~ — DONE
3. **Frontend↔Backend API call matching** — `fetch('/api/x')` ↔ `@app.post("/api/x")` pattern matching
4. **AI enrichment layer** — Claude API se har node ka `summary`/`category` fill karna
5. **graphBuilder.ts update** — JS/TS module resolution (`./utils` → `utils.ts`, relative path resolve)

---

## 🐛 UPDATE LOG (continued) — Arrow direction fix + JS/TS edge resolution

### 1️⃣1️⃣ graphBuilder.ts — JS/TS relative import resolution

**Problem:** JS/TS files graph mein dikh rahi theen lekin unke beech **koi connections (edges) nahi** aa rahe the — kyunki `graphBuilder.ts` sirf Python module resolution jaanta tha (`model.sql` → `model/sql.py`).

**Fix:** `resolveJsTsModule()` function add kiya:
- Sirf relative imports resolve karta hai (`./utils`, `../components/App`) — npm packages (`react`, `express`) skip
- `sourceFileId` ke relative `path.dirname` se resolve karta hai
- Candidates try karta hai: `.ts`, `.tsx`, `.js`, `.jsx`, `/index.ts`, `/index.tsx`, `/index.js`, `/index.jsx`

`buildImportEdges()` aur `buildCallEdges()` dono mein Python resolution ke baad JS/TS resolution fallback add kiya.

**File changed:** `src/scanner/graphBuilder.ts`

### 1️⃣2️⃣ panel.ts — Arrow direction fix (data flow direction)

**Problem:** Arrows galat direction mein the — `A → B` matlab "A imports B" (arrowhead B pe), lekin user ka expected behavior tha ki arrowhead us file pe ho **jo data receive karti hai** (caller/importer), tail us file pe jo data deti hai.

**Expected:**
```
B (data provider) ——→ A (data receiver / importer)
```

**Fix:** `computeEdgeEndpoints()` function mein `source` aur `target` swap kiya:
- `dx/dy` calculation mein `e.t - e.s` ki jagah `e.s - e.t` kiya
- `rSource` ab `e.t.id` se, `rTarget` ab `e.s.id` se
- `x1/y1` ab `e.t` se start, `x2/y2` ab `e.s` pe end

**File changed:** `src/webview/panel.ts`

## ✅ Milestones achieved (updated, full list)

1. ✅ "Hello World" command
2. ✅ Phase 1 basic scanning
3. ✅ Tree-sitter Python parsing bug fixed
4. ✅ Phase 2 — JSON graph builder (import edges)
5. ✅ Phase 2.5 — cross-file function-call edges
6. ✅ Phase 3 v1 — basic interactive webview
7. ✅ Phase 3 v2 — pan/zoom, click-to-zoom animation, glow/lighting
8. ✅ Phase 3 v3 — directional arrowheads
9. ✅ Phase 3 v4 — folder-clustering physics (superseded)
10. ✅ Phase 3 v5 — drill-down folder/file view (superseded)
11. ✅ Phase 3 v6 — horizontal execution-flow layout
12. ✅ Phase 3 v7 — folder-grouping bands inside horizontal flow
13. ✅ Ctrl+Click to open file in VS Code
14. ✅ JS/TS/JSX/TSX parsing — `jstsParser.ts` + wasm grammars
15. ✅ JS/TS relative import resolution in `graphBuilder.ts`
16. ✅ Arrow direction fixed — arrowhead on data receiver (importer), tail on data provider

## 🔮 Next steps (current)

1. ✅ ~~JS/TS/JSX/TSX parsing~~ — DONE
2. ✅ ~~Ctrl+Click to open file~~ — DONE
3. ✅ ~~Arrow direction fix~~ — DONE
4. ✅ ~~JS/TS edge resolution~~ — DONE
5. **AI enrichment layer** — Claude API se har node ka `summary`/`category` fill karna
6. **Frontend↔Backend API call matching** — `fetch('/api/x')` ↔ `@app.post("/api/x")`
7. **Visualization polish** — dense graphs mein overlapping nodes fix, better layout

---

## 🐛 UPDATE LOG (continued) — v8: Nested folder boxes + layout overhaul

### 1️⃣3️⃣ Phase 3 v8 — Proper nested folder box layout (current active version)

**What changed (3 separate iterations in this session):**

#### Iteration A — Nested folder boxes (recursive draw)

Pehle saari folders flat boxes thi (sab siblings). Ab:
- `drawFolderBox(fp)` recursive function — child folders **inside** parent box render hoti hain
- `folderChildren(fp)` se direct children milte hain, recursively draw hote hain
- Depth-based styling:
  - Top-level box: solid border (`stroke-width: 1.5`), `fill-opacity: 0.07`, rounded corners `rx:10`
  - Child box: dashed border (`stroke-dasharray: 4,3`), `fill-opacity: 0.05`, tighter corners `rx:7`
- **Chevron** `▼`/`▶` added har box ke label ke peeche — collapse state indicate karta hai
- **Folder label** ab sirf last path segment dikhata hai (`src/components` → `components`)
- `folderEls[fp]` mein ab `chevron` field bhi store hoti hai

#### Iteration B — Horizontal child layout + size fix

**Problem:** Children vertically stack ho rahe the (ek ke neeche ek), parent box mein zyada empty space tha.

**Fix:**
- `computeFboxSize()` bottom-up: children ki total width = sum of child widths + gaps
- `positionFbox()` top-down: children **horizontally side-by-side** place hote hain, files below
- Parent box width = `max(children_row_width, files_width) + FPAD*2`
- Parent box height = `LABEL_H + FPAD + children_height + CHILD_PAD + files_height + FPAD`
- Files mein 2-column layout added (6+ files hone par)
- Height recalculation after positioning to prevent overflow

#### Iteration C — Root cause fix: two-pass layout + ROOT_FP

**Root causes:**
1. `'(root)'` naam — project ka actual naam nahi tha
2. Items box se bahar — grid pre-computed heights use karta tha, actual post-positioning heights nahi
3. `topFolders` logic galat — `src`, `model` etc. alag top-level boxes the instead of nested

**Fixes (final, current version):**

**`ROOT_FP = graph.projectName`** — empty `folderPath` wale nodes ab `ROOT_FP` se normalise hote hain. `n.folderPath` in-place set hota hai taaki edge anchoring, collapse, aur tooltips sab consistent rahein.

**`topFolders` logic:**
```
rootHasFiles = (folderMap[ROOT_FP] || []).length > 0

if rootHasFiles:
    topFolders = [ROOT_FP]          ← one big project box, subfolders nest inside
else:
    topFolders = direct children of ROOT_FP   ← skip empty root wrapper
```

**Two-pass layout (proper bottom-up → top-down):**
```
Pass 1 — computeFboxSize(fp, depth):
  → children recurse first
  → childRowW = sum of child widths + gaps
  → filesH = files * (nodeH + NODE_GAP_Y)
  → bw = max(childRowW, filesW) + FPAD*2
  → bh = LABEL_H + FPAD + max(childRowH + filesH) + FPAD
  → stored in fboxes[fp]

Pass 2 — positionFbox(fp, startX, startY) → returns actual bottom Y:
  → places child boxes horizontally (positionFbox recursively)
  → childBottom = max of all children's returned bottom Y
  → places files below childBottom
  → fb.h = actual contentBottom + FPAD - startY   ← REAL height, not estimate
  → fb.origH = fb.h
  → returns startY + fb.h   ← parent uses this to know true bottom

Grid layout:
  → first run positionFbox at dummy origin to learn real sizes
  → build colW[], rowH[] from actual fboxes[fp].h
  → second run positionFbox at correct grid coords
```

**Why this fixes the overflow:** Previously `computeFboxSize` guessed a height, grid used that guess, `positionFbox` updated height locally but grid coords were already set wrong. Now grid coords come from measured reality.

**Constants used:**
```
FPAD=16, FGAP_X=60, FGAP_Y=50
NODE_GAP_Y=8, NODE_GAP_X=14, CHILD_PAD=14, LABEL_H=24
```

---

## 📁 Current File Structure (v8, updated)

```
codemap-visualizer/
├── src/
│   ├── extension.ts              ← unchanged
│   ├── scanner/
│   │   ├── scanner.ts            ← unchanged
│   │   └── graphBuilder.ts       ← JS/TS resolution added (session before this)
│   ├── parsers/
│   │   ├── pythonParser.ts       ← unchanged since bug-fix
│   │   ├── jstsParser.ts         ← JS/TS/JSX/TSX parser
│   │   ├── cssParser.ts          ← CSS/SCSS/LESS parser
│   │   ├── envParser.ts          ← .env parser
│   │   └── dbParser.ts           ← SQL/Prisma/ORM parser
│   └── webview/
│       └── panel.ts              ← v8: nested folder boxes, two-pass layout, ROOT_FP
├── grammars/
│   ├── web-tree-sitter.wasm
│   ├── tree-sitter-python.wasm
│   ├── tree-sitter-javascript.wasm
│   └── tree-sitter-typescript.wasm
├── package.json
└── esbuild.js
```

---

## ✅ Milestones achieved (full list, current)

1. ✅ "Hello World" command
2. ✅ Phase 1 basic scanning
3. ✅ Tree-sitter Python parsing bug fixed
4. ✅ Phase 2 — JSON graph builder (import + call edges)
5. ✅ Phase 3 v1 — basic interactive webview
6. ✅ Phase 3 v2 — pan/zoom, glow/lighting
7. ✅ Phase 3 v3 — directional arrowheads
8. ✅ Phase 3 v4/v5 — folder clustering + drill-down (superseded)
9. ✅ Phase 3 v6 — horizontal execution-flow layout (entry-point detection)
10. ✅ Phase 3 v7 — folder-grouping bands inside horizontal flow
11. ✅ Ctrl+Click to open file in VS Code
12. ✅ JS/TS/JSX/TSX parsing (`jstsParser.ts`)
13. ✅ JS/TS relative import resolution in `graphBuilder.ts`
14. ✅ Arrow direction fixed
15. ✅ CSS / ENV / DB file support with dedicated sections + colored edges
16. ✅ Entry point detection (gold border), unused file detection (red)
17. ✅ Rich tooltips for nodes, edges, folders, CSS/ENV/DB nodes
18. ✅ **Phase 3 v8 — Nested folder boxes, two-pass layout, ROOT_FP normalisation** ← CURRENT

---

## 🔮 Next steps

1. **Visualization polish** — test on real projects, fix any remaining layout edge cases
2. **AI enrichment layer** — Claude API se har node ka `summary`/`category` fill karna
3. **Frontend↔Backend API call matching** — `fetch('/api/x')` ↔ `@app.post("/api/x")`
