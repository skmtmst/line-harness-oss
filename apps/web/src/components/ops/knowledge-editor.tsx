'use client'

import KnowledgeArticle from '@/v8/ops/knowledge-article'
import type { ComponentProps } from 'react'

export default function KnowledgeEditor(props: ComponentProps<typeof KnowledgeArticle>) {
  return <KnowledgeArticle {...props} fullPage={props.fullPage ?? false} />
}
