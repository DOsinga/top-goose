import type {
  InvokeChannel,
  InvokeMap,
  PushChannel,
  PushMap,
  TopGooseApi,
} from '../../shared/ipc'

type WebResponse = { value: unknown } | { error: string }
type WebEvent = { channel: PushChannel; payload: unknown }

export function createWebApi(): TopGooseApi {
  const listeners = new Map<PushChannel, Set<(payload: unknown) => void>>()
  const events = new EventSource('/api/events')
  events.onmessage = (event) => {
    const message = JSON.parse(event.data) as WebEvent
    for (const listener of listeners.get(message.channel) ?? []) listener(message.payload)
  }

  return {
    isRemote: true,
    invoke: async <C extends InvokeChannel>(
      channel: C,
      ...args: Parameters<InvokeMap[C]>
    ): Promise<Awaited<ReturnType<InvokeMap[C]>>> => {
      const response = await fetch('/api/invoke', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ channel, args }),
      })
      const result = (await response.json()) as WebResponse
      if ('error' in result) throw new Error(result.error)
      return result.value as Awaited<ReturnType<InvokeMap[C]>>
    },
    on: <C extends PushChannel>(channel: C, cb: PushMap[C]): (() => void) => {
      const callbacks = listeners.get(channel) ?? new Set<(payload: unknown) => void>()
      callbacks.add(cb as (payload: unknown) => void)
      listeners.set(channel, callbacks)
      return () => callbacks.delete(cb as (payload: unknown) => void)
    },
  }
}

export const api = window.topGoose ?? createWebApi()
