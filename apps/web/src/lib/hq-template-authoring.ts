import type { TemplateType, TemplateDefinition, MessageTemplateDefinition } from './hq-templates-api'

export function freshDefinition(type: TemplateType): TemplateDefinition {
  if (type === 'tag') return { schemaVersion: 1, tag: { name: '', color: '#3B82F6', description: null, folderId: null }, folders: [] }
  if (type === 'template') return { schemaVersion: 1, template: { id: 'hq-authored-message', name: '', category: 'general', messageType: 'text', messageContent: '', carouselActionsJson: null, carouselTapLimitMode: 'none', carouselTapLimitText: null, questionJson: null, questionStatus: 'draft' }, media: [] }
  if (type === 'rich_menu') return { schemaVersion: 1, richMenu: { id: 'rich-menu-main', name: '', chatBarText: 'メニュー', size: 'large', defaultPageId: 'page-1', pages: [{ id: 'page-1', name: 'メイン', imageR2Key: '', areas: [] }] } }
  return { schemaVersion: 1, form: { name: '', description: null, fields: [{ name: 'question_1', label: '質問1', type: 'text', required: false }], layout: null, on_submit_tag_id: null, on_submit_scenario_id: null, save_to_metadata: true } }
}


export function withUploadedImage(value: MessageTemplateDefinition, media: MessageTemplateDefinition['media'][number]): MessageTemplateDefinition {
  const image = value.template.messageType === 'image'
  const items = image ? [media] : [...value.media.filter(item => item.id !== media.id), media]
  if (items.reduce((sum, item) => sum + item.sizeBytes, 0) > 16 * 1024 * 1024) throw new Error('画像の合計は16 MiB以下にしてください。')
  return { ...value, media: items, template: { ...value.template, messageContent: image ? media.publicUrl ?? media.r2Key : value.template.messageContent } }
}
