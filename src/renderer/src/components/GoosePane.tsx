import { useEffect, useRef, useState } from 'react'
import type { GooseMessage, GooseToolCall } from '../../../shared/types'
import { useStore } from '../store'
import { Markdown } from './Markdown'

const KIND_ICONS: Record<string, string> = {
  read: '📄',
  edit: '✏️',
  delete: '🗑',
  move: '📦',
  search: '🔍',
  execute: '▶️',
  think: '💭',
  fetch: '🌐',
  other: '🔧',
}

export function GoosePane(): React.JSX.Element {
  const selected = useStore((s) => s.selectedNodeId)
  const chat = useStore((s) => (selected ? s.gooseChats[selected] : undefined))
  const promptGoose = useStore((s) => s.promptGoose)
  const cancelGoose = useStore((s) => s.cancelGoose)
  const respondPermission = useStore((s) => s.respondGoosePermission)
  const [inputs, setInputs] = useState<Record<string, string>>({})
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView()
  }, [selected, chat?.messages.length, chat?.messages[chat.messages.length - 1]?.text])

  if (!selected) {
    return <div className="w-96 shrink-0 border-l border-gray-200 bg-gray-50" />
  }
  const input = inputs[selected] ?? ''

  const send = (): void => {
    const text = input.trim()
    if (!text || !chat?.loaded || chat.noWorkspace || chat.busy) return
    setInputs((current) => ({ ...current, [selected]: '' }))
    void promptGoose(selected, text)
  }

  return (
    <div className="flex w-96 shrink-0 flex-col border-l border-gray-200 bg-gray-50">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-gray-200 px-3">
        <span className="text-[13px] font-semibold text-goose">🪿 Goose</span>
        <span className="text-[11px] text-gray-400">private — nothing here posts to GitHub</span>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3">
        {chat?.noWorkspace && (
          <div className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
            No local clone configured for this repository, so Goose has no code access. Set a path in
            Settings for better answers.
          </div>
        )}
        {chat?.error && (
          <div className="rounded border border-red-300 bg-red-50 px-3 py-2 text-[12px] text-red-700">
            {chat.error}
          </div>
        )}
        {!chat?.loaded && !chat?.error && (
          <div className="text-[12px] text-gray-400">Connecting to Goose…</div>
        )}
        {chat?.loaded && chat.messages.length === 0 && (
          <div className="text-[12px] text-gray-400">
            Ask about this issue: “What is being asked here?”, “Find the relevant code.”, “Draft a reply.”
          </div>
        )}
        {chat?.messages.map((m) => <GooseBubble key={m.id} message={m} />)}
        {chat?.permissions.map((request) => (
          <div key={request.requestId} className="rounded border border-amber-300 bg-amber-50 p-2 text-[12px]">
            <div className="font-medium text-amber-900">{request.title}</div>
            {request.detail && <div className="mt-1 max-h-20 overflow-auto break-all font-mono text-[10px] text-amber-800">{request.detail}</div>}
            <div className="mt-2 flex justify-end gap-2">
              <button
                className="rounded px-2 py-1 text-gray-600 hover:bg-amber-100"
                onClick={() => void respondPermission(selected, request.requestId, false)}
              >
                Deny
              </button>
              <button
                className="rounded bg-amber-700 px-2 py-1 text-white"
                onClick={() => void respondPermission(selected, request.requestId, true)}
              >
                Allow once
              </button>
            </div>
          </div>
        ))}
        {chat?.busy && <div className="text-[12px] text-gray-400">Goose is working…</div>}
        <div ref={endRef} />
      </div>

      <div className="shrink-0 border-t border-gray-200 p-3">
        <textarea
          className="h-16 w-full resize-none rounded-lg border border-gray-300 p-2 text-[13px] focus:border-goose focus:outline-none"
          placeholder="Ask Goose… (⌘↵ to send)"
          value={input}
          disabled={!chat?.loaded || chat.noWorkspace || chat.busy}
          onChange={(e) => setInputs((current) => ({ ...current, [selected]: e.target.value }))}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault()
              send()
            }
          }}
        />
        <div className="mt-1 flex justify-end gap-2">
          {chat?.busy && (
            <button
              className="rounded-lg px-3 py-1 text-[12px] text-gray-600 hover:bg-gray-200"
              onClick={() => cancelGoose(selected)}
            >
              Stop
            </button>
          )}
          <button
            className="rounded-lg bg-goose px-3 py-1 text-[12px] font-medium text-white disabled:opacity-40"
            disabled={!chat?.loaded || chat.noWorkspace || !input.trim() || chat.busy}
            onClick={send}
          >
            Send
          </button>
        </div>
      </div>
    </div>
  )
}

function GooseBubble({ message }: { message: GooseMessage }): React.JSX.Element {
  if (message.role === 'user') {
    return (
      <div className="ml-6 rounded-lg bg-goose/10 px-3 py-2">
        <div className="text-[13px] whitespace-pre-wrap">{message.text}</div>
      </div>
    )
  }
  return (
    <div className="mr-2">
      {message.toolCalls.length > 0 && (
        <div className="mb-1 space-y-0.5">
          {message.toolCalls.map((c) => (
            <ToolCallChip key={c.toolCallId} call={c} />
          ))}
        </div>
      )}
      {message.text && (
        <div className="rounded-lg border border-gray-200 bg-white px-3 py-2">
          <Markdown>{message.text}</Markdown>
        </div>
      )}
    </div>
  )
}

function ToolCallChip({ call }: { call: GooseToolCall }): React.JSX.Element {
  // compact, after-the-fact display: no approval queue in a chat column
  const icon = KIND_ICONS[call.kind ?? 'other'] ?? '🔧'
  const status =
    call.status === 'failed' ? 'text-red-600' : call.status === 'completed' ? 'text-gray-500' : 'text-gray-400'
  return (
    <div className={`flex items-center gap-1.5 truncate text-[11px] ${status}`} title={call.title}>
      <span>{icon}</span>
      <span className="truncate">{call.title}</span>
      {(call.status === 'pending' || call.status === 'in_progress') && <span className="animate-pulse">…</span>}
    </div>
  )
}
