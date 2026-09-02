import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const templatesSource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'page.tsx'), 'utf8')
const broadcastsSource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../broadcasts/page.tsx'), 'utf8')
const formSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../components/broadcasts/broadcast-form.tsx'),
  'utf8',
)

describe('コンテンツテンプレートから一斉配信への引用導線', () => {
  it('manages the four reusable content types on the template page', () => {
    for (const kind of ['rich_message', 'card_message', 'coupon', 'research']) {
      expect(templatesSource).toContain(`'${kind}'`)
    }
    for (const label of ['リッチメッセージ', 'カルーセル', 'クーポン', 'リサーチ']) {
      expect(templatesSource).toContain(`label: '${label}'`)
    }
  })

  it('does not keep content-authoring tabs on the broadcast list', () => {
    expect(broadcastsSource).not.toContain('一斉配信メニュー')
    expect(broadcastsSource).not.toContain('<BroadcastAssetManager')
  })

  it('loads both message and content templates into the broadcast picker', () => {
    expect(formSource).toContain('api.templates.list()')
    expect(formSource).toContain('api.broadcastMessageAssets.list')
    expect(formSource).toContain('コンテンツのテンプレートを引用')
  })
})
