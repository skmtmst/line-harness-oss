'use client'
import EarningRuleCreateV8 from '@/v8/mileage/earning-rule-new/create'
import EditorSourceGuard from '@/v8/mileage/editor-source-guard'



export default function NewMileageRulePage() {
  // ★V8 は src/v8 に一から書いた画面（・）。

  return <EditorSourceGuard><EarningRuleCreateV8 /></EditorSourceGuard>
}
