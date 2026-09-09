/*
 * `/ec-commerce`（設計 `eI3gs`）が、一覧を読めなかったときに
 * **本文ごと消えない**ことの契約。
 *
 * 起きたこと（2026-09-02）: `api.ecCommerce.events` の返事が配列でないと、
 * `success` が真のまま非配列が state に入り、描画の途中で
 * `events.map is not a function` を投げていた。エラー境界が本文を丸ごと
 * 「画面を表示できませんでした」に差し替えるので、**撮ると空の絵になる。**
 * 上の口ひとつが読めないだけで、KPI もイベント履歴も設定も全部消える。
 *
 * 形を確かめてから state に入れ、読めなければ理由を帯に出す、を見張る。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'page.tsx'), 'utf8')

describe('V6 23-1 EC連携の読み込み', () => {
  it('集計と取込一覧を別々に読み込み、片方の失敗で両方を消さない', () => {
    expect(source).toContain('const loadOverview = useCallback')
    expect(source).toContain('const loadRecords = useCallback')
    expect(source).toContain('setOverviewSlot')
    expect(source).toContain('setRecordsSlot')
    expect(source).not.toContain('Promise.all([')
  })

  it('取込一覧の形を確かめてからstateへ入れる', () => {
    const guard = source.indexOf('Array.isArray(response.data?.items)')
    const assign = source.indexOf('items: response.data.items')
    expect(guard).toBeGreaterThan(-1)
    expect(assign).toBeGreaterThan(-1)
    expect(guard).toBeLessThan(assign)
  })

  it('失敗箇所と、それぞれの再読み込み操作を本文に出す', () => {
    expect(source).toContain('集計だけを読み込めませんでした')
    expect(source).toContain('集計をもう一度読む')
    expect(source).toContain('取り込みの記録を読み込めませんでした')
    expect(source).toContain('onRetry={listState')
  })
})

/*
 * 起きたこと(2026-09-09, #685): アカウントAで集計111件を出したあとBへ切り替え、
 * Bの集計が500/403で落ちると、Aの111件がBの数字として残っていた。
 * 取得した値を取得元アカウントと一体で持ち、描く前に突き合わせる、を見張る。
 */
describe('V6 23-1 EC連携のアカウント切替', () => {
  it('集計も一覧も取得元アカウントと一体で持つ', () => {
    expect(source).toContain('type AccountBound<T> = { accountId: string | null; state: LoadState; data: T }')
    expect(source).toContain('useState<AccountBound<OverviewWithLatency | null>>')
    expect(source).toContain('useState<AccountBound<ImportRecords>>')
  })

  it('切替時は効果を待たず、描画の時点で取得元の違う値を捨てる', () => {
    expect(source).toContain('function boundTo<T>(slot: AccountBound<T>, accountId: string | null, empty: T)')
    expect(source).toContain('return slot.accountId === accountId ? slot : pendingFor(accountId, empty)')
    expect(source).toContain('const overviewView = boundTo(overviewSlot, accountId, null)')
    expect(source).toContain('const recordsView = boundTo(recordsSlot, accountId, EMPTY_RECORDS)')
    /* 切替の後始末を useEffect に任せると、その一描画ぶん前の値が見える。 */
    expect(source).not.toContain('}, [accountId])\n\n  const pageCount')
  })

  it('失敗時に前の値を残すのは同じアカウントの取り直しだけに限る', () => {
    const keeps = source.match(/data: prev\.accountId === accountId \? prev\.data : (null|EMPTY_RECORDS)/g) ?? []
    expect(keeps.length).toBe(4)
    expect(source).not.toContain('data: prev.data,')
  })

  it('ページとお知らせもアカウントと一体で持ち、切替で持ち越さない', () => {
    expect(source).toContain('const page = pageSlot.accountId === accountId ? pageSlot.page : 1')
    expect(source).toContain('const notice = noticeSlot.accountId === accountId ? noticeSlot.notice : null')
  })
})

/*
 * 起きたこと(2026-09-09, #685再差し戻し): アカウントAで再試行を始め、応答が
 * 返る前にBへ切り替えると、retry()が抱えたA向けのloadRecords(false)が
 * 共有listLoadSeqを進め、Bの正常な一覧応答をseq不一致で捨てていた。
 * Bは読み込み中のまま固まる。retryingIdもアカウントに結び付いていなかった。
 * accountIdRefで最新アカウントと突き合わせ、古いクロージャの呼び出しを
 * 共有seqに触れる前に止める、を見張る。
 */
describe('V6 23-1 EC連携の再試行とアカウント切替の順序', () => {
  it('最新アカウントをrefで持ち、描画本体で直接更新する', () => {
    expect(source).toContain('const currentAccountIdRef = useRef(accountId)')
    expect(source).toContain('currentAccountIdRef.current = accountId')
  })

  it('loadOverview/loadRecordsは古いクロージャからの呼び出しを共有seqに触れる前に弾く', () => {
    const loadOverviewIdx = source.indexOf('const loadOverview = useCallback')
    const loadOverviewGuardIdx = source.indexOf('if (accountId !== currentAccountIdRef.current) return', loadOverviewIdx)
    const overviewSeqIdx = source.indexOf('const seq = overviewLoadSeq.current + 1')
    expect(loadOverviewGuardIdx).toBeGreaterThan(loadOverviewIdx)
    expect(loadOverviewGuardIdx).toBeLessThan(overviewSeqIdx)

    const loadRecordsIdx = source.indexOf('const loadRecords = useCallback')
    const loadRecordsGuardIdx = source.indexOf('if (accountId !== currentAccountIdRef.current) return', loadRecordsIdx)
    const listSeqIdx = source.indexOf('const seq = listLoadSeq.current + 1')
    expect(loadRecordsGuardIdx).toBeGreaterThan(loadRecordsIdx)
    expect(loadRecordsGuardIdx).toBeLessThan(listSeqIdx)
  })

  it('retryingIdはアカウントと一体で持つ', () => {
    expect(source).toContain("useState<{ accountId: string | null; id: string | null }>({ accountId, id: null })")
    expect(source).toContain('const retryingId = retryingSlot.accountId === accountId ? retryingSlot.id : null')
  })

  it('retry()は応答待ちの間に切り替えられたら、お知らせも再読込も行わない', () => {
    const retryIdx = source.indexOf('const retry = async (action: EcActionExecution)')
    const guards = source.slice(retryIdx).match(/if \(retryAccountId !== currentAccountIdRef\.current\) return/g) ?? []
    expect(guards.length).toBe(2)
  })

  it('retryingSlotの後始末は、同じ再試行のぶんだけを消す', () => {
    expect(source).toContain(
      'setRetryingSlot((prev) => (prev.accountId === retryAccountId && prev.id === action.id ? { accountId: retryAccountId, id: null } : prev))',
    )
  })
})
