// @vitest-environment happy-dom
/*
 * R138: タグ削除の確認窓は開くと窓内へフォーカスし、Tab/Shift+Tab は
 * 窓内を循環する。Escape で閉じて起点へ戻り、見出しが窓の名前になる。
 */
import React from 'react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { DeleteDialog } from './edit-tag-page-v4'

const tag = { id: 'tag-1', name: '定期購入者', friendCount: 0 } as never

const dependencies = {
  friendCount: 0,
  referenceCounts: {
    broadcasts: 0, forms: 0, templates: 0, richMenus: 0, webinars: 0, events: 0,
    bookingMenus: 0, entryRoutes: 0, trackedLinks: 0, affiliateOffers: 0, analyticsFunnels: 0,
    scenarios: 0, autoReplies: 0, savedSearches: 0, automations: 0,
    commonActions: 0, reminders: 0, friendAddSettings: 0,
  },
} as never

function openDialog(props?: { initialConfirmation?: string; onCancel?: () => void }) {
  const onCancel = props?.onCancel ?? (() => {})
  render(
    <DeleteDialog
      tag={tag}
      dependencies={dependencies}
      dependenciesStatus="ready"
      onCancel={onCancel}
      onDelete={() => {}}
      deleting={false}
      initialConfirmation={props?.initialConfirmation ?? ''}
    />,
  )
  return { onCancel }
}

async function tick() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20))
  })
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('R138 タグ削除の確認窓', () => {
  test('見出しが確認窓の名前として取得できる', async () => {
    openDialog()
    const dialog = await screen.findByRole('alertdialog', { name: '「定期購入者」を削除しますか？' })
    expect(dialog).toBeTruthy()
  })

  test('窓を開くと窓内へフォーカスする', async () => {
    openDialog()
    const dialog = await screen.findByRole('alertdialog')
    await tick()
    expect(dialog.contains(document.activeElement)).toBe(true)
  })

  test('Shift+Tab で背後へ抜けず窓内を循環する', async () => {
    // 名前を先に入れて削除ボタンを押せる状態にする。
    openDialog({ initialConfirmation: '定期購入者' })
    const dialog = await screen.findByRole('alertdialog')
    await tick()
    const first = dialog.querySelector<HTMLElement>('button[aria-label="閉じる"]')
    expect(first).not.toBeNull()
    await act(async () => {
      first?.focus()
    })
    expect(document.activeElement).toBe(first)
    await act(async () => {
      fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    })
    // 背後の保存ではなく窓内の最後（タグを削除）へ回る。
    expect(dialog.contains(document.activeElement)).toBe(true)
    expect((document.activeElement as HTMLElement).textContent).toContain('タグを削除する')
  })

  test('Escape で閉じる', async () => {
    const onCancel = vi.fn()
    openDialog({ onCancel })
    await screen.findByRole('alertdialog')
    await act(async () => {
      fireEvent.keyDown(document, { key: 'Escape' })
    })
    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})
