import { type MessageTemplateDefinition } from '@/lib/hq-templates-api'
import type { TemplateHostContent } from '@/v8/template-edit/public/host/index'
import { type TemplateKind } from '@line-crm/shared'



/** 保存してある統括のひな形を、店の作る画面へ渡す中身（保存と同じ形）に戻す。読めなければ undefined（空から）。 */
export function hostContentOf(kind: TemplateKind, name: string, definition: MessageTemplateDefinition): TemplateHostContent | undefined {
  if (kind === 'rich_video' && definition.template.messageType === 'imagemap') {
    try {
      const payload = JSON.parse(definition.template.messageContent)
      if (!payload.video) return undefined
      return { kind, name, messageContent: definition.template.messageContent, media: [...definition.media] }
    } catch { return undefined }
  }
  const asset = definition.asset
  if ((kind === 'coupon' || kind === 'research' || kind === 'rich_message') && asset?.kind === kind) {
    const payload = asset.payload as Record<string, unknown>
    return kind === 'rich_message' ? { kind, name, payload, media: [...definition.media] } : { kind, name, payload }
  }
  if (kind === 'question' && definition.template.questionJson) {
    try {
      return { kind, name, question: JSON.parse(definition.template.questionJson) as Record<string, unknown>, messageContent: definition.template.messageContent }
    } catch { return undefined }
  }
  if (kind === 'carousel' && definition.template.messageType === 'carousel') {
    return { kind, name, messageContent: definition.template.messageContent, tapLimitMode: definition.template.carouselTapLimitMode, tapLimitText: definition.template.carouselTapLimitText }
  }
  return undefined
}


/** 店の作る画面が組み立てた中身を、統括のひな形（メッセージ）の形にする。カード型の部品（card）は本文で書き直したので外す。 */
export function hostDefinition(current: MessageTemplateDefinition, content: TemplateHostContent): MessageTemplateDefinition {
  const base = { ...current, template: { ...current.template, name: content.name } }
  const { card: _card, asset: _asset, ...rest } = base
  void _card; void _asset
  if (content.kind === 'rich_video') {
    return { ...rest, media: content.media, template: { ...rest.template, messageType: 'imagemap', messageContent: content.messageContent, carouselActionsJson: null, carouselTapLimitMode: 'none', carouselTapLimitText: null, questionJson: null } }
  }
  if (content.kind === 'message') {
    return { ...rest, template: { ...rest.template, messageType: content.messageType as MessageTemplateDefinition['template']['messageType'], messageContent: content.messageContent, questionJson: null } }
  }
  if (content.kind === 'question') {
    return { ...rest, template: { ...rest.template, messageType: 'text', messageContent: content.messageContent, questionJson: JSON.stringify(content.question), questionStatus: 'published' } }
  }
  if (content.kind === 'rich_message') {
    return { ...rest, media: content.media, asset: { kind: 'rich_message', payload: content.payload as never }, template: { ...rest.template, messageType: 'text', messageContent: '', questionJson: null } }
  }
  if (content.kind === 'carousel') {
    const urls = new Set((JSON.parse(content.messageContent) as Array<{ thumbnailImageUrl?: string }>).map((panel) => panel.thumbnailImageUrl))
    const media = [...rest.media, ...(content.media ?? [])].filter((item, index, all) => item.publicUrl !== null && urls.has(item.publicUrl) && all.findIndex((candidate) => candidate.id === item.id) === index)
    return { ...rest, media, template: { ...rest.template, messageType: 'carousel', messageContent: content.messageContent, carouselActionsJson: null, carouselTapLimitMode: content.tapLimitMode, carouselTapLimitText: content.tapLimitText, questionJson: null } }
  }
  return { ...rest, asset: { kind: content.kind, payload: content.payload as never }, template: { ...rest.template, messageType: 'text', messageContent: '', questionJson: null } }
}
