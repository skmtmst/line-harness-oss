import type { ReactNode } from 'react'
import PageHeader from '@/components/shared/page-header'
import './readonly-v8.css'

/** 分析の板の頭。画面名の重複は共通PageHeaderの判断に従う。 */
export default function ReadonlyHeaderV8({ title, description, actions, titleDisplay }: { title: string; description: string; actions?: ReactNode; titleDisplay?: 'auto' | 'always' }) {
  return <PageHeader titleDisplay={titleDisplay} breadcrumb={[]} title={title} description={description} actions={actions} className="v8-ro-analytics-header" />
}
