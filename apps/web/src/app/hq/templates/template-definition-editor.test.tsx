// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { emptyLayout } from '@line-crm/shared'
import type { FormDefinition, RichMenuDefinition } from '@/lib/hq-templates-api'
import TemplateDefinitionEditor, { definitionError } from './template-definition-editor'

afterEach(cleanup)

describe('TemplateDefinitionEditor', () => {
  it('統括R2領域外のリッチメニュー画像を保存前に止める', () => {
    const value: RichMenuDefinition = {
      schemaVersion: 1,
      richMenu: {
        id: 'menu', name: 'メニュー', chatBarText: 'メニュー', size: 'large', defaultPageId: 'page-1',
        pages: [{ id: 'page-1', name: 'メイン', imageR2Key: 'rich-menus/store-a/menu.png', areas: [] }],
      },
    }
    expect(definitionError('rich_menu', value, 'tenant-a')).toBe('画像の保存先は hq-templates/tenant-a/ から始めてください。')
  })

  it('複数ページの既存リッチメニューは先頭ページだけを変え、残りを保持する', () => {
    const area = (id: string, x: number) => ({ id, bounds: { x, y: 0, width: 1250, height: 1686 }, actionType: 'uri' as const, actionData: { uri: `https://example.com/${id}` }, intent: 'url' as const })
    const value: RichMenuDefinition = {
      schemaVersion: 1,
      richMenu: {
        id: 'menu', name: 'メニュー', chatBarText: 'メニュー', size: 'large', defaultPageId: 'page-1',
        pages: [
          { id: 'page-1', name: '変更前', imageR2Key: 'hq-templates/tenant-a/main.png', areas: [area('left', 0), area('right', 1250)] },
          { id: 'page-2', name: '残すページ', imageR2Key: 'hq-templates/tenant-a/sub.png', areas: [] },
        ],
      },
    }
    const onChange = vi.fn()
    render(<TemplateDefinitionEditor type="rich_menu" value={value} disabled={false} tenantId="tenant-a" onChange={onChange} />)
    expect((screen.getByRole('button', { name: 'リッチメニューのサイズ' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'リッチメニューのタップ動作' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('リッチメニューのページ名'), { target: { value: '変更後' } })
    expect(onChange).toHaveBeenCalledWith({
      ...value,
      richMenu: { ...value.richMenu, pages: [{ ...value.richMenu.pages[0], name: '変更後' }, value.richMenu.pages[1]] },
    })
  })

  it('高度な回答フォームは未表示のlayoutを守るため質問編集を止める', () => {
    const value: FormDefinition = {
      schemaVersion: 1,
      form: {
        name: '分岐フォーム', description: null,
        fields: [{ name: 'answer', label: '回答', type: 'text', required: true }],
        layout: emptyLayout(),
        on_submit_tag_id: null, on_submit_scenario_id: null, save_to_metadata: true,
      },
    }
    render(<TemplateDefinitionEditor type="form" value={value} disabled={false} onChange={vi.fn()} />)
    expect(screen.getByText(/高度な構成/)).toBeTruthy()
    expect((screen.getByLabelText('質問1の表示名') as HTMLInputElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: '＋質問' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
