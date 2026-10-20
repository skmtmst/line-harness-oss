import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// @ts-expect-error 画面確認用fixtureは素のJS。型定義は持たない。
import { BROADCASTS, BROADCAST_FOLDERS } from './fixtures.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..', '..')
const MOCK_API = readFileSync(join(HERE, 'mock-api.mjs'), 'utf8')
const FOLDER_PANEL = readFileSync(join(ROOT, 'apps/web/src/components/shared/folder-panel.tsx'), 'utf8')
const FOLDER_DIALOG = readFileSync(join(ROOT, 'apps/web/src/components/shared/folder-add-dialog.tsx'), 'utf8')

type CaptureScreen = {
  node: string
  route?: string
  steps?: Array<{ qaOpen?: string }>
  variants?: Array<{ suffix?: string; steps?: Array<{ click?: string }> }>
}

describe('一斉配信の画面確認契約', () => {
  it('予約完了の固定配信は、撮影アカウントに所属する', () => {
    const reserved = BROADCASTS.find((item: { id: string }) => item.id === 'broadcast-0')
    expect(reserved).toMatchObject({
      status: 'scheduled',
      lineAccountId: 'visual-qa-account',
    })
  })

})
