import { execFileSync } from 'child_process'
import { existsSync, rmSync, statSync } from 'fs'
import { join } from 'path'

/**
 * Check if a worktree was successfully created despite a non-zero exit code
 * (e.g. husky post-checkout hook failures). A valid worktree has a .git file
 * (not directory) that points back to the main repo.
 */
function isValidWorktree(worktreePath: string): boolean {
  try {
    const gitPath = join(worktreePath, '.git')
    return existsSync(gitPath) && statSync(gitPath).isFile()
  } catch {
    return false
  }
}

export function createWorktree(prNumber: number, branch: string): string {
  const worktreePath = `/tmp/prai-review-${prNumber}`

  // Always prune stale worktree entries first
  try { execFileSync('git', ['worktree', 'prune'], { stdio: 'pipe' }) } catch { /* ignore */ }

  // Clean up existing worktree if it exists
  if (existsSync(worktreePath)) {
    try {
      execFileSync('git', ['worktree', 'remove', worktreePath, '--force'], {
        encoding: 'utf-8',
        stdio: 'pipe',
      })
    } catch {
      // git worktree remove failed — force delete the directory
      try {
        rmSync(worktreePath, { recursive: true, force: true })
      } catch { /* ignore */ }
      try { execFileSync('git', ['worktree', 'prune'], { stdio: 'pipe' }) } catch { /* ignore */ }
    }

    // If it STILL exists after all cleanup attempts, fail explicitly
    if (existsSync(worktreePath)) {
      throw new Error(
        `Could not clean up existing worktree at ${worktreePath}\n` +
        `  Try manually: rm -rf ${worktreePath} && git worktree prune`
      )
    }
  }

  // Fetch the branch
  try {
    execFileSync('git', ['fetch', 'origin', branch, '--quiet'], {
      encoding: 'utf-8',
      stdio: 'pipe',
    })
  } catch {
    throw new Error(`Failed to fetch branch: ${branch}`)
  }

  // Create worktree
  try {
    execFileSync('git', ['worktree', 'add', worktreePath, `origin/${branch}`, '--quiet'], {
      encoding: 'utf-8',
      stdio: 'pipe',
    })
  } catch {
    // git worktree add can "fail" due to post-checkout hooks (e.g. husky)
    // even though the worktree was created successfully. Check before retrying.
    if (isValidWorktree(worktreePath)) {
      return worktreePath
    }

    // First attempt may leave a partial directory — clean it before retry
    try { rmSync(worktreePath, { recursive: true, force: true }) } catch { /* ignore */ }
    try { execFileSync('git', ['worktree', 'prune'], { stdio: 'pipe' }) } catch { /* ignore */ }

    // Try detached HEAD if branch conflicts
    try {
      execFileSync('git', ['worktree', 'add', '--detach', worktreePath, `origin/${branch}`, '--quiet'], {
        encoding: 'utf-8',
        stdio: 'pipe',
      })
    } catch {
      // Same hook issue — check if worktree was actually created
      if (!isValidWorktree(worktreePath)) {
        throw new Error(
          `Failed to create worktree for origin/${branch} at ${worktreePath}`
        )
      }
    }
  }

  return worktreePath
}

export function removeWorktree(prNumber: number): void {
  const worktreePath = `/tmp/prai-review-${prNumber}`
  try {
    execFileSync('git', ['worktree', 'remove', worktreePath, '--force'], { stdio: 'pipe' })
  } catch {
    try {
      rmSync(worktreePath, { recursive: true, force: true })
      execFileSync('git', ['worktree', 'prune'], { stdio: 'pipe' })
    } catch { /* ignore */ }
  }
}

export function getDiff(worktreePath: string, destBranch: string): string {
  try {
    return execFileSync('git', ['diff', `origin/${destBranch}...HEAD`], {
      encoding: 'utf-8',
      cwd: worktreePath,
      maxBuffer: 10 * 1024 * 1024, // 10MB
    })
  } catch {
    // Fallback: diff against the destination branch directly
    return execFileSync('git', ['diff', `origin/${destBranch}`], {
      encoding: 'utf-8',
      cwd: worktreePath,
      maxBuffer: 10 * 1024 * 1024,
    })
  }
}

export function getDiffStat(worktreePath: string, destBranch: string): string {
  try {
    return execFileSync('git', ['diff', `origin/${destBranch}...HEAD`, '--stat'], {
      encoding: 'utf-8',
      cwd: worktreePath,
    })
  } catch {
    return execFileSync('git', ['diff', `origin/${destBranch}`, '--stat'], {
      encoding: 'utf-8',
      cwd: worktreePath,
    })
  }
}

export function getChangedFiles(worktreePath: string, destBranch: string): string[] {
  try {
    const output = execFileSync('git', ['diff', `origin/${destBranch}...HEAD`, '--name-only'], {
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
    return execFileSync('git', ['log', `origin/${destBranch}..HEAD`, '--oneline'], {
      encoding: 'utf-8',
      cwd: worktreePath,
    }).trim()
  } catch {
    return ''
  }
}
