// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { TemplateInsertControls, buildTemplatePreview } from './message-template-editor'
vi.mock('@/lib/use-feature-visibility', () => ({ useFeatureVisibility: () => ({ enabled: () => false }) }))
afterEach(cleanup)
it('WEB260: 日数のボタンが閉じ括弧2つの送信用トークンを入れ、見本も置き換える', () => {
  const insert = vi.fn()
  render(<TemplateInsertControls accountId="a" state="ready" targetDate="2026-10-10" disabled={false} onTargetDateChange={() => {}} friendFields={[]} commonVars={[]} onInsert={insert} />)
  fireEvent.click(screen.getByRole('button', { name: '目標日までの日数' }))
  expect(insert).toHaveBeenCalledWith('{{days_until:2026-10-10}}')
  expect(buildTemplatePreview(insert.mock.calls[0][0], { friendFields: [], commonVars: [] }, new Date('2026-10-09T00:00:00+09:00')).content).toBe('1')
})
