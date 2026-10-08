'use client'

import { useAdminTheme } from '@/lib/use-admin-theme'
import HqTemplatesV8 from '@/v8/hq-templates/console'
import HqTemplatePage from '../hq-template-page'
import TemplateDefinitionEditor from '../templates/template-definition-editor'
import RichMenuCreateV8 from '../../rich-menus/new/create-v8'

/**
 * 統括のリッチメニューのひな形。★V8 はひな形の画面（店と同じ一覧 noVq4）をリッチメニューの種類で出し、
 * 作る・直すは店のリッチメニューの作る画面（①〜④・gobhu〜gQabc）を host 付きで使う。
 * v7 は今までどおりの画面。
 */
export default function HqRichMenusPage() {
  const theme = useAdminTheme()
  if (theme === 'v8') return <HqTemplatesV8 type="rich_menu" DefinitionEditor={TemplateDefinitionEditor} RichMenuCreate={RichMenuCreateV8} />
  return <HqTemplatePage type="rich_menu" label="リッチメニュー" target="rich-menus" />
}
