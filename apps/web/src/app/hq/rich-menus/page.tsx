'use client'

import HqTemplatesV8 from '@/v8/hq-templates/console'
import TemplateDefinitionEditor from '../templates/template-definition-editor'
import RichMenuCreateV8 from '../../rich-menus/new/create-v8'

/**
 * 統括のリッチメニューのひな形。★V8 はひな形の画面（店と同じ一覧 noVq4）をリッチメニューの種類で出し、
 * 作る・直すは店のリッチメニューの作る画面（①〜④・gobhu〜gQabc）を host 付きで使う。
 */
export default function HqRichMenusPage() {
  return <HqTemplatesV8 type="rich_menu" DefinitionEditor={TemplateDefinitionEditor} RichMenuCreate={RichMenuCreateV8} />
}
