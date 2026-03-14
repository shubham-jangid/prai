#!/usr/bin/env node

import { Command } from 'commander'
import prompts from 'prompts'
import { detectForge, getCurrentBranch } from './forge.js'
import { hasCredentials } from './credentials.js'
import { createWorktree, removeWorktree, getDiff, getDiffStat, getChangedFiles } from './git.js'
import { listPRs, getPR, postComment, type PRInfo } from './api.js'
import { reviewPR } from './reviewer.js'
import {
  printBanner, printPRInfo, printPRList, printReview, printDiffStat,
  printError, printSuccess, printInfo, spinner, formatReviewAsMarkdown,
} from './ui.js'
import { runInit } from './init.js'

const program = new Command()

program
  .name('prai')
  .description('AI PR reviewer — reviews any PR with full codebase context')
  .version('0.1.0')

// ─── prai init ──────────────────────────────────────────

program
  .command('init')
  .description('Set up forge credentials')
  .action(async () => {
    try {
      await runInit()
    } catch (err: any) {
      printError(err.message)
      process.exit(1)
    }
  })

// ─── prai review [pr-number] ────────────────────────────

program
  .command('review [prNumber]')
  .description('Review a PR (auto-detects from current branch if no PR number given)')
  .option('--post', 'Post review as a comment on the PR')
  .option('--no-worktree', 'Skip worktree creation (use current working directory)')
  .action(async (prNumberArg: string | undefined, options: { post?: boolean; worktree?: boolean }) => {
    try {
      printBanner()

      // 1. Detect forge
      const forgeSpinner = spinner('Detecting forge...')
      let forgeInfo
      try {
        forgeInfo = detectForge()
        forgeSpinner.succeed(`${forgeInfo.forge} — ${forgeInfo.workspace}/${forgeInfo.repo}`)
      } catch (err: any) {
        forgeSpinner.fail(err.message)
        process.exit(1)
      }

      const { forge, workspace, repo } = forgeInfo

      // 2. Check credentials
      if (!hasCredentials(forge)) {
        printError(`No ${forge} credentials found. Run: prai init`)
        process.exit(1)
      }

      // 3. Resolve PR number
      let prNum: number
      let pr: PRInfo

      if (prNumberArg) {
        prNum = parseInt(prNumberArg, 10)
        if (isNaN(prNum)) {
          printError(`Invalid PR number: ${prNumberArg}`)
          process.exit(1)
        }
      } else {
        // Try to find PR for current branch
        const branch = getCurrentBranch()
        const prSpinner = spinner(branch ? `Finding PR for branch "${branch}"...` : 'Listing open PRs...')

        const prs = await listPRs(forge, workspace, repo)

        if (branch) {
          const match = prs.find(p => p.sourceBranch === branch)
          if (match) {
            prSpinner.succeed(`Found PR #${match.number}: ${match.title}`)
            prNum = match.number
          } else {
            prSpinner.warn(`No PR found for branch "${branch}"`)
            // Fall back to interactive selection
            prNum = await interactiveSelectPR(prs)
          }
        } else {
          prSpinner.stop()
          prNum = await interactiveSelectPR(prs)
        }
      }

      // 4. Fetch PR details
      const detailsSpinner = spinner(`Fetching PR #${prNum}...`)
      try {
        pr = await getPR(forge, workspace, repo, prNum)
        detailsSpinner.succeed(`PR #${pr.number}: ${pr.title}`)
      } catch (err: any) {
        detailsSpinner.fail(err.message)
        process.exit(1)
      }

      printPRInfo(pr)

      // 5. Create worktree & get diff
      let worktreePath: string | null = null
      let diff: string
      let diffStat: string

      if (options.worktree !== false) {
        const wtSpinner = spinner('Creating worktree...')
        try {
          worktreePath = createWorktree(pr.number, pr.sourceBranch)
          wtSpinner.succeed(`Worktree at ${worktreePath}`)
        } catch (err: any) {
          wtSpinner.fail(`Worktree failed: ${err.message}`)
          printInfo('Falling back to current directory')
        }
      }

      const reviewDir = worktreePath || process.cwd()
      const diffSpinner = spinner('Computing diff...')
      try {
        diff = getDiff(reviewDir, pr.destBranch)
        diffStat = getDiffStat(reviewDir, pr.destBranch)
        const files = getChangedFiles(reviewDir, pr.destBranch)
        diffSpinner.succeed(`${files.length} files changed`)
      } catch (err: any) {
        diffSpinner.fail(err.message)
        cleanup(worktreePath, pr.number)
        process.exit(1)
      }

      if (!diff.trim()) {
        printInfo('No diff found — nothing to review.')
        cleanup(worktreePath, pr.number)
        return
      }

      printDiffStat(diffStat)
      console.log()

      // 6. Run review
      const reviewSpinner = spinner('Claude is reviewing the PR...')
      let review
      try {
        review = await reviewPR(reviewDir, diff, diffStat)
        reviewSpinner.succeed('Review complete')
      } catch (err: any) {
        reviewSpinner.fail(err.message)
        cleanup(worktreePath, pr.number)
        process.exit(1)
      }

      console.log()
      printReview(review)

      // 7. Optionally post comment
      if (options.post) {
        const postSpinner = spinner('Posting review comment...')
        try {
          const markdown = formatReviewAsMarkdown(review)
          await postComment(forge, workspace, repo, pr.number, markdown)
          postSpinner.succeed('Review posted to PR')
        } catch (err: any) {
          postSpinner.fail(`Failed to post: ${err.message}`)
        }
      } else if (review.critical.length > 0 || review.issues.length > 0) {
        const { shouldPost } = await prompts({
          type: 'confirm',
          name: 'shouldPost',
          message: 'Post this review as a comment on the PR?',
          initial: false,
        })

        if (shouldPost) {
          const postSpinner = spinner('Posting review comment...')
          try {
            const markdown = formatReviewAsMarkdown(review)
            await postComment(forge, workspace, repo, pr.number, markdown)
            postSpinner.succeed('Review posted to PR')
          } catch (err: any) {
            postSpinner.fail(`Failed to post: ${err.message}`)
          }
        }
      }

      // 8. Cleanup
      cleanup(worktreePath, pr.number)

    } catch (err: any) {
      printError(err.message)
      process.exit(1)
    }
  })

// ─── prai list ──────────────────────────────────────────

program
  .command('list')
  .description('List open PRs')
  .action(async () => {
    try {
      printBanner()
      const forgeInfo = detectForge()

      if (!hasCredentials(forgeInfo.forge)) {
        printError(`No ${forgeInfo.forge} credentials found. Run: prai init`)
        process.exit(1)
      }

      const s = spinner('Fetching open PRs...')
      const prs = await listPRs(forgeInfo.forge, forgeInfo.workspace, forgeInfo.repo)
      s.succeed(`${prs.length} open PR${prs.length !== 1 ? 's' : ''}`)
      console.log()
      printPRList(prs)
    } catch (err: any) {
      printError(err.message)
      process.exit(1)
    }
  })

// ─── prai describe [pr-number] ──────────────────────────

program
  .command('describe [prNumber]')
  .description('Generate a PR description from the diff')
  .action(async (prNumberArg: string | undefined) => {
    try {
      printBanner()
      const forgeInfo = detectForge()

      if (!hasCredentials(forgeInfo.forge)) {
        printError(`No ${forgeInfo.forge} credentials found. Run: prai init`)
        process.exit(1)
      }

      let prNum: number
      if (prNumberArg) {
        prNum = parseInt(prNumberArg, 10)
      } else {
        const branch = getCurrentBranch()
        const prs = await listPRs(forgeInfo.forge, forgeInfo.workspace, forgeInfo.repo)
        const match = branch ? prs.find(p => p.sourceBranch === branch) : null
        if (match) {
          prNum = match.number
        } else {
          prNum = await interactiveSelectPR(prs)
        }
      }

      const pr = await getPR(forgeInfo.forge, forgeInfo.workspace, forgeInfo.repo, prNum)
      printPRInfo(pr)

      const worktreePath = createWorktree(pr.number, pr.sourceBranch)
      const diff = getDiff(worktreePath, pr.destBranch)
      const diffStat = getDiffStat(worktreePath, pr.destBranch)

      const s = spinner('Generating description...')
      const review = await reviewPR(worktreePath, diff, diffStat)
      s.succeed('Description generated')

      console.log()
      if (review.summary) {
        console.log(review.summary)
      }

      removeWorktree(pr.number)
    } catch (err: any) {
      printError(err.message)
      process.exit(1)
    }
  })

// ─── Helpers ────────────────────────────────────────────

async function interactiveSelectPR(prs: PRInfo[]): Promise<number> {
  if (prs.length === 0) {
    printError('No open PRs found.')
    process.exit(1)
  }

  const { selected } = await prompts({
    type: 'select',
    name: 'selected',
    message: 'Select a PR to review:',
    choices: prs.map(pr => ({
      title: `#${pr.number} ${pr.title}`,
      description: `${pr.sourceBranch} -> ${pr.destBranch} (${pr.author})`,
      value: pr.number,
    })),
  })

  if (selected === undefined) {
    process.exit(0)
  }

  return selected
}

function cleanup(worktreePath: string | null, prNumber: number): void {
  if (worktreePath) {
    try {
      removeWorktree(prNumber)
    } catch { /* ignore cleanup errors */ }
  }
}

// ─── Default: run review if no command given ────────────

// If user just types `prai` or `prai 47`, treat it as review
const args = process.argv.slice(2)
if (args.length === 0 || (args.length === 1 && /^\d+$/.test(args[0]))) {
  // Rewrite args to inject "review" command
  const prNum = args[0]
  process.argv = [...process.argv.slice(0, 2), 'review', ...(prNum ? [prNum] : [])]
}

program.parse()
