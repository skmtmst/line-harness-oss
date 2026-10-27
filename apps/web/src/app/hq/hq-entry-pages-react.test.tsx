// @vitest-environment happy-dom
/*
 * 統括の入口ページの受け渡し。ひな形の画面（src/v8/hq-templates/console）へ種類と編集部品を渡し、
 * 古い店舗一覧の住所は統括（/hq）へ送る。画面の中身はそれぞれの試験が見る。
 */
import React from 'react'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({ query: '', redirect: vi.fn(), console: vi.fn(), delivery: vi.fn() }))
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(fixture.query), redirect: fixture.redirect }))
vi.mock('@/v8/hq-templates/console', () => ({
  default: (props: { type: string; DefinitionEditor: unknown }) => { fixture.console(props); return <p data-console={props.type} /> },
}))
vi.mock('@/v8/hq-deliveries/console', () => ({
  default: (props: { type: string }) => { fixture.delivery(props); return <p data-delivery={props.type} /> },
}))
vi.mock('./templates/template-definition-editor', () => ({ default: () => null }))

import TemplateDefinitionEditor from './templates/template-definition-editor'
import HqTemplatesPage from './templates/page'
import HqFormSubmissionsPage from './form-submissions/page'
import RestaurantStoresPage from '../restaurant-test/stores/page'

afterEach(() => { cleanup(); vi.clearAllMocks(); fixture.query = '' })

describe('統括の入口ページ', () => {
  it('テンプレートは V8 のひな形の画面に、既定の種類と今の編集部品を渡す', () => {
    const view = render(<HqTemplatesPage />)
    expect(view.container.querySelector('[data-console="template"]')).not.toBeNull()
    expect(fixture.console).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'template', DefinitionEditor: TemplateDefinitionEditor }))
  })

  it('回答フォームは同じひな形の画面を回答フォームの種類で出す', () => {
    const view = render(<HqFormSubmissionsPage />)
    expect(view.container.querySelector('[data-console="form"]')).not.toBeNull()
    expect(fixture.console).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'form', DefinitionEditor: TemplateDefinitionEditor }))
  })

  it('古い店舗一覧の住所は統括へ送る', () => {
    RestaurantStoresPage()
    expect(fixture.redirect).toHaveBeenCalledWith('/hq')
  })
})
