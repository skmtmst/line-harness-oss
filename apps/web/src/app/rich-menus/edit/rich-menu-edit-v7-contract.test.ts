import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/*
 * m18s: リッチメニュー編集画面は ★V7 の共通部品で出す。
 * - 「出す相手」「いつ出すか」はラジオカード（素の青丸を直置きしない）
 * - 条件・プレビューの切替は共通チェックボックス（素の四角を直置きしない）
 * - 未設定の行は警告色（失敗の赤にしない）
 * 戻すと赤。
 */
const here = dirname(fileURLToPath(import.meta.url))
const page = readFileSync(join(here, 'page.tsx'), 'utf8')
const form = readFileSync(
  join(here, '..', '..', '..', 'components', 'rich-menus', 'rich-menu-create-form.tsx'),
  'utf8',
)

describe('m18s 編集・作成画面は★V7の共通部品で出す', () => {
  it('出す相手・公開時期はラジオカードで選ぶ', () => {
    expect(page).toContain('legend="出す相手の選択"')
    expect(page).toContain('legend="公開時期の選択"')
    expect(page).toContain('name="audience"')
    expect(page).toContain('name="publish-mode"')
  })

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
