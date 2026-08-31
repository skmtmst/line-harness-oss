import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'page.tsx'), 'utf8')

/** 友だち追加時配信の公開（設計 `ec9vg` 5-F ／ `quhg6` 5-G）。 */
describe('友だち追加時配信の公開画面', () => {
  it('読込・空・失敗・権限不足を別の面にする', () => {
    for (const kind of ['loading', 'empty', 'error', 'forbidden']) {
      expect(PAGE).toContain(`kind="${kind}"`)
    }
    // 404は「下書きがない」。失敗と混ぜない。
    expect(PAGE).toContain('error.status === 404')
    expect(PAGE).toContain('error.status === 403')
    expect(PAGE).toContain('確認する下書きがありません')
  })

  it('設計のNodeと押し口に印を付ける', () => {
    expect(PAGE).toContain('data-design-node="ec9vg"')
    expect(PAGE).toContain('data-design-node="quhg6"')
    expect(PAGE).toContain('data-qa-open="ec9vg"')
    expect(PAGE).toContain('data-qa-open="quhg6"')
  })

  it('公開に版ごとの鍵を付ける', () => {
    // 二重に押しても2回公開されないよう、同じ下書きには同じ鍵を使う。
    expect(PAGE).toContain('idempotencyKeyFor(draft)')
  })

  it('押せないときに理由を出す', () => {
    expect(PAGE).toContain('blockedReason(validation)')
    expect(PAGE).toContain('disabled={!ready}')
  })

  it('公開前の対象見込みは validation の値を使う', () => {
    // 公開後の返事を先取りしたり、設計の数字を置いたりしない。
    expect(PAGE).toContain('audienceText(validation?.estimatedAudienceCount)')
    expect(PAGE).not.toContain('214人')
  })

  it('実行結果へは、つながっているときだけリンクする', () => {
    expect(PAGE).toContain('monitoring.href ?')
    expect(PAGE).toContain('monitoringLink(result)')
  })
})
