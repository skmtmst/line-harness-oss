import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

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
    expect(PAGE).toContain("const hasListData = !loading && loadFailure === null")
    expect(PAGE).toContain("hasListData ? items.length : '—'")
    expect(PAGE).toContain("items.filter((w) => w.status === 'active').length : '—'")
    expect(PAGE).toContain('onClick={() => void refresh()}')
    expect(PAGE).toContain('もう一度読み込む')
  })
})
