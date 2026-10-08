'use client'

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { TEMPLATE_TYPES, type TemplateType } from '@/lib/hq-templates-api'
import { useAdminTheme } from '@/lib/use-admin-theme'
import HqTemplatesV8 from '@/v8/hq-templates/console'
import HqTemplatePage from '../hq-template-page'
import TemplateDefinitionEditor from './template-definition-editor'

/** `/hq/templates?type=...` は旧URLとして残し、新しい正規画面へ同じ内容を出す。 */
function Content() {
  const theme = useAdminTheme()
  const requested = useSearchParams().get('type')
  const type = requested && TEMPLATE_TYPES.includes(requested as TemplateType)
    ? requested as TemplateType
    : 'template'
  /*
   * ★V8（LRc93・X4JcOf・meBRB）は src/v8 の新しい画面。タグ・リッチメニュー・回答フォーム・
   * シナリオのひな形の中身は、今の編集部品をそのまま渡す（src/v8 は @/app を読まないため）。
   */
  if (theme === 'v8') return <HqTemplatesV8 type={type} DefinitionEditor={TemplateDefinitionEditor} />
  const config = type === 'scenario' ? { label: 'シナリオ', target: 'scenarios' as const } : type === 'tag'
    ? { label: 'タグ', target: 'tags' as const }
    : type === 'rich_menu'
      ? { label: 'リッチメニュー', target: 'rich-menus' as const }
      : type === 'form'
        ? { label: '回答フォーム', target: 'form-submissions' as const }
        : { label: 'テンプレート', target: 'templates' as const }
  return <HqTemplatePage type={type} {...config} />
}

export default function HqTemplatesPage() {
  return <Suspense fallback={<p role="status">テンプレートを読み込み中…</p>}><Content /></Suspense>
}
