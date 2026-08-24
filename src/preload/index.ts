import { contextBridge, ipcRenderer } from 'electron'
import type { TopGooseApi } from '../shared/ipc'

const api: TopGooseApi = {
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
  on: (channel, cb) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown): void => {
      ;(cb as (p: unknown) => void)(payload)
    }
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  },
}

contextBridge.exposeInMainWorld('topGoose', api)
