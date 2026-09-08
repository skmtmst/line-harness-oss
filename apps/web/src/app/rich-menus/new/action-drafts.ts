import type { Area } from '@/components/rich-menus/canvas-editor'
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

export function areaDraftsForCreate(areas: Area[]) {
  return areas.map(({ id: _id, ...area }) => ({
    ...area,
    actionData: { ...area.actionData },
    tagIds: [...(area.tagIds ?? [])],
  }))
}
