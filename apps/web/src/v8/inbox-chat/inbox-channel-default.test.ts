import { expect, it } from 'vitest'
import { resolveInboxChannel } from './inbox-model'

it('新規アカウントはメールURLからでもLINEだけを表示し、既存アカウントの選択は維持する', () => {
  expect(resolveInboxChannel(null, false)).toBe('line')
  expect(resolveInboxChannel('email', false)).toBe('line')
  expect(resolveInboxChannel('all', false)).toBe('line')
  expect(resolveInboxChannel(null, true)).toBe('all')
  expect(resolveInboxChannel('email', true)).toBe('email')
})
