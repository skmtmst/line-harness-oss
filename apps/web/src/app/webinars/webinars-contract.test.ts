import { readApiSource } from '../../../scripts/test-api-source.mjs'
import { readUiSource } from '../../../scripts/test-ui-source.mjs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const PAGE = readUiSource(path.join(__dirname, 'page.tsx'), 'utf8')
const EDIT = readUiSource(path.join(__dirname, 'edit/page.tsx'), 'utf8')
const API = readApiSource(path.join(__dirname, '../../lib/api.ts'), 'utf8')

/*
 * V8 ウェビナー一覧・編集の、戻してはいけない古い形の見張り。
 * 動きは描いて押す試験が守る：
 * - 一覧の並び・件数・絞り込み・フォルダ・アカウント・頁・器違い・アーカイブの失敗と POST
 *   … webinar-list-contract-react.test.tsx
 * - 検索・空と失敗・新規作成の行き先・アーカイブの確定 … webinar-list-behavior.test.tsx
 * - 行の「…」の行き先 … webinars-row-actions-react.test.tsx・webinar-list-v8-react.test.tsx
 * - 編集の段の読み替え・集計・CSV・公開ページ … edit/webinar-edit-contract-react.test.tsx
 * - 公開後の停止・通知テスト・複製・監視 … published/published-recovery-react.test.tsx
 * - 動画の実名・通知の状態の札 … edit/webinar-detail-status.test.tsx
 */
describe('V8 ウェビナー一覧の契約', () => {
  it('並び順は既存データで判定できるものだけ', () => {
    expect(PAGE).not.toContain('申込が多い順')
    expect(PAGE).not.toContain('表示件数の切り替えは準備中です')
  })

  it('公開中と下書きは取った頁を絞り直さない', () => {
    expect(PAGE).not.toContain('保存した条件は準備中です')
    expect(PAGE).not.toContain('foldered.filter')
  })

  it('フォルダは固定の一覧や仮の文を持たない', () => {
    expect(PAGE).not.toContain('const WEBINAR_FOLDERS')
    expect(PAGE).not.toContain('min-h-[640px]')
    expect(PAGE).not.toContain('フォルダ名と件数は一覧APIへの接続後に表示します。')
  })

  it('一覧は頁ごとに取り、取った頁を切り出さない', () => {
    expect(PAGE).not.toContain('ほかに {hiddenCount} 件あります')
    expect(PAGE).not.toContain('.slice(visibleStart, visibleStart + pageSize)')
  })

  it('取得失敗の生の理由を画面へ出さない', () => {
    expect(PAGE).not.toContain('e instanceof Error ? e.message')
  })

  it('固定の絞り込みを保存検索と呼ばない(DETAIL-20)', () => {
    expect(PAGE).not.toContain('保存した条件')
  })

  it('同じ /webinars/new への操作名を言い換えない(DETAIL-02)', () => {
    expect(PAGE).not.toContain('ウェビナーを作成')
    expect(PAGE).not.toContain('ウェビナーをつくる')
  })

  it('動画欄は slug.mp4 の偽名を作らない(DETAIL-18)', () => {
    expect(EDIT).not.toContain('webinar.slug}.mp4')
  })

  it('通知概要の状態を成功色に固定しない(DETAIL-19)', () => {
    expect(EDIT).not.toContain('text-success text-xs font-semibold">{enabled(')
    expect(EDIT).not.toContain('const enabled = ')
  })

  it('使っていない計算・状態を残さない(DETAIL-21)', () => {
    expect(EDIT).not.toContain('completionRate')
  })

  it('物理削除の口を置かない', () => {
    expect(API).not.toContain('webinarApi.remove')
  })
})
