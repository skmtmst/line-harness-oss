// @vitest-environment happy-dom
/**
 * 面の分けかたの見本（SVG）。面の記号（A・B…）は SVG 内の単位のまま
 * 200px超で書かれていたため、計算上の大きな文字として読まれ、面ごとに
 * 上端がずれた数字として検出された。記号の位置（面の中心）は変えず、
 * 大きさだけ実表示に合わせた px 指定にすることが約束。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { TEMPLATES } from '@/lib/rich-menu-templates'
import { RichMenuTemplatePreview } from './rich-menu-create-form'

const DIR = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(DIR, 'rich-menu-create-form.tsx'), 'utf8')

describe('面の分けかたの記号は実表示の大きさで書く（m22a）', () => {
  it('記号の大きさは実表示の px 指定（SVG 内単位の 200px超に戻さない）', () => {
    expect(source).toMatch(/fontSize:\s*'clamp\(9px/)
    expect(source).not.toMatch(/fontSize=\{dims\.height/)
  })

  it('4面の記号 A〜D が面の中心にある（位置は変えない）', () => {
    const template = TEMPLATES.find((item) => item.key === 'large-2x2')
    if (!template) throw new Error('large-2x2 がありません')
    const { container } = render(<RichMenuTemplatePreview template={template} />)
    const texts = [...container.querySelectorAll('text')]
    expect(texts.map((el) => el.textContent)).toEqual(['A', 'B', 'C', 'D'])
    // A は左上、B は右上、C は左下の面の中心
    expect(Number(texts[0].getAttribute('x'))).toBeLessThan(Number(texts[1].getAttribute('x')))
    expect(texts[0].getAttribute('y')).toBe(texts[1].getAttribute('y'))
    expect(Number(texts[0].getAttribute('y'))).toBeLessThan(Number(texts[2].getAttribute('y')))
  })

  it('自由に配置の文言が出る', () => {
    const template = TEMPLATES.find((item) => item.key === 'large-empty')
    if (!template) throw new Error('large-empty がありません')
    const { container } = render(<RichMenuTemplatePreview template={template} />)
    const texts = [...container.querySelectorAll('text')]
    expect(texts).toHaveLength(1)
    expect(texts[0].textContent).toBe('自由に配置')
  })
})
