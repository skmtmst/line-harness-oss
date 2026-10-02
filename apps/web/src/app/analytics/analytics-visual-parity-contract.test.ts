import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8')

describe('V6 機能20の画面比較で直した契約', () => {
  it('概要4画面に設計の判断材料を残す', () => {
    for (const text of [
      '日ごとの増減（この{days}日）',
      // 監査 R71: 集計はクリック時刻の時間帯。送った時刻ではないので名前を実態に合わせた。
      '押された時間帯ごとの回数',
      '売上から広告費を引いた残り',
      '項目が多いほど良い、ではありません',
    ]) expect(PAGE).toContain(text)

    for (const metric of [
      'item.clicks',
      'item.currentFriends',
      'item.conversions.pending',
      'item.conversions.rejected',
      'item.costPerFriend',
      'item.costPerConversion',
    ]) expect(PAGE).toContain(`metric={${metric}}`)
  })

  it('詳細4画面に説明・検索・書き出しを置く', () => {
    for (const text of [
      'LINEで開かれたかどうかは取れないため',
      'まだ途中の人は完了した人に含めません',
      'URL・配信名・リンク名で探す',
      '分析名・作った人で探す',
    ]) expect(PAGE).toContain(text)
    expect(PAGE).toContain('CSVで書き出す')
  })

  it('APIが16.9と返すクリック率を1690%にしない', () => {
    expect(PAGE).not.toContain('<MetricCell metric={item.clickRate} percent')
    expect(PAGE).toContain("<span>{shownValue(item.clickRate)}%</span>")
  })

  it('分析表はPC幅で横スクロールを作らない', () => {
    expect(PAGE).not.toContain('overflow-x-auto')
    expect(PAGE).not.toContain('min-w-[600px]')
    expect(PAGE).not.toContain('min-w-[760px]')
  })

  it('監査 R225: シナリオの送信通数は人数と分けて出す', () => {
    // 送信ログは「届いた人数」ではない。通数は対象の下に併記し、
    // 到達の列・合計には混ぜない。
    expect(PAGE).toContain('送信 <MetricCell metric={item.sentMessages} />通')
    expect(PAGE).toContain("'送信通数'")
    expect(PAGE).toContain('一斉配信で届いた人数です。シナリオは届いた人数が取れないため「—」です')
  })

  it('監査 R226: 保存済み分析の絞り込み0件は一覧の空とは区別する', () => {
    expect(PAGE).toContain('条件に合う保存済み分析はありません')
    expect(PAGE).toContain('一覧から分析を選んでください')
  })
})
