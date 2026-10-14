import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { TEMPLATES } from '@/lib/rich-menu-templates'
import { RichMenuTemplatePreview } from '@/components/rich-menus/rich-menu-create-form'

const DIR = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(DIR, '../../src/components/rich-menus/rich-menu-create-form.tsx'), 'utf8')

describe('面の分けかたの記号は実表示の大きさで書く（m22a）', () => {
  it('記号の文字の大きさを3幅の実ブラウザで計算し、巨大な字に戻さない', async () => {
    const template = TEMPLATES.find(item => item.key === 'large-2x2')!
    const html = renderToStaticMarkup(<RichMenuTemplatePreview template={template} />)
    const measurements: Array<{ width: number; sizes: number[] }> = JSON.parse(execFileSync(process.execPath, [join(DIR, 'render-fonts.mjs')], {
      encoding: 'utf8', input: JSON.stringify({ html: `<style>svg{display:block;width:220px;height:auto}</style>${html}`, selector: 'text', widths: [1152, 1440, 1920] }),
    }))
    expect(measurements.map(result => result.width)).toEqual([1152, 1440, 1920])
    for (const { sizes } of measurements) {
      expect(sizes).toHaveLength(4)
      for (const size of sizes) {
        expect(Number.isFinite(size)).toBe(true)
        expect(size).toBeGreaterThanOrEqual(9)
        expect(size).toBeLessThanOrEqual(14)
      }
    }
    expect(source).not.toMatch(/fontSize=\{dims\.height/)
  })
})
