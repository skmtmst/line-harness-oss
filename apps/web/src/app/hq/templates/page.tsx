'use client'

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { TEMPLATE_TYPES, type TemplateType } from '@/lib/hq-templates-api'
import { HQ_TEMPLATE_DISTRIBUTION_ENABLED } from '@/lib/hq-template-availability'
import { hqOpenHref } from '@/lib/hq-navigation'
import Link from 'next/link'
import { usePageTitle } from '@/components/shell/page-chrome'
import TemplateConsole from './template-console'

function Unavailable() {
  usePageTitle('店舗別のタグ管理')
  return <section aria-label="統括のひな形"><p>統括のひな形配布は現在利用できません。従来の店舗別管理をご利用ください。</p><Link href={hqOpenHref('tags')}>店舗を選んでタグ管理を開く</Link></section>
}

function Content() {
  const params = useSearchParams()
  if (!HQ_TEMPLATE_DISTRIBUTION_ENABLED) return <Unavailable />
  const requested = params.get('type') ?? 'tag'
  const type = TEMPLATE_TYPES.includes(requested as TemplateType) ? requested as TemplateType : null
  return type ? <TemplateConsole key={type} type={type} /> : <p role="alert">ひな形の種類を確認してください。</p>
}
export default function HqTemplatesPage() {
  return <Suspense fallback={<p role="status">ひな形を読み込み中…</p>}><Content /></Suspense>
}
