// @vitest-environment happy-dom
import { cleanup, render } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { rememberStaffIdentity, forgetStaffIdentity } from '@/lib/staff-identity-state'
import type { StaffMember } from '@line-crm/shared'
import { PERMISSION_LOCK_SUMMARY } from '@/components/shared/permission-lock'
import { PageHeading } from './page-frame'
import { BookingPage } from './booking-page'
import { ListPage } from './list-page'
import { CreatePage } from './create-page'
import { DetailPage } from './detail-page'
import { SettingsPage } from './settings-page'

afterEach(() => { cleanup(); forgetStaffIdentity() })

it('全ての型が必要な権限の理由を題の下・タブの前に一度だけ出す', () => {
  rememberStaffIdentity({ role: 'admin' } as StaffMember)
  const props = { title: '外部連携', readOnlyNeed: 'owner' as const }
  for (const page of [
    <PageHeading key="heading" {...props} readOnlyBand tabs={<span data-tabs>切り替え</span>} />,
    <ListPage key="list" {...props} readOnly tabs={<span data-tabs>切り替え</span>}>本文</ListPage>,
    <CreatePage key="create" {...props} dirty={false} readOnly tabs={<span data-tabs>切り替え</span>} footerActions={null}>本文</CreatePage>,
    <DetailPage key="detail" {...props} readOnly tabs={<span data-tabs>切り替え</span>}>本文</DetailPage>,
    <SettingsPage key="settings" {...props} readOnly navigation={<span>目次</span>}>本文</SettingsPage>,
  ]) {
    const { container, unmount } = render(page)
    const notices = container.querySelectorAll('[data-read-only-notice]')
    expect(notices.length).toBe(1)
    expect(notices[0].textContent).toBe(PERMISSION_LOCK_SUMMARY.owner)
    const tabs = container.querySelector('[data-tabs]')
    if (tabs) expect(notices[0].compareDocumentPosition(tabs) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    unmount()
  }
})

it('一覧の帯は見出しと操作の行の下の全幅の行に置き、他の型は題の列の中に残す', () => {
  rememberStaffIdentity({ role: 'admin' } as StaffMember)
  const list = render(<ListPage title="一覧" readOnly readOnlyNeed="owner" actions={<button type="button">作る</button>}>本文</ListPage>)
  const listHeader = list.container.querySelector('header[data-template-region="heading"]')
  const listNotice = listHeader?.querySelector('[data-template-region="notice"]')
  expect(listNotice?.parentElement).toBe(listHeader)
  expect(listNotice?.previousElementSibling?.querySelector('h1')).toBeTruthy()
  list.unmount()
  for (const page of [
    <PageHeading key="heading" title="見出し" readOnlyBand readOnlyNeed="owner" />,
    <CreatePage key="create" title="作る" dirty={false} readOnly readOnlyNeed="owner" footerActions={null}>本文</CreatePage>,
    <DetailPage key="detail" title="詳細" readOnly readOnlyNeed="owner">本文</DetailPage>,
    <SettingsPage key="settings" title="設定" readOnly readOnlyNeed="owner" navigation={<span>目次</span>}>本文</SettingsPage>,
    <BookingPage key="booking" title="予約" readOnly readOnlyNeed="owner">本文</BookingPage>,
  ]) {
    const { container, unmount } = render(page)
    const header = container.querySelector('header[data-template-region="heading"]')
    const notice = header?.querySelector('[data-template-region="notice"]')
    expect(notice).toBeTruthy()
    expect(notice?.parentElement).not.toBe(header)
    expect(notice?.parentElement?.contains(header?.querySelector('h1, h2') ?? null)).toBe(true)
    unmount()
  }
})

it('統括の必要権限と閲覧のみの役割を区別する', () => {
  rememberStaffIdentity({ role: 'admin' } as StaffMember)
  const { container, rerender } = render(<ListPage title="統括" readOnly="hq" readOnlyNeed="tenantWide">本文</ListPage>)
  expect(container.querySelector('[data-read-only-notice]')?.textContent).toBe(PERMISSION_LOCK_SUMMARY.tenantWide)
  rememberStaffIdentity({ role: 'viewer' } as StaffMember)
  rerender(<ListPage title="統括" readOnly="hq" readOnlyNeed="owner">本文</ListPage>)
  expect(container.querySelector('[data-read-only-notice]')?.textContent).toContain('統括の管理者に頼んでください')
  rerender(<ListPage title="統括">本文</ListPage>)
  expect(container.querySelector('[data-read-only-notice]')).toBeNull()
})
