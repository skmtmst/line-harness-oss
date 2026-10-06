'use client'

/*
 * ★V8 テンプレートの作る・編集の入口（/templates/edit）。
 * 受け付ける指定は今の画面と同じ：?id=（編集）・?visual=1（見本の中身）・
 * ?kind=coupon|research（資産の作る画面）。リッチメッセージ（?kind=rich_message）は
 * 入口（app/templates/edit/page.tsx）が今の V8 の画面へ渡す。
 */
import { useSearchParams } from 'next/navigation'
import TemplateMessageEditor from './message'
import TemplateAssetEditor from './asset'

export default function TemplateEditV8() {
  const params = useSearchParams()
  const id = params.get('id')
  const kind = params.get('kind')
  const visual = params.get('visual') === '1'
  if (kind === 'coupon' || kind === 'research') return <TemplateAssetEditor key={kind} kind={kind} visual={visual} />
  return <TemplateMessageEditor id={id} visual={visual} />
}
