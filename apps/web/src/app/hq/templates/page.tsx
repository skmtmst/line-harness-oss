'use client'

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { TEMPLATE_TYPES, type TemplateType } from '@/lib/hq-templates-api'
import HqTemplatePage from '../hq-template-page'

/** `/hq/templates?type=...` は旧URLとして残し、新しい正規画面へ同じ内容を出す。 */
function Content() {
  const requested = useSearchParams().get('type')
  const type = requested && TEMPLATE_TYPES.includes(requested as TemplateType)
    ? requested as TemplateType
    : 'template'
  const config = type === 'tag'
    ? { label: '友だち属性', target: 'tags' as const }
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
