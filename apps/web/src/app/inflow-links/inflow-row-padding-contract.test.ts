import { readUiSource as readFileSync } from '../../../scripts/test-ui-source.mjs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/*
 * 流入と計測の一覧と板 `xbHxg` の数値突き合わせ（2026-10-03）。
 * 表の行は余白 9/20。見出し・数の帯・探す欄は共通部品（M10）の持ち物なので見ない。
 */
const HERE = dirname(fileURLToPath(import.meta.url))
const tsx = readFileSync(join(HERE, 'page.tsx'), 'utf8')

describe('流入と計測の一覧の行は板 xbHxg の余白どおり', () => {
  it('行のセルは左右 20・上下 9', () => {
    expect(tsx).not.toMatch(/<td className="[^"]*px-2 py-3/)
    expect(tsx).toContain('px-5 py-[9px]')
  })
})
