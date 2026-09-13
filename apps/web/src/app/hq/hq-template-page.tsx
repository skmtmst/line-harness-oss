'use client'

import { Suspense } from 'react'
import Link from 'next/link'
import { usePageTitle } from '@/components/shell/page-chrome'
import { HQ_TEMPLATE_DISTRIBUTION_ENABLED } from '@/lib/hq-template-availability'
import { hqOpenHref, type HqOpenTargetKey } from '@/lib/hq-navigation'
import type { TemplateType } from '@/lib/hq-templates-api'
import TemplateConsole from './templates/template-console'

function Unavailable({ label, target }: { label: string; target: HqOpenTargetKey }) {
  usePageTitle(label)
  return <section aria-label={`統括の${label}`}><p>統括からの作成・配布は現在利用できません。</p><Link href={hqOpenHref(target)}>店舗を選んで{label}を開く</Link></section>
}

export default function HqTemplatePage({ type, label, target }: { type: TemplateType; label: string; target: HqOpenTargetKey }) {
  return <Suspense fallback={<p role="status">{label}を読み込み中…</p>}>
    {HQ_TEMPLATE_DISTRIBUTION_ENABLED ? <TemplateConsole type={type} /> : <Unavailable label={label} target={target} />}
  </Suspense>
}
