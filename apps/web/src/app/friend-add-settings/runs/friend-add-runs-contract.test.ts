import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const PAGE = fs.readFileSync(path.join(__dirname, 'page.tsx'), 'utf8')
const SETTINGS = fs.readFileSync(path.join(__dirname, '..', 'page.tsx'), 'utf8')
const HOOK = fs.readFileSync(path.join(__dirname, '..', 'use-cursor-stack.ts'), 'utf8')

describe('V6 友だち追加時配信・実行結果の契約', () => {
  it('実ノードと実行結果への往復導線を持つ', () => {
    expect(PAGE).toContain('data-design-node="P2J0Te"')
    expect(PAGE).toContain("usePageTitle('新規友だち初回案内・実行結果')")
    expect(PAGE).not.toContain('<Header')
    expect(SETTINGS).toContain('<Button href="/friend-add-settings/runs">実行結果を見る</Button>')
    expect(PAGE).toContain('href="/friend-add-settings">← 友だち追加時の配信</Link>')
  })

  it('選択中のアカウントと実行状態を新しい実行結果APIへ渡す', () => {
    expect(PAGE).toContain('api.friendAddRules.runs(selectedAccountId')
    expect(PAGE).toContain("status: routing === 'all' ? undefined : routing")
    // 種類・経路の絞り込みはサーバ側へ送る。取得済み20件への表示絞りでは
    // 2ページ目以降が漏れる。
    expect(PAGE).toContain("kind: kind === 'all' ? undefined : kind")
    expect(PAGE).toContain("attribution: attribution === 'all' ? undefined : attribution")
    expect(PAGE).not.toContain("kind === 'all' || item.friendKind === kind")
    expect(PAGE).not.toContain("attribution === 'all' || item.attribution.status === attribution")
    expect(PAGE).not.toContain('accounts[0]')
  })

  it('絞りの変更は巻き戻しと同時に1回だけ読み直す', () => {
    expect(PAGE).toContain('applyFilter({ kind:')
    expect(PAGE).toContain('applyFilter({ attribution:')
    expect(PAGE).toContain('applyFilter({ routing:')
    expect(PAGE).not.toContain('}, [attribution, kind, routing, selectedAccountId])')
  })

  it('アカウントを切り替えたあとの古い応答を表示しない', () => {
    expect(PAGE).toContain('const requestId = ++requestSequence.current')
    expect(PAGE).toContain('if (requestId !== requestSequence.current) return')
    expect(PAGE.indexOf('const requestId = ++requestSequence.current')).toBeLessThan(PAGE.indexOf('if (!selectedAccountId)'))
  })

  it('読込・空・失敗・アカウント未選択を同じ状態にしない', () => {
    expect(PAGE).toContain('<ListState kind="loading"')
    expect(PAGE).toContain('LINE公式アカウントを選んでください')
    expect(PAGE).toContain('kind="error"')
    expect(PAGE).toContain('条件に合う実行結果はありません')
    expect(PAGE).toContain('もう一度読み込む')
  })

  it('未取得の経路を0件や推測した経路として表示しない', () => {
    expect(PAGE).toContain("'経路は取得できません'")
    expect(PAGE).toContain("item.attribution.routeName || item.attribution.reason || '選択した経路'")
    expect(PAGE).not.toContain('entryRouteId}')
    expect(PAGE).not.toContain("'公式QRから追加'")
  })

  it('5つの処理状態を利用者の言葉で表示する', () => {
    expect(PAGE).toContain("pending: { label: 'テスト待ち'")
    expect(PAGE).toContain("completed: { label: '成功'")
    expect(PAGE).toContain("failed: { label: 'エラー'")
    expect(PAGE).toContain("suppressed: { label: '配信なし'")
    expect(PAGE).toContain("partial_failed: { label: '再送待ち'")
    expect(PAGE).toContain("{ value: 'partial_failed', label: '再送待ち' }")
  })

  it('将来の状態が来ても描画を落とさない', () => {
    expect(PAGE).toContain('UNKNOWN_ROUTING_LABEL')
    expect(PAGE).toContain('UNKNOWN_ROUTING_ACTION')
  })

  it('カーソルを積んだページ送りで前後へ移動できる', () => {
    expect(PAGE).toContain('useCursorStack()')
    expect(PAGE).toContain('onClick={() => goPrev()}')
    expect(PAGE).toContain('onClick={() => goNext(data.nextCursor)}')
    expect(PAGE).toContain('disabled={!data.nextCursor || loading}')
    expect(HOOK).toContain('current.length > 1 ? current.slice(0, -1) : current')
    expect(HOOK).toContain('setStack((current) => [...current, nextCursor])')
  })

  it('V6の実行結果をCSV・最近の結果・流入内訳・右欄で確認できる', () => {
    expect(PAGE).toContain('実行結果をCSVで書き出す')
    expect(PAGE).toContain('最近の友だち追加')
    expect(PAGE).toContain('流入経路別の内訳')
    expect(PAGE).toContain('稼働状況')
    expect(PAGE).toContain('要テスト')
    expect(PAGE).toContain('担当者シナリオ開始')
  })

  it('実配信・シナリオ開始・平均送信時間をAPI集計で表示する', () => {
    expect(PAGE).toContain('summary?.cumulativeDeliveries')
    expect(PAGE).toContain('summary?.scenarioStarts')
    expect(PAGE).toContain('summary?.averageSendTimeMs')
    expect(PAGE).toContain('summary?.staffHandoffs.reason')
    expect(PAGE).toContain('使用ルール・版・処理結果と一緒に一覧で確認できます。')
  })

  it('処理エラーと配信自体の稼働状態を混同しない', () => {
    // 稼働状況は実状態から出す。固定表示では停止中も稼働中に見える。
    expect(PAGE).toContain('{ruleStatusLabel}')
    expect(PAGE).toContain('{suppressionLabel}')
    expect(PAGE).not.toContain('<dt>状態</dt><dd className="font-bold">稼働中</dd>')
    expect(PAGE).toContain('このページに表示中の記録を、流入経路ごとに確認できます。')
  })

  it('停止したら状態を読み直す', () => {
    expect(PAGE).toContain('await load()')
    expect(PAGE).toContain('await loadRuleState()')
  })

  it('CSV書き出しは式として動かない形にし、範囲を明記する', () => {
    expect(PAGE).toContain("import { csvCell } from './csv'")
    expect(PAGE).toContain('CSVの書き出しもこのページに表示中の記録だけです')
  })

  it('固定IDの導線を持たない', () => {
    // fixture の ID が無い環境で404・空画面になる。
    expect(PAGE).not.toContain('rule-referral')
    expect(PAGE).toContain('editHref')
  })
})
