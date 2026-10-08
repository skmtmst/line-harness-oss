/*
 * ★V8 統括のテンプレート（LRc93・X4JcOf・meBRB）の、画面に依らない小さな計算。
 * src/v8 からは @/app を読めないので、今の画面（app/hq/templates/template-console.tsx・
 * template-definition-editor.tsx・image-size.ts）から写した。中身・判定は同じ。
 * 片方を直したらもう片方も同じに直す。
 */
import { parseHqMessageCard } from '@line-crm/shared'
import { freshDefinition } from '@/lib/hq-template-authoring'
import type { DistributionMode, DistributionResult, MessageTemplateDefinition, Preflight, Resolution, TemplateDefinition, TemplateType } from '@/lib/hq-templates-api'

export function definitionName(type: TemplateType, definition: TemplateDefinition): string {
  if (type === 'scenario' && 'scenario' in definition) return definition.scenario.name
  if (type === 'tag' && 'tag' in definition) return definition.tag.name
  if (type === 'template' && 'template' in definition) return definition.template.name
  if (type === 'rich_menu' && 'richMenu' in definition) return definition.richMenu.name
  if (type === 'form' && 'form' in definition) return definition.form.name
  return ''
}

export function definitionForName(type: TemplateType, definition: TemplateDefinition, name: string, description: string): TemplateDefinition {
  if (type === 'scenario' && 'scenario' in definition) return { ...definition, scenario: { name, description: description || null } }
  if (type === 'tag' && 'tag' in definition) return { ...definition, tag: { ...definition.tag, name, description: description || null } }
  if (type === 'template' && 'template' in definition) return { ...definition, template: { ...definition.template, name } }
  if (type === 'rich_menu' && 'richMenu' in definition) return { ...definition, richMenu: { ...definition.richMenu, name } }
  if (type === 'form' && 'form' in definition) return { ...definition, form: { ...definition.form, name, description: description || null } }
  return freshDefinition(type)
}

export function definitionError(type: TemplateType, definition: TemplateDefinition, tenantId?: string): string | null {
  if (!definitionName(type, definition).trim()) return 'ひな形の名前を入力してください。'
  if (type === 'scenario' && 'scenario' in definition) return definition.steps.length && definition.steps.every((step) => step.messageContent.trim() && Number.isSafeInteger(step.delayMinutes) && step.delayMinutes >= 0) ? null : '各ステップの本文と遅延を入力してください。'
  if (type === 'tag' && 'tag' in definition) return definition.folders.some((folder) => !folder.name.trim()) ? 'タググループ名を入力してください。' : null
  if (type === 'template' && 'template' in definition) {
    if (definition.card) {
      try { parseHqMessageCard(definition.card) } catch (error) { return error instanceof Error ? error.message : '入力内容を確認してください。' }
    }
    /* クーポン・リサーチ・カルーセル（素材）と質問は本文を持たない（店の素材と同じ形の payload・質問の JSON が中身）。 */
    if (definition.asset || definition.template.questionJson) return null
    return definition.template.messageContent.trim() ? null : '配信する本文を入力してください。'
  }
  if (type === 'rich_menu' && 'richMenu' in definition) {
    if (!definition.richMenu.chatBarText.trim()) return 'トーク画面に表示する文字を入力してください。'
    if (!definition.richMenu.pages.length || definition.richMenu.pages.some((page) => !page.name.trim() || !page.imageR2Key.trim())) return '各ページの名前と画像の保存先を入力してください。'
    if (tenantId && definition.richMenu.pages.some((page) => !page.imageR2Key.startsWith(`hq-templates/${tenantId}/`))) return `画像の保存先は hq-templates/${tenantId}/ から始めてください。`
    for (const page of definition.richMenu.pages) for (const area of page.areas) {
      if (area.intent === 'url' && !area.actionData.uri?.trim()) return 'タップ先URLを入力してください。'
      if (area.intent === 'text' && !area.actionData.text?.trim()) return 'タップ時のメッセージを入力してください。'
      if (area.intent === 'form' && !area.formId?.trim()) return 'タップ先の回答フォームを入力してください。'
      if (area.intent === 'template' && !area.templateId?.trim()) return 'タップ先のテンプレートを入力してください。'
      if (area.scenarioId !== undefined && !/^[A-Za-z0-9_-]{1,128}$/.test(area.scenarioId)) return '追加で開始するシナリオの元IDを正しく入力してください。'
      if (area.scenarioId && !['text', 'template'].includes(String(area.intent))) return 'シナリオ開始は、メッセージまたはテンプレートを送るタップ動作に設定してください。'
    }
    return null
  }
  if (type === 'form' && 'form' in definition) {
    if (!definition.form.fields.length) return '質問を1件以上追加してください。'
    if (definition.form.fields.some((field) => !field.name.trim() || !field.label.trim())) return '各質問の管理名と表示名を入力してください。'
    if (new Set(definition.form.fields.map((field) => field.name.trim())).size !== definition.form.fields.length) return '質問の管理名は重複しない名前にしてください。'
  }
  return null
}

export function referenceCount(type: TemplateType, definition: TemplateDefinition): number {
  if (type === 'tag' && 'tag' in definition) return definition.folders.length
  if (type === 'template' && 'template' in definition) return definition.media.length
  if (type === 'rich_menu' && 'richMenu' in definition) return definition.richMenu.pages.reduce((sum, page) => sum + page.areas.reduce((count, area) => count + (area.formId ? 1 : 0) + (area.templateId ? 1 : 0) + (area.scenarioId ? 1 : 0) + (area.tagIds?.length ?? 0), 0), 0)
  if (type === 'form' && 'form' in definition) return Number(Boolean(definition.form.on_submit_tag_id)) + Number(Boolean(definition.form.on_submit_scenario_id))
  return 0
}

/** R568: ひな形が指している画像の保存先だけを集める。 */
export function uploadedKeysIn(definition: TemplateDefinition): string[] {
  if ('media' in definition && Array.isArray(definition.media)) return definition.media.map((item) => item.r2Key).filter((key) => key.trim() !== '')
  if ('richMenu' in definition) return definition.richMenu.pages.map((page) => page.imageR2Key).filter((key) => key.trim() !== '')
  return []
}

export const choiceKey = (account: string, source: string) => JSON.stringify([account, source])

export function resolvedItems(preflight: Preflight, choices: Record<string, DistributionMode>): Resolution[] | null {
  if (!preflight.stores.length || preflight.stores.some((store) => !store.items.length)) return null
  const result: Resolution[] = []
  for (const store of preflight.stores) for (const item of store.items) {
    const mode = item.duplicate ? choices[choiceKey(store.accountId, item.sourceId)] : 'create'
    if (!mode || !item.allowedModes.includes(mode)) return null
    result.push({ accountId: store.accountId, sourceId: item.sourceId, mode })
  }
  return result
}

export const failedStores = (result: DistributionResult) => result.stores.filter((store) => ['failed', 'version_conflict', 'unsupported'].includes(store.status))

/** 配る表の「項目」に出す、ひな形の中身の短い言い方（本文・画像 など）。 */
export function contentSummary(type: TemplateType, definition: TemplateDefinition): string {
  if (type === 'template' && 'template' in definition) {
    return definition.media.some((item) => item.kind === 'image') ? '本文・画像' : definition.card?.buttons.length ? '本文・ボタン' : '本文'
  }
  if (type === 'tag' && 'tag' in definition) return definition.folders.length ? `タグ・グループ ${definition.folders.length}` : 'タグ'
  if (type === 'rich_menu' && 'richMenu' in definition) return `メニュー ${definition.richMenu.pages.length}ページ`
  if (type === 'form' && 'form' in definition) return `質問 ${definition.form.fields.length}`
  if (type === 'scenario' && 'steps' in definition) return `ステップ ${definition.steps.length}`
  return '—'
}

export type TemplateMedia = MessageTemplateDefinition['media'][number]

/** R568: 手元の画像の縦横を、送る前に読む。読めないときは null（サーバ側で止める）。 */
export async function decodeImageSize(file: File): Promise<{ width: number; height: number } | null> {
  try {
    const factory = (globalThis as { createImageBitmap?: unknown }).createImageBitmap as
      | ((file: File) => Promise<{ width: unknown; height: unknown; close?: () => void }>)
      | undefined
    if (typeof factory !== 'function') return null
    const bitmap = await factory(file)
    const size = typeof bitmap?.width === 'number' && typeof bitmap?.height === 'number' ? { width: bitmap.width, height: bitmap.height } : null
    try { bitmap?.close?.() } catch { /* 後片付けの失敗は無視する */ }
    return size
  } catch { return null }
}
