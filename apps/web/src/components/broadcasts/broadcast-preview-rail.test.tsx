// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { createRef, useState, type ComponentProps } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { BroadcastPreviewRail } from './broadcast-preview-rail'
import styles from './broadcast-form-v8.module.css'

afterEach(cleanup)

it('共通の切り替えでスマホとPCの見本を選び、閉じると呼び出したボタンへ焦点を戻す', () => {
  type Props = ComponentProps<typeof BroadcastPreviewRail>
  const toggle = createRef<HTMLButtonElement>()
  function Preview() {
    const [device, setDevice] = useState<'phone' | 'pc'>('phone')
    const [open, setOpen] = useState(true)
    return <><button ref={toggle}>見本を開く</button><BroadcastPreviewRail
      ab={{ hasB: false } as Props['ab']} afterActionVersionId="" audienceDisplayCount={null}
      bubbles={[]} confirmAudienceLabel="未設定" currentStep="message" excludeTagId="" messageButtons={[]}
      openTestDialog={vi.fn(async () => {})} previewCloseRef={createRef<HTMLButtonElement>()} previewConfirmed={false}
      previewDevice={device} previewOpen={open} previewToggleRef={toggle} publishedActions={[]}
      saving={false} scheduledLabel={null} selectedAccount={null} sendWhenLabel={null}
      setPreviewConfirmed={vi.fn()} setPreviewDevice={setDevice} setPreviewOpen={setOpen}
      tags={[]} testBlockReason="本文を入れてください" /></>
  }
  const { container } = render(<Preview />)
  const devices = screen.getByRole('group', { name: 'プレビューの端末' })
  const phone = within(devices).getByRole('button', { name: 'スマホ' })
  const pc = within(devices).getByRole('button', { name: 'PC' })
  expect(phone.getAttribute('aria-pressed')).toBe('true')
  expect(container.querySelector(`.${styles.phonePreview}`)).not.toBeNull()
  fireEvent.click(pc)
  expect(pc.getAttribute('aria-pressed')).toBe('true')
  expect(phone.getAttribute('aria-pressed')).toBe('false')
  expect(container.querySelector(`.${styles.pcPreview}`)).not.toBeNull()
  fireEvent.keyDown(pc, { key: 'ArrowLeft' })
  expect(phone.getAttribute('aria-pressed')).toBe('true')
  fireEvent.click(screen.getByRole('button', { name: '閉じる' }))
  expect(container.querySelector('aside')?.hasAttribute('data-open')).toBe(false)
  expect(document.activeElement).toBe(toggle.current)
  expect(screen.getByRole('button', { name: /テストを送る/ }).hasAttribute('disabled')).toBe(true)
})

it('手順 1〜2 は空のスマホではなく、届く人数と内訳（対象・ブロック中で除く・除くタグ）を出す', () => {
  type Props = ComponentProps<typeof BroadcastPreviewRail>
  const props = {
    ab: { hasB: false } as Props['ab'], afterActionVersionId: '', audienceDisplayCount: 1028, bubbles: [],
    confirmAudienceLabel: 'シナリオ購読中', excludeTagId: 'tag-1', messageButtons: [], openTestDialog: vi.fn(async () => {}),
    preflight: { audienceCount: 1028, hiddenExcluded: 0, warnings: [], audience: { matched: 1045, sendable: 1028, evaluatedAt: '2026-10-26T00:00:00Z', representatives: [] }, exclusions: { blocked: 17, hidden: 0, missingDestination: 0, duplicate: 0, paused: null, total: 17 } },
    preflightStatus: 'ready' as const, previewCloseRef: createRef<HTMLButtonElement>(), previewConfirmed: false, previewDevice: 'phone' as const,
    previewOpen: true, previewToggleRef: createRef<HTMLButtonElement>(), publishedActions: [], saving: false, scheduledLabel: null,
    selectedAccount: null, sendWhenLabel: null, setPreviewConfirmed: vi.fn(), setPreviewDevice: vi.fn(), setPreviewOpen: vi.fn(),
    tags: [{ id: 'tag-1', name: '休眠' }] as Props['tags'], testBlockReason: '',
  }
  for (const step of ['basic', 'audience'] as const) {
    const view = render(<BroadcastPreviewRail {...props} currentStep={step} />)
    const rail = view.getByRole('complementary', { name: '届く人' })
    expect(rail.textContent).toContain('1,028')
    expect(rail.textContent).toContain('シナリオ購読中1,045 人')
    expect(rail.textContent).toContain('ブロック中で除く− 17 人')
    expect(rail.textContent).toContain('除くタグ休眠')
    expect(within(rail).getByRole('link', { name: /届く人の一覧へ/ }).getAttribute('href')).toBe('/friends')
    expect(view.queryByRole('group', { name: 'プレビューの端末' })).toBeNull()
    cleanup()
  }
  const message = render(<BroadcastPreviewRail {...props} currentStep="message" />)
  expect(message.getByRole('complementary', { name: 'LINEの見え方' })).not.toBeNull()
  cleanup()
  const counting = render(<BroadcastPreviewRail {...props} currentStep="audience" preflight={null} audienceDisplayCount={null} preflightStatus="loading" />)
  const rail = counting.getByRole('complementary', { name: '届く人' })
  expect(rail.textContent).toContain('数えています…')
  expect(rail.textContent).toContain('ブロック中で除く—')
})
