import { execSync } from 'child_process'

export interface ForgeInfo {
  forge: 'github' | 'bitbucket' | 'gitlab'
  workspace: string
  repo: string
  remoteUrl: string
}

export function detectForge(): ForgeInfo {
  let remoteUrl: string
  try {
    remoteUrl = execSync('git remote get-url origin', { encoding: 'utf-8' }).trim()
  } catch {
    throw new Error('Not a git repository or no origin remote found.')
  }

  let forge: ForgeInfo['forge']
  if (/bitbucket/i.test(remoteUrl)) forge = 'bitbucket'
  else if (/github/i.test(remoteUrl)) forge = 'github'
  else if (/gitlab/i.test(remoteUrl)) forge = 'gitlab'
  else throw new Error(`Unknown forge. Remote URL: ${remoteUrl}`)

  let pathPart: string
  if (remoteUrl.startsWith('git@')) {
    // SSH: git@host:workspace/repo.git
    pathPart = remoteUrl.split(':')[1]?.replace(/\.git$/, '') ?? ''
  } else {
    // HTTPS: https://host/workspace/repo.git
    const url = new URL(remoteUrl)
    pathPart = url.pathname.slice(1).replace(/\.git$/, '')
  }

  const parts = pathPart.split('/')
  if (parts.length < 2) {
    throw new Error(`Could not parse workspace/repo from: ${remoteUrl}`)
  }

  // Handle subgroups: git@gitlab.com:group/subgroup/repo.git
  // workspace = everything before the last segment, repo = last segment
  const repo = parts[parts.length - 1]
  const workspace = parts.slice(0, -1).join('/')

  if (!workspace || !repo) {
    throw new Error(`Could not parse workspace/repo from: ${remoteUrl}`)
  }

  return { forge, workspace, repo, remoteUrl }
}

export function getCurrentBranch(): string {
  try {
    return execSync('git branch --show-current', { encoding: 'utf-8' }).trim()
  } catch {
    return ''
  }
}
