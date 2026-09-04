import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { ApiError } from '@/lib/api'

import { webinarLoadFailure } from './webinar-load-failure'

const HERE = dirname(fileURLToPath(import.meta.url))
const PAGE = readFileSync(join(HERE, 'page.tsx'), 'utf8')

/**
 * ウェビナー一覧（設計 `ZC13r` 10-1 ／ `zCQXe` 10-1-L）の、
 * 中身が出せないときの見え方。
 *
 * **一覧が読めなかったのに「0件」と出ると、登録したものが消えたように
 * 見える。** 直し方も状態ごとに違う——権限不足は誰かに足してもらう、
 * 混み合いは待つ、通信は確かめる。
 */
describe('読み込めなかった理由の見分け', () => {
  it('権限不足は、読み直しの口を出さない', () => {
    /* 403 は何度押しても直らない。「もう一度読み込む」は誤った道案内になる。 */
    const failure = webinarLoadFailure(new ApiError(403, 'Forbidden'))
    expect(failure.kind).toBe('forbidden')
    expect(failure.retryable).toBe(false)
    expect(failure.title).toBe('ウェビナーを見る権限がありません')
  })

  it('混み合いは、待てば直ると言う', () => {
    const failure = webinarLoadFailure(new ApiError(429, 'Too Many Requests'))
    expect(failure.kind).toBe('error')
    expect(failure.retryable).toBe(true)
    expect(failure.description).toContain('少し待ってから')
  })

  it('それ以外は通信を確かめてもらう', () => {
    for (const thrown of [new ApiError(500, 'boom'), new Error('network'), 'なにか']) {
      const failure = webinarLoadFailure(thrown)
      expect(failure.kind).toBe('error')
      expect(failure.retryable).toBe(true)
      expect(failure.title).toBe('ウェビナーを表示できませんでした')
    }
  })

  it('どの理由でも、内部の語をそのまま画面へ出さない', () => {
    for (const thrown of [new ApiError(500, 'API error: 500'), new Error('fetch failed')]) {
      const failure = webinarLoadFailure(thrown)
      for (const text of [failure.title, failure.description]) {
        expect(text).not.toMatch(/API error|fetch|undefined|NaN/)
      }
    }
  })
})

describe('一覧の状態（設計 10-1-L `zCQXe`）', () => {
  it('読めていないときに 0 件と書かない', () => {
    /*
     * 「1つも無い」と「読めなかった」は別のこと。0 と出すと消えたように見える。
     */
    expect(PAGE).toContain("{hasListData ? visibleItems.length : '—'}")
    expect(PAGE).toContain("公開中 {hasListData ? visibleItems.filter((w) => w.status === 'active').length : '—（未取得）'}")
  })

  it('数が無いときは単位も出さない', () => {
    /* `—件` は数に見える。 */
    expect(PAGE).toContain('{hasListData && <span className="text-ink-faint ml-0.5 text-xs font-normal">件</span>}')
  })

  it('読めていないときはページ送りを出さない', () => {
    expect(PAGE).toContain('{hasListData && filtered.length > 0 && (')
  })

  it('読込・失敗・権限不足を共通部品で描く', () => {
    expect(PAGE).toContain("import ListState from '@/components/shared/list-state'")
    expect(PAGE).toContain('<ListState kind="loading" />')
    expect(PAGE).toContain('kind={loadFailure.kind}')
    /* 画面ごとに直書きすると、同じ状態が画面ごとに違う顔になる。 */
    expect(PAGE).not.toContain('読み込み中...')
    expect(PAGE).not.toContain('ウェビナーを読み込めませんでした')
  })

  it('配列で来なかった返事を、そのまま一覧へ流さない', () => {
    /*
     * 口の契約は配列だが、器だけ違う返事が来ると `[...narrowed]` が
     * `narrowed is not iterable` になり、**一覧が白い画面になる**。
     */
    expect(PAGE).toContain('if (!Array.isArray(res.data)) throw new ApiError(500,')
  })
})
