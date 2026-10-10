import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
// @ts-expect-error Node用の検査スクリプトを同じ入口で試す
import { audit, cssCandidates, classCandidates } from '../../scripts/v8-card-shadow.mjs'

const web = resolve(__dirname, '../..')
const exceptions = JSON.parse(readFileSync(resolve(web, 'design/card-shadow-exceptions.json'), 'utf8')) as { file: string; selector: string; reason: string }[]
const key = (r: { file: string; selector: string }) => `${r.file} ${r.selector}`

describe('B-137・B-148 中身のカードには影を付ける', () => {
  it('V8の影なし候補は、理由を記録した例外だけ', () => {
    const permitted = new Set(exceptions.map(key))
    expect(exceptions.every(r => r.reason.length > 10)).toBe(true)
    expect(audit(resolve(web, 'src')).filter((r: { file: string; selector: string }) => !permitted.has(key(r)))).toEqual([])
  }, 60_000)

  it('新しい線だけのカードを見逃さず、影のカードは通す', () => {
    expect(cssCandidates('.newCard { border-radius:var(--radius-card); box-shadow:var(--tpl-fe-ring); }')).toEqual(['.newCard'])
    expect(cssCandidates('.newCard { border-radius:var(--radius-card); border:1px solid var(--color-hairline); }')).toEqual(['.newCard'])
    expect(cssCandidates('.newCard { border-radius:var(--radius-card); border:1px solid var(--card-edge); box-shadow:var(--card-shadow); }')).toEqual([])
    expect(classCandidates('<section className="rounded-card border border-hairline bg-canvas">中身</section>')).toHaveLength(1)
    expect(classCandidates('<section className="rounded-card border content-card bg-canvas">中身</section>')).toEqual([])
  })

  it('共通のカード入口は影と輪郭の両方を持つ', () => {
    const global = readFileSync(resolve(web, 'src/app/globals.css'), 'utf8')
    const card = readFileSync(resolve(web, 'src/components/shared/card.module.css'), 'utf8')
    for (const [source, selector] of [[global, 'content-card'], [card, 'card']]) {
      const body = source.match(new RegExp(`\\.${selector}\\s*\\{([^}]+)\\}`))?.[1]
      expect(body).toContain('border: 1px solid var(--card-edge)')
      expect(body).toContain('box-shadow: var(--card-shadow)')
    }
  })
})
