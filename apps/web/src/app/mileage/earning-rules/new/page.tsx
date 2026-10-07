'use client'

import { useAdminTheme } from '@/lib/use-admin-theme'
import EarningRuleCreateV8 from '@/v8/mileage/earning-rule-new/create'
import V8EarningRuleNew from './v8-earning-rule-new'

export default function NewMileageRulePage() {
  // ★V8 は src/v8 に一から書いた画面（ctLwT・BnrQp）。それ以外は今の画面のまま。
  const theme = useAdminTheme()
  return theme === 'v8' ? <EarningRuleCreateV8 /> : <V8EarningRuleNew />
}
