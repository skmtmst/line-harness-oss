import { readUiSource as readFileSync } from '../../scripts/test-ui-source.mjs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const APP = dirname(fileURLToPath(import.meta.url))

const targets = [
  'auto-replies/page.tsx',
  'health/page.tsx',
  'mileage/earning-rules/new/page.tsx',
  'webinars/edit/page.tsx',
]

describe('Issue #461 表見出しの余白', () => {
  it.each(targets)('%s の全thを共通余白にそろえる', (path) => {
    const source = readFileSync(join(APP, path), 'utf8')
    const headers = [...source.matchAll(/<th\b[^>]*className="([^"]*)"/g)]

    if (headers.length === 0) {
      // 共通 Th（shared/table）へ寄せた画面は、余白を部品が持つ。
      // 素の th を書かず、共通 Th を使うことを確かめる。
      expect(source, `${path}: 共通 Th を使うか、余白つきの th を書く`).toContain(
        '@/components/shared/table',
      )
      expect(source, `${path}: 共通 Th を使う`).toMatch(/<Th[\s>]/)
      return
    }
    for (const [, classes] of headers) {
      expect(classes.split(/\s+/), `${path}: ${classes}`).toEqual(
        expect.arrayContaining(['px-4', 'py-3']),
      )
    }
  })
})
