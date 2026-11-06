// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import StickerPreview from './sticker-preview'
import { BubblePreview } from '@/components/broadcasts/broadcast-preview-model'
import StepPreview from '@/components/scenarios/step-preview'
import { emptyMessageKindState } from '@/components/scenarios/message-kind-fields'

afterEach(cleanup)
it('配信と統括の共用画像は、既存の属性・DOM・Tabを保つ', () => {
  const state = emptyMessageKindState(); state.sticker = { packageId: '789', stickerId: '10855' }
  const view = render(<BubblePreview bubble={{ id: 'preview', type: 'sticker', content: { state } }} />)
  const actual = view.container.innerHTML
  expect(view.container.querySelectorAll('a,button,input,[tabindex]').length).toBe(0)
  view.rerender(<img width={96} height={96} src="https://stickershop.line-scdn.net/stickershop/v1/sticker/10855/android/sticker.png" alt="スタンプ" className="h-24 w-24 object-contain" />)
  expect(actual).toBe(view.container.innerHTML)
  view.rerender(<StickerPreview stickerId="10856" />)
  expect(screen.getByRole('img').getAttribute('src')).toContain('/10856/android/sticker.png')
})
it('ステップの下見も既存の80角とclassを保ち、選んだ画像に付いていく', () => {
  const state = emptyMessageKindState(); state.sticker = { packageId: '446', stickerId: '1989' }
  const props = { deliveryMode: 'elapsed' as const, offsetDays: 0, deliveryTime: '10:00', offsetHours: 0, body: '', question: null, audienceLabel: '全員' }
  const view = render(<StepPreview {...props} kind="sticker" kindState={state} />)
  const image = screen.getByRole('img', { name: 'スタンプ', exact: true })
  expect(image.getAttribute('width')).toBe('80'); expect(image.getAttribute('height')).toBe('80')
  expect(image.getAttribute('class')).toBe('h-20 w-20')
  expect(image.getAttribute('src')).toContain('/1989/android/sticker.png')
  view.rerender(<StepPreview {...props} kind="sticker" kindState={{ ...state, sticker: { packageId: '789', stickerId: '10855' } }} />)
  expect(screen.getByRole('img', { name: 'スタンプ', exact: true }).getAttribute('src')).toContain('/10855/android/sticker.png')
})

it('サリーの画像は別の置き場を試し、全部失敗すれば文字を出す。選び直すと最初から試す', () => {
  const view = render(<StickerPreview stickerId="10855" />)
  fireEvent.error(screen.getByRole('img'))
  expect(screen.getByRole('img').getAttribute('src')).toContain('/10855/iPhone/sticker@2x.png')
  fireEvent.error(screen.getByRole('img'))
  expect(screen.queryByRole('img')).toBeNull()
  expect(screen.getByText('スタンプ', { exact: true })).toBeTruthy()
  view.rerender(<StickerPreview stickerId="1989" />)
  expect(screen.getByRole('img').getAttribute('src')).toContain('/1989/android/sticker.png')
})
