import { create } from 'zustand'
import type {
  AuthState,
  CachedRow,
  ConversationKind,
  GooseMessage,
  GooseStreamEvent,
  GooseToolCall,
  IssueDetail,
  PendingDraft,
  PullRequestDetail,
  RateBudget,
} from '../../shared/types'

const api = window.topGoose

export type ComposerState = {
  text: string
  /** user has typed/edited since a draft last populated it */
  dirty: boolean
  /** a draft arrived while the composer was dirty; offered above it */
  offeredDraft?: string
  sending: boolean
  error?: string
}

type GooseChat = {
  messages: GooseMessage[]
  busy: boolean
  noWorkspace: boolean
  error?: string
  loaded: boolean
}

export type SidebarFilter = 'unread' | 'unreplied' | 'assigned'
export type PullRequestFilter = 'reviewRequested' | 'assigned' | 'authored' | 'olderThan7Days' | 'unsolicited'
export type PullRequestStateFilter = 'ready' | 'draft' | 'approved' | 'changesRequested' | 'reviewRequired'

export type State = {
  auth: AuthState | null
  rows: CachedRow[]
  conversationKind: ConversationKind
  /** active filters combine with AND; none active shows everything */
  sidebarFilters: SidebarFilter[]
  workflowStatusFilter: string | null
  pullRequestFilters: PullRequestFilter[]
  pullRequestStateFilter: PullRequestStateFilter | null
  selectedNodeId: string | null
  issue: IssueDetail | null
  pullRequest: PullRequestDetail | null
  issueLoading: boolean
  issueError: string | null
  assigneeSaving: boolean
  pullRequestLoading: boolean
  pullRequestError: string | null
  approvalSaving: boolean
  composers: Record<string, ComposerState>
  gooseChats: Record<string, GooseChat>
  gooseInputs: Record<string, string>
  budget: RateBudget | null
  view: 'main' | 'settings'
  generation: number

  init: () => () => void
  selectIssue: (nodeId: string) => Promise<void>
  selectPullRequest: (nodeId: string) => Promise<void>
  refreshIssue: () => Promise<void>
  refreshPullRequest: () => Promise<void>
  reply: () => Promise<void>
  replyToPullRequest: () => Promise<void>
  approvePullRequest: () => Promise<void>
  setAssignee: (login: string | null) => Promise<void>
  setStatus: (status: string) => Promise<void>
  setSnooze: (date: string | null) => Promise<void>
  setComposerText: (nodeId: string, text: string, dirty: boolean) => void
  acceptOfferedDraft: (nodeId: string) => string | null
  discardOfferedDraft: (nodeId: string) => void
  promptGoose: (nodeId: string, text: string) => Promise<void>
  setGooseInput: (nodeId: string, text: string) => void
  cancelGoose: (nodeId: string) => void
  setView: (view: 'main' | 'settings') => void
  setAuth: (auth: AuthState) => void
  toggleSidebarFilter: (filter: SidebarFilter) => void
  setWorkflowStatusFilter: (status: string | null) => void
  setConversationKind: (kind: ConversationKind) => void
  togglePullRequestFilter: (filter: PullRequestFilter) => void
  setPullRequestStateFilter: (filter: PullRequestStateFilter | null) => void
}

const emptyComposer: ComposerState = { text: '', dirty: false, sending: false }

function sortRows(rows: CachedRow[]): CachedRow[] {
  // most recent update first; snoozed rows sink until their date passes
  const now = new Date().toISOString().slice(0, 10)
  return [...rows].sort((a, b) => {
    const aSnoozed = !!a.snoozedUntil && a.snoozedUntil > now
    const bSnoozed = !!b.snoozedUntil && b.snoozedUntil > now
    if (aSnoozed !== bSnoozed) return aSnoozed ? 1 : -1
    return a.updatedAt < b.updatedAt ? 1 : -1
  })
}

export const useStore = create<State>((set, get) => ({
  auth: null,
  rows: [],
  conversationKind: 'issue',
  sidebarFilters: [],
  workflowStatusFilter: null,
  pullRequestFilters: [],
  pullRequestStateFilter: null,
  selectedNodeId: null,
  issue: null,
  pullRequest: null,
  issueLoading: false,
  issueError: null,
  assigneeSaving: false,
  pullRequestLoading: false,
  pullRequestError: null,
  approvalSaving: false,
  composers: {},
  gooseChats: {},
  gooseInputs: {},
  budget: null,
  view: 'main',
  generation: 0,

  init: () => {
    void api.invoke('auth:state').then((auth) => {
      set({ auth })
      if (!auth.authenticated) set({ view: 'settings' })
    })
    void api.invoke('sidebar:rows').then((rows) => set({ rows: sortRows(rows) }))
    void api.invoke('budget:get').then((budget) => set({ budget }))

    // StrictMode mounts effects twice in dev; return a cleanup so listeners
    // never stack (a doubled push:goose listener doubles every stream chunk)
    const unsubscribers = [
      api.on('push:sidebar', (rows) => set({ rows: sortRows(rows) })),
      api.on('push:budget', (budget) => set({ budget })),
      api.on('push:auth', (auth) => get().setAuth(auth)),
      api.on('push:reset', () =>
        set((state) => ({
          rows: [],
          conversationKind: 'issue',
          workflowStatusFilter: null,
          pullRequestFilters: [],
          pullRequestStateFilter: null,
          selectedNodeId: null,
          issue: null,
          pullRequest: null,
          assigneeSaving: false,
          pullRequestLoading: false,
          pullRequestError: null,
          approvalSaving: false,
          composers: {},
          gooseChats: {},
          gooseInputs: {},
          generation: state.generation + 1,
        })),
      ),

      api.on('push:goose', (event: GooseStreamEvent) => {
        const chats = get().gooseChats
        const chat = chats[event.issueNodeId]
        if (!chat) return
        const next = applyStream(chat, event)
        set({ gooseChats: { ...chats, [event.issueNodeId]: next } })
      }),

      api.on('push:draft', (draft: PendingDraft) => {
        const { selectedNodeId, generation } = get()
        if (draft.issueNodeId !== selectedNodeId) return // waits as a pending draft on its row
        void api.invoke('draft:take', draft.issueNodeId).then((taken) => {
          if (taken && get().generation === generation) applyDraft(set, get, draft.issueNodeId, taken.text)
        })
      }),
    ]
    return () => unsubscribers.forEach((u) => u())
  },

  selectIssue: async (nodeId) => {
    const generation = get().generation
    set({
      selectedNodeId: nodeId,
      issue: null,
      pullRequest: null,
      issueLoading: true,
      issueError: null,
      assigneeSaving: false,
      view: 'main',
    })
    void api.invoke('issue:markRead', nodeId)

    // open the goose session in parallel with the issue fetch
    const chats = get().gooseChats
    if (!chats[nodeId]?.loaded || chats[nodeId]?.error) {
      set({
        gooseChats: {
          ...chats,
          [nodeId]: { messages: [], busy: false, noWorkspace: false, loaded: false },
        },
      })
      void api
        .invoke('session:open', nodeId)
        .then((view) => {
          set((s) =>
            s.generation !== generation
              ? s
              : {
                  gooseChats: {
                    ...s.gooseChats,
                    [nodeId]: {
                      messages: view.messages,
                      busy: view.busy,
                      noWorkspace: view.noWorkspace,
                      error: view.error,
                      loaded: true,
                    },
                  },
                },
          )
        })
        .catch((err: Error) => {
          set((s) =>
            s.generation !== generation
              ? s
              : {
                  gooseChats: {
                    ...s.gooseChats,
                    [nodeId]: {
                      messages: [],
                      busy: false,
                      noWorkspace: false,
                      error: err.message,
                      loaded: false,
                    },
                  },
                },
          )
        })
    }

    try {
      const issue = await api.invoke('issue:open', nodeId)
      if (get().generation === generation && get().selectedNodeId === nodeId) set({ issue, issueLoading: false })
    } catch (err) {
      if (get().generation === generation && get().selectedNodeId === nodeId) {
        set({ issueError: err instanceof Error ? err.message : String(err), issueLoading: false })
      }
    }

    // a draft that arrived while this issue was closed applies now
    const pending = await api.invoke('draft:take', nodeId)
    if (pending && get().generation === generation) applyDraft(set, get, nodeId, pending.text)
  },

  selectPullRequest: async (nodeId) => {
    const generation = get().generation
    set({
      selectedNodeId: nodeId,
      issue: null,
      pullRequest: null,
      pullRequestLoading: true,
      pullRequestError: null,
      approvalSaving: false,
      view: 'main',
    })
    void api.invoke('issue:markRead', nodeId)

    const chats = get().gooseChats
    if (!chats[nodeId]?.loaded || chats[nodeId]?.error) {
      set({
        gooseChats: {
          ...chats,
          [nodeId]: { messages: [], busy: false, noWorkspace: false, loaded: false },
        },
      })
      void api
        .invoke('session:open', nodeId)
        .then((view) => {
          set((state) =>
            state.generation !== generation
              ? state
              : {
                  gooseChats: {
                    ...state.gooseChats,
                    [nodeId]: {
                      messages: view.messages,
                      busy: view.busy,
                      noWorkspace: view.noWorkspace,
                      error: view.error,
                      loaded: true,
                    },
                  },
                },
          )
        })
        .catch((err: Error) => {
          set((state) =>
            state.generation !== generation
              ? state
              : {
                  gooseChats: {
                    ...state.gooseChats,
                    [nodeId]: {
                      messages: [],
                      busy: false,
                      noWorkspace: false,
                      error: err.message,
                      loaded: false,
                    },
                  },
                },
          )
        })
    }

    try {
      const pullRequest = await api.invoke('pullRequest:open', nodeId)
      if (get().generation === generation && get().selectedNodeId === nodeId) {
        set({ pullRequest, pullRequestLoading: false })
      }
    } catch (err) {
      if (get().generation === generation && get().selectedNodeId === nodeId) {
        set({
          pullRequestError: err instanceof Error ? err.message : String(err),
          pullRequestLoading: false,
        })
      }
    }

    const pending = await api.invoke('draft:take', nodeId)
    if (pending && get().generation === generation) applyDraft(set, get, nodeId, pending.text)
  },

  refreshIssue: async () => {
    const nodeId = get().selectedNodeId
    const generation = get().generation
    if (!nodeId) return
    const issue = await api.invoke('issue:open', nodeId)
    if (get().generation === generation && get().selectedNodeId === nodeId) set({ issue })
  },

  refreshPullRequest: async () => {
    const nodeId = get().selectedNodeId
    const generation = get().generation
    if (!nodeId) return
    const pullRequest = await api.invoke('pullRequest:open', nodeId)
    if (get().generation === generation && get().selectedNodeId === nodeId) set({ pullRequest })
  },

  reply: async () => {
    const { selectedNodeId, composers, issue } = get()
    const generation = get().generation
    if (!selectedNodeId || !issue || issue.nodeId !== selectedNodeId) return
    const composer = composers[selectedNodeId] ?? emptyComposer
    if (composer.sending) return
    const body = composer.text.trim()
    if (!body) return
    set({
      composers: {
        ...composers,
        [selectedNodeId]: { ...composer, sending: true, error: undefined },
      },
    })
    try {
      const comment = await api.invoke('issue:reply', selectedNodeId, body)
      set((state) =>
        state.generation !== generation
          ? state
          : {
              composers: {
                ...state.composers,
                [selectedNodeId]: {
                  ...emptyComposer,
                  offeredDraft: state.composers[selectedNodeId]?.offeredDraft,
                },
              },
              issue:
                state.selectedNodeId === selectedNodeId && state.issue?.nodeId === selectedNodeId
                  ? { ...state.issue, comments: [...state.issue.comments, comment] }
                  : state.issue,
            },
      )
    } catch (err) {
      set((state) =>
        state.generation !== generation
          ? state
          : {
              composers: {
                ...state.composers,
                [selectedNodeId]: {
                  ...(state.composers[selectedNodeId] ?? composer),
                  sending: false,
                  error: err instanceof Error ? err.message : String(err),
                },
              },
            },
      )
    }
  },

  replyToPullRequest: async () => {
    const { selectedNodeId, composers, pullRequest } = get()
    const generation = get().generation
    if (!selectedNodeId || !pullRequest || pullRequest.nodeId !== selectedNodeId) return
    const composer = composers[selectedNodeId] ?? emptyComposer
    if (composer.sending) return
    const body = composer.text.trim()
    if (!body) return
    set({
      composers: {
        ...composers,
        [selectedNodeId]: { ...composer, sending: true, error: undefined },
      },
    })
    try {
      const comment = await api.invoke('pullRequest:reply', selectedNodeId, body)
      set((state) =>
        state.generation !== generation
          ? state
          : {
              composers: {
                ...state.composers,
                [selectedNodeId]: {
                  ...emptyComposer,
                  offeredDraft: state.composers[selectedNodeId]?.offeredDraft,
                },
              },
              pullRequest:
                state.selectedNodeId === selectedNodeId && state.pullRequest?.nodeId === selectedNodeId
                  ? { ...state.pullRequest, comments: [...state.pullRequest.comments, comment] }
                  : state.pullRequest,
            },
      )
    } catch (err) {
      set((state) =>
        state.generation !== generation
          ? state
          : {
              composers: {
                ...state.composers,
                [selectedNodeId]: {
                  ...(state.composers[selectedNodeId] ?? composer),
                  sending: false,
                  error: err instanceof Error ? err.message : String(err),
                },
              },
            },
      )
    }
  },

  approvePullRequest: async () => {
    const { selectedNodeId, pullRequest, approvalSaving } = get()
    const generation = get().generation
    if (!selectedNodeId || !pullRequest || pullRequest.nodeId !== selectedNodeId || approvalSaving) return
    set({ approvalSaving: true, pullRequestError: null })
    try {
      const next = await api.invoke('pullRequest:approve', selectedNodeId)
      if (get().generation === generation && get().selectedNodeId === selectedNodeId) {
        set({ pullRequest: next, approvalSaving: false })
      }
    } catch (err) {
      if (get().generation === generation && get().selectedNodeId === selectedNodeId) {
        set({
          approvalSaving: false,
          pullRequestError: err instanceof Error ? err.message : String(err),
        })
      }
    }
  },

  setAssignee: async (login) => {
    const { selectedNodeId, issue, assigneeSaving } = get()
    const generation = get().generation
    if (!selectedNodeId || !issue || issue.nodeId !== selectedNodeId || assigneeSaving) return
    const previous = issue.assignees
    set({
      issue: { ...issue, assignees: login ? [login] : [] },
      assigneeSaving: true,
      issueError: null,
    })
    try {
      const assignees = await api.invoke('issue:setAssignee', selectedNodeId, login)
      if (get().generation === generation && get().selectedNodeId === selectedNodeId) {
        set({ issue: { ...get().issue!, assignees }, assigneeSaving: false })
      }
    } catch (err) {
      if (get().generation === generation && get().selectedNodeId === selectedNodeId) {
        set({
          issue: { ...get().issue!, assignees: previous },
          assigneeSaving: false,
          issueError: err instanceof Error ? err.message : String(err),
        })
      }
    }
  },

  setStatus: async (status) => {
    const { selectedNodeId, issue } = get()
    const generation = get().generation
    if (!selectedNodeId || !issue || issue.nodeId !== selectedNodeId) return
    set({ issue: { ...issue, workflowStatus: status } })
    try {
      await api.invoke('issue:setStatus', selectedNodeId, status)
    } catch (err) {
      if (
        get().generation === generation &&
        get().selectedNodeId === selectedNodeId &&
        get().issue?.nodeId === selectedNodeId
      ) {
        set({
          issue: { ...get().issue!, workflowStatus: issue.workflowStatus },
          issueError: err instanceof Error ? err.message : String(err),
        })
      }
    }
  },

  setSnooze: async (date) => {
    const { selectedNodeId, issue } = get()
    const generation = get().generation
    if (!selectedNodeId || !issue || issue.nodeId !== selectedNodeId) return
    set({ issue: { ...issue, snoozedUntil: date ?? undefined } })
    try {
      await api.invoke('issue:setSnooze', selectedNodeId, date)
    } catch (err) {
      if (
        get().generation === generation &&
        get().selectedNodeId === selectedNodeId &&
        get().issue?.nodeId === selectedNodeId
      ) {
        set({
          issue: { ...get().issue!, snoozedUntil: issue.snoozedUntil },
          issueError: err instanceof Error ? err.message : String(err),
        })
      }
    }
  },

  setComposerText: (nodeId, text, dirty) => {
    const composers = get().composers
    const current = composers[nodeId] ?? emptyComposer
    set({ composers: { ...composers, [nodeId]: { ...current, text, dirty, error: undefined } } })
  },

  acceptOfferedDraft: (nodeId) => {
    const composers = get().composers
    const current = composers[nodeId]
    if (!current?.offeredDraft) return null
    const draft = current.offeredDraft
    set({ composers: { ...composers, [nodeId]: { ...current, offeredDraft: undefined } } })
    return draft
  },

  discardOfferedDraft: (nodeId) => {
    const composers = get().composers
    const current = composers[nodeId]
    if (!current) return
    set({ composers: { ...composers, [nodeId]: { ...current, offeredDraft: undefined } } })
  },

  promptGoose: async (nodeId, text) => {
    const generation = get().generation
    const chats = get().gooseChats
    const chat = chats[nodeId]
    if (!chat?.loaded || chat.noWorkspace || chat.busy) return
    set({
      gooseChats: {
        ...chats,
        [nodeId]: {
          ...chat,
          busy: true,
          error: undefined,
          messages: [...chat.messages, { role: 'user', id: `local-${Date.now()}`, text }],
        },
      },
    })
    try {
      await api.invoke('session:prompt', nodeId, text)
    } catch {
      // the error also arrives via the push:goose 'error' event
    } finally {
      set((s) => {
        const current = s.gooseChats[nodeId]
        if (s.generation !== generation || !current) return s
        return {
          gooseChats: {
            ...s.gooseChats,
            [nodeId]: { ...current, busy: false },
          },
        }
      })
    }
  },

  setGooseInput: (nodeId, text) => {
    set((state) => ({ gooseInputs: { ...state.gooseInputs, [nodeId]: text } }))
  },

  cancelGoose: (nodeId) => {
    void api.invoke('session:cancel', nodeId)
  },

  setView: (view) => set({ view }),
  setAuth: (auth) =>
    set((state) => {
      const accountChanged = state.auth?.login !== auth.login || state.auth?.authenticated !== auth.authenticated
      if (!accountChanged) return { auth }
      return {
        auth,
        rows: [],
        conversationKind: 'issue',
        workflowStatusFilter: null,
        pullRequestFilters: [],
        pullRequestStateFilter: null,
        selectedNodeId: null,
        issue: null,
        pullRequest: null,
        assigneeSaving: false,
        pullRequestLoading: false,
        pullRequestError: null,
        approvalSaving: false,
        composers: {},
        gooseChats: {},
        gooseInputs: {},
        generation: state.generation + 1,
      }
    }),
  toggleSidebarFilter: (filter) =>
    set((s) => ({
      sidebarFilters: s.sidebarFilters.includes(filter)
        ? s.sidebarFilters.filter((f) => f !== filter)
        : [...s.sidebarFilters, filter],
    })),
  setWorkflowStatusFilter: (workflowStatusFilter) => set({ workflowStatusFilter }),
  setConversationKind: (conversationKind) => {
    if (get().conversationKind === conversationKind) return
    set({
      conversationKind,
      selectedNodeId: null,
      issue: null,
      pullRequest: null,
      issueLoading: false,
      pullRequestLoading: false,
      issueError: null,
      pullRequestError: null,
    })
  },
  togglePullRequestFilter: (filter) =>
    set((state) => ({
      pullRequestFilters: state.pullRequestFilters.includes(filter)
        ? state.pullRequestFilters.filter((value) => value !== filter)
        : [...state.pullRequestFilters, filter],
    })),
  setPullRequestStateFilter: (pullRequestStateFilter) => set({ pullRequestStateFilter }),
}))

function applyDraft(
  set: (partial: Partial<State>) => void,
  get: () => State,
  nodeId: string,
  text: string,
): void {
  const composers = get().composers
  const current = composers[nodeId] ?? emptyComposer
  if (!current.dirty) {
    // empty, or holding an untouched previous draft: replace
    set({ composers: { ...composers, [nodeId]: { text, dirty: false, sending: false } } })
  } else {
    // never destroy typed text: offer above the composer instead
    set({ composers: { ...composers, [nodeId]: { ...current, offeredDraft: text } } })
  }
}

function applyStream(chat: GooseChat, event: GooseStreamEvent): GooseChat {
  switch (event.type) {
    case 'agent-text': {
      const messages = [...chat.messages]
      const last = messages[messages.length - 1]
      if (last?.role === 'agent' && last.id === event.messageId) {
        messages[messages.length - 1] = { ...last, text: last.text + event.delta }
      } else {
        messages.push({ role: 'agent', id: event.messageId, text: event.delta, toolCalls: [] })
      }
      return { ...chat, messages }
    }
    case 'tool-call': {
      const messages = [...chat.messages]
      let target = messages[messages.length - 1]
      if (target?.role !== 'agent') {
        target = { role: 'agent', id: event.messageId, text: '', toolCalls: [] }
        messages.push(target)
      }
      const agent = target as Extract<GooseMessage, { role: 'agent' }>
      const calls: GooseToolCall[] = [...agent.toolCalls]
      const idx = calls.findIndex((c) => c.toolCallId === event.call.toolCallId)
      if (idx >= 0) calls[idx] = event.call
      else calls.push(event.call)
      messages[messages.length - 1] = { ...agent, toolCalls: calls }
      return { ...chat, messages }
    }
    case 'turn-end':
      return { ...chat, busy: false }
    case 'error':
      return { ...chat, busy: false, error: event.message }
    default:
      return chat
  }
}
