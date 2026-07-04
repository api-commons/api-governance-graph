import './style.css';
import { Graph, KIND_LABEL, REL_LABEL, type Bundle, type Kind, type GNode } from './graph';

const KIND_COLOR: Record<Kind, string> = {
  guidance: '#ffc107', policy: '#a371f7', rule: '#3794ff', provenance: '#8b949e',
  experience: '#2da44e', lifecycle: '#f78166', property: '#6e7681', strategy: '#db61a2',
};

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const esc = (s: any) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

const canvas = $('#canvas');
const detail = $('#detail');
const detailBody = $('#detail-body');
const counts = $('#counts');
const searchInput = $<HTMLInputElement>('#search');

let graph: Graph;
let view: 'stack' | 'gaps' | 'experience' = 'stack';
let selected: string | null = null;

// ---- boot -------------------------------------------------------------------
init();
async function init() {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}graph-bundle.json`);
    const bundle = (await res.json()) as Bundle;
    graph = new Graph(bundle);
    const s = bundle.stats;
    counts.innerHTML = `<b>${s.catalogRules ?? (s.byKind.rule || 0)}</b> catalog rules · <b>${s.byKind.policy || 0}</b> policies · <b>${s.byKind.guidance || 0}</b> guidance · <b>${s.edges}</b> links`;
    render();
  } catch (e) {
    canvas.innerHTML = `<div class="loading">Couldn't load the graph bundle. ${esc((e as Error).message)}</div>`;
  }
  wireChrome();
}

// ---- chrome (tabs, search, detail, about, engage) ---------------------------
function wireChrome() {
  document.querySelectorAll<HTMLButtonElement>('.view-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.view-tab').forEach((t) => t.classList.remove('is-active'));
      tab.classList.add('is-active');
      view = tab.dataset.view as typeof view;
      searchInput.value = '';
      closeDetail();
      render();
    });
  });
  searchInput.addEventListener('input', () => applySearch(searchInput.value.trim().toLowerCase()));
  $('#detail-close').addEventListener('click', closeDetail);
  $('#engage-ae').addEventListener('click', () => {
    location.href = 'mailto:info@apievangelist.com?subject=' + encodeURIComponent('API governance — help mapping our Guidance Stack') +
      '&body=' + encodeURIComponent("I'm looking at the API Governance Graph and want help binding our rules, policies, and guidance into a coherent stack.");
  });
  $('#nav-about').addEventListener('click', (e) => { e.preventDefault(); openAbout(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeAbout(); closeDetail(); } });
}

// ---- render dispatch --------------------------------------------------------
function render() {
  if (view === 'stack') renderStack();
  else if (view === 'gaps') renderGaps();
  else renderExperience();
}

// ---- STACK view -------------------------------------------------------------
function renderStack() {
  const cols = graph.bundle.columns;
  const html = cols.map((kind) => {
    const nodes = sortColumn(kind, graph.nodes(kind));
    const items = nodes.map((n) => nodeButton(n)).join('');
    return `<div class="col" data-kind="${kind}">
      <div class="col-head"><span class="col-dot" style="background:${KIND_COLOR[kind]}"></span>
        <h3>${esc(KIND_LABEL[kind])}</h3><span class="n">${nodes.length}</span></div>
      ${items}</div>`;
  }).join('');
  canvas.innerHTML = `<div class="columns">${html}</div>`;
  canvas.querySelector('.columns')!.addEventListener('click', onNodeClick);
  if (selected) applyWalk(selected);
}

function sortColumn(kind: Kind, nodes: GNode[]): GNode[] {
  const copy = [...nodes];
  if (kind === 'lifecycle') return copy.sort((a, b) => (a.meta.order ?? 999) - (b.meta.order ?? 999));
  if (kind === 'provenance') { const ord = ['compiled', 'default', 'builtin', 'spotlight', 'unknown']; return copy.sort((a, b) => ord.indexOf(a.slug) - ord.indexOf(b.slug)); }
  if (kind === 'experience') return copy.sort((a, b) => graph.incoming(b.id).length - graph.incoming(a.id).length);
  return copy.sort((a, b) => a.label.localeCompare(b.label));
}

function nodeButton(n: GNode): string {
  const orphan = isOrphan(n);
  const meta = nodeSubLabel(n);
  return `<button class="node${orphan ? ' is-orphan' : ''}" data-id="${esc(n.id)}" style="--nc:${KIND_COLOR[n.kind]}" title="${esc(n.label)}">
    <span class="nlabel">${esc(n.label)}</span>${meta ? `<span class="nmeta">${esc(meta)}</span>` : ''}</button>`;
}

function nodeSubLabel(n: GNode): string {
  if (n.kind === 'rule') return `${n.meta.format || ''} · ${n.meta.source || ''}`;
  if (n.kind === 'policy') return n.meta.scope || '';
  if (n.kind === 'guidance') return n.meta.subtitle ? String(n.meta.subtitle).slice(0, 48) : '';
  if (n.kind === 'lifecycle') return n.meta.phase || '';
  if (n.kind === 'experience') return n.meta.axis === 'quality' ? 'rule axis' : n.meta.axis === 'both' ? 'rule + block' : 'building block';
  if (n.kind === 'provenance') return `${graph.incoming(n.id).length} rules`;
  return '';
}

// A node is an "orphan" (broken stack) if it should link up but doesn't.
function isOrphan(n: GNode): boolean {
  if (n.kind === 'rule') return !graph.incoming(n.id).some((e) => e.rel === 'enforces');
  if (n.kind === 'policy') return !graph.outgoing(n.id).some((e) => e.rel === 'why');
  if (n.kind === 'guidance') return !graph.incoming(n.id).some((e) => e.rel === 'why');
  return false;
}

function onNodeClick(ev: Event) {
  const btn = (ev.target as HTMLElement).closest('.node') as HTMLElement | null;
  if (!btn) return;
  const id = btn.dataset.id!;
  if (selected === id) { closeDetail(); return; }
  selected = id;
  applyWalk(id);
  openDetail(id);
}

function applyWalk(id: string) {
  const set = graph.walk(id);
  const columns = canvas.querySelector('.columns');
  if (!columns) return;
  columns.classList.add('walking');
  canvas.querySelectorAll<HTMLElement>('.node').forEach((el) => {
    const nid = el.dataset.id!;
    el.classList.toggle('in-path', set.has(nid));
    el.classList.toggle('is-selected', nid === id);
  });
}
function clearWalk() {
  selected = null;
  const columns = canvas.querySelector('.columns');
  if (columns) columns.classList.remove('walking');
  canvas.querySelectorAll('.node').forEach((el) => el.classList.remove('in-path', 'is-selected'));
}

// ---- detail rail ------------------------------------------------------------
function openDetail(id: string) {
  const n = graph.node(id);
  if (!n) return;
  const groups = graph.neighboursByRel(id).map((g) => {
    const heading = (REL_LABEL[g.rel]?.[g.direction]) || g.rel;
    const edges = g.nodes.slice(0, 60).map((o) =>
      `<a class="edge" data-goto="${esc(o.id)}" style="--nc:${KIND_COLOR[o.kind]}" href="#">${esc(o.label)}<span class="nmeta"> ${esc(KIND_LABEL[o.kind])}</span></a>`).join('');
    return `<div class="edge-group"><h4>${esc(heading)} · ${g.nodes.length}</h4>${edges}${g.nodes.length > 60 ? `<div class="muted" style="font-size:.78rem">…and ${g.nodes.length - 60} more</div>` : ''}</div>`;
  }).join('');

  detailBody.innerHTML = `
    <span class="kind" style="background:${KIND_COLOR[n.kind]}22;color:${KIND_COLOR[n.kind]}">${esc(KIND_LABEL[n.kind])}</span>
    <h2>${esc(n.label)}</h2>
    ${metaDl(n)}
    ${groups || '<p class="empty">Nothing is bound to this node — it is a loose end in the stack.</p>'}`;
  detail.hidden = false;
  detailBody.querySelectorAll<HTMLElement>('[data-goto]').forEach((a) =>
    a.addEventListener('click', (e) => { e.preventDefault(); goto(a.dataset.goto!); }));
}

function metaDl(n: GNode): string {
  const rows: [string, string][] = [];
  const m = n.meta;
  if (n.kind === 'rule') {
    if (m.format) rows.push(['Format', m.format]);
    if (m.severity) rows.push(['Ships at', m.severity]);
    if (m.source) rows.push(['Provenance', m.source]);
    if (m.given) rows.push(['Given', m.given]);
    if (m.owasp?.length) rows.push(['OWASP', m.owasp.map((o: string) => o.toUpperCase()).join(', ')]);
    if (m.reference) rows.push(['Reference', `<a href="${esc(m.reference)}" target="_blank" rel="noopener">apicommons.org ↗</a>`]);
  } else if (n.kind === 'policy') {
    if (m.scope) rows.push(['Scope', m.scope]);
    if (m.stages?.length) rows.push(['Stage', m.stages.join(', ')]);
  } else if (n.kind === 'lifecycle') {
    if (m.phase) rows.push(['Phase', m.phase]);
  } else if (n.kind === 'provenance') {
    rows.push(['Rules from here', String(graph.incoming(n.id).length)]);
  }
  const desc = m.description || m.subtitle || '';
  const dl = rows.length ? `<dl>${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v.startsWith('<a') ? v : esc(v)}</dd>`).join('')}</dl>` : '';
  const tags = m.tags?.length ? `<div class="gap-list">${m.tags.slice(0, 10).map((t: string) => `<span class="chip">${esc(t)}</span>`).join('')}</div>` : '';
  const p = desc ? `<p class="muted" style="font-size:.86rem">${esc(String(desc).slice(0, 320))}${String(desc).length > 320 ? '…' : ''}</p>` : '';
  return dl + p + tags;
}

function goto(id: string) {
  if (view !== 'stack') { view = 'stack'; document.querySelectorAll('.view-tab').forEach((t) => t.classList.toggle('is-active', (t as HTMLElement).dataset.view === 'stack')); renderStack(); }
  selected = id;
  applyWalk(id);
  openDetail(id);
  canvas.querySelector<HTMLElement>(`.node[data-id="${cssEsc(id)}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
}
const cssEsc = (s: string) => (window.CSS && CSS.escape ? CSS.escape(s) : s.replace(/[^a-zA-Z0-9_-]/g, '\\$&'));

function closeDetail() { detail.hidden = true; clearWalk(); }

// ---- search -----------------------------------------------------------------
function applySearch(q: string) {
  if (view !== 'stack') return;
  canvas.querySelectorAll<HTMLElement>('.node').forEach((el) => {
    const n = graph.node(el.dataset.id!);
    const hit = !q || (n ? (n.label.toLowerCase().includes(q) || n.slug.toLowerCase().includes(q) || JSON.stringify(n.meta.tags || '').toLowerCase().includes(q)) : false);
    el.style.display = hit ? '' : 'none';
  });
}

// ---- GAPS view --------------------------------------------------------------
function renderGaps() {
  const gaps = graph.gaps();
  const cards = gaps.map((g) => `
    <div class="gap-card">
      <h3><span class="sev ${g.severity}">${g.severity}</span> ${esc(g.title)}</h3>
      <p>${esc(g.description)}</p>
      <div class="gap-bar"><span style="width:${g.coverage}%;background:${g.coverage >= 80 ? 'var(--ok)' : g.coverage >= 50 ? 'var(--warn)' : 'var(--error)'}"></span></div>
      <div class="muted" style="font-size:.82rem"><b style="color:var(--fg)">${g.affected}</b> of ${g.total} — <b style="color:var(--fg)">${g.coverage}%</b> clean</div>
      <div class="gap-list">${g.sample.map((n) => `<span class="chip" data-goto="${esc(n.id)}" style="cursor:pointer">${esc(n.label)}</span>`).join('')}${g.affected > g.sample.length ? `<span class="chip more">+${g.affected - g.sample.length} more</span>` : ''}</div>
    </div>`).join('');
  canvas.innerHTML = `<div class="gaps"><p class="muted" style="max-width:640px">Each card is a way the Guidance Stack can be broken — a rule with no policy, a policy with no <em>why</em>, an essay nobody links. The bar is how much of that layer is <em>clean</em>. Click any node to jump to it in the stack.</p>${cards}</div>`;
  canvas.querySelectorAll<HTMLElement>('.chip[data-goto]').forEach((c) => c.addEventListener('click', () => goto(c.dataset.goto!)));
}

// ---- EXPERIENCE view --------------------------------------------------------
function renderExperience() {
  const rows = graph.experienceRollup();
  const cards = rows.map((r) => `
    <div class="exp-card">
      <h3><span class="col-dot" style="background:${KIND_COLOR.experience}"></span>${esc(r.node.label)}</h3>
      <div class="exp-row ${r.rules ? '' : 'lack'}"><span>Rules</span><b>${r.rules}</b></div>
      <div class="exp-row ${r.policies ? '' : 'lack'}"><span>Policies</span><b>${r.policies}</b></div>
      <div class="exp-row"><span>Axis</span><b class="muted" style="font-weight:400">${r.quality ? 'rule tag' : 'building block'}</b></div>
    </div>`).join('');
  canvas.innerHTML = `<div class="gaps" style="padding-bottom:.2rem"><p class="muted" style="max-width:640px">The <code>experience:</code> axis is the one the governance book keeps returning to — it answers <em>what does turning a rule on actually buy the consumer</em>. Here is the whole stack rolled up by it; a zero in either column is a thin spot.</p></div><div class="exp-grid">${cards}</div>`;
}

// ---- about modal ------------------------------------------------------------
function openAbout() {
  const s = graph?.bundle;
  const when = s ? new Date(s.generatedAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) : '';
  const el = document.createElement('div');
  el.id = 'about-modal';
  el.innerHTML = `<div class="about-backdrop"></div><div class="about-card">
    <button class="detail-close" id="about-close">&times;</button>
    <h2>The Guidance Stack, as one graph</h2>
    <p>API governance is not a list of rules — it is a <strong>stack</strong>: a machine <em>rule</em> enforces a written <em>policy</em>, which is explained by a piece of <em>guidance</em>, protects a consumer <em>experience</em>, carries a <em>provenance</em>, and applies at a point in the API <em>lifecycle</em>. When those links exist, governance is legible. When they break — a rule with no policy, a policy with no why — governance is just noise.</p>
    <p>This tool binds the <a href="https://apicommons.org" target="_blank" rel="noopener">API Commons</a> building blocks into that single graph so you can walk it from any node and, in the <strong>Gaps</strong> view, see exactly where it is broken.</p>
    <ul>
      <li><strong>Stack</strong> — every node in six columns; click one to light up everything bound to it.</li>
      <li><strong>Gaps</strong> — the loose ends: unpoliced rules, why-less policies, orphan guidance.</li>
      <li><strong>By experience</strong> — the whole stack rolled up by the <code>experience:</code> axis.</li>
    </ul>
    <p class="muted" style="font-size:.82rem">Data: the ${esc(s?.stats.catalogRules ?? s?.stats.byKind.rule ?? '')}-rule API Commons catalog + the apievangelist.com building blocks (${esc(s?.stats.nodes ?? '')} nodes, ${esc(s?.stats.edges ?? '')} links). Snapshot generated ${esc(when)}. Runs entirely in your browser.</p>
  </div>`;
  document.body.appendChild(el);
  el.querySelector('#about-close')!.addEventListener('click', closeAbout);
  el.querySelector('.about-backdrop')!.addEventListener('click', closeAbout);
}
function closeAbout() { document.getElementById('about-modal')?.remove(); }
