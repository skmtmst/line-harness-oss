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

  it('コラムは6件ずつ表示し、配信履歴は新しい取得結果を使う', () => {
    expect(OVERVIEW).toContain('const pageSize = 6')
    expect(OVERVIEW).toContain('aria-label="コラムのページ送り"')
    expect(OVERVIEW).toContain('delivery.lineAccountName')
    expect(OVERVIEW).toContain('deliveryTriggerLabel(delivery.campaignKey)')
    expect(OVERVIEW).toContain('delivery.reaction.reason')
    expect(OVERVIEW).toContain('onShowDetail(delivery.id)')
  })

  it('誕生日配信の実行時刻をプレビューにも表示する', () => {
    expect(OVERVIEW).toContain('誕生日の3日前 10:00 に届きます')
    expect(OVERVIEW).toContain('FeatureLinkCard')
    for (const label of ['中身を見る', '飼い主を見る', 'ペットのご紹介（聞きとり）']) {
      expect(OVERVIEW).toContain(label)
    }
  })

  it('取得できる集計を表示し、LINEから取れない開封率は理由を示す', () => {
    expect(OVERVIEW).toContain('flowMetrics?.summary.sent')
    expect(OVERVIEW).toContain("['order_thanks', 'order_confirmed']")
    expect(OVERVIEW).toContain("['shipping_notice', 'shipping_confirmed']")
    expect(OVERVIEW).toContain('metric?.targeted.toLocaleString')
    expect(OVERVIEW).toContain('metric?.articleOpened.value?.toLocaleString')
    expect(OVERVIEW).toContain('openRate.reason')
    expect(OVERVIEW).toContain('birthdayOpenRate.reason')
    expect(OVERVIEW).not.toContain('12pt')
  })

  it('読込失敗と空状態を共通状態部品で示す', () => {
    expect(PAGE).toContain('kind="loading"')
    expect(PAGE).toContain('kind="error"')
    expect(PAGE).toContain('再読み込みしても直らないときは、エラー報告へお知らせください。')
    expect(PAGE).toContain('もう一度読み込む')
    expect(OVERVIEW).toContain('kind="empty"')
    expect(OVERVIEW).toContain('売らない配信です。ここで信用がたまると、売る配信が届きやすくなります。')
  })

  it('コラム作成では未接続の工程を明示し、実行できる操作だけを有効にする', () => {
    expect(NEW_COLUMN).toContain('data-design-node="ymXJK"')
    expect(NEW_COLUMN).toContain('前のコラムを下敷きにする')
    expect(NEW_COLUMN).toContain('コラム複製の接続後に使えます')
    expect(NEW_COLUMN).toContain('対象人数を確認してから配信予約できます')
    expect(NEW_COLUMN).toContain('読了イベントとタグ付けが接続されると設定できます')
  })
})
