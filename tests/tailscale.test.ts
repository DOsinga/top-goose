import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getRemoteUrl,
  onRemoteUrl,
  startTailscale,
  stopTailscale,
} from '../src/main/tailscale'

describe('Tailscale Serve', () => {
  let directory: string
  let originalPath: string | undefined

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'top-goose-tailscale-'))
    const executable = path.join(directory, 'tailscale')
    await writeFile(
      executable,
      `#!/bin/sh
if [ "$1" = "version" ]; then exit 0; fi
if [ "$1" != "serve" ] || [ "$2" != "--yes" ] || [ "$3" != "43210" ]; then exit 2; fi
echo "Available within your tailnet:"
echo "https://top-goose.example.ts.net/"
while true; do sleep 1; done
`,
    )
    await chmod(executable, 0o755)
    originalPath = process.env.PATH
    process.env.PATH = `${directory}:${originalPath ?? ''}`
  })

  afterEach(async () => {
    stopTailscale()
    process.env.PATH = originalPath
    await rm(directory, { recursive: true })
  })

  it('finds the CLI, exposes the chosen port, and publishes the remote URL', async () => {
    const urls: Array<string | null> = []
    const unsubscribe = onRemoteUrl((url) => urls.push(url))

    await startTailscale(43210)
    await vi.waitFor(() => expect(getRemoteUrl()).toBe('https://top-goose.example.ts.net'))

    expect(urls).toEqual(['https://top-goose.example.ts.net'])
    unsubscribe()
  })
})
