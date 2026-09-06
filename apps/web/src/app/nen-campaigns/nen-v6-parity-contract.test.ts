import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const OVERVIEW = fs.readFileSync(path.join(__dirname, 'nen-overview.tsx'), 'utf8')
const PAGE = fs.readFileSync(path.join(__dirname, 'page.tsx'), 'utf8')
const NEW_COLUMN = fs.readFileSync(path.join(__dirname, 'columns/new/page.tsx'), 'utf8')

describe('V6 21 NEN配信の画面契約', () => {
  it('4つの一覧状態を実ノードへ対応させる', () => {
    for (const node of ['VLMGH', 'DEX0k', 'q4lajm', 'WeXbL']) {
      expect(OVERVIEW).toContain(`'${node}'`)
    }
    for (const tab of ['配信フロー', 'NENコラム', 'ペット・記念日', '配信履歴']) {
      expect(OVERVIEW).toContain(tab)
    }
  })

  it('設計にある主要な判断材料と操作を表示する', () => {
    for (const label of [
      '買っていただいてからの流れ',
      'この30日に送った',
      '押された割合',
      '配信結果',
      '登録してもらったペット',
      'きっかけ',
      '反応',
    ]) {
      expect(OVERVIEW).toContain(label)
    }
  })

  it('取得できない数字を0や見本値として表示しない', () => {
    expect(OVERVIEW).toContain('集計が接続されると表示します')
    expect(OVERVIEW).toContain('対象人数未接続')
    expect(OVERVIEW).toContain('読了集計未接続')
    expect(OVERVIEW).not.toContain('12pt')
  })

  it('読込失敗と空状態を共通状態部品で示す', () => {
    expect(PAGE).toContain('kind="loading"')
    expect(PAGE).toContain('kind="error"')
    expect(OVERVIEW).toContain('kind="empty"')
  })

  it('コラム作成では未接続の工程を明示し、実行できる操作だけを有効にする', () => {
    expect(NEW_COLUMN).toContain('data-design-node="ymXJK"')
    expect(NEW_COLUMN).toContain('前のコラムを下敷きにする')
    expect(NEW_COLUMN).toContain('コラム複製の接続後に使えます')
    expect(NEW_COLUMN).toContain('対象人数を確認してから配信予約できます')
    expect(NEW_COLUMN).toContain('読了イベントとタグ付けが接続されると設定できます')
  })
})
