'use client'

import { KnowledgeArticleV8 as KnowledgeArticle } from '@/v8/ops/public/knowledge-article/index'
import type { ComponentProps } from 'react'

export default function KnowledgeEditor(props: ComponentProps<typeof KnowledgeArticle>) {
  return <KnowledgeArticle {...props} fullPage={props.fullPage ?? false} />
}
