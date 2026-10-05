# Dev Cockpit — Phase 0 Baseline

> Reference snapshot of Gitdeck **before any Dev Cockpit change**. No Gitdeck code was modified to produce it.
> (Document written in English per `AGENTS.md`.)

## 1. Identity

| Item | Value |
| --- | --- |
| Date | 2026-10-05 |
| Fork | `SOMET1010/gitdeck` (origin) |
| Upstream | `debba/gitdeck` (remote `upstream` added) |
| Starting commit | `6e88ddcb71ba8d7d87376e057aecf1c7de81c044` — "Merge pull request #40 from nyg/fix/footer-bottom" |
| Fork vs upstream | `origin/main` == `upstream/main` (identical at baseline) |
| Gitdeck version | `1.0.8` (`package.json`) |
| Working branch | `feature/dev-cockpit` (created from `main`) |
| Runtime | Node `v22.22.0`, npm `10.9.4` |

## 2. Commands executed

```bash
git remote add upstream https://github.com/debba/gitdeck
git fetch upstream main
git checkout -b feature/dev-cockpit
npm ci                 # package-lock.json (README + Dockerfile use npm)
npm test               # vitest run
npm run typecheck      # tsc --noEmit
npm run build          # esbuild (server) + vite build (client)
npm start              # node dist/server.js, with an empty HOME (no stored token)
curl http://127.0.0.1:8765/...   # smoke test of / and some /api/* endpoints
# headless Chromium (Playwright) screenshot of http://127.0.0.1:8765/
```

Note: the repo ships **two lockfiles** (`package-lock.json` and `pnpm-lock.yaml`). npm was used because README and Dockerfile (`npm ci`) both rely on it.

## 3. Results

| Check | Result | Details |
| --- | --- | --- |
| `npm ci` | ✅ OK | exit 0 |
| `npm test` | ✅ 24 files / **123 tests passed**, 0 failed | ~9 s |
| `npm run typecheck` | ❌ **exit 2 — 7 errors** (pre-existing upstream) | see below |
| `npm run build` | ✅ OK | warning: client chunk 703 kB (> 500 kB) |
| Local start (`npm start`) | ✅ OK | server on `http://127.0.0.1:8765`, auth mode `device` |

### Typecheck errors (pre-existing, not fixed)

```
src/components/views/IssueList.tsx(34,48)        TS2345 string | undefined -> string
src/components/views/PullRequestList.tsx(43,48)  TS2345 string | undefined -> string
src/components/views/TriageWorkspace.tsx(84,38)  TS2345 string | undefined -> string
src/server/openaiDigest.ts(27,71)                TS2551 'securityReposCount' does not exist on 'DailyRepoDigest' (did you mean 'securityAlertsCount'?)
tests/utils/colors.test.ts(32,20)                TS7053 '--label-h' not in CSSProperties
tests/utils/colors.test.ts(33,20)                TS7053 '--label-s' not in CSSProperties
tests/utils/colors.test.ts(34,20)                TS7053 '--label-l' not in CSSProperties
```

The build stays green because esbuild and Vite strip types without checking them. `openaiDigest.ts` error is likely a **real bug** (field read is always `undefined` in the OpenAI digest prompt).

### Local start (without any token)

| Request | Status | Response |
| --- | --- | --- |
| `GET /` | 200 | SPA `index.html` |
| `GET /api/auth/status` | 200 | `authenticated:false, clientIdConfigured:false` |
| `GET /api/accounts` | 200 | `accounts: []` |
| `GET /api/diagnostics/provider-metrics` | 200 | empty metrics |
| `GET /api/repos` | 401 | `authentication required` |

UI: the "Connect an account" screen renders (GitHub device code / Codeberg PAT / GitLab PAT), **no browser console error**.

**Not verified (requires credentials):** every data view (repos, issues, PRs, CI, insights, alerts, digest). Needs one of: `GITHUB_CLIENT_ID` (OAuth App with Device Flow), `GH_AUTH_MODE=gh-cli`, or `GH_AUTH_MODE=token` + `GITHUB_TOKEN`. AI digest needs `OPENAI_API_KEY` (optional).

## 4. Architecture

Single repo, single Node process in production (API + built SPA).

```
src/
├── server.ts                 # entrypoint (HTTP server)
├── server/
│   ├── app.ts, router.ts     # request handler, find-my-way router
│   ├── routes/*.ts           # /api/* endpoints per domain (accounts, auth, dashboard, repository, projects, mentions, notifications)
│   ├── providers/            # provider abstraction: github, gitlab(+Data), forgejo(+Data), registry, types
│   ├── graphql/*.ts          # GitHub GraphQL documents
│   ├── githubClient.ts, upstream.ts, http.ts
│   ├── oauth.ts, gitlabOAuth.ts, authProvider.ts, tokenStore.ts, accountStore.ts   # auth, tokens in ~/.gitdeck/
│   ├── ciHealth.ts           # Actions runs aggregation per repo
│   ├── securityAlerts.ts     # Dependabot + code scanning
│   ├── repoInsights.ts, digests.ts, openaiDigest.ts, snapshots.ts, notifications.ts
│   └── dashboardData.ts, providerDiagnostics.ts, spa.ts, config.ts
├── api/                      # browser client for /api/* (+ cache)
├── components/               # React views, modals, common
├── contexts/, hooks/, i18n/ (en, fr, de, es, it, zh), styles/
├── types/github.ts           # shared types
└── utils/*.ts                # pure logic (unit tested)
tests/                        # mirrors src: utils/, server/, hooks/
```

Layers: **provider (GitHub/GitLab/Forgejo) → server domain modules → `/api/*` routes → `src/api` client → hooks/contexts → React views**. Tokens never leave the server. Persistence = local files under `~/.gitdeck/` (tokens, accounts, snapshots, caches). No database.

Main API endpoints: `/api/repos`, `/api/issues`, `/api/prs`, `/api/ci-health`, `/api/repo-insights`, `/api/repo-details`, `/api/repo-branches`, `/api/repo-discussions`, `/api/daily-digests`, `/api/notifications*`, `/api/projects`, `/api/project*`, `/api/forks`, `/api/stargazers`, `/api/mentions/*`, `/api/accounts*`, `/api/auth/*`, `/api/diagnostics/provider-metrics`.

Front routes: `/inbox`, `/repositories`, `/issues`, `/pull-requests`, `/board`, `/insights`, `/alerts`, `/ci`, `/daily`; repository modal tabs: overview, actions, commits, pull-requests, issues, milestones, releases, branches, forks, traffic, mentions, discussions, dependents.

### Documentation discrepancies spotted

- README mentions `tsconfig.server.json` — the file does not exist.
- README says `npm run build` "type-checks the server" — it does not (esbuild only); typecheck is red while build is green.
- `.agents/rules.md` duplicates `AGENTS.md` with slightly different wording.

## 5. CI workflows

Only one: `.github/workflows/dockerbuild.yml` — on push to `main` and version tags, builds and pushes a multi-arch Docker image to GHCR.

**There is no CI running `npm test`, `npm run typecheck` or `npm run build` on pushes or PRs.** This explains why the typecheck errors went unnoticed upstream.

## 6. Features already available

- Multi-account / multi-provider: GitHub (Device Flow, `gh` CLI, PAT), GitLab (PAT/OAuth, partial), Forgejo/Codeberg (PAT).
- **Repositories** grid with filters and per-repo health score.
- Cross-repo **Issues** and **Pull Requests** lists (draft, review decision, awaiting review, approved).
- **Board** (Kanban, GitHub Projects).
- **Insights**: per-repo health score 0–100 + label Strong / Watch / Risky, alerts, opportunities (`src/utils/insights.ts`).
- **Alerts**: Dependabot + code scanning.
- **CI Health**: last 30 Actions runs per repo, success rate, avg duration, last failure/success (`src/server/ciHealth.ts`).
- **Daily digest** (+ optional OpenAI narrative).
- **Inbox** (notifications / GitLab todos), triage workspace, command palette.
- Repo detail: overview, actions, commits, PRs, issues, milestones, releases, branches, forks, traffic, mentions, discussions, dependents, languages, contributors.
- i18n (incl. French), local snapshots, load diagnostics.

## 7. Gap analysis vs Dev Cockpit goal (first pass)

Legend: ✅ covered · 🟡 partial · ❌ missing.

| Goal item | Status | What exists | What is missing |
| --- | --- | --- | --- |
| Connect any of my GitHub repos | ✅ | Multi-account, all repos of the account listed | — (only a "pinned / cockpit repos" selection, if wanted) |
| Done / partially done / to do | 🟡 | Issues, milestones, Kanban columns (Backlog → In review) | Per-repo progress synthesis; source of truth for "done" **À DÉFINIR** (issues? milestones? Projects? a roadmap file in the repo?) |
| Missing features | ❌ | — | Needs a reference (spec / roadmap / handover doc) to compare against — **À DÉFINIR** |
| Tests: existing / missing / failing | 🟡 | CI runs conclusions (pass/fail) | Test inventory, counts, failing test names (needs workflow logs, artifacts/JUnit or repo file scan); "missing tests" heuristic **À DÉFINIR** |
| Known bugs & blockers | 🟡 | Issues lists with labels, stale issue alerts | Per-repo aggregation by label (`bug`, `blocked`…) — label conventions **À DÉFINIR** |
| Open PRs | ✅ | Cross-repo PR list, review status | Per-repo PR checks status (`statusCheckRollup` not queried), mergeability |
| CI health | ✅ | `/ci` view, success rate, last failure | CI state on default branch head specifically; repos without CI flagged |
| Technical debt | ❌ | Only indirect signals (stale issues, alerts) | Signals definition **À DÉFINIR** (TODO/FIXME scan, outdated deps, typecheck/lint errors, size…) |
| Risks | 🟡 | Security alerts, "Risky" health label, no-push alerts | Consolidated per-repo risk list |
| Recommended next actions | 🟡 | Insights "opportunities" + alerts (generic rules) | Prioritised, actionable list per repo |
| Stable product or not | 🟡 | Health score (activity/maintenance oriented) | A "stability" verdict based on CI on default branch, failing tests, open bugs, releases — rule **À DÉFINIR** |

Preliminary conclusion: the current architecture (provider → server module → `/api/*` → React view, pure logic in `src/utils`) **does not block** the goal. Most Dev Cockpit items can be added as new server aggregation modules + one view, reusing existing data (CI health, PRs, issues, insights, alerts).

## 8. À DÉFINIR

- **Truncated brief**: Patrick's brief was cut after "fonctionnalités Gitdeck déjà disponibles ; ar…" (probably "architecture…"). The remaining expected content of this baseline document and **the following phases are to be confirmed by Patrick**. No later phase has been assumed here.
- Which GitHub auth mode to use for testing with real data (PAT, `gh` CLI or OAuth App) and which repos to use as reference.
- Whether the pre-existing typecheck errors and the missing test CI must be fixed in the fork (and possibly proposed upstream).
- Sources of truth for "done / to do / missing features" and the rules for "tech debt" and "stable".
- Preview deployment target (Gitdeck needs a Node server + token, not a static site).
