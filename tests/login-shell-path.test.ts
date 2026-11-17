import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveLoginShellPath } from '../src/main/loginShellPath'

afterEach(() => vi.unstubAllEnvs())

describe('login shell PATH', () => {
  it.skipIf(process.platform === 'win32')('uses the last line printed by the login shell', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'top-goose-login-shell-'))
    const shell = path.join(dir, 'shell')
    await writeFile(shell, '#!/bin/sh\nprintf "profile output\\n/custom/bin:/usr/bin\\n"\n')
    await chmod(shell, 0o755)
    vi.stubEnv('SHELL', shell)

    expect(await resolveLoginShellPath()).toBe('/custom/bin:/usr/bin')

    await rm(dir, { recursive: true })
  })
})
