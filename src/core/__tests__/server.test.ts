import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { VERSION } from '../server.js'

describe('VERSION', () => {
  it('is the version in package.json', () => {
    // Clients see this in serverInfo; it must be the version npm published.
    const pkg = JSON.parse(
      readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')
    ) as { version: string }
    expect(VERSION).toBe(pkg.version)
  })
})
