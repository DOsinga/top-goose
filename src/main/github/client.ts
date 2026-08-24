import type { RateBudget } from '../../shared/types'
import { getGitHubToken } from '../store'

const API = 'https://api.github.com'

/**
 * Below this many remaining GraphQL points the app degrades: it keeps
 * serving cached rows and stops hydrating non-visible ones.
 */
const BUDGET_FLOOR = 100

export class GitHubError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message)
  }
}

/** GitHub rejects the whole query (data: null) when a field needs a missing scope. */
export function isProjectScopeError(err: unknown): boolean {
  return err instanceof GitHubError && err.message.includes("'read:project'")
}

function authHeaders(): Record<string, string> {
  const token = getGitHubToken()
  if (!token) throw new GitHubError('not authenticated with GitHub', 401)
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'top-goose',
  }
}

// ---------- REST ----------

export type RestResponse<T> = {
  status: number
  etag?: string
  pollInterval?: number
  data: T | null
}

/**
 * Conditional GET: pass the previous ETag and a 304 costs nothing against
 * the primary rate limit. 304 returns data: null.
 */
export async function restGet<T>(pathname: string, etag?: string): Promise<RestResponse<T>> {
  const headers = authHeaders()
  if (etag) headers['If-None-Match'] = etag
  const res = await fetch(`${API}${pathname}`, { headers })
  const pollHeader = res.headers.get('X-Poll-Interval')
  const out: RestResponse<T> = {
    status: res.status,
    etag: res.headers.get('ETag') ?? undefined,
    pollInterval: pollHeader ? parseInt(pollHeader, 10) : undefined,
    data: null,
  }
  if (res.status === 304) return out
  if (!res.ok) throw new GitHubError(`GET ${pathname}: ${res.status} ${await res.text()}`, res.status)
  out.data = (await res.json()) as T
  return out
}

export async function restSend<T>(
  method: 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  pathname: string,
  body?: unknown,
): Promise<T | null> {
  const res = await fetch(`${API}${pathname}`, {
    method,
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!res.ok) throw new GitHubError(`${method} ${pathname}: ${res.status} ${await res.text()}`, res.status)
  if (res.status === 204 || res.status === 205) return null
  const text = await res.text()
  return text ? (JSON.parse(text) as T) : null
}

// ---------- GraphQL ----------

let budget: RateBudget | null = null
let budgetListener: ((b: RateBudget) => void) | null = null

export function onBudgetChange(listener: (b: RateBudget) => void): void {
  budgetListener = listener
}

export function getBudget(): RateBudget | null {
  return budget
}

export function budgetDegraded(): boolean {
  return budget !== null && budget.degraded
}

const RATE_LIMIT_FIELD = 'rateLimit { cost remaining limit resetAt }'

type GraphQLRateLimit = { cost: number; remaining: number; limit: number; resetAt: string }

/**
 * Every query carries rateLimit { cost remaining resetAt } so cost is
 * observable rather than assumed.
 */
export async function graphql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  // splice the rateLimit field into the operation's top-level selection set
  // (the first "{" — not the document's last "}", which may close a fragment);
  // Mutation has no rateLimit field, so mutations go out untouched
  const isQuery = /^\s*(query\b|\{)/.test(query)
  const withRate = isQuery ? query.replace('{', `{ ${RATE_LIMIT_FIELD} `) : query
  const res = await fetch(`${API}/graphql`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: withRate, variables }),
  })
  if (!res.ok) throw new GitHubError(`graphql: ${res.status} ${await res.text()}`, res.status)
  const payload = (await res.json()) as {
    data?: T & { rateLimit?: GraphQLRateLimit }
    errors?: { message: string }[]
  }
  if (payload.errors?.length && !payload.data) {
    throw new GitHubError(`graphql: ${payload.errors.map((e) => e.message).join('; ')}`, 200)
  }
  if (payload.errors?.length) {
    // partial response, e.g. a PAT without read:project scope: use what came
    // back and log the rest
    console.warn(`[graphql] ${payload.errors.length} partial error(s), first:`, payload.errors[0]?.message)
  }
  const rl = payload.data?.rateLimit
  if (rl) {
    budget = {
      remaining: rl.remaining,
      limit: rl.limit,
      resetAt: rl.resetAt,
      lastCost: rl.cost,
      degraded: rl.remaining < BUDGET_FLOOR,
    }
    console.log(`[graphql] cost=${rl.cost} remaining=${rl.remaining} resetAt=${rl.resetAt}`)
    budgetListener?.(budget)
  }
  if (!payload.data) throw new GitHubError('graphql: empty response', 200)
  return payload.data
}
