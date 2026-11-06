// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }), usePathname: () => '/', useSearchParams: () => new URLSearchParams() }))

const fetchApi = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api', async (importOriginal) => ({ ...(await importOriginal<object>()), fetchApi, ApiError: class extends Error { status = 0 } }))
vi.mock('@/lib/staff-role', async (importOriginal) => ({ ...(await importOriginal<object>()), useStaffIdentity: () => ({ id: 'staff-1' }) }))
vi.mock('@/components/shared/list-url-state', async (importOriginal) => ({ ...(await importOriginal<object>()), useListUrlValue: (_: string, fallback: number) => [fallback, vi.fn()], useListUrlParam: () => [''] }))
vi.mock('@/components/shared/pagination', () => ({ default: () => <nav aria-label="受信一覧のページ送り" /> }))
vi.mock('@/components/shared/list-navigation', async (importOriginal) => ({ ...(await importOriginal<object>()), default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }))

import { lineMessagePreview } from '@line-crm/shared'
import { InboxSection } from './inbox'

afterEach(() => { cleanup(); fetchApi.mockReset() })

it.each([
  ['sticker', 'スタンプ'], ['image', '画像'], ['flex', 'Flexメッセージ'], ['video', '動画'],
  ['audio', '音声'], ['file', 'ファイル'], ['location', '位置情報'], ['unsent', '送信を取り消しました'],
])('受信箱と同じ変換を使いダッシュボードに%sを種類名で出す', async (type, label) => {
  const content = JSON.stringify({ type, packageId: '2713', internal: '表示しない本文' });
  fetchApi.mockResolvedValue({ success: true, data: {
    items: [{ id: 'line:visible', channel: 'line', customerName: '受信 花子', preview: lineMessagePreview(type, content), lastIncomingAt: '2026-10-31T23:00:00Z' }],
    summary: { total: 1, line: 1, email: 0, emailUnread: 0, oldestWaitMinutes: 1 },
  } });
  try {
    const { container } = render(<InboxSection onSummaryChange={vi.fn()} />);
    expect(await screen.findByText(label)).toBeTruthy();
    expect(await screen.findByText('受信 花子')).toBeTruthy();
    expect(container.textContent).not.toMatch(/packageId|2713|表示しない本文|範囲外 太郎/);
  } finally { cleanup(); }
});
