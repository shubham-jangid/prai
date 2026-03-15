import { readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync, unlinkSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

const CREDS_DIR = join(homedir(), '.prai')
const CREDS_FILE = join(CREDS_DIR, 'credentials.json')

export interface GithubCreds {
  token: string
}

export interface BitbucketCreds {
  email: string
  api_token: string
}

export interface BitbucketLegacyCreds {
  username: string
  app_password: string
}

export interface GitlabCreds {
  token: string
}

export interface Credentials {
  github?: GithubCreds
  bitbucket?: BitbucketCreds | BitbucketLegacyCreds
  gitlab?: GitlabCreds
}

export function loadCredentials(): Credentials | null {
  if (!existsSync(CREDS_FILE)) return null
  try {
    return JSON.parse(readFileSync(CREDS_FILE, 'utf-8'))
  } catch {
    return null
  }
}

export function saveCredentials(creds: Credentials): void {
  mkdirSync(CREDS_DIR, { recursive: true, mode: 0o700 })
  chmodSync(CREDS_DIR, 0o700) // Ensure dir is owner-only even if it existed
  writeFileSync(CREDS_FILE, JSON.stringify(creds, null, 2))
  chmodSync(CREDS_FILE, 0o600) // Owner read/write only
}

export function deleteCredentials(forge?: string): boolean {
  const creds = loadCredentials()
  if (!creds) return false

  if (forge) {
    // Delete specific forge credentials
    if (forge === 'github') delete creds.github
    else if (forge === 'bitbucket') delete creds.bitbucket
    else if (forge === 'gitlab') delete creds.gitlab
    else return false

    // If all forges removed, delete the file
    if (!creds.github && !creds.bitbucket && !creds.gitlab) {
      try { unlinkSync(CREDS_FILE) } catch { /* ignore */ }
      return true
    }
    saveCredentials(creds)
    return true
  }

  // Delete all credentials
  try { unlinkSync(CREDS_FILE) } catch { /* ignore */ }
  return true
}

export function getCredentialsPath(): string {
  return CREDS_FILE
}

export function hasCredentials(forge: string): boolean {
  const creds = loadCredentials()
  if (!creds) return false
  if (forge === 'github') return !!creds.github?.token
  if (forge === 'bitbucket') {
    const bb = creds.bitbucket as any
    return !!(bb?.api_token || bb?.app_password)
  }
  if (forge === 'gitlab') return !!creds.gitlab?.token
  return false
}

export function getAuthHeaders(forge: string): Record<string, string> | { auth: string } {
  const creds = loadCredentials()
  if (!creds) throw new Error('No credentials found. Run: prai init')

  if (forge === 'github') {
    if (!creds.github?.token) throw new Error('No GitHub token. Run: prai init')
    return { Authorization: `Bearer ${creds.github.token}`, Accept: 'application/vnd.github.v3+json' }
  }

  if (forge === 'gitlab') {
    if (!creds.gitlab?.token) throw new Error('No GitLab token. Run: prai init')
    return { 'PRIVATE-TOKEN': creds.gitlab.token }
  }

  throw new Error(`Unsupported forge: ${forge}`)
}

export function getBitbucketAuth(): { username: string; password: string } {
  const creds = loadCredentials()
  if (!creds?.bitbucket) throw new Error('No Bitbucket credentials. Run: prai init')

  const bb = creds.bitbucket as any
  if (bb.api_token && bb.email) {
    return { username: bb.email, password: bb.api_token }
  }
  if (bb.app_password && bb.username) {
    return { username: bb.username, password: bb.app_password }
  }
  throw new Error('Invalid Bitbucket credentials. Run: prai init')
}
