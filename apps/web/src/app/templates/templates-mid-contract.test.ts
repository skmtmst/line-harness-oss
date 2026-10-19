import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

// 画面が使う正本は page＋core（組み立て・保存を出した共有モジュール）の両方。
const EDIT = fs.readFileSync(path.join(__dirname, '../../v8/template-edit/message.tsx'), 'utf8')
  + fs.readFileSync(path.join(__dirname, '../../v8/template-edit/core.ts'), 'utf8')
const CAROUSEL = fs.readFileSync(path.join(__dirname, '../../v8/templates/carousel.tsx'), 'utf8')
  + fs.readFileSync(path.join(__dirname, '../../v8/templates/carousel-core.ts'), 'utf8')
const QUESTION_NEW = fs.readFileSync(
  path.join(__dirname, '../../v8/templates/question-new.tsx'),
  'utf8',
)
const ASSET_EDITOR = fs.readFileSync(
  path.join(__dirname, '../../v8/template-edit/asset.tsx'),
  'utf8',
)

describe('点検・中: テンプレートの画面契約', () => {
  it('中2: 質問の分類候補は置き場一覧から取り、全件取得しない', () => {
    // 置き場は選択中アカウントのものだけを読む（#892）。
    expect(QUESTION_NEW).toContain("api.folders.list('template',")
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
      expect(page).toMatch(/disabled=\{(?:saving|busy) \|\| loadFailed|disabled=\{busy \|\| Boolean\(blocked\)/)
    }
  })

  it('中5: 3つの作成・更新画面は置き場を選んでfolderIdを送る', () => {
    for (const page of [EDIT, CAROUSEL, QUESTION_NEW]) {
      expect(page).toMatch(/置き場|フォルダ/)
      expect(page).toContain('folderId')
      expect(page).toContain("api.folders.list('template',")
    }
    expect(EDIT).toContain('folderId,')
    expect(CAROUSEL).toContain('folderId,')
  })

  it('中6: 素材の保存は成功を表示し、二度押しさせない', () => {
    // 成功は共通 Notice のうまくいった帯（一覧へ戻る操作つき）で出す（★管理画面 共通部品その2 §1）。
    expect(ASSET_EDITOR).toContain('保存しました')
    expect(ASSET_EDITOR).toContain('setSaved(true)')
    expect(ASSET_EDITOR).toContain('disabled={busy || Boolean(blocked)}')
    expect(ASSET_EDITOR).toContain("notifySaved('下書きを保存しました')")
  })
})
