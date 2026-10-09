// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MediaItem } from '@line-crm/shared'
import type { MediaVersionBlocker } from '@/lib/api'

const fixture = vi.hoisted(() => ({
  preparedFiles: [] as Array<Record<string, unknown>>,
  previewBlockers: ['incompatible_dimensions'] as MediaVersionBlocker[],
  canReplace: false,
  createdVersions: [] as Array<Record<string, unknown>>,
}))

class ApiError extends Error {
  constructor(readonly status?: number, message = 'API error') {
    super(message)
  }
}

vi.mock('@/lib/api', () => ({
  ApiError,
  api: {
    media: {
      deleteImpact: () => Promise.resolve({
        success: true,
        data: {
          media: { id: 'media-a', filename: 'A.png', kind: 'image' },
          usageCount: 0,
          references: [],
          versions: [{ versionNo: 1 }],
          checkedAt: '2026-09-16T09:00:00+09:00',
          lastScannedAt: null,
        },
      }),
      contentUrl: () => '/api/media/media-a/content?accountId=account-a',
      download: () => Promise.resolve(new Blob()),
      prepareUploads: (input: { files: Array<Record<string, unknown>> }) => {
        fixture.preparedFiles.push(...input.files)
        return Promise.resolve({
          success: true,
          data: {
            sessions: [{
              id: 'upload-1',
              filename: 'b.png',
              sizeBytes: 10,
              targetMediaId: 'media-a',
              method: 'PUT',
              uploadUrl: 'https://r2.example.test/upload',
              requiredHeaders: {},
              expiresAt: '2099-01-01T00:00:00.000Z',
            }],
          },
        })
      },
      completeUpload: () => Promise.resolve({
        success: true,
        data: { uploadSessionId: 'upload-1', status: 'verified', targetMediaId: 'media-a' },
      }),
      previewVersion: () => Promise.resolve({
        success: true,
        data: {
          mediaId: 'media-a',
          uploadSessionId: 'upload-1',
          currentVersionNo: 1,
          previewToken: 'token-1',
          blockers: fixture.previewBlockers,
          canReplace: fixture.canReplace,
        },
      }),
      createVersion: (_id: string, input: Record<string, unknown>) => {
        fixture.createdVersions.push(input)
        return Promise.resolve({ success: true, data: { mediaId: 'media-a', versionNo: 2 } })
      },
    },
  },
}))

vi.mock('./media-direct-upload', () => ({
  extractMediaMetadata: () => Promise.resolve({ width: 200, height: 100 }),
  fileMatchesMediaKind: () => true,
  mediaAcceptForKind: () => 'image/png',
  putMediaFile: () => Promise.resolve('etag-1'),
  validateMediaFile: () => null,
}))

const { default: MediaDetailDialog } = await import('./media-detail-dialog')

const ITEM: MediaItem = {
  id: 'media-a',
  lineAccountId: 'account-a',
  folderId: null,
  kind: 'image',
  filename: 'A.png',
  mimeType: 'image/png',
  sizeBytes: 1200,
  width: 100,
  height: 50,
  durationMs: null,
  url: 'https://example.test/a.png',
  uploadedBy: '管理者',
  createdAt: '2026-09-16T09:00:00+09:00',
  usageCount: 0,
}

let host: HTMLDivElement
let root: Root
let mounted = false

async function settle() {
  await Promise.resolve()
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
  await Promise.resolve()
}

async function renderDialog() {
  await act(async () => {
    root.render(
      <MediaDetailDialog
        item={ITEM}
        accountId="account-a"
        folderName=""
        canManage
        onClose={() => undefined}
        onOpenReplacement={() => undefined}
        onVersionCreated={() => undefined}
      />,
    )
    await settle()
  })
}

function portal(): HTMLElement {
  const el = document.body.lastElementChild
  if (!(el instanceof HTMLElement)) throw new Error('ダイアログが開いていません')
  return el
}

async function pickFile() {
  const input = portal().querySelector<HTMLInputElement>('input[type="file"]')
  if (!input) throw new Error('ファイル入力がありません')
  const file = new File(['x'], 'b.png', { type: 'image/png' })
  Object.defineProperty(input, 'files', { value: [file], configurable: true })
  await act(async () => {
    input.dispatchEvent(new Event('change', { bubbles: true }))
    await settle()
  })
}

async function clickButton(text: string) {
  const button = [...portal().querySelectorAll('button')]
    .find((b) => b.textContent?.includes(text))
  if (!button) throw new Error(`${text} ボタンがありません`)
  await act(async () => {
    button.click()
    await settle()
  })
}

beforeEach(() => {
  fixture.preparedFiles.length = 0
  fixture.createdVersions.length = 0
  fixture.previewBlockers = ['incompatible_dimensions']
  fixture.canReplace = false
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  mounted = true
})

afterEach(async () => {
  if (mounted) await act(async () => { root.unmount() })
  host.remove()
  document.querySelectorAll('body > div').forEach((el) => {
    if (el !== host) el.remove()
  })
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('メディア版追加の内容互換性（N-199）', () => {
  it('予約へ実ファイルから読んだ内容情報を載せる', async () => {
    await renderDialog()
    await pickFile()
    await clickButton('差し替え内容を確認')

    expect(fixture.preparedFiles).toHaveLength(1)
    expect(fixture.preparedFiles[0]).toMatchObject({
      filename: 'b.png',
      mimeType: 'image/png',
      targetMediaId: 'media-a',
      metadata: { width: 200, height: 100 },
    })
  })

  it('寸法が違うときは理由を示して追加ボタンを出さない', async () => {
    fixture.previewBlockers = ['incompatible_dimensions']
    await renderDialog()
    await pickFile()
    await clickButton('差し替え内容を確認')

    expect(portal().textContent).toContain('寸法が違うため')
    expect(portal().textContent).not.toContain('新しい版を追加する')
    expect(fixture.createdVersions).toHaveLength(0)
  })

  it('判定材料が足りないときは互換性未確認として拒否理由を示す', async () => {
    fixture.previewBlockers = ['metadata_missing']
    await renderDialog()
    await pickFile()
    await clickButton('差し替え内容を確認')

    expect(portal().textContent).toContain('内容情報（寸法・長さ・ページ数）が足りない')
    expect(fixture.createdVersions).toHaveLength(0)
  })

  it('互換なら変更理由を入れて新版を追加できる', async () => {
    fixture.previewBlockers = []
    fixture.canReplace = true
    await renderDialog()
    await pickFile()
    await clickButton('差し替え内容を確認')
    expect(portal().textContent).toContain('第2版へ追加できます')

    const reason = portal().querySelector<HTMLInputElement>('input[maxlength="500"]')
    if (!reason) throw new Error('変更理由の入力がありません')
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setter.call(reason, '秋の写真へ更新')
      reason.dispatchEvent(new Event('input', { bubbles: true }))
      await settle()
    })
    await clickButton('新しい版を追加する')
    expect(fixture.createdVersions).toEqual([expect.objectContaining({
      uploadSessionId: 'upload-1',
      previewToken: 'token-1',
      changeReason: '秋の写真へ更新',
    })])
  })
})
