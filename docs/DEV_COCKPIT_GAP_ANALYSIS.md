# Dev Cockpit — Gap Analysis (Phase 1)

> Date: 2026-10-05 · Branch: `feature/dev-cockpit` · Reference repo: `SOMET1010/gitdeck`
> Prerequisite: [DEV_COCKPIT_BASELINE.md](DEV_COCKPIT_BASELINE.md). No Dev Cockpit code exists yet.

## 1. Current state after Lot 0

| Check | Result | Evidence |
| --- | --- | --- |
| `npm test` | ✅ 24 files, 123 tests passed | local run + CI |
| `npm run typecheck` | ✅ 0 errors (was 7) | local run + CI |
| `npm run build` | ✅ | local run + CI |
| CI `Quality` (`.github/workflows/quality.yml`) | ✅ run `37375681698` on `70c6de5`, steps Test / Typecheck / Build all `success` | GitHub Actions jobs API |

## 2. Real-data check (SOMET1010/gitdeck)

Auth: `GH_AUTH_MODE=gh-cli` (reuses the `gh` session; no token written anywhere). In this cloud container the GitHub access is **restricted to repository-scoped REST endpoints** (`/repos/{owner}/{repo}/...`); GraphQL and user-level endpoints (`/user/orgs`, `/notifications`) are refused by the container proxy. This is an environment limit, not a Gitdeck bug.

| Gitdeck surface | Result here | Why |
| --- | --- | --- |
| Auth status / account | ✅ `SOMET1010 (gh-cli)` authenticated | — |
| `/api/repo-details?repo=SOMET1010/gitdeck` (overview, actions, commits, releases, milestones) | ✅ real data (meta, languages, contributors, workflow runs incl. our `Quality` run) | REST, repo-scoped |
| Security summary | ✅ answered, `unavailable: true` | Dependabot disabled on the fork (403) |
| Community profile | ❌ 404 | GitHub does not serve it for this fork |
| `/api/repos`, `/api/issues`, `/api/prs`, `/api/ci-health`, `/api/repo-insights` | ❌ blocked | all start with `/user/orgs` |
| `/api/repo-branches`, `/api/forks`, `/api/projects` | ❌ blocked | GraphQL |
| `/api/notifications` | ❌ blocked | user-level endpoint |
| UI | ✅ shell renders, logged in as SOMET1010; data views stay "Loading" with the `/user/orgs` error banner | same cause |

**To verify on Patrick's machine** (full access): repos grid, issues, PRs, CI view, insights, board, branches — **not verified yet**.

Side observations (not fixed, out of scope):
- One failing call (`/user/orgs`) leaves every view in "Loading" — resilience gap of the global data load.
- Welcome modal still says `gh-dashboard`; header logo image looks broken in the screenshot.

Reference repo facts (via REST): fork of `debba/gitdeck`, default branch `main`, **issues disabled**, 0 open PRs, 0 milestones, 0 releases, 0 tags, 10 labels, Dependabot disabled, 0 check runs on `main` (Quality only ran on `feature/dev-cockpit` so far). Repo tarball (`/repos/{r}/tarball/{ref}`) is reachable.

➡ For `SOMET1010/gitdeck`, Level B (GitHub state) is almost empty today: **features / remaining work will be UNKNOWN** until issues (or a roadmap) exist. Level A (CI) and Level C (repo content) are usable.

## 3. Evidence hierarchy (applied below)

- **A — executed proof**: CI runs, job steps (test / typecheck / build), test reports.
- **B — GitHub state**: PRs, reviews, issues, milestones, Projects, releases, security alerts.
- **C — repository content**: README, docs, TODO/FIXME/HACK/XXX, tests present, migrations, routes, changelog.
- **D — inference**: anything deduced; always labelled with a confidence, never presented as fact.

## 4. Gap table

Status: ✅ present · 🟡 partial · ❌ absent. Effort: S (≤ ½ day), M (1–2 days), L (> 2 days). Risk = risk of wrong conclusion or technical risk.

| # | Need | Status | Existing Gitdeck source | To add | Lvl | Effort | Risk |
|---|---|---|---|---|---|---|---|
| 1 | Repositories | ✅ | `getReposCached` (`dashboardData.ts`), `/api/repos`, `/api/repo-details` meta | Cockpit only needs one repo: reuse `/repos/{r}` meta | B | S | Low |
| 2 | Branches | 🟡 | `/api/repo-branches` (GraphQL) | Default branch + its head SHA via REST (`meta.default_branch`, `/commits/{branch}`) | B | S | Low |
| 3 | Commits | 🟡 | repo-details `section=commits` (last 20) | Head commit of default branch to anchor all evidence | B | S | Low |
| 4 | Issues | 🟡 | `/api/issues` (cross-repo GraphQL search) | Repo-scoped REST `/repos/{r}/issues` (exclude PRs), labels kept | B | S | Low |
| 5 | Milestones | 🟡 | repo-details `section=milestones` (open only) | Open + closed with progress (`open_issues`/`closed_issues`) | B | S | Low |
| 6 | GitHub Projects | 🟡 | `/api/projects`, `projectQueries.ts` (GraphQL), Kanban | Map Project status column → item status (convention À DÉFINIR) | B | M | Medium (custom columns) |
| 7 | Pull requests | 🟡 | `/api/prs` (`isDraft`, `reviewDecision`, `reviewsCount`) | Repo-scoped open PRs + head check status | B | S | Low |
| 8 | Reviews | 🟡 | `reviewDecision` per PR | Nothing more for MVP | B | — | Low |
| 9 | CI / Actions | 🟡 | `ciHealth.ts` (30 runs, success rate), repo-details `actions` | Status of **default-branch head** + job **steps** (`/actions/runs/{id}/jobs`) | A | S | Low |
| 10 | Releases | ✅ | repo-details `releases`, insights | Latest release vs head (commits since release) | B | S | Low |
| 11 | Tags | ❌ | — | `/repos/{r}/tags` (only if needed by readiness) | B | S | Low |
| 12 | Dependencies | ❌ | Dependents (reverse) only | Read `package.json`/lockfile from repo content; "critical" only via Dependabot severity | C | M | Medium |
| 13 | Security alerts | ✅ | `securityAlerts.ts` (Dependabot + code scanning, `unavailable` flag) | Expose severity counts (critical/high) for readiness | B | S | Low (must treat `unavailable` as UNKNOWN) |
| 14 | Tests (pass/fail) | 🟡 | Only CI run conclusion | Step conclusion "Test"; counts need a report (see 15) | A | S | Medium (step naming) |
| 15 | Test suites / counts | ❌ | — | CI publishes a JSON report artifact (e.g. Vitest `--reporter=json`) read via artifacts API | A | M | Medium (per-repo convention) |
| 16 | Skipped tests | ❌ | — | From JSON report (`pending`/`skipped`) ; else static scan `.skip(` = Level C | A/C | M | Medium |
| 17 | Todo tests | ❌ | — | From JSON report (`todo`) ; else static scan `.todo(` | A/C | M | Medium |
| 18 | Coverage | ❌ | — (no coverage tool installed) | Only if repo produces a coverage summary artifact; else UNKNOWN | A | M | Medium |
| 19 | Typecheck | ❌ | — | CI step conclusion matching convention (e.g. step "Typecheck") | A | S | Medium (step naming) |
| 20 | Build | ❌ | — | CI step conclusion (e.g. step "Build") | A | S | Medium |
| 21 | TODO | ❌ | — | Content scan of default-branch tarball, file:line evidence | C | M | Low |
| 22 | FIXME | ❌ | — | idem | C | (with 21) | Low |
| 23 | HACK | ❌ | — | idem | C | (with 21) | Low |
| 24 | XXX | ❌ | — | idem (word-boundary match, skip lockfiles/vendor) | C | (with 21) | Medium (false positives) |
| 25 | Documentation | 🟡 | README rendered (`Markdown.tsx`), community profile | Presence check of README / docs folder only | C | S | Low |
| 26 | Changelog | 🟡 | `utils/changelog.ts` (Gitdeck's own changelog modal) | Presence of `CHANGELOG.md` + whether it mentions latest release | C | S | Low |
| 27 | Migrations | ❌ | — | Detect known migration folders only; "problematic" requires proof (out of MVP) | C | M | High (no reliable proof) |
| 28 | Routes | ❌ | — | Not used to infer features (rule). Optional inventory later | C | L | High (false features) |
| 29 | Endpoints | ❌ | — | idem | C | L | High |
| 30 | Application features | ❌ | — | FEATURE items from issues (label convention), milestones, Project items, later a repo config/roadmap file | B/C | M | High if inferred — forbidden without source |
| 31 | Bugs | 🟡 | Issues with labels (UI only) | Classify issues by label (`bug`…) — convention À DÉFINIR | B | S | Medium |
| 32 | Blockers | ❌ | — | Label `blocked` / Project column "Blocked" / failing required check | B | S | Medium |
| 33 | Technical debt | ❌ | Indirect only (stale issues) | Objective signals only (§6), each with evidence | A/B/C | M | Low if evidence-only |
| 34 | Risks | 🟡 | `insights.ts` alerts, health label Strong/Watch/Risky | RISK items derived from evidence (red CI, critical vuln, P0 open) — marked D when inferred | D | S | Medium |
| 35 | Decisions | ❌ | — | DECISION items from a docs convention (e.g. `docs/adr/*` or label `decision`) — À DÉFINIR | C | S | Low |
| 36 | Roadmap | ❌ | — | Milestones and/or a roadmap file convention — À DÉFINIR | B/C | M | Medium |
| 37 | Release readiness | ❌ | — | `evaluateReleaseReadiness()` (§7) | A/B | M | Low (pure, testable) |
| 38 | Recommendations | 🟡 | `insights.ts` opportunities (generic, Level D) | Max 5 next actions, each derived from a blocker/warning with its evidence | D | S | Medium |

Note: the existing health score (`insights.ts`, 0–100) is **not reused** for the cockpit verdict (no arbitrary score rule).

## 5. Top 10 gaps (by impact on the cockpit)

1. **No default-branch anchored CI evidence** — nothing says "CI on `main` head is green/red" (ci-health aggregates 30 runs).
2. **No typecheck / build / test step-level status** — only the run conclusion is used today (jobs/steps API unused).
3. **No release readiness evaluation** — no READY / NOT_READY / UNKNOWN with blockers and evidence.
4. **No test counts / skipped / todo / coverage** — requires a test report convention (artifact).
5. **No source for features** — and on the reference repo issues are disabled: features = UNKNOWN until a source is chosen.
6. **No priority convention** (P0/P1/P2 from labels) — needed for "Reste à faire" and NOT_READY on open P0.
7. **No repository content scan** (TODO/FIXME/HACK/XXX, `.skip`/`.todo`, presence of README/CHANGELOG/tests).
8. **No bug/blocker classification** — labels exist but are not interpreted.
9. **No unified evidence model** — each view has its own ad-hoc data; no `source` / `confidence` / `lastObservedAt`.
10. **Global data load is fragile** — a single upstream failure blocks all views (observed with `/user/orgs`); the cockpit must degrade per block to UNKNOWN instead.

## 6. Proposed minimal model

```ts
type CockpitItemType = "FEATURE" | "TASK" | "TEST" | "BUG" | "RISK" | "TECH_DEBT" | "DECISION";
type CockpitStatus = "DONE" | "PARTIAL" | "TODO" | "BLOCKED" | "UNKNOWN";
type EvidenceLevel = "A" | "B" | "C" | "D";          // executed / github / content / inference
type Confidence = "high" | "medium" | "low";
type Priority = "P0" | "P1" | "P2" | null;

interface Evidence {
  level: EvidenceLevel;
  kind: string;            // e.g. "ci-step", "issue", "milestone", "content-marker", "security-alert"
  summary: string;         // "npm run typecheck: 7 errors" / "step Typecheck: failure"
  url?: string;            // GitHub link (run, issue, file line…)
  observedAt: string;      // ISO date
}

interface CockpitItem {
  id: string;              // stable: `${repository}:${kind}:${sourceId}`
  repository: string;      // owner/name
  title: string;
  description?: string;
  type: CockpitItemType;
  status: CockpitStatus;
  priority: { source: Priority; suggested: Priority };   // never merged
  source: string;          // "issue#12", "milestone:v1", "ci:Quality", "content:src/x.ts:42"
  evidence: Evidence[];
  githubUrl?: string;
  commit?: string;
  branch?: string;
  pullRequest?: number;
  tests?: string[];
  lastObservedAt: string;
  confidence: Confidence;  // low/medium/high; inference (level D) is never "high"
}
```

No database: computed on demand from GitHub REST + repo tarball, cached with the existing in-memory/disk cache pattern.

## 7. Technical debt (MVP: objective signals only, each with evidence)

| Signal | Evidence | Level |
| --- | --- | --- |
| TODO / FIXME / HACK / XXX markers | `file:line` + link on default-branch head | C |
| `.skip(` / `.todo(` in tests (static) or skipped/todo in report | file:line or report | C / A |
| Typecheck red | CI step conclusion + run URL | A |
| Build red | CI step conclusion + run URL | A |
| CI red on default branch | run URL | A |
| Known vulnerabilities | Dependabot / code scanning alert URLs + severity | B |
| Critical dependencies | only Dependabot `critical` severity | B |
| Problematic migrations | **out of MVP** (no reliable proof) | — |
| Duplication | **out of MVP** (no existing tool measures it) | — |

No score, no aggregation into a number: a list of items, each with evidence.

## 8. Release readiness

```ts
evaluateReleaseReadiness(input: ReadinessInput, criteria: ReadinessCriteria): {
  verdict: "READY" | "NOT_READY" | "UNKNOWN";
  blockers: Finding[];   // each with evidence
  warnings: Finding[];
  evidence: Evidence[];
}
```

Rules (pure function):
- Any **blocker** with evidence → `NOT_READY` (build red, typecheck red, blocking tests red, main CI red, critical vulnerability, open P0 issue, unmet mandatory criterion).
- No blocker, but any **mandatory criterion without data** (e.g. no CI on head, security `unavailable`) → `UNKNOWN`, listing what is missing.
- `READY` only if every configured mandatory criterion is satisfied with evidence.
- UNKNOWN is never promoted to READY.

Default criteria (MVP, overridable later per repo): CI on default-branch head green; steps test/typecheck/build green when they exist; no open critical security alert (UNKNOWN if alerts unavailable); no open issue labelled P0.

## 9. MVP architecture (proposal, not implemented)

Principle: reuse Gitdeck's layering (server module → `/api/*` route → `src/api` client → view), REST only, pure decision logic isolated in `src/utils/devCockpit/`.

**New files**

| File | Role |
| --- | --- |
| `src/types/devCockpit.ts` | Model types (§6, §8) |
| `src/utils/devCockpit/ciEvidence.ts` | Pure: runs + jobs/steps → CI / test / typecheck / build status + evidence |
| `src/utils/devCockpit/classifyIssues.ts` | Pure: issues/milestones/labels → FEATURE/BUG/TASK items, source priority |
| `src/utils/devCockpit/releaseReadiness.ts` | Pure: `evaluateReleaseReadiness()` |
| `src/utils/devCockpit/nextActions.ts` | Pure: blockers/warnings → max 5 actions with provenance, suggested priority |
| `src/utils/devCockpit/contentScan.ts` | Pure: file contents → TODO/FIXME/HACK/XXX, `.skip`/`.todo` markers (later slice) |
| `src/server/devCockpit.ts` | Collector: REST calls (meta, head commit, runs on head, jobs, issues, PRs, milestones, latest release, security summary) + cache |
| `src/server/routes/devCockpit.ts` | `GET /api/dev-cockpit?repo=owner/name` |
| `src/components/views/DevCockpitView.tsx` + `src/components/devCockpit/*` | 5 blocks (later slice) |
| `tests/utils/devCockpit/*.test.ts`, `tests/server/devCockpit.test.ts` | Mirrored tests |

**Existing files reused / touched minimally**

- `src/server/githubClient.ts` (`ghApiJson`, `restApi`, `restApiPaginate`), `src/server/upstream.ts`, `src/server/securityAlerts.ts` (`fetchRepoSecuritySummary`), `src/server/routes/shared.ts` (`requireRepo`), `src/server/routes/index.ts` (+1 registration).
- `src/api/github.ts` (+1 fetch function), `src/App.tsx` (+1 tab/route `/cockpit`), `src/utils/dataRequirements.ts` (+1 tab), `src/i18n/*.ts` (new keys).
- Not reused for verdicts: `insights.ts` health score.

**Endpoint**: `GET /api/dev-cockpit?repo=owner/name` → `{ ok, repository, headCommit, readiness, quality, features, remaining, nextActions, errors }`; each block can be `UNKNOWN` independently.

**New dependencies**: none for slices 1–2. Content scan (tarball) may need a tar reader: either a small internal ustar parser or the `tar` package — decision deferred.

## 10. First slice recommended (one PR)

"Readiness from executed proof":
1. `src/types/devCockpit.ts` (model).
2. `src/utils/devCockpit/ciEvidence.ts` + `releaseReadiness.ts` (pure) with unit tests (READY / NOT_READY / UNKNOWN cases, UNKNOWN never READY).
3. `src/server/devCockpit.ts` + route `GET /api/dev-cockpit?repo=` returning **block 1 (readiness)** and **block 3 (CI / test / typecheck / build step status)** for the default-branch head, REST only.
4. Verified with `curl` on `SOMET1010/gitdeck` (works even inside this restricted container).
No UI in this slice.

## 11. À DÉFINIR (questions for Patrick)

- Priority convention: labels `P0`/`P1`/`P2`? `priority:high`? Something else?
- Feature source for `SOMET1010/gitdeck`: enable issues on the fork? milestones? a roadmap file (format)?
- Labels for bug / blocked / decision.
- Step-name convention for test / typecheck / build (default proposed: step names containing `test`, `typecheck`, `build`, case-insensitive) — or an explicit per-repo config file.
- Test report convention (Vitest JSON artifact) to get counts / skipped / todo — acceptable to add to `quality.yml`?
- UI: new tab `/cockpit` in the existing tab bar (layout change) — approval needed before slice 2.
