// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MediaItem } from '@line-crm/shared'
import type { Webinar } from '@/lib/api'
import EditWebinarPage from './page'

/**
 * 監査 DETAIL-18・19・21 の固定検査。
 *
 * - 動画欄は `slug.mp4` の偽名を作らず、選んだメディアの実名を出す。
 * - 通知概要の状態は1つの定義から描き、設定済み／未設定／確認中／
 *   取得失敗を色と文字と絵で区別する(全部 text-success だった欠陥)。
 * - 使っていない completionRate を残さない。
 */

const { NOTIFICATION_ROW_STATE, NotificationStateBadge, VideoMediaLabel, notificationRowState } =
  EditWebinarPage.__testing

function webinar(overrides: Partial<Webinar> = {}): Webinar {
  return {
    id: 'webinar-1',
    accountId: 'account-a',
    title: '採用ウェビナー',
    slug: 'recruit',
    status: 'draft',
    videoPrefix: null,
    videoMediaId: null,
    durationSeconds: 600,
    schedule: [],
    cta: null,
    tagOnAttend: null,
    tagOnCtaClick: null,
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-01T00:00:00Z',
    ...overrides,
  }
}

function mediaItem(overrides: Partial<MediaItem> = {}): MediaItem {
  return {
    id: 'media-1',
    lineAccountId: 'account-a',
    folderId: null,
    kind: 'video',
    filename: 'オンボーディング本編.mov',
    mimeType: 'video/quicktime',
    sizeBytes: 1024,
    width: null,
    height: null,
    durationMs: 90_000,
    url: 'https://media.example.test/mov',
    uploadedBy: null,
    createdAt: '2026-09-01T00:00:00Z',
    ...overrides,
  }
}

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => {
    root.unmount()
  })
  host.remove()
  vi.unstubAllGlobals()
})

async function mount(node: React.ReactNode) {
  await act(async () => {
    root.render(<>{node}</>)
    await Promise.resolve()
  })
}

describe('通知概要の状態表示(DETAIL-19)', () => {
  it('設定済みだけが成功色で、未設定は中立・確認中は保留・失敗はエラー', () => {
    expect(notificationRowState(true, true, false)).toBe('configured')
    expect(notificationRowState(false, true, false)).toBe('unset')
    expect(notificationRowState(undefined, false, false)).toBe('pending')
    expect(notificationRowState(true, true, true)).toBe('failed')
  })

  it('4状態を色と文字で描き分け、未設定に成功色を付けない', () => {
    const cases: Array<['configured' | 'unset' | 'pending' | 'failed', string, string]> = [
      ['configured', 'text-success', '設定済み'],
      ['unset', 'text-ink-faint', '未設定'],
      ['pending', 'text-ink-secondary', '確認中'],
      ['failed', 'text-danger', '取得できません'],
    ]
    for (const [state, tone, label] of cases) {
      const html = renderToStaticMarkup(<NotificationStateBadge state={state} />)
      expect(html).toContain(tone)
      expect(html).toContain(label)
      expect(html).toContain('<svg')
      if (state !== 'configured') expect(html).not.toContain('text-success')
    }
    /* 4状態すべてが別の言葉になる */
    expect(new Set(Object.values(NOTIFICATION_ROW_STATE).map((view) => view.label)).size).toBe(4)
  })
})

describe('動画欄の表示名(DETAIL-18)', () => {
  it('選んだメディアの実ファイル名・種別・長さを出す', async () => {
    vi.stubGlobal('fetch', async () =>
      new Response(JSON.stringify({ success: true, data: { item: mediaItem(), folderName: null } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    await mount(<VideoMediaLabel webinar={webinar({ videoPrefix: 'videos/recruit', videoMediaId: 'media-1' })} />)
    expect(host.textContent).toContain('オンボーディング本編.mov')
    expect(host.textContent).toContain('動画')
    expect(host.textContent).toContain('1:30')
    expect(host.textContent).not.toContain('recruit.mp4')
  })

  it('prefix だけの旧形式は「設定済みの動画」とだけ書く', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    await mount(<VideoMediaLabel webinar={webinar({ videoPrefix: 'videos/recruit' })} />)
    expect(host.textContent).toContain('設定済みの動画')
    expect(host.textContent).not.toContain('recruit.mp4')
    /* メディアIDが無いのでライブラリを問い合わせない */
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('メディアIDがあっても名前を取れないときは偽名を作らない', async () => {
    vi.stubGlobal('fetch', async () =>
      new Response(JSON.stringify({ success: false, error: 'not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    await mount(<VideoMediaLabel webinar={webinar({ videoPrefix: 'videos/recruit', videoMediaId: 'media-1' })} />)
    expect(host.textContent).toContain('設定済みの動画')
    expect(host.textContent).not.toContain('recruit.mp4')
  })

  it('動画が無いときは未設定と出す', async () => {
    await mount(<VideoMediaLabel webinar={webinar()} />)
    expect(host.textContent).toContain('—（未設定）')
  })
})
