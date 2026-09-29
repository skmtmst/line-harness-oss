import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const PAGE = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8')

/**
 * M018：読み込み失敗が「未登録」と誤表示され、再試行口もない。
 * 失敗と 0 件を分け、失敗面には再試行口を付ける。
 *
 * M019：移行の失敗が一律の汎用文で、ボタンも権限を見ない。
 * 403 は権限不足として区別し、ボタンは押せる役割のときだけ出す。
 */
describe('M018/M019 監視の失敗表示', () => {
  it('アカウント読込の失敗を空（未登録）と分け、再試行口を出す（M018）', () => {
    expect(PAGE).toContain('accountsError')
    expect(PAGE).toContain('onRetry={() => void loadAccounts()}')
    // 失敗なのに登録へ誘導しない。
    expect(PAGE).not.toContain('アカウント情報の取得に失敗しました。もう一度読み込んでください。')
    expect(PAGE).not.toContain('アカウント情報の読み込みに失敗しました。もう一度お試しください。')
  })

  it('移行の失敗は 403 を権限不足として区別する（M019）', () => {
    expect(PAGE).toContain('describeApiFailure(')
    expect(PAGE).toContain('友だちの移行はオーナーだけができます')
    expect(PAGE).not.toContain('移行リクエストに失敗しました。通信を確かめて、もう一度お試しください。')
  })

  it('移行ボタンは押せる役割のときだけ出す（M019）', () => {
    expect(PAGE).toContain("localStorage.getItem('lh_staff_role')")
    expect(PAGE).toContain('友だちの移行はオーナーだけができます')
  })
})
