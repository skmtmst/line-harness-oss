import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))

describe('template Button canonical import (#600)', () => {
  it('テンプレート画面は中継部品を使わず共通Buttonを直接読む', () => {
    for (const path of ['detail/page.tsx', 'template-asset-editor.tsx']) {
      const source = readFileSync(join(HERE, path), 'utf8')
      expect(source).toContain("from '@/components/shared/button'")
      expect(source).not.toContain('template-button')
    }
  })
})
