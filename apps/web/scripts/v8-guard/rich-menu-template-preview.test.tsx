import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { TEMPLATES } from '@/lib/rich-menu-templates'
import { RichMenuTemplatePreview } from '@/components/rich-menus/rich-menu-create-form'

const DIR = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(DIR, '../../src/components/rich-menus/rich-menu-create-form.tsx'), 'utf8')

describe('面の分けかたの記号は実表示の大きさで書く（m22a）', () => {
  it('本物のプレビューを3幅の文字測定へ渡す', () => {
    const template = TEMPLATES.find(item => item.key === 'large-2x2')!
    const html = renderToStaticMarkup(<RichMenuTemplatePreview template={template} />)
    expect(html.match(/<text\b/g)).toHaveLength(4)
    const output = process.env.RICH_MENU_FONT_INPUT
    if (!output) throw new Error('RICH_MENU_FONT_INPUT is required for the font measurement')
    mkdirSync(dirname(output), { recursive: true })
    writeFileSync(output, JSON.stringify({ html: `<style>svg{display:block;width:220px;height:auto}</style>${html}`, selector: 'text', widths: [1152, 1440, 1920] }))
    expect(source).not.toMatch(/fontSize=\{dims\.height/)
  })
})
