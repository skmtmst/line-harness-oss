import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// @ts-expect-error 画面確認用fixtureは素のJS。型定義は持たない。
import { BROADCASTS, BROADCAST_FOLDERS } from './fixtures.mjs'
// @ts-expect-error 画面確認用の画面台帳は素のJS。型定義は持たない。
import { SCREENS } from './screens.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..', '..')
const MOCK_API = readFileSync(join(HERE, 'mock-api.mjs'), 'utf8')
const BROADCASTS_PAGE = readFileSync(join(ROOT, 'apps/web/src/app/broadcasts/page.tsx'), 'utf8')
const FOLDER_PANEL = readFileSync(join(ROOT, 'apps/web/src/components/shared/folder-panel.tsx'), 'utf8')
const FOLDER_DIALOG = readFileSync(join(ROOT, 'apps/web/src/components/shared/folder-add-dialog.tsx'), 'utf8')

type CaptureScreen = {
  node: string
  route?: string
  steps?: Array<{ qaOpen?: string }>
  variants?: Array<{ suffix?: string; steps?: Array<{ click?: string }> }>
}

const screen = (node: string) => (SCREENS as CaptureScreen[]).find((item) => item.node === node)

describe('一斉配信の画面確認契約', () => {
  it('予約完了の固定配信は、撮影アカウントに所属する', () => {
    const reserved = BROADCASTS.find((item: { id: string }) => item.id === 'broadcast-0')
    expect(reserved).toMatchObject({
      status: 'scheduled',
      lineAccountId: 'visual-qa-account',
    })
  })

  it('フォルダ操作を開ける固定行とAPIがある', () => {
    expect(BROADCAST_FOLDERS.length).toBeGreaterThan(0)
    expect(MOCK_API).toContain("query.get('kind') === 'broadcast'")
    expect(BROADCASTS_PAGE).toContain("qaOpen: index === 1 ? 'xkRDb' : undefined")
    expect(screen('xkRDb')?.steps).toContainEqual(expect.objectContaining({ qaOpen: 'xkRDb' }))
    for (const label of ['名前を変更', '色を変える', '並び順を上へ', '並び順を下へ', 'フォルダを削除']) {
      expect(FOLDER_PANEL).toContain(label)
    }
    expect(FOLDER_DIALOG).toContain('const folderUpdates = { name: trimmed, color }')
    expect(FOLDER_DIALOG).toContain('api.folders.update(folder.id, folderUpdates)')
  })

  it('予約取消と条件保存の変種まで撮影手順を持つ', () => {
    expect(screen('bPF0s')?.route).toBe('/broadcasts/reserved?id=broadcast-0')
    expect(MOCK_API).toContain("pathname === '/api/broadcasts/preflight'")
    expect(MOCK_API).toContain('const broadcastOne = pathname.match')
    expect(screen('bPF0s')?.variants).toContainEqual(
      expect.objectContaining({ suffix: '-cancel', steps: [expect.objectContaining({ click: '予約を取り消す' })] }),
    )
    expect(MOCK_API).toContain("pathname === '/api/saved-searches'")
    expect(MOCK_API).toContain("type: 'tag_exists'")
    expect(screen('sqFXf')?.variants).toContainEqual(
      expect.objectContaining({ suffix: '-save', steps: expect.arrayContaining([expect.objectContaining({ click: 'この条件を保存' })]) }),
    )
  })
})
