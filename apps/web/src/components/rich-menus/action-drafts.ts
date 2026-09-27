import type { Area } from './canvas-editor'
import type { RichMenuTemplate } from '@/lib/rich-menu-templates'
import { templateToAreas } from '@/lib/rich-menu-templates'

export function createAreaDrafts(template: RichMenuTemplate): Area[] {
  return templateToAreas(template).map((area, index) => ({
    ...area,
    id: `${template.key}-${index}`,
    label: `面 ${String.fromCharCode(65 + index)}`,
    tagIds: [],
    scoreChange: null,
    templateId: null,
    formId: null,
    trackedLinkId: null,
  }))
}

export function saveAreaDraft(areas: Area[], index: number, draft: Area): Area[] {
  return areas.map((area, areaIndex) =>
    areaIndex === index
      ? { ...draft, actionData: { ...draft.actionData }, tagIds: [...(draft.tagIds ?? [])] }
      : area,
  )
}

export function isAreaActionConfigured(area: Area): boolean {
  const data = area.actionData ?? {}
  switch (area.intent) {
    case 'url':
      return Boolean(area.trackedLinkId || String(data.uri ?? '').trim())
    case 'tel':
      return Boolean(String(data.tel ?? '').trim())
    case 'text':
      return Boolean(String(data.text ?? '').trim())
    case 'template':
      return Boolean(area.templateId)
    case 'form':
      return Boolean(area.formId)
    case 'switch':
      return Boolean(String(data.targetPageId ?? '').trim())
    case 'postback':
      return Boolean(String(data.data ?? '').trim())
    default:
      return false
  }
}

export function unsetAreaLabels(areas: Area[]): string[] {
  return areas
    .map((area, index) => ({ area, label: String.fromCharCode(65 + index) }))
    .filter(({ area }) => !isAreaActionConfigured(area))
    .map(({ label }) => label)
}

/**
 * R23: アカウントを切り替えたらタグの候補が変わる。前のアカウントにしか
 * ないタグの選択は新しいアカウントに存在しないため、面の下書きから外す。
 * 純粋関数。外した件数を返すので、呼び出し側で知らせの文に使える。
 */
export function pruneStaleAreaTags(
  drafts: Record<string, Area[]>,
  validIds: ReadonlySet<string>,
): { next: Record<string, Area[]>; removed: number } {
  let removed = 0
  const next: Record<string, Area[]> = {}
  for (const [key, areas] of Object.entries(drafts)) {
    next[key] = areas.map((area) => {
      const before = area.tagIds ?? []
      const kept = before.filter((id) => validIds.has(id))
      removed += before.length - kept.length
      return kept.length === before.length ? area : { ...area, tagIds: kept }
    })
  }
  return { next, removed }
}

export function areaDraftsForCreate(areas: Area[]) {
  return areas.map((area) => ({
    boundsX: area.boundsX,
    boundsY: area.boundsY,
    boundsWidth: area.boundsWidth,
    boundsHeight: area.boundsHeight,
    actionType: area.actionType,
    actionData: { ...area.actionData },
    intent: area.intent,
    label: area.label,
    tagIds: [...(area.tagIds ?? [])],
    scoreChange: area.scoreChange,
    templateId: area.templateId,
    formId: area.formId,
    trackedLinkId: area.trackedLinkId,
  }))
}
