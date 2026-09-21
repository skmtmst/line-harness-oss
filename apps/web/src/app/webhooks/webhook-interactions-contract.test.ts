import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(join(import.meta.dirname, 'webhook-interactions.tsx'), 'utf8')
const HOST = readFileSync(join(import.meta.dirname, 'page.tsx'), 'utf8')
const API = readFileSync(join(import.meta.dirname, '..', '..', 'lib', 'api.ts'), 'utf8')

describe('V6 外部連携・やり取りの記録 KNG00', () => {
  it('実ノードと実ルートを接続する', () => {
    expect(PAGE).toContain('data-design-node="KNG00"')
    expect(HOST).toContain("{ key: 'interactions', label: 'やり取りの記録' }")
    expect(HOST).toContain("{ key: 'outgoing', label: 'こちらから送る' }")
    expect(HOST).toContain("tab === 'interactions' && <WebhookInteractions />")
    expect(API).toContain('/api/webhooks/interactions?')
  })

  it('タブの件数は固定値でなく、一覧の取得結果の総数に接続する(#980)', () => {
    // 設計が描いた作り物の件数を書かない。一覧0件のアカウントでも
    // 「こちらから送る 6」「こちらで受け取る 3」と出ていた。
    expect(HOST).not.toContain("'こちらから送る 6'")
    expect(HOST).not.toContain("'こちらで受け取る 3'")
    expect(HOST).not.toContain("'見本 14'")
    // 「送る」「受け取る」は、選択中アカウントで絞った一覧と同じ配列の
    // 総数を、取れたとき（status==='ready'）だけ付ける。
    expect(HOST).toContain("outgoingStatus === 'ready'")
    expect(HOST).toContain("incomingStatus === 'ready'")
    expect(HOST).toContain('`${item.label} ${outgoing.length}`')
    expect(HOST).toContain('`${item.label} ${incoming.length}`')
    // 「見本」は画面に並べる見本データから別集計する。
    expect(HOST).toContain('`見本 ${SOURCE_PRESETS.length + OUTGOING_SAMPLES.length}`')
  })

  it('読込・空・失敗を分け、未取得を0件と見せない', () => {
    expect(PAGE).toContain('kind="loading"')
    expect(PAGE).toContain('kind="empty"')
    expect(PAGE).toContain('kind="error"')
    expect(PAGE).toContain('value={data.summary.averageDurationMs == null ? null')
    expect(PAGE).toContain('日は未取得')
  })

  it('遅れと成功率に対象期間を書く(IDEA-26)', () => {
    // 「いつからの数字か」が分からないと遅い・悪いの判断が付かない。
    // 成功・返事までの時間・未取得の各補足に選択中の期間を入れる。
    expect(PAGE).toContain('この${periodDays}日で ${successRate.toLocaleString')
    expect(PAGE).toContain('この${periodDays}日でいちばん遅くて')
    expect(PAGE).toContain('この${periodDays}日は未取得')
    expect(PAGE).toContain('この${periodDays}日の送受信の処理時間')
  })

  it('結果が分からない失敗を無条件に再送しない(IDEA-26)', () => {
    // 単体: 相手先で確かめた確認を挟んでから confirmed=true で送る。
    expect(PAGE).toContain("item.failureReasonCode === 'unknown'")
    expect(PAGE).toContain('setConfirmingRetry(item)')
    expect(PAGE).toContain('確かめたので送り直す')
    expect(PAGE).toContain('void retry(confirmingRetry, true)')
    // まとめて: 結果不明は送らず件数だけ返し、1件ずつの復旧を案内する。
    expect(PAGE).toContain('response.data.needsReview')
    expect(PAGE).toContain('確かめてから、一覧で1件ずつやり直してください')
    expect(API).toContain('JSON.stringify({ confirmed: options?.confirmed === true })')
  })

  it('やり直せる範囲とやり直し済みのつながりを業務の言葉で示す(IDEA-26)', () => {
    expect(PAGE).toContain('retryabilityText(selected, canRetry)')
    expect(PAGE).toContain('前の失敗をやり直した記録')
    expect(PAGE).toContain('送り直せるのは管理者です')
    expect(PAGE).toContain('相手側でもう一度送ってもらってください')
    expect(PAGE).toContain('data.summary.resultUnknown')
  })

  it('技術的な記録は必要なときだけ開き、秘密情報はそこにも出さない(IDEA-26)', () => {
    expect(PAGE).toContain('技術的な記録を開く')
    expect(PAGE).toContain('{selected.eventType}')
    expect(PAGE).toContain('{selected.responseStatus')
    expect(PAGE).toContain('{selected.retryOfId')
    expect(PAGE).not.toContain('request_body_json')
    expect(PAGE).not.toContain('requestBodyJson')
  })

  it('URL・シークレット・本文を画面へ出さず、内部エラーも表示しない', () => {
    expect(PAGE).toContain('接続先URL、シークレット、本文は安全のため表示しません。')
    expect(PAGE).toContain('title={item.triggerSummary}>{item.triggerSummary}')
    expect(PAGE).toContain('安全のため本文と接続情報は一覧に表示しません')
    expect(PAGE).not.toContain('API error:')
    expect(PAGE).not.toContain('Failed to fetch')
    expect(PAGE).not.toContain('requestBodyJson')
    expect(PAGE).not.toContain('idempotencyKey')
  })

  it('送り直しは管理者だけに見せ、単体と一括の両方を持つ', () => {
    expect(PAGE).toContain("role === 'owner' || role === 'admin'")
    expect(PAGE).toContain('失敗したものをまとめてやり直す')
    expect(PAGE).toContain("canRetry && item.canRetry ? <Button")
  })

  it('アカウント切替後に前の記録や送り直し結果を表示しない', () => {
    expect(PAGE).toContain('const requestGeneration = ++loadGenerationRef.current')
    expect(PAGE).toContain('loadGenerationRef.current !== requestGeneration')
    expect(PAGE).toContain('selectedAccountIdRef.current !== requestAccountId')
    expect(PAGE).toContain('loadedAccountId !== requestAccountId')
    expect(PAGE).toContain('if (selectedAccountIdRef.current === requestAccountId) setRetrying(null)')
    expect(PAGE).toContain('if (selectedAccountIdRef.current === requestAccountId) setBulkRetrying(false)')
  })

  it('本文に画面タイトルや説明を重ねない', () => {
    expect(PAGE).not.toContain('<Header')
    expect(PAGE).not.toContain('<h1')
  })
})
