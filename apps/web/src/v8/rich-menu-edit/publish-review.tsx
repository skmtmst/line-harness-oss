'use client'

import { RICH_MENU_DIMENSIONS } from '@line-crm/shared'
import { isAreaActionConfigured } from '@/components/rich-menus/action-drafts'
import { areaDisplayName } from '@/components/rich-menus/canvas-editor'
import { type Area } from '../../components/rich-menus/area-types'
import { intentLabelOf } from '@/components/rich-menus/area-properties'
import Button from '@/components/shared/button'
import Card from '@/components/shared/card'
import MediaSlot from '@/components/shared/media-slot'
import TapAreaEditor from '@/components/shared/tap-area-editor'
import { CreateSummaryCard } from '@/components/templates/create-parts'

type ReviewPage = { id: string; name: string; imageR2Key: string | null; areas: Area[] }

/** 公開前の一覧から、入力した画像と面の動きへ戻れるようにする。 */
export default function PublishReview({ pages, size, imageUrl, onEdit }: {
  pages: ReviewPage[]
  size: 'large' | 'compact'
  imageUrl: (key: string) => string
  onEdit: (pageId: string, step: 'shape' | 'buttons', areaId?: string) => void
}) {
  const dims = RICH_MENU_DIMENSIONS[size]
  return <>
    {pages.map(page => <Card key={page.id} variant="form" gap="normal">
      <TapAreaEditor
        framed={false}
        title={pages.length > 1 ? `確かめる：${page.name}` : '確かめる'}
        description={`${size === 'large' ? '大きい' : '小さい'}・${page.areas.length}面${pages.length === 1 ? '・切替タブなし' : ''}`}
        listLabel={`${page.name}の面ごとの動き`}
        canvas={<MediaSlot readOnly size="compact" title={`${page.name}の画像`} previewAlt={`${page.name}の画像`} fit="contain" value={page.imageR2Key ? imageUrl(page.imageR2Key) : null} aspectRatio={`${dims.width} / ${dims.height}`} />}
        selectedId={null}
        onSelect={id => onEdit(page.id, 'buttons', id)}
        items={page.areas.map((area, index) => ({
          id: area.id, name: areaDisplayName(area, index),
          summary: isAreaActionConfigured(area) ? intentLabelOf(area) : null,
          x: area.boundsX / dims.width * 100, y: area.boundsY / dims.height * 100,
          width: area.boundsWidth / dims.width * 100, height: area.boundsHeight / dims.height * 100,
        }))}
      />
    </Card>)}
    <CreateSummaryCard title="足りないもの" rows={pages.flatMap(page => {
      const prefix = pages.length > 1 ? `${page.name}：` : ''
      const unset = page.areas.filter(area => !isAreaActionConfigured(area))
      return [
        {
          key: `${page.id}-image`,
          label: `${prefix}${page.imageR2Key ? '画像・大きさ・面の数' : '画像が未設定'}`,
          value: page.imageR2Key ? `${dims.width} × ${dims.height}・${page.areas.length}面` : <Button variant="text" size="inline" onClick={() => onEdit(page.id, 'shape')}>①で決める</Button>,
        },
        ...(unset.length || !page.areas.length ? [{
          key: `${page.id}-areas`,
          label: `${prefix}${page.areas.length ? `面 ${unset.map(area => String.fromCharCode(65 + page.areas.indexOf(area))).join('・')} の動きが未設定` : '面が未設定'}`,
          value: <Button variant="text" size="inline" onClick={() => onEdit(page.id, 'buttons', unset[0]?.id)}>②で決める</Button>,
        }] : []),
      ]
    })} />
  </>
}
