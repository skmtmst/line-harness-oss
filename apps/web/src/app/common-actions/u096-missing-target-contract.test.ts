import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = join(HERE, '..', '..')
const EDIT = readFileSync(join(HERE, 'edit', 'page.tsx'), 'utf8')
const VERSIONS = readFileSync(join(HERE, 'versions', 'page.tsx'), 'utf8')
const RICH_MENUS = readFileSync(join(SRC, 'app', 'rich-menus', 'edit', 'page.tsx'), 'utf8')

/*
 * #975 U096: 「対象が指定されていません」「id クエリパラメータが必要です」
 * 「API error: 404」のような内部向けの言葉で止まっていた画面を、
 * 何が足りないかと次の動きが分かる言い方へ。
 */
describe('対象が分からないときの言い方（#975 U096）', () => {
  it('共通アクション編集は、対象未指定を専用の案内にし一覧へ戻す', () => {
    expect(EDIT).toContain('編集する共通アクションが指定されていません')
    expect(EDIT).toContain('一覧から編集する共通アクションを選び直してください')
    // 戻り先は ★V7 TargetMissing の backHref が持つ。
    expect(EDIT).toContain('backHref="/common-actions"')
    // 技術的な「IDが不正」は画面の文言から外す。
    expect(EDIT).not.toContain('IDが不正')
  })

  it('共通アクション編集は、アカウント未選択・対象なし・権限なし・下書きなしを分ける', () => {
    expect(EDIT).toContain('共通アクションを編集するLINEアカウントを選んでください')
    expect(EDIT).toContain('この共通アクションは削除されたか、別のLINEアカウントのものです')
    expect(EDIT).toContain('この共通アクションを編集する権限がありません')
    expect(EDIT).toContain('編集中の下書きがありません')
    // 生の API エラー文は主文にしない（接頭辞で弾いて言い換える）。
    expect(EDIT).toContain("startsWith('API error:')")
  })

  it('版の画面は、対象未指定とアカウント未選択・対象なしを分ける', () => {
    expect(VERSIONS).toContain('版を確認する共通アクションが指定されていません')
    expect(VERSIONS).toContain('LINE公式アカウントを選んでください')
    expect(VERSIONS).toContain('この共通アクションは削除されたか、別のLINEアカウントのものです')
    expect(VERSIONS).toContain('backHref="/common-actions"')
    expect(VERSIONS).not.toContain('IDが不正')
  })

  it('リッチメニュー編集は、対象未指定・対象なし・権限なし・失敗を分けて案内する', () => {
    expect(RICH_MENUS).toContain('編集するリッチメニューが指定されていません')
    expect(RICH_MENUS).toContain('このリッチメニューは見つかりません')
    expect(RICH_MENUS).toContain('権限のある人に確認するか、別のLINEアカウントを選んでください')
    expect(RICH_MENUS).toContain('backHref="/rich-menus"')
    // 再読み込みは ★V7 TargetMissing の error（文言は部品が持つ。取り直し口があることだけ見る）。
    expect(RICH_MENUS).toContain('onRetry={() => void reload()}')
    // 旧来の技術的な言い回しは残さない。
    expect(RICH_MENUS).not.toContain('対象が指定されていません')
  })
})
