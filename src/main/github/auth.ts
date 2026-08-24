import type { AuthState } from '../../shared/types'
import { clearGitHubToken, getAuthMeta, getGitHubToken, setAuthLogin, setGitHubToken } from '../store'
import { restGet } from './client'

export async function authState(): Promise<AuthState> {
  if (!getGitHubToken()) return { authenticated: false }
  const meta = getAuthMeta()
  if (!meta.login) {
    try {
      const me = await restGet<{ login: string }>('/user')
      if (me.data) {
        setAuthLogin(me.data.login)
        meta.login = me.data.login
      }
    } catch {
      return { authenticated: false }
    }
  }
  return { authenticated: true, login: meta.login }
}

export async function setPat(token: string): Promise<AuthState> {
  const trimmed = token.trim()
  let res: Response
  try {
    res = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${trimmed}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'top-goose',
      },
    })
  } catch (err) {
    return { authenticated: false, error: `Could not reach GitHub: ${err instanceof Error ? err.message : err}` }
  }
  if (!res.ok) return { authenticated: false, error: `GitHub rejected the token (${res.status}).` }
  const me = (await res.json()) as { login: string }

  // Classic tokens list their scopes; fine-grained PATs send no header and
  // cannot be checked up front. Boards need `project` (write — read:project
  // cannot change Status/snooze), and everything else needs `repo`.
  const scopeHeader = res.headers.get('x-oauth-scopes')
  if (scopeHeader !== null) {
    const scopes = scopeHeader.split(',').map((s) => s.trim())
    const missing = ['repo', 'project'].filter((s) => !scopes.includes(s))
    if (missing.length > 0) {
      return {
        authenticated: false,
        error:
          `Token is missing the ${missing.map((s) => `'${s}'`).join(' and ')} scope${missing.length > 1 ? 's' : ''}. ` +
          `If you use the GitHub CLI, run:\n\ngh auth refresh -s ${missing.join(' -s ')} && gh auth token\n\n` +
          `then paste the new token. (Or create a classic token with repo, project, and notifications at github.com/settings/tokens.)`,
      }
    }
  }

  setGitHubToken(trimmed, me.login)
  return { authenticated: true, login: me.login }
}

export function signOut(): AuthState {
  clearGitHubToken()
  return { authenticated: false }
}
