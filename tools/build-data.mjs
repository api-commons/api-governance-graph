#!/usr/bin/env node
// Assemble the governance graph bundle from the local building-block repos +
// the API Validator machine ruleset. Run locally (`npm run data`); the output
// src/graph-bundle.json is COMMITTED, so CI only needs `vite build` — no sibling
// repos, no network. Regenerate whenever the rules or building blocks change.
//
// Sources (all sibling checkouts under GitHub/):
//   commons/api-validator/src/all-rules.json          — 733 machine rules (by format)
//   api-evangelist/{policies,rules,guidance,experiences,lifecycle,properties,strategies,solutions}/_store/*.md
//
// The join spine (verified): policy.rules[] === machine rule id === rules/_store slug;
// policy.guidance path-tail === guidance slug; policy.lifecycle[] === lifecycle slug;
// rule.tags experience:<v> === experience-quality; rule.source === provenance.

import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { parse as parseYaml } from 'yaml';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');
const COMMONS = resolve(REPO, '..');            // GitHub/commons
const GH = resolve(COMMONS, '..');              // GitHub/
const AE = join(GH, 'api-evangelist');

// The YAML source carries the FULL catalog (all 12 artifact formats, 733 rules);
// the runtime src/all-rules.json is only the 4 in-browser formats (579). The graph
// is the whole governance surface, so read the full source of truth.
const VALIDATOR_RULES = join(COMMONS, 'api-validator', 'rules', 'all-rules.yaml');

// ---- helpers ----------------------------------------------------------------
const slugify = (s) => String(s || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const arr = (v) => (Array.isArray(v) ? v : v == null || v === '' ? [] : [v]);
const tail = (s) => String(s || '').split('/').filter(Boolean).pop() || '';

// Parse YAML frontmatter out of a `--- ... ---` markdown file.
function frontmatter(text) {
  const m = /^---\s*\n([\s\S]*?)\n---/.exec(text);
  if (!m) return null;
  try { return parseYaml(m[1]) || {}; } catch { return null; }
}

// Read every _store/*.md in an api-evangelist building-block site → [frontmatter…]
function readStore(site) {
  const dir = join(AE, site, '_store');
  if (!existsSync(dir)) { console.warn(`  ! missing ${site}/_store`); return []; }
  const out = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.md')) continue;
    const fm = frontmatter(readFileSync(join(dir, f), 'utf8'));
    if (!fm) continue;
    if (!fm.slug) fm.slug = f.replace(/\.md$/, '');
    out.push(fm);
  }
  return out;
}

// ---- node + edge registries ------------------------------------------------
const nodes = new Map();          // id -> node
const edgeSet = new Set();        // dedupe "from|to|rel"
const edges = [];

function addNode(kind, slug, label, meta = {}) {
  const id = `${kind}:${slug}`;
  const existing = nodes.get(id);
  if (existing) { // enrich (first non-empty wins per field)
    for (const [k, v] of Object.entries(meta)) if (existing.meta[k] == null && v != null) existing.meta[k] = v;
    if (label && (!existing.label || existing.label === slug)) existing.label = label;
    return id;
  }
  nodes.set(id, { id, kind, slug, label: label || slug, meta });
  return id;
}
function ensure(kind, slug) { // reference a node that may not be defined yet
  const id = `${kind}:${slug}`;
  if (!nodes.has(id)) nodes.set(id, { id, kind, slug, label: slug, meta: {}, stub: true });
  return id;
}
function addEdge(from, to, rel) {
  const key = `${from}|${to}|${rel}`;
  if (edgeSet.has(key)) return;
  edgeSet.add(key);
  edges.push({ from, to, rel });
}

// ---- 1. machine rules (Rule + Provenance + Experience-quality) -------------
console.log('Reading machine ruleset…');
const catalog = parseYaml(readFileSync(VALIDATOR_RULES, 'utf8'));
let ruleCount = 0, collisions = 0;
const EXP_TAG = 'experience:';
for (const [format, group] of Object.entries(catalog)) {
  if (!group || typeof group !== 'object') continue;
  for (const [rid, r] of Object.entries(group)) {
    if (!r || typeof r !== 'object') continue;
    ruleCount++;
    const id = `rule:${rid}`;
    if (nodes.has(id) && !nodes.get(id).stub) collisions++;
    const tags = arr(r.tags);
    const experiences = tags.filter((t) => t.startsWith(EXP_TAG)).map((t) => t.slice(EXP_TAG.length));
    const owasp = tags.filter((t) => t.startsWith('owasp:')).map((t) => t.slice(6));
    addNode('rule', rid, r.title || rid, {
      format, severity: r.severity || 'info', source: r.source || 'unknown',
      description: r.description || '', reference: r.reference || '',
      given: typeof r.given === 'string' ? r.given : arr(r.given).join(', '),
      experiences, owasp,
    });
    // rule -> provenance (lineage)
    const src = r.source || 'unknown';
    addNode('provenance', src, provenanceLabel(src), {});
    addEdge(id, `provenance:${src}`, 'origin');
    // rule -> experience-quality (the experience: tag axis)
    for (const ev of experiences) { addNode('experience', ev, titleCase(ev), { axis: 'quality' }); addEdge(id, `experience:${ev}`, 'improves'); }
  }
}
console.log(`  ${ruleCount} rules, ${collisions} id collisions across formats (first kept)`);

function provenanceLabel(s) {
  return ({ compiled: 'Compiled (recommended)', builtin: 'Built-in (Spectral)', default: 'Default ruleset', spotlight: 'Spotlight-recommended', unknown: 'Unspecified' })[s] || titleCase(s);
}
function titleCase(s) { return String(s).replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()); }

// ---- 2. building-block nodes ------------------------------------------------
console.log('Reading building blocks…');
const policies = readStore('policies');
const guidance = readStore('guidance');
const experiences = readStore('experiences');
const lifecycle = readStore('lifecycle');
const properties = readStore('properties');
const strategies = readStore('strategies');
const rulesContent = readStore('rules');

// guidance nodes
for (const g of guidance) addNode('guidance', g.slug, g.title || g.name || g.slug, { subtitle: g.subtitle || '', tags: arr(g.tags) });
// experience building-block nodes (distinct axis from rule-tag qualities; keyed same namespace, marked)
for (const e of experiences) addNode('experience', e.slug, e.name || e.slug, { axis: nodes.has(`experience:${e.slug}`) ? 'both' : 'building-block', icon: e.icon || '', description: e.description || '', properties: arr(e.properties) });
// lifecycle nodes
for (const l of lifecycle) addNode('lifecycle', l.slug, l.name || l.slug, { phase: l.phase || '', order: l.order ?? null, icon: l.icon || '' });
// property nodes (leaf vocab — rail only, but real)
for (const p of properties) addNode('property', p.slug, p.name || p.slug, {});
// enrich rule nodes with the content twin (guidance link, message)
for (const rc of rulesContent) {
  const id = `rule:${rc.slug}`;
  if (nodes.has(id)) {
    const n = nodes.get(id); n.stub = false;
    if (!n.meta.guidanceSlug && (rc.guidance || rc.guidanceUrl)) n.meta.guidanceSlug = tail(rc.guidance) || '';
    if (rc.message && !n.meta.message) n.meta.message = rc.message;
  }
  // rule -> guidance (content twin's direct guidance link)
  if (rc.guidance) { const gs = tail(rc.guidance); if (nodes.has(`guidance:${gs}`)) addEdge(id, `guidance:${gs}`, 'why'); }
}

// experience(building-block) -> property
const propByName = new Map(properties.map((p) => [String(p.name || p.slug).toLowerCase(), p.slug]));
for (const e of experiences) for (const pn of arr(e.properties)) { const ps = propByName.get(String(pn).toLowerCase()) || slugify(pn); addEdge(`experience:${e.slug}`, ensure('property', ps), 'uses'); }

// ---- 3. policy nodes + their outbound edges (the hub) ----------------------
const expByName = new Map();
for (const e of experiences) { expByName.set(String(e.name || '').toLowerCase(), e.slug); expByName.set(String(e.slug), e.slug); }
let danglingRuleRefs = 0;
for (const p of policies) {
  const pid = addNode('policy', p.slug, p.name || p.slug, { scope: p.scope || '', description: p.description || '', tags: arr(p.tags), stages: arr(p.stages) });
  for (const rs of arr(p.rules)) { const rid = ensure('rule', rs); if (nodes.get(rid).stub) danglingRuleRefs++; addEdge(pid, rid, 'enforces'); }
  for (const en of arr(p.experiences)) { const es = expByName.get(String(en).toLowerCase()) || slugify(en); addEdge(pid, ensure('experience', es), 'improves'); }
  if (p.guidance) { const gs = tail(p.guidance); addEdge(pid, ensure('guidance', gs), 'why'); }
  for (const ls of arr(p.lifecycle)) addEdge(pid, ensure('lifecycle', ls), 'stage');
  for (const pr of [...arr(p.properties), ...(p.property ? [p.property] : [])]) { const ps = propByName.get(String(pr).toLowerCase()) || slugify(pr); addEdge(pid, ensure('property', ps), 'uses'); }
}

// ---- 4. strategies frame policies ------------------------------------------
for (const s of strategies) { const sid = addNode('strategy', s.slug, s.name || s.slug, { description: s.description || '' }); for (const ps of arr(s.policies)) addEdge(sid, ensure('policy', ps), 'frames'); }

// ---- assemble + stats -------------------------------------------------------
const nodeList = [...nodes.values()].map((n) => { delete n.stub; return n; });
const byKind = {};
for (const n of nodeList) byKind[n.kind] = (byKind[n.kind] || 0) + 1;

const bundle = {
  generatedAt: new Date().toISOString(),
  source: { rules: '@api-common/api-validator catalog', blocks: 'apievangelist.com building blocks' },
  columns: ['guidance', 'policy', 'rule', 'provenance', 'experience', 'lifecycle'],
  stats: { nodes: nodeList.length, edges: edges.length, byKind, catalogRules: ruleCount, danglingRuleRefs, ruleIdCollisions: collisions },
  nodes: nodeList,
  edges,
};

const OUT = join(REPO, 'public', 'graph-bundle.json');
writeFileSync(OUT, JSON.stringify(bundle));
console.log(`\nWrote ${OUT}`);
console.log(`  nodes: ${nodeList.length}  edges: ${edges.length}`);
console.log(`  byKind:`, byKind);
console.log(`  policy→rule refs with no machine rule: ${danglingRuleRefs}`);
