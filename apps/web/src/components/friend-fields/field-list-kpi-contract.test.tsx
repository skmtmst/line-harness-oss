// @vitest-environment happy-dom
import { drawFields, stats } from './field-list-test-harness'
import { expect, it } from 'vitest'

it('取得していない使用数をundefinedと出さない', async () => {
  stats.load.mockResolvedValue({ success: true, data: { total: 1, registeredFriends: 2, formLinks: 0, updatedThisMonth: 0 } })
  const view = drawFields()
  await view.waitFor(() => expect(view.details()[0]).toContain('使っている数は未集計'))
  expect(view.container.textContent).not.toContain('undefined')
  expect(view.numbers()[0]).toBe('1')
})

it('取得失敗を0件と出さない', async () => {
  stats.load.mockResolvedValue({ success: false })
  const view = drawFields()
  await view.waitFor(() => expect(view.details()[0]).toBe('読み込めませんでした'))
  expect(view.numbers()).toEqual(['—', '—', '—', '—'])
})
