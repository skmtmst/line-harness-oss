import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const read = (name: string) => readFileSync(join(HERE, name), 'utf8')

/*
 * 帯/案内（ThDed）の数値の固定。
 * 画面の絵での使われ方を調べた結果、案内の帯は正本どおり
 * （地 #e9f1ff・文 #4a5565・印 #0b63ce・余白 10/14・間 10・
 * 角丸 10・文 13px lh20）で、足す変わり形はなかった。
 * この試験はその一致を守る。灰色の注意書きは絵の指定が
 * 決まりしだい別に足す。
 */
describe('帯/案内（ThDed）の数値', () => {
  it('案内の地・文・印の色は絵の値', () => {
    const css = read('notice.module.css')
    const info = css.match(/\[data-theme='v8'\]\s*\.info\s*{[^}]*}/s)
    expect(info, '案内の地の指定がありません').toBeTruthy()
    expect(info![0]).toContain('var(--color-status-info-soft)')
    const icon = css.match(/\[data-theme='v8'\]\s*\.info\s*\.icon\s*{[^}]*}/s)
    expect(icon, '案内の印の色指定がありません').toBeTruthy()
    expect(icon![0]).toContain('var(--color-action)')
    // トークン自体が絵の値（地 #e9f1ff・文 #4a5565・印 #0b63ce）。
    const tokens = read('../../app/globals.css')
    expect(tokens).toMatch(/--color-status-info-soft:\s*#e9f1ff/)
    expect(tokens).toMatch(/--color-ink-secondary:\s*#4a5565/)
    expect(tokens).toMatch(/--color-action:\s*#0b63ce/)
  })

  it('案内の余白・間・角丸・文は絵の値', () => {
    const css = read('notice.module.css')
    const notice = css.match(/\[data-theme='v8'\]\s*\.notice\s*{[^}]*}/s)
    expect(notice, 'V8 の帯の指定がありません').toBeTruthy()
    expect(notice![0]).toMatch(/gap:\s*10px/)
    expect(notice![0]).toMatch(/padding:\s*10px 14px/)
    expect(notice![0]).toMatch(/border-radius:\s*10px/)
    expect(notice![0]).toMatch(/line-height:\s*20px/)
    expect(css).toMatch(/\.message\s*{[^}]*flex:\s*1/s)
  })
})
