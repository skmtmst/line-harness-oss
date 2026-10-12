import { readFileSync } from 'node:fs'
import { readUiSource } from '../../../../scripts/test-ui-source.mjs'
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
      if (page === 'app/login/two-factor/page.tsx') {
        expect(readUiSource(join(APP, page))).toContain('scope="admin"')
        const css = readFileSync(join(APP, 'v8/login/two-factor-ops.module.css'), 'utf8')
        expect(css).toContain('flex-direction: column;')
        expect(css).toContain('width: 100%;')
      } else {
        expect(readUiSource(join(APP, page))).toContain('<AuthForm')
        const css = readFileSync(join(APP, 'components/templates/auth-page.module.css'), 'utf8')
        expect(css).toContain('flex-direction: column;')
      }
      expect(source).not.toContain('grid grid-cols-2 gap-2')
    })
  }
})
