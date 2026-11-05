// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { renderPreviewRail } from './create-preview-rail'

afterEach(cleanup)

it.each([1, 3, 6])('未設定の面 %i 個は件数を短く示し、警告色にしない', (count) => {
  const props = { step: 'shape', host: null, configuredCount: 0, totalAreaCount: count, pages: [], tabCount: 0, previewImageUrl: null, renderLinePreview: () => <div /> } as unknown as Parameters<typeof renderPreviewRail>[0]
  render(<>{renderPreviewRail(props)}</>)
  const value = screen.getByText(`未設定 ${count}`)
  expect(value.className).not.toMatch(/warn/i)
})
