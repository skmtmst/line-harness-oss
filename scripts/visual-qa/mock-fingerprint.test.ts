import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
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


it('APIの実装を分割先で変えたら、起動済みモックの指紋と区別できる', () => {
  const root = mkdtempSync(join(tmpdir(), 'qa-api-fingerprint-'))
  const api = join(root, 'api.ts')
  const module = join(root, 'api', 'messages.ts')
  mkdirSync(join(root, 'api'))
  writeFileSync(join(root, 'mock.mjs'), 'export const mock = true')
  writeFileSync(api, "export * from './api/messages'\n")
  writeFileSync(module, 'export const message = 1')
  const entry = pathToFileURL(join(root, 'mock.mjs'))
  const inputs = [pathToFileURL(api)]
  const running = mockFingerprint(entry, inputs)
  expect(mockFingerprint(entry, inputs)).toBe(running)
  writeFileSync(module, 'export const message = 2')
  expect(mockFingerprint(entry, inputs)).not.toBe(running)
})
