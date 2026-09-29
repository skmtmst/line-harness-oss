import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const APP = join(__dirname, '..', '..', '..')

/**
 * 監査 m18e: 320px で二段階認証の手順（2列）がはみ出す。
 * 狭い幅では1列に積み、640px 以上で2列に戻す。
 */
describe('二段階認証の手順の列（m18e・320px）', () => {
  for (const page of ['app/login/two-factor/page.tsx', 'app/login/two-factor/setup/page.tsx']) {
    it(`${page} は狭い幅で1列`, () => {
      const source = readFileSync(join(APP, page), 'utf8')
      expect(source).toContain('grid-cols-1 gap-2 text-xs sm:grid-cols-2')
      expect(source).not.toContain('grid grid-cols-2 gap-2')
    })
  }
})
