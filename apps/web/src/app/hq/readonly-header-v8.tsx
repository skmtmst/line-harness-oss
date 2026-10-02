'use client'

import type { ReactNode } from 'react'
import PageHeader from '@/components/shared/page-header'
import './readonly-v8.css'

export default function ReadonlyHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return <PageHeader breadcrumb={[]} title={title} description={description ?? ""} actions={actions} className="v8-ro-hq-header" />
}
