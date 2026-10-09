'use client'

import HqTemplatesV8 from '@/v8/hq-templates/console'
import TemplateDefinitionEditor from '../templates/template-definition-editor'

/**
 * 統括のタグのひな形。★V8 はひな形の画面（絵 LRc93・X4JcOf・meBRB と同じ作り）をタグの種類で出す。
 */
export default function HqFriendAttributesPage() {
  return <HqTemplatesV8 type="tag" DefinitionEditor={TemplateDefinitionEditor} />
}
