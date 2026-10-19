import type { TemplateType } from '@/lib/hq-templates-api'
import { HqTemplatesV8 } from '@/v8/hq-templates/public/console/index'
import TemplateDefinitionEditor from '@/app/hq/templates/template-definition-editor'

export { resolvedItems } from '@/v8/hq-templates/definition'

/** 実際の入口と同じ編集部品を渡す。画面やAPIの動きは置き換えない。 */
export default function HqTemplateConsoleForTest({ type }: { type: TemplateType }) {
  return <HqTemplatesV8 type={type} DefinitionEditor={TemplateDefinitionEditor} />
}
