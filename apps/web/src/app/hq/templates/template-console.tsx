'use client'

import type { TemplateType } from '@/lib/hq-templates-api'
import HqTemplatesV8 from '@/v8/hq-templates/console'
import TemplateDefinitionEditor from './template-definition-editor'

export { resolvedItems } from '@/v8/hq-templates/definition'

/** 既存の読み込み先もV8へ統一する。 */
export default function TemplateConsole({ type }: { type: TemplateType }) {
  return <HqTemplatesV8 type={type} DefinitionEditor={TemplateDefinitionEditor} />
}
