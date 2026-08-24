import { app, BrowserWindow, shell } from 'electron'
import path from 'node:path'
import * as activity from './activity'
import { authState } from './github/auth'
import { shutdownSessions } from './goose/sessions'
import { registerIpc } from './ipc'
import { startDraftServer, stopDraftServer } from './mcp/draftServer'
import { flushAllStores } from './store'

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1000,
    minHeight: 600,
    title: 'Top Goose',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(import.meta.dirname, '../preload/index.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
    },
  })

  // external links go to the default browser, not new Electron windows
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  // plain <a href> clicks (markdown links) must not navigate the app itself
  win.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith(process.env.ELECTRON_RENDERER_URL ?? 'file://')) return
    event.preventDefault()
    if (url.startsWith('https://') || url.startsWith('http://')) void shell.openExternal(url)
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void win.loadFile(path.join(import.meta.dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(async () => {
  registerIpc()
  await startDraftServer()
  createWindow()

  // start polling only when authenticated; renderer drives auth otherwise
  const state = await authState()
  if (state.authenticated) activity.start()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  activity.stop()
  shutdownSessions()
  stopDraftServer()
  flushAllStores()
})
