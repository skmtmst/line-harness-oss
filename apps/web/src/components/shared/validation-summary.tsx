'use client'

import SharedButton from '@/components/shared/button'
import { AlertCircle } from 'lucide-react'
import type { FormFieldProblem } from '@/lib/use-form-errors'
import Notice from './notice'

/**
 * 送信時に落ちた欄のまとめ（★管理画面 sTJsh §6）。
 *
 * 欄の下に出る文だけだと、長い画面ではどこを直せばいいか見失う。
 * 保存を押したときに限って上に「何か所・どの欄か」を出し、
 * 「1つ目へ」で最初の欄へフォーカスを移す。欄が直るとまとめからも消える。
 *
 * `useFormErrors` と組み合わせて使う:
 * `tsx
 * <ValidationSummary problems={fields.listProblems} onFocusFirst={fields.focusFirst} />
 * `
 */
export default function ValidationSummary({
  problems,
  onFocusFirst,
  minProblems = 1,
}: {
  problems: FormFieldProblem[]
  onFocusFirst?: () => void
  /**
   * この数から出す。欄で知らせる画面は 2 を渡し、直す欄が1つのときは
   * 欄の赤と理由だけにする（帯と欄で同じことを二度言わない）。
   */
  minProblems?: number
}) {
  if (problems.length === 0 || problems.length < minProblems) return null
  return (
    <div
      role="alert"
      data-design-part="validation-summary"
    >
      <Notice tone="danger" role="presentation" icon={<AlertCircle aria-hidden="true" />} heading={<>
          {problems.length}か所直してください：
          {problems.map((problem, index) => (
            <span key={problem.key}>
              {index > 0 ? '・' : ''}
              {problem.label}
            </span>
          ))}
        </>} action={onFocusFirst ? (
          <SharedButton variant="text" size="inline" data-notice-inline-action textTone="danger"
            type="button"
            onClick={onFocusFirst}
          >
            1つ目へ→
          </SharedButton>
        ) : null} />
    </div>
  )
}
