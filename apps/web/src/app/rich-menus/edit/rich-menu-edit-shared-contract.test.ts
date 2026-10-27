import { readUiSource } from '../../../../scripts/test-ui-source.mjs'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/*
 * リッチメニューの現役V8は共通部品で選択と状態を出す。
 * 「出す相手」「いつ公開するか」が共通の選ぶ札（fieldset と legend、name は audience・timing）で
 * 出ることは v8/rich-menus/new/create-steps-react.test.tsx が描いて見る。
 * ここには、素のラジオ・チェックボックスの直置きと、未設定を失敗の赤にする書き方の禁止の見張りだけを残す。
 */
const here = dirname(fileURLToPath(import.meta.url))
const page = readUiSource(new URL('../../../v8/rich-menus/new/create.tsx', import.meta.url), 'utf8')
const form = readFileSync(
  join(here, '../../../v8/rich-menu-edit/compatibility-form.tsx'),
  'utf8',
)

describe('現役の編集・作成は共通部品で選ぶ', () => {
  it('素のラジオ・チェックボックスを直置きしない', () => {
    expect(page).not.toContain('type="radio"')
    expect(page).not.toContain('type="checkbox"')
    expect(form).not.toContain('name="create-audience" className="mt-1"')
    expect(form).not.toContain('アクションを設定する')
  })

  it('未設定は赤（失敗色）にしない', () => {
    expect(page).not.toContain("text-danger'}>{imageReady")
    expect(page).not.toContain('unconfiguredAreas === 0 ? \'text-success\' : \'text-danger\'')
    expect(form).not.toContain('unsetLabels.length > 0 ? \'text-danger\'')
  })
})
