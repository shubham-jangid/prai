<p align="center">
  <h1 align="center">prai</h1>
  <p align="center">
    <strong>AI code reviews from your terminal. Free. Local-first. Multi-forge.</strong>
  </p>
  <p align="center">
    <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License: MIT"></a>
    <a href="https://nodejs.org"><img src="https://img.shields.io/badge/Node-18%2B-green.svg" alt="Node"></a>
    <a href="https://github.com"><img src="https://img.shields.io/badge/GitHub-supported-black.svg" alt="GitHub"></a>
    <a href="https://bitbucket.org"><img src="https://img.shields.io/badge/Bitbucket-supported-blue.svg" alt="Bitbucket"></a>
    <a href="https://gitlab.com"><img src="https://img.shields.io/badge/GitLab-supported-orange.svg" alt="GitLab"></a>
  </p>
</p>

---

prai reviews your pull requests using Claude Code — the same AI that can read your entire codebase, not just the diff. It runs from your terminal, uses your existing Claude Code subscription, and works with GitHub, Bitbucket, and GitLab.

```
$ prai

╭ prai — AI PR reviewer ╮
╰────────────────────────╯

? Select a PR to review:
❯ #47  feat/login-fix — Fix OAuth token refresh
  #45  bugfix/null-check — Handle missing user profile
  #43  feat/dashboard — Add analytics dashboard

✔ Review complete

  CRITICAL  src/auth/oauth.ts:89
  Token refresh has no retry — a single 503 kills the session
  fix: Wrap in exponential backoff (3 retries)

  WARNING  src/auth/oauth.ts:142
  Access token stored in localStorage — vulnerable to XSS
  fix: Move to httpOnly cookie

  VERDICT: Changes requested

? What next?
❯ Accept review
  Give feedback — explain why an issue is incorrect
  Post to PR — post as a comment on the PR
```

## Install

> **You need [Claude Code](https://claude.ai/download) installed and logged in.** prai uses your existing subscription — no extra API keys or costs.

```bash
npm install -g prai-review
```

Or build from source:

```bash
git clone https://github.com/shubham-jangid/prai.git
cd prai && npm install && npm run build && npm link
```

## Setup (one time)

```bash
prai init
```

That's it. prai detects your forge from the git remote and walks you through auth:

- **GitHub** — personal access token with `repo` scope
- **Bitbucket** — email + [API token](https://id.atlassian.com/manage-profile/security/api-tokens)
- **GitLab** — personal access token with `api` scope

Self-hosted GitHub Enterprise and GitLab instances are supported automatically.

## Usage

```bash
prai              # pick a PR interactively
prai 47           # review PR #47 directly
prai describe 47  # generate a PR description
prai list         # list open PRs
```

That's the whole CLI. No config files, no YAML pipelines, no CI setup.

### Guide the review

Tell Claude what to focus on:

```bash
prai 47 --focus "security, error handling"
prai 47 --context "migrating auth from JWT to sessions"
prai 47 --prompt "check for N+1 queries and missing indexes"
```

Or just run `prai` with no flags — it'll ask you interactively after you pick a PR.

### Deep review

By default, prai does a quick review (~1 min). For thorough reviews where Claude reads every changed file, checks callers, and verifies tests:

```bash
prai 47 --deep
```

Takes 3-5 minutes but catches significantly more.

### Push back on findings

Disagree with something? Choose **Give feedback** after the review, explain why an issue is correct or intentional, and Claude re-evaluates. It drops justified issues and keeps valid ones. Go back and forth as many rounds as you need.

### Post to PR

```bash
prai 47 --post
```

Posts the review as a comment on the PR.

## Team rules

Drop a `.prai/rules.yaml` in your repo to customize reviews for your whole team:

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

## Use inside Claude Code

prai ships as a Claude Code skill:

```
/prai           # interactive PR review
/prai 47        # review PR #47
/prai describe  # generate PR description
```

## All flags

| Flag | What it does |
|---|---|
| `--focus` | Narrow review to specific areas |
| `--context` | Explain what the change is about |
| `--prompt` | Custom review instructions |
| `--deep` | Read every changed file in full |
| `--post` | Post review as a PR comment |
| `--verbose` | Show the full prompt sent to Claude |

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
- **Full file reading** — Claude reads changed files and their imports, not just the diff. This avoids false positives from missing context.
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
