// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MediaItem, MediaReplacementImpact } from '@line-crm/shared'

/**
 * #918（N-200）: ウェビナー等の置換不可な使用先があっても、
 * 置換可能な箇所だけを明示確認して実行できることを実Reactで証明する。
 */
const fixture = vi.hoisted(() => ({
  impact: null as MediaReplacementImpact | null,
  replaceCalls: [] as Array<{
    id: string
    accountId: string
    input: { replacementMediaId: string; expectedRevision: string; scope?: string }
  }>,
  completed: [] as string[],
}))

const media = (id: string, filename: string): MediaItem => ({
  id,
  lineAccountId: 'account-a',
  folderId: null,
  kind: 'image',
  filename,
  mimeType: 'image/png',
  sizeBytes: 1200,
  width: 100,
  height: 100,
  durationMs: null,
  url: `https://cdn.example.test/${id}.png`,
  uploadedBy: '管理者',
  createdAt: '2026-09-16T09:00:00+09:00',
  usageCount: 0,
})

const SOURCE = media('src-1', '差し替え元.png')
const REPLACEMENT = media('dst-1', '差し替え先.png')

const PARTIAL_IMPACT: MediaReplacementImpact = {
  source: { id: 'src-1', filename: '差し替え元.png', kind: 'image' },
  replacement: { id: 'dst-1', filename: '差し替え先.png', kind: 'image' },
  usageCount: 2,
  replaceableCount: 1,
  blockedCount: 1,
  blockedByKind: { webinar: 1 },
  canReplace: false,
  canPartiallyReplace: true,
  blockers: ['unsupported_reference'],
  checkedAt: '2026-09-16T10:00:00+09:00',
  revision: 'rev-partial',
  references: [
    {
      kind: 'template',
      name: '案内テンプレート',
      href: null,
      state: 'available',
      scannedAt: '2026-09-16T10:00:00+09:00',
      replaceable: true,
      blocker: null,
      reason: null,
    },
    {
      kind: 'webinar',
      name: '使い方講座',
      href: null,
      state: 'available',
      scannedAt: '2026-09-16T10:00:00+09:00',
      replaceable: false,
      blocker: 'unsupported_reference',
      reason: 'ウェビナー動画は配信用の一式を持つため、このファイルだけを差し替えられません。',
    },
  ],
}

const BLOCKED_IMPACT: MediaReplacementImpact = {
  ...PARTIAL_IMPACT,
  usageCount: 1,
  replaceableCount: 0,
  blockedCount: 1,
  canPartiallyReplace: false,
  references: [PARTIAL_IMPACT.references[1]],
}

vi.mock('@/lib/api', () => {
  class ApiError extends Error {
    constructor(readonly status?: number, message = 'API error', readonly data?: unknown) {
      super(message)
    }
  }
  return {
    ApiError,
    api: {
      media: {
        list: () => Promise.resolve({
          success: true,
          data: { items: [REPLACEMENT], total: 1, limit: 50, offset: 0 },
        }),
        replacementImpact: () => Promise.resolve({ success: true, data: fixture.impact }),
        replaceUsages: (
          id: string,
          accountId: string,
          input: { replacementMediaId: string; expectedRevision: string; scope?: string },
        ) => {
          fixture.replaceCalls.push({ id, accountId, input })
          return Promise.resolve({
            success: true,
            data: {
              mode: 'partial',
              replacedUsageCount: 1,
              skippedUsageCount: 1,
              remainingUsageCount: 1,
              verification: 'verified',
            },
          })
        },
        contentUrl: (id: string, accountId: string) => `/api/media/${id}/content?accountId=${accountId}`,
      },
    },
  }
})

const { default: MediaReplacementDialog } = await import('./media-replacement-dialog')

let host: HTMLDivElement
let root: Root

async function settle() {
  await Promise.resolve()
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
  await Promise.resolve()
}

async function renderDialog() {
  await act(async () => {
    root.render(
      <MediaReplacementDialog
        source={SOURCE}
        accountId="account-a"
        onClose={vi.fn()}
        onComplete={(message) => fixture.completed.push(message)}
      />,
    )
    await settle()
  })
}

function dialog(): HTMLElement {
  const node = document.body.querySelector<HTMLElement>('[role="dialog"]')
  if (!node) throw new Error('ダイアログが開いていません')
  return node
}

function buttons(): HTMLButtonElement[] {
  return [...dialog().querySelectorAll<HTMLButtonElement>('button')]
}

async function chooseReplacement() {
  const trigger = buttons().find((b) => b.getAttribute('aria-label') === '差し替え先')!
  await act(async () => { trigger.click(); await settle() })
  const option = buttons().find((b) => b.textContent === '差し替え先.png')!
  await act(async () => { option.click(); await settle() })
}

async function waitForDialogText(text: string) {
  for (let index = 0; index < 30 && !dialog().textContent?.includes(text); index += 1) {
    await act(async () => { await settle() })
  }
  expect(dialog().textContent).toContain(text)
}

beforeEach(() => {
  fixture.impact = null
  fixture.replaceCalls.length = 0
  fixture.completed.length = 0
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  host.remove()
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('使用先の部分差し替え（#918 N-200）', () => {
  it('置換不可の使用先を種類・件数・理由付きで出し、置換可能分だけを明示確認して実行する', async () => {
    fixture.impact = PARTIAL_IMPACT
    await renderDialog()
    await chooseReplacement()
    await waitForDialogText('使い方講座')

    // 全件ボタンは出さず、件数入りの部分実行ボタンだけが押せる。
    const labels = buttons().map((b) => b.textContent)
    expect(labels).not.toContain('使用先を差し替える')
    const partial = buttons().find((b) => b.textContent === '差し替え可能な1か所だけ差し替える')
    expect(partial).toBeTruthy()

    // 除外される使用先は種類・件数・理由が見える。
    expect(dialog().textContent).toContain('差し替えられない使用先：')
    expect(dialog().textContent).toContain('ウェビナー動画は配信用の一式を持つため')

    await act(async () => { partial!.click(); await settle() })
    expect(fixture.replaceCalls).toEqual([
      {
        id: 'src-1',
        accountId: 'account-a',
        input: { replacementMediaId: 'dst-1', expectedRevision: 'rev-partial', scope: 'replaceable' },
      },
    ])
    // 完了メッセージは残存分を「全部替わった」と誤認させない。
    expect(fixture.completed[0]).toContain('差し替えられなかった1か所は、元のメディアを使い続けます。')
  })

  it('置換可能な使用先が0件なら実行ボタンを出さない（何もしない）', async () => {
    fixture.impact = BLOCKED_IMPACT
    await renderDialog()
    await chooseReplacement()
    await waitForDialogText('この画面からは差し替えられる使用先がありません')

    const labels = buttons().map((b) => b.textContent)
    expect(labels).toContain('閉じる')
    expect(labels).not.toContain('差し替え可能な0か所だけ差し替える')
    const all = buttons().find((b) => b.textContent === '使用先を差し替える')
    expect(all?.disabled).toBe(true)
    await act(async () => { all!.click(); await settle() })
    expect(fixture.replaceCalls).toEqual([])
  })
})
