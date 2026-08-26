import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IssueComment, IssueDetail, PullRequestDetail } from '../src/shared/types'

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

function pullRequest(nodeId: string, number: number): PullRequestDetail {
  return {
    repo: 'owner/repo',
    pullRequestNumber: number,
    nodeId,
    title: `Pull request ${number}`,
    state: 'open',
    merged: false,
    author: 'author',
    assignees: [],
    labels: [],
    body: 'body',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    isDraft: false,
    baseRefName: 'main',
    headRefName: 'feature',
    mergeable: 'MERGEABLE',
    requestedReviewers: [],
    comments: [],
    reviews: [],
    reviewThreads: [],
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
    conversationKind: 'issue',
    pullRequestFilters: [],
    pullRequestStateFilter: null,
    workflowStatusFilter: null,
    selectedNodeId: null,
    issue: null,
    pullRequest: null,
    issueLoading: false,
    issueError: null,
    assigneeSaving: false,
    pullRequestLoading: false,
    pullRequestError: null,
    approvalSaving: false,
    closingPullRequest: false,
    composers: {},
    gooseChats: {},
    gooseInputs: {},
    view: 'main',
  })
})

describe('Goose prompt input', () => {
  it('stores a separate draft prompt for each conversation', () => {
    useStore.getState().setGooseInput('issue-a', 'Fix the issue')
    useStore.getState().setGooseInput('pr-b', 'Review the PR')

    expect(useStore.getState().gooseInputs).toEqual({
      'issue-a': 'Fix the issue',
      'pr-b': 'Review the PR',
    })
  })
})

describe('pull request selection', () => {
  it('loads the PR and its persistent Goose session independently', async () => {
    invoke.mockImplementation((channel: string) => {
      if (channel === 'pullRequest:open') return Promise.resolve(pullRequest('PR', 7))
      if (channel === 'session:open') {
        return Promise.resolve({
          issueNodeId: 'PR',
          sessionId: 'goose-session',
          messages: [{ role: 'agent', id: 'old', text: 'Previous thinking', toolCalls: [] }],
          busy: false,
          noWorkspace: false,
        })
      }
      if (channel === 'draft:take') return Promise.resolve(null)
      return Promise.resolve()
    })
    useStore.setState({ conversationKind: 'pullRequest' })

    await useStore.getState().selectPullRequest('PR')
    await Promise.resolve()

    expect(useStore.getState().pullRequest?.pullRequestNumber).toBe(7)
    expect(useStore.getState().gooseChats.PR?.messages).toEqual([
      expect.objectContaining({ text: 'Previous thinking' }),
    ])
  })

  it('refreshes review state after approving', async () => {
    invoke.mockImplementation((channel: string) => {
      if (channel === 'pullRequest:approve') {
        return Promise.resolve({ ...pullRequest('PR', 7), viewerReviewState: 'APPROVED' })
      }
      return Promise.resolve()
    })
    useStore.setState({
      conversationKind: 'pullRequest',
      selectedNodeId: 'PR',
      pullRequest: pullRequest('PR', 7),
    })

    await useStore.getState().approvePullRequest()

    expect(invoke).toHaveBeenCalledWith('pullRequest:approve', 'PR')
    expect(useStore.getState().pullRequest?.viewerReviewState).toBe('APPROVED')
    expect(useStore.getState().approvalSaving).toBe(false)
  })

  it('closes the pull request and removes it from the open sidebar', async () => {
    invoke.mockResolvedValue(undefined)
    const current = pullRequest('PR', 7)
    useStore.setState({
      conversationKind: 'pullRequest',
      rows: [
        {
          kind: 'pullRequest',
          repo: 'owner/repo',
          issueNumber: 7,
          nodeId: 'PR',
          title: 'Pull request 7',
          state: 'open',
          commentCount: 0,
          updatedAt: '2026-01-01T00:00:00Z',
          hydratedAt: '2026-01-01T00:00:00Z',
        },
      ],
      selectedNodeId: 'PR',
      pullRequest: current,
    })

    await useStore.getState().closePullRequest()

    expect(invoke).toHaveBeenCalledWith('pullRequest:close', 'PR')
    expect(useStore.getState().pullRequest?.state).toBe('closed')
    expect(useStore.getState().rows).toEqual([])
    expect(useStore.getState().closingPullRequest).toBe(false)
  })

  it('keeps another pull request session running when navigation changes', async () => {
    invoke.mockImplementation((channel: string) => {
      if (channel === 'pullRequest:open') return Promise.resolve(pullRequest('B', 8))
      if (channel === 'draft:take') return Promise.resolve(null)
      return Promise.resolve()
    })
    useStore.setState({
      conversationKind: 'pullRequest',
      selectedNodeId: 'A',
      pullRequest: pullRequest('A', 7),
      gooseChats: {
        A: { messages: [], busy: true, noWorkspace: false, loaded: true },
        B: { messages: [], busy: false, noWorkspace: false, loaded: true },
      },
    })

    await useStore.getState().selectPullRequest('B')

    expect(useStore.getState().gooseChats.A?.busy).toBe(true)
    expect(invoke).not.toHaveBeenCalledWith('session:cancel', 'A')
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

  it('keeps a Goose draft that arrives while an issue reply is posting', async () => {
    const posted = deferred<IssueComment>()
    invoke.mockImplementation((channel: string) => {
      if (channel === 'issue:reply') return posted.promise
      return Promise.resolve()
    })
    useStore.setState({
      selectedNodeId: 'B',
      issue: issue('B', 2),
      composers: { B: { text: 'my reply', dirty: true, sending: false } },
    })

    const posting = useStore.getState().reply()
    useStore.setState((state) => ({
      composers: {
        ...state.composers,
        B: { ...state.composers.B, offeredDraft: 'new Goose draft' },
      },
    }))
    posted.resolve({
      id: 11,
      nodeId: 'comment-11',
      author: 'me',
      body: 'my reply',
      createdAt: '2026-01-01T00:00:01Z',
      updatedAt: '2026-01-01T00:00:01Z',
    })
    await posting

    expect(useStore.getState().composers.B).toEqual(
      expect.objectContaining({ text: '', offeredDraft: 'new Goose draft' }),
    )
  })

  it('keeps a Goose draft that arrives while a pull request reply is posting', async () => {
    const posted = deferred<IssueComment>()
    invoke.mockImplementation((channel: string) => {
      if (channel === 'pullRequest:reply') return posted.promise
      return Promise.resolve()
    })
    useStore.setState({
      conversationKind: 'pullRequest',
      selectedNodeId: 'PR',
      pullRequest: pullRequest('PR', 7),
      composers: { PR: { text: 'my reply', dirty: true, sending: false } },
    })

    const posting = useStore.getState().replyToPullRequest()
    useStore.setState((state) => ({
      composers: {
        ...state.composers,
        PR: { ...state.composers.PR, offeredDraft: 'new Goose draft' },
      },
    }))
    posted.resolve({
      id: 12,
      nodeId: 'comment-12',
      author: 'me',
      body: 'my reply',
      createdAt: '2026-01-01T00:00:01Z',
      updatedAt: '2026-01-01T00:00:01Z',
    })
    await posting

    expect(useStore.getState().composers.PR).toEqual(
      expect.objectContaining({ text: '', offeredDraft: 'new Goose draft' }),
    )
  })
})

describe('GitHub assignees', () => {
  it('rolls back the displayed assignee when GitHub rejects the change', async () => {
    invoke.mockImplementation((channel: string) => {
      if (channel === 'issue:setAssignee') return Promise.reject(new Error('not assignable'))
      return Promise.resolve()
    })
    useStore.setState({
      selectedNodeId: 'B',
      issue: { ...issue('B', 2), assignees: ['DOsinga'] },
    })

    const changing = useStore.getState().setAssignee('jbg')
    expect(useStore.getState().issue?.assignees).toEqual(['jbg'])
    expect(useStore.getState().assigneeSaving).toBe(true)
    expect(invoke).toHaveBeenCalledWith('issue:setAssignee', 'B', 'jbg')

    await changing

    expect(useStore.getState().issue?.assignees).toEqual(['DOsinga'])
    expect(useStore.getState().assigneeSaving).toBe(false)
    expect(useStore.getState().issueError).toBe('not assignable')
  })
})
