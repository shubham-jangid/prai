import { execSync } from 'child_process'
import { existsSync } from 'fs'

export function createWorktree(prNumber: number, branch: string): string {
  const worktreePath = `/tmp/prai-review-${prNumber}`

  // Clean up existing worktree if it exists
  if (existsSync(worktreePath)) {
    try {
      execSync(`git worktree remove "${worktreePath}" --force`, {
        encoding: 'utf-8',
        stdio: 'pipe',
      })
    } catch {
      // If worktree remove fails, try manual cleanup
      execSync(`rm -rf "${worktreePath}"`, { stdio: 'pipe' })
      try {
        execSync('git worktree prune', { stdio: 'pipe' })
      } catch { /* ignore */ }
    }
  }

  // Fetch the branch
  try {
    execSync(`git fetch origin "${branch}" --quiet`, { encoding: 'utf-8', stdio: 'pipe' })
  } catch {
    throw new Error(`Failed to fetch branch: ${branch}`)
  }

  // Create worktree
  try {
    execSync(`git worktree add "${worktreePath}" "origin/${branch}" --quiet`, {
      encoding: 'utf-8',
      stdio: 'pipe',
    })
  } catch {
    // Try detached HEAD if branch conflicts
    execSync(`git worktree add --detach "${worktreePath}" "origin/${branch}" --quiet`, {
      encoding: 'utf-8',
      stdio: 'pipe',
    })
  }

  return worktreePath
}

export function removeWorktree(prNumber: number): void {
  const worktreePath = `/tmp/prai-review-${prNumber}`
  try {
    execSync(`git worktree remove "${worktreePath}" --force`, { stdio: 'pipe' })
  } catch {
    try {
      execSync(`rm -rf "${worktreePath}"`, { stdio: 'pipe' })
      execSync('git worktree prune', { stdio: 'pipe' })
    } catch { /* ignore */ }
  }
}

export function getDiff(worktreePath: string, destBranch: string): string {
  try {
    return execSync(`git diff origin/${destBranch}...HEAD`, {
      encoding: 'utf-8',
      cwd: worktreePath,
      maxBuffer: 10 * 1024 * 1024, // 10MB
    })
  } catch {
    // Fallback: diff against the destination branch directly
    return execSync(`git diff origin/${destBranch}`, {
      encoding: 'utf-8',
      cwd: worktreePath,
      maxBuffer: 10 * 1024 * 1024,
    })
  }
}

export function getDiffStat(worktreePath: string, destBranch: string): string {
  try {
    return execSync(`git diff origin/${destBranch}...HEAD --stat`, {
      encoding: 'utf-8',
      cwd: worktreePath,
    })
  } catch {
    return execSync(`git diff origin/${destBranch} --stat`, {
      encoding: 'utf-8',
      cwd: worktreePath,
    })
  }
}

export function getChangedFiles(worktreePath: string, destBranch: string): string[] {
  try {
    const output = execSync(`git diff origin/${destBranch}...HEAD --name-only`, {
      encoding: 'utf-8',
      cwd: worktreePath,
    })
    return output.trim().split('\n').filter(Boolean)
  } catch {
    return []
  }
}

export function getCommitLog(worktreePath: string, destBranch: string): string {
  try {
    return execSync(`git log origin/${destBranch}..HEAD --oneline`, {
      encoding: 'utf-8',
      cwd: worktreePath,
    }).trim()
  } catch {
    return ''
  }
}
