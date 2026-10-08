import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const PAGE = readFileSync(new URL('../../v8/templates/list.tsx', import.meta.url), 'utf8')

/**
 * テンプレート一覧（設計 `W7LBc` 11-1）の、状態と押し口。
 *
 * リッチメッセージ作成（設計 `j9ixI` 11-1-D）に当たるルートは無い。
 * 作らずに、要る口を引き継ぎに書いた（2026-10-07 にリポジトリから外した）。
 */
describe('テンプレート一覧の状態と押し口', () => {

  it('読込中・権限不足・取得失敗・初回空・0件を言い分ける', () => {
expect(PAGE).toContain('const view = listView({')
    expect(PAGE).toContain("view === 'forbidden'")
    expect(PAGE).toContain("view === 'error'")
    expect(PAGE).toContain('filtered={filterActive}')
    expect(PAGE).toContain('<EmptyList')
  })

  it('取得失敗は読み直せる形で出す', () => {
expect(PAGE).toContain("view === 'error' &&")
    expect(PAGE).toContain('onClick={() => void load()}')
    expect(PAGE).toContain('failure?.title')
  })

  it('一覧の読み込み失敗を、操作の失敗と同じ帯に混ぜない', () => {
    // 混ぜると「削除に失敗しました」が読み込み失敗の場所に出る。
    expect(PAGE).toContain('const [failure, setFailure]')
    expect(PAGE).toContain('setFailure(failureOf(e))')
    expect(PAGE).toContain('setFailure(failureOfResponse())')
    expect(PAGE).not.toContain("setError('テンプレートの読み込みに失敗しました。')")
  })

  it('読み込めていないあいだ、作成を押せる形で置かない', () => {
expect(PAGE).toContain('disabled={createBlocked !== null}')
    expect(PAGE).toContain('createBlocked ?? undefined')
  })

  it('実送信数は今月分を表示し、未取得を0にしない', () => {
expect(PAGE).toContain('sendCountText(t)')
    expect(PAGE).toContain('formatNumber(t.totalSendCount)')
    expect(PAGE.slice(PAGE.indexOf('function sendCountText'), PAGE.indexOf('function publishStateOf'))).not.toContain('?? 0')
    expect(PAGE).toContain('monthlyAllKnown ?')
  })
})
