import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { tapActionFromUri, tapActionLiffUrl } from './tap-actions'
import { buildCarouselContent, emptyChoice } from '@/v8/templates/carousel-core'
import { panelsFromContent } from '@/v8/templates/carousel'
import { areaDraftsForCreate, saveAreaDraft } from '@/components/rich-menus/action-drafts'
import type { Area } from '@/components/rich-menus/canvas-editor'
import { bubbleLegacyMessage, bubblesForSave, messageTemplateToBubble } from './broadcast-template'

// 監査と同じ方法で、実際のLIFF受け取り関数を変更せずに実行する。
const file = '../../apps/worker/src/client/salon-booking/main.tsx'
const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const readUrlState = source.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === 'readUrlState')
if (!readUrlState) throw new Error('LIFF readUrlState not found')
const code = ts.transpileModule(`${readUrlState.getText(source)}\nreadUrlState()`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
const recipientMenu = (uri: string): string | null => runInNewContext(code, { URLSearchParams, window: { location: { search: new URL(uri).search } } }).menuId

it('作った予約リンクをLIFFが読み、選んだメニューに届く', () => {
  expect(recipientMenu(tapActionLiffUrl('store', 'booking', 'menu-1'))).toBe('menu-1')
})

describe.each(['menu_id', 'menu'])('保存済みの%sリンクを編集して保存し直す', parameter => {
  const saved = `https://liff.line.me/store/?page=salon-book&${parameter}=menu-1`
  const selection = tapActionFromUri(saved)
  it('テンプレート→読み戻し→再保存でも指定が残る', () => {
    expect(selection).toEqual({ kind: 'booking', refId: 'menu-1' })
    const content = buildCarouselContent([{ thumbnailImageUrl: '', title: '', text: '予約のご案内', actions: [{ ...emptyChoice(), label: '予約', kind: 'booking', formId: selection.refId }] }], 'tpl-1', 'store')
    const back = panelsFromContent(content)
    expect(back[0].actions[0]).toMatchObject({ kind: 'booking', formId: 'menu-1' })
    const again = buildCarouselContent(back, 'tpl-1', 'store')
    expect(recipientMenu(JSON.parse(again)[0].actions[0].uri)).toBe('menu-1')
  })
  it('リッチメニューの編集値→保存値でも指定が残る', () => {
    const draft: Area = { id: 'a', boundsX: 0, boundsY: 0, boundsWidth: 100, boundsHeight: 100, intent: 'url', actionType: 'uri', actionData: { uri: tapActionLiffUrl('store', 'booking', selection.refId) } }
    const payload = areaDraftsForCreate(saveAreaDraft([draft], 0, draft))
    const uri = String(payload[0].actionData.uri)
    expect(tapActionFromUri(uri)).toEqual(selection)
    expect(recipientMenu(uri)).toBe('menu-1')
  })
  it('配信へテンプレートを読み込み、保存しても指定が残る', () => {
    const content = buildCarouselContent([{ thumbnailImageUrl: '', title: '', text: '予約のご案内', actions: [{ ...emptyChoice(), label: '予約', kind: 'booking', formId: selection.refId }] }], 'tpl-1', 'store')
    const bubble = messageTemplateToBubble({ id: 'tpl-1', name: '予約のご案内', category: 'general', messageType: 'carousel', messageContent: content })
    if (!bubble) throw new Error('template conversion failed')
    const persisted = bubblesForSave([bubble])!
    const uri = JSON.parse(bubbleLegacyMessage(persisted[0]).messageContent)[0].actions[0].uri
    expect(tapActionFromUri(uri)).toEqual(selection)
    expect(recipientMenu(uri)).toBe('menu-1')
  })
})
