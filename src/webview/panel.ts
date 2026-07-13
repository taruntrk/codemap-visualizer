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
            {
                enableScripts: true,
                retainContextWhenHidden: true,
            }
        );

        CodeMapPanel.currentPanel = new CodeMapPanel(panel, graph, rootPath);
    }

    private constructor(panel: vscode.WebviewPanel, graph: CodeGraph, private readonly rootPath: string) {
        this.panel = panel;
        this.update(graph);
        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

        // Message handler — double click se file open karne ke liye
        this.panel.webview.onDidReceiveMessage(
            async (message) => {
                if (message.command === 'openFile') {
                    try {
                        const fullPath = path.join(this.rootPath, message.fileId);
                        const uri = vscode.Uri.file(fullPath);
                        const doc = await vscode.workspace.openTextDocument(uri);
                        await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
                    } catch (err) {
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
            if (d) {
                d.dispose();
            }
        }
    }

    private getHtml(graph: CodeGraph): string {
        const graphJson = JSON.stringify(graph).replace(/</g, '\\u003c');

        return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<style>
  html, body {
    margin:0; padding:0; height:100%; overflow:hidden;
    font-family: -apple-system, sans-serif; color:#ddd;
    background: radial-gradient(circle at 50% 40%, #262626 0%, #151515 75%);
  }
  #toolbar {
    position:fixed; top:8px; left:8px; z-index:10; background:rgba(37,37,38,0.9);
    backdrop-filter: blur(6px); padding:8px 12px; border-radius:8px; font-size:12px;
    border:1px solid #3c3c3c; max-width:440px;
  }
  #toolbar div { margin-bottom:4px; }
  .legend-line { display:inline-block; width:16px; height:0; border-top:2px solid; margin-right:6px; vertical-align:middle; }
  #resetBtn {
    margin-top:4px; background:#0e639c; border:none; color:#fff; padding:4px 10px;
    border-radius:4px; cursor:pointer; font-size:11px;
  }
  #resetBtn:hover { background:#1177bb; }
  svg { width:100vw; height:100vh; display:block; cursor:grab; }
  #viewport.animate { transition: transform 0.6s cubic-bezier(0.22, 1, 0.36, 1); }

  .layer-label { fill:#888; font-size:12px; font-weight:600; pointer-events:none; opacity:0.55; text-anchor:middle; }
  .layer-divider { stroke:#3c3c3c; stroke-width:1; opacity:0.4; }

  .node .core { stroke:#fff; stroke-width:1px; cursor:pointer; transition: filter 0.2s ease, stroke-width 0.2s ease; }
  .node .glow { filter: blur(6px); transition: opacity 0.25s ease; pointer-events:none; }
  .node:hover .core { filter: drop-shadow(0 0 8px currentColor); }
  .node.active .core { stroke-width:2.5px; filter: drop-shadow(0 0 16px #fff); }
  .node.active .glow { opacity:0.6; }
  .node.dim { opacity:0.06; }
  .node text { fill:#eee; font-size:10px; pointer-events:none; }
  .node.entry .core { stroke:#ffd700; stroke-width:2px; }

  .edge-import { stroke:#569cd6; stroke-width:1.3px; opacity:0.5; fill:none; transition: opacity 0.3s ease, stroke-width 0.3s ease, filter 0.3s ease; }
  .edge-call { stroke:#ce9178; stroke-width:1px; stroke-dasharray:4,3; opacity:0.4; fill:none; transition: opacity 0.3s ease, stroke-width 0.3s ease, filter 0.3s ease; }
  .edge-import.active { stroke-width:2.6px; opacity:0.95; filter: drop-shadow(0 0 5px #569cd6); }
  .edge-call.active { stroke-width:2px; opacity:0.9; filter: drop-shadow(0 0 5px #ce9178); }
  .edge-import.dim, .edge-call.dim { opacity:0.03; }

  #tooltip {
    position:fixed; pointer-events:none; background:rgba(37,37,38,0.95); border:1px solid #454545;
    padding:8px 10px; border-radius:6px; font-size:12px; max-width:340px; display:none; z-index:20;
    box-shadow: 0 4px 16px rgba(0,0,0,0.6);
  }
  #tooltip b { color:#4fc1ff; }
  #tooltip .func { color:#9cdcfe; }
  #tooltip .muted { opacity:0.65; }
  #tooltip .dblclick-hint { color:#b5cea8; font-style:italic; margin-top:4px; }
  #zoomLabel { position:fixed; bottom:8px; left:8px; font-size:11px; opacity:0.5; z-index:10; }
</style>
</head>
<body>
<div id="toolbar">
  <div>&#9679; <b>Gold ring</b> = entry point (not imported by anything)</div>
  <div><span class="legend-line" style="border-color:#569cd6"></span>Import connection</div>
  <div><span class="legend-line" style="border-color:#ce9178; border-top-style:dashed;"></span>Function call connection</div>
  <div class="muted" style="opacity:0.6;">Click = isolate &amp; zoom &middot; <b>Ctrl+Click = open file</b> &middot; drag to move &middot; scroll to zoom</div>
  <button id="resetBtn">Reset View</button>
</div>
<div id="tooltip"></div>
<div id="zoomLabel">100%</div>
<svg id="graph">
  <defs>
    <marker id="arrow-import" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto">
      <path d="M0,0 L10,5 L0,10 z" fill="#569cd6"></path>
    </marker>
    <marker id="arrow-import-active" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto">
      <path d="M0,0 L10,5 L0,10 z" fill="#9cdcfe"></path>
    </marker>
    <marker id="arrow-import-dim" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto">
      <path d="M0,0 L10,5 L0,10 z" fill="#569cd6" opacity="0.08"></path>
    </marker>
    <marker id="arrow-call" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto">
      <path d="M0,0 L10,5 L0,10 z" fill="#ce9178"></path>
    </marker>
    <marker id="arrow-call-active" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto">
      <path d="M0,0 L10,5 L0,10 z" fill="#ffc4a3"></path>
    </marker>
    <marker id="arrow-call-dim" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto">
      <path d="M0,0 L10,5 L0,10 z" fill="#ce9178" opacity="0.08"></path>
    </marker>
  </defs>
  <g id="viewport"></g>
</svg>

<script>
const graph = ${graphJson};
const vscode = acquireVsCodeApi();
const svg = document.getElementById('graph');
const viewport = document.getElementById('viewport');
const tooltip = document.getElementById('tooltip');
const zoomLabel = document.getElementById('zoomLabel');
const resetBtn = document.getElementById('resetBtn');
const W = window.innerWidth;
const H = window.innerHeight;
const svgNS = "http://www.w3.org/2000/svg";

function el(tag, attrs) {
  const e = document.createElementNS(svgNS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  return e;
}

function colorForFolder(folder) {
  const palette = ['#4ec9b0','#dcdcaa','#c586c0','#9cdcfe','#d16969','#b5cea8','#ce9178','#569cd6'];
  let hash = 0;
  for (let i = 0; i < folder.length; i++) hash = (hash * 31 + folder.charCodeAt(i)) >>> 0;
  return palette[hash % palette.length];
}

const nodes = graph.nodes.map(n => ({ ...n, x: 0, y: 0 }));
const nodeById = {};
nodes.forEach(n => nodeById[n.id] = n);
const nodeRadius = {};
nodes.forEach(n => { nodeRadius[n.id] = 5 + Math.min(10, (n.functions?.length || 0) * 0.6); });

const edges = graph.edges.map(e => ({...e, s: nodeById[e.source], t: nodeById[e.target]})).filter(e => e.s && e.t);
const importEdges = edges.filter(e => e.type === 'import');

// layered layout
const incomingCount = {};
nodes.forEach(n => incomingCount[n.id] = 0);
importEdges.forEach(e => incomingCount[e.target] += 1);
const entryIds = new Set(nodes.filter(n => incomingCount[n.id] === 0).map(n => n.id));
if (entryIds.size === 0 && nodes.length > 0) { entryIds.add(nodes[0].id); }

const layer = {};
nodes.forEach(n => layer[n.id] = 0);

const passes = Math.min(nodes.length, 60);
for (let p = 0; p < passes; p++) {
  let changed = false;
  for (const e of importEdges) {
    const proposed = layer[e.source] + 1;
    if (layer[e.target] < proposed) { layer[e.target] = proposed; changed = true; }
  }
  if (!changed) { break; }
}

const layerGroups = {};
nodes.forEach(n => {
  const l = layer[n.id];
  (layerGroups[l] = layerGroups[l] || []).push(n);
});
Object.values(layerGroups).forEach(group => {
  group.sort((a, b) => (a.folderPath + a.fileName).localeCompare(b.folderPath + b.fileName));
});

const colSpacing = 260;
const rowSpacing = 64;
const layerKeys = Object.keys(layerGroups).map(Number).sort((a,b) => a-b);
layerKeys.forEach(l => {
  const group = layerGroups[l];
  const totalHeight = group.length * rowSpacing;
  group.forEach((n, i) => {
    n.x = 160 + l * colSpacing;
    n.y = (H/2 - totalHeight/2) + i * rowSpacing + rowSpacing/2;
  });
});

const nodeGroups = [];
const edgeEls = [];

function markerId(type, state) {
  const base = type === 'import' ? 'arrow-import' : 'arrow-call';
  return state ? base + '-' + state : base;
}

function computeEdgeEndpoints(e) {
  // swap: target se source ki taraf arrow (data flow direction)
  const dx = e.s.x - e.t.x, dy = e.s.y - e.t.y;
  const dist = Math.sqrt(dx*dx + dy*dy) || 0.01;
  const ux = dx / dist, uy = dy / dist;
  const rSource = nodeRadius[e.t.id] + 2;
  const rTarget = nodeRadius[e.s.id] + 6;
  return {
    x1: e.t.x + ux * rSource, y1: e.t.y + uy * rSource,
    x2: e.s.x - ux * rTarget, y2: e.s.y - uy * rTarget,
  };
}

function refreshEdgesFor(nodeId) {
  edgeEls.forEach(ee => {
    if (ee.data.source === nodeId || ee.data.target === nodeId) {
      const pts = computeEdgeEndpoints(ee.data);
      ee.el.setAttribute('x1', pts.x1); ee.el.setAttribute('y1', pts.y1);
      ee.el.setAttribute('x2', pts.x2); ee.el.setAttribute('y2', pts.y2);
    }
  });
}

// column headers + dividers
layerKeys.forEach(l => {
  const x = 160 + l * colSpacing;
  const label = el('text', { x: x, y: 34, class: 'layer-label' });
  label.textContent = l === 0 ? 'Entry point' : 'Layer ' + l;
  viewport.appendChild(label);
  const divider = el('line', { x1: x, y1: 50, x2: x, y2: H - 20, class: 'layer-divider' });
  viewport.appendChild(divider);
});

// draw edges
for (const e of edges) {
  const pts = computeEdgeEndpoints(e);
  const line = el('line', {
    x1: pts.x1, y1: pts.y1, x2: pts.x2, y2: pts.y2,
    class: e.type === 'import' ? 'edge-import' : 'edge-call',
    'marker-end': 'url(#' + markerId(e.type, null) + ')'
  });
  viewport.appendChild(line);
  edgeEls.push({ el: line, data: e });
}

// draw nodes
for (const n of nodes) {
  const color = colorForFolder(n.folderPath || '(root)');
  const isEntry = entryIds.has(n.id);
  const g = el('g', {
    class: 'node' + (isEntry ? ' entry' : ''),
    transform: 'translate(' + n.x + ',' + n.y + ')',
    style: 'color:' + color
  });
  const radius = nodeRadius[n.id];
  const glow = el('circle', { r: radius + 5, class: 'glow', fill: color, opacity: 0.22 });
  const circle = el('circle', { r: radius, class: 'core', fill: color });
  const label = el('text', { x: radius + 5, y: 3 });
  label.textContent = n.fileName;
  g.appendChild(glow);
  g.appendChild(circle);
  g.appendChild(label);
  viewport.appendChild(g);
  nodeGroups.push({ el: g, data: n, radius });

  g.addEventListener('mouseenter', (ev) => showTooltip(ev, n));
  g.addEventListener('mousemove', (ev) => positionTooltip(ev));
  g.addEventListener('mouseleave', hideTooltip);

  // click — Ctrl+Click = open file, normal click = isolate + zoom
  g.addEventListener('click', (ev) => {
    ev.stopPropagation();
    if (ev.ctrlKey || ev.metaKey) {
      vscode.postMessage({ command: 'openFile', fileId: n.id });
    } else {
      selectNode(n.id);
    }
  });

  // drag to reposition node
  let dragging = false;
  g.addEventListener('mousedown', (ev) => { dragging = true; ev.stopPropagation(); });
  window.addEventListener('mousemove', (ev) => {
    if (!dragging) { return; }
    const rect = svg.getBoundingClientRect();
    n.x = (ev.clientX - rect.left - viewX) / viewScale;
    n.y = (ev.clientY - rect.top - viewY) / viewScale;
    g.setAttribute('transform', 'translate(' + n.x + ',' + n.y + ')');
    refreshEdgesFor(n.id);
  });
  window.addEventListener('mouseup', () => { dragging = false; });
}

function showTooltip(ev, n) {
  const funcs = (n.functions || []).map(f => f.name).slice(0, 12).join(', ');
  tooltip.innerHTML =
    '<b>' + n.fileName + '</b>' + (entryIds.has(n.id) ? ' &#11088; entry' : '') + '<br/>' +
    '<span class="muted">' + (n.folderPath || '(root)') + ' &middot; layer ' + layer[n.id] + '</span><br/>' +
    'LOC: ' + n.loc + ' &nbsp; Functions: ' + (n.functions?.length||0) + ' &nbsp; Imports: ' + (n.imports?.length||0) +
    (funcs ? '<br/><span class="func">' + funcs + '</span>' : '') +
    '<br/><span class="dblclick-hint">&#128196; Ctrl+Click to open file</span>';
  tooltip.style.display = 'block';
  positionTooltip(ev);
}
function positionTooltip(ev) {
  tooltip.style.left = (ev.clientX + 14) + 'px';
  tooltip.style.top = (ev.clientY + 14) + 'px';
}
function hideTooltip() { tooltip.style.display = 'none'; }

// pan / zoom
let viewX = 0, viewY = 0, viewScale = 1;
function applyViewport(animated) {
  if (animated) {
    viewport.classList.add('animate');
    setTimeout(() => viewport.classList.remove('animate'), 650);
  }
  viewport.setAttribute('transform', 'translate(' + viewX + ',' + viewY + ') scale(' + viewScale + ')');
  zoomLabel.textContent = Math.round(viewScale * 100) + '%';
}

viewX = W/2 - 160;
viewY = 0;
applyViewport(false);

svg.addEventListener('wheel', (ev) => {
  ev.preventDefault();
  const rect = svg.getBoundingClientRect();
  const mx = ev.clientX - rect.left, my = ev.clientY - rect.top;
  const zoomFactor = ev.deltaY < 0 ? 1.12 : 0.89;
  const newScale = Math.min(5, Math.max(0.1, viewScale * zoomFactor));
  const worldX = (mx - viewX) / viewScale, worldY = (my - viewY) / viewScale;
  viewX = mx - worldX * newScale; viewY = my - worldY * newScale;
  viewScale = newScale;
  applyViewport(false);
}, { passive: false });

let panning = false, panStart = { x:0, y:0 }, viewStart = { x:0, y:0 }, panMoved = false;
svg.addEventListener('mousedown', (ev) => {
  if (ev.target === svg) {
    panning = true; panMoved = false;
    panStart = { x: ev.clientX, y: ev.clientY };
    viewStart = { x: viewX, y: viewY };
    svg.style.cursor = 'grabbing';
  }
});
window.addEventListener('mousemove', (ev) => {
  if (!panning) { return; }
  const dx = ev.clientX - panStart.x, dy = ev.clientY - panStart.y;
  if (Math.abs(dx) > 3 || Math.abs(dy) > 3) { panMoved = true; }
  viewX = viewStart.x + dx; viewY = viewStart.y + dy;
  applyViewport(false);
});
window.addEventListener('mouseup', () => { panning = false; svg.style.cursor = 'grab'; });

let activeId = null;
function selectNode(id) {
  activeId = (activeId === id) ? null : id;

  if (!activeId) {
    nodeGroups.forEach(ng => { ng.el.classList.remove('dim'); ng.el.classList.remove('active'); });
    edgeEls.forEach(ee => {
      ee.el.classList.remove('dim'); ee.el.classList.remove('active');
      ee.el.setAttribute('marker-end', 'url(#' + markerId(ee.data.type, null) + ')');
    });
    viewX = W/2 - 160; viewY = 0; viewScale = 1;
    applyViewport(true);
    return;
  }

  const connected = new Set([activeId]);
  edgeEls.forEach(ee => {
    if (ee.data.source === activeId || ee.data.target === activeId) {
      connected.add(ee.data.source); connected.add(ee.data.target);
    }
  });
  nodeGroups.forEach(ng => {
    const isConnected = connected.has(ng.data.id);
    ng.el.classList.toggle('dim', !isConnected);
    ng.el.classList.toggle('active', ng.data.id === activeId);
  });
  edgeEls.forEach(ee => {
    const relevant = ee.data.source === activeId || ee.data.target === activeId;
    ee.el.classList.toggle('dim', !relevant);
    ee.el.classList.toggle('active', relevant);
    ee.el.setAttribute('marker-end', 'url(#' + markerId(ee.data.type, relevant ? 'active' : 'dim') + ')');
  });

  const target = nodeById[activeId];
  viewScale = 2.2;
  viewX = W/2 - target.x * viewScale;
  viewY = H/2 - target.y * viewScale;
  applyViewport(true);
}

svg.addEventListener('click', () => {
  if (panMoved) { panMoved = false; return; }
  selectNode(null);
});
resetBtn.addEventListener('click', () => selectNode(null));
</script>
</body>
</html>`;
    }
}
