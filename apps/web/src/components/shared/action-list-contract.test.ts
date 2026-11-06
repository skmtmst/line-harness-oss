import { readUiSource } from '../../../scripts/test-ui-source.mjs'
import { describe, expect, it } from 'vitest'

// : 足す・行を直す・並べ替える・消すの形は共通部品が持つ。
const read = (path: string) => readUiSource(new URL(`../../${path}`, import.meta.url), 'utf8')
describe("行うことの形を戻さない", () => {
  // 部品名の文字固定はへ集約。追加・取消・並替え・削除・閲覧権限は action-list.test.tsx の実操作で守る。
  it('自動応答・クーポン・リサーチ・カルーセルの入口を共通の持ち主へ集める', () => {
    expect(read('components/auto-replies/inline-action-list.tsx')).toContain('<InlineActionRowsV8')
    expect(read('v8/template-edit/asset.tsx')).toContain('<InlineActionRowsV8')
  })
  it('フォームの旧タグ欄を同じ行にまとめ、旧値は消さず取り込む', () => {
    const source = read('v8/form-edit/after-tab.tsx')
    expect(source).toContain('tagIds: [onSubmitTagId]')
    expect(source).toContain("onChangeSubmitTag('')")
    expect(source).not.toContain('回答したときに付けるタグ')
  })
})
