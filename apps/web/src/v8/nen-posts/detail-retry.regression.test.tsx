// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { PhotoReviewDetail } from './detail'
afterEach(cleanup)
it('B-12: 写真詳細の通信失敗はその場で読み直せ、権限不足でも権限変更後に読み直せる', () => {
  const retry = vi.fn(), noop = () => {}
  const props = {
    photo: null, position: 0, total: 1, loading: false, reviewing: false,
    notice: '', accountNotice: '', assetStatus: null, derivatives: null,
    assetsFailed: false, onReloadAssets: noop, onReloadPhoto: retry,
    assetProcessing: false, rotationSaving: false, onBack: noop, onMove: noop,
    onApprove: noop, onReturn: noop, onProcessReviewAsset: noop,
    onSaveRotation: noop, onDownloadOriginal: async () => {}, onPointAction: noop, pointActionBusy: null,
  }
  const view = render(<PhotoReviewDetail {...props} loadKind="error" />)
  fireEvent.click(screen.getByRole('button', { name: /もう一度/ }))
  expect(retry).toHaveBeenCalledOnce()
  view.rerender(<PhotoReviewDetail {...props} loadKind="forbidden" />)
  fireEvent.click(screen.getByRole('button', { name: /もう一度/ }))
  expect(retry).toHaveBeenCalledTimes(2)
})
