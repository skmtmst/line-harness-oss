export interface HqMessageCard {
  format: 'text' | 'flex'
  title: string
  body: string
  imageMediaId?: string
  buttons: Array<{ id: string; label: string; action: 'url' | 'message' | 'form' | 'scenario'; value: string }>
}
export interface HqMessageReference {
  kind: 'form' | 'scenario'
  id: string
  name: string
  accountName: string
}
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const text = (value: unknown, max: number, empty = false): value is string => typeof value === 'string' && value.length <= max && (empty || !!value.trim())
const identifier = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value)
export function parseHqMessageCard(value: unknown): HqMessageCard {
  if (!record(value) || Object.keys(value).some(k => !['format', 'title', 'body', 'buttons', 'imageMediaId'].includes(k))
    || !['text', 'flex'].includes(String(value.format)) || !text(value.title, 200, true)
    || !text(value.body, value.format === 'flex' ? 2000 : 5000) || !Array.isArray(value.buttons) || value.buttons.length > 3
    || (value.imageMediaId !== undefined && !identifier(value.imageMediaId))) throw new Error('タイトル・本文・ボタンを確認してください。')
  for (const button of value.buttons) {
    if (!record(button) || Object.keys(button).some(k => !['id', 'label', 'action', 'value'].includes(k))
      || !identifier(button.id) || !text(button.label, 20) || !['url', 'message', 'form', 'scenario'].includes(String(button.action))
      || !text(button.value, button.action === 'message' ? 300 : 2000)
      || (['form', 'scenario'].includes(String(button.action)) && !identifier(button.value))) throw new Error('ボタンの文字と押したときを入力してください。')
    if (button.action === 'url') {
      let url: URL
      try { url = new URL(button.value) } catch { throw new Error('ボタンには正しいURLを入力してください。') }
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('ボタンにはhttpまたはhttpsのURLを入力してください。')
    }
  }
  const card = value as unknown as HqMessageCard
  if (new Set(card.buttons.map(b => b.id)).size !== card.buttons.length
    || (card.format === 'text' && (card.buttons.length || card.imageMediaId))) throw new Error('画像やボタンがある場合はカード型を選んでください。')
  if (card.format === 'text' && [card.title, card.body].filter(Boolean).join('\n').length > 5000) throw new Error('タイトルと本文は合わせて5000文字以下にしてください。')
  return { ...card, buttons: card.buttons.map(button => ({ ...button })) }
}
/** Form placeholders exist only in the HQ definition; the Worker resolves them before distribution. */
export function hqCardFormLocator(id: string) { return `https://hq.invalid/form/${encodeURIComponent(id)}` }
export function composeHqMessageCard(card: HqMessageCard, templateId: string, imageUrl?: string, targets: Readonly<Record<string, string>> = {}) {
  if (card.format === 'text') return { messageType: 'text' as const, messageContent: [card.title, card.body].filter(Boolean).join('\n'), carouselActionsJson: null }
  const operations: Record<string, unknown[]> = {}
  const buttons = card.buttons.map((button, index) => {
    let action: Record<string, string>
    if (button.action === 'url') action = { type: 'uri', label: button.label, uri: button.value }
    else if (button.action === 'message') action = { type: 'message', label: button.label, text: button.value }
    else if (button.action === 'form') action = { type: 'uri', label: button.label, uri: targets[`form:${button.value}`] ?? hqCardFormLocator(button.value) }
    else {
      action = { type: 'postback', label: button.label, data: `ctpl=${templateId}&c=0&a=${index}` }
      operations[String(index)] = [{ actionType: 'scenario', config: { op: 'start', scenarioId: targets[`scenario:${button.value}`] ?? button.value } }]
    }
    return { type: 'button', style: 'primary', action }
  })
  const contents = [...(card.title ? [{ type: 'text', text: card.title, weight: 'bold', wrap: true }] : []), { type: 'text', text: card.body, wrap: true, margin: 'md' }]
  const bubble = { type: 'bubble', ...(imageUrl ? { hero: { type: 'image', url: imageUrl, size: 'full', aspectRatio: '20:13', aspectMode: 'cover' } } : {}), body: { type: 'box', layout: 'vertical', contents }, ...(buttons.length ? { footer: { type: 'box', layout: 'vertical', spacing: 'sm', contents: buttons } } : {}) }
  return { messageType: 'flex' as const, messageContent: JSON.stringify(bubble), carouselActionsJson: Object.keys(operations).length ? JSON.stringify({ '0': operations }) : null }
}
