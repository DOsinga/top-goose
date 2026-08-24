import type { TopGooseApi } from '../shared/ipc'

declare global {
  interface Window {
    topGoose: TopGooseApi
  }
}

export {}
