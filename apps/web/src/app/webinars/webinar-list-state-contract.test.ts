import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const VIEW = fs.readFileSync(path.join(__dirname, 'overview-view.ts'), 'utf8')
const PAGE = fs.readFileSync(path.join(__dirname, 'page.tsx'), 'utf8')

describe('V6 ウェビナー一覧の状態契約', () => {
  it('読込・空・失敗・権限不足を共通部品で言い分ける', () => {
    expect(PAGE).toContain('ListState kind="loading"')
    expect(PAGE).toContain("kind: 'error'")
    expect(PAGE).toContain("kind: 'forbidden'")
    expect(PAGE).toContain('ウェビナーがまだありません')
    expect(PAGE.indexOf(': loadFailure ? (')).toBeLessThan(PAGE.indexOf(': shown.length === 0 ? ('))
  })

  it('失敗時に内部のエラー文を画面へ流さない', () => {
    expect(PAGE).toContain('webinarLoadFailure(e)')
    expect(PAGE).toContain('error instanceof ApiError && error.status === 403')
    expect(PAGE).toContain('error instanceof ApiError && error.status === 429')
    expect(PAGE).not.toContain('e instanceof Error ? e.message : String(e)')
    expect(PAGE).not.toContain('{error}')
  })

  it('未取得を0件と表示せず、再読み込みできる', () => {
    /*
      帯は一覧の件数を数えるのをやめ、`GET /api/webinars/overview` を読む。
      **確かめたいのは「未取得を0件にしない」ことなので、口の
      `state`/`reason` をそのまま出しているかを見る。**
      数え方の式そのものではなく、判断の置き場所を見張る。
    */
    expect(PAGE).toContain("const hasListData = !loading && loadFailure === null")
    expect(PAGE).toContain('overviewCards(overview)')
    expect(VIEW).toContain("metric.state !== 'available' || metric.value === null")
    expect(VIEW).toContain('metric?.reason ??')
    expect(PAGE).toContain('onClick={() => void refresh()}')
    expect(PAGE).toContain('もう一度読み込む')
  })

  it('集計の失敗を0件や「まだありません」にしない', () => {
    // 失敗のときは帯ごと失敗として描き、読み直せるようにする。
    expect(PAGE).toContain('overviewFailure ? (')
    expect(PAGE).toContain('集計を読み直す')
    expect(PAGE).toContain('setOverviewFailure(webinarLoadFailure(e))')
  })

  it('アカウントを切り替えたら前の集計をその場で捨てる', () => {
    /*
      読み終わるまで前の数字を残すと、別のアカウントの数を見たまま
      操作することになる。
    */
    const refresh = PAGE.slice(PAGE.indexOf('const refreshOverview'), PAGE.indexOf('useEffect(() => {'))
    /*
      **在ることを先に確かめる。** `indexOf` は無いとき -1 を返すので、
      順番だけを見ると「消しても通る」試験になる（実際に一度そうなった）。
    */
    expect(refresh).toContain('setOverview(null)')
    expect(refresh).toContain('setOverviewFailure(null)')
    expect(refresh.indexOf('setOverview(null)')).toBeLessThan(refresh.indexOf('await webinarApi.overview'))
    expect(refresh).toContain('overviewRef.current.generation === at.generation')
    expect(refresh).toContain('overviewRef.current.accountId === at.accountId')
  })

  it('申込の実人数と延べ予約を混ぜない', () => {
    expect(VIEW).toContain("title: '申込'")
    expect(VIEW).toContain('延べ予約')
    expect(VIEW).toContain('registrationBookings')
  })

  it('CTAは押した実人数で、内部語を出さない', () => {
    expect(VIEW).toContain('ctaUniquePeople')
    expect(VIEW).toContain("title: 'CTAを押した人'")
    expect(VIEW).not.toContain('active_registrations\'')
  })
})
