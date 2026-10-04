/**
 * 速さ予算の見張り（2026-10-04 オーナー採用「1」）。
 *
 * 実ブラウザの計測は `apps/web/scripts/v8-guard/speed-budget.mjs` が
 * CI で行う。ここではブラウザなしで確かめられることだけを見る：
 * 予算の表の形、10% 則とラチェットの判定、2,000 行への膨らませ方。
 * 数の正しさは実測が決める（想像の数は書かない）。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  applyJsBaselineAllowance,
  expandFriends,
  judge,
  median,
  parseArgs,
  SPEED_ROUTES,
  targetMisses,
} from '../../scripts/v8-guard/speed-budget.mjs'

const BUDGET_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../scripts/v8-guard/speed-budget.json',
)

const SCREENS = [
  'dashboard',
  'inbox',
  'friends',
  'broadcasts',
  'broadcast-new',
  'templates',
  'booking',
  'answers',
  'tags',
  'settings',
  'friends-2000',
]

const TARGETS = { showMs: 1000, lcpMs: 1000, pressMs: 100, longTaskMs: 50 }

function row(over = {}) {
  return {
    name: 'friends',
    route: '/friends',
    showMs: 400,
    lcpMs: 500,
    pressMs: 40,
    longTaskMs: 0,
    jsBytes: 900000,
    ...over,
  }
}

function base(over = {}) {
  return {
    showMs: 400,
    lcpMs: 500,
    pressMs: 40,
    longTaskMs: 0,
    jsBytes: 900000,
    ...over,
  }
}

describe('速さ予算の表', () => {
  it('目標は表示 1秒・LCP 1秒・反応 100ms・長い作業 50ms（落とさない）', () => {
    const budget = JSON.parse(readFileSync(BUDGET_PATH, 'utf-8'))
    expect(budget.version).toBe(2)
    expect(budget.targets).toEqual(TARGETS)
  })

  it('測るのは主要10画面＋2,000行の場面', () => {
    expect(Object.keys(SPEED_ROUTES)).toEqual(SCREENS.slice(0, 10))
  })

  it('基準は「空」か「11行そろい」かのどちらか。中途半端は許さない', () => {
    const budget = JSON.parse(readFileSync(BUDGET_PATH, 'utf-8'))
    const names = Object.keys(budget.baselines)
    expect(names.length === 0 || names.length === SCREENS.length).toBe(true)
    for (const name of SCREENS) {
      if (names.length === 0) break
      const line = budget.baselines[name]
      expect(line, `${name} の基準がない`).toBeDefined()
      for (const key of ['showMs', 'lcpMs', 'longTaskMs', 'jsBytes']) {
        expect(typeof line[key], `${name} ${key}`).toBe('number')
      }
      expect(
        typeof line.pressMs === 'number' || line.pressMs === null,
        `${name} pressMs`,
      ).toBe(true)
    }
  })
})

describe('悪化だけ落とす判定（20%・JS 1KB）', () => {
  it('基準どおりなら通る', () => {
    expect(judge([row()], { friends: base() })).toEqual([])
  })

  it('基準が無い画面は飛ばす', () => {
    expect(judge([row({ showMs: 9999 })], {})).toEqual([])
  })

  it('基準より20%を超えて悪いと落ちる', () => {
    /* 400 の20%は 480。481 で落ち、480 で通る */
    expect(judge([row({ showMs: 481 })], { friends: base() }).length).toBeGreaterThan(0)
    expect(judge([row({ showMs: 480 })], { friends: base() })).toEqual([])
  })

  it('JS は1KBを超えて増えたら落ちる', () => {
    expect(judge([row({ jsBytes: 900000 + 1025 })], { friends: base() }).length).toBeGreaterThan(0)
    expect(judge([row({ jsBytes: 900000 + 1024 })], { friends: base() })).toEqual([])
  })

  it('反応が測れない画面（null）は飛ばす', () => {
    expect(judge([row({ pressMs: null })], { friends: base() })).toEqual([])
  })
})

describe('3回測って真ん中', () => {
  it('ぶれた1回に引っ張られない', () => {
    expect(median([100, 300, 200])).toBe(200)
    expect(median([66, 5024, 67])).toBe(67)
  })

  it('測れない回は除く。全部測れなければ null', () => {
    expect(median([null, 50, null])).toBe(50)
    expect(median([null, null])).toBeNull()
    expect(median([])).toBeNull()
  })
})

describe('同じPRで基準更新があればJS超過は通す', () => {
  const over = [row({ jsBytes: 900000 + 2048 })]
  const mixed = [row({ jsBytes: 900000 + 2048 }), row({ name: 'slow', route: '/slow', showMs: 9999, lcpMs: 1, pressMs: 1, longTaskMs: 0, jsBytes: 1 })]

  it('基準更新なしではJS超過で落ちる', () => {
    const { failures, notices } = applyJsBaselineAllowance(judge(over, { friends: base() }), false)
    expect(failures.length).toBeGreaterThan(0)
    expect(notices).toEqual([])
  })

  it('基準更新ありではJS超過を通し、時間の悪化は通さない', () => {
    const judged = judge(mixed, { friends: base(), slow: base({ showMs: 100 }) })
    const { failures, notices } = applyJsBaselineAllowance(judged, true)
    expect(notices.length).toBe(1)
    expect(failures.length).toBe(1)
    expect(failures[0]).toContain('slow')
  })

  it('JS超過の文に理由の書き方（同じPRで基準更新・PRに理由）が出る', () => {
    const [line] = judge(over, { friends: base() })
    expect(line).toContain('同じPRで基準を更新')
    expect(line).toContain('理由をPRに書く')
  })
})

describe('目標未達は出すだけ（落とさない）', () => {
  it('目標を超えた画面を列挙する', () => {
    const misses = targetMisses([row({ showMs: 1177, pressMs: 66 })], TARGETS)
    expect(misses.length).toBe(1)
    expect(misses[0]).toContain('friends')
  })

  it('目標内なら空', () => {
    expect(targetMisses([row({ showMs: 400, lcpMs: 500, pressMs: 40, longTaskMs: 0 })], TARGETS)).toEqual([])
  })
})

describe('2,000 行への膨らませ方', () => {
  const small = JSON.stringify({
    success: true,
    data: { items: [{ id: 'a' }, { id: 'b' }], total: 2, page: 1, limit: 20 },
  })

  it('本物の1行目を写して 2,000 行にする', () => {
    const big = JSON.parse(expandFriends(small))
    expect(big.data.items).toHaveLength(2000)
    expect(big.data.total).toBe(2000)
    expect(big.data.items[0].id).toBe('stress-0')
  })

  it('壊れた答えは膨らませない（null）', () => {
    expect(expandFriends('not json')).toBeNull()
    expect(expandFriends(JSON.stringify({ success: true, data: [] }))).toBeNull()
  })
})

describe('引数の読み方', () => {
  it('待ち受けなし方式と基準更新を読む', () => {
    const parsed = parseArgs(['--local-stub', 'apps/web/out', '--update-baseline'])
    expect(parsed.stubDir).toBe('apps/web/out')
    expect(parsed.updateBaseline).toBe(true)
  })

  it('ふつうは配った out の住所を開く', () => {
    const parsed = parseArgs(['http://127.0.0.1:4310'])
    expect(parsed.stubDir).toBeNull()
    expect(parsed.baseUrl).toBe('http://127.0.0.1:4310')
  })
})
