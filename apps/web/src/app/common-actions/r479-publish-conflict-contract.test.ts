import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const VERSIONS = readFileSync(join(HERE, 'versions', 'page.tsx'), 'utf8')

/*
 * 監査 R479: 版画面で公開が 409（reference_updated など）で止まったあと、
 * 最新版の読み直しが setError('') で競合理由を消していた。
 * 読み直しのあとも理由と次の操作を残し、再試行できること。
 */
describe('公開競合の理由の残存（監査 R479）', () => {
  it('公開の失敗時は読み直しのあとに文言を戻す', () => {
    // R477 の読み直し自体は残す。
    expect(VERSIONS).toContain('await load()')
    // 読み直しで消えた文言を戻す。読み直し自体の失敗は上書きしない。
    expect(VERSIONS).toContain('setError((current) => current || message)')
  })

  it('成功時は知らせを残さない（失敗のときだけ読み直しのあとに戻す）', () => {
    expect(VERSIONS).toContain('if (result !== true)')
  })
})
