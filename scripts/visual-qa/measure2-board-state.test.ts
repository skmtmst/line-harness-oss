import { describe, expect, it } from 'vitest'
// @ts-expect-error 撮影用スクリプトは素のJS。
import { applyBoardStateProfiles, BOARD_STATE_PROFILES } from './measure2-board-state.mjs'

describe('板ごとの撮影条件', () => {
  it('B-252: 状態を開くだけにし、名前・数・見本文を絵へ合わせない', () => {
    const clicks = Object.values(BOARD_STATE_PROFILES).flatMap(profile => profile.click ?? [])
    expect(clicks).not.toEqual([])
    expect(clicks.some(step => step.startsWith('fill:'))).toBe(false)
    expect(BOARD_STATE_PROFILES.HfK0O.click).toEqual(['メッセージ', 'テンプレートを作る'])
  })
  it('固定表を変えず、対象外の状態と対象板のAPI・権限・幅を残す', () => {
    const map = {
      frozenAt: 'fixed',
      boards: {
        HfK0O: { url: '/hq/templates', width: 1152, state: { role: 'owner', api: { match: 'GET /api/x', body: { value: 1 } }, localStorage: { selected: 'account-a' } } },
        other: { url: '/other', state: { manual: '手動', role: 'viewer', click: ['見る'] } },
      },
    }
    const before = structuredClone(map)
    const result = applyBoardStateProfiles(map)
    expect(map).toEqual(before)
    expect(result.frozenAt).toBe('fixed')
    expect(result.boards.other).toEqual(before.boards.other)
    expect(result.boards.HfK0O.width).toBe(1152)
    for (const key of ['api', 'role', 'localStorage']) expect(result.boards.HfK0O.state[key]).toEqual(before.boards.HfK0O.state[key as keyof typeof before.boards.HfK0O.state])
    result.boards.HfK0O.state.localStorage.selected = 'account-b'
    expect(map.boards.HfK0O.state.localStorage.selected).toBe('account-a')
  })

  it.each([
    { state: { role: 'viewer' } },
    { state: { manual: '失敗状態を撮る' } },
    { state: { click: ['特定の確認窓を開く'] } },
    { kind: '閲覧のみ' },
  ])('対象板に既存の再現条件がある場合は上書きしない: %j', entry => {
    const map = { boards: { HfK0O: { url: '/hq/templates', ...entry } } }
    const before = structuredClone(map)
    expect(() => applyBoardStateProfiles(map)).toThrow('既存の状態指定')
    expect(map).toEqual(before)
  })

  it('板が無い表に、勝手に板を作り足さない', () => {
    expect(applyBoardStateProfiles({ boards: {} })).toEqual({ boards: {} })
    expect(() => applyBoardStateProfiles({})).toThrow('boards')
  })
})
