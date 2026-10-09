'use client'

import { Suspense } from 'react'
import ListState from '@/components/shared/list-state'
import TemplateEditV8 from '@/v8/template-edit/edit'

/** 次のリリースはV8。URLと機能ゲートを保って既存のV8画面へ渡す。 */
function Page() {
  return <Suspense fallback={<ListState kind="loading" />}><TemplateEditV8 /></Suspense>
}

import * as core from './edit-core'
import { isTemplateDetailData } from '../template-detail-data'
import { TemplateInsertControls, buildTemplatePreview, extractMessageUrls, previewDateValue } from '@/components/templates/message-template-editor'

export default Object.assign(Page, { __testing: { ...core, TemplateEditInner: TemplateEditV8, isTemplateDetailData, TemplateInsertControls, buildTemplatePreview, extractMessageUrls, previewDateValue } })
