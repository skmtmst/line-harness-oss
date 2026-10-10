import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// B-169: 足す・行を直す・並べ替える・消すの形は共通部品が持つ。
const owners = [
  'components/forms/action-editor.tsx',
  'components/auto-replies/inline-action-rows-v8.tsx',
  'components/automations/common-action-editor.tsx',
  'components/automations/branch-action-list.tsx',
  'components/friend-fields/linked-action-list.tsx',
  'components/scenarios/action-editor.tsx',
  'components/scenarios/question-editor.tsx',
  'components/shared/tap-side-effects.tsx',
  'components/broadcasts/broadcast-form.tsx',
  'v8/automations/common-action-new.tsx',
  'v8/automations/create/create.tsx',
  'v8/friend-add/editor.tsx',
  'v8/inflow-links/new/create.tsx',
  'v8/webhooks/incoming-actions.tsx',
  'v8/webinar-edit/notifications.tsx',
]
const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')
describe('B-169 行うことの形を戻さない', () => {
  for (const path of owners) it(`${path} は共通の行を使う`, () => {
    expect(read(path)).toMatch(/import .*action-list['"]/)
    expect(read(path)).toMatch(/<(ActionList|ActionRow)[\s><]/)
  })
  it('自動応答・クーポン・リサーチ・カルーセルの入口を共通の持ち主へ集める', () => {
    expect(read('components/auto-replies/inline-action-list.tsx')).toContain('<InlineActionRowsV8')
    expect(read('v8/template-edit/asset.tsx')).toContain('<InlineActionRowsV8')
    expect(read('v8/templates/carousel.tsx')).toContain('<InlineActionList')
  })
  it('フォームの旧タグ欄を同じ行にまとめ、旧値は消さず取り込む', () => {
    const source = read('v8/form-edit/after-tab.tsx')
    expect(source).toContain('tagIds: [onSubmitTagId]')
    expect(source).toContain("onChangeSubmitTag('')")
    expect(source).not.toContain('回答したときに付けるタグ')
  })
})
