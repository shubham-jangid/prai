import https from 'https'
import http from 'http'
import { getAuthHeaders, getBitbucketAuth } from './credentials.js'

interface RequestOptions {
  method?: string
  headers?: Record<string, string>
  body?: string
  auth?: string
  timeout?: number
}

function request(url: string, options: RequestOptions = {}): Promise<any> {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url)
    const client = parsedUrl.protocol === 'https:' ? https : http
    const timeoutMs = options.timeout ?? 30_000 // 30s default

    const reqOptions: any = {
      hostname: parsedUrl.hostname,
      path: parsedUrl.pathname + parsedUrl.search,
      method: options.method || 'GET',
      timeout: timeoutMs,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'prai/0.1.0',
        ...options.headers,
      },
    }

    if (options.auth) {
      reqOptions.auth = options.auth
    }

    const req = client.request(reqOptions, (res) => {
      let data = ''
      res.on('data', (chunk: Buffer) => (data += chunk.toString()))
      res.on('end', () => {
        const statusCode = res.statusCode || 0

        // Check for HTTP error status codes
        if (statusCode === 401 || statusCode === 403) {
          reject(new Error(`Authentication failed (HTTP ${statusCode}). Check your credentials — run: prai init`))
          return
        }
        if (statusCode === 404) {
          reject(new Error(`Not found (HTTP 404): ${parsedUrl.pathname}`))
          return
        }
        if (statusCode >= 500) {
          reject(new Error(`Server error (HTTP ${statusCode}) from ${parsedUrl.hostname}`))
          return
        }

        try {
          resolve(JSON.parse(data))
        } catch {
          if (statusCode >= 400) {
            reject(new Error(`HTTP ${statusCode}: ${data.slice(0, 200)}`))
          } else {
            resolve(data)
          }
        }
      })
    })

    req.on('timeout', () => {
      req.destroy()
      reject(new Error(`Request timed out after ${timeoutMs / 1000}s: ${parsedUrl.pathname}`))
    })

    req.on('error', reject)
    if (options.body) req.write(options.body)
    req.end()
  })
}

// ─── PR Types ────────────────────────────────────────────

export interface PRInfo {
  number: number
  title: string
  sourceBranch: string
  destBranch: string
  author: string
  createdAt: string
  url: string
}

// ─── GitHub ──────────────────────────────────────────────

export async function githubListPRs(workspace: string, repo: string): Promise<PRInfo[]> {
  const headers = getAuthHeaders('github') as Record<string, string>
  const data = await request(
    `https://api.github.com/repos/${workspace}/${repo}/pulls?state=open&per_page=20`,
    { headers }
  )
  if (!Array.isArray(data)) return []
  return data.map((pr: any) => ({
    number: pr.number,
    title: pr.title,
    sourceBranch: pr.head.ref,
    destBranch: pr.base.ref,
    author: pr.user.login,
    createdAt: pr.created_at,
    url: pr.html_url,
  }))
}

export async function githubGetPR(workspace: string, repo: string, prNum: number): Promise<PRInfo> {
  const headers = getAuthHeaders('github') as Record<string, string>
  const pr = await request(
    `https://api.github.com/repos/${workspace}/${repo}/pulls/${prNum}`,
    { headers }
  )
  if (pr.message) throw new Error(`GitHub API: ${pr.message}`)
  return {
    number: pr.number,
    title: pr.title,
    sourceBranch: pr.head.ref,
    destBranch: pr.base.ref,
    author: pr.user.login,
    createdAt: pr.created_at,
    url: pr.html_url,
  }
}

export async function githubPostComment(workspace: string, repo: string, prNum: number, body: string): Promise<void> {
  const headers = getAuthHeaders('github') as Record<string, string>
  await request(
    `https://api.github.com/repos/${workspace}/${repo}/issues/${prNum}/comments`,
    { method: 'POST', headers, body: JSON.stringify({ body }) }
  )
}

// ─── Bitbucket ───────────────────────────────────────────

export async function bitbucketListPRs(workspace: string, repo: string): Promise<PRInfo[]> {
  const { username, password } = getBitbucketAuth()
  const data = await request(
    `https://api.bitbucket.org/2.0/repositories/${workspace}/${repo}/pullrequests?state=OPEN&pagelen=20`,
    { auth: `${username}:${password}` }
  )
  if (data.type === 'error') throw new Error(data.error?.message || 'Bitbucket API error')
  if (!data.values) return []
  return data.values.map((pr: any) => ({
    number: pr.id,
    title: pr.title,
    sourceBranch: pr.source.branch.name,
    destBranch: pr.destination.branch.name,
    author: pr.author.display_name,
    createdAt: pr.created_on,
    url: pr.links.html.href,
  }))
}

export async function bitbucketGetPR(workspace: string, repo: string, prNum: number): Promise<PRInfo> {
  const { username, password } = getBitbucketAuth()
  const pr = await request(
    `https://api.bitbucket.org/2.0/repositories/${workspace}/${repo}/pullrequests/${prNum}`,
    { auth: `${username}:${password}` }
  )
  if (pr.type === 'error') throw new Error(pr.error?.message || 'Bitbucket API error')
  return {
    number: pr.id,
    title: pr.title,
    sourceBranch: pr.source.branch.name,
    destBranch: pr.destination.branch.name,
    author: pr.author.display_name,
    createdAt: pr.created_on,
    url: pr.links.html.href,
  }
}

export async function bitbucketPostComment(workspace: string, repo: string, prNum: number, body: string): Promise<void> {
  const { username, password } = getBitbucketAuth()
  const result = await request(
    `https://api.bitbucket.org/2.0/repositories/${workspace}/${repo}/pullrequests/${prNum}/comments`,
    { method: 'POST', auth: `${username}:${password}`, body: JSON.stringify({ content: { raw: body } }) }
  )
  if (result.type === 'error') throw new Error(result.error?.message || 'Failed to post comment')
}

// ─── GitLab ──────────────────────────────────────────────

export async function gitlabListPRs(workspace: string, repo: string): Promise<PRInfo[]> {
  const headers = getAuthHeaders('gitlab') as Record<string, string>
  const projectPath = encodeURIComponent(`${workspace}/${repo}`)
  const data = await request(
    `https://gitlab.com/api/v4/projects/${projectPath}/merge_requests?state=opened&per_page=20`,
    { headers }
  )
  if (!Array.isArray(data)) return []
  return data.map((mr: any) => ({
    number: mr.iid,
    title: mr.title,
    sourceBranch: mr.source_branch,
    destBranch: mr.target_branch,
    author: mr.author.name,
    createdAt: mr.created_at,
    url: mr.web_url,
  }))
}

export async function gitlabGetPR(workspace: string, repo: string, prNum: number): Promise<PRInfo> {
  const headers = getAuthHeaders('gitlab') as Record<string, string>
  const projectPath = encodeURIComponent(`${workspace}/${repo}`)
  const mr = await request(
    `https://gitlab.com/api/v4/projects/${projectPath}/merge_requests/${prNum}`,
    { headers }
  )
  if (mr.message) throw new Error(`GitLab API: ${mr.message}`)
  return {
    number: mr.iid,
    title: mr.title,
    sourceBranch: mr.source_branch,
    destBranch: mr.target_branch,
    author: mr.author.name,
    createdAt: mr.created_at,
    url: mr.web_url,
  }
}

export async function gitlabPostComment(workspace: string, repo: string, prNum: number, body: string): Promise<void> {
  const headers = getAuthHeaders('gitlab') as Record<string, string>
  const projectPath = encodeURIComponent(`${workspace}/${repo}`)
  await request(
    `https://gitlab.com/api/v4/projects/${projectPath}/merge_requests/${prNum}/notes`,
    { method: 'POST', headers, body: JSON.stringify({ body }) }
  )
}

// ─── Credential Verification ────────────────────────────

export async function verifyCredentials(forge: string, workspace?: string, repo?: string): Promise<void> {
  if (forge === 'github') {
    const headers = getAuthHeaders('github') as Record<string, string>
    const data = await request('https://api.github.com/user', { headers, timeout: 10_000 })
    if (data.message) throw new Error(`GitHub: ${data.message}`)
    if (!data.login) throw new Error('GitHub: unexpected response')
  } else if (forge === 'bitbucket') {
    const { username, password } = getBitbucketAuth()
    // Verify against the PR endpoint (uses read:pullrequest scope) instead of
    // /2.0/user (which needs read:account scope that prai doesn't require)
    if (workspace && repo) {
      const data = await request(
        `https://api.bitbucket.org/2.0/repositories/${workspace}/${repo}/pullrequests?pagelen=1`,
        { auth: `${username}:${password}`, timeout: 10_000 }
      )
      if (data.type === 'error') throw new Error(data.error?.message || 'Bitbucket: authentication failed')
    } else {
      // No repo context — verify against workspaces endpoint
      const data = await request('https://api.bitbucket.org/2.0/workspaces?pagelen=1', {
        auth: `${username}:${password}`,
        timeout: 10_000,
      })
      if (data.type === 'error') throw new Error(data.error?.message || 'Bitbucket: authentication failed')
    }
  } else if (forge === 'gitlab') {
    const headers = getAuthHeaders('gitlab') as Record<string, string>
    const data = await request('https://gitlab.com/api/v4/user', { headers, timeout: 10_000 })
    if (data.message) throw new Error(`GitLab: ${data.message}`)
    if (!data.id) throw new Error('GitLab: unexpected response')
  }
}

// ─── Unified API ─────────────────────────────────────────

export async function listPRs(forge: string, workspace: string, repo: string): Promise<PRInfo[]> {
  if (forge === 'github') return githubListPRs(workspace, repo)
  if (forge === 'bitbucket') return bitbucketListPRs(workspace, repo)
  if (forge === 'gitlab') return gitlabListPRs(workspace, repo)
  throw new Error(`Unsupported forge: ${forge}`)
}

export async function getPR(forge: string, workspace: string, repo: string, prNum: number): Promise<PRInfo> {
  if (forge === 'github') return githubGetPR(workspace, repo, prNum)
  if (forge === 'bitbucket') return bitbucketGetPR(workspace, repo, prNum)
  if (forge === 'gitlab') return gitlabGetPR(workspace, repo, prNum)
  throw new Error(`Unsupported forge: ${forge}`)
}

export async function postComment(forge: string, workspace: string, repo: string, prNum: number, body: string): Promise<void> {
  if (forge === 'github') return githubPostComment(workspace, repo, prNum, body)
  if (forge === 'bitbucket') return bitbucketPostComment(workspace, repo, prNum, body)
  if (forge === 'gitlab') return gitlabPostComment(workspace, repo, prNum, body)
  throw new Error(`Unsupported forge: ${forge}`)
}
