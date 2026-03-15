import { execSync } from 'child_process'
import https from 'https'

export interface ForgeInfo {
  forge: 'github' | 'bitbucket' | 'gitlab'
  hostname: string
  workspace: string
  repo: string
  remoteUrl: string
}

/**
 * Detect forge from URL pattern (fast, no network).
 * Returns null if the hostname doesn't contain a known forge name.
 */
function detectForgeFromUrl(remoteUrl: string): ForgeInfo['forge'] | null {
  if (/bitbucket/i.test(remoteUrl)) return 'bitbucket'
  if (/github/i.test(remoteUrl)) return 'github'
  if (/gitlab/i.test(remoteUrl)) return 'gitlab'
  return null
}

/**
 * Probe the hostname's API to detect what forge it's running (slow, needs network).
 * Used as fallback for self-hosted instances with generic hostnames like git.company.com.
 */
function probeForge(hostname: string): Promise<ForgeInfo['forge'] | null> {
  // Try GitHub Enterprise API first (most common self-hosted)
  // GHE responds to /api/v3/meta with { "installed_version": "..." }
  return probeUrl(`https://${hostname}/api/v3/meta`)
    .then(body => {
      if (body && (body.includes('installed_version') || body.includes('github'))) return 'github' as const
      // Try GitLab API — /api/v4/version responds with { "version": "...", "revision": "..." }
      return probeUrl(`https://${hostname}/api/v4/version`)
    })
    .then(result => {
      if (typeof result === 'string') {
        if (result && (result.includes('"version"') || result.includes('"revision"'))) return 'gitlab' as const
        return null
      }
      return result // already resolved to a forge type
    })
    .catch(() => null)
}

function probeUrl(url: string): Promise<string | null> {
  return new Promise(resolve => {
    const req = https.request(url, { method: 'GET', timeout: 5000 }, res => {
      // 2xx or 401 means the API exists (401 = auth required but it IS that forge)
      if (res.statusCode && (res.statusCode < 300 || res.statusCode === 401)) {
        let data = ''
        res.on('data', (chunk: Buffer) => data += chunk.toString())
        res.on('end', () => resolve(data))
      } else {
        res.resume() // drain
        resolve(null)
      }
    })
    req.on('timeout', () => { req.destroy(); resolve(null) })
    req.on('error', () => resolve(null))
    req.end()
  })
}

function parseRemoteUrl(remoteUrl: string): { hostname: string; pathPart: string } {
  if (remoteUrl.startsWith('git@')) {
    // SSH: git@host:workspace/repo.git
    const hostname = remoteUrl.split('@')[1]?.split(':')[0] ?? ''
    const pathPart = remoteUrl.split(':')[1]?.replace(/\.git$/, '') ?? ''
    return { hostname, pathPart }
  } else {
    // HTTPS: https://host/workspace/repo.git
    const url = new URL(remoteUrl)
    return { hostname: url.hostname, pathPart: url.pathname.slice(1).replace(/\.git$/, '') }
  }
}

export function detectForge(): ForgeInfo {
  let remoteUrl: string
  try {
    remoteUrl = execSync('git remote get-url origin', { encoding: 'utf-8' }).trim()
  } catch {
    throw new Error('Not a git repository or no origin remote found.')
  }

  const forge = detectForgeFromUrl(remoteUrl)
  const { hostname, pathPart } = parseRemoteUrl(remoteUrl)

  if (forge) {
    return buildForgeInfo(forge, hostname, pathPart, remoteUrl)
  }

  // Unknown hostname — can't detect synchronously. Store the URL for async detection.
  // Return a placeholder that the caller will resolve with detectForgeAsync().
  throw new ForgeDetectionNeeded(hostname, pathPart, remoteUrl)
}

/**
 * Async forge detection — probes the server's API to determine what forge it runs.
 * Called when the synchronous URL-based detection can't identify the forge.
 */
export async function detectForgeAsync(hostname: string, pathPart: string, remoteUrl: string): Promise<ForgeInfo> {
  const forge = await probeForge(hostname)
  if (!forge) {
    throw new Error(
      `Could not detect forge for: ${remoteUrl}\n` +
      `The hostname "${hostname}" doesn't match any known forge.\n` +
      `Tried probing GitHub Enterprise and GitLab APIs — neither responded.\n\n` +
      `If this is a self-hosted instance, please open an issue at:\n` +
      `  https://github.com/shubham-jangid/prai/issues`
    )
  }
  return buildForgeInfo(forge, hostname, pathPart, remoteUrl)
}

function buildForgeInfo(forge: ForgeInfo['forge'], hostname: string, pathPart: string, remoteUrl: string): ForgeInfo {
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

  return { forge, hostname, workspace, repo, remoteUrl }
}

/**
 * Thrown when synchronous URL detection fails but async probing might succeed.
 */
export class ForgeDetectionNeeded extends Error {
  constructor(
    public readonly hostname: string,
    public readonly pathPart: string,
    public readonly remoteUrl: string,
  ) {
    super(`Unknown forge — probing ${hostname}...`)
    this.name = 'ForgeDetectionNeeded'
  }
}

export function getCurrentBranch(): string {
  try {
    return execSync('git branch --show-current', { encoding: 'utf-8' }).trim()
  } catch {
    return ''
  }
}
