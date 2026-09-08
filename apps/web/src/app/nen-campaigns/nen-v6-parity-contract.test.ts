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
      '到達率・クリック率',
      '配信結果',
      '登録してもらったペット',
      'きっかけ',
      '取得不可',
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
    expect(OVERVIEW).toContain('setPreviewPetId(pet.id)')
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
    expect(OVERVIEW).toContain('birthdayReachRate')
    expect(OVERVIEW).toContain('birthdayClickRate')
    expect(OVERVIEW).toContain('誕生日配信の到達率')
    expect(OVERVIEW).toContain('誕生日配信のクリック率')
    expect(OVERVIEW).toContain('ふつうの配信の 2倍以上')
    expect(OVERVIEW).toContain('LINEから個人開封を取得できません')
    expect(OVERVIEW).not.toContain('12pt')
  })

  it('読込失敗と空状態を共通状態部品で示す', () => {
    expect(PAGE).toContain('kind="loading"')
    expect(PAGE).toContain('もう一度読み込む')
    expect(OVERVIEW).toContain('kind="empty"')
    expect(OVERVIEW).toContain('売らない配信です。ここで信用がたまると、売る配信が届きやすくなります。')
  })

  it('タブごとに取り、失敗はそのタブだけの帯で示す(点検 #512 の中3)', () => {
    // 8件同時取得・1件失敗で画面全体エラーをやめる。
    expect(PAGE).toContain('loadTab')
    expect(PAGE).toContain('tabErrors')
    expect(PAGE).toContain('tone="danger"')
    expect(PAGE).not.toContain('loadError')
    // 操作後は関係するタブだけ読み直す。
    expect(PAGE).toContain("await loadTab('columns')")
    expect(PAGE).toContain("await loadTab('pets')")
    expect(PAGE).toContain("await loadTab('history')")
    expect(PAGE).not.toContain('await load()')
  })

  it('コラム作成で対象・予約・読了後の操作を実APIへ接続する', () => {
    expect(NEW_COLUMN).toContain('data-design-node="ymXJK"')
    expect(NEW_COLUMN).toContain('前のコラムを下敷きにする')
    expect(NEW_COLUMN).toContain('columnAudience')
    expect(NEW_COLUMN).toContain('配信日時（日本時間）')
    expect(NEW_COLUMN).toContain('読了イベント名')
    expect(NEW_COLUMN).toContain('読了後に付けるタグ')
  })

  it('一覧側の配信日時も新規作成と同じく日本時間で送る(点検 #512 の中5)', () => {
    // 端末の時差で解釈する new Date(...).toISOString() を使わない。
    expect(OVERVIEW).toContain('publishedAtIso')
    expect(OVERVIEW).not.toContain('new Date(event.target.value).toISOString()')
  })

  it('コラム作成のタグ候補はこのアカウントのものだけ(点検 #512 の中4)', () => {
    expect(NEW_COLUMN).toContain('visibleAccountTags')
    expect(NEW_COLUMN).toContain('accountTags')
  })

  it('今すぐ送る件数は口と同じ決めごとの数を使う(点検 #512 の中2)', () => {
    // 一覧の窓付き集計(summary.pending)を送ると、変わっていないのに409になる。
    expect(PAGE).toContain('overviewRes.data.jobs.pending')
    expect(PAGE).not.toContain('deliveryList.summary.pending')
  })

  it('削除と配信予約は確認ダイアログを挟む(点検 #512 の中9)', () => {
    expect(OVERVIEW).toContain('ConfirmDialog')
    expect(OVERVIEW).toContain('confirmDeliver')
    expect(OVERVIEW).toContain('confirmPet')
    expect(OVERVIEW).toContain('を配信予約しますか？')
    expect(OVERVIEW).toContain('の登録を外しますか？')
    // ボタン直結のワンクリック実行は残さない。
    expect(OVERVIEW).not.toContain('onClick={() => onDeliver(column)}')
    expect(OVERVIEW).not.toContain('onClick={() => onDeletePet(pet)}')
  })
})
