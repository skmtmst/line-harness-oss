'use client'
import { Suspense } from 'react'
import ListState from '@/components/shared/list-state'
import TemplateEditV8New from '@/v8/template-edit/edit'
import { isTemplateDetailData } from '../template-detail-data'
import { ACCOUNT_MISMATCH_MESSAGE, TEMPLATE_LOAD_FAILED_MESSAGE, TEMPLATE_LOADING_MESSAGE, loadTemplateReferences, requestTemplateReferences, resolveEditorAccountId, saveTemplateEdit, templateAccountMismatch, templateSaveGuard, templateUsageEntries, validateTemplateSave, TemplateAccountNotice, TemplateUsageNotice } from './edit-core'
import { TemplateInsertControls, buildTemplatePreview, extractMessageUrls, previewDateValue } from '@/components/templates/message-template-editor'



function TemplateEditInner() { return <TemplateEditV8New /> }


function TemplateEditPage() {
  return <Suspense fallback={<ListState kind="loading" title="テンプレートを準備しています" />}><TemplateEditInner /></Suspense>
}


/*
 * 試験から触れる口。**画面を組み立て直さずに、実際に動く部品を呼ぶ。**
 * ここに出すのは、画面本体がそのまま使っている関数と部品だけ。
 */
const TemplateEditPageWithTestSupport = Object.assign(TemplateEditPage, {
  __testing: {
    ACCOUNT_MISMATCH_MESSAGE,
    TEMPLATE_LOADING_MESSAGE,
    TEMPLATE_LOAD_FAILED_MESSAGE,
    TemplateAccountNotice,
    TemplateEditInner,
    TemplateInsertControls,
    TemplateUsageNotice,
    templateUsageEntries,
    buildTemplatePreview,
    extractMessageUrls,
    isTemplateDetailData,
    loadTemplateReferences,
    previewDateValue,
    requestTemplateReferences,
    resolveEditorAccountId,
    saveTemplateEdit,
    templateAccountMismatch,
    templateSaveGuard,
    validateTemplateSave,
  },
})


export default TemplateEditPageWithTestSupport
