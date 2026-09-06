import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8')

describe('V6 機能20の画面比較で直した契約', () => {
  it('概要4画面に設計の判断材料を残す', () => {
    for (const text of [
      '日ごとの増減（この30日）',
      '送った時間ごとの「押された回数」',
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
      'CSVで書き出す',
    ]) expect(PAGE).toContain(text)
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
})
