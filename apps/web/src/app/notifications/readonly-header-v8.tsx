
import type { ReactNode } from 'react'
import PageHeader from '@/components/shared/page-header'

import './readonly-v8.css'



/** 通知の組の閲覧画面内で使う見出し。共通の枠やメニューは触らない。 */
export default function ReadonlyHeaderV8({ title, description, actions }: { title: string; description: string; actions?: ReactNode }) {
  return <PageHeader breadcrumb={[]} title={title} help={description} actions={actions} className="v8-ro-notifications-header" />
}


/** 閲覧画面の板の印を外側に付ける。 */
export function ReadonlyDesignNode({ node, children }: { node: string; children: ReactNode }) {

  return <div className="contents" data-design-node={node}>{children}</div>
}
