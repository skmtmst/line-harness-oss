import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import ConfirmDialog from './confirm-dialog'

/*
 * 確かめの窓（ConfirmDialog）でも、画面が絵の幅・上からの位置を渡せるようにする。
 * ウェビナーのアーカイブ（幅 500・上から 380）やリマインダの削除（幅 600・上から 260）の窓が、
 * 共通の窓をやめて自前の窓を作らずに済むようにするため（2026-10-07）。
 */
vi.mock('react-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-dom')>()
  return { ...actual, createPortal: (node: React.ReactNode) => node }
})

const render = (props: Partial<React.ComponentProps<typeof ConfirmDialog>>) => renderToStaticMarkup(
  <ConfirmDialog open title="アーカイブしますか？" onCancel={vi.fn()} onConfirm={vi.fn()} {...props} />,
)

describe('確かめの窓：絵の幅と位置を渡せる', () => {
  it('designWidth・designTop を渡すと、共通の窓へそのまま届く', () => {
    const html = render({ designWidth: 500, designTop: 380 })
    expect(html).toContain('--dialog-design-width:500px')
    expect(html).toContain('--dialog-design-top:380px')
  })

  it('渡さなければ今までどおり', () => {
    const html = render({})
    expect(html).not.toContain('--dialog-design-width')
    expect(html).not.toContain('--dialog-design-top')
  })
})
