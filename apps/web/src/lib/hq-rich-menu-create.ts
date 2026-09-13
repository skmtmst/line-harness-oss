import type { Area } from '@/components/rich-menus/canvas-editor'
import type { RichMenuCreateValue } from '@/components/rich-menus/rich-menu-create-form'
import type { RichMenuDefinition } from './hq-templates-api'
import { TEMPLATES } from './rich-menu-templates'

export class HqRichMenuCompatibilityError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'HqRichMenuCompatibilityError'
  }
}

const fail = (message: string): never => { throw new HqRichMenuCompatibilityError(message) }

function stringData(value: Record<string, string>): Record<string, unknown> {
  return { ...value }
}

function templateFor(definition: RichMenuDefinition) {
  const menu = definition.richMenu
  const firstPage = menu.pages[0]
  if (!firstPage) fail('リッチメニューにページがありません。')
  const matched = TEMPLATES.find((template) => {
    if (template.size !== menu.size || template.areas.length !== firstPage.areas.length) return false
    return template.areas.every((bounds, index) => {
      const area = firstPage.areas[index]
      return area.bounds.x === Math.round(bounds.x)
        && area.bounds.y === Math.round(bounds.y)
        && area.bounds.width === Math.round(bounds.w)
        && area.bounds.height === Math.round(bounds.h)
    })
  })
  return matched ?? fail('このリッチメニューは自由配置の領域を含むため、共通の新規作成画面では編集できません。店舗側の編集画面で確認してください。')
}

function definitionAreaToDraft(area: RichMenuDefinition['richMenu']['pages'][number]['areas'][number]): Area {
  if (area.scenarioId) fail('シナリオ参照を含むボタンは、共通の新規作成画面では変更できません。')
  if (area.intent === 'switch' || area.actionType === 'richmenuswitch') fail('メニュー切替を含むボタンは、作成後の編集画面で変更してください。')
  if (!area.intent || !['url', 'text', 'form', 'template'].includes(area.intent)) fail('対応していないボタン動作が含まれているため、内容を変更せず停止しました。')
  return {
    id: area.id,
    boundsX: area.bounds.x,
    boundsY: area.bounds.y,
    boundsWidth: area.bounds.width,
    boundsHeight: area.bounds.height,
    actionType: area.actionType,
    actionData: stringData(area.actionData),
    intent: area.intent,
    label: area.label ?? null,
    tagIds: [...(area.tagIds ?? [])],
    scoreChange: null,
    templateId: area.templateId ?? null,
    formId: area.formId ?? null,
    trackedLinkId: null,
  }
}

export function hqDefinitionToRichMenuCreateValue(definition: RichMenuDefinition): RichMenuCreateValue {
  if (definition.richMenu.pages.length > 4) fail('新規作成画面で扱えるのは4ページまでです。内容は変更していません。')
  const template = templateFor(definition)
  const firstPage = definition.richMenu.pages[0]
  return {
    name: definition.richMenu.name,
    chatBarText: definition.richMenu.chatBarText,
    size: definition.richMenu.size,
    tabCount: definition.richMenu.pages.length - 1,
    templateKey: template.key,
    folderId: '',
    areaDraftsByTemplate: { [template.key]: firstPage.areas.map(definitionAreaToDraft) },
  }
}

function draftAreaToDefinition(area: Area): RichMenuDefinition['richMenu']['pages'][number]['areas'][number] {
  if (area.trackedLinkId) fail('計測リンクは店舗ごとの参照です。配布先へ安全に置き換えられないため保存しません。')
  if (area.scoreChange != null && area.scoreChange !== 0) fail('スコア加算は統括の配布形式が未対応のため保存しません。')
  if (!area.intent || !['url', 'text', 'form', 'template'].includes(area.intent)) fail('このボタン動作は統括の配布形式が未対応のため保存しません。')
  const entries = Object.entries(area.actionData ?? {})
  if (entries.some(([, value]) => typeof value !== 'string')) fail('ボタン動作に保存できない値が含まれています。')
  return {
    id: area.id,
    bounds: { x: area.boundsX, y: area.boundsY, width: area.boundsWidth, height: area.boundsHeight },
    actionType: area.actionType,
    actionData: Object.fromEntries(entries) as Record<string, string>,
    intent: area.intent as 'url' | 'text' | 'form' | 'template',
    ...(area.label ? { label: area.label } : {}),
    ...(area.tagIds?.length ? { tagIds: [...area.tagIds] } : {}),
    ...(area.formId ? { formId: area.formId } : {}),
    ...(area.templateId ? { templateId: area.templateId } : {}),
  }
}

function uniqueId(prefix: string, used: Set<string>): string {
  let index = 1
  while (used.has(`${prefix}-${index}`)) index += 1
  const id = `${prefix}-${index}`
  used.add(id)
  return id
}

export function richMenuCreateValueToHqDefinition(value: RichMenuCreateValue, previous: RichMenuDefinition): RichMenuDefinition {
  if (value.folderId) fail('統括のフォルダは配布先の店舗フォルダと対応しないため保存しません。')
  const template = TEMPLATES.find((item) => item.key === value.templateKey && item.size === value.size)
    ?? fail('面の分けかたを選び直してください。')
  const drafts = value.areaDraftsByTemplate[template.key]
  const areas = (drafts ?? []).map(draftAreaToDefinition)
  const old = previous.richMenu
  if (value.size !== old.size && old.pages.some((page) => page.imageR2Key)) fail('登録済み画像があるためサイズを変更できません。画像を作り直す場合は別のひな形を作成してください。')
  const wanted = value.tabCount + 1
  if (wanted < old.pages.length) {
    const removed = old.pages.slice(wanted)
    if (removed.some((page) => page.imageR2Key || page.areas.length)) fail('内容のあるタブを削除するとデータが失われるため停止しました。')
  }
  const used = new Set<string>([old.id, ...old.pages.flatMap((page) => [page.id, ...page.areas.map((area) => area.id)])])
  const pages = old.pages.slice(0, wanted).map((page, index) => index === 0 ? { ...page, areas } : page)
  while (pages.length < wanted) {
    const pageId = uniqueId('page', used)
    pages.push({
      id: pageId,
      name: `タブ ${String.fromCharCode(65 + pages.length - 1)}`,
      imageR2Key: old.pages[0]?.imageR2Key ?? '',
      areas: areas.map((area) => ({ ...area, id: uniqueId('area', used), bounds: { ...area.bounds }, actionData: { ...area.actionData }, tagIds: area.tagIds ? [...area.tagIds] : undefined })),
    })
  }
  return {
    ...previous,
    richMenu: {
      ...old,
      name: value.name,
      chatBarText: value.chatBarText,
      size: value.size,
      pages,
      defaultPageId: pages.some((page) => page.id === old.defaultPageId) ? old.defaultPageId : pages[0].id,
    },
  }
}
