'use client'

import HqTemplatesV8 from '@/v8/hq-templates/console'
import TemplateDefinitionEditor from '../templates/template-definition-editor'

/**
 * 統括の回答フォームのひな形。★V8 はひな形の画面（絵 LRc93・X4JcOf・meBRB と同じ作り）を回答フォームの種類で出す。
 */
export default function HqFormSubmissionsPage() {
  return <HqTemplatesV8 type="form" DefinitionEditor={TemplateDefinitionEditor} />
}
