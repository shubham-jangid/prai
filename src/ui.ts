import chalk from 'chalk'
import boxen from 'boxen'
import ora, { type Ora } from 'ora'
import { execSync } from 'child_process'
import type { PRInfo } from './api.js'
import type { ReviewResult, ReviewIssue, DescribeResult } from './reviewer.js'

// ─── Spinner helpers ────────────────────────────────────

export function spinner(text: string): Ora {
  return ora({ text, color: 'cyan' }).start()
}

// ─── Header / Branding ─────────────────────────────────

export function printBanner(): void {
  console.log(
    boxen(chalk.bold.cyan('prai') + chalk.dim(' — AI PR reviewer'), {
      padding: { top: 0, bottom: 0, left: 1, right: 1 },
      borderColor: 'cyan',
      borderStyle: 'round',
    })
  )
  console.log()
}

// ─── PR Info ────────────────────────────────────────────

export function printPRInfo(pr: PRInfo): void {
  console.log(chalk.dim('─'.repeat(60)))
  console.log(`${chalk.bold(`#${pr.number}`)} ${pr.title}`)
  console.log(
    `${chalk.dim('branch')} ${chalk.yellow(pr.sourceBranch)} ${chalk.dim('->')} ${chalk.green(pr.destBranch)}`
  )
  console.log(`${chalk.dim('author')} ${pr.author}  ${chalk.dim('created')} ${new Date(pr.createdAt).toLocaleDateString()}`)
  console.log(chalk.dim('─'.repeat(60)))
  console.log()
}

// ─── PR List ────────────────────────────────────────────

export function printPRList(prs: PRInfo[]): void {
  if (prs.length === 0) {
    console.log(chalk.yellow('No open PRs found.'))
    return
  }
  console.log(chalk.bold(`Open PRs (${prs.length}):\n`))
  for (const pr of prs) {
    console.log(
      `  ${chalk.cyan(`#${pr.number.toString().padEnd(6)}`)} ${pr.title.slice(0, 60).padEnd(60)} ${chalk.dim(pr.author)}`
    )
  }
  console.log()
}

// ─── Review Output ──────────────────────────────────────

function severityIcon(severity: string): string {
  if (severity === 'critical') return chalk.red.bold('CRITICAL')
  if (severity === 'warning') return chalk.yellow('WARNING')
  return chalk.blue('INFO')
}

function printIssue(issue: ReviewIssue, index: number): void {
  console.log(`  ${chalk.dim(`${index + 1}.`)} ${severityIcon(issue.severity)}  ${chalk.dim(`${issue.file}:${issue.line}`)}`)
  console.log(`     ${issue.message}`)
  if (issue.fix) {
    console.log(`     ${chalk.green('fix:')} ${issue.fix}`)
  }
  console.log()
}

export function printReview(review: ReviewResult): void {
  const { complexity, critical, issues, summary } = review

  // Complexity bar
  const score = complexity.score
  const bar = '█'.repeat(score) + chalk.dim('░'.repeat(10 - score))
  const scoreColor = score <= 3 ? chalk.green : score <= 6 ? chalk.yellow : chalk.red
  console.log(
    boxen(
      `${chalk.bold('Complexity')}  ${bar}  ${scoreColor(`${score}/10`)}\n` +
      `${chalk.dim('files')} ${complexity.files}  ${chalk.dim('lines')} ${complexity.lines}  ${chalk.dim('est.')} ${complexity.estimatedMinutes}min`,
      { padding: { top: 0, bottom: 0, left: 1, right: 1 }, borderColor: 'gray', borderStyle: 'round' }
    )
  )
  console.log()

  // Critical issues
  if (critical.length > 0) {
    console.log(chalk.red.bold(`  ${critical.length} Critical Issue${critical.length > 1 ? 's' : ''}`))
    console.log()
    critical.forEach((issue, i) => printIssue(issue, i))
  }

  // Other issues
  if (issues.length > 0) {
    console.log(chalk.yellow(`  ${issues.length} Warning${issues.length > 1 ? 's' : ''}`))
    console.log()
    issues.forEach((issue, i) => printIssue(issue, i))
  }

  if (critical.length === 0 && issues.length === 0) {
    console.log(chalk.green.bold('  No issues found. LGTM!'))
    console.log()
  }

  // Summary
  console.log(chalk.dim('─'.repeat(60)))
  console.log(chalk.bold('  Summary'))
  console.log()
  for (const line of wordWrap(summary, 56)) {
    console.log(`  ${line}`)
  }
  console.log()

  // Verdict
  if (critical.length > 0) {
    console.log(chalk.red.bold('  VERDICT: Changes requested'))
  } else if (issues.length > 0) {
    console.log(chalk.yellow.bold('  VERDICT: Approve with comments'))
  } else {
    console.log(chalk.green.bold('  VERDICT: Approved'))
  }
  console.log()
}

// ─── Diff Stat ──────────────────────────────────────────

export function printDiffStat(stat: string): void {
  console.log(chalk.dim('Diff stat:'))
  console.log(chalk.dim(stat))
}

// ─── Error formatting ───────────────────────────────────

export function printError(message: string): void {
  console.error(chalk.red.bold('Error:'), message)
}

// ─── Success / info messages ────────────────────────────

export function printSuccess(message: string): void {
  console.log(chalk.green('Done:'), message)
}

export function printInfo(message: string): void {
  console.log(chalk.cyan('info:'), message)
}

// ─── Format review as markdown (for posting to forge) ───

export function formatReviewAsMarkdown(review: ReviewResult): string {
  const lines: string[] = []
  lines.push('## prai review')
  lines.push('')

  const { complexity, critical, issues, summary } = review
  lines.push(`**Complexity:** ${complexity.score}/10 | ${complexity.files} files | ${complexity.lines} lines | ~${complexity.estimatedMinutes}min`)
  lines.push('')

  if (critical.length > 0) {
    lines.push(`### ${critical.length} Critical Issue${critical.length > 1 ? 's' : ''}`)
    lines.push('')
    for (const issue of critical) {
      lines.push(`- **\`${issue.file}:${issue.line}\`** ${issue.message}`)
      if (issue.fix) lines.push(`  - *Fix:* ${issue.fix}`)
    }
    lines.push('')
  }

  if (issues.length > 0) {
    lines.push(`### ${issues.length} Warning${issues.length > 1 ? 's' : ''}`)
    lines.push('')
    for (const issue of issues) {
      lines.push(`- **\`${issue.file}:${issue.line}\`** ${issue.message}`)
      if (issue.fix) lines.push(`  - *Fix:* ${issue.fix}`)
    }
    lines.push('')
  }

  if (critical.length === 0 && issues.length === 0) {
    lines.push('No issues found. LGTM!')
    lines.push('')
  }

  lines.push('---')
  lines.push(`**Summary:** ${summary}`)
  lines.push('')

  if (critical.length > 0) {
    lines.push('**Verdict:** Changes requested')
  } else if (issues.length > 0) {
    lines.push('**Verdict:** Approve with comments')
  } else {
    lines.push('**Verdict:** Approved')
  }

  lines.push('')
  lines.push('*Reviewed by [prai](https://github.com/shubham-jangid/prai)*')
  return lines.join('\n')
}

// ─── Description Output ────────────────────────────────

export function printDescription(desc: DescribeResult): void {
  console.log(chalk.bold('  Summary'))
  console.log(`  ${desc.summary}`)
  console.log()

  if (desc.changes.length > 0) {
    console.log(chalk.bold('  Changes'))
    for (const change of desc.changes) {
      console.log(`  ${chalk.cyan('•')} ${change}`)
    }
    console.log()
  }

  if (desc.howToTest.length > 0) {
    console.log(chalk.bold('  How to Test'))
    for (const step of desc.howToTest) {
      console.log(`  ${chalk.dim('☐')} ${step}`)
    }
    console.log()
  }

  const { riskAssessment } = desc
  const score = riskAssessment.complexity
  const bar = '█'.repeat(Math.min(score, 10)) + chalk.dim('░'.repeat(10 - Math.min(score, 10)))
  const scoreColor = score <= 3 ? chalk.green : score <= 6 ? chalk.yellow : chalk.red
  console.log(chalk.bold('  Risk Assessment'))
  console.log(`  Complexity  ${bar}  ${scoreColor(`${score}/10`)}`)
  if (riskAssessment.riskAreas.length > 0) {
    console.log(`  ${chalk.dim('risk areas')} ${riskAssessment.riskAreas.join(', ')}`)
  }
  console.log(`  ${chalk.dim('rollback')} ${riskAssessment.rollback}`)
  console.log()
}

// ─── Word wrap ──────────────────────────────────────────

function wordWrap(text: string, width: number): string[] {
  const lines: string[] = []
  const words = text.split(/\s+/)
  let current = ''

  for (const word of words) {
    if (current.length + word.length + 1 > width && current.length > 0) {
      lines.push(current)
      current = word
    } else {
      current = current ? `${current} ${word}` : word
    }
  }
  if (current) lines.push(current)

  return lines.length > 0 ? lines : ['']
}

// ─── System notification ────────────────────────────────

export function notifyReviewComplete(prNumber: number, verdict: string): void {
  // Terminal bell
  process.stdout.write('\x07')

  const title = `prai — PR #${prNumber}`
  const message = `Review complete: ${verdict}`

  try {
    if (process.platform === 'darwin') {
      execSync(
        `osascript -e 'display notification "${message}" with title "${title}" sound name "Glass"'`,
        { stdio: 'pipe' }
      )
    } else if (process.platform === 'linux') {
      execSync(`notify-send "${title}" "${message}" 2>/dev/null`, { stdio: 'pipe' })
    }
    // Windows: terminal bell is sufficient
  } catch { /* notification is best-effort */ }
}

// ─── Description Output ────────────────────────────────

export function formatDescriptionAsMarkdown(desc: DescribeResult): string {
  const lines: string[] = []

  lines.push('## Summary')
  lines.push(desc.summary)
  lines.push('')

  if (desc.changes.length > 0) {
    lines.push('## Changes')
    for (const change of desc.changes) {
      lines.push(`- ${change}`)
    }
    lines.push('')
  }

  if (desc.howToTest.length > 0) {
    lines.push('## How to Test')
    for (const step of desc.howToTest) {
      lines.push(`- [ ] ${step}`)
    }
    lines.push('')
  }

  lines.push('## Risk Assessment')
  lines.push(`**Complexity:** ${desc.riskAssessment.complexity}/10`)
  if (desc.riskAssessment.riskAreas.length > 0) {
    lines.push(`**Risk areas:** ${desc.riskAssessment.riskAreas.join(', ')}`)
  }
  lines.push(`**Rollback:** ${desc.riskAssessment.rollback}`)

  return lines.join('\n')
}
