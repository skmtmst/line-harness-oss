// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { emptyLayout } from '@line-crm/shared'
import type { FormDefinition, MessageTemplateDefinition, RichMenuDefinition } from '@/lib/hq-templates-api'
import TemplateDefinitionEditor, { definitionError, freshDefinition, referenceCount } from './template-definition-editor'

vi.mock('@/lib/hq-templates-api', () => ({ hqTemplatesApi: { uploadImage: vi.fn() } }))

afterEach(cleanup)

describe('TemplateDefinitionEditor', () => {
  it('統括メッセージでも店舗と同じ編集面を使い、非表示の保存項目を保持する', () => {
    const value = freshDefinition('template') as MessageTemplateDefinition
    value.template.messageContent = 'ご案内：'
    value.template.carouselActionsJson = '{"keep":true}'
    value.template.questionJson = '{"question":"keep"}'
    const onChange = vi.fn()

    render(<TemplateDefinitionEditor type="template" value={value} disabled={false} onChange={onChange} />)

    expect(screen.getByText('LINEプレビュー')).toBeTruthy()
    expect(screen.getByText('本文に入れたURLの扱い')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '名前' }))

    expect(onChange).toHaveBeenCalledWith({
      ...value,
      template: {
        ...value.template,
        messageContent: 'ご案内：{{name}}',
      },
    })
  })

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

  it('複数ページを保持したまま共通作成UIで名前を変える', () => {
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
    expect(screen.getByRole('list', { name: 'リッチメニュー作成の進み方' })).toBeTruthy()
    fireEvent.change(screen.getByLabelText('メニュー名'), { target: { value: '変更後' } })
    expect(onChange).toHaveBeenCalledWith({
      ...value,
      richMenu: { ...value.richMenu, name: '変更後' },
    })
  })

  it('未対応のシナリオ参照は値を落とさず編集を安全停止する', () => {
    const action = { id: 'area-1', bounds: { x: 0, y: 0, width: 2500, height: 1686 }, actionType: 'message' as const, actionData: { text: '案内を見る' }, intent: 'text' as const, scenarioId: 'source-scenario' }
    const value: RichMenuDefinition = {
      schemaVersion: 1,
      richMenu: {
        id: 'menu', name: 'メニュー', chatBarText: 'メニュー', size: 'large', defaultPageId: 'page-1',
        pages: [{ id: 'page-1', name: 'メイン', imageR2Key: 'hq-templates/tenant-a/main.png', areas: [action] }],
      },
    }
    const onChange = vi.fn()
    render(<TemplateDefinitionEditor type="rich_menu" value={value} disabled={false} tenantId="tenant-a" onChange={onChange} />)
    expect(screen.getByRole('alert').textContent).toContain('シナリオ参照')
    expect((screen.getByLabelText('メニュー名') as HTMLInputElement).disabled).toBe(true)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('シナリオ参照を検証し、参照件数へ含める', () => {
    const value: RichMenuDefinition = {
      schemaVersion: 1,
      richMenu: {
        id: 'menu', name: 'メニュー', chatBarText: 'メニュー', size: 'large', defaultPageId: 'page-1',
        pages: [{ id: 'page-1', name: 'メイン', imageR2Key: 'hq-templates/tenant-a/main.png', areas: [{
          id: 'area-1', bounds: { x: 0, y: 0, width: 2500, height: 1686 }, actionType: 'message', actionData: { text: '案内を見る' }, intent: 'text', scenarioId: 'source-scenario',
        }] }],
      },
    }
    expect(definitionError('rich_menu', value, 'tenant-a')).toBeNull()
    expect(referenceCount('rich_menu', value)).toBe(1)
    expect(definitionError('rich_menu', { ...value, richMenu: { ...value.richMenu, pages: [{ ...value.richMenu.pages[0], areas: [{ ...value.richMenu.pages[0].areas[0], scenarioId: 'invalid id' }] }] } }, 'tenant-a')).toBe('追加で開始するシナリオの元IDを正しく入力してください。')
  })

  it('高度な回答フォームを店舗と同じブロック編集面で開き、layoutを保って保存する', async () => {
    const value: FormDefinition = {
      schemaVersion: 1,
      form: {
        name: '分岐フォーム', description: null,
        fields: [{ name: 'answer', label: '回答', type: 'text', required: true }],
        layout: emptyLayout(),
        on_submit_tag_id: null, on_submit_scenario_id: null, save_to_metadata: true,
      },
    }
    const onCanonicalSave = vi.fn()
    render(<TemplateDefinitionEditor type="form" value={value} disabled={false} onChange={vi.fn()} onCanonicalSave={onCanonicalSave} />)
    expect((screen.getByLabelText(/フォーム名/) as HTMLInputElement).value).toBe('分岐フォーム')
    expect(screen.getByRole('button', { name: '＋ ブロックを追加（12種）' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'フォームを保存' }))
    await waitFor(() => expect(onCanonicalSave).toHaveBeenCalledOnce())
    expect(onCanonicalSave.mock.calls[0][0].form.layout).toEqual(value.form.layout)
  })
})
