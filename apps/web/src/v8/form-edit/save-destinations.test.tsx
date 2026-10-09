// @vitest-environment happy-dom
import { fireEvent, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import { mount } from './owner-content-fixture'
it('WEB-144：「保存しない」は友だち情報・本名・表示名・メモの保存先を全部消す', () => {
  const { onPatchBlock } = mount([{ id: 'q', kind: 'input', type: 'text', name: 'q', label: '質問', destinations: { friendFieldIds: ['A', 'B'], realName: true, displayName: true, note: true } }])
  fireEvent.change(screen.getByLabelText('答えを保存する先'), { target: { value: '' } })
  expect(onPatchBlock).toHaveBeenCalledWith('q', expect.objectContaining({ destinations: { friendFieldIds: [] } }))
})
