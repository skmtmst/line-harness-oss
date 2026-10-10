import type { ReactNode } from 'react'
import { PageHeading } from '@/components/templates/page-frame'
import Breadcrumb, { type Crumb } from './breadcrumb'

/** 既存の呼び出し用の口。頭は PageHeading、説明は「？」。操作にマニュアルは置かない。 */
export default function PageHeader({ breadcrumb, title, help, actions, className, size = 'regular' }: {
  breadcrumb: Crumb[]; title: string; help?: ReactNode; actions?: ReactNode; className?: string
  titleDisplay?: 'auto' | 'always'; size?: 'regular' | 'compact'
}) {
  return <div className={className}><PageHeading title={title} help={help} actions={actions} crumbs={<Breadcrumb items={breadcrumb} />} headingSize={size} /></div>
}
