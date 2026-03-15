#!/usr/bin/env node

import { Command } from 'commander'
import prompts from 'prompts'
import { detectForge, getCurrentBranch } from './forge.js'
import { hasCredentials, deleteCredentials, loadCredentials } from './credentials.js'
import { createWorktree, removeWorktree, getDiff, getDiffStat, getChangedFiles, getCommitLog } from './git.js'
import { listPRs, getPR, postComment, type PRInfo } from './api.js'
import { reviewPR, describePR } from './reviewer.js'
import {
  printBanner, printPRInfo, printPRList, printReview, printDiffStat,
  printError, printSuccess, printInfo, spinner, formatReviewAsMarkdown,
  printDescription, formatDescriptionAsMarkdown, notifyReviewComplete,
} from './ui.js'
import { runInit } from './init.js'

// ─── Global abort controller for cancellation ───────────

let activeAbortController: AbortController | null = null
let activeWorktreePR: number | null = null

function cleanupAndExit(code: number = 0): void {
  // Abort any running review
  if (activeAbortController) {
    activeAbortController.abort()
    activeAbortController = null
  }

  // Clean up any active worktree
  if (activeWorktreePR !== null) {
    try {
      removeWorktree(activeWorktreePR)
    } catch { /* best effort */ }
    activeWorktreePR = null
  }

  console.log() // newline after ^C
  process.exit(code)
}

// Handle Ctrl+C gracefully
process.on('SIGINT', () => cleanupAndExit(130))
process.on('SIGTERM', () => cleanupAndExit(143))

// Handle prompts cancellation (Ctrl+C during interactive prompts)
const onPromptsCancel = () => {
  cleanupAndExit(130)
}

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

// ─── prai logout ─────────────────────────────────────────

program
  .command('logout')
  .description('Delete stored credentials')
  .action(async () => {
    try {
      printBanner()

      const creds = loadCredentials()
      if (!creds) {
        printInfo('No credentials found — nothing to delete.')
        return
      }

      // Show what's stored
      const stored: string[] = []
      if (creds.github) stored.push('GitHub')
      if (creds.bitbucket) stored.push('Bitbucket')
      if (creds.gitlab) stored.push('GitLab')

      if (stored.length === 0) {
        printInfo('No credentials found — nothing to delete.')
        return
      }

      const choices = [
        ...stored.map(name => ({ title: name, value: name.toLowerCase() })),
        { title: 'All credentials', value: 'all' },
      ]

      const { target } = await prompts({
        type: 'select',
        name: 'target',
        message: `Stored credentials: ${stored.join(', ')}. Which to delete?`,
        choices,
      }, { onCancel: onPromptsCancel })

      if (!target) return

      const { confirm } = await prompts({
        type: 'confirm',
        name: 'confirm',
        message: target === 'all'
          ? 'Delete ALL stored credentials?'
          : `Delete ${target} credentials?`,
        initial: false,
      }, { onCancel: onPromptsCancel })

      if (!confirm) {
        printInfo('Cancelled — credentials unchanged.')
        return
      }

      const forge = target === 'all' ? undefined : target
      deleteCredentials(forge)
      printSuccess(target === 'all'
        ? 'All credentials deleted.'
        : `${target.charAt(0).toUpperCase() + target.slice(1)} credentials deleted.`
      )
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
          activeWorktreePR = pr.number // Track for cleanup on SIGINT
          wtSpinner.succeed(`Worktree at ${worktreePath}`)
        } catch (firstErr: any) {
          // Auto-cleanup and retry once before giving up
          wtSpinner.text = 'Cleaning up stale worktree and retrying...'
          try {
            removeWorktree(pr.number)
          } catch { /* best effort */ }

          try {
            worktreePath = createWorktree(pr.number, pr.sourceBranch)
            activeWorktreePR = pr.number
            wtSpinner.succeed(`Worktree at ${worktreePath} (recovered after cleanup)`)
          } catch (retryErr: any) {
            wtSpinner.fail(`Worktree failed after retry: ${retryErr.message}`)

            // Only fall back to cwd if current branch matches the PR branch.
            // Otherwise we'd review the WRONG code.
            const currentBranch = getCurrentBranch()
            if (currentBranch === pr.sourceBranch) {
              printInfo('Falling back to current directory (same branch)')
            } else {
              printError(
                `Cannot review PR #${pr.number} — worktree creation failed and ` +
                `current branch "${currentBranch}" does not match PR branch "${pr.sourceBranch}".`
              )
              process.exit(1)
            }
          }
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

      // 6. Run review (cancellable via Ctrl+C)
      activeAbortController = new AbortController()
      const reviewSpinner = spinner('Claude is reviewing the PR... (press Ctrl+C to stop)')
      let review
      try {
        review = await reviewPR(reviewDir, diff, diffStat, activeAbortController.signal)
        reviewSpinner.succeed('Review complete')
      } catch (err: any) {
        if (err.message === 'Review cancelled') {
          reviewSpinner.warn('Review cancelled by user')
          cleanup(worktreePath, pr.number)
          return
        }
        reviewSpinner.fail(err.message)
        cleanup(worktreePath, pr.number)
        process.exit(1)
      } finally {
        activeAbortController = null
      }

      console.log()
      printReview(review)

      // Notify user
      const verdict = review.critical.length > 0
        ? 'Changes requested'
        : review.issues.length > 0
          ? 'Approve with comments'
          : 'Approved'
      notifyReviewComplete(pr.number, verdict)

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
        }, { onCancel: onPromptsCancel })

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
    let worktreePath: string | null = null
    let prNumber: number | null = null

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
        if (isNaN(prNum)) {
          printError(`Invalid PR number: ${prNumberArg}`)
          process.exit(1)
        }
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

      try {
        worktreePath = createWorktree(pr.number, pr.sourceBranch)
      } catch {
        // Auto-cleanup and retry once
        try { removeWorktree(pr.number) } catch { /* best effort */ }
        worktreePath = createWorktree(pr.number, pr.sourceBranch)
      }
      prNumber = pr.number
      activeWorktreePR = pr.number // Track for SIGINT cleanup

      const diff = getDiff(worktreePath, pr.destBranch)
      const diffStat = getDiffStat(worktreePath, pr.destBranch)
      const commitLog = getCommitLog(worktreePath, pr.destBranch)

      if (!diff.trim()) {
        printInfo('No diff found — nothing to describe.')
        return
      }

      activeAbortController = new AbortController()
      const s = spinner('Generating description... (press Ctrl+C to stop)')
      const description = await describePR(worktreePath, diff, diffStat, commitLog, activeAbortController.signal)
      s.succeed('Description generated')
      activeAbortController = null

      console.log()
      printDescription(description)

      // Ask what to do with the description
      const { action } = await prompts({
        type: 'select',
        name: 'action',
        message: 'What would you like to do?',
        choices: [
          { title: 'Copy as markdown', description: 'Show markdown to copy into the PR', value: 'copy' },
          { title: 'Done', description: 'Just show the output above', value: 'done' },
        ],
      }, { onCancel: onPromptsCancel })

      if (action === 'copy') {
        const md = formatDescriptionAsMarkdown(description)
        console.log()
        console.log(md)
        console.log()
      }
    } catch (err: any) {
      if (err.message === 'Review cancelled') {
        printInfo('Description generation cancelled.')
      } else {
        printError(err.message)
        process.exit(1)
      }
    } finally {
      activeAbortController = null
      // Always clean up worktree
      if (worktreePath && prNumber !== null) {
        try {
          removeWorktree(prNumber)
        } catch { /* best effort */ }
        activeWorktreePR = null
      }
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
  }, { onCancel: onPromptsCancel })

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
    activeWorktreePR = null
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
