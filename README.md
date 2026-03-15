# prai

AI-powered PR reviewer that runs locally using your Claude Code subscription. Supports GitHub, Bitbucket, and GitLab. Your code never leaves your machine.

```
prai review 47
```

```
╭ prai — AI PR reviewer ╮
╰────────────────────────╯

 ✔ github — acme/backend
 ✔ PR #47: feat/login-fix
────────────────────────────────────────────────────────
 #47  Fix OAuth token refresh logic
 branch  feat/login-fix -> main
 author  alice  created  3/14/2026
────────────────────────────────────────────────────────

 ✔ Worktree at /tmp/prai-review-47
 ✔ 4 files changed
 ✔ Review complete

╭ Complexity  ████████░░  8/10          ╮
│ files 4  lines 312  est. 60min        │
╰───────────────────────────────────────╯

  2 Critical Issues

  1. CRITICAL  src/auth/oauth.ts:89
     Token refresh has no retry — a single 503 kills the session
     fix: Wrap in exponential backoff (3 retries)

  ...

  VERDICT: Changes requested
```

## What it solves

Code review takes time. Existing AI review tools either (a) send your code to third-party servers, (b) cost extra per-seat, or (c) only see the diff without codebase context.

prai fixes all three:

- **Runs locally** — the Claude Code CLI runs on your machine, reads files from a local git worktree. Nothing leaves your laptop.
- **No extra cost** — uses your existing Claude Code subscription. No per-seat or per-review pricing.
- **Full codebase context** — Claude reads the changed files _and_ their imports/dependencies to understand how changes affect the broader codebase.
- **Two-pass review** — separates blocking issues (security, data safety, error handling) from non-blocking ones (performance, code quality, test gaps).
- **Multi-forge** — works with GitHub, Bitbucket, and GitLab from the same CLI.

## Requirements

- [Claude Code CLI](https://claude.ai/download) installed and logged in (`claude login`)
- Node.js 18+
- Git

## Install

```bash
# Clone and install globally
git clone https://github.com/shubham-jangid/prai
cd prai
npm install
npm run build
npm link
```

After linking, `prai` is available as a global command.

## Setup

Run this once to configure your forge credentials:

```bash
prai init
```

It will auto-detect your forge from the git remote and guide you through authentication:

| Forge     | What you need                                                             |
| --------- | ------------------------------------------------------------------------- |
| GitHub    | Personal access token with `repo` scope                                   |
| Bitbucket | Atlassian email + API token (Repositories Read, Pull requests Read/Write) |
| GitLab    | Personal access token with `api` scope                                    |

Credentials are stored in `~/.prai/credentials.json` with `600` permissions.

## Usage

### Review a PR

```bash
# Auto-detect PR from current branch
prai

# Review a specific PR by number
prai 47
prai review 47

# Review and auto-post the comment to the PR
prai review 47 --post

# Skip worktree creation (use current directory)
prai review 47 --no-worktree
```

**What happens:**

```
detect forge → check credentials → fetch PR metadata → create worktree
→ compute diff → Claude reviews with full codebase context → show results
→ optionally post to PR → clean up worktree
```

The review output includes:

- **Complexity score** (1-10) with estimated human review time
- **Critical issues** — security, data safety, error handling (blocking)
- **Warnings** — performance, logic, code quality, test gaps (non-blocking)
- **Summary** and **verdict** (Approved / Approve with comments / Changes requested)

Press **Ctrl+C** at any point to cancel — the worktree and Claude process are cleaned up automatically.

### Generate a PR description

```bash
# Auto-detect from current branch
prai describe

# For a specific PR
prai describe 47
```

Generates a structured description from the diff and commit messages:

- Summary (what and why)
- Changes (grouped by area)
- How to test (step-by-step)
- Risk assessment (complexity, risk areas, rollback plan)

Offers to show the raw markdown so you can paste it into the PR.

### List open PRs

```bash
prai list
```

Shows all open PRs with number, title, branch, and author.

## Team rules

Drop a `.prai/rules.yaml` in your repo root to customize review behavior:

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
```

High-risk modules get extra scrutiny. Suppressions skip specific check categories. Architecture rules are checked against the diff.

## How it works

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
│                              │
│  git diff origin/main...HEAD │
└────────────┬─────────────────┘
             │
             │  diff + changed files + review checklist
             ▼
┌──────────────────────────────┐
│  Claude Code CLI             │
│  (runs locally, reads files) │
│  -p <prompt>                 │
│  --allowedTools Read,Grep,   │
│                 Glob         │
│  --max-turns 3               │
└────────────┬─────────────────┘
             │
             │  structured JSON review
             ▼
┌──────────────────────────────┐
│  Terminal output + optional  │
│  post to forge as PR comment │
└──────────────────────────────┘
```

Key design decisions:

- **Worktree isolation** — creates a temporary git worktree so prai never touches your working directory. Cleaned up automatically, even on Ctrl+C.
- **Claude reads full files** — not just the diff. This lets it understand context, spot issues in surrounding code, and avoid false positives for things already handled.
- **JSON output format** — Claude returns structured JSON that prai parses for consistent, machine-readable output. Graceful fallback if JSON parsing fails.
- **Two-pass review** — critical issues (security, data safety) are separated from informational ones (performance, style) so you know what to fix first.

## Claude Code skill

prai also ships as a Claude Code skill for use inside Claude Code sessions:

```bash
# In any Claude Code session
/prai           # auto-detect and review
/prai 47        # review PR #47
/prai init      # set up credentials
/prai describe  # generate PR description
```

The skill files live in `~/.claude/skills/prai/` and are installed by the `setup` script.

## Project structure

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

## License

MIT
