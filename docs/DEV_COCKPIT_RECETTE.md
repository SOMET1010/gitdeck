# Dev Cockpit — Acceptance guide

Everything below runs locally. Nothing in the cockpit writes to GitHub: it only reads.

## 1. Start

```bash
git clone https://github.com/SOMET1010/gitdeck && cd gitdeck
git checkout feature/dev-cockpit
npm ci
npm run build
GH_AUTH_MODE=gh-cli npm start      # reuses your `gh auth login` session
# open http://127.0.0.1:8765  -> lands on /attention
```

Requirements: Node 22, `gh` logged in (`gh auth status`) with `repo` and `read:org` scopes.
Optional: `GITDECK_ATTENTION_DEEP_LIMIT` (default 25) caps how many repositories get a full evaluation per refresh.

Local data (overrides, history, watch list) is stored in `~/.gitdeck/attention.json`. Delete the file to start over.

## 2. What each screen does

| Screen | Route | Purpose |
| --- | --- | --- |
| Attention (home) | `/attention` | "Where should I focus now?" — every repository of the account, grouped by computed bucket, with reasons and evidence, overrides, history, copilot |
| Cockpit | `/cockpit?repository=owner/name[&branch=]` | One repository: release readiness, next actions, tests & quality, remaining work, known features |
| Existing Gitdeck tabs | `/repositories`, `/issues`, `/pull-requests`, `/ci`, … | Unchanged |

## 3. How the attention bucket is computed

Ordered rules, first match wins. No score. Thresholds: deadline 7 days, inactive 30 days, archive suggestion 180 days, almost done 80 %.

| Bucket | Rule (evidence shown on the card) |
| --- | --- |
| Now | CI red on the default branch head · open issue labelled `P0` · open PR labelled `P0` · PR labelled `P1` that cannot merge (conflict / failing checks) |
| Urgent | open PR or issue labelled `P1` · milestone due within 7 days (or overdue) with open items · draft release not published |
| Blocked | issue labelled `blocked` · non-draft PR with conflict / failing checks or labelled `blocked` |
| Almost done | open milestone ≥ 80 % closed · readiness READY with ≤ 3 open issues |
| Inactive | no push for ≥ 30 days |
| Pause / archive suggested | no push for ≥ 180 days · or nearly empty (< 50 KB) and inactive. Suggestion only. |
| Can wait | evaluated, none of the above; the card says what was checked |
| Unknown | not enough data (not evaluated in depth, or GitHub data unreadable). Never shown as "Can wait". |

Two passes keep GitHub calls bounded: every repository gets light signals (last push, archived); repositories pushed in the last 30 days, watched repositories and overridden repositories get a deep evaluation (CI on head, readiness, issues, PRs with mergeability, milestones, releases), up to the deep limit. Archived repositories are skipped.

Probable duplicates are detected from names (case, `-`/`_`, version / hash / number suffixes and words such as prod, stable, vf, copy are ignored). This is an inference, marked as such.

## 4. Acceptance checklist

Attention screen
- [ ] `/` opens `/attention`; the 6 "Today" counters are shown.
- [ ] Coverage line: number of listed repositories, number evaluated in depth, source `account`.
- [ ] Each repository card shows its reasons with evidence links (run, PR, issue, milestone…).
- [ ] A repository with red CI on `main` is in **Now**; one with an open `P0` issue/PR is in **Now**.
- [ ] A repository with no push for > 30 days is **Inactive**, > 180 days **Pause / archive suggested**.
- [ ] "Recompute" refreshes from GitHub (otherwise results are cached 5 minutes).
- [ ] Force: pick a bucket, enter a reason (required), days → the card moves to that group and still shows the computed bucket and the expiry.
- [ ] Remove override → the card returns to its computed group.
- [ ] History (per card and global): override set / removed, computed bucket changes with the reason.
- [ ] Watch a repository (e.g. one not pushed recently) → it is evaluated in depth on the next recompute. Unwatch works.
- [ ] Copilot: "What needs me now?", "What should I finish this week?", "Clean up" answer from the same evidence; clean-up only proposes (nothing is archived or deleted).
- [ ] "Open cockpit" opens the repository cockpit.

Cockpit screen
- [ ] Readiness READY / NOT_READY / UNKNOWN with blockers, missing proof and warnings, each with evidence.
- [ ] Tests & quality: CI, tests, typecheck, build per CI step on the head commit; Vitest counts when a `vitest-report` artifact exists.
- [ ] Remaining work: open issues grouped by `P0`/`P1`/`P2` labels; Gitdeck suggestions listed separately.
- [ ] Next actions: at most 5, each with its provenance.
- [ ] Known features: UNKNOWN until a feature source is defined.

## 5. Label conventions read by the cockpit

`P0`, `P1`, `P2` (priority), `bug`, `blocked`, `decision` — exact names, case-insensitive, on issues and pull requests.

## 6. Known limits

- Server messages (reasons, evidence summaries) are in English; UI labels are translated (en, fr, it).
- Duplicate detection is name-based only (e.g. `Generateur_modules_odoo` vs `ODOO_genrator` is not matched).
- "Decision" counts only issues labelled `decision` (not PRs).
- Only GitHub Actions runs are read for CI (not third-party checks).
- A copilot based on a language model is not included: answers are deterministic and built from the evidence only.
