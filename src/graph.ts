// The graph model: load the pre-joined bundle, index it, and answer the two
// questions the tool exists to answer — "what is bound to this node?" (walk) and
// "where is the stack broken?" (gaps). All pure data; no DOM here.

export type Kind =
  | 'guidance' | 'policy' | 'rule' | 'provenance' | 'experience'
  | 'lifecycle' | 'property' | 'strategy';

export interface GNode { id: string; kind: Kind; slug: string; label: string; meta: Record<string, any>; }
export interface GEdge { from: string; to: string; rel: string; }
export interface Bundle {
  generatedAt: string;
  columns: Kind[];
  stats: { nodes: number; edges: number; byKind: Record<string, number>; catalogRules?: number; danglingRuleRefs: number; ruleIdCollisions: number };
  nodes: GNode[];
  edges: GEdge[];
}

export interface Gap {
  id: string; title: string; severity: 'warn' | 'info';
  description: string; total: number; affected: number; coverage: number; sample: GNode[];
}

export class Graph {
  bundle: Bundle;
  byId = new Map<string, GNode>();
  out = new Map<string, GEdge[]>();
  inc = new Map<string, GEdge[]>();
  byKind = new Map<Kind, GNode[]>();

  constructor(bundle: Bundle) {
    this.bundle = bundle;
    for (const n of bundle.nodes) {
      this.byId.set(n.id, n);
      (this.byKind.get(n.kind) ?? this.byKind.set(n.kind, []).get(n.kind)!).push(n);
    }
    for (const e of bundle.edges) {
      (this.out.get(e.from) ?? this.out.set(e.from, []).get(e.from)!).push(e);
      (this.inc.get(e.to) ?? this.inc.set(e.to, []).get(e.to)!).push(e);
    }
  }

  nodes(kind: Kind): GNode[] { return this.byKind.get(kind) ?? []; }
  node(id: string): GNode | undefined { return this.byId.get(id); }
  outgoing(id: string): GEdge[] { return this.out.get(id) ?? []; }
  incoming(id: string): GEdge[] { return this.inc.get(id) ?? []; }

  // 1-hop neighbourhood in both directions — the honest "directly bound to this".
  walk(id: string): Set<string> {
    const set = new Set<string>([id]);
    for (const e of this.outgoing(id)) set.add(e.to);
    for (const e of this.incoming(id)) set.add(e.from);
    return set;
  }

  // Grouped neighbours for the detail rail: rel -> nodes (deduped, resolved).
  neighboursByRel(id: string): { direction: 'out' | 'in'; rel: string; nodes: GNode[] }[] {
    const groups = new Map<string, { direction: 'out' | 'in'; rel: string; ids: Set<string> }>();
    const push = (direction: 'out' | 'in', rel: string, other: string) => {
      const key = `${direction}:${rel}`;
      const g = groups.get(key) ?? groups.set(key, { direction, rel, ids: new Set() }).get(key)!;
      g.ids.add(other);
    };
    for (const e of this.outgoing(id)) push('out', e.rel, e.to);
    for (const e of this.incoming(id)) push('in', e.rel, e.from);
    return [...groups.values()]
      .map((g) => ({ direction: g.direction, rel: g.rel, nodes: [...g.ids].map((i) => this.byId.get(i)).filter(Boolean) as GNode[] }))
      .filter((g) => g.nodes.length)
      .sort((a, b) => b.nodes.length - a.nodes.length);
  }

  private countInc(id: string, rel: string, fromKind?: Kind): number {
    let c = 0;
    for (const e of this.incoming(id)) if (e.rel === rel && (!fromKind || this.byId.get(e.from)?.kind === fromKind)) c++;
    return c;
  }
  private hasOut(id: string, rel: string): boolean { return this.outgoing(id).some((e) => e.rel === rel); }
  private hasInc(id: string, rel: string): boolean { return this.incoming(id).some((e) => e.rel === rel); }

  // The core value: where the Guidance Stack is broken.
  gaps(): Gap[] {
    const rules = this.nodes('rule');
    const policies = this.nodes('policy');
    const guidance = this.nodes('guidance');

    const gap = (id: string, title: string, severity: 'warn' | 'info', description: string, universe: GNode[], predicate: (n: GNode) => boolean): Gap => {
      const affected = universe.filter(predicate);
      const total = universe.length;
      return { id, title, severity, description, total, affected: affected.length, coverage: total ? Math.round(((total - affected.length) / total) * 100) : 100, sample: affected.slice(0, 40) };
    };

    const g: Gap[] = [];
    // Rules that no policy enforces — a check with no stated intent behind it.
    g.push(gap('unpoliced-rules', 'Rules no policy enforces', 'warn',
      'Every executable rule should trace up to a written policy — the human intent it enforces. These fire in CI with no policy explaining why.',
      rules, (r) => !this.hasInc(r.id, 'enforces')));
    // Rules that map to no consumer experience.
    g.push(gap('experienceless-rules', 'Rules tied to no consumer experience', 'info',
      'The experience: axis answers "what does turning this on buy the consumer." Rules with no experience tag are hard to prioritise or explain.',
      rules, (r) => !this.hasOut(r.id, 'improves')));
    // Policies with no why.
    g.push(gap('why-less-policies', 'Policies with no stated why', 'warn',
      'A policy should point at a guidance essay — the narrative a developer reads when a rule trips. These have no guidance behind them.',
      policies, (p) => !this.hasOut(p.id, 'why')));
    // Policies enforcing rules absent from the executable catalog.
    g.push(gap('non-catalog-enforcement', 'Policies enforcing non-catalog rules', 'warn',
      'These policies name rules that are not in the executable rule catalog — the intent exists but nothing actually checks it.',
      policies, (p) => this.outgoing(p.id).some((e) => e.rel === 'enforces' && !(this.byId.get(e.to)?.meta?.given))));
    // Policies with no consumer experience.
    g.push(gap('experienceless-policies', 'Policies with no consumer experience', 'info',
      'A policy with no linked experience is hard to slot into a consumer-facing rollout.',
      policies, (p) => !this.hasOut(p.id, 'improves')));
    // Guidance essays nothing points at.
    g.push(gap('orphan-guidance', 'Guidance no policy references', 'info',
      'Guidance essays with no policy pointing at them are writing nobody in the enforcement path will ever reach.',
      guidance, (n) => !this.hasInc(n.id, 'why')));

    return g.sort((a, b) => (a.severity === b.severity ? b.affected - a.affected : a.severity === 'warn' ? -1 : 1));
  }

  // Roll the whole stack up by the experience axis (the one the book returns to).
  experienceRollup(): { node: GNode; rules: number; policies: number; quality: boolean }[] {
    return this.nodes('experience')
      .map((e) => ({
        node: e,
        rules: this.countInc(e.id, 'improves', 'rule'),
        policies: this.countInc(e.id, 'improves', 'policy'),
        quality: e.meta?.axis === 'quality' || e.meta?.axis === 'both',
      }))
      .sort((a, b) => b.rules + b.policies - (a.rules + a.policies));
  }
}

export const KIND_LABEL: Record<Kind, string> = {
  guidance: 'Guidance', policy: 'Policy', rule: 'Rule', provenance: 'Provenance',
  experience: 'Experience', lifecycle: 'Lifecycle', property: 'Property', strategy: 'Strategy',
};

export const REL_LABEL: Record<string, { out: string; in: string }> = {
  enforces: { out: 'Enforces', in: 'Enforced by' },
  why: { out: 'Explained by', in: 'Explains' },
  improves: { out: 'Improves', in: 'Improved by' },
  stage: { out: 'Applies at', in: 'Applies to' },
  origin: { out: 'Comes from', in: 'Origin of' },
  uses: { out: 'Uses', in: 'Used by' },
  frames: { out: 'Frames', in: 'Framed by' },
};
