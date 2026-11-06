'use client'

import { Suspense } from 'react'
import ListState from '@/components/shared/list-state'
import McpLogV8 from '@/v8/mcp-connect/log'

// G9 AI の操作の記録（板 hqhj5）。?connection= で 1 つの接続に絞る。
export default function McpLogPage() {
  return (
    <Suspense fallback={<ListState kind="loading" />}>
      <McpLogV8 />
    </Suspense>
  )
}
