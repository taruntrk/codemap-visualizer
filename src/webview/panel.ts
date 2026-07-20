import * as vscode from 'vscode';
import * as path from 'path';
import { CodeGraph } from '../scanner/graphBuilder';

export class CodeMapPanel {
    public static currentPanel: CodeMapPanel | undefined;
    private readonly panel: vscode.WebviewPanel;
    private disposables: vscode.Disposable[] = [];

    public static createOrShow(graph: CodeGraph, rootPath: string) {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        if (CodeMapPanel.currentPanel) {
            CodeMapPanel.currentPanel.panel.reveal(column);
            CodeMapPanel.currentPanel.update(graph);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'codemapVisualizer',
            'CodeMap Visualizer',
            column || vscode.ViewColumn.One,
            { enableScripts: true, retainContextWhenHidden: true }
        );

        CodeMapPanel.currentPanel = new CodeMapPanel(panel, graph, rootPath);
    }

    private constructor(
        panel: vscode.WebviewPanel,
        graph: CodeGraph,
        private readonly rootPath: string
    ) {
        this.panel = panel;
        this.update(graph);
        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

        this.panel.webview.onDidReceiveMessage(
            async (message) => {
                if (message.command === 'openFile') {
                    try {
                        const fullPath = path.join(this.rootPath, message.fileId);
                        const uri = vscode.Uri.file(fullPath);
                        const doc = await vscode.workspace.openTextDocument(uri);
                        await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
                    } catch (_err) {
                        vscode.window.showErrorMessage(`Could not open file: ${message.fileId}`);
                    }
                }
            },
            null,
            this.disposables
        );
    }

    private update(graph: CodeGraph) {
        this.panel.title = `CodeMap: ${graph.projectName}`;
        this.panel.webview.html = this.getHtml(graph);
    }

    private dispose() {
        CodeMapPanel.currentPanel = undefined;
        this.panel.dispose();
        while (this.disposables.length) {
            const d = this.disposables.pop();
            if (d) { d.dispose(); }
        }
    }

    private getHtml(graph: CodeGraph): string {
        const graphJson = JSON.stringify(graph).replace(/</g, '\\u003c');
        return buildHtml(graphJson);
    }
}

function buildHtml(graphJson: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<style>
${getCss()}
</style>
</head>
<body>
${getToolbar()}
<div id="tooltip"></div>
<div id="zoomLabel">100%</div>
<svg id="graph">
${getSvgDefs()}
  <g id="viewport"></g>
</svg>
<script>
${getJs1(graphJson)}
${getJs2()}
${getJs3()}
${getJs4()}
</script>
</body>
</html>`;
}

function getCss(): string {
    return `
html, body {
  margin:0; padding:0; height:100%; overflow:hidden;
  font-family: -apple-system, sans-serif; color:#ddd;
  background: radial-gradient(circle at 50% 40%, #1e1e2e 0%, #111118 80%);
}
#toolbar {
  position:fixed; top:10px; left:10px; z-index:10;
  background:rgba(30,30,46,0.92); backdrop-filter:blur(8px);
  padding:8px 14px; border-radius:10px; font-size:12px;
  border:1px solid #3c3c5a; max-width:500px; line-height:1.7;
}
.legend-dot { display:inline-block; width:10px; height:10px; border-radius:50%; margin-right:5px; vertical-align:middle; }
.legend-line { display:inline-block; width:18px; height:0; border-top:2px solid; margin-right:6px; vertical-align:middle; }
#resetBtn {
  margin-top:6px; background:#0e639c; border:none; color:#fff;
  padding:4px 12px; border-radius:5px; cursor:pointer; font-size:11px;
}
#resetBtn:hover { background:#1177bb; }
#breadcrumb {
  display:none; align-items:center; gap:6px;
  margin-bottom:4px; font-size:12px;
}
#breadcrumb.visible { display:flex; }
#backBtn {
  background:#3c3c5a; border:none; color:#9cdcfe;
  padding:3px 10px; border-radius:5px; cursor:pointer; font-size:11px;
  display:flex; align-items:center; gap:4px;
}
#backBtn:hover { background:#4c4c7a; }
#breadcrumbPath { color:#ddd; opacity:0.8; font-size:11px; }
#folderViewLabel { color:#4ec9b0; font-weight:700; font-size:12px; }
svg { width:100vw; height:100vh; display:block; cursor:grab; }
#viewport.animate { transition:transform 0.55s cubic-bezier(0.22,1,0.36,1); }

/* folder boxes */
.folder-box { fill:none; stroke-width:1.5px; opacity:0.6; pointer-events:none;
  transition:opacity 0.35s, filter 0.35s; }
.folder-box.active { opacity:0.9; filter:drop-shadow(0 0 10px currentColor); }
.folder-box.dim { opacity:0.06; }
.folder-label { font-size:11px; font-weight:700; pointer-events:none; opacity:0.8;
  transition:opacity 0.35s; }
.folder-label.dim { opacity:0.08; }

/* summary boxes (external folders in folder-view mode) */
.summary-box { opacity:0.7; transition:opacity 0.3s; }
.summary-box:hover { opacity:1; filter:drop-shadow(0 0 6px currentColor); }
.summary-box.dim { opacity:0.05; }
.summary-label { font-size:10px; font-weight:700; pointer-events:none; }

/* file nodes */
.node rect.core {
  rx:4; ry:4; stroke:#ffffff44; stroke-width:1px; cursor:pointer;
  transition: filter 0.2s, stroke-width 0.2s;
}
.node:hover rect.core { filter:drop-shadow(0 0 7px var(--nc)); stroke:#ffffffaa; }
.node.active rect.core { stroke-width:2px; filter:drop-shadow(0 0 14px var(--nc)); }
.node.dim { opacity:0.05; transition:opacity 0.4s; }
.node { transition:opacity 0.4s; }
.node.entry rect.core { stroke:#ffd700; stroke-width:2px; }
.node.unused rect.core { fill:#6e6e6e22 !important; stroke:#6e6e6e !important; stroke-width:0.6px !important; opacity:0.7; }
.node.unused text { fill:#aaaaaa; }
.node text { fill:#e0e0e0; font-size:11px; pointer-events:none; }

/* folder-to-folder edges */
.f2f-edge { fill:none; stroke-width:2px; opacity:0.35;
  transition:opacity 0.4s, filter 0.4s, stroke-width 0.4s; }
.f2f-edge.active { opacity:0.9; filter:drop-shadow(0 0 6px currentColor); stroke-width:3px; }
.f2f-edge.dim { opacity:0.03; }

/* file edges — thin & faded by default so folder boxes stay readable */
.edge-import { stroke:#569cd6; stroke-width:1px; opacity:0.22; fill:none;
  transition:opacity 0.3s,stroke-width 0.3s,filter 0.3s; }
.edge-call   { stroke:#ce9178; stroke-width:0.8px; stroke-dasharray:5,3; opacity:0.18; fill:none;
  transition:opacity 0.3s,stroke-width 0.3s,filter 0.3s; }
.edge-import.active { stroke-width:2px; opacity:1; filter:drop-shadow(0 0 5px #569cd6); }
.edge-call.active   { stroke-width:1.6px; opacity:1; filter:drop-shadow(0 0 5px #ce9178); }
.edge-import.dim, .edge-call.dim { opacity:0.03; }

/* special edges */
.edge-css-import { stroke:#c586c0; stroke-width:0.8px; stroke-dasharray:5,3; opacity:0.4; fill:none;
  transition:opacity 0.4s,stroke-width 0.4s; }
.edge-env-use    { stroke:#dcdcaa; stroke-width:0.8px; stroke-dasharray:3,3; opacity:0.4; fill:none;
  transition:opacity 0.4s,stroke-width 0.4s; }
.edge-db-use     { stroke:#4ec9b0; stroke-width:1px; opacity:0.45; fill:none;
  transition:opacity 0.4s,stroke-width 0.4s; }
.edge-api-call   { stroke:#f0a; stroke-width:1.2px; stroke-dasharray:6,3; opacity:0.55; fill:none;
  transition:opacity 0.4s,stroke-width 0.4s,filter 0.4s; }
.edge-css-import.active { stroke-width:1.6px; opacity:0.9; filter:drop-shadow(0 0 4px #c586c0); }
.edge-env-use.active    { stroke-width:1.6px; opacity:0.9; filter:drop-shadow(0 0 4px #dcdcaa); }
.edge-db-use.active     { stroke-width:2px; opacity:0.95; filter:drop-shadow(0 0 5px #4ec9b0); }
.edge-api-call.active   { stroke-width:2.2px; opacity:1; filter:drop-shadow(0 0 6px #f0a); }
.edge-css-import.dim, .edge-env-use.dim, .edge-db-use.dim, .edge-api-call.dim { opacity:0.03; }

/* special nodes */
.special-node rect.core { stroke-width:1.5px !important; }
.special-node text { fill:#e0e0e0; font-size:10px; pointer-events:none; }

/* tooltip */
#tooltip {
  position:fixed; pointer-events:none; background:rgba(30,30,46,0.97);
  border:1px solid #4c4c7a; padding:8px 12px; border-radius:8px;
  font-size:12px; max-width:340px; display:none; z-index:20;
  box-shadow:0 4px 20px rgba(0,0,0,0.7); line-height:1.6;
}
#tooltip b   { color:#4fc1ff; }
#tooltip .fn { color:#9cdcfe; }
#tooltip .mt { opacity:0.6; font-size:11px; }
#tooltip .hint { color:#b5cea8; font-style:italic; margin-top:4px; font-size:11px; }
#zoomLabel { position:fixed; bottom:8px; left:10px; font-size:11px; opacity:0.45; z-index:10; }
`;
}

function getToolbar(): string {
    return `
<div id="toolbar">
  <div id="breadcrumb">
    <button id="backBtn">&#8592; Back</button>
    <span id="breadcrumbPath">&#128196; Root</span>
    <span>&#9656;</span>
    <span id="folderViewLabel"></span>
  </div>
  <div id="legendRow1">
    <span class="legend-dot" style="background:#ffd700;border:1px solid #ffd700"></span><b>Gold</b> = entry &nbsp;
    <span class="legend-dot" style="background:#6e6e6e;opacity:0.6"></span><b style="color:#aaaaaa">Gray</b> = unused &nbsp;
    <span class="legend-dot" style="background:#c586c0"></span>CSS &nbsp;
    <span class="legend-dot" style="background:#dcdcaa"></span>ENV &nbsp;
    <span class="legend-dot" style="background:#4ec9b0"></span>DB
  </div>
  <div id="legendRow2">
    <span class="legend-line" style="border-color:#569cd6"></span>Import &nbsp;
    <span class="legend-line" style="border-color:#ce9178;border-style:dashed"></span>Call &nbsp;
    <span class="legend-line" style="border-color:#ff00aa;border-style:dashed"></span><b style="color:#ff66cc">API</b> &nbsp;
    <span class="legend-line" style="border-color:#4ec9b0"></span>DB use &nbsp;
    <span class="legend-line" style="border-color:#dcdcaa;border-style:dashed"></span>Env use
  </div>
  <div id="hintRow" style="opacity:0.6;font-size:11px;">
    Click = isolate &middot; <b>Dbl-click folder</b> = deep-dive &middot; <b>Ctrl+Click</b> = open file &middot; Drag &middot; Scroll = zoom
  </div>
  <button id="resetBtn">&#8635; Reset View</button>
</div>`;
}

function getSvgDefs(): string {
    return `  <defs>
    <marker id="dot-import"     viewBox="0 0 10 10" refX="5" refY="5" markerWidth="4" markerHeight="4" orient="auto"><circle cx="5" cy="5" r="3.5" fill="#569cd6"/></marker>
    <marker id="dot-import-act" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="5" markerHeight="5" orient="auto"><circle cx="5" cy="5" r="3.5" fill="#9cdcfe"/></marker>
    <marker id="dot-import-dim" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="4" markerHeight="4" orient="auto"><circle cx="5" cy="5" r="3.5" fill="#569cd6" opacity="0.08"/></marker>
    <marker id="dot-call"       viewBox="0 0 10 10" refX="5" refY="5" markerWidth="3" markerHeight="3" orient="auto"><circle cx="5" cy="5" r="3.5" fill="#ce9178"/></marker>
    <marker id="dot-call-act"   viewBox="0 0 10 10" refX="5" refY="5" markerWidth="4" markerHeight="4" orient="auto"><circle cx="5" cy="5" r="3.5" fill="#ffc4a3"/></marker>
    <marker id="dot-call-dim"   viewBox="0 0 10 10" refX="5" refY="5" markerWidth="3" markerHeight="3" orient="auto"><circle cx="5" cy="5" r="3.5" fill="#ce9178" opacity="0.08"/></marker>
    <marker id="dot-f2f"        viewBox="0 0 10 10" refX="5" refY="5" markerWidth="5" markerHeight="5" orient="auto"><circle cx="5" cy="5" r="3.5" fill="#aaaaaa"/></marker>
    <marker id="dot-f2f-act"    viewBox="0 0 10 10" refX="5" refY="5" markerWidth="6" markerHeight="6" orient="auto"><circle cx="5" cy="5" r="3.5" fill="#ffffff"/></marker>
    <marker id="dot-f2f-dim"    viewBox="0 0 10 10" refX="5" refY="5" markerWidth="4" markerHeight="4" orient="auto"><circle cx="5" cy="5" r="3.5" fill="#aaaaaa" opacity="0.08"/></marker>
    <marker id="dot-css"        viewBox="0 0 10 10" refX="5" refY="5" markerWidth="4" markerHeight="4" orient="auto"><circle cx="5" cy="5" r="3.5" fill="#c586c0"/></marker>
    <marker id="dot-env"        viewBox="0 0 10 10" refX="5" refY="5" markerWidth="4" markerHeight="4" orient="auto"><circle cx="5" cy="5" r="3.5" fill="#dcdcaa"/></marker>
    <marker id="dot-db"         viewBox="0 0 10 10" refX="5" refY="5" markerWidth="4" markerHeight="4" orient="auto"><circle cx="5" cy="5" r="3.5" fill="#4ec9b0"/></marker>
    <marker id="arr-import"     viewBox="0 0 10 10" refX="9" refY="5" markerWidth="4"  markerHeight="4"  orient="auto"><path d="M0,0 L10,5 L0,10z" fill="#569cd6"/></marker>
    <marker id="arr-import-act" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5"  markerHeight="5"  orient="auto"><path d="M0,0 L10,5 L0,10z" fill="#9cdcfe"/></marker>
    <marker id="arr-import-dim" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="4"  markerHeight="4"  orient="auto"><path d="M0,0 L10,5 L0,10z" fill="#569cd6" opacity="0.08"/></marker>
    <marker id="arr-call"       viewBox="0 0 10 10" refX="9" refY="5" markerWidth="3"  markerHeight="3"  orient="auto"><path d="M0,0 L10,5 L0,10z" fill="#ce9178"/></marker>
    <marker id="arr-call-act"   viewBox="0 0 10 10" refX="9" refY="5" markerWidth="4"  markerHeight="4"  orient="auto"><path d="M0,0 L10,5 L0,10z" fill="#ffc4a3"/></marker>
    <marker id="arr-call-dim"   viewBox="0 0 10 10" refX="9" refY="5" markerWidth="3"  markerHeight="3"  orient="auto"><path d="M0,0 L10,5 L0,10z" fill="#ce9178" opacity="0.08"/></marker>
    <marker id="arr-f2f"        viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5"  markerHeight="5"  orient="auto"><path d="M0,0 L10,5 L0,10z" fill="#aaaaaa"/></marker>
    <marker id="arr-f2f-act"    viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6"  markerHeight="6"  orient="auto"><path d="M0,0 L10,5 L0,10z" fill="#ffffff"/></marker>
    <marker id="arr-f2f-dim"    viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5"  markerHeight="5"  orient="auto"><path d="M0,0 L10,5 L0,10z" fill="#aaaaaa" opacity="0.08"/></marker>
    <marker id="arr-css"        viewBox="0 0 10 10" refX="9" refY="5" markerWidth="4"  markerHeight="4"  orient="auto"><path d="M0,0 L10,5 L0,10z" fill="#c586c0"/></marker>
    <marker id="arr-env"        viewBox="0 0 10 10" refX="9" refY="5" markerWidth="4"  markerHeight="4"  orient="auto"><path d="M0,0 L10,5 L0,10z" fill="#dcdcaa"/></marker>
    <marker id="arr-db"         viewBox="0 0 10 10" refX="9" refY="5" markerWidth="4"  markerHeight="4"  orient="auto"><path d="M0,0 L10,5 L0,10z" fill="#4ec9b0"/></marker>
    <marker id="dot-api"        viewBox="0 0 10 10" refX="5" refY="5" markerWidth="4" markerHeight="4" orient="auto"><circle cx="5" cy="5" r="3.5" fill="#ff00aa"/></marker>
    <marker id="arr-api"        viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5"  markerHeight="5"  orient="auto"><path d="M0,0 L10,5 L0,10z" fill="#ff00aa"/></marker>
    <marker id="arr-api-act"    viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6"  markerHeight="6"  orient="auto"><path d="M0,0 L10,5 L0,10z" fill="#ff66cc"/></marker>
    <marker id="arr-api-dim"    viewBox="0 0 10 10" refX="9" refY="5" markerWidth="4"  markerHeight="4"  orient="auto"><path d="M0,0 L10,5 L0,10z" fill="#ff00aa" opacity="0.08"/></marker>
    <marker id="dot-api-act"    viewBox="0 0 10 10" refX="5" refY="5" markerWidth="5" markerHeight="5" orient="auto"><circle cx="5" cy="5" r="3.5" fill="#ff66cc"/></marker>
    <marker id="dot-api-dim"    viewBox="0 0 10 10" refX="5" refY="5" markerWidth="4" markerHeight="4" orient="auto"><circle cx="5" cy="5" r="3.5" fill="#ff00aa" opacity="0.08"/></marker>
  </defs>`;
}

function getJs1(graphJson: string): string {
    return `
const graph = ${graphJson};
const vsapi = acquireVsCodeApi();
const svg   = document.getElementById('graph');
const vp    = document.getElementById('viewport');
const tip   = document.getElementById('tooltip');
const zoomLbl  = document.getElementById('zoomLabel');
const resetBtn = document.getElementById('resetBtn');
const backBtn  = document.getElementById('backBtn');
const breadcrumb     = document.getElementById('breadcrumb');
const folderViewLabel = document.getElementById('folderViewLabel');
const NS = 'http://www.w3.org/2000/svg';
const W  = window.innerWidth, H = window.innerHeight;

function mkEl(tag, attrs) {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  return e;
}

// ── palette ──────────────────────────────────────────────
const PALETTE = ['#4ec9b0','#dcdcaa','#c586c0','#9cdcfe','#d16969','#b5cea8','#ce9178','#569cd6','#f48771','#98c379'];
function folderColor(fp) {
  let h = 5381;
  for (let i = 0; i < fp.length; i++) h = ((h << 5) + h + fp.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

// ── node + edge data ─────────────────────────────────────
const nodes = graph.nodes.map(n => ({ ...n, x:0, y:0, rootX:0, rootY:0 }));
const byId  = {};
nodes.forEach(n => byId[n.id] = n);
function nodeW(n) { return Math.max(90, n.fileName.length * 7 + 20); }
function nodeH()  { return 28; }

const edges = graph.edges
  .map(e => ({ ...e, s: byId[e.source], t: byId[e.target] }))
  .filter(e => e.s && e.t);
const impEdges = edges.filter(e => e.type === 'import');

// ── entry detection + topo layers ────────────────────────
const inDeg = {};
nodes.forEach(n => inDeg[n.id] = 0);
impEdges.forEach(e => inDeg[e.target]++);
const entryIds = new Set(nodes.filter(n => inDeg[n.id] === 0).map(n => n.id));
if (entryIds.size === 0 && nodes.length > 0) entryIds.add(nodes[0].id);

const layerOf = {};
nodes.forEach(n => layerOf[n.id] = 0);
for (let p = 0; p < Math.min(nodes.length, 80); p++) {
  let changed = false;
  for (const e of impEdges) {
    const proposed = layerOf[e.source] + 1;
    if (layerOf[e.target] < proposed) { layerOf[e.target] = proposed; changed = true; }
  }
  if (!changed) break;
}

// ── folder grouping ───────────────────────────────────────
// Normalise folderPath: '' (root-level files) → project name
const ROOT_FP = graph.projectName || 'project';

// Compute connected/unused EARLY so folderMap only gets connected files
const connectedIds = new Set();
edges.forEach(e => { connectedIds.add(e.source); connectedIds.add(e.target); });
const unusedIds = new Set(nodes.filter(n => !connectedIds.has(n.id)).map(n => n.id));

// Unused code nodes → go into the gray "Unused Files" box, NOT folder boxes
const unusedCodeNodes = nodes.filter(n =>
  n.nodeType === 'code' && unusedIds.has(n.id)
);

const folderMap = {};   // fp -> node[]  (direct files only, not descendants)
nodes.forEach(n => {
  if (n.nodeType === 'css' || n.nodeType === 'env' || n.nodeType === 'database') return;
  if (unusedIds.has(n.id)) return;   // ← unused files go to gray box, not folder
  const fp = n.folderPath || ROOT_FP;
  n.folderPath = fp;   // normalise in-place so edge anchoring uses the same key
  (folderMap[fp] = folderMap[fp] || []).push(n);
});
// Ensure every ancestor folder exists even if it has no direct files
Object.keys(folderMap).slice().forEach(fp => {
  if (fp === ROOT_FP) return;
  const parts = fp.split('/');
  for (let i = 1; i < parts.length; i++) {
    const ancestor = parts.slice(0, i).join('/');
    if (!folderMap[ancestor]) folderMap[ancestor] = [];
  }
});
// Always ensure the root bucket exists
if (!folderMap[ROOT_FP]) folderMap[ROOT_FP] = [];

const folders = Object.keys(folderMap).sort();

// ── folder tree helpers ───────────────────────────────────
// parent("src/components") → "src"
// parent("src")            → ROOT_FP
// parent(ROOT_FP)          → null
function folderParent(fp) {
  if (!fp || fp === ROOT_FP) return null;
  const idx = fp.lastIndexOf('/');
  if (idx < 0) return ROOT_FP;   // single segment → child of root
  return fp.slice(0, idx);
}

function folderChildren(fp) {
  return folders.filter(f => folderParent(f) === fp);
}

// Top-level boxes:
// - If ROOT_FP has actual code files (not just config/misc), it is itself a top-level box
// - If ROOT_FP has no direct files (most projects), treat first-level children as top-level
const rootHasFiles = (folderMap[ROOT_FP] || []).length > 0;
const topFolders = rootHasFiles
  ? [ROOT_FP]                                            // ROOT_FP wraps everything
  : folders.filter(f => folderParent(f) === ROOT_FP);   // skip empty ROOT_FP wrapper

// ── helper: sort nodes in a folder by layer then name ─────
function sortFolderNodes(ns) {
  return ns.slice().sort((a, b) =>
    (layerOf[a.id] - layerOf[b.id]) || a.fileName.localeCompare(b.fileName));
}

// ─────────────────────────────────────────────────────────
// LAYOUT — two-pass:
//   Pass 1 (bottom-up):  computeFboxSize  — returns actual { w, h }
//   Pass 2 (top-down):   positionFbox     — sets x, y for box + all nodes inside
//   Box height = what content actually needs, propagated all the way up.
// ─────────────────────────────────────────────────────────
const FPAD       = 16;   // inner padding (all sides)
const FGAP_X     = 60;   // gap between top-level boxes (horizontal)
const FGAP_Y     = 50;   // gap between top-level boxes (vertical)
const NODE_GAP_Y = 10;   // vertical gap between file rows inside a box
const NODE_GAP_X = 14;   // horizontal gap between child folder boxes
const CHILD_PAD  = 16;   // gap between the children row and the files section below
const LABEL_H    = 26;   // folder label bar height at the top of each box

const fboxes = {};   // fp -> { x, y, w, h, origH, color, depth }

// Pass 1: compute width and height bottom-up (no x/y yet)
function computeFboxSize(fp, depth) {
  const color       = folderColor(fp);
  const children    = folderChildren(fp);
  const directFiles = sortFolderNodes(folderMap[fp] || []);

  // Recurse children first so their sizes are known
  children.forEach(c => computeFboxSize(c, depth + 1));

  // Children row width = sum of child widths + gaps
  let childRowW = 0, childRowH = 0;
  children.forEach((c, i) => {
    childRowW += fboxes[c].w + (i > 0 ? NODE_GAP_X : 0);
    childRowH  = Math.max(childRowH, fboxes[c].h);
  });

  // Files column: single column, exact height
  let maxFileW = 0;
  directFiles.forEach(n => { maxFileW = Math.max(maxFileW, nodeW(n)); });
  const filesH = directFiles.length > 0
    ? directFiles.length * (nodeH() + NODE_GAP_Y) - NODE_GAP_Y
    : 0;

  const innerW = Math.max(childRowW, maxFileW, 60);
  let   innerH = childRowH;
  if (filesH > 0) innerH += (childRowH > 0 ? CHILD_PAD : 0) + filesH;

  const bw = innerW + FPAD * 2;
  const bh = LABEL_H + FPAD + Math.max(innerH, 4) + FPAD;

  fboxes[fp] = { w: bw, h: bh, origW: bw, origH: bh, color, depth, x: 0, y: 0 };
}

topFolders.forEach(fp => computeFboxSize(fp, 0));

// Pass 2: assign x,y top-down; returns actual bottom Y of this box (after all content placed)
function positionFbox(fp, startX, startY) {
  const fb       = fboxes[fp];
  fb.x = startX;
  fb.y = startY;

  const children    = folderChildren(fp);
  const directFiles = sortFolderNodes(folderMap[fp] || []);
  const contentX    = startX + FPAD;
  let   curY        = startY + LABEL_H + FPAD;

  // Place child folder boxes horizontally, track actual max bottom AND actual total width
  let childBottom = curY;
  let actualChildRowW = 0;
  if (children.length > 0) {
    let curX = contentX;
    children.forEach((c, i) => {
      const cBottom = positionFbox(c, curX, curY);
      const cActualH = cBottom - curY;
      fboxes[c].h      = cActualH;
      fboxes[c].origH  = cActualH;
      actualChildRowW += fboxes[c].w + (i > 0 ? NODE_GAP_X : 0);
      curX += fboxes[c].w + NODE_GAP_X;
      childBottom = Math.max(childBottom, cBottom);
    });
    curY = childBottom + (directFiles.length > 0 ? CHILD_PAD : 0);
  }

  // Place direct files below children, single column
  let maxFileW = 0;
  directFiles.forEach((n, i) => {
    n.x     = contentX;
    n.y     = curY + i * (nodeH() + NODE_GAP_Y);
    n.rootX = n.x;
    n.rootY = n.y;
    maxFileW = Math.max(maxFileW, nodeW(n));
  });
  folderMap[fp] = directFiles;

  // Actual bottom = last file bottom (or last child bottom if no files)
  let contentBottom = childBottom;
  if (directFiles.length > 0) {
    const lastFile = directFiles[directFiles.length - 1];
    contentBottom = lastFile.y + nodeH();
  }

  // Recalculate w based on actual content (children may have grown)
  const actualInnerW = Math.max(actualChildRowW, maxFileW, 60);
  fb.w     = actualInnerW + FPAD * 2;

  // Box height = content bottom + bottom padding
  const actualH = contentBottom + FPAD - startY;
  fb.h     = Math.max(actualH, LABEL_H + FPAD * 2);
  fb.origH = fb.h;
  fb.origW = fb.w;  // save original width for proportional resize

  return startY + fb.h;   // return actual bottom Y for parent to use
}

// ── Vertical stack layout for top-level boxes ────────────
// All top-level folders stacked vertically in one column (left side).
// Special boxes (CSS/ENV/DB/Unused) go in a right-side column.
// First pass at origin to learn actual sizes, then position final.
let _tmpY = 0;
topFolders.forEach(fp => { positionFbox(fp, 0, _tmpY); _tmpY += fboxes[fp].h + FGAP_Y; });

// Final pass: stack vertically at x=FGAP_X
let _curY = 60;
topFolders.forEach(fp => {
  positionFbox(fp, FGAP_X, _curY);
  _curY += fboxes[fp].h + FGAP_Y;
});

// ── special nodes layout ──────────────────────────────────
const cssNodes = nodes.filter(n => n.nodeType === 'css');
const envNodes = nodes.filter(n => n.nodeType === 'env');
const dbNodes  = nodes.filter(n => n.nodeType === 'database');

const folderBottoms = topFolders.map(fp => fboxes[fp] ? fboxes[fp].y + fboxes[fp].h : 0);
const gridBottom = folderBottoms.length ? Math.max(...folderBottoms) : H / 2;
const specialY   = gridBottom + 90;

const SPECIAL_COL_GAP = 30;
const SPECIAL_NODE_H  = 28;
const SPECIAL_NODE_W  = 160;
const SPECIAL_PAD     = 14;

function layoutSpecialGroup(snodes, startX, y) {
  if (!snodes.length) return { x: startX, y, w: 0, h: 0, endX: startX };
  const bw = SPECIAL_NODE_W + SPECIAL_PAD * 2;
  const bh = snodes.length * (SPECIAL_NODE_H + 6) + SPECIAL_PAD * 2 + 20;
  snodes.forEach((n, i) => {
    n.x = startX + SPECIAL_PAD;
    n.y = y + 20 + SPECIAL_PAD + i * (SPECIAL_NODE_H + 6);
    n.rootX = n.x; n.rootY = n.y;
  });
  return { x: startX, y, w: bw, h: bh, endX: startX + bw };
}

let sx = FGAP_X;
const cssBox = layoutSpecialGroup(cssNodes, sx, specialY);  cssBox.color = '#c586c0';
sx = cssBox.endX + (cssBox.w ? SPECIAL_COL_GAP : 0);
const envBox = layoutSpecialGroup(envNodes, sx, specialY);  envBox.color = '#dcdcaa';
sx = envBox.endX + (envBox.w ? SPECIAL_COL_GAP : 0);
const dbBox  = layoutSpecialGroup(dbNodes,  sx, specialY);  dbBox.color  = '#4ec9b0';
sx = dbBox.endX + (dbBox.w ? SPECIAL_COL_GAP : 0);

// ── Unused Files box — gray, wider to fit file names ──────
function layoutUnusedGroup(unodes, startX, y) {
  if (!unodes.length) return { x: startX, y, w: 0, h: 0, endX: startX };
  // normalise folderPath for unused nodes too
  unodes.forEach(n => { if (!n.folderPath) n.folderPath = ROOT_FP; });
  const maxW = Math.max(...unodes.map(n => n.fileName.length * 7 + 20), SPECIAL_NODE_W);
  const bw = maxW + SPECIAL_PAD * 2;
  const bh = unodes.length * (SPECIAL_NODE_H + 6) + SPECIAL_PAD * 2 + 20;
  unodes.forEach((n, i) => {
    n.x = startX + SPECIAL_PAD;
    n.y = y + 20 + SPECIAL_PAD + i * (SPECIAL_NODE_H + 6);
    n.rootX = n.x; n.rootY = n.y;
  });
  return { x: startX, y, w: bw, h: bh, endX: startX + bw };
}
const unusedBox = layoutUnusedGroup(unusedCodeNodes, sx, specialY);
unusedBox.color = '#6e6e6e';

// ── folder-to-folder connection map (for root view f2f edges) ─
// f2fMap[fpA][fpB] = count of file-level edges between them
const f2fMap = {};
edges.forEach(e => {
  const sf = (e.s.folderPath || '(root)');
  const tf = (e.t.folderPath || '(root)');
  if (sf === tf) return;  // same folder, skip
  if (!f2fMap[sf]) f2fMap[sf] = {};
  if (!f2fMap[sf][tf]) f2fMap[sf][tf] = 0;
  f2fMap[sf][tf]++;
});

// ── view mode state ───────────────────────────────────────
let viewMode = 'root';        // 'root' | 'folder'
let focusFolder = null;       // fp string when in folder mode
`;
}

function getJs2(): string {
    return `
// ═══════════════════════════════════════════════════════
// DRAWING STATE
// ═══════════════════════════════════════════════════════
const folderEls  = {};   // fp -> { box, label, chevron, g }
const edgeEls    = [];   // { el, data, isF2F, sf?, tf? }
const nodeGroups = [];   // { el, data }
let   summaryEls = [];   // external folder summary boxes in folder-view

// ── helpers ───────────────────────────────────────────
// Bezier where both endpoints have horizontal tangents (for left→right edges)
function bezierPath(x1, y1, x2, y2) {
  const dx = Math.abs(x2 - x1);
  const cp = Math.max(dx * 0.55, 60);
  return 'M '+x1+' '+y1+' C '+(x1+cp)+' '+y1+' '+(x2-cp)+' '+y2+' '+x2+' '+y2;
}
function nodeCenter(n) {
  return { x: n.x + nodeW(n)/2, y: n.y + nodeH()/2 };
}
// Right-middle of node (outgoing / source anchor)
function nodeRight(n) {
  return { x: n.x + nodeW(n), y: n.y + nodeH()/2 };
}
// Left-middle of node (incoming / target anchor)
function nodeLeft(n) {
  return { x: n.x, y: n.y + nodeH()/2 };
}

// All file nodes under a folder (including all descendants)
function getAllFilesUnder(fp) {
  const result = [...(folderMap[fp] || [])];
  folderChildren(fp).forEach(c => result.push(...getAllFilesUnder(c)));
  return result;
}

// Nearest visible ancestor of a folder (for edge rerouting when collapsed)
function nearestVisibleAncestor(fp) {
  let p = folderParent(fp);
  while (p) {
    if (!collapsedFolders.has(p)) return p;
    p = folderParent(p);
  }
  return null;
}

// ── collapse state ─────────────────────────────────────
const collapsedFolders = new Set();
const COLLAPSED_H = 24;

// Is a node hidden? — its folder or any ancestor is collapsed
function isNodeHidden(n) {
  let fp = n.folderPath || ROOT_FP;
  while (fp) {
    if (collapsedFolders.has(fp)) return true;
    fp = folderParent(fp);
  }
  return false;
}

// Get the visible anchor point for an edge endpoint
// side: 'right' = source (outgoing), 'left' = target (incoming)
// If node is hidden → reroute to nearest visible collapsed ancestor box center
function edgeAnchor(n, side) {
  if (!isNodeHidden(n)) {
    return side === 'right' ? nodeRight(n) : nodeLeft(n);
  }
  // find nearest collapsed ancestor
  let fp = n.folderPath || ROOT_FP;
  while (fp) {
    if (collapsedFolders.has(fp)) {
      const fb = fboxes[fp];
      if (fb) return { x: fb.x + fb.w/2, y: fb.y + COLLAPSED_H/2 };
    }
    fp = folderParent(fp);
  }
  return side === 'right' ? nodeRight(n) : nodeLeft(n);
}

function redrawAllEdges() {
  edgeEls.forEach(ee => {
    if (ee.isF2F) return; // f2f edges don't need per-node redraw
    const e = ee.data;
    if (!e.s || !e.t) return;
    const srcFp = e.s.folderPath || ROOT_FP;
    const tgtFp = e.t.folderPath || ROOT_FP;
    // both in same collapsed folder → hide
    if (srcFp === tgtFp && collapsedFolders.has(srcFp)) {
      ee.el.style.display = 'none'; return;
    }
    // both hidden under same collapsed ancestor → hide
    const srcAnc = getCollapsedAncestor(srcFp);
    const tgtAnc = getCollapsedAncestor(tgtFp);
    if (srcAnc && srcAnc === tgtAnc) { ee.el.style.display = 'none'; return; }
    ee.el.style.display = '';
    const a1 = edgeAnchor(e.s, 'right'), a2 = edgeAnchor(e.t, 'left');
    ee.el.setAttribute('d', bezierPath(a1.x, a1.y, a2.x, a2.y));
  });
}

function getCollapsedAncestor(fp) {
  let p = fp;
  while (p) {
    if (collapsedFolders.has(p)) return p;
    p = folderParent(p);
  }
  return null;
}

function setFolderCollapsed(fp, collapsed) {
  const fb = fboxes[fp], fe = folderEls[fp];
  if (!fb || !fe) return;

  if (collapsed) {
    collapsedFolders.add(fp);
    // hide all files + child folder boxes under this folder
    getAllFilesUnder(fp).forEach(n => {
      const ng = nodeGroups.find(g => g.data.id === n.id);
      if (ng) ng.el.style.display = 'none';
    });
    getAllDescendantFolders(fp).forEach(c => {
      const fe2 = folderEls[c];
      if (fe2) {
        if (fe2.g) fe2.g.style.display = 'none';
      }
    });
  } else {
    collapsedFolders.delete(fp);
    // show files not hidden by a deeper collapse
    getAllFilesUnder(fp).forEach(n => {
      if (!isNodeHidden(n)) {
        const ng = nodeGroups.find(g => g.data.id === n.id);
        if (ng) ng.el.style.display = '';
      }
    });
    // restore child folder boxes (unless they themselves are collapsed)
    getAllDescendantFolders(fp).forEach(c => {
      if (!collapsedFolders.has(c)) {
        const fe2 = folderEls[c];
        if (fe2 && fe2.g) fe2.g.style.display = '';
      }
    });
  }

  // Recompute visual heights all the way up from this folder to root
  recomputeAncestorHeights(fp);
  redrawAllEdges();
}

// Recompute the visual height of fp and all its ancestors after a collapse/expand.
// Also updates the SVG rect + repositions sibling boxes and files.
function recomputeAncestorHeights(startFp) {
  // Walk from startFp up to root, recompute each level
  let fp = startFp;
  while (fp) {
    recomputeFboxHeight(fp);
    fp = folderParent(fp);
  }
}

// Recompute the visual height of a single folder box based on current collapse state,
// then reposition its children and direct files, and update all SVG elements.
function recomputeFboxHeight(fp) {
  const fb = fboxes[fp], fe = folderEls[fp];
  if (!fb || !fe) return;

  const isCollapsed = collapsedFolders.has(fp);
  if (isCollapsed) {
    fb.h = COLLAPSED_H;
    if (fe.chevron) fe.chevron.textContent = '▶ ';
    updateFolderElPositions(fp);
    return;
  }

  if (fe.chevron) fe.chevron.textContent = '▼ ';

  const children    = folderChildren(fp);
  const directFiles = sortFolderNodes(folderMap[fp] || []);
  const contentX    = fb.x + FPAD;
  let   curY        = fb.y + LABEL_H + FPAD;

  // Lay out children horizontally (some may be collapsed → smaller)
  let childBottom = curY;
  let actualChildRowW = 0;
  if (children.length > 0) {
    let curX = contentX;
    children.forEach((c, i) => {
      const cfb = fboxes[c];
      if (!cfb) return;
      // move child box to its new horizontal position
      cfb.x = curX; cfb.y = curY;
      updateFolderElPositions(c);
      actualChildRowW += cfb.w + (i > 0 ? NODE_GAP_X : 0);
      curX += cfb.w + NODE_GAP_X;
      childBottom = Math.max(childBottom, curY + cfb.h);
    });
    curY = childBottom + (directFiles.length > 0 ? CHILD_PAD : 0);
  }

  // Reposition direct files
  let maxFileW = 0;
  directFiles.forEach((n, i) => {
    n.x = contentX;
    n.y = curY + i * (nodeH() + NODE_GAP_Y);
    maxFileW = Math.max(maxFileW, nodeW(n));
    const ng = nodeGroups.find(g => g.data.id === n.id);
    if (ng) ng.el.setAttribute('transform', 'translate('+n.x+','+n.y+')');
  });

  // Compute new actual height
  let contentBottom = childBottom;
  if (directFiles.length > 0) {
    const lf = directFiles[directFiles.length - 1];
    contentBottom = lf.y + nodeH();
  }
  const newH = Math.max(contentBottom + FPAD - fb.y, LABEL_H + FPAD * 2);
  fb.h = newH;

  // Recalc width too (children may have changed)
  const newInnerW = Math.max(actualChildRowW, maxFileW, 60);
  fb.w = newInnerW + FPAD * 2;

  // Update all SVG elements (box rect, chevron, label, grip)
  updateFolderElPositions(fp);

  // Update hint text position (bottom-left)
  // Update label (badge count stays same — no recount needed here)
}

function getAllDescendantFolders(fp) {
  const result = [];
  function collect(f) {
    folderChildren(f).forEach(c => { result.push(c); collect(c); });
  }
  collect(fp);
  return result;
}

// ── updateFolderElPositions: one place to sync all SVG elements of a folder ──
// Call this whenever fboxes[fp].x/y/w/h changes for any reason.
const _GS = 18; // corner size (matches CORNER in drawFolderBox)
const _EW = 8;  // edge strip thickness
function updateFolderElPositions(fp) {
  const fb = fboxes[fp], fe = folderEls[fp];
  if (!fb || !fe) return;
  if (fe.box)    { fe.box.setAttribute('x', fb.x);    fe.box.setAttribute('y', fb.y);
                   fe.box.setAttribute('width', fb.w); fe.box.setAttribute('height', fb.h); }
  if (fe.chevron){ fe.chevron.setAttribute('x', fb.x + 6);  fe.chevron.setAttribute('y', fb.y + 14); }
  if (fe.label)  { fe.label.setAttribute('x', fb.x + 18); fe.label.setAttribute('y', fb.y + 14); }
  // bottom edge strip
  if (fe.edgeB)  { fe.edgeB.setAttribute('x', fb.x); fe.edgeB.setAttribute('y', fb.y + fb.h - _EW);
                   fe.edgeB.setAttribute('width', fb.w - _GS); fe.edgeB.setAttribute('height', _EW); }
  // right edge strip
  if (fe.edgeR)  { fe.edgeR.setAttribute('x', fb.x + fb.w - _EW); fe.edgeR.setAttribute('y', fb.y);
                   fe.edgeR.setAttribute('width', _EW); fe.edgeR.setAttribute('height', fb.h - _GS); }
  // corner square
  if (fe.edgeC)  { fe.edgeC.setAttribute('x', fb.x + fb.w - _GS); fe.edgeC.setAttribute('y', fb.y + fb.h - _GS); }
  if (fe.edgeCDot){ fe.edgeCDot.setAttribute('x', fb.x + fb.w - _GS/2); fe.edgeCDot.setAttribute('y', fb.y + fb.h - _GS/2 + 3); }
  // cross-folder badge (top-right)
  if (fe.badgeBg || fe.badgeTxt) {
    const bw = fe.badgeBg ? parseFloat(fe.badgeBg.getAttribute('width') || '16') : 16;
    const bx = fb.x + fb.w - bw - 6;
    const by = fb.y + 4;
    if (fe.badgeBg) { fe.badgeBg.setAttribute('x', bx); fe.badgeBg.setAttribute('y', by); }
    if (fe.badgeTxt){ fe.badgeTxt.setAttribute('x', bx + bw/2); fe.badgeTxt.setAttribute('y', by + 10); }
  }
  // hint text (bottom-left, top-level folders only)
  if (fe.hintEl) { fe.hintEl.setAttribute('x', fb.x + 6); fe.hintEl.setAttribute('y', fb.y + fb.h - 6); }
  // legacy grip support (if any old folderEls still have grip)
  if (fe.grip)   { fe.grip.setAttribute('x', fb.x + fb.w - _GS); fe.grip.setAttribute('y', fb.y + fb.h - _GS); }
  if (fe.gripDot){ fe.gripDot.setAttribute('x', fb.x + fb.w - _GS/2); fe.gripDot.setAttribute('y', fb.y + fb.h - _GS/2 + 3); }
  if (fe.gripHit){ fe.gripHit.setAttribute('x', fb.x + fb.w - 28); fe.gripHit.setAttribute('y', fb.y + fb.h - 28); }
}

// ── repositionContentInFolder: when folder is resized, proportionally move
//    direct file nodes AND child subfolders. Node SIZE stays fixed; positions scale.
function repositionContentInFolder(fp, prevW, prevH, newW, newH) {
  const fb = fboxes[fp];
  if (!fb) return;

  const ox = fb.x + FPAD;
  const oy = fb.y + LABEL_H + FPAD;
  const oldCW = Math.max(1, prevW - FPAD * 2);
  const oldCH = Math.max(1, prevH - LABEL_H - FPAD * 2);
  const newCW = Math.max(1, newW  - FPAD * 2);
  const newCH = Math.max(1, newH  - LABEL_H - FPAD * 2);
  const sx = newCW / oldCW;
  const sy = newCH / oldCH;

  // Helper: move a subtree (folder + all descendants + their files) by dx,dy
  function shiftSubtree(cfp, dx, dy) {
    [cfp, ...getAllDescendantFolders(cfp)].forEach(f => {
      const fxb = fboxes[f];
      if (!fxb) return;
      fxb.x += dx; fxb.y += dy;
      updateFolderElPositions(f);
      (folderMap[f] || []).forEach(n => {
        n.x += dx; n.y += dy;
        const ng = nodeGroups.find(g2 => g2.data.id === n.id);
        if (ng) ng.el.setAttribute('transform', 'translate('+n.x+','+n.y+')');
      });
    });
  }

  // Reposition direct file nodes proportionally
  (folderMap[fp] || []).forEach(n => {
    const relX = n.x - ox;
    const relY = n.y - oy;
    n.x = ox + relX * sx;
    n.y = oy + relY * sy;
    // clamp inside new content area
    n.x = Math.max(ox, Math.min(ox + newCW - nodeW(n), n.x));
    n.y = Math.max(oy, Math.min(oy + newCH - nodeH(), n.y));
    const ng = nodeGroups.find(g2 => g2.data.id === n.id);
    if (ng) ng.el.setAttribute('transform', 'translate('+n.x+','+n.y+')');
  });

  // Reposition child subfolders proportionally (scale top-left corner, keep size)
  folderChildren(fp).forEach(c => {
    const cfb = fboxes[c];
    if (!cfb) return;
    const relX = cfb.x - ox;
    const relY = cfb.y - oy;
    const targetX = ox + relX * sx;
    const targetY = oy + relY * sy;
    // clamp inside new content area
    const clampX = Math.max(ox, Math.min(ox + newCW - cfb.w, targetX));
    const clampY = Math.max(oy, Math.min(oy + newCH - cfb.h, targetY));
    const dx = clampX - cfb.x;
    const dy = clampY - cfb.y;
    if (dx !== 0 || dy !== 0) shiftSubtree(c, dx, dy);
  });
}

// ── reflowFolderContent: responsive resize when folder box is scaled ──────────
// When parent is resized → children scale proportionally (size + position).
// Files also reposition proportionally.
// Recursive: resizing a child also reflows its own children.
function reflowFolderContent(fp) {
  const fb = fboxes[fp];
  if (!fb) return;

  const children    = folderChildren(fp);
  const directFiles = sortFolderNodes(folderMap[fp] || []);
  const contentX    = fb.x + FPAD;
  const contentY    = fb.y + LABEL_H + FPAD;
  const availW      = Math.max(60, fb.w - FPAD * 2);
  const availH      = Math.max(20, fb.h - LABEL_H - FPAD * 2);

  if (children.length > 0) {
    // Calculate total original children dimensions to derive scale factors
    const origChildrenW = children.reduce((sum, c, i) => {
      const cfb = fboxes[c];
      return sum + (cfb ? cfb.origW || cfb.w : 0) + (i > 0 ? NODE_GAP_X : 0);
    }, 0);
    const origChildrenH = Math.max(...children.map(c => {
      const cfb = fboxes[c]; return cfb ? cfb.origH || cfb.h : 0;
    }));

    // Scale factors based on available space vs original sizes
    const scaleW = origChildrenW > 0 ? availW / origChildrenW : 1;
    const scaleH = origChildrenH > 0
      ? (directFiles.length > 0 ? (availH * 0.6) : availH) / origChildrenH
      : 1;

    // Use the smaller scale to keep proportions (uniform scaling)
    const scale = Math.min(scaleW, scaleH, 1.5);  // cap at 1.5x to avoid explosion

    // Reposition + resize each child proportionally
    let curX = contentX;
    let maxChildH = 0;
    children.forEach((c, i) => {
      const cfb = fboxes[c];
      if (!cfb) return;

      // Store original size if not stored yet
      if (!cfb.origW) cfb.origW = cfb.w;
      if (!cfb.origH) cfb.origH = cfb.h;

      // New size = original * scale
      const newCW = Math.max(60, cfb.origW * scale);
      const newCH = Math.max(LABEL_H + FPAD * 2, cfb.origH * scale);

      cfb.x = curX;
      cfb.y = contentY;
      cfb.w = newCW;
      cfb.h = newCH;

      // Recurse — resize this child's content too
      reflowFolderContent(c);

      maxChildH = Math.max(maxChildH, cfb.h);
      curX += cfb.w + NODE_GAP_X;
    });

    // Reposition files below children
    const filesY = contentY + maxChildH + (directFiles.length > 0 ? CHILD_PAD : 0);
    directFiles.forEach((n, i) => {
      n.x = contentX;
      n.y = filesY + i * (nodeH() + NODE_GAP_Y);
      const ng = nodeGroups.find(g => g.data.id === n.id);
      if (ng) ng.el.setAttribute('transform', 'translate('+n.x+','+n.y+')');
    });

  } else {
    // No children — just reflow files to fill available width
    directFiles.forEach((n, i) => {
      n.x = contentX;
      n.y = contentY + i * (nodeH() + NODE_GAP_Y);
      const ng = nodeGroups.find(g => g.data.id === n.id);
      if (ng) ng.el.setAttribute('transform', 'translate('+n.x+','+n.y+')');
    });
  }

  // Update this folder's SVG elements
  updateFolderElPositions(fp);
}

// ── resolveOverlaps: multi-pass magnetic repulsion for all nodes in a folder ──
// Keeps running passes until no two nodes overlap (or max passes reached).
// Dragged node is pinned — everything else moves away from it and each other.
function resolveOverlaps(fp) {
  const ns = folderMap[fp];
  if (!ns || ns.length < 2) return;
  const fb = fboxes[fp];
  const GAP = 4;   // minimum gap between nodes
  const MAX_PASSES = 20;

  for (let pass = 0; pass < MAX_PASSES; pass++) {
    let anyOverlap = false;

    for (let i = 0; i < ns.length; i++) {
      for (let j = i + 1; j < ns.length; j++) {
        const a = ns[i], b = ns[j];
        const aw = nodeW(a), ah = nodeH();
        const bw = nodeW(b), bh = nodeH();

        const overlapX = a.x < b.x + bw + GAP && a.x + aw + GAP > b.x;
        const overlapY = a.y < b.y + bh + GAP && a.y + ah + GAP > b.y;
        if (!overlapX || !overlapY) continue;

        anyOverlap = true;

        // Penetration depths on each axis
        const penR = (a.x + aw + GAP) - b.x;   // push b right / a left
        const penL = (b.x + bw + GAP) - a.x;   // push b left  / a right
        const penD = (a.y + ah + GAP) - b.y;   // push b down  / a up
        const penU = (b.y + bh + GAP) - a.y;   // push b up    / a down
        const minPen = Math.min(penR, penL, penD, penU);

        // Split the push 50/50 between the two nodes
        let adx = 0, ady = 0, bdx = 0, bdy = 0;
        if (minPen === penR) { adx = -penR/2; bdx =  penR/2; }
        else if (minPen === penL) { adx =  penL/2; bdx = -penL/2; }
        else if (minPen === penD) { ady = -penD/2; bdy =  penD/2; }
        else                      { ady =  penU/2; bdy = -penU/2; }

        // Apply and clamp inside folder box
        if (fb) {
          const minX = fb.x + FPAD, minY = fb.y + LABEL_H + FPAD;
          a.x = Math.max(minX, Math.min(fb.x + fb.w - FPAD - aw, a.x + adx));
          a.y = Math.max(minY, Math.min(fb.y + fb.h - FPAD - ah, a.y + ady));
          b.x = Math.max(minX, Math.min(fb.x + fb.w - FPAD - bw, b.x + bdx));
          b.y = Math.max(minY, Math.min(fb.y + fb.h - FPAD - bh, b.y + bdy));
        } else {
          a.x += adx; a.y += ady;
          b.x += bdx; b.y += bdy;
        }
      }
    }

    if (!anyOverlap) break;
  }

  // Flush all SVG positions after all passes
  ns.forEach(n => {
    const ng = nodeGroups.find(g2 => g2.data.id === n.id);
    if (ng) {
      ng.el.setAttribute('transform', 'translate('+n.x+','+n.y+')');
      refreshEdges(n.id);
    }
  });
}

// ── resizeParentBox: tightly re-wrap a folder around its current children + files ──
// After a child subfolder is dragged, call this on the parent (and it recurses upward).
function resizeParentBox(fp) {
  if (!fp || fp === ROOT_FP) return;
  const fb = fboxes[fp], fe = folderEls[fp];
  if (!fb || !fe) return;

  const children    = folderChildren(fp);
  const directFiles = sortFolderNodes(folderMap[fp] || []);

  // Measure the bounding box of all children subfolder boxes
  let childMaxRight  = fb.x + FPAD;
  let childMaxBottom = fb.y + LABEL_H + FPAD;
  children.forEach(c => {
    const cfb = fboxes[c];
    if (!cfb) return;
    childMaxRight  = Math.max(childMaxRight,  cfb.x + cfb.w);
    childMaxBottom = Math.max(childMaxBottom, cfb.y + cfb.h);
  });

  // Measure the bounding box of direct file nodes
  let fileMaxRight  = fb.x + FPAD;
  let fileMaxBottom = children.length > 0 ? childMaxBottom : fb.y + LABEL_H + FPAD;
  directFiles.forEach(n => {
    fileMaxRight  = Math.max(fileMaxRight,  n.x + nodeW(n));
    fileMaxBottom = Math.max(fileMaxBottom, n.y + nodeH());
  });

  const contentRight  = Math.max(childMaxRight,  fileMaxRight);
  const contentBottom = Math.max(childMaxBottom, fileMaxBottom);

  // New width and height: content + padding on all sides
  const newW = Math.max(contentRight  - fb.x + FPAD, 60 + FPAD * 2);
  const newH = Math.max(contentBottom - fb.y + FPAD, LABEL_H + FPAD * 2);

  fb.w = newW;
  fb.h = newH;

  // Update all SVG elements for this folder (box, chevron, label, grip)
  updateFolderElPositions(fp);

  // Recurse upward so grandparent also wraps correctly
  resizeParentBox(folderParent(fp));
}

// ── redrawAllEdgesLive: update all edges (file-level + f2f) during drag ──
function redrawAllEdgesLive() {
  edgeEls.forEach(ee => {
    if (ee.isF2F) {
      // Folder-to-folder edge: recompute from current fbox centers
      const fbS = fboxes[ee.sf], fbT = fboxes[ee.tf];
      if (!fbS || !fbT) return;
      const x1 = fbS.x + fbS.w / 2, y1 = fbS.y + fbS.h / 2;
      const x2 = fbT.x + fbT.w / 2, y2 = fbT.y + fbT.h / 2;
      ee.el.setAttribute('d', bezierPath(x1, y1, x2, y2));
    } else {
      // File-level edge: recompute from current node positions
      const e = ee.data;
      if (!e.s || !e.t) return;
      const a1 = edgeAnchor(e.s, 'right'), a2 = edgeAnchor(e.t, 'left');
      ee.el.setAttribute('d', bezierPath(a1.x, a1.y, a2.x, a2.y));
    }
  });
}

// ── render ROOT view ──────────────────────────────────
function renderRoot() {
  vp.innerHTML = '';
  edgeEls.length = 0;
  nodeGroups.length = 0;
  summaryEls = [];
  Object.keys(folderEls).forEach(k => delete folderEls[k]);

  // 1. Restore root positions for all nodes
  nodes.forEach(n => { n.x = n.rootX; n.y = n.rootY; });
  folders.forEach(fp => { if (fboxes[fp]) fboxes[fp].h = fboxes[fp].origH; });

  // 2. Draw folder boxes recursively (children nested inside parents)
  function drawFolderBox(fp) {
    const fb = fboxes[fp];
    if (!fb) return;
    const isTop    = fb.depth === 0;
    const children = folderChildren(fp);
    const fileCount = getAllFilesUnder(fp).length;

    const g = mkEl('g', {});

    const rect = mkEl('rect', {
      x: fb.x, y: fb.y, width: fb.w, height: fb.h,
      rx: isTop ? 10 : 6, ry: isTop ? 10 : 6,
      fill: fb.color,
      'fill-opacity': isTop ? '0.08' : '0.04',
      stroke: fb.color,
      'stroke-width': isTop ? '1.5' : '1',
    });
    if (!isTop) rect.setAttribute('stroke-dasharray', '5,3');
    rect.classList.add('folder-box');

    // chevron
    const chevron = mkEl('text', {
      x: fb.x + 6, y: fb.y + 14,
      fill: fb.color, 'font-size': '9', opacity: '0.8'
    });
    chevron.textContent = '▼ ';

    const lbl = mkEl('text', {
      x: fb.x + 18, y: fb.y + 14,
      fill: fb.color,
      'font-size': isTop ? '11' : '10',
      'font-weight': '700', opacity: '0.85'
    });
    // show only the last segment of the path (ROOT_FP is already the project name)
    const shortName = fp.split('/').pop() || fp;
    lbl.textContent = '📁 ' + shortName + '  (' + fileCount + ')';
    lbl.classList.add('folder-label');

    // cross-folder connection badge (count edges going in/out of this folder)
    const myIds = new Set(getAllFilesUnder(fp).map(n => n.id));
    let crossCount = 0;
    edges.forEach(e => {
      const sIn = myIds.has(e.source), tIn = myIds.has(e.target);
      if (sIn !== tIn) crossCount++;
    });
    let badgeEl = null;   // the <g> holding bgR + btxt
    let badgeBg = null;   // the <rect> inside badge
    let badgeTxt = null;  // the <text> inside badge
    if (crossCount > 0) {
      const bw = crossCount > 99 ? 30 : crossCount > 9 ? 22 : 16;
      const bx = fb.x + fb.w - bw - 6;
      const by = fb.y + 4;
      badgeEl  = mkEl('g', {});
      badgeBg  = mkEl('rect', {
        x: bx, y: by, width: bw, height: 14,
        rx: 7, ry: 7,
        fill: fb.color, 'fill-opacity': '0.35',
        stroke: fb.color, 'stroke-width': '0.8'
      });
      badgeTxt = mkEl('text', {
        x: bx + bw/2, y: by + 10,
        'text-anchor': 'middle',
        fill: '#fff', 'font-size': '8', 'font-weight': '700', opacity: '0.9'
      });
      badgeTxt.textContent = crossCount > 99 ? '99+' : String(crossCount);
      badgeEl.appendChild(badgeBg);
      badgeEl.appendChild(badgeTxt);
      g.appendChild(badgeEl);
    }

    let hintEl = null;
    if (isTop) {
      hintEl = mkEl('text', {
        x: fb.x + 6, y: fb.y + fb.h - 6,
        fill: fb.color, 'font-size': '8', opacity: '0.35'
      });
      hintEl.textContent = 'dbl-click to explore';
      g.appendChild(hintEl);
    }

    // ── resize zones: bottom edge, right edge, bottom-right corner ──
    const EDGE_W = 8;    // thickness of edge hit strips
    const CORNER = 18;   // corner square size (also the visible indicator)

    // Bottom edge strip (full width minus corner)
    const edgeB = mkEl('rect', {
      x: fb.x, y: fb.y + fb.h - EDGE_W,
      width: fb.w - CORNER, height: EDGE_W,
      fill: 'transparent', style: 'cursor:s-resize',
      class: 'folder-resize-b'
    });
    // Right edge strip (full height minus corner)
    const edgeR = mkEl('rect', {
      x: fb.x + fb.w - EDGE_W, y: fb.y,
      width: EDGE_W, height: fb.h - CORNER,
      fill: 'transparent', style: 'cursor:e-resize',
      class: 'folder-resize-r'
    });
    // Bottom-right corner (visible indicator + drag both axes)
    const edgeC = mkEl('rect', {
      x: fb.x + fb.w - CORNER, y: fb.y + fb.h - CORNER,
      width: CORNER, height: CORNER,
      rx: 3, ry: 3,
      fill: fb.color, 'fill-opacity': '0.28',
      stroke: fb.color, 'stroke-width': '0.8',
      style: 'cursor:se-resize',
      class: 'folder-resize-c'
    });
    const edgeCDot = mkEl('text', {
      x: fb.x + fb.w - CORNER/2, y: fb.y + fb.h - CORNER/2 + 3,
      'text-anchor': 'middle', 'font-size': '9',
      fill: fb.color, opacity: '0.8',
      style: 'pointer-events:none; user-select:none'
    });
    edgeCDot.textContent = '⤡';

    g.appendChild(edgeB); g.appendChild(edgeR);
    g.appendChild(edgeC); g.appendChild(edgeCDot);

    g.appendChild(rect); g.appendChild(chevron); g.appendChild(lbl);
    vp.appendChild(g);
    folderEls[fp] = { box: rect, label: lbl, chevron, g, edgeB, edgeR, edgeC, edgeCDot, badgeBg, badgeTxt, hintEl };

    // ── wire resize drag on all three zones ──────────
    // resizeDir: 'h' = height only, 'w' = width only, 'both'
    let rDragging = false, rStartX = 0, rStartY = 0, rStartW = 0, rStartH = 0, rDir = 'both';
    const MIN_BOX_W = 80, MIN_BOX_H = LABEL_H + FPAD * 2 + 10;

    function startResize(ev, dir) {
      rDragging = true; rDir = dir;
      rStartX = ev.clientX; rStartY = ev.clientY;
      rStartW = fb.w; rStartH = fb.h;
      ev.stopPropagation(); ev.preventDefault();
    }
    edgeB.addEventListener('mousedown', ev => startResize(ev, 'h'));
    edgeR.addEventListener('mousedown', ev => startResize(ev, 'w'));
    edgeC.addEventListener('mousedown', ev => startResize(ev, 'both'));

    window.addEventListener('mousemove', ev => {
      if (!rDragging) return;
      const dw = (ev.clientX - rStartX) / viewScale;
      const dh = (ev.clientY - rStartY) / viewScale;
      const newW = rDir === 'h' ? rStartW : Math.max(MIN_BOX_W, rStartW + dw);
      const newH = rDir === 'w' ? rStartH : Math.max(MIN_BOX_H, rStartH + dh);
      fb.w = newW; fb.h = newH;

      // Reflow content inside the box (like responsive layout — children re-wrap)
      reflowFolderContent(fp);

      redrawAllEdgesLive();
    });
    window.addEventListener('mouseup', () => { rDragging = false; });

    // draw children recursively INSIDE this box
    children.forEach(c => drawFolderBox(c));
  }

  topFolders.forEach(fp => drawFolderBox(fp));

  // 2b. Auto-collapse/expand based on connections
  //     Connected folder (has at least one file with an edge) → expand
  //     Unconnected folder → collapse
  //     Process deepest folders first so parent state is set correctly
  {
    const allFoldersSorted = [...folders].sort((a, b) =>
      b.split('/').length - a.split('/').length  // deepest first
    );
    allFoldersSorted.forEach(fp => {
      const filesUnder  = getAllFilesUnder(fp);
      const hasConnection = filesUnder.some(n => connectedIds.has(n.id));
      setFolderCollapsed(fp, !hasConnection);
    });
  }

  // 3. Folder-to-folder aggregated edges (top-level only)
  const drawnF2F = new Set();
  topFolders.forEach(sf => {
    topFolders.forEach(tf => {
      if (sf === tf) return;
      const key = [sf,tf].sort().join('||');
      if (drawnF2F.has(key)) return;
      // count all edges between any file under sf and any file under tf
      const sfIds = new Set(getAllFilesUnder(sf).map(n => n.id));
      const tfIds = new Set(getAllFilesUnder(tf).map(n => n.id));
      let count = 0;
      edges.forEach(e => {
        if ((sfIds.has(e.source) && tfIds.has(e.target)) ||
            (tfIds.has(e.source) && sfIds.has(e.target))) count++;
      });
      if (count === 0) return;
      drawnF2F.add(key);
      const fbS = fboxes[sf], fbT = fboxes[tf];
      if (!fbS || !fbT) return;
      const sw = Math.min(1.5 + count * 0.3, 6);
      const x1 = fbS.x + fbS.w/2, y1 = fbS.y + fbS.h/2;
      const x2 = fbT.x + fbT.w/2, y2 = fbT.y + fbT.h/2;
      const p = mkEl('path', {
        d: bezierPath(x1, y1, x2, y2),
        stroke: fbS.color, 'stroke-width': sw,
        'fill': 'none', 'stroke-opacity': '0.35',
        'marker-start': 'url(#dot-f2f)',
        'marker-end':   'url(#arr-f2f)',
        class: 'f2f-edge'
      });
      vp.insertBefore(p, vp.firstChild);
      edgeEls.push({ el: p, data: { sf, tf, count }, isF2F: true, sf, tf });
    });
  });

  // 4. File-level edges
  edges.forEach(e => {
    const sc = nodeRight(e.s), tc = nodeLeft(e.t);
    let cls, mid, dotS;
    if      (e.type === 'import')      { cls='edge-import';     mid='arr-import'; dotS='dot-import'; }
    else if (e.type === 'call')        { cls='edge-call';       mid='arr-call';   dotS='dot-call'; }
    else if (e.type === 'css-import')  { cls='edge-css-import'; mid='arr-css';    dotS='dot-css'; }
    else if (e.type === 'env-use')     { cls='edge-env-use';    mid='arr-env';    dotS='dot-env'; }
    else if (e.type === 'db-use')      { cls='edge-db-use';     mid='arr-db';     dotS='dot-db'; }
    else if (e.type === 'api-call')    { cls='edge-api-call';   mid='arr-api';    dotS='dot-api'; }
    else                               { cls='edge-import';     mid='arr-import'; dotS='dot-import'; }
    const p = mkEl('path', {
      d: bezierPath(sc.x, sc.y, tc.x, tc.y), class: cls,
      'marker-start': 'url(#'+dotS+')', 'marker-end': 'url(#'+mid+')'
    });
    vp.insertBefore(p, vp.firstChild);
    edgeEls.push({ el: p, data: e, isF2F: false });
  });

  // 5. File nodes
  nodes.forEach(n => drawFileNode(n));

  // 6. Special section boxes + nodes
  drawSpecialSection(cssBox, 'CSS / Styles', '🎨');
  drawSpecialSection(envBox, 'Environment',  '🔑');
  drawSpecialSection(dbBox,  'Database',     '🗄\uFE0F');
  nodes.forEach(n => {
    if (n.nodeType === 'css' || n.nodeType === 'env' || n.nodeType === 'database')
      drawSpecialNode(n);
  });

  // 7. Unused files — gray virtual box at the bottom
  drawSpecialSection(unusedBox, 'Unused Files', '🗑\uFE0F');
  unusedCodeNodes.forEach(n => drawFileNode(n));

  // 7. Wire up interactions
  wireRootInteractions();
  fitView();
}

// ── draw a single file node ───────────────────────────
function drawFileNode(n) {
  const isSpecial = n.nodeType === 'css' || n.nodeType === 'env' || n.nodeType === 'database';
  if (isSpecial) return;
  const isUnused = unusedIds.has(n.id);
  const col      = isUnused ? '#6e6e6e' : folderColor(n.folderPath || '(root)');
  const isEntry  = entryIds.has(n.id);
  const nw = nodeW(n), nh = nodeH();

  const g = mkEl('g', {
    class: 'node' + (isEntry ? ' entry' : '') + (isUnused ? ' unused' : ''),
    transform: 'translate('+n.x+','+n.y+')',
    style: '--nc:'+col
  });
  const bg = mkEl('rect', {
    x:0, y:0, width:nw, height:nh, rx:5, ry:5,
    fill: col,
    'fill-opacity': isUnused ? '0.12' : '0.18',
    stroke: isEntry ? '#ffd700' : col,
    'stroke-width': isEntry ? '2' : (isUnused ? '0.6' : '0.8'),
    class: 'core'
  });
  const txt = mkEl('text', { x:8, y:18, 'font-size':'11' });
  txt.textContent = n.fileName;
  g.appendChild(bg); g.appendChild(txt);
  if (n.dbUsage && n.dbUsage.length > 0) {
    const badge = mkEl('text', { x: nw+3, y:15, 'font-size':'11' });
    badge.textContent = '🗄\uFE0F';
    g.appendChild(badge);
  }
  vp.appendChild(g);
  nodeGroups.push({ el: g, data: n, bg, txt });

  g.addEventListener('mouseenter', ev => showTip(ev, n));
  g.addEventListener('mousemove',  ev => moveTip(ev));
  g.addEventListener('mouseleave', hideTip);
  g.addEventListener('click', ev => {
    ev.stopPropagation();
    if (ev.ctrlKey || ev.metaKey) vsapi.postMessage({ command:'openFile', fileId:n.id });
    else selectNode(n.id);
  });
  let dragging = false;
  g.addEventListener('mousedown', ev => { dragging=true; ev.stopPropagation(); });
  window.addEventListener('mouseup', () => { dragging=false; });
  window.addEventListener('mousemove', ev => {
    if (!dragging) return;
    const r = svg.getBoundingClientRect();
    let nx = (ev.clientX - r.left - viewX) / viewScale;
    let ny = (ev.clientY - r.top  - viewY) / viewScale;
    // Clamp inside the folder box so the file can't escape its folder
    const fb = fboxes[n.folderPath];
    if (fb) {
      const minX = fb.x + FPAD;
      const maxX = fb.x + fb.w - FPAD - nodeW(n);
      const minY = fb.y + LABEL_H + FPAD;
      const maxY = fb.y + fb.h - FPAD - nodeH();
      nx = Math.max(minX, Math.min(maxX, nx));
      ny = Math.max(minY, Math.min(maxY, ny));
    }
    n.x = nx; n.y = ny;
    g.setAttribute('transform','translate('+n.x+','+n.y+')');
    // resolve all overlaps in this folder (multi-pass, like magnetic repulsion)
    if (n.folderPath) resolveOverlaps(n.folderPath);
    refreshEdges(n.id);
    // parent folder box tightly re-wraps around moved file
    if (n.folderPath) resizeParentBox(n.folderPath);
  });
}

function refreshEdges(nodeId) {
  edgeEls.forEach(ee => {
    if (ee.isF2F) return;
    const e = ee.data;
    if (e.source !== nodeId && e.target !== nodeId) return;

    // cross-folder edge in folder-view: one endpoint is a summary box anchor
    if (ee.extBox) {
      const eb = ee.extBox;
      const inNode = ee.srcInFocus ? e.s : e.t;
      const nc = nodeCenter(inNode);
      const boxOnRight = eb.x > W / 2;
      const bx = boxOnRight ? eb.x : eb.x + eb.w;
      const by = eb.y + eb.h / 2;
      const x1 = ee.srcInFocus ? nc.x : bx;
      const y1 = ee.srcInFocus ? nc.y : by;
      const x2 = ee.srcInFocus ? bx   : nc.x;
      const y2 = ee.srcInFocus ? by   : nc.y;
      ee.el.setAttribute('d', bezierPath(x1, y1, x2, y2));
      return;
    }

    // normal internal edge: both endpoints are file nodes
    const a1 = edgeAnchor(e.s, 'right'), a2 = edgeAnchor(e.t, 'left');
    ee.el.setAttribute('d', bezierPath(a1.x, a1.y, a2.x, a2.y));
  });
}

// ── special section box ───────────────────────────────
function drawSpecialSection(box, label, icon) {
  if (!box.w) return;
  const g = mkEl('g', {});
  const rect = mkEl('rect', {
    x:box.x, y:box.y, width:box.w, height:box.h, rx:12, ry:12,
    fill:box.color, 'fill-opacity':'0.06',
    stroke:box.color, 'stroke-width':'1.5', opacity:'0.7'
  });
  rect.classList.add('folder-box');
  const lbl = mkEl('text', {
    x:box.x+10, y:box.y+15,
    fill:box.color, 'font-size':'11', 'font-weight':'700', opacity:'0.8'
  });
  lbl.textContent = icon+' '+label;
  lbl.classList.add('folder-label');
  g.appendChild(rect); g.appendChild(lbl);
  vp.appendChild(g);
  folderEls['__special__'+label] = { box:rect, label:lbl, g };
}

// ── special node ──────────────────────────────────────
function specialColor(t) { return t==='css'?'#c586c0':t==='env'?'#dcdcaa':'#4ec9b0'; }
function specialIcon(t)  { return t==='css'?'🎨':t==='env'?'🔑':'🗄\uFE0F'; }

function drawSpecialNode(n) {
  const col = specialColor(n.nodeType);
  const nw  = Math.max(SPECIAL_NODE_W, n.fileName.length * 6.5 + 28);
  const nh  = SPECIAL_NODE_H;
  const g = mkEl('g', {
    class:'node special-node',
    transform:'translate('+n.x+','+n.y+')',
    style:'--nc:'+col
  });
  const bg = mkEl('rect', {
    x:0,y:0,width:nw,height:nh,rx:6,ry:6,
    fill:col,'fill-opacity':'0.18',stroke:col,'stroke-width':'1.5',class:'core'
  });
  const icon = mkEl('text',{x:6,y:19,'font-size':'13'});
  icon.textContent = specialIcon(n.nodeType);
  const txt = mkEl('text',{x:24,y:19});
  txt.textContent = n.fileName;
  g.appendChild(bg); g.appendChild(icon); g.appendChild(txt);
  vp.appendChild(g);
  nodeGroups.push({ el:g, data:n });

  g.addEventListener('mouseenter', ev => showSpecialTip(ev, n));
  g.addEventListener('mousemove',  ev => moveTip(ev));
  g.addEventListener('mouseleave', hideTip);
  g.addEventListener('click', ev => {
    ev.stopPropagation();
    if (ev.ctrlKey||ev.metaKey) vsapi.postMessage({command:'openFile',fileId:n.id});
    else selectNode(n.id);
  });
  let dragging=false;
  g.addEventListener('mousedown', ev=>{dragging=true;ev.stopPropagation();});
  window.addEventListener('mouseup',()=>{dragging=false;});
  window.addEventListener('mousemove', ev=>{
    if(!dragging)return;
    const r=svg.getBoundingClientRect();
    n.x=(ev.clientX-r.left-viewX)/viewScale;
    n.y=(ev.clientY-r.top -viewY)/viewScale;
    g.setAttribute('transform','translate('+n.x+','+n.y+')');
    refreshEdges(n.id);
  });
}
`;
}

function getJs3(): string {
    return `
// ═══════════════════════════════════════════════════════
// FOLDER DEEP-DIVE VIEW
// ═══════════════════════════════════════════════════════

function enterFolderView(fp) {
  viewMode    = 'folder';
  focusFolder = fp;

  // show breadcrumb
  breadcrumb.classList.add('visible');
  folderViewLabel.textContent = fp;

  renderFolderView(fp);
  fitView();
}

function exitFolderView() {
  viewMode    = 'root';
  focusFolder = null;
  breadcrumb.classList.remove('visible');
  fullReset(false);
  renderRoot();
  fitView();
}

// ── render FOLDER deep-dive ───────────────────────────
function renderFolderView(fp) {
  vp.innerHTML = '';
  edgeEls.length = 0;
  nodeGroups.length = 0;
  summaryEls = [];
  Object.keys(folderEls).forEach(k => delete folderEls[k]);

  const focusNodes = folderMap[fp] || [];
  const focusIds   = new Set(focusNodes.map(n => n.id));

  // ── layout: focus nodes fill most of the canvas ──────
  // Use layer-based horizontal layout so execution flow is readable
  const localLayerOf = {};
  focusNodes.forEach(n => localLayerOf[n.id] = 0);
  const localImpEdges = impEdges.filter(e => focusIds.has(e.source) && focusIds.has(e.target));
  for (let p = 0; p < Math.min(focusNodes.length, 60); p++) {
    let changed = false;
    for (const e of localImpEdges) {
      const prop = localLayerOf[e.source] + 1;
      if (localLayerOf[e.target] < prop) { localLayerOf[e.target] = prop; changed = true; }
    }
    if (!changed) break;
  }

  // group by layer
  const layerGroups = {};
  focusNodes.forEach(n => {
    const l = localLayerOf[n.id] || 0;
    (layerGroups[l] = layerGroups[l] || []).push(n);
  });
  const layerNums = Object.keys(layerGroups).map(Number).sort((a,b)=>a-b);
  const numLayers = layerNums.length || 1;

  // ── external box size constants (defined first so CENTER can use them) ──
  const EXT_BOX_W   = 175;
  const EXT_BOX_H   = 54;
  const EXT_GAP     = 10;
  const EXT_X_RIGHT = W - EXT_BOX_W - 8;   // flush right
  const EXT_X_LEFT  = 8;                    // flush left

  // ── focus node layout: strictly between the two side columns ──
  const CENTER_LEFT   = EXT_X_LEFT + EXT_BOX_W + 30;
  const CENTER_RIGHT  = EXT_X_RIGHT - 30;
  const centerW       = Math.max(CENTER_RIGHT - CENTER_LEFT, 200);
  const LAYER_X_START = CENTER_LEFT;
  const LAYER_STEP    = numLayers > 1 ? centerW / (numLayers - 1) : 0;
  const NODE_H_STEP   = 40;

  layerNums.forEach((l, li) => {
    const ns = layerGroups[l];
    const lx = LAYER_X_START + li * LAYER_STEP;
    ns.forEach((n, ni) => {
      const totalH = ns.length * NODE_H_STEP;
      n.x = lx;
      n.y = (H/2 - totalH/2) + ni * NODE_H_STEP;
    });
  });

  // ── ALL external folders shown as summary boxes ────────
  const connectedFolderSet = new Set();
  edges.forEach(e => {
    const sf = e.s.folderPath || '(root)';
    const tf = e.t.folderPath || '(root)';
    if (focusIds.has(e.source) && !focusIds.has(e.target) && tf !== fp) connectedFolderSet.add(tf);
    if (focusIds.has(e.target) && !focusIds.has(e.source) && sf !== fp) connectedFolderSet.add(sf);
  });

  const extFolders = folders.filter(f => f !== fp).sort();

  // How many boxes fit in one column
  const usableH   = H - 80;
  const perCol    = Math.max(1, Math.floor(usableH / (EXT_BOX_H + EXT_GAP)));

  const rightFolders = extFolders.slice(0, perCol);
  const leftFolders  = extFolders.slice(perCol, perCol * 2);

  const extBoxes = {};

  rightFolders.forEach((efp, i) => {
    extBoxes[efp] = {
      x: EXT_X_RIGHT,
      y: 60 + i * (EXT_BOX_H + EXT_GAP),
      w: EXT_BOX_W, h: EXT_BOX_H,
      color: connectedFolderSet.has(efp) ? folderColor(efp) : '#555566',
      connected: connectedFolderSet.has(efp)
    };
  });

  leftFolders.forEach((efp, i) => {
    extBoxes[efp] = {
      x: EXT_X_LEFT,
      y: 60 + i * (EXT_BOX_H + EXT_GAP),
      w: EXT_BOX_W, h: EXT_BOX_H,
      color: connectedFolderSet.has(efp) ? folderColor(efp) : '#555566',
      connected: connectedFolderSet.has(efp)
    };
  });

  // any remaining beyond 2 columns — stack below right column
  extFolders.slice(perCol * 2).forEach((efp, i) => {
    extBoxes[efp] = {
      x: EXT_X_RIGHT,
      y: 60 + (perCol + i) * (EXT_BOX_H + EXT_GAP),
      w: EXT_BOX_W, h: EXT_BOX_H,
      color: connectedFolderSet.has(efp) ? folderColor(efp) : '#555566',
      connected: connectedFolderSet.has(efp)
    };
  });

  // ── draw folder box for the FOCUSED folder ────────────
  // compute bounding box of focus nodes
  const allFX = focusNodes.map(n => n.x);
  const allFY = focusNodes.map(n => n.y);
  const fMinX = Math.min(...allFX) - 30;
  const fMinY = Math.min(...allFY) - 44;
  const fMaxX = Math.max(...allFX) + Math.max(...focusNodes.map(n=>nodeW(n))) + 30;
  const fMaxY = Math.max(...allFY) + nodeH() + 30;
  const focusColor = folderColor(fp);

  const focusBoxRect = mkEl('rect', {
    x: fMinX, y: fMinY,
    width:  fMaxX - fMinX,
    height: fMaxY - fMinY,
    rx:12, ry:12,
    fill: focusColor, 'fill-opacity':'0.06',
    stroke: focusColor, 'stroke-width':'2', opacity:'0.8'
  });
  focusBoxRect.classList.add('folder-box', 'active');
  const focusBoxLbl = mkEl('text', {
    x: fMinX + 14, y: fMinY + 18,
    fill: focusColor, 'font-size':'13','font-weight':'700', opacity:'0.9'
  });
  focusBoxLbl.textContent = '📁 ' + fp;
  vp.appendChild(focusBoxRect);
  vp.appendChild(focusBoxLbl);

  // ── draw external summary boxes (ALL folders) ────────
  extFolders.forEach(efp => {
    const eb = extBoxes[efp];
    const col = eb.color;
    const isConnected = eb.connected;
    const fileCount = (folderMap[efp] || []).length;
    const g = mkEl('g', { class:'summary-box', style:'cursor:pointer' });

    const rect = mkEl('rect', {
      x:eb.x, y:eb.y, width:eb.w, height:eb.h,
      rx:8, ry:8,
      fill: col, 'fill-opacity': isConnected ? '0.14' : '0.04',
      stroke: col, 'stroke-width': isConnected ? '1.5' : '0.8',
      opacity: isConnected ? '1' : '0.4'
    });

    const icon = mkEl('text', {x:eb.x+8, y:eb.y+20, 'font-size':'13'});
    icon.textContent = '📁';

    const lbl = mkEl('text', {
      x:eb.x+26, y:eb.y+20,
      fill: col, 'font-size':'11', 'font-weight': isConnected ? '700' : '400',
      opacity: isConnected ? '0.95' : '0.45'
    });
    lbl.textContent = efp.length > 20 ? efp.slice(0,18)+'…' : efp;

    const sub = mkEl('text', {x:eb.x+8, y:eb.y+36, 'font-size':'9',
      fill: isConnected ? '#aaa' : '#666', opacity:'0.8'});
    sub.textContent = fileCount + ' file' + (fileCount!==1?'s':'') +
      (isConnected ? ' · connected' : ' · no direct link') +
      ' · dbl-click';

    // connected badge
    if (isConnected) {
      const badge = mkEl('rect', {
        x: eb.x + eb.w - 22, y: eb.y + 4, width:18, height:12,
        rx:4, fill: col, 'fill-opacity':'0.3', stroke:col,'stroke-width':'0.8'
      });
      const badgeTxt = mkEl('text', {
        x: eb.x + eb.w - 13, y: eb.y + 14,
        'font-size':'8', fill:col, 'text-anchor':'middle', 'font-weight':'700'
      });
      const connCount = edges.filter(e =>
        (focusIds.has(e.source) && (e.t.folderPath||'(root)') === efp) ||
        (focusIds.has(e.target) && (e.s.folderPath||'(root)') === efp)
      ).length;
      badgeTxt.textContent = connCount + '';
      g.appendChild(badge); g.appendChild(badgeTxt);
    }

    g.appendChild(rect); g.appendChild(icon); g.appendChild(lbl); g.appendChild(sub);
    vp.appendChild(g);
    summaryEls.push({ el:g, fp:efp, box:eb });

    g.addEventListener('mouseenter', ev => {
      const connEdges = edges.filter(e =>
        (focusIds.has(e.source) && (e.t.folderPath||'(root)') === efp) ||
        (focusIds.has(e.target) && (e.s.folderPath||'(root)') === efp)
      );
      tip.innerHTML = '<b>📁 '+efp+'</b>' +
        (isConnected
          ? ' <span style="color:#4ec9b0">● connected</span>'
          : ' <span style="color:#666">○ no direct link</span>') +
        '<br/><span class="mt">'+fileCount+' files</span>' +
        (connEdges.length ? '<br/><span class="fn">'+connEdges.length+' edge'+(connEdges.length>1?'s':'')+'</span>' : '') +
        '<br/><span class="hint">Dbl-click to explore</span>';
      tip.style.display='block'; moveTip(ev);
    });
    g.addEventListener('mousemove', moveTip);
    g.addEventListener('mouseleave', hideTip);
    g.addEventListener('dblclick', ev => { ev.stopPropagation(); enterFolderView(efp); });
  });

  // ── draw edges ────────────────────────────────────────
  // (a) internal edges: both endpoints in focus folder
  edges.forEach(e => {
    if (!focusIds.has(e.source) || !focusIds.has(e.target)) return;
    const sc = nodeCenter(e.s), tc = nodeCenter(e.t);
    let cls,mid,dotS;
    if      (e.type==='import')     {cls='edge-import';    mid='arr-import';dotS='dot-import';}
    else if (e.type==='call')       {cls='edge-call';      mid='arr-call';  dotS='dot-call';}
    else if (e.type==='css-import') {cls='edge-css-import';mid='arr-css';   dotS='dot-css';}
    else if (e.type==='env-use')    {cls='edge-env-use';   mid='arr-env';   dotS='dot-env';}
    else if (e.type==='db-use')     {cls='edge-db-use';    mid='arr-db';    dotS='dot-db';}
    else if (e.type==='api-call')   {cls='edge-api-call';  mid='arr-api';   dotS='dot-api';}
    else                            {cls='edge-import';    mid='arr-import';dotS='dot-import';}
    const p = mkEl('path',{
      d: bezierPath(sc.x,sc.y,tc.x,tc.y), class:cls,
      'marker-start':'url(#'+dotS+')','marker-end':'url(#'+mid+')'
    });
    vp.insertBefore(p, vp.firstChild);
    edgeEls.push({el:p, data:e, isF2F:false});
  });

  // (b) cross-folder edges: one endpoint in focus, other in external folder
  edges.forEach(e => {
    const srcInFocus = focusIds.has(e.source);
    const tgtInFocus = focusIds.has(e.target);
    if (srcInFocus === tgtInFocus) return;  // both in or both out
    const inNode  = srcInFocus ? e.s : e.t;
    const outNode = srcInFocus ? e.t : e.s;
    const outFp   = outNode.folderPath || '(root)';
    if (!extBoxes[outFp]) return;
    const eb = extBoxes[outFp];
    const nc = nodeCenter(inNode);
    // right-side boxes → anchor from left edge; left-side boxes → anchor from right edge
    const boxOnRight = eb.x > W / 2;
    const bx = boxOnRight ? eb.x : eb.x + eb.w;
    const by = eb.y + eb.h/2;
    const x1 = srcInFocus ? nc.x : bx;
    const y1 = srcInFocus ? nc.y : by;
    const x2 = srcInFocus ? bx   : nc.x;
    const y2 = srcInFocus ? by   : nc.y;

    let cls,mid,dotS;
    if      (e.type==='import')     {cls='edge-import';    mid='arr-import';dotS='dot-import';}
    else if (e.type==='call')       {cls='edge-call';      mid='arr-call';  dotS='dot-call';}
    else if (e.type==='css-import') {cls='edge-css-import';mid='arr-css';   dotS='dot-css';}
    else if (e.type==='env-use')    {cls='edge-env-use';   mid='arr-env';   dotS='dot-env';}
    else if (e.type==='db-use')     {cls='edge-db-use';    mid='arr-db';    dotS='dot-db';}
    else if (e.type==='api-call')   {cls='edge-api-call';  mid='arr-api';   dotS='dot-api';}
    else                            {cls='edge-import';    mid='arr-import';dotS='dot-import';}
    const p = mkEl('path',{
      d: bezierPath(x1,y1,x2,y2), class:cls,
      'stroke-opacity':'0.55',
      'marker-start':'url(#'+dotS+')','marker-end':'url(#'+mid+')'
    });
    vp.insertBefore(p, vp.firstChild);
    // store extBox + direction so refreshEdges can recompute correctly on drag
    edgeEls.push({el:p, data:e, isF2F:false, extBox:eb, srcInFocus});
  });

  // ── draw focus folder's file nodes ────────────────────
  focusNodes.forEach(n => drawFileNode(n));

  // ── wire interactions for folder view ─────────────────
  wireFolderViewInteractions();
}

function wireFolderViewInteractions() {
  // edge clicks
  edgeEls.forEach((ee, idx) => {
    ee.el.style.cursor='pointer';
    ee.el.addEventListener('click', ev => { ev.stopPropagation(); selectEdge(idx); });
    ee.el.addEventListener('mouseenter', ev => {
      const d = ee.data;
      tip.innerHTML = '<b>'+(d.s?d.s.fileName:d.source)+'</b> &rarr; <b>'+(d.t?d.t.fileName:d.target)+'</b><br/>'+
        '<span class="mt">'+d.type+(d.importedSymbols&&d.importedSymbols.length?': '+d.importedSymbols.slice(0,6).join(', '):
          d.type==='api-call'?' &middot; <span style="color:#ff66cc">'+d.apiMethod+' '+d.apiUrl+'</span>':'')+'</span>'+
        '<br/><span class="hint">Click to isolate</span>';
      tip.style.display='block'; moveTip(ev);
    });
    ee.el.addEventListener('mousemove', moveTip);
    ee.el.addEventListener('mouseleave', hideTip);
  });
}
`;
}

function getJs4(): string {
    return `
// ═══════════════════════════════════════════════════════
// PAN / ZOOM
// ═══════════════════════════════════════════════════════
let viewX=0, viewY=0, viewScale=1;
let initVX=0, initVY=0, initVS=1;

function applyVP(animated) {
  if (animated) {
    vp.classList.add('animate');
    setTimeout(()=>vp.classList.remove('animate'),600);
  }
  vp.setAttribute('transform','translate('+viewX+','+viewY+') scale('+viewScale+')');
  zoomLbl.textContent = Math.round(viewScale*100)+'%';
}

function fitView() {
  const allX = nodes.map(n=>n.x), allY = nodes.map(n=>n.y);
  if (!allX.length) return;
  const minX=Math.min(...allX), maxX=Math.max(...allX)+120;
  const minY=Math.min(...allY), maxY=Math.max(...allY)+30;
  const scaleX=W/(maxX-minX+80), scaleY=H/(maxY-minY+80);
  viewScale=Math.min(scaleX,scaleY,1.4);
  viewX=W/2-((minX+maxX)/2)*viewScale;
  viewY=H/2-((minY+maxY)/2)*viewScale;
  initVX=viewX; initVY=viewY; initVS=viewScale;
  applyVP(false);
}

svg.addEventListener('wheel', ev=>{
  ev.preventDefault();
  const r=svg.getBoundingClientRect();
  const mx=ev.clientX-r.left, my=ev.clientY-r.top;
  const zf=ev.deltaY<0?1.12:0.89;
  const ns=Math.min(6,Math.max(0.08,viewScale*zf));
  viewX=mx-(mx-viewX)*(ns/viewScale);
  viewY=my-(my-viewY)*(ns/viewScale);
  viewScale=ns;
  applyVP(false);
},{passive:false});

let panning=false,panSX=0,panSY=0,vxS=0,vyS=0,panMoved=false;
svg.addEventListener('mousedown', ev=>{
  if (ev.target===svg||ev.target===vp) {
    panning=true; panMoved=false;
    panSX=ev.clientX; panSY=ev.clientY;
    vxS=viewX; vyS=viewY;
    svg.style.cursor='grabbing';
  }
});
window.addEventListener('mousemove', ev=>{
  if (!panning) return;
  const dx=ev.clientX-panSX, dy=ev.clientY-panSY;
  if (Math.abs(dx)>3||Math.abs(dy)>3) panMoved=true;
  viewX=vxS+dx; viewY=vyS+dy;
  applyVP(false);
});
window.addEventListener('mouseup',()=>{ panning=false; svg.style.cursor='grab'; });

// ═══════════════════════════════════════════════════════
// HIGHLIGHT / ISOLATION STATE
// ═══════════════════════════════════════════════════════
let activeId=null, activeFp=null, activeEdgeIdx=null;

function markerUrl(type, state) {
  if (type==='f2f')        return 'url(#arr-f2f'    +(state?'-'+state:'')+')';
  if (type==='css-import') return 'url(#arr-css)';
  if (type==='env-use')    return 'url(#arr-env)';
  if (type==='db-use')     return 'url(#arr-db)';
  if (type==='api-call')   return 'url(#arr-api'    +(state?'-'+state:'')+')';
  const b = type==='import'?'arr-import':'arr-call';
  return 'url(#'+b+(state?'-'+state:'')+')';
}
function dotUrl(type, state) {
  const s = state==='act'?'-act':state==='dim'?'-dim':'';
  if (type==='f2f')        return 'url(#dot-f2f'+s+')';
  if (type==='css-import') return 'url(#dot-css)';
  if (type==='env-use')    return 'url(#dot-env)';
  if (type==='db-use')     return 'url(#dot-db)';
  if (type==='api-call')   return 'url(#dot-api'+s+')';
  const b = type==='import'?'dot-import':'dot-call';
  return 'url(#'+b+s+')';
}

function fullReset(animated) {
  activeId=null; activeFp=null; activeEdgeIdx=null;
  nodeGroups.forEach(ng=>ng.el.classList.remove('dim','active'));
  edgeEls.forEach(ee=>{
    ee.el.classList.remove('dim','active');
    const t=ee.isF2F?'f2f':ee.data.type;
    ee.el.setAttribute('marker-end',   markerUrl(t,null));
    ee.el.setAttribute('marker-start', dotUrl(t,null));
  });
  Object.values(folderEls).forEach(fe=>{
    if(fe.box){fe.box.classList.remove('dim','active');}
    if(fe.label){fe.label.classList.remove('dim','active');}
  });
  summaryEls.forEach(se=>se.el.classList.remove('dim'));
  if (animated) { viewX=initVX; viewY=initVY; viewScale=initVS; applyVP(true); }
}

function applyHighlight(keepNodes, keepEdgeIdxs, keepFolders, focusNode) {
  nodeGroups.forEach(ng=>{
    const keep=keepNodes.has(ng.data.id);
    ng.el.classList.toggle('dim',!keep);
    ng.el.classList.toggle('active',ng.data.id===(focusNode||''));
  });
  edgeEls.forEach((ee,idx)=>{
    const keep=keepEdgeIdxs.has(idx);
    ee.el.classList.toggle('dim',!keep);
    ee.el.classList.toggle('active',keep);
    const t=ee.isF2F?'f2f':ee.data.type;
    ee.el.setAttribute('marker-end',   markerUrl(t,keep?'act':'dim'));
    ee.el.setAttribute('marker-start', dotUrl(t,keep?'act':'dim'));
  });
  Object.keys(folderEls).forEach(fp=>{
    const fe=folderEls[fp]; if(!fe||!fe.box)return;
    const keep=keepFolders.has(fp);
    fe.box.classList.toggle('dim',!keep);
    fe.box.classList.toggle('active',keep);
    if(fe.label){fe.label.classList.toggle('dim',!keep);fe.label.classList.toggle('active',keep);}
  });
  summaryEls.forEach(se=>{
    se.el.classList.toggle('dim', !keepFolders.has(se.fp));
  });
}

function selectNode(id) {
  hideTip();
  if (activeId===id) { fullReset(true); return; }
  activeId=id; activeFp=null; activeEdgeIdx=null;
  const keepNodes=new Set([id]);
  const keepFolders=new Set();
  const keepEdges=new Set();
  const n=byId[id];
  if(n) keepFolders.add(n.folderPath||'(root)');
  edgeEls.forEach((ee,idx)=>{
    if(!ee.isF2F&&(ee.data.source===id||ee.data.target===id)){
      keepEdges.add(idx);
      keepNodes.add(ee.data.source);
      keepNodes.add(ee.data.target);
    }
  });
  keepNodes.forEach(nid=>{
    const nd=byId[nid]; if(nd)keepFolders.add(nd.folderPath||'(root)');
  });
  edgeEls.forEach((ee,idx)=>{
    if(ee.isF2F&&keepFolders.has(ee.sf)&&keepFolders.has(ee.tf))keepEdges.add(idx);
  });
  applyHighlight(keepNodes,keepEdges,keepFolders,id);
}

function selectFolder(fp) {
  hideTip();
  if (activeFp===fp) { fullReset(true); return; }
  activeId=null; activeFp=fp; activeEdgeIdx=null;
  const keepNodes=new Set((folderMap[fp]||[]).map(n=>n.id));
  const keepFolders=new Set([fp]);
  const keepEdges=new Set();
  edgeEls.forEach((ee,idx)=>{
    if(!ee.isF2F&&(keepNodes.has(ee.data.source)||keepNodes.has(ee.data.target))){
      keepEdges.add(idx);
      keepNodes.add(ee.data.source);
      keepNodes.add(ee.data.target);
    }
  });
  keepNodes.forEach(nid=>{
    const nd=byId[nid]; if(nd)keepFolders.add(nd.folderPath||'(root)');
  });
  edgeEls.forEach((ee,idx)=>{
    if(ee.isF2F&&keepFolders.has(ee.sf)&&keepFolders.has(ee.tf))keepEdges.add(idx);
  });
  applyHighlight(keepNodes,keepEdges,keepFolders,'');
}

function selectEdge(idx) {
  hideTip();
  if (activeEdgeIdx===idx) { fullReset(true); return; }
  activeId=null; activeFp=null; activeEdgeIdx=idx;
  const ee=edgeEls[idx];
  const keepNodes=new Set();
  const keepFolders=new Set();
  const keepEdges=new Set([idx]);
  if (ee.isF2F) {
    keepFolders.add(ee.sf); keepFolders.add(ee.tf);
    (folderMap[ee.sf]||[]).forEach(n=>keepNodes.add(n.id));
    (folderMap[ee.tf]||[]).forEach(n=>keepNodes.add(n.id));
  } else {
    keepNodes.add(ee.data.source); keepNodes.add(ee.data.target);
    const ns=byId[ee.data.source],nt=byId[ee.data.target];
    if(ns)keepFolders.add(ns.folderPath||'(root)');
    if(nt)keepFolders.add(nt.folderPath||'(root)');
  }
  applyHighlight(keepNodes,keepEdges,keepFolders,'');
}

// ═══════════════════════════════════════════════════════
// ROOT VIEW INTERACTIONS (folder click/dblclick/drag)
// ═══════════════════════════════════════════════════════
function wireRootInteractions() {
  // edge click + tooltip
  edgeEls.forEach((ee,idx)=>{
    ee.el.style.cursor='pointer';
    ee.el.addEventListener('click',ev=>{ev.stopPropagation();selectEdge(idx);});
    ee.el.addEventListener('mouseenter',ev=>{
      const d=ee.data;
      let html='';
      if(ee.isF2F){
        html='<b>'+d.sf+'</b> &harr; <b>'+d.tf+'</b><br/><span class="mt">folder-to-folder &middot; '+d.count+' connection'+(d.count>1?'s':'')+'</span>';
      } else {
        html='<b>'+(d.s?d.s.fileName:d.source)+'</b> &rarr; <b>'+(d.t?d.t.fileName:d.target)+'</b><br/>'+
          '<span class="mt">'+d.type+(d.importedSymbols&&d.importedSymbols.length?': '+d.importedSymbols.slice(0,6).join(', '):
            d.type==='api-call'?' &middot; <span style="color:#ff66cc">'+d.apiMethod+' '+d.apiUrl+'</span>':'')+'</span>'+
          '<br/><span class="hint">Click to isolate</span>';
      }
      tip.innerHTML=html; tip.style.display='block'; moveTip(ev);
    });
    ee.el.addEventListener('mousemove',moveTip);
    ee.el.addEventListener('mouseleave',hideTip);
  });

  // folder box: single click = isolate, double click = collapse/expand, drag = move subtree
  Object.keys(folderEls).forEach(fp=>{
    if (fp.startsWith('__special__')) return;
    const fe=folderEls[fp];
    if(!fe||!fe.box)return;
    fe.box.style.pointerEvents='all';
    fe.box.style.cursor='pointer';

    let fDragging=false,fDragStartX=0,fDragStartY=0;
    let fBoxStarts={};   // fp -> {x,y} for all boxes in subtree
    let fNodeStarts=[];  // all files in subtree

    fe.box.addEventListener('mousedown',ev=>{
      fDragging=true;
      fDragStartX=ev.clientX; fDragStartY=ev.clientY;
      fBoxStarts={};
      const allDesc=[fp,...getAllDescendantFolders(fp)];
      allDesc.forEach(f=>{ if(fboxes[f]) fBoxStarts[f]={x:fboxes[f].x,y:fboxes[f].y}; });
      fNodeStarts=getAllFilesUnder(fp).map(n=>({n,x:n.x,y:n.y}));
      ev.stopPropagation();
    });

    window.addEventListener('mousemove',ev=>{
      if(!fDragging)return;
      let dx=(ev.clientX-fDragStartX)/viewScale;
      let dy=(ev.clientY-fDragStartY)/viewScale;
      const fb=fboxes[fp];
      if(!fb) return;

      // ── CHILD FOLDER: clamp inside parent, then resize parent ──
      if(fb.depth>0){
        const parentFp=folderParent(fp);
        const pfb=fboxes[parentFp];
        if(pfb){
          // bounds: child box must stay fully inside parent content area
          const minX=pfb.x+FPAD;
          const maxX=pfb.x+pfb.w-FPAD-fb.w;
          const minY=pfb.y+LABEL_H+FPAD;
          const maxY=pfb.y+pfb.h-FPAD-fb.h;
          const newX=Math.max(minX,Math.min(maxX,fBoxStarts[fp].x+dx));
          const newY=Math.max(minY,Math.min(maxY,fBoxStarts[fp].y+dy));
          dx=newX-fBoxStarts[fp].x;
          dy=newY-fBoxStarts[fp].y;
        }
        // move this box + all its descendants + its files
        const allDesc=[fp,...getAllDescendantFolders(fp)];
        allDesc.forEach(f=>{
          const cfb=fboxes[f], st=fBoxStarts[f];
          if(!cfb||!st)return;
          cfb.x=st.x+dx; cfb.y=st.y+dy;
          updateFolderElPositions(f);
        });
        fNodeStarts.forEach(({n,x,y})=>{
          n.x=x+dx; n.y=y+dy;
          const ng=nodeGroups.find(g=>g.data.id===n.id);
          if(ng)ng.el.setAttribute('transform','translate('+n.x+','+n.y+')');
        });
        // resize parent box to tightly wrap all its children + files
        resizeParentBox(folderParent(fp));
      } else {
        // ── TOP-LEVEL FOLDER: move entire subtree ──
        const allDesc=[fp,...getAllDescendantFolders(fp)];
        allDesc.forEach(f=>{
          const cfb=fboxes[f],st=fBoxStarts[f];
          if(!cfb||!st)return;
          cfb.x=st.x+dx; cfb.y=st.y+dy;
          updateFolderElPositions(f);
        });
        fNodeStarts.forEach(({n,x,y})=>{
          n.x=x+dx; n.y=y+dy;
          const ng=nodeGroups.find(g=>g.data.id===n.id);
          if(ng)ng.el.setAttribute('transform','translate('+n.x+','+n.y+')');
        });
      }

      // live-update all edges
      redrawAllEdgesLive();
    });

    window.addEventListener('mouseup',ev=>{
      if(!fDragging)return;
      fDragging=false;
      const dx=ev.clientX-fDragStartX,dy=ev.clientY-fDragStartY;
      if(Math.abs(dx)<5&&Math.abs(dy)<5) selectFolder(fp);
    });

    // double-click: top-level = deep-dive, child = collapse/expand
    fe.box.addEventListener('dblclick',ev=>{
      ev.stopPropagation();
      const fb=fboxes[fp];
      if(fb&&fb.depth===0) enterFolderView(fp);
      else setFolderCollapsed(fp,!collapsedFolders.has(fp));
    });
    if(fe.chevron){
      fe.chevron.style.pointerEvents='all';
      fe.chevron.addEventListener('dblclick',ev=>{
        ev.stopPropagation();
        const fb=fboxes[fp];
        if(fb&&fb.depth===0) enterFolderView(fp);
        else setFolderCollapsed(fp,!collapsedFolders.has(fp));
      });
    }
    if(fe.label){
      fe.label.style.pointerEvents='all';
      fe.label.addEventListener('dblclick',ev=>{
        ev.stopPropagation();
        const fb=fboxes[fp];
        if(fb&&fb.depth===0) enterFolderView(fp);
        else setFolderCollapsed(fp,!collapsedFolders.has(fp));
      });
    }

    // hover tooltip
    fe.box.addEventListener('mouseenter',ev=>{
      const allFiles=getAllFilesUnder(fp);
      const fb=fboxes[fp];
      tip.innerHTML='<b>📁 '+fp+'</b><br/>'+
        '<span class="mt">'+allFiles.length+' file'+(allFiles.length!==1?'s':'')+
        (fb&&fb.depth>0?' &middot; sub-folder':'')+
        (collapsedFolders.has(fp)?' &middot; collapsed':'')+'</span>'+
        '<br/><span class="hint">Click = isolate &middot; '+(fb&&fb.depth===0?'Dbl-click = explore':'Dbl-click = collapse/expand')+'</span>';
      tip.style.display='block'; moveTip(ev);
    });
    fe.box.addEventListener('mousemove',moveTip);
    fe.box.addEventListener('mouseleave',hideTip);
  });
}

// ═══════════════════════════════════════════════════════
// TOOLTIP
// ═══════════════════════════════════════════════════════
function showTip(ev,n) {
  const fns=(n.functions||[]).slice(0,10).map(f=>f.name).join(', ');
  tip.innerHTML=
    '<b>'+n.fileName+'</b>'+
    (entryIds.has(n.id)?' <span style="color:#ffd700">&#9733; entry</span>':'')+
    (unusedIds.has(n.id)?' <span style="color:#e05555">&#9888; unused</span>':'')+
    (n.dbUsage&&n.dbUsage.length?' <span style="color:#4ec9b0">🗄\uFE0F '+n.dbUsage.join(', ')+'</span>':'')+
    '<br/><span class="mt">'+(n.folderPath||'(root)')+'</span><br/>'+
    'LOC: '+n.loc+' &nbsp; Functions: '+(n.functions?n.functions.length:0)+
    ' &nbsp; Imports: '+(n.imports?n.imports.length:0)+
    (fns?'<br/><span class="fn">'+fns+'</span>':'')+
    '<br/><span class="hint">&#8984;/Ctrl+Click to open file</span>';
  tip.style.display='block'; moveTip(ev);
}
function showSpecialTip(ev,n) {
  let body='';
  if(n.nodeType==='css'){
    const classes=(n.cssClasses||[]).slice(0,15).join(', ');
    body='Classes: '+(n.cssClasses?n.cssClasses.length:0)+
      (classes?'<br/><span class="fn">'+classes+'</span>':'')+
      (n.cssImports&&n.cssImports.length?'<br/>@imports: '+n.cssImports.join(', '):'');
  } else if(n.nodeType==='env'){
    body='Total keys: '+(n.envKeys?n.envKeys.length:0)+
      '<br/><span style="color:#4ec9b0">DB keys: '+((n.envDbKeys||[]).join(', ')||'—')+'</span>'+
      '<br/><span style="color:#ce9178">API keys: '+((n.envApiKeys||[]).join(', ')||'—')+'</span>'+
      '<br/><span class="mt">(values hidden)</span>';
  } else if(n.nodeType==='database'){
    body=(n.dbTables&&n.dbTables.length?'Tables: <span class="fn">'+n.dbTables.join(', ')+'</span><br/>':'')+
         (n.dbModels&&n.dbModels.length?'Models: <span class="fn">'+n.dbModels.join(', ')+'</span>':'');
  }
  tip.innerHTML='<b>'+specialIcon(n.nodeType)+' '+n.fileName+'</b>'+
    '<br/><span class="mt">'+n.nodeType.toUpperCase()+' &middot; LOC: '+n.loc+'</span>'+
    '<br/>'+body+'<br/><span class="hint">Ctrl+Click to open</span>';
  tip.style.display='block'; moveTip(ev);
}
function moveTip(ev) { tip.style.left=(ev.clientX+16)+'px'; tip.style.top=(ev.clientY+14)+'px'; }
function hideTip()   { tip.style.display='none'; }

// ═══════════════════════════════════════════════════════
// GLOBAL WIRING
// ═══════════════════════════════════════════════════════
backBtn.addEventListener('click', ()=>exitFolderView());

svg.addEventListener('click',()=>{
  if(panMoved){panMoved=false;return;}
  if(activeId||activeFp||activeEdgeIdx!==null)fullReset(false);
});
resetBtn.addEventListener('click',()=>{
  fullReset(false);
  viewX=initVX; viewY=initVY; viewScale=initVS; applyVP(true);
});

// ── BOOTSTRAP ─────────────────────────────────────────
renderRoot();
`;
}
