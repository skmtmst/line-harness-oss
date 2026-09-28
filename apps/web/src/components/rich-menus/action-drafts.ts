import type { Area } from './canvas-editor'
import type { RichMenuTemplate } from '@/lib/rich-menu-templates'
import { templateToAreas } from '@/lib/rich-menu-templates'
import { richMenuUriError } from '@line-crm/shared'

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
      /*
       * R203: 「URLを開く」は飛び先が実際に URI として読めるときだけ
       * 「設定済み」。`not-a-url` のような文字列は未設定として残す。
       * （下書きへの保存は許すが、完成・公開には進めない）
       */
      return Boolean(area.trackedLinkId) || richMenuUriError(String(data.uri ?? '')) === null
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

/**
 * m18r: アカウントを切り替えたらテンプレートの候補が変わる。前の
 * アカウントにしかないテンプレートの選択は外す（タグの prune と同じ形）。
 * 純粋関数。外した件数を返すので、呼び出し側で知らせの文に使える。
 */
export function pruneStaleAreaTemplates(
  drafts: Record<string, Area[]>,
  validIds: ReadonlySet<string>,
): { next: Record<string, Area[]>; removed: number } {
  let removed = 0
  const next: Record<string, Area[]> = {}
  for (const [key, areas] of Object.entries(drafts)) {
    next[key] = areas.map((area) => {
      if (!area.templateId || validIds.has(area.templateId)) return area
      removed += 1
      return { ...area, templateId: null }
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
