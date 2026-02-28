import { createServer, IncomingMessage, ServerResponse } from "http";
import { createHmac, timingSafeEqual } from "crypto";
import { getWorkflow, listWorkflows } from "../hatchet/register.js";
import { getHatchetClient } from "../hatchet/client.js";
import { isProTier } from "../lib/zyk-api.js";

const DEFAULT_PORT = 3100;

// ── Slack interaction store ───────────────────────────────────────────────────
// Workflows poll GET /slack/pending/:correlationId to retrieve button clicks.
// The correlation ID is the block_id set on the Slack actions block.

interface SlackInteraction {
  action: string;
  userId: string;
  username?: string;
  timestamp: string;
}

const pendingInteractions = new Map<string, SlackInteraction>();

// Evict entries older than 2 hours to avoid unbounded growth
setInterval(() => {
  const cutoff = Date.now() - 2 * 60 * 60 * 1000;
  for (const [key, val] of pendingInteractions) {
    if (new Date(val.timestamp).getTime() < cutoff) pendingInteractions.delete(key);
  }
}, 30 * 60 * 1000).unref();

function verifySlackSignature(
  signingSecret: string,
  signature: string,
  timestamp: string,
  rawBody: string
): boolean {
  const baseString = `v0:${timestamp}:${rawBody}`;
  const hmac = createHmac("sha256", signingSecret);
  hmac.update(baseString);
  const computed = `v0=${hmac.digest("hex")}`;
  try {
    return timingSafeEqual(Buffer.from(computed), Buffer.from(signature));
  } catch {
    return false;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

function sendJson(
  res: ServerResponse,
  status: number,
  body: Record<string, unknown>
) {
  const json = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(json),
  });
  res.end(json);
}

function sendHtml(res: ServerResponse, status: number, html: string) {
  res.writeHead(status, {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Length": Buffer.byteLength(html),
  });
  res.end(html);
}

// ── HTML pages ────────────────────────────────────────────────────────────────

function landingPage(_port: number): string {
  return `<!DOCTYPE html>
<html lang="en" class="dark">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Zyk — Workflow Dashboard</title>
  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <script src="https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js"></script>
  <style>
    :root {
      --bg:            #0a0a0b;
      --bg-secondary:  #111113;
      --bg-tertiary:   #1a1a1d;
      --border:        #27272a;
      --border-light:  #3f3f46;
      --text:          #fafafa;
      --text-secondary:#a1a1aa;
      --text-muted:    #71717a;
      --accent:        #6366f1;
      --accent-hover:  #818cf8;
      --success:       #22c55e;
      --error:         #ef4444;
      --warning:       #f59e0b;
      --font-sans: "Inter", system-ui, -apple-system, sans-serif;
      --font-mono: "JetBrains Mono", ui-monospace, monospace;
    }
    *, *::before, *::after { box-sizing: border-box; }
    html, body { height: 100%; }
    body {
      font-family: var(--font-sans);
      background: var(--bg);
      color: var(--text-secondary);
      margin: 0;
      padding: 0;
      line-height: 1.5;
      font-size: 14px;
      -webkit-font-smoothing: antialiased;
    }

    /* ── Scrollbars ── */
    ::-webkit-scrollbar { width: 6px; height: 6px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }
    ::-webkit-scrollbar-thumb:hover { background: var(--border-light); }

    /* ── Focus ── */
    *:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

    /* ── Header ── */
    header {
      height: 48px;
      background: var(--bg-secondary);
      border-bottom: 1px solid var(--border);
      padding: 0 1.25rem;
      display: flex;
      align-items: center;
      gap: .75rem;
      position: sticky;
      top: 0;
      z-index: 10;
    }
    .logo {
      font-size: 1rem;
      font-weight: 700;
      color: #FFB6D9;
      letter-spacing: -.02em;
      flex-shrink: 0;
    }
    .header-sep {
      width: 1px;
      height: 16px;
      background: var(--border);
    }
    .header-subtitle {
      font-size: 13px;
      color: var(--text-muted);
    }
    .header-actions {
      margin-left: auto;
      display: flex;
      align-items: center;
      gap: .5rem;
    }

    /* ── Buttons ── */
    .btn {
      display: inline-flex;
      align-items: center;
      gap: .35rem;
      padding: .3rem .75rem;
      border-radius: 6px;
      font-size: .8rem;
      font-weight: 500;
      font-family: var(--font-sans);
      cursor: pointer;
      border: 1px solid transparent;
      text-decoration: none;
      transition: background-color .15s, color .15s, border-color .15s;
      white-space: nowrap;
    }
    .btn-ghost {
      background: transparent;
      color: var(--text-muted);
      border-color: transparent;
    }
    .btn-ghost:hover { background: var(--bg-tertiary); color: var(--text-secondary); }

    /* ── Badges ── */
    .badge {
      display: inline-flex;
      align-items: center;
      padding: 1px 8px;
      border-radius: 9999px;
      font-size: .7rem;
      font-weight: 500;
      letter-spacing: .02em;
    }
    .badge-gray     { background: var(--bg-tertiary); color: var(--text-secondary); }
    .badge-indigo   { background: rgba(99,102,241,.12); color: var(--accent-hover); }
    .badge-green    { background: rgba(34,197,94,.1);   color: var(--success); }
    .badge-yellow   { background: rgba(245,158,11,.1);  color: var(--warning); }

    /* ── Layout ── */
    main {
      padding: 1.5rem 1.25rem;
      max-width: 1280px;
      margin: 0 auto;
    }
    .page-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 1.25rem;
    }
    .page-title {
      font-size: .8rem;
      font-weight: 600;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: .06em;
    }
    .workflow-count {
      font-size: .75rem;
      color: var(--text-muted);
    }

    /* ── Empty state ── */
    .empty {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 6rem 0;
      gap: .5rem;
      text-align: center;
    }
    .empty-icon { font-size: 1.75rem; margin-bottom: .25rem; }
    .empty-title { font-size: .95rem; font-weight: 500; color: var(--text-secondary); }
    .empty-hint  { font-size: .8rem; color: var(--text-muted); }
    .empty code  {
      background: var(--bg-tertiary);
      padding: .1em .4em;
      border-radius: 4px;
      color: var(--text-muted);
      font-family: var(--font-mono);
      font-size: .8em;
    }

    /* ── Grid ── */
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(460px, 1fr));
      gap: 1rem;
    }

    /* ── Card ── */
    .card {
      background: var(--bg-secondary);
      border: 1px solid var(--border);
      border-radius: 8px;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      transition: border-color .15s;
    }
    .card:hover { border-color: var(--border-light); }
    .card-header {
      padding: .875rem 1rem .75rem;
      border-bottom: 1px solid var(--border);
      display: flex;
      align-items: flex-start;
      gap: .75rem;
    }
    .card-title { flex: 1; min-width: 0; }
    .card-title h3 {
      margin: 0 0 .2rem;
      font-size: .9rem;
      font-weight: 600;
      color: var(--text);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .card-id {
      font-size: .7rem;
      color: var(--text-muted);
      font-family: var(--font-mono);
    }
    .card-meta {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: .25rem;
      flex-shrink: 0;
    }
    .card-date { font-size: .68rem; color: var(--text-muted); }
    .card-body { padding: .875rem 1rem; flex: 1; }
    .card-desc {
      font-size: .8rem;
      color: var(--text-muted);
      margin: 0 0 .875rem;
      line-height: 1.5;
    }

    /* ── Diagram ── */
    .diagram-wrap {
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 6px;
      overflow: hidden;
      position: relative;
      min-height: 140px;
      display: flex;
      justify-content: center;
      align-items: center;
      cursor: grab;
    }
    .diagram-wrap svg { display: block; max-width: 100%; height: auto; user-select: none; }
    .diagram-none { font-size: .75rem; color: var(--border-light); cursor: default; }

    /* ── Diagram zoom controls ── */
    .diagram-controls {
      position: absolute;
      top: 6px;
      right: 6px;
      display: flex;
      gap: 2px;
      opacity: 0;
      transition: opacity .15s;
      z-index: 2;
    }
    .diagram-wrap:hover .diagram-controls { opacity: 1; }
    .diagram-controls button {
      width: 22px;
      height: 22px;
      border: 1px solid var(--border-light);
      background: var(--bg-secondary);
      color: var(--text-muted);
      border-radius: 4px;
      cursor: pointer;
      font-size: 13px;
      padding: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: var(--font-sans);
    }
    .diagram-controls button:hover { background: var(--border); color: var(--text); }

    /* ── Live indicator ── */
    .live-dot {
      position: fixed;
      bottom: 1rem;
      right: 1rem;
      display: flex;
      align-items: center;
      gap: .4rem;
      background: var(--bg-secondary);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: .35rem .7rem;
      font-size: .72rem;
      color: var(--text-muted);
    }
    .live-dot::before {
      content: '';
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--success);
      animation: pulse 2s ease-in-out infinite;
    }
    @keyframes pulse {
      0%,100% { opacity: 1; }
      50%      { opacity: .25; }
    }

    /* ── Tabs ── */
    .tabs {
      display: flex;
      gap: 0;
      border-bottom: 1px solid var(--border);
      margin-bottom: 1.25rem;
    }
    .tab-btn {
      padding: .5rem 1rem;
      font-size: .8rem;
      font-weight: 500;
      color: var(--text-muted);
      background: transparent;
      border: none;
      border-bottom: 2px solid transparent;
      cursor: pointer;
      font-family: var(--font-sans);
      margin-bottom: -1px;
      transition: color .15s, border-color .15s;
    }
    .tab-btn:hover { color: var(--text-secondary); }
    .tab-btn.active { color: var(--text); border-bottom-color: var(--accent); }
    .tab-count {
      display: inline-block;
      background: var(--bg-tertiary);
      color: var(--text-muted);
      border-radius: 9999px;
      font-size: .65rem;
      padding: 1px 5px;
      margin-left: .3rem;
      vertical-align: middle;
    }
    .tab-panel { display: none; }
    .tab-panel.active { display: block; }

    /* ── Runs list ── */
    .runs-list { display: flex; flex-direction: column; gap: .4rem; }
    .run-row {
      background: var(--bg-secondary);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: .6rem 1rem;
      display: grid;
      grid-template-columns: 90px 1fr 120px 80px;
      align-items: center;
      gap: .75rem;
      font-size: .8rem;
      transition: border-color .15s;
    }
    .run-row:hover { border-color: var(--border-light); }
    .run-status { display: flex; align-items: center; gap: .4rem; }
    .status-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
    .s-completed { background: var(--success); }
    .s-failed    { background: var(--error); }
    .s-running   { background: var(--warning); animation: pulse 1.5s ease-in-out infinite; }
    .s-queued    { background: var(--text-muted); }
    .s-cancelled { background: var(--text-muted); opacity: .5; }
    .run-name { font-weight: 500; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .run-time { color: var(--text-muted); text-align: right; }
    .run-dur  { color: var(--text-muted); text-align: right; font-family: var(--font-mono); font-size: .72rem; }
    .runs-empty { text-align: center; padding: 3rem 0; color: var(--text-muted); font-size: .85rem; }
    .runs-toolbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: .75rem;
    }
    .runs-toolbar select {
      background: var(--bg-tertiary);
      border: 1px solid var(--border);
      color: var(--text-secondary);
      border-radius: 5px;
      padding: .25rem .5rem;
      font-size: .75rem;
      font-family: var(--font-sans);
      cursor: pointer;
    }

    /* ── Misc ── */
    a { color: var(--accent-hover); text-decoration: none; }
    a:hover { text-decoration: underline; }
    code {
      background: var(--bg-tertiary);
      padding: .1em .4em;
      border-radius: 4px;
      font-size: .85em;
      color: var(--text-secondary);
      font-family: var(--font-mono);
    }
  </style>
</head>
<body>
  <header>
    <span class="logo">Zyk</span>
    <span class="header-sep"></span>
    <span class="header-subtitle">Workflow Dashboard</span>
    <div class="header-actions">
      <a class="btn btn-ghost" href="http://localhost:8888" target="_blank">Hatchet UI ↗</a>
      <a class="btn btn-ghost" href="/api/workflows" target="_blank">API</a>
    </div>
  </header>

  <main>
    <div class="tabs">
      <button class="tab-btn active" data-tab="workflows">
        Workflows<span class="tab-count" id="wf-count-badge"></span>
      </button>
      <button class="tab-btn" data-tab="runs">
        Runs<span class="tab-count" id="runs-count-badge"></span>
      </button>
    </div>

    <div id="tab-workflows" class="tab-panel active">
      <div id="root"></div>
    </div>

    <div id="tab-runs" class="tab-panel">
      <div class="runs-toolbar">
        <span class="page-title">Recent Executions</span>
        <select id="runs-filter">
          <option value="">All statuses</option>
          <option value="COMPLETED">Completed</option>
          <option value="FAILED">Failed</option>
          <option value="RUNNING">Running</option>
          <option value="QUEUED">Queued</option>
          <option value="CANCELLED">Cancelled</option>
        </select>
      </div>
      <div id="runs-list" class="runs-list"></div>
    </div>
  </main>

  <div class="live-dot">Live</div>

  <script>
    mermaid.initialize({
      startOnLoad: false,
      theme: 'dark',
      themeVariables: {
        background:          '#0a0a0b',
        primaryColor:        '#1e1b4b',
        primaryTextColor:    '#e4e4e7',
        primaryBorderColor:  '#6366f1',
        lineColor:           '#52525b',
        secondaryColor:      '#1a1a1d',
        tertiaryColor:       '#111113',
        edgeLabelBackground: '#111113',
        fontFamily:          '"Inter", system-ui, sans-serif',
        fontSize:            '13px',
      },
      flowchart: { curve: 'basis', padding: 20, useMaxWidth: true },
    });

    let renderSeq = 0;
    const svgCache = new Map(); // wfId -> rendered SVG string
    const cardMap  = new Map(); // wfId -> card DOM element (preserves zoom state across polls)

    // ── Diagram zoom / pan ────────────────────────────────────────────────────
    function initDiagramZoom(wrap) {
      const svg = wrap.querySelector('svg');
      if (!svg) return;

      // Switch wrap from flex (used to center the placeholder) to block
      // so the SVG's top-left aligns with wrap's origin — required for correct zoom math.
      wrap.style.display = 'block';
      svg.style.transformOrigin = '0 0';
      svg.style.display = 'block';
      svg.style.userSelect = 'none';

      let s = 1, x = 0, y = 0;

      function apply() {
        svg.style.transform = \`translate(\${x}px,\${y}px) scale(\${s})\`;
      }

      function zoomAt(cx, cy, factor) {
        const ns = Math.max(0.15, Math.min(6, s * factor));
        x = cx - (cx - x) * (ns / s);
        y = cy - (cy - y) * (ns / s);
        s = ns;
        apply();
      }

      // Scroll to zoom (toward cursor)
      wrap.addEventListener('wheel', e => {
        e.preventDefault();
        const r = wrap.getBoundingClientRect();
        zoomAt(e.clientX - r.left, e.clientY - r.top, e.deltaY < 0 ? 1.15 : 0.87);
      }, { passive: false });

      // Drag to pan
      wrap.addEventListener('mousedown', e => {
        if (e.target.closest('.diagram-controls')) return;
        const sx = e.clientX, sy = e.clientY, tx0 = x, ty0 = y;
        wrap.style.cursor = 'grabbing';
        e.preventDefault();
        function onMove(e) { x = tx0 + e.clientX - sx; y = ty0 + e.clientY - sy; apply(); }
        function onUp()    { wrap.style.cursor = 'grab'; document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); }
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      });

      // Double-click to reset
      wrap.addEventListener('dblclick', e => {
        if (e.target.closest('.diagram-controls')) return;
        s = 1; x = 0; y = 0; apply();
      });

      // +/−/↺ buttons
      const ctrl = document.createElement('div');
      ctrl.className = 'diagram-controls';
      ctrl.innerHTML = '<button title="Zoom in">+</button><button title="Zoom out">−</button><button title="Reset (or double-click)">↺</button>';
      wrap.appendChild(ctrl);
      const center = () => { const r = wrap.getBoundingClientRect(); return [r.width / 2, r.height / 2]; };
      const [btnIn, btnOut, btnReset] = ctrl.querySelectorAll('button');
      btnIn.addEventListener('click',    () => { const [cx,cy] = center(); zoomAt(cx, cy, 1.3); });
      btnOut.addEventListener('click',   () => { const [cx,cy] = center(); zoomAt(cx, cy, 0.77); });
      btnReset.addEventListener('click', () => { s=1; x=0; y=0; apply(); });
    }

    // ── Diagram rendering ─────────────────────────────────────────────────────
    async function renderDiagram(wrap, diagramText, wfId) {
      if (svgCache.has(wfId)) {
        wrap.innerHTML = svgCache.get(wfId);
        initDiagramZoom(wrap);
        return;
      }
      try {
        const { svg } = await mermaid.render('mermaid-' + (++renderSeq), diagramText);
        svgCache.set(wfId, svg);
        wrap.innerHTML = svg;
        initDiagramZoom(wrap);
      } catch {
        wrap.innerHTML = '<span class="diagram-none">⚠ Could not render diagram</span>';
      }
    }

    // ── Card builder ──────────────────────────────────────────────────────────
    function escHtml(str) {
      return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

    function buildCard(wf) {
      const badgeClass = { 'on-demand': 'badge-gray', schedule: 'badge-green' }[wf.trigger] ?? 'badge-gray';
      const scheduleHint = wf.schedule ? \` · \${wf.schedule}\` : '';
      const dateStr = wf.createdAt
        ? new Date(wf.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
        : '';

      const card = document.createElement('div');
      card.className = 'card';
      card.dataset.id = wf.id;
      card.innerHTML =
        '<div class="card-header">' +
          '<div class="card-title">' +
            '<h3>' + escHtml(wf.name) + '</h3>' +
            '<span class="card-id">' + escHtml(wf.id) + '</span>' +
          '</div>' +
          '<div class="card-meta">' +
            '<span class="badge ' + badgeClass + '">' + escHtml(wf.trigger) + escHtml(scheduleHint) + '</span>' +
            (dateStr ? '<span class="card-date">' + dateStr + '</span>' : '') +
          '</div>' +
        '</div>' +
        '<div class="card-body">' +
          (wf.description ? '<p class="card-desc">' + escHtml(wf.description) + '</p>' : '') +
          '<div class="diagram-wrap">' +
            (wf.diagram ? '' : '<span class="diagram-none">No diagram</span>') +
          '</div>' +
        '</div>';

      if (wf.diagram) {
        renderDiagram(card.querySelector('.diagram-wrap'), wf.diagram, wf.id);
      }
      return card;
    }

    // ── Poll loop — smart diff, preserves card DOM and zoom state ─────────────
    async function loadAndRender() {
      let workflows;
      try {
        const res = await fetch('/api/workflows');
        workflows = await res.json();
      } catch { return; }

      const root = document.getElementById('root');
      const badge = document.getElementById('wf-count-badge');
      if (badge) badge.textContent = workflows.length ? String(workflows.length) : '';

      if (!workflows.length) {
        root.innerHTML = \`
          <div class="empty">
            <div class="empty-icon">🤖</div>
            <div class="empty-title">No workflows yet</div>
            <div class="empty-hint">Ask Claude to create one — <code>create a daily Slack summary</code></div>
          </div>\`;
        cardMap.clear();
        return;
      }

      // Ensure the grid container exists
      let grid = root.querySelector('.grid');
      if (!grid) {
        root.innerHTML = '<div class="grid"></div>';
        grid = root.querySelector('.grid');
      }

      // Remove cards for deleted workflows
      const currentIds = new Set(workflows.map(wf => wf.id));
      for (const [id, card] of cardMap) {
        if (!currentIds.has(id)) {
          card.remove();
          cardMap.delete(id);
          svgCache.delete(id);
        }
      }

      // Insert new cards and maintain order (existing cards keep their DOM + zoom state)
      for (let i = 0; i < workflows.length; i++) {
        const wf = workflows[i];
        let card = cardMap.get(wf.id);
        if (!card) {
          card = buildCard(wf);
          cardMap.set(wf.id, card);
        }
        const atPos = grid.children[i];
        if (atPos !== card) grid.insertBefore(card, atPos ?? null);
      }
    }

    loadAndRender();
    setInterval(loadAndRender, 5000);

    // ── Tab switching ─────────────────────────────────────────────────────────
    let activeTab = 'workflows';
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        activeTab = btn.dataset.tab;
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b === btn));
        document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === 'tab-' + activeTab));
        if (activeTab === 'runs') loadRuns();
      });
    });

    // ── Runs ──────────────────────────────────────────────────────────────────
    function relTime(iso) {
      if (!iso) return '—';
      const diff = Date.now() - new Date(iso).getTime();
      if (diff < 60000)  return Math.round(diff / 1000) + 's ago';
      if (diff < 3600000) return Math.round(diff / 60000) + 'm ago';
      if (diff < 86400000) return Math.round(diff / 3600000) + 'h ago';
      return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    }

    function fmtDuration(ms) {
      if (ms == null) return '';
      if (ms < 1000) return ms + 'ms';
      if (ms < 60000) return (ms / 1000).toFixed(1) + 's';
      return Math.round(ms / 60000) + 'm ' + Math.round((ms % 60000) / 1000) + 's';
    }

    function statusDot(status) {
      const cls = { COMPLETED: 's-completed', FAILED: 's-failed', RUNNING: 's-running', QUEUED: 's-queued', CANCELLED: 's-cancelled' }[status] ?? 's-queued';
      const label = (status ?? 'UNKNOWN').toLowerCase();
      return \`<div class="run-status"><div class="status-dot \${cls}"></div><span>\${label}</span></div>\`;
    }

    async function loadRuns() {
      const filterEl = document.getElementById('runs-filter');
      const status = filterEl?.value ?? '';
      const url = '/api/runs?limit=50' + (status ? '&status=' + status : '');
      let data;
      try {
        const r = await fetch(url);
        data = await r.json();
      } catch { return; }

      const el = document.getElementById('runs-list');
      const badge = document.getElementById('runs-count-badge');
      const runs = data.runs ?? [];

      if (badge) badge.textContent = runs.length ? String(runs.length) : '';

      if (!runs.length) {
        el.innerHTML = '<div class="runs-empty">No runs found in the last 24 hours</div>';
        return;
      }

      el.innerHTML = runs.map(r => \`
        <div class="run-row">
          \${statusDot(r.status)}
          <div class="run-name" title="\${escHtml(r.workflow_name)}">\${escHtml(r.workflow_name)}</div>
          <div class="run-time">\${relTime(r.started_at)}</div>
          <div class="run-dur">\${fmtDuration(r.duration_ms)}</div>
        </div>
      \`).join('');
    }

    // Auto-refresh runs when that tab is active
    setInterval(() => { if (activeTab === 'runs') loadRuns(); }, 5000);

    // Filter change
    document.getElementById('runs-filter')?.addEventListener('change', loadRuns);
  </script>
</body>
</html>`;
}

// ── Request handler ───────────────────────────────────────────────────────────

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  port: number
): Promise<void> {
  const url = req.url ?? "/";
  const method = req.method ?? "GET";

  // GET /favicon.svg
  if (method === "GET" && url === "/favicon.svg") {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect width="32" height="32" rx="7" fill="#111113"/>
  <rect x="1.5" y="1.5" width="29" height="29" rx="5.5" fill="none" stroke="#6366f1" stroke-width="1" opacity="0.5"/>
  <text x="16" y="23" font-family="Inter, system-ui, sans-serif" font-size="19" font-weight="700" text-anchor="middle" fill="#FFB6D9" letter-spacing="-1">Z</text>
</svg>`;
    res.writeHead(200, { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=86400" });
    res.end(svg);
    return;
  }

  // GET / — landing page
  if (method === "GET" && url === "/") {
    sendHtml(res, 200, landingPage(port));
    return;
  }

  // GET /api/workflows — JSON list of registered workflows (used by dashboard)
  if (method === "GET" && url === "/api/workflows") {
    const workflows = listWorkflows().map((wf) => ({
      id: wf.id,
      name: wf.name,
      description: wf.description,
      trigger: wf.trigger,
      schedule: wf.schedule ?? null,
      diagram: wf.diagram ?? null,
      createdAt: wf.createdAt,
    }));
    const json = JSON.stringify(workflows, null, 2);
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(json),
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
    });
    res.end(json);
    return;
  }

  // GET /api/runs — recent workflow run executions (used by dashboard)
  if (method === "GET" && url.startsWith("/api/runs")) {
    const params = new URLSearchParams(url.includes("?") ? url.split("?")[1] : "");
    const limit = Math.min(parseInt(params.get("limit") ?? "50", 10), 100);
    const status = params.get("status") ?? undefined;
    const sinceHours = parseInt(params.get("since_hours") ?? "24", 10);
    const since = new Date(Date.now() - sinceHours * 60 * 60 * 1000).toISOString();

    // Build name→zykId map for linking runs to our workflows
    const nameMap: Record<string, string> = {};
    for (const wf of listWorkflows()) nameMap[wf.name] = wf.id;

    try {
      const hatchet = getHatchetClient();
      const tenantId = hatchet.tenantId;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const resp = await hatchet.api.v1WorkflowRunList(tenantId, {
        since,
        limit,
        only_tasks: false,
        ...(status ? { statuses: [status as any] } : {}),
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rows: any[] = (resp.data as any)?.rows ?? [];
      const runs = rows.map((r) => {
        const workflowName: string = r.displayName?.split("/")?.[0] ?? r.workflowName ?? "unknown";
        return {
          run_id: r.metadata?.id ?? r.id,
          workflow_name: workflowName,
          workflow_id: nameMap[workflowName] ?? null,
          status: r.status,
          started_at: r.metadata?.createdAt ?? r.createdAt,
          finished_at: r.finishedAt ?? null,
          duration_ms: r.duration ?? null,
        };
      });
      const json = JSON.stringify({ runs, since }, null, 2);
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(json),
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*",
      });
      res.end(json);
    } catch (err) {
      sendJson(res, 500, { error: `Failed to fetch runs: ${err instanceof Error ? err.message : String(err)}` });
    }
    return;
  }

  // POST /webhook/:workflow_id — trigger a workflow
  const webhookMatch = url.match(/^\/webhook\/([^/]+)$/);
  if (method === "POST" && webhookMatch) {
    const workflowId = webhookMatch[1];
    const entry = getWorkflow(workflowId);
    if (!entry) {
      sendJson(res, 404, {
        error: `Workflow "${workflowId}" not found.`,
        hint: "Use list_workflows to see registered workflows.",
      });
      return;
    }

    let params: Record<string, unknown> = {};
    const rawBody = await readBody(req);
    if (rawBody.trim()) {
      try {
        params = JSON.parse(rawBody) as Record<string, unknown>;
      } catch {
        sendJson(res, 400, { error: "Request body must be valid JSON." });
        return;
      }
    }

    try {
      const hatchet = getHatchetClient();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const runRef = await hatchet.runNoWait(entry.name.toLowerCase(), params as any, {});
      const runId = await runRef.workflowRunId;

      sendJson(res, 200, {
        success: true,
        workflow_id: entry.id,
        workflow_name: entry.name,
        run_id: runId,
      });
    } catch (err) {
      sendJson(res, 500, {
        error: `Failed to trigger workflow: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
    return;
  }

  // POST /slack/interactions — receives Slack button clicks
  if (method === "POST" && url === "/slack/interactions") {
    const rawBody = await readBody(req);

    // Verify Slack signature if signing secret is configured
    const signingSecret = process.env.SLACK_SIGNING_SECRET;
    if (signingSecret) {
      const timestamp = req.headers["x-slack-request-timestamp"] as string ?? "";
      const signature = req.headers["x-slack-signature"] as string ?? "";
      // Reject replays older than 5 minutes
      if (Math.abs(Date.now() / 1000 - parseInt(timestamp, 10)) > 300) {
        sendJson(res, 400, { error: "Request too old" });
        return;
      }
      if (!verifySlackSignature(signingSecret, signature, timestamp, rawBody)) {
        sendJson(res, 401, { error: "Invalid signature" });
        return;
      }
    }

    let payload: Record<string, unknown>;
    try {
      // Slack sends application/x-www-form-urlencoded with a "payload" field
      const decoded = decodeURIComponent(rawBody.replace(/^payload=/, ""));
      payload = JSON.parse(decoded) as Record<string, unknown>;
    } catch {
      sendJson(res, 400, { error: "Invalid payload" });
      return;
    }

    const interactionType = payload.type as string;

    if (interactionType === "block_actions") {
      const actions = payload.actions as Array<Record<string, unknown>>;
      const user = payload.user as Record<string, string>;
      for (const action of actions) {
        const correlationId = action.block_id as string;
        if (correlationId) {
          pendingInteractions.set(correlationId, {
            action: action.action_id as string,
            userId: user?.id ?? "unknown",
            username: user?.username,
            timestamp: new Date().toISOString(),
          });
          console.error(`[Slack] Received action "${action.action_id}" for correlationId "${correlationId}"`);
        }
      }
    }

    // Acknowledge to Slack immediately (must respond within 3s)
    sendJson(res, 200, {});
    return;
  }

  // GET /slack/pending/:correlationId — workflow polling endpoint
  const slackPendingMatch = url.match(/^\/slack\/pending\/([^/]+)$/);
  if (method === "GET" && slackPendingMatch) {
    const correlationId = decodeURIComponent(slackPendingMatch[1]);
    const interaction = pendingInteractions.get(correlationId);
    if (interaction) {
      pendingInteractions.delete(correlationId); // consume once
      sendJson(res, 200, { pending: false, ...interaction });
    } else {
      sendJson(res, 200, { pending: true });
    }
    return;
  }

  // Anything else
  sendJson(res, 404, {
    error: "Not found.",
    routes: [
      "GET  /                             — dashboard",
      "GET  /api/workflows                — workflow list (JSON)",
      "GET  /api/runs                     — recent run executions (JSON)",
      "POST /webhook/:workflow_id         — trigger a workflow",
      "POST /slack/interactions           — Slack button callback (set as Interactivity URL)",
      "GET  /slack/pending/:correlationId — poll for a button click result",
    ],
  });
}

// ── Server startup ────────────────────────────────────────────────────────────

export function startWebhookServer(port = DEFAULT_PORT): void {
  const server = createServer((req, res) => {
    handleRequest(req, res, port).catch((err) => {
      console.error("Webhook handler error:", err);
      if (!res.headersSent) {
        sendJson(res, 500, { error: "Internal server error" });
      }
    });
  });

  server.listen(port, () => {
    console.error(`Webhook server listening on http://localhost:${port}`);
    console.error(`  Landing page:    http://localhost:${port}/`);
    console.error(`  Trigger webhook: POST http://localhost:${port}/webhook/<workflow_id>`);
  });

  server.on("error", (err) => {
    console.error("Webhook server error:", err);
  });
}
