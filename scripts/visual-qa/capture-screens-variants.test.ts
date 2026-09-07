import { describe, expect, it } from 'vitest'

// @ts-expect-error 画面撮影CLIは素のJS。テストする純粋関数だけを公開している。
import { failureResponseForState, shouldApplyStateToMethod, shotSpecsFor } from './capture-screens.mjs'

describe('画面撮影の変種', () => {
  it('変種ごとのrouteとstateを撮影仕様へ引き継ぐ', () => {
    const shots = shotSpecsFor({
      node: 'example',
      route: '/base',
      steps: [{ click: '開く' }],
      variants: [
        { suffix: 'same-route', steps: [{ click: '続ける' }] },
        {
          suffix: 'conflict',
          route: '/base?tab=columns',
          state: { apis: ['**/api/items**'], kind: 'conflict' },
          steps: [{ click: '保存' }],
        },
      ],
    })

    expect(shots.find((shot: { label: string }) => shot.label === '-same-route')).toMatchObject({
      route: '/base',
      steps: [{ click: '開く' }, { click: '続ける' }],
      state: null,
    })
    expect(shots.find((shot: { label: string }) => shot.label === '-conflict')).toMatchObject({
      route: '/base?tab=columns',
      state: { apis: ['**/api/items**'], kind: 'conflict', postOnly: true },
    })
  })

  it('変種の状態差し替えはPOSTだけに適用する', () => {
    const state = { apis: ['**/api/items**'], kind: 'invalid', postOnly: true }
    expect(shouldApplyStateToMethod(state, 'GET')).toBe(false)
    expect(shouldApplyStateToMethod(state, 'POST')).toBe(true)
  })

  it('保存メソッドを明示した変種は、そのメソッドだけに適用する', () => {
    const state = { apis: ['**/api/items/**'], kind: 'conflict', postOnly: true, method: 'PATCH' }
    expect(shouldApplyStateToMethod(state, 'GET')).toBe(false)
    expect(shouldApplyStateToMethod(state, 'POST')).toBe(false)
    expect(shouldApplyStateToMethod(state, 'PATCH')).toBe(true)
  })

  it.each([
    ['invalid', 400, 'article_url_invalid'],
    ['conflict', 409, 'column_already_exists'],
    ['forbidden', 403, '権限がありません'],
    ['error', 500, 'column_create_failed'],
  ])('%s の保存失敗を指定どおり返す', (kind, status, error) => {
    expect(failureResponseForState({ kind, postOnly: true })).toEqual({ status, error })
  })
})
