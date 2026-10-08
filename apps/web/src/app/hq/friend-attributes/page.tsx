'use client'

import { useAdminTheme } from '@/lib/use-admin-theme'
import HqTemplatesV8 from '@/v8/hq-templates/console'
import HqTemplatePage from '../hq-template-page'
import TemplateDefinitionEditor from '../templates/template-definition-editor'

/**
 * 統括のタグのひな形。★V8 はひな形の画面（絵 LRc93・X4JcOf・meBRB と同じ作り）をタグの種類で出す。
 * v7 は今までどおりの画面。
 */
export default function HqFriendAttributesPage() {
  const theme = useAdminTheme()
  if (theme === 'v8') return <HqTemplatesV8 type="tag" DefinitionEditor={TemplateDefinitionEditor} />
  return <HqTemplatePage type="tag" label="タグ" target="tags" />
}
