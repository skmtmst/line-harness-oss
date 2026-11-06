// @vitest-environment happy-dom
/**
 * 面の分けかたの見本（SVG）。面の記号（A・B…）は SVG 内の単位のまま
 * 200px超で書かれていたため、計算上の大きな文字として読まれ、面ごとに
 * 上端がずれた数字として検出された。記号の位置（面の中心）は変えず、
 * 大きさだけ実表示に合わせた px 指定にすることが約束。
 */
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { TEMPLATES } from '@/lib/rich-menu-templates'
import { RichMenuTemplatePreview } from './rich-menu-create-model'

// globals: false のため Testing Library の自動 cleanup は登録されない。
afterEach(async () => {
  await act(async () => cleanup())
})

describe('面の分けかたの記号は実表示の大きさで書く（m22a）', () => {
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
