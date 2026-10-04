import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const FORM = readFileSync(join(HERE, 'menu-form-v8.tsx'), 'utf8')

/*
 * v7 のメニュー作成にある「タグを検索」は V8 にも要る。
 * タグが多いと選ぶ欄だけでは探せない。ここでは結び付けだけを見る。
 */
describe('予約メニュー作成のタグ検索', () => {
  it('タグの絞り込み欄がある', () => {
    expect(FORM).toContain('aria-label="タグを検索"')
    expect(FORM).toContain('visibleTagCandidates')
  })
})
