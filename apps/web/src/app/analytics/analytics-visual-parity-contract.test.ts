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

  it('板 u5CuB8: クロス表の字は見本どおり（列見出し11・行と数12・700禁止）', () => {
    // 見本 lint/V8-B/u5CuB8.html：列見出し 11px/600、行札 12px/600、数 12px/700。
    // 700は管理画面の決まりで使わないので600に寄せる。
    expect(PAGE).toContain('className="text-micro px-4 py-3 font-semibold whitespace-normal"')
    expect(PAGE).toContain('className="text-ink text-caption px-4 py-3 font-semibold"')
    expect(PAGE).toContain('text-caption w-full px-4 py-3 text-right font-semibold tabular-nums')
    expect(PAGE).not.toContain('className="px-4 py-3 text-xs whitespace-normal"')
    expect(PAGE).not.toContain('className="text-ink px-4 py-3 text-sm font-medium">{row.label}')
  })

  it('板 DkRDE: ファネル作成ボタンの字は見本どおり（13・600）', () => {
    // 見本 lint/V8-B/DkRDE.html：「ファネルを作る」は 13px/600。
    expect(PAGE).toContain('text-label px-3 py-1.5 font-semibold h-auto whitespace-normal')
  })

  it('板 DkRDE: 段の行の字は見本どおり（12・段名500）', () => {
    // 見本 lint/V8-B/DkRDE.html：段名 12px/500、補足 12px/400。
    expect(PAGE).toContain('className="text-ink text-caption font-medium"')
    expect(PAGE).toContain('className="text-ink-secondary text-caption tabular-nums"')
  })
})
