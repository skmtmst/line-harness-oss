import { readUiSource } from '../../../../scripts/test-ui-source.mjs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const PAGE = readUiSource(join(dirname(fileURLToPath(import.meta.url)), 'page.tsx'), 'utf8')

/*
 * #973 U026: 共通情報の一覧（/contents/vars）が横にはみ出していた。
 * はみ出し・右端越えは v8-screen-guard（1152・1440・1920 の layout-overflow）が全画面を描いて見張り、
 * 検索欄・畳んだフォルダの選択・読み込み中と空の状態を表の外に出すことは
 * `src/v8/common-vars/list-view.test.tsx` が描いて確かめる。ここは、はみ出す元の書き方へ戻さない見張りだけ。
 */
describe('共通情報一覧のはみ出し（#973 U026）', () => {
  it('はみ出す最小幅の検索欄や、表のセルに入れた空の状態へ戻さない', () => {
    expect(PAGE).not.toContain('min-w-64')
    expect(PAGE).not.toContain('colSpan={7}')
  })
})
