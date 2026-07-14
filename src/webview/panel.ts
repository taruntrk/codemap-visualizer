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
  border:1px solid #3c3c5a; max-width:460px; line-height:1.7;
}
.legend-dot { display:inline-block; width:10px; height:10px; border-radius:50%; margin-right:5px; vertical-align:middle; }
.legend-line { display:inline-block; width:18px; height:0; border-top:2px solid; margin-right:6px; vertical-align:middle; }
#resetBtn {
  margin-top:6px; background:#0e639c; border:none; color:#fff;
  padding:4px 12px; border-radius:5px; cursor:pointer; font-size:11px;
}
#resetBtn:hover { background:#1177bb; }
svg { width:100vw; height:100vh; display:block; cursor:grab; }
#viewport.animate { transition:transform 0.55s cubic-bezier(0.22,1,0.36,1); }

/* folder boxes */
.folder-box { fill:none; rx:10; ry:10; stroke-width:1.5px; opacity:0.18; pointer-events:none; transition:opacity 0.35s, filter 0.35s, height 0.3s; }
.folder-box.active { opacity:0.6; filter:drop-shadow(0 0 10px currentColor); }
.folder-box.dim { opacity:0.04; }
.folder-box:hover { opacity:0.4; cursor:grab; }
.folder-label { font-size:11px; font-weight:700; pointer-events:none; opacity:0.7; transition:opacity 0.35s; }
.folder-label.dim { opacity:0.08; }

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
.node.unused rect.core { fill:#ff000022 !important; stroke:#e05555 !important; stroke-width:1.5px !important; }
.node.unused text { fill:#ff9090; }
.node text { fill:#e0e0e0; font-size:10px; pointer-events:none; }

/* folder-to-folder edges */
.f2f-edge { fill:none; stroke-width:1.5px; opacity:0.3; transition:opacity 0.4s, filter 0.4s, stroke-width 0.4s; }
.f2f-edge.active { opacity:0.85; filter:drop-shadow(0 0 5px currentColor); }
.f2f-edge.dim { opacity:0.03; }

/* file edges */
.edge-import { stroke:#569cd6; stroke-width:0.8px; opacity:0.4; fill:none; transition:opacity 0.4s,stroke-width 0.4s,filter 0.4s; }
.edge-call   { stroke:#ce9178; stroke-width:0.7px; stroke-dasharray:4,3; opacity:0.3; fill:none; transition:opacity 0.4s,stroke-width 0.4s,filter 0.4s; }
.edge-import.active { stroke-width:1.8px; opacity:0.95; filter:drop-shadow(0 0 4px #569cd6); }
.edge-call.active   { stroke-width:1.4px; opacity:0.9;  filter:drop-shadow(0 0 4px #ce9178); }
.edge-import.dim, .edge-call.dim { opacity:0.03; }

/* special edges */
.edge-css-import { stroke:#c586c0; stroke-width:0.8px; stroke-dasharray:5,3; opacity:0.4; fill:none; transition:opacity 0.4s,stroke-width 0.4s; }
.edge-env-use    { stroke:#dcdcaa; stroke-width:0.8px; stroke-dasharray:3,3; opacity:0.4; fill:none; transition:opacity 0.4s,stroke-width 0.4s; }
.edge-db-use     { stroke:#4ec9b0; stroke-width:1px;   opacity:0.45; fill:none; transition:opacity 0.4s,stroke-width 0.4s; }
.edge-css-import.active { stroke-width:1.6px; opacity:0.9; filter:drop-shadow(0 0 4px #c586c0); }
.edge-env-use.active    { stroke-width:1.6px; opacity:0.9; filter:drop-shadow(0 0 4px #dcdcaa); }
.edge-db-use.active     { stroke-width:2px;   opacity:0.95; filter:drop-shadow(0 0 5px #4ec9b0); }
.edge-css-import.dim, .edge-env-use.dim, .edge-db-use.dim { opacity:0.03; }

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
  <div><span class="legend-dot" style="background:#ffd700;border:1px solid #ffd700"></span><b>Gold border</b> = entry &nbsp;
       <span class="legend-dot" style="background:#e05555"></span><b style="color:#ff9090">Red</b> = unused &nbsp;
       <span class="legend-dot" style="background:#c586c0"></span>CSS &nbsp;
       <span class="legend-dot" style="background:#dcdcaa"></span>ENV &nbsp;
       <span class="legend-dot" style="background:#4ec9b0"></span>DB</div>
  <div><span class="legend-line" style="border-color:#569cd6"></span>Import &nbsp;
       <span class="legend-line" style="border-color:#ce9178;border-style:dashed"></span>Call &nbsp;
       <span class="legend-line" style="border-color:#4ec9b0"></span>DB use &nbsp;
       <span class="legend-line" style="border-color:#dcdcaa;border-style:dashed"></span>Env use</div>
  <div style="opacity:0.6;font-size:11px;">Click = isolate &middot; <b>Dbl-click folder</b> = collapse/expand &middot; <b>Ctrl+Click</b> = open file &middot; Drag node/folder &middot; Scroll = zoom</div>
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
    <marker id="dot-f2f"        viewBox="0 0 10 10" refX="5" refY="5" markerWidth="4" markerHeight="4" orient="auto"><circle cx="5" cy="5" r="3.5" fill="#c586c0"/></marker>
    <marker id="dot-f2f-act"    viewBox="0 0 10 10" refX="5" refY="5" markerWidth="5" markerHeight="5" orient="auto"><circle cx="5" cy="5" r="3.5" fill="#e8b4e8"/></marker>
    <marker id="dot-f2f-dim"    viewBox="0 0 10 10" refX="5" refY="5" markerWidth="4" markerHeight="4" orient="auto"><circle cx="5" cy="5" r="3.5" fill="#c586c0" opacity="0.08"/></marker>
    <marker id="dot-css"        viewBox="0 0 10 10" refX="5" refY="5" markerWidth="4" markerHeight="4" orient="auto"><circle cx="5" cy="5" r="3.5" fill="#c586c0"/></marker>
    <marker id="dot-env"        viewBox="0 0 10 10" refX="5" refY="5" markerWidth="4" markerHeight="4" orient="auto"><circle cx="5" cy="5" r="3.5" fill="#dcdcaa"/></marker>
    <marker id="dot-db"         viewBox="0 0 10 10" refX="5" refY="5" markerWidth="4" markerHeight="4" orient="auto"><circle cx="5" cy="5" r="3.5" fill="#4ec9b0"/></marker>
    <marker id="arr-import"       viewBox="0 0 10 10" refX="9" refY="5" markerWidth="4"  markerHeight="4"  orient="auto"><path d="M0,0 L10,5 L0,10z" fill="#569cd6"/></marker>
    <marker id="arr-import-act"   viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5"  markerHeight="5"  orient="auto"><path d="M0,0 L10,5 L0,10z" fill="#9cdcfe"/></marker>
    <marker id="arr-import-dim"   viewBox="0 0 10 10" refX="9" refY="5" markerWidth="4"  markerHeight="4"  orient="auto"><path d="M0,0 L10,5 L0,10z" fill="#569cd6" opacity="0.08"/></marker>
    <marker id="arr-call"         viewBox="0 0 10 10" refX="9" refY="5" markerWidth="3"  markerHeight="3"  orient="auto"><path d="M0,0 L10,5 L0,10z" fill="#ce9178"/></marker>
    <marker id="arr-call-act"     viewBox="0 0 10 10" refX="9" refY="5" markerWidth="4"  markerHeight="4"  orient="auto"><path d="M0,0 L10,5 L0,10z" fill="#ffc4a3"/></marker>
    <marker id="arr-call-dim"     viewBox="0 0 10 10" refX="9" refY="5" markerWidth="3"  markerHeight="3"  orient="auto"><path d="M0,0 L10,5 L0,10z" fill="#ce9178" opacity="0.08"/></marker>
    <marker id="arr-f2f"          viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5"  markerHeight="5"  orient="auto"><path d="M0,0 L10,5 L0,10z" fill="#c586c0"/></marker>
    <marker id="arr-f2f-act"      viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6"  markerHeight="6"  orient="auto"><path d="M0,0 L10,5 L0,10z" fill="#e8b4e8"/></marker>
    <marker id="arr-f2f-dim"      viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5"  markerHeight="5"  orient="auto"><path d="M0,0 L10,5 L0,10z" fill="#c586c0" opacity="0.08"/></marker>
    <marker id="arr-css"          viewBox="0 0 10 10" refX="9" refY="5" markerWidth="4"  markerHeight="4"  orient="auto"><path d="M0,0 L10,5 L0,10z" fill="#c586c0"/></marker>
    <marker id="arr-env"          viewBox="0 0 10 10" refX="9" refY="5" markerWidth="4"  markerHeight="4"  orient="auto"><path d="M0,0 L10,5 L0,10z" fill="#dcdcaa"/></marker>
    <marker id="arr-db"           viewBox="0 0 10 10" refX="9" refY="5" markerWidth="4"  markerHeight="4"  orient="auto"><path d="M0,0 L10,5 L0,10z" fill="#4ec9b0"/></marker>
  </defs>`;
}

function getJs1(graphJson: string): string {
    return `
const graph = ${graphJson};
const vsapi = acquireVsCodeApi();
const svg   = document.getElementById('graph');
const vp    = document.getElementById('viewport');
const tip   = document.getElementById('tooltip');
const zoomLbl = document.getElementById('zoomLabel');
const resetBtn = document.getElementById('resetBtn');
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

// ── node map ──────────────────────────────────────────────
const nodes = graph.nodes.map(n => ({ ...n, x:0, y:0 }));
const byId  = {};
nodes.forEach(n => byId[n.id] = n);
function nodeW(n) { return Math.max(80, n.fileName.length * 6.5 + 16); }
function nodeH()  { return 22; }

// ── edges ─────────────────────────────────────────────────
const edges = graph.edges
  .map(e => ({ ...e, s: byId[e.source], t: byId[e.target] }))
  .filter(e => e.s && e.t);
const impEdges = edges.filter(e => e.type === 'import');

// ── entry / layered topo ──────────────────────────────────
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

// group nodes by folder, sort by layer then fileName
const folderMap = {};
nodes.forEach(n => {
  const fp = n.folderPath || '(root)';
  // special nodes get their own section — not in folder grid
  if (n.nodeType === 'css' || n.nodeType === 'env' || n.nodeType === 'database') return;
  (folderMap[fp] = folderMap[fp] || []).push(n);
});
const folders = Object.keys(folderMap).sort();

// ── layout: folders in a grid ─────────────────────────────
const COLS       = Math.ceil(Math.sqrt(folders.length + 1));
const FPAD       = 22;   // padding inside folder box
const FGAP_X     = 110;  // gap between folder columns
const FGAP_Y     = 80;   // gap between folder rows
const NODE_GAP_Y = 12;   // vertical gap between nodes inside folder

// compute each folder box size
const fboxes = {};  // fp -> { x, y, w, h, color }
folders.forEach((fp, fi) => {
  const ns  = folderMap[fp];
  const maxW = Math.max(...ns.map(n => nodeW(n)));
  const bw   = maxW + FPAD * 2;
  const bh   = ns.length * (nodeH() + NODE_GAP_Y) + FPAD * 2 + 18; // 18 for label
  fboxes[fp] = { w: bw, h: bh, color: folderColor(fp), col: fi % COLS, row: Math.floor(fi / COLS) };
});

// compute max width/height per grid cell
const colW = {}, rowH = {};
folders.forEach(fp => {
  const fb = fboxes[fp];
  colW[fb.col] = Math.max(colW[fb.col] || 0, fb.w);
  rowH[fb.row] = Math.max(rowH[fb.row] || 0, fb.h);
});

// assign x/y to folder boxes and nodes inside them
const colX = {}, rowY = {};
let cx = FGAP_X;
for (let c = 0; c < COLS; c++) { colX[c] = cx; cx += (colW[c] || 0) + FGAP_X; }
let cy = 60;
const maxRow = Math.max(...folders.map(fp => fboxes[fp].row), 0);
for (let r = 0; r <= maxRow; r++) { rowY[r] = cy; cy += (rowH[r] || 0) + FGAP_Y; }

folders.forEach(fp => {
  const fb = fboxes[fp];
  fb.x = colX[fb.col]; fb.y = rowY[fb.row];
  const ns = folderMap[fp];
  ns.sort((a, b) => (layerOf[a.id] - layerOf[b.id]) || a.fileName.localeCompare(b.fileName));
  ns.forEach((n, i) => {
    n.x = fb.x + FPAD;
    n.y = fb.y + 22 + FPAD + i * (nodeH() + NODE_GAP_Y);  // 22 = label height
  });
});

// ── special nodes (css / env / database) layout ───────────
// These sit in a horizontal strip below the main folder grid
const cssNodes = nodes.filter(n => n.nodeType === 'css');
const envNodes = nodes.filter(n => n.nodeType === 'env');
const dbNodes  = nodes.filter(n => n.nodeType === 'database');

// find bottom of folder grid
const folderBottoms = folders.map(fp => { const fb = fboxes[fp]; return fb ? fb.y + fb.h : 0; });
const gridBottom = folderBottoms.length ? Math.max(...folderBottoms) : H / 2;
const specialY   = gridBottom + 90;  // 90px gap below folder grid

const SPECIAL_COL_GAP = 30;
const SPECIAL_NODE_H  = 28;
const SPECIAL_NODE_W  = 160;
const SPECIAL_PAD     = 14;

// helper: layout a group of special nodes into a section box
function layoutSpecialGroup(snodes, startX, y, color) {
  if (!snodes.length) return { x: startX, y, w: 0, h: 0, endX: startX };
  const bw = SPECIAL_NODE_W + SPECIAL_PAD * 2;
  const bh = snodes.length * (SPECIAL_NODE_H + 6) + SPECIAL_PAD * 2 + 20;
  snodes.forEach((n, i) => {
    n.x = startX + SPECIAL_PAD;
    n.y = y + 20 + SPECIAL_PAD + i * (SPECIAL_NODE_H + 6);
  });
  return { x: startX, y, w: bw, h: bh, color, endX: startX + bw };
}

let sx = FGAP_X;
const cssBox = layoutSpecialGroup(cssNodes,  sx,           specialY, '#c586c0');
sx = cssBox.endX + (cssBox.w ? SPECIAL_COL_GAP : 0);
const envBox = layoutSpecialGroup(envNodes,  sx,           specialY, '#dcdcaa');
sx = envBox.endX + (envBox.w ? SPECIAL_COL_GAP : 0);
const dbBox  = layoutSpecialGroup(dbNodes,   sx,           specialY, '#4ec9b0');

// ── unused files (no edges at all) ───────────────────────
const connectedIds = new Set();
edges.forEach(e => { connectedIds.add(e.source); connectedIds.add(e.target); });
const unusedIds = new Set(nodes.filter(n => !connectedIds.has(n.id)).map(n => n.id));
`;
}

function getJs2(): string {
    return `
// ═══════════════════════════════════════════════
// DRAWING
// ═══════════════════════════════════════════════

// track all drawn elements for dim/active toggling
const folderEls  = {};  // fp -> { box, label, chevron, g }
const edgeEls    = [];  // { el, data, isF2F }
const nodeGroups = [];  // { el, data }

const collapsedFolders = new Set();  // folders currently collapsed
const COLLAPSED_H = 32;              // height when collapsed (just header)

// ── master edge redraw — handles collapse state for all edges ──
function redrawAllEdges() {
  edgeEls.forEach(ee => {
    const e = ee.data;
    if (!e.s || !e.t) return;
    const srcFp = e.s.folderPath || '(root)';
    const tgtFp = e.t.folderPath || '(root)';
    const srcCollapsed = collapsedFolders.has(srcFp);
    const tgtCollapsed = collapsedFolders.has(tgtFp);
    // both in same collapsed folder → hide
    if (srcFp === tgtFp && srcCollapsed) { ee.el.style.display = 'none'; return; }
    ee.el.style.display = '';
    let x1, y1, x2, y2;
    if (srcCollapsed) {
      const fb = fboxes[srcFp]; x1 = fb.x + fb.w / 2; y1 = fb.y + fb.h / 2;
    } else { const sc = nodeCenter(e.s); x1 = sc.x; y1 = sc.y; }
    if (tgtCollapsed) {
      const fb = fboxes[tgtFp]; x2 = fb.x + fb.w / 2; y2 = fb.y + fb.h / 2;
    } else { const tc = nodeCenter(e.t); x2 = tc.x; y2 = tc.y; }
    ee.el.setAttribute('d', bezierPath(x1, y1, x2, y2));
  });
}

function setFolderCollapsed(fp, collapsed) {
  const fb = fboxes[fp], fe = folderEls[fp];
  if (!fb || !fe) return;
  if (collapsed) {
    collapsedFolders.add(fp);
    fb.h = COLLAPSED_H;
    fe.box.setAttribute('height', COLLAPSED_H);
    fe.chevron.textContent = '▶ ';
    nodeGroups.forEach(ng => {
      if ((ng.data.folderPath || '(root)') === fp) ng.el.style.display = 'none';
    });
  } else {
    collapsedFolders.delete(fp);
    fb.h = fb.origH;
    fe.box.setAttribute('height', fb.h);
    fe.chevron.textContent = '▼ ';
    nodeGroups.forEach(ng => {
      if ((ng.data.folderPath || '(root)') === fp) ng.el.style.display = '';
    });
  }
  redrawAllEdges();
}

// ── 1. Folder boxes ───────────────────────────
folders.forEach(fp => {
  const fb = fboxes[fp];
  // store original height for restore on expand
  fb.origH = fb.h;

  const g = mkEl('g', {});

  const rect = mkEl('rect', {
    x: fb.x, y: fb.y, width: fb.w, height: fb.h,
    rx: 10, ry: 10,
    fill: fb.color, 'fill-opacity': '0.07',
    stroke: fb.color, 'stroke-width': '1.5',
    opacity: '0.6'
  });
  rect.classList.add('folder-box');

  // chevron icon (▼ expanded, ▶ collapsed)
  const chevron = mkEl('text', {
    x: fb.x + 8, y: fb.y + 15,
    fill: fb.color, 'font-size': '9', opacity: '0.8'
  });
  chevron.textContent = '▼ ';

  const lbl = mkEl('text', {
    x: fb.x + 18, y: fb.y + 15,
    fill: fb.color, 'font-size': '11', 'font-weight': '700', opacity: '0.8'
  });
  lbl.textContent = fp;
  lbl.classList.add('folder-label');

  g.appendChild(rect);
  g.appendChild(chevron);
  g.appendChild(lbl);
  vp.appendChild(g);
  folderEls[fp] = { box: rect, label: lbl, chevron, g };
});

// ── 2. Folder-to-folder curved edges ──────────
// ── bezier path between two node centres ──────
function bezierPath(x1, y1, x2, y2) {
  const dx = Math.abs(x2 - x1);
  const cp = Math.max(dx * 0.55, 60);
  return 'M ' + x1 + ' ' + y1 + ' C ' + (x1 + cp) + ' ' + y1 + ' ' + (x2 - cp) + ' ' + y2 + ' ' + x2 + ' ' + y2;
}

function nodeCenter(n) {
  return { x: n.x + nodeW(n) / 2, y: n.y + nodeH() / 2 };
}

// ── 3. File-level curved edges ────────────────
edges.forEach(e => {
  const sc = nodeCenter(e.s), tc = nodeCenter(e.t);
  let cls, mid, dotStart;
  if (e.type === 'import')          { cls = 'edge-import';     mid = 'arr-import'; dotStart = 'dot-import'; }
  else if (e.type === 'call')       { cls = 'edge-call';       mid = 'arr-call';   dotStart = 'dot-call'; }
  else if (e.type === 'css-import') { cls = 'edge-css-import'; mid = 'arr-css';    dotStart = 'dot-css'; }
  else if (e.type === 'env-use')    { cls = 'edge-env-use';    mid = 'arr-env';    dotStart = 'dot-env'; }
  else if (e.type === 'db-use')     { cls = 'edge-db-use';     mid = 'arr-db';     dotStart = 'dot-db'; }
  else                              { cls = 'edge-import';     mid = 'arr-import'; dotStart = 'dot-import'; }
  const path = mkEl('path', {
    d: bezierPath(sc.x, sc.y, tc.x, tc.y),
    class: cls,
    'marker-start': 'url(#' + dotStart + ')',
    'marker-end':   'url(#' + mid + ')'
  });
  vp.insertBefore(path, vp.firstChild);
  edgeEls.push({ el: path, data: e, isF2F: false });
});

// ── 4. File nodes ─────────────────────────────
nodes.forEach(n => {
  const isSpecial = n.nodeType === 'css' || n.nodeType === 'env' || n.nodeType === 'database';
  if (isSpecial) return;  // special nodes drawn separately below
  const col    = folderColor(n.folderPath || '(root)');
  const isEntry  = entryIds.has(n.id);
  const isUnused = unusedIds.has(n.id);
  const nw = nodeW(n), nh = nodeH();

  const g = mkEl('g', {
    class: 'node' + (isEntry ? ' entry' : '') + (isUnused ? ' unused' : ''),
    transform: 'translate(' + n.x + ',' + n.y + ')',
    style: '--nc:' + col
  });

  const bg = mkEl('rect', {
    x: 0, y: 0, width: nw, height: nh,
    rx: 4, ry: 4,
    fill: isUnused ? '#ff000022' : col,
    'fill-opacity': isUnused ? '1' : '0.22',
    stroke: isEntry ? '#ffd700' : (isUnused ? '#e05555' : col),
    'stroke-width': isEntry ? '2' : (isUnused ? '1.5' : '1'),
    class: 'core'
  });

  const txt = mkEl('text', { x: 7, y: 15 });
  txt.textContent = n.fileName;

  g.appendChild(bg);
  g.appendChild(txt);

  // DB usage badge — small icon if this code file uses a DB client
  if (n.dbUsage && n.dbUsage.length > 0) {
    const badge = mkEl('text', { x: nw + 3, y: 15, 'font-size': '11', title: n.dbUsage.join(', ') });
    badge.textContent = '🗄️';
    g.appendChild(badge);
  }

  vp.appendChild(g);
  nodeGroups.push({ el: g, data: n });

  // tooltip
  g.addEventListener('mouseenter', ev => showTip(ev, n));
  g.addEventListener('mousemove',  ev => moveTip(ev));
  g.addEventListener('mouseleave', hideTip);

  // click handler
  g.addEventListener('click', ev => {
    ev.stopPropagation();
    if (ev.ctrlKey || ev.metaKey) {
      vsapi.postMessage({ command: 'openFile', fileId: n.id });
    } else {
      selectNode(n.id);
    }
  });

  // drag
  let dragging = false;
  g.addEventListener('mousedown', ev => { dragging = true; ev.stopPropagation(); });
  window.addEventListener('mouseup', () => { dragging = false; });
  window.addEventListener('mousemove', ev => {
    if (!dragging) return;
    const r = svg.getBoundingClientRect();
    n.x = (ev.clientX - r.left  - viewX) / viewScale;
    n.y = (ev.clientY - r.top   - viewY) / viewScale;
    g.setAttribute('transform', 'translate(' + n.x + ',' + n.y + ')');
    refreshEdges(n.id);
  });
});

// ── refresh edge paths after drag ─────────────
function refreshEdges(nodeId) {
  edgeEls.forEach(ee => {
    if (ee.isF2F) return;
    const e = ee.data;
    if (e.source !== nodeId && e.target !== nodeId) return;
    const sc = nodeCenter(e.s), tc = nodeCenter(e.t);
    ee.el.setAttribute('d', bezierPath(sc.x, sc.y, tc.x, tc.y));
  });
}

// ── 5. Special section boxes (CSS / ENV / DB) ─
function drawSpecialSection(box, label, icon) {
  if (!box.w) return;
  const g = mkEl('g', {});
  const rect = mkEl('rect', {
    x: box.x, y: box.y, width: box.w, height: box.h,
    rx: 12, ry: 12,
    fill: box.color, 'fill-opacity': '0.06',
    stroke: box.color, 'stroke-width': '1.5', opacity: '0.7'
  });
  rect.classList.add('folder-box');
  const lbl = mkEl('text', {
    x: box.x + 10, y: box.y + 15,
    fill: box.color, 'font-size': '11', 'font-weight': '700', opacity: '0.8'
  });
  lbl.textContent = icon + ' ' + label;
  lbl.classList.add('folder-label');
  g.appendChild(rect); g.appendChild(lbl);
  vp.appendChild(g);
  folderEls['__special__' + label] = { box: rect, label: lbl };
}

drawSpecialSection(cssBox, 'CSS / Styles', '🎨');
drawSpecialSection(envBox, 'Environment',  '🔑');
drawSpecialSection(dbBox,  'Database',     '🗄️');

// ── 6. Special nodes ──────────────────────────
function specialNodeColor(nodeType) {
  if (nodeType === 'css')      return '#c586c0';
  if (nodeType === 'env')      return '#dcdcaa';
  if (nodeType === 'database') return '#4ec9b0';
  return '#888';
}

function specialNodeIcon(nodeType) {
  if (nodeType === 'css')      return '🎨';
  if (nodeType === 'env')      return '🔑';
  if (nodeType === 'database') return '🗄️';
  return '📄';
}

nodes.forEach(n => {
  if (n.nodeType !== 'css' && n.nodeType !== 'env' && n.nodeType !== 'database') return;

  const col = specialNodeColor(n.nodeType);
  const nw  = Math.max(SPECIAL_NODE_W, n.fileName.length * 6.5 + 28);
  const nh  = SPECIAL_NODE_H;

  const g = mkEl('g', {
    class: 'node special-node',
    transform: 'translate(' + n.x + ',' + n.y + ')',
    style: '--nc:' + col
  });

  const bg = mkEl('rect', {
    x: 0, y: 0, width: nw, height: nh,
    rx: 6, ry: 6,
    fill: col, 'fill-opacity': '0.18',
    stroke: col, 'stroke-width': '1.5',
    class: 'core'
  });

  const icon = mkEl('text', { x: 6, y: 19, 'font-size': '13' });
  icon.textContent = specialNodeIcon(n.nodeType);

  const txt = mkEl('text', { x: 24, y: 19 });
  txt.textContent = n.fileName;

  g.appendChild(bg); g.appendChild(icon); g.appendChild(txt);
  vp.appendChild(g);
  nodeGroups.push({ el: g, data: n });

  // tooltip for special nodes
  g.addEventListener('mouseenter', ev => showSpecialTip(ev, n));
  g.addEventListener('mousemove',  ev => moveTip(ev));
  g.addEventListener('mouseleave', hideTip);

  g.addEventListener('click', ev => {
    ev.stopPropagation();
    if (ev.ctrlKey || ev.metaKey) {
      vsapi.postMessage({ command: 'openFile', fileId: n.id });
    } else {
      selectNode(n.id);
    }
  });

  // drag
  let dragging = false;
  g.addEventListener('mousedown', ev => { dragging = true; ev.stopPropagation(); });
  window.addEventListener('mouseup', () => { dragging = false; });
  window.addEventListener('mousemove', ev => {
    if (!dragging) return;
    const r = svg.getBoundingClientRect();
    n.x = (ev.clientX - r.left  - viewX) / viewScale;
    n.y = (ev.clientY - r.top   - viewY) / viewScale;
    g.setAttribute('transform', 'translate(' + n.x + ',' + n.y + ')');
    refreshEdges(n.id);
  });
});

function showSpecialTip(ev, n) {
  let body = '';
  if (n.nodeType === 'css') {
    const classes = (n.cssClasses || []).slice(0, 15).join(', ');
    body = 'Classes: ' + (n.cssClasses ? n.cssClasses.length : 0) +
           (classes ? '<br/><span class="fn">' + classes + '</span>' : '') +
           (n.cssImports && n.cssImports.length ? '<br/>@imports: ' + n.cssImports.join(', ') : '');
  } else if (n.nodeType === 'env') {
    const dbk  = (n.envDbKeys  || []).join(', ') || '—';
    const apik = (n.envApiKeys || []).join(', ') || '—';
    body = 'Total keys: ' + (n.envKeys ? n.envKeys.length : 0) +
           '<br/><span style="color:#4ec9b0">DB keys: ' + dbk + '</span>' +
           '<br/><span style="color:#ce9178">API/Secret keys: ' + apik + '</span>' +
           '<br/><span class="mt">(values hidden for security)</span>';
  } else if (n.nodeType === 'database') {
    const tables = (n.dbTables || []).join(', ') || '—';
    const models = (n.dbModels || []).join(', ') || '—';
    body = (n.dbTables && n.dbTables.length ? 'Tables: <span class="fn">' + tables + '</span><br/>' : '') +
           (n.dbModels && n.dbModels.length ? 'Models: <span class="fn">' + models + '</span>' : '');
  }
  tip.innerHTML =
    '<b>' + specialNodeIcon(n.nodeType) + ' ' + n.fileName + '</b>' +
    '<br/><span class="mt">' + n.nodeType.toUpperCase() + ' &middot; LOC: ' + n.loc + '</span>' +
    '<br/>' + body +
    '<br/><span class="hint">Ctrl+Click to open file</span>';
  tip.style.display = 'block';
  moveTip(ev);
}
`;
}

function getJs3(): string {
    return `
// ═══════════════════════════════════════════════
// TOOLTIP
// ═══════════════════════════════════════════════
function showTip(ev, n) {
  const fns = (n.functions || []).slice(0, 10).map(f => f.name).join(', ');
  tip.innerHTML =
    '<b>' + n.fileName + '</b>' +
    (entryIds.has(n.id)  ? ' <span style="color:#ffd700">&#9733; entry</span>' : '') +
    (unusedIds.has(n.id) ? ' <span style="color:#e05555">&#9888; unused</span>' : '') +
    (n.dbUsage && n.dbUsage.length ? ' <span style="color:#4ec9b0">🗄️ ' + n.dbUsage.join(', ') + '</span>' : '') +
    '<br/><span class="mt">' + (n.folderPath || '(root)') + '</span><br/>' +
    'LOC: ' + n.loc +
    ' &nbsp; Functions: ' + (n.functions ? n.functions.length : 0) +
    ' &nbsp; Imports: '   + (n.imports   ? n.imports.length   : 0) +
    (fns ? '<br/><span class="fn">' + fns + '</span>' : '') +
    '<br/><span class="hint">&#8984;/Ctrl+Click to open file</span>';
  tip.style.display = 'block';
  moveTip(ev);
}
function moveTip(ev) {
  tip.style.left = (ev.clientX + 16) + 'px';
  tip.style.top  = (ev.clientY + 14) + 'px';
}
function hideTip() { tip.style.display = 'none'; }

// ═══════════════════════════════════════════════
// PAN / ZOOM
// ═══════════════════════════════════════════════
let viewX = 0, viewY = 0, viewScale = 1;

function applyVP(animated) {
  if (animated) {
    vp.classList.add('animate');
    setTimeout(() => vp.classList.remove('animate'), 600);
  }
  vp.setAttribute('transform', 'translate(' + viewX + ',' + viewY + ') scale(' + viewScale + ')');
  zoomLbl.textContent = Math.round(viewScale * 100) + '%';
}

const allX = nodes.map(n => n.x), allY = nodes.map(n => n.y);
if (allX.length) {
  const minX = Math.min(...allX), maxX = Math.max(...allX) + 120;
  const minY = Math.min(...allY), maxY = Math.max(...allY) + 30;
  const scaleX = W / (maxX - minX + 80), scaleY = H / (maxY - minY + 80);
  viewScale = Math.min(scaleX, scaleY, 1.4);
  viewX = W / 2 - ((minX + maxX) / 2) * viewScale;
  viewY = H / 2 - ((minY + maxY) / 2) * viewScale;
}
applyVP(false);
const initVX = viewX, initVY = viewY, initVS = viewScale;

svg.addEventListener('wheel', ev => {
  ev.preventDefault();
  const r = svg.getBoundingClientRect();
  const mx = ev.clientX - r.left, my = ev.clientY - r.top;
  const zf = ev.deltaY < 0 ? 1.12 : 0.89;
  const ns = Math.min(6, Math.max(0.08, viewScale * zf));
  viewX = mx - (mx - viewX) * (ns / viewScale);
  viewY = my - (my - viewY) * (ns / viewScale);
  viewScale = ns;
  applyVP(false);
}, { passive: false });

let panning = false, panSX = 0, panSY = 0, vxS = 0, vyS = 0, panMoved = false;
svg.addEventListener('mousedown', ev => {
  if (ev.target === svg || ev.target === vp) {
    panning = true; panMoved = false;
    panSX = ev.clientX; panSY = ev.clientY;
    vxS = viewX; vyS = viewY;
    svg.style.cursor = 'grabbing';
  }
});
window.addEventListener('mousemove', ev => {
  if (!panning) return;
  const dx = ev.clientX - panSX, dy = ev.clientY - panSY;
  if (Math.abs(dx) > 3 || Math.abs(dy) > 3) panMoved = true;
  viewX = vxS + dx; viewY = vyS + dy;
  applyVP(false);
});
window.addEventListener('mouseup', () => { panning = false; svg.style.cursor = 'grab'; });

// ═══════════════════════════════════════════════
// HIGHLIGHT STATE + AUTO-RESET TIMER
// ═══════════════════════════════════════════════
let activeId     = null;   // selected node id
let activeFp     = null;   // selected folder path
let activeEdgeIdx = null;  // selected edge index in edgeEls
let autoResetTimer = null;
const AUTO_RESET_MS = 3000; // 3 sec baad auto reset

function scheduleAutoReset() {
  clearTimeout(autoResetTimer);
  autoResetTimer = setTimeout(() => fullReset(true), AUTO_RESET_MS);
}

function cancelAutoReset() {
  clearTimeout(autoResetTimer);
  autoResetTimer = null;
}

// ── marker helpers ───────────────────────────
function markerUrl(type, state) {
  if (type === 'f2f')        return 'url(#arr-f2f'    + (state ? '-' + state : '') + ')';
  if (type === 'css-import') return 'url(#arr-css)';
  if (type === 'env-use')    return 'url(#arr-env)';
  if (type === 'db-use')     return 'url(#arr-db)';
  const base = type === 'import' ? 'arr-import' : 'arr-call';
  return 'url(#' + base + (state ? '-' + state : '') + ')';
}

// ── full reset ───────────────────────────────
function fullReset(animated) {
  cancelAutoReset();
  activeId = null; activeFp = null; activeEdgeIdx = null;
  nodeGroups.forEach(ng => ng.el.classList.remove('dim', 'active'));
  edgeEls.forEach(ee => {
    ee.el.classList.remove('dim', 'active');
    const t = ee.isF2F ? 'f2f' : ee.data.type;
    ee.el.setAttribute('marker-end',   markerUrl(t, null));
    ee.el.setAttribute('marker-start', dotUrl(t, null));
  });
  Object.values(folderEls).forEach(fe => {
    fe.box.classList.remove('dim', 'active');
    fe.label.classList.remove('dim', 'active');
  });
  if (animated) { viewX = initVX; viewY = initVY; viewScale = initVS; applyVP(true); }
}

function dotUrl(type, state) {
  const suffix = state === 'act' ? '-act' : state === 'dim' ? '-dim' : '';
  if (type === 'f2f')        return 'url(#dot-f2f'    + suffix + ')';
  if (type === 'css-import') return 'url(#dot-css)';
  if (type === 'env-use')    return 'url(#dot-env)';
  if (type === 'db-use')     return 'url(#dot-db)';
  const base = type === 'import' ? 'dot-import' : 'dot-call';
  return 'url(#' + base + suffix + ')';
}

// ── apply dim/active to all elements ─────────
function applyHighlight(keepNodes, keepEdgeIdxs, keepFolders, focusNode) {
  nodeGroups.forEach(ng => {
    const keep = keepNodes.has(ng.data.id);
    ng.el.classList.toggle('dim',    !keep);
    ng.el.classList.toggle('active', ng.data.id === (focusNode || ''));
  });
  edgeEls.forEach((ee, idx) => {
    const keep = keepEdgeIdxs.has(idx);
    const state = keep ? 'act' : 'dim';
    ee.el.classList.toggle('dim',    !keep);
    ee.el.classList.toggle('active',  keep);
    const t = ee.isF2F ? 'f2f' : ee.data.type;
    ee.el.setAttribute('marker-end',   markerUrl(t, keep ? 'act' : 'dim'));
    ee.el.setAttribute('marker-start', dotUrl(t, state));
  });
  Object.keys(folderEls).forEach(fp => {
    const fe   = folderEls[fp];
    const keep = keepFolders.has(fp);
    fe.box.classList.toggle('dim',    !keep);
    fe.box.classList.toggle('active',  keep);
    fe.label.classList.toggle('dim',  !keep);
    fe.label.classList.toggle('active', keep);
  });
}

// ── NODE click ───────────────────────────────
function selectNode(id) {
  hideTip();
  if (activeId === id) { fullReset(true); return; }
  cancelAutoReset();
  activeId = id; activeFp = null; activeEdgeIdx = null;

  const keepNodes   = new Set([id]);
  const keepFolders = new Set();
  const keepEdges   = new Set();

  const n = byId[id];
  if (n) keepFolders.add(n.folderPath || '(root)');

  edgeEls.forEach((ee, idx) => {
    if (!ee.isF2F && (ee.data.source === id || ee.data.target === id)) {
      keepEdges.add(idx);
      keepNodes.add(ee.data.source);
      keepNodes.add(ee.data.target);
    }
  });
  keepNodes.forEach(nid => {
    const nd = byId[nid];
    if (nd) keepFolders.add(nd.folderPath || '(root)');
  });
  // also keep f2f edges between those folders
  edgeEls.forEach((ee, idx) => {
    if (ee.isF2F && keepFolders.has(ee.sf) && keepFolders.has(ee.tf)) keepEdges.add(idx);
  });

  applyHighlight(keepNodes, keepEdges, keepFolders, id);
  // zoom nahi — sirf isolate, view same rahega
}

// ── FOLDER click ─────────────────────────────
function selectFolder(fp) {
  hideTip();
  if (activeFp === fp) { fullReset(true); return; }
  cancelAutoReset();
  activeId = null; activeFp = fp; activeEdgeIdx = null;

  const keepNodes   = new Set(folderMap[fp].map(n => n.id));
  const keepFolders = new Set([fp]);
  const keepEdges   = new Set();

  edgeEls.forEach((ee, idx) => {
    if (!ee.isF2F) {
      if (keepNodes.has(ee.data.source) || keepNodes.has(ee.data.target)) {
        keepEdges.add(idx);
        keepNodes.add(ee.data.source);
        keepNodes.add(ee.data.target);
      }
    }
  });
  keepNodes.forEach(nid => {
    const nd = byId[nid];
    if (nd) keepFolders.add(nd.folderPath || '(root)');
  });
  edgeEls.forEach((ee, idx) => {
    if (ee.isF2F && keepFolders.has(ee.sf) && keepFolders.has(ee.tf)) keepEdges.add(idx);
  });

  applyHighlight(keepNodes, keepEdges, keepFolders, '');
  // zoom nahi — sirf isolate, view same rahega
}

// ── EDGE click ───────────────────────────────
function selectEdge(idx) {
  hideTip();
  if (activeEdgeIdx === idx) { fullReset(true); return; }
  cancelAutoReset();
  activeId = null; activeFp = null; activeEdgeIdx = idx;

  const ee = edgeEls[idx];
  const keepNodes   = new Set();
  const keepFolders = new Set();
  const keepEdges   = new Set([idx]);

  if (ee.isF2F) {
    keepFolders.add(ee.sf); keepFolders.add(ee.tf);
    folderMap[ee.sf].forEach(n => keepNodes.add(n.id));
    folderMap[ee.tf].forEach(n => keepNodes.add(n.id));
  } else {
    keepNodes.add(ee.data.source);
    keepNodes.add(ee.data.target);
    const ns = byId[ee.data.source], nt = byId[ee.data.target];
    if (ns) keepFolders.add(ns.folderPath || '(root)');
    if (nt) keepFolders.add(nt.folderPath || '(root)');
  }

  applyHighlight(keepNodes, keepEdges, keepFolders, '');
  // auto-reset nahi — user khud click karke reset karega
}

// ── wire up edge click listeners ─────────────
edgeEls.forEach((ee, idx) => {
  ee.el.style.cursor = 'pointer';
  ee.el.addEventListener('click', ev => {
    ev.stopPropagation();
    selectEdge(idx);
  });
  // edge tooltip on hover
  ee.el.addEventListener('mouseenter', ev => {
    const d = ee.data;
    let html = '';
    if (ee.isF2F) {
      html = '<b>' + d.sf + '</b> &rarr; <b>' + d.tf + '</b><br/><span class="mt">folder-to-folder &middot; ' + d.count + ' connection' + (d.count > 1 ? 's' : '') + '</span>';
    } else {
      html = '<b>' + (d.s ? d.s.fileName : d.source) + '</b> &rarr; <b>' + (d.t ? d.t.fileName : d.target) + '</b><br/>' +
             '<span class="mt">' + d.type + (d.importedSymbols && d.importedSymbols.length ? ': ' + d.importedSymbols.slice(0,6).join(', ') : '') + '</span>' +
             '<br/><span class="hint">Click to isolate this connection</span>';
    }
    tip.innerHTML = html;
    tip.style.display = 'block';
    moveTip(ev);
  });
  ee.el.addEventListener('mousemove', moveTip);
  ee.el.addEventListener('mouseleave', hideTip);
});

// ── wire up folder box click listeners ───────
Object.keys(folderEls).forEach(fp => {
  const fe = folderEls[fp];
  fe.box.style.pointerEvents = 'all';
  fe.box.style.cursor = 'pointer';
  fe.box.addEventListener('click', ev => {
    ev.stopPropagation();
    selectFolder(fp);
  });

  // double-click = collapse / expand
  fe.box.addEventListener('dblclick', ev => {
    ev.stopPropagation();
    setFolderCollapsed(fp, !collapsedFolders.has(fp));
  });
  fe.label.style.pointerEvents = 'all';
  fe.label.addEventListener('dblclick', ev => {
    ev.stopPropagation();
    setFolderCollapsed(fp, !collapsedFolders.has(fp));
  });

  // folder drag — moves box + all nodes inside it
  let fDragging = false, fDragStartX = 0, fDragStartY = 0;
  let fBoxStartX = 0, fBoxStartY = 0;
  let fNodeStarts = [];

  fe.box.addEventListener('mousedown', ev => {
    fDragging = true;
    fDragStartX = ev.clientX; fDragStartY = ev.clientY;
    fBoxStartX  = fboxes[fp].x; fBoxStartY = fboxes[fp].y;
    fNodeStarts = (folderMap[fp] || []).map(n => ({ n, x: n.x, y: n.y }));
    ev.stopPropagation();
  });

  window.addEventListener('mousemove', ev => {
    if (!fDragging) return;
    const dx = (ev.clientX - fDragStartX) / viewScale;
    const dy = (ev.clientY - fDragStartY) / viewScale;

    const fb = fboxes[fp];
    fb.x = fBoxStartX + dx; fb.y = fBoxStartY + dy;
    fe.box.setAttribute('x', fb.x);
    fe.box.setAttribute('y', fb.y);
    fe.chevron.setAttribute('x', fb.x + 8);
    fe.chevron.setAttribute('y', fb.y + 15);
    fe.label.setAttribute('x', fb.x + 18);
    fe.label.setAttribute('y', fb.y + 15);

    fNodeStarts.forEach(({ n, x, y }) => {
      n.x = x + dx; n.y = y + dy;
      const ng = nodeGroups.find(g => g.data.id === n.id);
      if (ng) ng.el.setAttribute('transform', 'translate(' + n.x + ',' + n.y + ')');
    });

    // single pass redraws everything correctly regardless of collapse state
    redrawAllEdges();
  });

  window.addEventListener('mouseup', ev => {
    if (!fDragging) return;
    fDragging = false;
    const dx = ev.clientX - fDragStartX, dy = ev.clientY - fDragStartY;
    if (Math.abs(dx) < 4 && Math.abs(dy) < 4) selectFolder(fp);
  });
  // folder label tooltip
  fe.box.addEventListener('mouseenter', ev => {
    const ns = folderMap[fp] || [];
    tip.innerHTML = '<b>' + fp + '</b><br/><span class="mt">' + ns.length + ' file' + (ns.length !== 1 ? 's' : '') + '</span><br/><span class="hint">Click to isolate folder</span>';
    tip.style.display = 'block';
    moveTip(ev);
  });
  fe.box.addEventListener('mousemove', moveTip);
  fe.box.addEventListener('mouseleave', hideTip);
});

// ── click empty = reset ───────────────────────
svg.addEventListener('click', () => {
  if (panMoved) { panMoved = false; return; }
  if (activeId || activeFp || activeEdgeIdx !== null) fullReset(true);
});
resetBtn.addEventListener('click', () => fullReset(true));
`;
}
