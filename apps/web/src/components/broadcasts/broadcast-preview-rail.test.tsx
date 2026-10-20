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
