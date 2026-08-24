import { app } from 'electron'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'

/**
 * A tiny JSON-file-backed store with debounced writes. All durable state in
 * Top Goose (settings, session mapping, sidebar cache) is small; a database
 * is deliberately avoided per the design.
 */
export class JsonFile<T> {
  private filePath: string
  private value: T
  private timer: NodeJS.Timeout | null = null

  constructor(name: string, defaultValue: T) {
    const dir = app.getPath('userData')
    mkdirSync(dir, { recursive: true })
    this.filePath = path.join(dir, name)
    this.value = defaultValue
    try {
      this.value = { ...defaultValue, ...JSON.parse(readFileSync(this.filePath, 'utf8')) }
    } catch {
      // missing or corrupt file: keep defaults
    }
  }

  get(): T {
    return this.value
  }

  set(value: T): void {
    this.value = value
    this.scheduleWrite()
  }

  update(fn: (current: T) => T): T {
    this.value = fn(this.value)
    this.scheduleWrite()
    return this.value
  }

  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    this.writeNow()
  }

  private scheduleWrite(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = null
      this.writeNow()
    }, 250)
  }

  private writeNow(): void {
    // write-then-rename so a crash mid-write cannot truncate the file
    const tmp = this.filePath + '.tmp'
    try {
      writeFileSync(tmp, JSON.stringify(this.value, null, 2))
      renameSync(tmp, this.filePath)
    } catch (err) {
      console.error(`failed to persist ${this.filePath}:`, err)
    }
  }
}
