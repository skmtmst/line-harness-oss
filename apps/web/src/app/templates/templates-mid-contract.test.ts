import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const EDIT = fs.readFileSync(path.join(__dirname, 'edit/page.tsx'), 'utf8')
const CAROUSEL = fs.readFileSync(path.join(__dirname, 'carousel/page.tsx'), 'utf8')
const QUESTION_NEW = fs.readFileSync(
  path.join(__dirname, 'questions/new/page.tsx'),
  'utf8',
)
const ASSET_EDITOR = fs.readFileSync(
  path.join(__dirname, 'template-asset-editor.tsx'),
  'utf8',
)

describe('点検・中: テンプレートの画面契約', () => {
  it('中2: 質問の分類候補は置き場一覧から取り、全件取得しない', () => {
    expect(QUESTION_NEW).toContain("api.folders.list('template')")
    expect(QUESTION_NEW).not.toContain('api.templates.list(')
  })

  it('中3: 読み込めない既存データは理由を出し、保存を止める', () => {
    for (const page of [EDIT, CAROUSEL]) {
      expect(page).toContain('読み込めませんでした。開き直してください')
      expect(page).toContain('loadFailed')
      /*
       * 止める理由は増える（例: 所属アカウントとの食い違い）。
       * 完全一致で見張ると、理由を足しただけで落ちる。**「読み込めて
       * いないときに保存を止めている」ことだけを見る。**
       */
      expect(page).toContain('disabled={saving || loadFailed')
    }
  })

  it('中5: 3つの作成・更新画面は置き場を選んでfolderIdを送る', () => {
    for (const page of [EDIT, CAROUSEL, QUESTION_NEW]) {
      expect(page).toContain('置き場')
      expect(page).toContain('folderId')
      expect(page).toContain("api.folders.list('template')")
    }
    expect(EDIT).toContain('folderId,')
    expect(CAROUSEL).toContain('folderId,')
  })

  it('中6: 素材の保存は成功を表示し、二度押しさせない', () => {
    expect(ASSET_EDITOR).toContain('保存しました')
    expect(ASSET_EDITOR).toContain('setSaved(true)')
    expect(ASSET_EDITOR).toContain('disabled={saving || saved}')
    expect(ASSET_EDITOR).toContain('role="status"')
  })
})
