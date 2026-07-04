# API Governance Graph

A browser-first tool that binds the **API governance building blocks** — rules,
policies, provenance, guidance, experiences, and lifecycle — into **one navigable
graph**, so you can walk the *Guidance Stack* from any node and see exactly where it
is broken. No backend, no accounts; runs entirely in your browser. Live at
**[graph.apicommons.org](https://graph.apicommons.org)**.

Governance is not a list of rules — it is a **stack**. A machine *rule* enforces a
written *policy*, which is explained by a piece of *guidance*, protects a consumer
*experience*, carries a *provenance*, and applies at a point in the API *lifecycle*.
When those links exist, governance is legible. When they break — a rule with no
policy, a policy with no *why*, an essay nobody links — governance is just noise. This
tool makes the stack, and its breaks, visible.

Part of the [API Commons](https://apicommons.org/tools/) tools, alongside
[API Validator](https://github.com/api-commons/api-validator),
[Ruleset Commons](https://github.com/api-commons/ruleset-commons),
[Spectral Ruleset Studio](https://github.com/api-commons/spectral-ruleset-studio), and
[Governance Pipeline Auditor](https://github.com/api-commons/governance-pipeline-auditor).

## Three views

- **Stack** — every node in six columns (Guidance · Policy · Rule · Provenance ·
  Experience · Lifecycle). Click any node to light up everything directly bound to it,
  and open a detail rail you can keep walking from.
- **Gaps** — the loose ends, scored per layer: rules no policy enforces, rules tied to
  no consumer experience, policies with no stated *why*, policies enforcing rules that
  are not in the executable catalog, and guidance essays nothing points at. This is the
  view that turns "we have governance" into "here is where it is thin."
- **By experience** — the whole stack rolled up by the `experience:` axis — the one the
  governance book keeps returning to, because it answers *what does turning a rule on
  actually buy the consumer.*

## The data

The graph is assembled at build time from two sources and shipped as a single static
snapshot (`public/graph-bundle.json`) so the app has no runtime dependencies:

- The **API Commons rule catalog** — the full 769-rule, 12-format ruleset from
  [`api-validator`](https://github.com/api-commons/api-validator)
  (`rules/all-rules.yaml`): id, tags (`format:`/`experience:`/`spec:`/`topic:`/`owasp:`),
  `source` provenance, and `given`/`then`.
- The **[apievangelist.com](https://apievangelist.com) building blocks** — the
  `policies`, `guidance`, `experiences`, `lifecycle`, `properties`, and `strategies`
  collections, joined by their published cross-link arrays (`policy.rules[]`,
  `policy.guidance`, `policy.lifecycle[]`, `experience.properties[]`, …).

The join spine is explicit, not fuzzy: a policy names the rule slugs it enforces, points
at the guidance that explains it, and lists the experiences it improves; a rule carries
its own `experience:` tags and its `source` lineage.

## Develop

```bash
npm install
npm run data      # rebuild public/graph-bundle.json from the local sibling repos
npm run dev       # local dev server
npm run build     # production build → dist/
```

`npm run data` reads the sibling checkouts (`../api-validator` and
`../../api-evangelist/*`) and regenerates the committed
[`public/graph-bundle.json`](./public/graph-bundle.json). The bundle **is committed**, so
CI (`.github/workflows/pages.yml`) only runs `npm run build` — it needs no sibling repos
and makes no network calls. Regenerate the bundle whenever the rules or building blocks
change.

## Privacy

Everything runs client-side against the bundled snapshot. Nothing you do here leaves the
page — there is no server.

---

**Governance guidance** — the human *why* behind this graph: the
[Guidance](https://guidance.apievangelist.com/store/guidance/) and
[Rules](https://guidance.apievangelist.com/store/rules/) essays at
guidance.apievangelist.com.

A project of [API Evangelist](https://apievangelist.com), maintained openly under
[API Commons](https://apicommons.org). Free to fork; API Evangelist offers expert API
governance services — mapping exactly this stack for real organizations — when you want
help. Apache-2.0.
