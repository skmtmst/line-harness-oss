'use client'

import { CircleAlert, CircleCheck } from 'lucide-react'
import { RICH_MENU_DIMENSIONS } from '@line-crm/shared'
import type { Area } from './area-types'
import { areaDisplayName } from './canvas-editor'
import { isAreaActionConfigured } from './action-drafts'
import { intentLabelOf } from './area-properties'
import type { RichMenuCreateHost } from '@/lib/rich-menu-create-host'
import Card from '@/components/shared/card'
import Button from '@/components/shared/button'
import MediaSlot from '@/components/shared/media-slot'
import Notice from '@/components/shared/notice'
import SectionHeader from '@/components/shared/section-header'
import { CreateSummaryCard } from '@/components/templates/create-parts'

/** 配る前に、入力した面・画像と下書きで届く扱いを確認する。 */
export default function HqMenuReview({ pages, size, host, onEditPage }: {
  pages: { id: string; name: string; imageR2Key: string | null; areas: Area[] }[]
  size: 'large' | 'compact'
  host: RichMenuCreateHost
  onEditPage: (id: string, step: 'shape' | 'buttons') => void
}) {
  const missing = pages.flatMap(page => [
    ...(!page.imageR2Key ? [{ page, key: `${page.id}-image`, step: 'shape' as const, text: `${page.name}の画像が未設定` }] : []),
    ...page.areas.flatMap((area, index) => isAreaActionConfigured(area) ? [] : [{ page, key: area.id, step: 'buttons' as const, text: `${page.name}・面 ${String.fromCharCode(65 + index)} の動きが未設定` }]),
  ])
  const dims = RICH_MENU_DIMENSIONS[size]
  return <>
    {pages.map(page => <CreateSummaryCard key={page.id} title={pages.length > 1 ? `確かめる：${page.name}` : '確かめる'}
      description={`${size === 'large' ? '大きい' : '小さい'}・${page.areas.length}面`}
      beforeRows={page.imageR2Key ? <MediaSlot readOnly size="compact" title={`${page.name}の画像`} previewAlt={`${page.name}の画像`} value={host.imageUrl(page.imageR2Key)} aspectRatio={`${dims.width} / ${dims.height}`} /> : undefined}
      rows={page.areas.map((area, index) => ({ key: area.id, label: `面 ${String.fromCharCode(65 + index)}「${areaDisplayName(area, index)}」`, value: isAreaActionConfigured(area) ? intentLabelOf(area) : '未設定' }))} />)}
    <Card variant="form" gap="normal" aria-label="足りないもの">
      <SectionHeader title="足りないもの" />
      {missing.length ? missing.map(item => <Notice key={item.key} tone="warn" appearance="soft" icon={<CircleAlert aria-hidden="true" />} message={item.text}
        action={host.canOperate ? <Button variant="text" size="inline" onClick={() => onEditPage(item.page.id, item.step)}>{item.step === 'shape' ? '形と画像で決める' : 'ボタンの動きで決める'}</Button> : undefined} />)
        : <Notice tone="success" appearance="soft" icon={<CircleCheck aria-hidden="true" />} message="すべての面と画像が設定されています" />}
    </Card>
    {host.distribute}
    <Card variant="form" gap="normal" aria-label="配ったときの扱い">
      <SectionHeader title="配ったときの扱い" />
      <Notice tone="info" appearance="soft" message="選んだアカウントへ下書きとして届きます。既定のメニューにするか・LINEに出すかは、各アカウントで決めます。" />
    </Card>
  </>
}
