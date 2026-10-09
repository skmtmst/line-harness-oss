import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const PAGE = fs.readFileSync(path.join(__dirname, 'page.tsx'), 'utf8') + fs.readFileSync(path.join(__dirname, '../../../v8/broadcast-detail/detail.tsx'), 'utf8')

describe('V6 一斉配信詳細の契約', () => {
  it('概要・宛先・記録を押せるタブとして示す', () => {
    // #816（★V7 C-2）。押せない5連の飾り（概要・クリック・友だち・エラー・
    // 配信内容）は、押せる3つのタブ（概要・宛先・記録）へ置き換えた。
    // 押せない飾りは出さない（★V7の決まり）。
    expect(PAGE).toContain("<Tabs")
    expect(PAGE).toContain("current: tab === 'overview'")
  })

  it('承認が絡む配信は段に承認待ちを出す', () => {
    // 記録に「承認を依頼した」「承認した」がある配信は、
    // 送り終わっても段に承認待ちを出す。承認の要らない配信は出さない。
    // 配信本体が古い応答のときは承認の今の状態で補う。
    expect(PAGE).toContain("approvalInvolved(broadcast, approval.state)")
    expect(PAGE).toContain("approval={approval}")
  })

  it('取得失敗を配信なしと混ぜず、同じ画面で再読込できる', () => {
    expect(PAGE).toContain("setLoadState(error instanceof ApiError && error.status === 404 ? 'not-found' : 'error')")
    // 再読み込みは TargetMissing の error（onRetry が同じ画面の取り直し）。
    expect(PAGE).toContain('kind="error"')
    expect(PAGE).toContain('onRetry={() => setReloadToken((value) => value + 1)}')
  })

  it('期間集計ではなく配信自身の保存済みインサイトを読む', () => {
    expect(PAGE).toContain('api.broadcasts.getInsight(id)')
    expect(PAGE).not.toContain('api.analytics.broadcasts(selectedAccountId)')
  })

  it('画面にある実測値をCSVで書き出せる', () => {
    expect(PAGE).toContain('broadcastDetailCsv({')
    expect(PAGE).toContain('URL.revokeObjectURL(url)')
  })

  it('壊れた日時を Invalid Date のまま出さない', () => {
    expect(PAGE).toContain('formatBroadcastDateTime(broadcast.createdAt)')
    expect(PAGE).not.toContain('new Date(broadcast.createdAt).toLocaleString')
  })
})

describe('V6 一斉配信詳細の、取れない数の断り', () => {
  it('クリック率を開封で割った作り値にしない', () => {
    expect(PAGE).toContain("rateText(insight?.clickRate)")
  })

  it('集計は「未取得」と「読み込めなかった」を分ける', () => {
    expect(PAGE).toContain("useState<'loading' | 'ready' | 'error'>('loading')")
    expect(PAGE).toContain("setInsightState('error')")
  })

  it('送信が終わるまで失敗の数を出さない', () => {
    // total - success は、送信中だと「まだ送っていないぶん」を失敗に数える。
    expect(PAGE).not.toContain('・ 失敗 ${failed}`')
  })

  it('作り直しは押せる操作として置き、押せない言い訳を残さない', () => {
    // #605 で実動作へ接続。押せない前提の文言は消す。
    expect(PAGE).toContain('/broadcasts/new?duplicateFrom=')
  })
})

describe('V6 一斉配信詳細の、送信前の進み具合', () => {
  it('Progress は送信中だけに出す（下書き・予約では棒も回る印も出さない）', () => {
    // 予約しただけの配信に preparing の棒を出すと、送り始めているように見える。
    expect(PAGE).toContain('state="active"')
    expect(PAGE).not.toContain('state="preparing"')
    expect(PAGE).not.toContain('state="done"')
    expect(PAGE).not.toContain('state="partial"')
    expect(PAGE).toContain("broadcast.status === 'sending' ? (")
  })

  it('sent は SentResult の分かれ道へ行くので、完了の分岐をここに置かない', () => {
    expect(PAGE).toContain("const isSent = broadcast.status")
  })

  it('計測リンクのある配信だけ「押していない人へ追送」を出す', () => {
    expect(PAGE).toContain("insight?.links?.length && canEdit ? (")
    expect(PAGE).toContain("chaseHref(broadcast.id)")
    expect(PAGE).toContain("chaseHref(broadcast.id)")
    // 文面は元配信を種にする（宛先だけ差し替える）。
    expect(PAGE).toContain('duplicateFrom=')
  })
  it('予約しただけの配信を実行済みと書かない', () => {
    expect(PAGE).not.toContain("detail={broadcast.scheduledAt ? '予約どおり実行' : '即時配信'}")
    expect(PAGE).toContain('に送り始めます')
    expect(PAGE).toContain('まだ送っていません')
  })

  it('下書きを送信実績にせず、件数つきの進捗は送信中だけに出す', () => {
    expect(PAGE).toContain("broadcast.status !== 'draft'")
    expect(PAGE).toMatch(/broadcast\.status === 'sending'\s*\?\s*\(\s*<Progress/)
  })

})
