import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/*
 * リッチメニュー作る④公開（板 `F4gELj`）の段の形（2026-10-05）。
 * - 終わりを決めるは枠の箱（題とトグルの行・入力の行。2026-10-07 絵の HTML どおりに直した）。オフのときは入力を無効化。
 * - 案内の帯は段の外（左の直下）。
 */
const HERE = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(join(HERE, 'create-v8.tsx'), 'utf8')

describe('リッチメニュー作る④公開は板 F4gELj の段の形どおり', () => {
  it('終わりを決めるは枠の箱', () => {
    expect(src).toContain('終わりを決めるは枠の箱')
    expect(src).toContain('className={styles.endBox}')
    expect(src).toContain('disabled={!endEnabled}')
  })

  it('案内の帯は段の外', () => {
    expect(src).toContain('案内の帯は段の外')
  })
})
