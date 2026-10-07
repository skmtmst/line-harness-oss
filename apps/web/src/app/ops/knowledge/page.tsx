'use client'

import KnowledgeList from '@/components/ops/knowledge-list'
import { useAdminTheme } from '@/lib/use-admin-theme'
import OpsKnowledgeV8 from '@/v8/ops/knowledge'

export default function OpsKnowledgePage() {
  // ★V8 は src/v8/ops/knowledge.tsx（一覧 h114s・記事 R5ckwJ）。v7 は下のまま。
  return useAdminTheme() === 'v8' ? <OpsKnowledgeV8 /> : <KnowledgeList />
}
