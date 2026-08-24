import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IssueComment, IssueDetail } from '../src/shared/types'

const invoke = vi.fn()
vi.stubGlobal('window', {
  topGoose: {
    invoke,
    on: vi.fn(() => () => undefined),
  },
})

const { useStore } = await import('../src/renderer/src/store')

function issue(nodeId: string, issueNumber: number): IssueDetail {
  return {
    repo: 'owner/repo',
    issueNumber,
    nodeId,
    title: `Issue ${issueNumber}`,
    state: 'open',
    author: 'author',
    assignees: [],
    labels: [],
    body: 'body',
    bodyUpdatedAt: '2026-01-01T00:00:00Z',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    comments: [],
    availableStatuses: [],
  }
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

beforeEach(() => {
  invoke.mockReset()
  useStore.setState({
    rows: [],
    selectedNodeId: null,
    issue: null,
    issueLoading: false,
    issueError: null,
    composers: {},
    gooseChats: {},
    view: 'main',
  })
})

describe('issue selection', () => {
  it('clears the old transcript before targeting the new issue', async () => {
    const nextIssue = deferred<IssueDetail>()
    invoke.mockImplementation((channel: string) => {
      if (channel === 'issue:open') return nextIssue.promise
      if (channel === 'session:open') {
        return Promise.resolve({ issueNodeId: 'B', messages: [], busy: false, noWorkspace: false })
      }
      if (channel === 'draft:take') return Promise.resolve(null)
      return Promise.resolve()
    })
    useStore.setState({ selectedNodeId: 'A', issue: issue('A', 1) })

    const selecting = useStore.getState().selectIssue('B')

    expect(useStore.getState().selectedNodeId).toBe('B')
    expect(useStore.getState().issue).toBeNull()

    nextIssue.resolve(issue('B', 2))
    await selecting
    expect(useStore.getState().issue?.nodeId).toBe('B')
  })

  it('keeps a pending draft when navigation changes during retrieval', async () => {
    const pendingDraft = deferred<{ issueNodeId: string; text: string; createdAt: string } | null>()
    invoke.mockImplementation((channel: string) => {
      if (channel === 'issue:open') return Promise.resolve(issue('B', 2))
      if (channel === 'session:open') {
        return Promise.resolve({ issueNodeId: 'B', messages: [], busy: false, noWorkspace: false })
      }
      if (channel === 'draft:take') return pendingDraft.promise
      return Promise.resolve()
    })

    const selecting = useStore.getState().selectIssue('B')
    await Promise.resolve()
    useStore.setState({ selectedNodeId: 'C', issue: issue('C', 3) })
    pendingDraft.resolve({ issueNodeId: 'B', text: 'draft for B', createdAt: '2026-01-01T00:00:00Z' })
    await selecting

    expect(useStore.getState().composers.B?.text).toBe('draft for B')
    expect(useStore.getState().selectedNodeId).toBe('C')
  })

  it('ignores private state that finishes loading after an account reset', async () => {
    const issueLoad = deferred<IssueDetail>()
    const sessionLoad = deferred<{
      issueNodeId: string
      messages: []
      busy: boolean
      noWorkspace: boolean
    }>()
    invoke.mockImplementation((channel: string) => {
      if (channel === 'issue:open') return issueLoad.promise
      if (channel === 'session:open') return sessionLoad.promise
      if (channel === 'draft:take') return Promise.resolve(null)
      return Promise.resolve()
    })

    const selecting = useStore.getState().selectIssue('B')
    useStore.setState((state) => ({
      selectedNodeId: null,
      issue: null,
      gooseChats: {},
      generation: state.generation + 1,
    }))
    sessionLoad.resolve({ issueNodeId: 'B', messages: [], busy: false, noWorkspace: false })
    issueLoad.resolve(issue('B', 2))
    await selecting
    await Promise.resolve()

    expect(useStore.getState().issue).toBeNull()
    expect(useStore.getState().gooseChats.B).toBeUndefined()
  })

})

describe('GitHub replies', () => {
  it('allows only one in-flight post and preserves issue identity', async () => {
    const posted = deferred<IssueComment>()
    invoke.mockImplementation((channel: string) => {
      if (channel === 'issue:reply') return posted.promise
      return Promise.resolve()
    })
    useStore.setState({
      selectedNodeId: 'B',
      issue: issue('B', 2),
      composers: { B: { text: 'hello', dirty: true, sending: false } },
    })

    const first = useStore.getState().reply()
    const second = useStore.getState().reply()
    expect(invoke.mock.calls.filter(([channel]) => channel === 'issue:reply')).toHaveLength(1)

    posted.resolve({
      id: 10,
      nodeId: 'comment-10',
      author: 'me',
      body: 'hello',
      createdAt: '2026-01-01T00:00:01Z',
      updatedAt: '2026-01-01T00:00:01Z',
    })
    await Promise.all([first, second])
    expect(useStore.getState().issue?.comments).toHaveLength(1)
    expect(useStore.getState().composers.B?.text).toBe('')
  })
})
