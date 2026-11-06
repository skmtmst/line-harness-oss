// @vitest-environment happy-dom
import { render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import { renderPreviewRail } from './create-preview-rail'

it('未設定の面は件数を短く示し、警告色にしない', () => {
  const props = { step: 'shape', host: null, configuredCount: 0, totalAreaCount: 3, pages: [], tabCount: 0, previewImageUrl: null, renderLinePreview: () => <div /> } as unknown as Parameters<typeof renderPreviewRail>[0]
  render(<>{renderPreviewRail(props)}</>)
  const value = screen.getByText('未設定 3')
  expect(value.className).not.toMatch(/warn/i)
})
