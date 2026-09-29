import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const PAGE = fs.readFileSync(path.join(__dirname, 'page.tsx'), 'utf8')
const DETAIL = fs.readFileSync(path.join(__dirname, 'detail', 'page.tsx'), 'utf8')
const RUN_STATUS = fs.readFileSync(path.join(__dirname, 'run-status.ts'), 'utf8')
const SETTINGS = fs.readFileSync(path.join(__dirname, '..', 'page.tsx'), 'utf8')
const HOOK = fs.readFileSync(path.join(__dirname, '..', 'use-cursor-stack.ts'), 'utf8')

describe('V6 友だち追加時配信・実行結果の契約', () => {
  it('実ノードと実行結果への往復導線を持つ', () => {
    expect(PAGE).toContain('data-design-node="P2J0Te"')
    expect(PAGE).toContain("usePageTitle('新規友だち初回案内・実行結果')")
    expect(PAGE).not.toContain('<Header')
    expect(SETTINGS).toContain('<Button href="/friend-add-settings/runs">実行結果を見る</Button>')
    expect(PAGE).toContain('href="/friend-add-settings">← 友だち追加時の配信</Link>')
    // 詳細へのリンクは今の絞り込み・ページ位置を引き継ぐ（R268）
    expect(PAGE).toContain('href={detailHref(item.id)}')
    expect(PAGE).toContain("params.set('id', id)")
    expect(PAGE).toContain("params.set('pages', trail)")
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
    // 状態の言葉は一覧と詳細で共有する（R267）
    expect(RUN_STATUS).toContain("pending: { label: 'テスト待ち'")
    expect(RUN_STATUS).toContain("completed: { label: '成功'")
    expect(RUN_STATUS).toContain("failed: { label: 'エラー'")
    expect(RUN_STATUS).toContain("suppressed: { label: '配信なし'")
    expect(RUN_STATUS).toContain("partial_failed: { label: '再送待ち'")
    expect(PAGE).toContain("{ value: 'partial_failed', label: '再送待ち' }")
  })

  it('送達不明は「再送待ち」と別に見せる（自動では送り直さない）', () => {
    expect(RUN_STATUS).toContain("const DELIVERY_UNKNOWN_CODE = 'delivery_unknown'")
    expect(RUN_STATUS).toContain("DELIVERY_UNKNOWN_LABEL = { label: '送達不明', tone: 'danger' }")
    expect(RUN_STATUS).toContain('送達不明・要確認（自動では送り直しません）')
    // 一覧の見出し・行動文・CSV・詳細のどれも同じ判定を通す（R267）
    expect(PAGE).toContain('routingLabel(item.status, item.errorCode)')
    expect(PAGE).toContain('routingAction(item.status, item.errorCode)')
    expect(DETAIL).toContain('routingLabel(detail.status, detail.errorCode)')
    expect(DETAIL).toContain('detail.errorCode === DELIVERY_UNKNOWN_CODE')
    expect(PAGE).not.toContain('ROUTING_LABELS[item.status] ??')
    expect(PAGE).not.toContain('ROUTING_ACTIONS[item.status] ??')
  })

  it('将来の状態が来ても描画を落とさない', () => {
    expect(RUN_STATUS).toContain('UNKNOWN_ROUTING_LABEL')
    expect(RUN_STATUS).toContain('UNKNOWN_ROUTING_ACTION')
  })

  it('カーソルを積んだページ送りで前後へ移動できる', () => {
    expect(PAGE).toContain('useCursorStack(')
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

  it('CSV書き出しは式として動かない形にし、範囲を明記する(#946 N-111)', () => {
    expect(PAGE).toContain("import { csvCell } from './csv'")
    /*
     * 表示中の20件だけではなく、今の絞り込みに合う記録をカーソルで
     * 全頁読んで書き出す。上限で切れたときは画面へ断る。
     */
    expect(PAGE).toContain('limit: CSV_EXPORT_PAGE_SIZE')
    expect(PAGE).toContain('exportCursor = response.data.nextCursor ?? undefined')
    expect(PAGE).toContain('CSV_EXPORT_MAX_PAGES')
    expect(PAGE).toContain('それより古い記録は含まれていません')
    expect(PAGE).toContain('CSVは絞り込みに合う記録を新しい順にすべて書き出します')
    expect(PAGE).not.toContain('CSVの書き出しもこのページに表示中の記録だけです')
    // 書き出しの絞りは一覧と同じ条件をサーバへ送る（一覧取得とCSV取得の2か所）
    expect(PAGE.match(/ruleId: ruleIdFilter \?\? undefined/g)?.length).toBe(2)
    expect(PAGE.match(/status: routing === 'all' \? undefined : routing/g)?.length).toBe(2)
  })

  it('設定別の実行結果は rule_id をサーバ側の絞り込みへ渡す(#946 N-107)', () => {
    // 一覧の「その他操作」→「この設定の実行結果」の行き先。
    expect(PAGE).toContain("searchParams.get('rule_id')")
    expect(PAGE).toContain('ruleId: ruleIdFilter ?? undefined')
    expect(PAGE).toContain('この設定の実行結果だけを表示しています')
    expect(SETTINGS).toContain('`/friend-add-settings/runs?rule_id=${encodeURIComponent(rule.id)}`')
  })

  it('固定IDの導線を持たない', () => {
    // fixture の ID が無い環境で404・空画面になる。
    expect(PAGE).not.toContain('rule-referral')
    expect(PAGE).toContain('editHref')
  })

  /*
   * R264: 「直近28日の追加」は人数（ユニーク友だち）と回数（記録数）を
   * 分けて出し、集計は今の絞り込みの中だけを対象にする。
   */
  it('直近28日の追加は人数と回数を分け、絞り込みの対象範囲を明示する', () => {
    expect(PAGE).toContain('summary?.recentFriends')
    expect(PAGE).toContain('summary.recentEvents')
    expect(PAGE).not.toContain('summary?.totalRuns')
    expect(PAGE).toContain('上の集計は、今の絞り込みに合う記録だけを対象にしています。')
  })

  /*
   * R266: 「最終配信」は実際に送った記録の最新日時（MAX(first_delivery_sent_at)）。
   * 一覧先頭行の処理時刻を時刻だけで出すと、配信0件の記録を「最後に送った
   * 時刻」と誤認し、日付も落ちる。
   */
  it('最終配信は実送信の最新日時を日付つきで出す', () => {
    expect(PAGE).toContain('formatJstDateTime(summary.lastDeliveryAt)')
    expect(PAGE).not.toContain('latestProcessedAt')
    expect(PAGE).not.toContain('formatJstTime')
    // 未取得（読込中）と未送信（0件）を区別する
    expect(PAGE).toContain("'まだありません'")
  })

  /*
   * R268: 絞り込みとページ位置はURLが持つ。詳細へ進んで「実行結果へ戻る」と
   * 同じ条件・同じページへ戻れる。
   */
  it('絞り込みとページ位置をURLに持ち、詳細からの戻りで復元する', () => {
    expect(PAGE).toContain("searchParams.get('kind')")
    expect(PAGE).toContain("searchParams.get('status')")
    expect(PAGE).toContain("searchParams.get('attribution')")
    expect(PAGE).toContain("searchParams.get('pages')")
    // 絞り込みの変更はURLへ書き戻す（画面内だけのstateにしない）
    expect(PAGE).toContain('router.replace(`?${params.toString()}`, { scroll: false })')
    // 詳細の戻り先は受け取った条件をそのまま返す
    expect(DETAIL).toContain("for (const key of ['kind', 'status', 'attribution', 'rule_id', 'pages'])")
    expect(DETAIL).toContain('href={listHref}')
    expect(DETAIL).not.toContain('href="/friend-add-settings/runs"')
  })

  /*
   * R265: 詳細の先頭に日時・追加の種類・経路・適用ルールと版・記録IDを置き、
   * 同じ友だちの別の記録を詳細だけで見分けられるようにする。
   */
  it('実行詳細は受信日時・経路・適用ルール・記録IDを示す', () => {
    expect(DETAIL).toContain('受信日時')
    expect(DETAIL).toContain('処理日時')
    expect(DETAIL).toContain('追加の種類')
    expect(DETAIL).toContain('流入経路')
    expect(DETAIL).toContain('適用ルール')
    expect(DETAIL).toContain('記録ID')
    expect(DETAIL).toContain('formatJstDateTime(detail.receivedAt)')
    expect(DETAIL).toContain('formatJstDateTime(detail.processedAt)')
    expect(DETAIL).toContain('detail.attribution.routeName')
    expect(DETAIL).toContain('versionNumber')
  })
})
