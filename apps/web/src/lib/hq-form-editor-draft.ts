import { normalizeLayout } from '@line-crm/shared'
import type { EditorDraftContent } from './hq-template-create-attempt'

/** 保存前の空欄も残す。壊れた一時記録は編集画面へ渡さない。 */
export function readFormEditorDraft(draft: EditorDraftContent | null) {
  if (!draft || draft.kind !== 'form' || typeof draft.name !== 'string'
    || typeof draft.description !== 'string' || typeof draft.onSubmitTagId !== 'string') return null
  const raw = draft.layout as Record<string, unknown> | null
  if (!raw || raw.version !== 2 || !Array.isArray(raw.header) || !Array.isArray(raw.sections) || !raw.sections.length || !raw.options || typeof raw.options !== 'object') return null
  try {
    const layout = normalizeLayout(draft.layout)
    if (!layout) return null
    return { name: draft.name, description: draft.description, onSubmitTagId: draft.onSubmitTagId, layout }
  } catch { return null }
}
