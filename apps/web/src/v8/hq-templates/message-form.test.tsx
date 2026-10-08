// @vitest-environment happy-dom
import React, { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MessageTemplateDefinition } from '@/lib/hq-templates-api'
import MessageForm from './message-form'

vi.mock('@/lib/hq-templates-api', () => ({ hqTemplatesApi: { messageReferences: async () => [] } }))
vi.mock('@/lib/use-feature-visibility', () => ({ useFeatureVisibility: () => ({ enabled: () => false }) }))
afterEach(cleanup)

const base: MessageTemplateDefinition = {
  schemaVersion: 1,
  template: { id: 'legacy-message', name: '前のひな形', category: 'general', messageType: 'text', messageContent: 'こんにちは', carouselActionsJson: null, carouselTapLimitMode: 'none', carouselTapLimitText: null, questionJson: null, questionStatus: 'draft' },
  media: [],
}
function Harness({ initial, save }: { initial: MessageTemplateDefinition; save: (value: MessageTemplateDefinition) => void }) {
  const [value, setValue] = useState(initial)
  return <><MessageForm name="前のひな形" onNameChange={() => {}} value={value} onChange={setValue} folders={[]} folderId={null} onFolderChange={() => {}} folderLoadFailed={false} disabled={false} catalogFailed={false} onReloadCatalog={() => {}} /><button onClick={() => save(value)}>保存</button></>
}

describe('統括の旧メッセージ編集（保存結果の再確認にも使う）', () => {
  it('既存のカードは画像・ボタン・参照先を残して本文だけ編集できる', async () => {
    const save = vi.fn()
    const card = { format: 'flex' as const, title: 'ご案内', body: '元の本文', imageMediaId: 'media-old', buttons: [{ id: 'b-1', label: '予約', action: 'url' as const, value: 'https://example.test/book' }] }
    render(<Harness initial={{ ...base, card, template: { ...base.template, messageType: 'flex' } }} save={save} />)
    expect(await screen.findByText(/この形は新しく作れません/)).toBeTruthy()
    expect(screen.queryByRole('radiogroup', { name: 'ひな形の形式' })).toBeNull()
    expect(screen.queryByLabelText('メッセージ形式')).toBeNull()
    fireEvent.change(screen.getByLabelText('配信する本文'), { target: { value: '直した本文' } })
    fireEvent.click(screen.getByRole('button', { name: '保存', exact: true }))
    expect(save.mock.calls[0][0]).toMatchObject({ card: { ...card, body: '直した本文' }, template: { messageType: 'flex' } })
    expect(JSON.parse(save.mock.calls[0][0].template.messageContent).body.contents.some((row: { text?: string }) => row.text === '直した本文')).toBe(true)
  })

  it('既存の画像は切り替えを出さず、URLを直しても画像のまま保存できる', async () => {
    const save = vi.fn()
    render(<Harness initial={{ ...base, template: { ...base.template, messageType: 'image', messageContent: 'https://img.test/old.png' } }} save={save} />)
    expect(await screen.findByText(/この形は新しく作れません/)).toBeTruthy()
    expect(screen.queryByLabelText('メッセージ形式')).toBeNull()
    fireEvent.change(screen.getByLabelText('配信する本文'), { target: { value: 'https://img.test/new.png' } })
    fireEvent.click(screen.getByRole('button', { name: '保存', exact: true }))
    expect(save.mock.calls[0][0].template).toMatchObject({ messageType: 'image', messageContent: 'https://img.test/new.png' })
  })
})
