import prompts from 'prompts'
import chalk from 'chalk'
import { loadCredentials, saveCredentials, type Credentials } from './credentials.js'
import { detectForge } from './forge.js'
import { printBanner, printSuccess, printError, printInfo } from './ui.js'

export async function runInit(): Promise<void> {
  printBanner()
  console.log(chalk.bold('Setup your forge credentials\n'))

  // Detect forge from current repo (optional — user might run init outside a repo)
  let detectedForge: string | null = null
  try {
    const info = detectForge()
    detectedForge = info.forge
    printInfo(`Detected ${info.forge} repo: ${info.workspace}/${info.repo}`)
    console.log()
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

  if (forge === 'github') {
    await setupGithub(existing)
  } else if (forge === 'bitbucket') {
    await setupBitbucket(existing)
  } else if (forge === 'gitlab') {
    await setupGitlab(existing)
  }

  // Check Claude Code CLI
  console.log()
  printInfo('Checking Claude Code CLI...')
  try {
    const { execSync } = await import('child_process')
    execSync('which claude', { stdio: 'pipe' })
    printSuccess('Claude Code CLI found')
  } catch {
    console.log(chalk.yellow('  Claude Code CLI not found.'))
    console.log(chalk.yellow('  Install from: https://claude.ai/download'))
    console.log(chalk.yellow('  Then run: claude login'))
  }

  console.log()
  printSuccess('Setup complete! Run `prai review` in any repo to review a PR.')
}

async function setupGithub(creds: Credentials): Promise<void> {
  console.log()
  console.log(chalk.dim('  Create a token at: https://github.com/settings/tokens'))
  console.log(chalk.dim('  Scope needed: repo (read)'))
  console.log()

  const { token } = await prompts({
    type: 'password',
    name: 'token',
    message: 'GitHub personal access token:',
    validate: (v: string) => v.length > 0 || 'Token is required',
  })

  if (!token) return

  creds.github = { token }
  saveCredentials(creds)
  printSuccess('GitHub credentials saved to ~/.prai/credentials.json')
}

async function setupBitbucket(creds: Credentials): Promise<void> {
  console.log()
  console.log(chalk.dim('  Create an API token at: https://bitbucket.org/account/settings/api-tokens/'))
  console.log(chalk.dim('  (NOT from id.atlassian.com — must be Bitbucket settings page)'))
  console.log(chalk.dim('  Scopes: Repositories (Read), Pull requests (Read, Write)'))
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
    message: 'Bitbucket API token:',
    validate: (v: string) => v.length > 0 || 'Token is required',
  })

  if (!api_token) return

  creds.bitbucket = { email, api_token }
  saveCredentials(creds)
  printSuccess('Bitbucket credentials saved to ~/.prai/credentials.json')
}

async function setupGitlab(creds: Credentials): Promise<void> {
  console.log()
  console.log(chalk.dim('  Create a token at: https://gitlab.com/-/user_settings/personal_access_tokens'))
  console.log(chalk.dim('  Scope needed: read_api'))
  console.log()

  const { token } = await prompts({
    type: 'password',
    name: 'token',
    message: 'GitLab personal access token:',
    validate: (v: string) => v.length > 0 || 'Token is required',
  })

  if (!token) return

  creds.gitlab = { token }
  saveCredentials(creds)
  printSuccess('GitLab credentials saved to ~/.prai/credentials.json')
}
