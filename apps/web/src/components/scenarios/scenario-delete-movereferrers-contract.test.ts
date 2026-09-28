import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const DIALOGS = fs.readFileSync(path.join(__dirname, 'scenario-dialogs.tsx'), 'utf8')
const LIST = fs.readFileSync(path.join(__dirname, 'scenario-list.tsx'), 'utf8')
const DETAIL = fs.readFileSync(
  path.join(__dirname, '..', '..', 'app', 'scenarios', 'detail', 'scenario-detail-client.tsx'),
  'utf8',
)
const PAGE = fs.readFileSync(
  path.join(__dirname, '..', '..', 'app', 'scenarios', 'page.tsx'),
  'utf8',
)

/**
 * R250: 移動先シナリオを消すとき、参照元の設定欠落を無警告で残さない。
 * - 削除確認で参照元の件数と名前を見せる（件数が取れたときだけ）
 * - 移動先なしの移動モードは保存させず、窓の中で理由を出す
 * - 欠けたまま残った設定は詳細の札でも知らせる
 */
describe('R250 移動先の削除と設定欠落の警告', () => {
  it('削除確認の注意書きが件数・名前・変更後を見せる', () => {
    expect(DIALOGS, '注意書きが無い').toContain('export function MoveReferrersNotice')
    expect(DIALOGS, '件数を出していない').toContain('件のシナリオの終了後の移動先になっています')
    expect(DIALOGS, '変更後を伝えていない').toContain('終了後の処理は「一時停止」に戻ります')
    // 失敗・読み込み中は件数を書かない。0件と紛らわしくしない。
    const errorAt = DIALOGS.indexOf('終了後の移動先としての利用を確認できませんでした')
    expect(errorAt, '失敗時の文が無い').toBeGreaterThanOrEqual(0)
    const errorBlock = DIALOGS.slice(Math.max(0, errorAt - 300), errorAt + 300)
    expect(errorBlock, '失敗時に件数を書いている').not.toMatch(/\d+件/)
    expect(DIALOGS, '0件の断りを書いている').not.toContain('0件のシナリオ')
  })

  it('一覧と詳細の削除確認が注意書きを使っている', () => {
    expect(LIST, '一覧の削除確認が注意書きを使っていない').toContain('<MoveReferrersNotice scenarioId={deleteTarget.id} />')
    expect(DETAIL, '詳細の削除確認が注意書きを使っていない').toContain('<MoveReferrersNotice scenarioId={id} />')
  })

  it('移動先なしの移動モードは保存させず窓の中で理由を出す', () => {
    expect(DIALOGS, '欠落の注意が無い').toContain('移動先が選ばれていません。選んで保存してください。')
    expect(DIALOGS, '保存前の止めが無い').toContain(
      "setError('「次のシナリオへ移動」には移動先のシナリオが要ります。')",
    )
  })

  it('欠けたままの設定は詳細の札でも知らせる', () => {
    expect(DETAIL, '札の警告が無い').toContain('移動先が選ばれていません。開いて選び直してください。')
  })

  it('開始確認は未選択と取得失敗を書き分ける', () => {
    expect(PAGE, '未選択の書き分けが無い').toContain('（移動先が選ばれていません）')
  })
})
