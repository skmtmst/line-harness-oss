import { readUiSource as readFileSync } from '../../../../../scripts/test-ui-source.mjs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const FORM = readFileSync(join(HERE, 'menu-form-v8.tsx'), 'utf8')

/*
 * 予約メニューのタグは共通窓で名前を検索できる。
 * タグが多いと選ぶ欄だけでは探せない。ここでは結び付けだけを見る。
 */
describe('予約メニュー作成のタグ検索', () => {
  it('タグの絞り込み欄がある', () => {
    expect(FORM).toMatch(/<EntitySelect\s+[^>]*aria-label="予約後に付けるタグ"/)
    expect(FORM).toContain('options={tagCandidates.map')
    const picker = readFileSync(join(HERE, '../../../../components/shared/entity-picker.tsx'), 'utf8')
    expect(picker).toContain('item.name.toLocaleLowerCase().includes(q)')
  })
})
