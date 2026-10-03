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
  expandFriends,
  judge,
  parseArgs,
  SPEED_ROUTES,
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

const BUDGETS = { showMs: 1000, lcpMs: 1000, pressMs: 100, longTaskMs: 50 }

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
  it('予算は表示 1秒・LCP 1秒・反応 100ms・長い作業 50ms', () => {
    const budget = JSON.parse(readFileSync(BUDGET_PATH, 'utf-8'))
    expect(budget.version).toBe(1)
    expect(budget.budgets).toEqual(BUDGETS)
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

describe('10% 則とラチェットの判定', () => {
  it('基準どおりなら通る', () => {
    expect(judge([row()], BUDGETS, { friends: base() })).toEqual([])
  })

  it('予算を超えたら落ちる（表示 1秒・反応 100ms・長い作業 50ms）', () => {
    expect(judge([row({ showMs: 1001 })], BUDGETS, {}).length).toBeGreaterThan(0)
    expect(judge([row({ pressMs: 101 })], BUDGETS, {}).length).toBeGreaterThan(0)
    expect(judge([row({ longTaskMs: 51 })], BUDGETS, {}).length).toBeGreaterThan(0)
  })

  it('基準より10%を超えて悪いと落ちる', () => {
    const bad = judge([row({ showMs: 441 })], BUDGETS, { friends: base() })
    expect(bad.length).toBeGreaterThan(0)
    const ok = judge([row({ showMs: 440 })], BUDGETS, { friends: base() })
    expect(ok).toEqual([])
  })

  it('JS は1バイトでも増えたら落ちる（ラチェット）', () => {
    const bad = judge([row({ jsBytes: 900001 })], BUDGETS, { friends: base() })
    expect(bad.length).toBeGreaterThan(0)
    expect(judge([row()], BUDGETS, { friends: base() })).toEqual([])
  })

  it('反応が測れない画面（null）は飛ばす', () => {
    expect(judge([row({ pressMs: null })], BUDGETS, { friends: base() })).toEqual([])
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
