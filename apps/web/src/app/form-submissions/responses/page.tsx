'use client'
import { usePageTitle } from '@/components/shell/page-chrome'
import FormResponsesV8 from '@/v8/form-responses/responses'



/*
 * ★V8（板 ・）：現役の回答画面に固定する。
 */
export default function FormResponsesPage() {
  usePageTitle('集まった回答')

  return <FormResponsesV8 />
}
