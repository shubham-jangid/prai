import prompts from 'prompts'
import chalk from 'chalk'
import { loadCredentials, saveCredentials, getCredentialsPath, type Credentials } from './credentials.js'
import { detectForge, detectForgeAsync, ForgeDetectionNeeded } from './forge.js'
import { verifyCredentials } from './api.js'
import { printBanner, printSuccess, printError, printInfo, spinner } from './ui.js'

export async function runInit(): Promise<void> {
  printBanner()
  console.log(chalk.bold('Setup your forge credentials\n'))

  // Detect forge from current repo (optional — user might run init outside a repo)
  let detectedForge: string | null = null
  let detectedHostname: string | undefined
  let detectedWorkspace: string | undefined
  let detectedRepo: string | undefined
  try {
    let info
    try {
      info = detectForge()
    } catch (err: any) {
      if (err instanceof ForgeDetectionNeeded) {
        const s = spinner(`Probing ${err.hostname} to detect forge type...`)
        try {
          info = await detectForgeAsync(err.hostname, err.pathPart, err.remoteUrl)
          s.succeed(`Detected ${info.forge} (${info.hostname})`)
        } catch {
          s.warn(`Could not detect forge for ${err.hostname} — select manually below`)
        }
      } else {
        throw err
      }
    }
    if (info) {
      detectedForge = info.forge
      detectedHostname = info.hostname
      detectedWorkspace = info.workspace
      detectedRepo = info.repo
      const isSelfHosted = !['github.com', 'gitlab.com', 'bitbucket.org'].includes(info.hostname)
      const hostLabel = isSelfHosted ? ` (${info.hostname})` : ''
      printInfo(`Detected ${info.forge}${hostLabel} repo: ${info.workspace}/${info.repo}`)
      console.log()
    }
  } catch {
    // Not in a git repo — that's fine, user can still configure
  }

  const forgeChoices = [
    { title: 'GitHub', value: 'github' },
    { title: 'Bitbucket', value: 'bitbucket' },
    { title: 'GitLab', value: 'gitlab' },
  ]

  // If we detected a forge, put it first
  if (detectedForge) {
    const idx = forgeChoices.findIndex(c => c.value === detectedForge)
    if (idx > 0) {
      const [item] = forgeChoices.splice(idx, 1)
      forgeChoices.unshift(item)
    }
  }

  const { forge } = await prompts({
    type: 'select',
    name: 'forge',
    message: 'Which forge do you want to configure?',
    choices: forgeChoices,
  })

  if (!forge) return // User cancelled

  const existing = loadCredentials() || ({} as Credentials)
  const hostname = forge === detectedForge ? detectedHostname : undefined
  const workspace = forge === detectedForge ? detectedWorkspace : undefined
  const repo = forge === detectedForge ? detectedRepo : undefined

  if (forge === 'github') {
    await setupGithub(existing, hostname, workspace, repo)
  } else if (forge === 'bitbucket') {
    await setupBitbucket(existing, hostname, workspace, repo)
  } else if (forge === 'gitlab') {
    await setupGitlab(existing, hostname, workspace, repo)
  }
}

// ─── GitHub ──────────────────────────────────────────────

async function setupGithub(creds: Credentials, hostname?: string, workspace?: string, repo?: string): Promise<void> {
  const isSelfHosted = hostname && hostname !== 'github.com'
  while (true) {
    console.log()
    if (isSelfHosted) {
      console.log(chalk.dim(`  GitHub Enterprise: ${hostname}`))
      console.log(chalk.dim(`  Create a token at: https://${hostname}/settings/tokens`))
    } else {
      console.log(chalk.dim('  Create a token at: https://github.com/settings/tokens'))
    }
    console.log(chalk.dim('  Scope needed: repo (read)'))
    console.log()

    const { token } = await prompts({
      type: 'password',
      name: 'token',
      message: isSelfHosted ? `GitHub Enterprise (${hostname}) token:` : 'GitHub personal access token:',
      validate: (v: string) => v.length > 0 || 'Token is required',
    })

    if (!token) return

    creds.github = { token }
    const verified = await verifyAndReport('github', creds, hostname, workspace, repo)
    if (verified) return

    printAuthHelp('github')

    const { retry } = await prompts({
      type: 'confirm',
      name: 'retry',
      message: 'Try again with a different token?',
      initial: true,
    })

    if (!retry) return
  }
}

// ─── Bitbucket ───────────────────────────────────────────

async function setupBitbucket(creds: Credentials, hostname?: string, workspace?: string, repo?: string): Promise<void> {
  while (true) {
    console.log()
    console.log(chalk.dim('  Create an API token at: https://id.atlassian.com/manage-profile/security/api-tokens'))
    console.log(chalk.dim('  Click "Create API token with scopes"'))
    console.log(chalk.dim('  Required scopes: read:pullrequest:bitbucket, write:pullrequest:bitbucket'))
    console.log()

    const { email } = await prompts({
      type: 'text',
      name: 'email',
      message: 'Atlassian email:',
      validate: (v: string) => v.includes('@') || 'Enter a valid email',
    })

    if (!email) return

    const { api_token } = await prompts({
      type: 'password',
      name: 'api_token',
      message: 'Atlassian API token:',
      validate: (v: string) => v.length > 0 || 'Token is required',
    })

    if (!api_token) return

    creds.bitbucket = { email, api_token }
    const verified = await verifyAndReport('bitbucket', creds, hostname, workspace, repo)
    if (verified) return

    printAuthHelp('bitbucket')

    const { retry } = await prompts({
      type: 'confirm',
      name: 'retry',
      message: 'Try again with different credentials?',
      initial: true,
    })

    if (!retry) return
  }
}

// ─── GitLab ──────────────────────────────────────────────

async function setupGitlab(creds: Credentials, hostname?: string, workspace?: string, repo?: string): Promise<void> {
  const isSelfHosted = hostname && hostname !== 'gitlab.com'
  while (true) {
    console.log()
    if (isSelfHosted) {
      console.log(chalk.dim(`  Self-hosted GitLab: ${hostname}`))
      console.log(chalk.dim(`  Create a token at: https://${hostname}/-/user_settings/personal_access_tokens`))
    } else {
      console.log(chalk.dim('  Create a token at: https://gitlab.com/-/user_settings/personal_access_tokens'))
    }
    console.log(chalk.dim('  Scope needed: read_api'))
    console.log()

    const { token } = await prompts({
      type: 'password',
      name: 'token',
      message: isSelfHosted ? `GitLab (${hostname}) token:` : 'GitLab personal access token:',
      validate: (v: string) => v.length > 0 || 'Token is required',
    })

    if (!token) return

    creds.gitlab = { token }
    const verified = await verifyAndReport('gitlab', creds, hostname, workspace, repo)
    if (verified) return

    printAuthHelp('gitlab')

    const { retry } = await prompts({
      type: 'confirm',
      name: 'retry',
      message: 'Try again with a different token?',
      initial: true,
    })

    if (!retry) return
  }
}

// ─── Helpers ─────────────────────────────────────────────

async function verifyAndReport(forge: string, creds: Credentials, hostname?: string, workspace?: string, repo?: string): Promise<boolean> {
  console.log()
  const s = spinner('Verifying credentials...')
  try {
    // Temporarily save so getAuthHeaders/getBitbucketAuth can read them
    saveCredentials(creds)
    await verifyCredentials(forge, hostname, workspace, repo)
    s.succeed('Credentials verified — authentication successful')

    const path = getCredentialsPath()
    console.log(chalk.dim(`  Saved to ${path} (owner read/write only)`))
    console.log(chalk.dim(`  Your credentials never leave your machine`))
    console.log()
    printSuccess('Setup complete! Run `prai review` in any repo to review a PR.')
    return true
  } catch (err: any) {
    s.fail(`Authentication failed: ${err.message}`)
    // Remove the bad credentials we just saved
    deleteForgeCreds(forge, creds)
    saveCredentials(creds)
    return false
  }
}

function deleteForgeCreds(forge: string, creds: Credentials): void {
  if (forge === 'github') delete creds.github
  else if (forge === 'bitbucket') delete creds.bitbucket
  else if (forge === 'gitlab') delete creds.gitlab
}

function printAuthHelp(forge: string): void {
  console.log()
  if (forge === 'github') {
    console.log(chalk.yellow('  How to fix:'))
    console.log(chalk.yellow('  1. Go to https://github.com/settings/tokens'))
    console.log(chalk.yellow('  2. Click "Generate new token" (classic)'))
    console.log(chalk.yellow('  3. Select the "repo" scope'))
    console.log(chalk.yellow('  4. Copy the token and paste it here'))
  } else if (forge === 'bitbucket') {
    console.log(chalk.yellow('  How to fix:'))
    console.log(chalk.yellow('  1. Go to https://id.atlassian.com/manage-profile/security/api-tokens'))
    console.log(chalk.yellow('  2. Click "Create API token with scopes"'))
    console.log(chalk.yellow('  3. Select scopes: read:pullrequest:bitbucket, write:pullrequest:bitbucket'))
    console.log(chalk.yellow('  4. Select a workspace when prompted'))
    console.log(chalk.yellow('  5. Copy the token and paste it here'))
    console.log(chalk.yellow('  6. Make sure the email matches your Atlassian account'))
  } else if (forge === 'gitlab') {
    console.log(chalk.yellow('  How to fix:'))
    console.log(chalk.yellow('  1. Go to https://gitlab.com/-/user_settings/personal_access_tokens'))
    console.log(chalk.yellow('  2. Create a new token with "read_api" scope'))
    console.log(chalk.yellow('  3. Copy the token and paste it here'))
  }
  console.log()
}
