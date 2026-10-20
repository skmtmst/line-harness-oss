// @vitest-environment happy-dom
import { drawFields, stats } from './field-list-test-harness'
import { expect, it } from 'vitest'
import { ApiError } from '@/lib/api'
import { STATE_TEXT, notConnectedText } from '@/components/shared/not-connected'

it('読込中の理由は共通の言葉で描く', () => {
  stats.load.mockReturnValue(new Promise(() => {}))
  const view = drawFields()
  expect(view.details()).toEqual(Array(4).fill(STATE_TEXT.loading))
})

it('取得失敗は読込中と区別する', async () => {
  stats.load.mockRejectedValue(new Error('offline'))
  const view = drawFields()
  await view.waitFor(() => expect(view.details()).toEqual(Array(4).fill(STATE_TEXT.error)))
})

it('権限不足を通信の失敗と区別する', async () => {
  stats.load.mockRejectedValue(new ApiError('forbidden', 403))
  const view = drawFields()
  await view.waitFor(() => expect(view.details()).toEqual(Array(4).fill(STATE_TEXT.forbiddenView)))
})

it('集計の失敗を4枚とも理由へ差し替える', async () => {
  stats.load.mockResolvedValue({ success: false })
  const view = drawFields()
  await view.waitFor(() => expect(view.details()).toEqual(Array(4).fill(STATE_TEXT.error)))
  expect(view.numbers()).toEqual(Array(4).fill('—'))
})

it('未接続は読込中や取得失敗と別の理由を描く', async () => {
  stats.load.mockResolvedValue({ success: true, data: { total: 1, inUse: 0, registeredFriends: 1, formLinks: null, updatedThisMonth: 0 } })
  const view = drawFields()
  await view.waitFor(() => expect(view.details()[2]).toBe(notConnectedText('回答フォームの登録先')))
  expect(view.numbers()[2]).toBe('—')
})
