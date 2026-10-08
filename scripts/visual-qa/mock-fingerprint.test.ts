import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
// @ts-expect-error JS tool
import { mockFingerprint } from './mock-fingerprint.mjs'

describe('ROOT-12 モックの依存を含む指紋', () => {
  it('fixturesだけを変えても指紋が変わり、古いモックを識別できる', () => {
    const root = mkdtempSync(join(tmpdir(), 'qa-fingerprint-'))
    writeFileSync(join(root, 'mock.mjs'), "import { data } from './fixtures.mjs'\nimport './large-mode.mjs'\n")
    writeFileSync(join(root, 'fixtures.mjs'), 'export const data = 1')
    writeFileSync(join(root, 'large-mode.mjs'), "import './nested.mjs'")
    writeFileSync(join(root, 'nested.mjs'), "import './fixtures.mjs'")
    const entry = pathToFileURL(join(root, 'mock.mjs'))
    const running = mockFingerprint(entry)
    expect(mockFingerprint(entry)).toBe(running)
    writeFileSync(join(root, 'fixtures.mjs'), 'export const data = 2')
    expect(mockFingerprint(entry)).not.toBe(running)
    const current = mockFingerprint(entry)
    writeFileSync(join(root, 'nested.mjs'), "import './fixtures.mjs'\n// changed nested behavior")
    expect(mockFingerprint(entry)).not.toBe(current)
  })
})
