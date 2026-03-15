# prai

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/Node-18%2B-green.svg)](https://nodejs.org)
[![GitHub](https://img.shields.io/badge/GitHub-supported-black.svg)](https://github.com)
[![Bitbucket](https://img.shields.io/badge/Bitbucket-supported-blue.svg)](https://bitbucket.org)
[![GitLab](https://img.shields.io/badge/GitLab-supported-orange.svg)](https://gitlab.com)

AI-powered PR reviewer that runs locally using your Claude Code subscription. Your code never leaves your machine.

```
$ prai 47

╭ prai — AI PR reviewer ╮
╰────────────────────────╯

 ✔ github — acme/backend
 ✔ PR #47: feat/login-fix — 4 files changed
 ✔ Review complete

╭ Complexity  ████████░░  8/10          ╮
│ files 4  lines 312  est. 60min        │
╰───────────────────────────────────────╯

  CRITICAL  src/auth/oauth.ts:89
  Token refresh has no retry — a single 503 kills the session
  fix: Wrap in exponential backoff (3 retries)

  ...

  VERDICT: Changes requested
```

## Quickstart

**Prerequisites:** [Claude Code CLI](https://claude.ai/download) installed and logged in, Node.js 18+, Git.

```bash
git clone https://github.com/shubham-jangid/prai.git
cd prai && npm install && npm run build && npm link
```

Then, in any repo with a git remote:

```bash
prai init      # one-time — set up forge credentials
prai 47        # review PR #47
```

That's it. prai auto-detects your forge (GitHub, Bitbucket, or GitLab) from the git remote.

## Why prai?

|                        | prai              | CodeRabbit       | GitHub Copilot   | Sourcery         |
| ---------------------- | ----------------- | ---------------- | ---------------- | ---------------- |
| Runs locally           | Yes               | No (cloud)       | No (cloud)       | No (cloud)       |
| Code leaves machine    | Never             | Always           | Always           | Always           |
| Extra cost             | $0                | $15/seat/mo      | $19/seat/mo      | $14/seat/mo      |
| Full codebase context  | Yes               | Diff only        | Diff only        | Diff only        |
| Custom team rules      | `.prai/rules.yaml`| Limited          | No               | Limited          |
| Feedback loop          | Yes               | No               | No               | No               |
| Multi-forge            | GH + BB + GL      | GitHub only      | GitHub only      | GitHub only      |

prai uses your existing Claude Code subscription. No extra API keys, no per-seat pricing, no third-party servers.

## Commands

| Command         | What it does                         |
| --------------- | ------------------------------------ |
| `prai`          | Review PR from current branch        |
| `prai 47`       | Review PR #47                        |
| `prai describe` | Generate a PR description from diff  |
| `prai list`     | List open PRs                        |
| `prai init`     | One-time credential setup            |
| `prai logout`   | Remove stored credentials            |

Run `prai` with no arguments to get an interactive experience — pick a PR from the list, choose review depth, and add instructions.

## Guide the review

Tell Claude what to focus on:

```bash
prai 47 --focus "security, error handling"
prai 47 --context "migrating auth from JWT to session-based"
prai 47 --prompt "check for N+1 queries and missing indexes"
```

- `--focus` narrows the review to specific areas
- `--context` explains what the change is about (so Claude understands intent)
- `--prompt` adds custom review instructions

Combine them freely: `prai 47 --focus security --context "JWT migration" --post`

## Deep review

By default, prai does a quick review (~1 min) using the diff plus light file reading. For thorough reviews:

```bash
prai 47 --deep
```

Deep mode tells Claude to read every changed file in full, check callers of modified functions, and verify test coverage. Takes 3-5 minutes but catches significantly more.

## Supervised feedback

After the review, you can push back on findings you disagree with:

```
? What next?
❯ Accept review
  Give feedback — Explain why an issue is incorrect or intentional
  Post to PR
```

Choose **Give feedback**, explain why the flagged issue is correct or intentional, and Claude re-evaluates. It drops justified issues and keeps valid ones. Go back and forth as many rounds as you need.

## Generate a PR description

```bash
prai describe 47
prai describe 47 --context "migrating auth from JWT to sessions"
```

Generates a structured description from the diff and commit history: summary, changes grouped by area, how to test, and risk assessment. Offers to show the raw markdown for pasting into the PR.

## Auto-post to PR

```bash
prai 47 --post
```

Posts the review as a comment on the PR when done.

## Team rules

Drop a `.prai/rules.yaml` in your repo root to customize reviews for your team:

```yaml
# .prai/rules.yaml
high_risk_modules:
  - src/auth/
  - src/payments/
  - db/migrations/

suppress:
  - test-naming-conventions
  - import-ordering

architecture_rules:
  - "All API endpoints must validate input with zod schemas"
  - "Database queries must go through the repository layer"

custom_instructions: |
  Our team uses Result types instead of exceptions.
  Flag any throw statements in service layer code.
```

| Field                  | What it does                                         |
| ---------------------- | ---------------------------------------------------- |
| `high_risk_modules`    | Extra scrutiny on these paths                        |
| `suppress`             | Skip these check categories                          |
| `architecture_rules`   | Claude verifies the diff complies with these rules   |
| `custom_instructions`  | Freeform text injected into the review prompt        |

## Credential setup

```bash
prai init
```

Auto-detects your forge and walks you through authentication:

| Forge     | What you need                                                            |
| --------- | ------------------------------------------------------------------------ |
| GitHub    | Personal access token with `repo` scope                                  |
| Bitbucket | Atlassian email + [API token](https://id.atlassian.com/manage-profile/security/api-tokens) |
| GitLab    | Personal access token with `api` scope                                   |

Credentials are verified immediately. Stored in `~/.prai/credentials.json` with `600` permissions (owner-only). Remove with `prai logout`.

## Claude Code skill

Use prai inside Claude Code sessions:

```bash
/prai           # auto-detect and review
/prai 47        # review PR #47
/prai init      # set up credentials
/prai describe  # generate PR description
```

## How it works

<details>
<summary>Architecture (for contributors)</summary>

```
┌─────────┐     ┌───────────────┐     ┌──────────────┐
│  prai   │────▶│  Forge API    │────▶│  PR metadata │
│  CLI    │     │  (GH/BB/GL)   │     │  + branches  │
└────┬────┘     └───────────────┘     └──────────────┘
     │
     │  git worktree add /tmp/prai-review-47
     ▼
┌──────────────────────────────┐
│  Isolated worktree           │
│  (your working dir untouched)│
│  git diff origin/main...HEAD │
└────────────┬─────────────────┘
             │
             ▼
┌──────────────────────────────┐
│  Composable Prompt Pipeline  │
│                              │
│  base review rules           │
│  + tool guidance             │
│  + review checklist          │
│  + PR context (title, desc,  │
│    branch intent, commits)   │
│  + team rules (.prai/rules)  │
│  + --focus areas             │
│  + --context explanation     │
│  + --prompt custom instr.    │
│  + adaptive hints (by size)  │
│  + feedback history          │
│  + diff                      │
└────────────┬─────────────────┘
             │
             ▼
┌──────────────────────────────┐
│  Claude Code CLI             │
│  (runs locally, reads files) │
│  --allowedTools Read,Grep,   │
│                 Glob         │
└────────────┬─────────────────┘
             │
             │  structured JSON review
             ▼
┌──────────────────────────────┐
│  Terminal output + optional  │
│  post to forge as PR comment │
└──────────────────────────────┘
```

**Key design decisions:**

- **Worktree isolation** — temporary git worktree so prai never touches your working directory. Cleaned up automatically, even on Ctrl+C.
- **Full file reading** — Claude reads changed files and their imports, not just the diff. This avoids false positives.
- **Composable prompt pipeline** — the prompt is assembled from independent segments. Each is a pure function returning a string. Empty segments are skipped.
- **Adaptive depth** — small diffs (<100 lines) get deep-dive instructions. Large diffs (>500 lines) get instructions to prioritize critical paths. Over 8000 lines are truncated with a warning.
- **Two-pass review** — critical issues (security, data safety) separated from warnings (performance, style).
- **Supervised review** — feedback is injected as a new prompt segment. Claude re-evaluates with full context of previous findings and your explanations.

</details>

<details>
<summary>Project structure</summary>

```
src/
  index.ts        # CLI entry point, command routing, signal handling
  api.ts          # HTTP client for GitHub/Bitbucket/GitLab APIs
  credentials.ts  # Credential storage (~/.prai/credentials.json)
  forge.ts        # Auto-detect forge type from git remote
  git.ts          # Worktree management, diff, commit log
  reviewer.ts     # Claude invocation, prompt building, output parsing
  init.ts         # Interactive setup wizard
  ui.ts           # Terminal formatting, spinners, markdown export
```

</details>

## License

MIT
