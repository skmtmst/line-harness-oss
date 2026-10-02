import type { ReactNode } from 'react'
import PageHeader from '@/components/shared/page-header'
import './readonly-v8.css'

/** 分析の板の頭。画面名の重複は共通PageHeaderの判断に従う。 */
export default function ReadonlyHeaderV8({ title, description, actions }: { title: string; description: string; actions?: ReactNode }) {
  return <PageHeader breadcrumb={[]} title={title} description={description} actions={actions} className="v8-ro-analytics-header" />
}
