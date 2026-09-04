import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const PAGE = fs.readFileSync(path.join(__dirname, 'page.tsx'), 'utf8')

describe('V6 一斉配信詳細の契約', () => {
  it('配信内容を見る操作を、同じ画面の送信内容へ接続する', () => {
    expect(PAGE).toContain("contentRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })")
    expect(PAGE).toContain('id="broadcast-content"')
    expect(PAGE).not.toContain('配信内容の別画面は準備中です')
  })

  it('配信が読めるまでは内容への操作を押せない', () => {
    expect(PAGE).toContain('disabled={!broadcast}')
  })

  it('取得失敗を配信なしと混ぜず、同じ画面で再読込できる', () => {
    expect(PAGE).toContain("setLoadState(error instanceof ApiError && error.status === 404 ? 'not-found' : 'error')")
    expect(PAGE).toContain('配信を読み込めませんでした')
    expect(PAGE).toContain('配信を再読み込み')
  })

  it('期間集計ではなく配信自身の保存済みインサイトを読む', () => {
    expect(PAGE).toContain('api.broadcasts.getInsight(id)')
    expect(PAGE).not.toContain('api.analytics.broadcasts(selectedAccountId)')
  })

  it('画面にある実測値をCSVで書き出せる', () => {
    expect(PAGE).toContain('CSVで書き出す')
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
    // 保存側は `unique_click / delivered`。画面だけ開封を母数にすると、
    // どこにも保存されていない割合をその場で作ることになる。
    expect(PAGE).not.toContain('開封のうち ')
    expect(PAGE).toContain('clickInsightDetail(insight)')
  })

  it('集計は「未取得」と「読み込めなかった」を分ける', () => {
    expect(PAGE).toContain("useState<'loading' | 'ready' | 'error'>('loading')")
    expect(PAGE).toContain("setInsightState('error')")
    expect(PAGE).toContain('読み込んでいます')
    expect(PAGE).toContain('読み込めませんでした')
    expect(PAGE).toContain('集計を再読み込み')
  })

  it('送信が終わるまで失敗の数を出さない', () => {
    // total - success は、送信中だと「まだ送っていないぶん」を失敗に数える。
    expect(PAGE).not.toContain('・ 失敗 ${failed}`')
    expect(PAGE).toContain('送信中のため、失敗の数は終わってから確定します')
    expect(PAGE).toContain('送信前のため、到達はまだありません')
  })

  it('予約しただけの配信を実行済みと書かない', () => {
    expect(PAGE).not.toContain("detail={broadcast.scheduledAt ? '予約どおり実行' : '即時配信'}")
    expect(PAGE).toContain('予約した時刻に実行します')
    expect(PAGE).toContain('まだ送っていません')
  })

  it('押せない操作の理由を吹き出しだけに置かない', () => {
    expect(PAGE).toContain('種にして作り直す口がまだないため押せません')
  })
})
