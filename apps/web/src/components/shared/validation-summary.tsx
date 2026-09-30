'use client'

import { AlertCircle } from 'lucide-react'
import type { FormFieldProblem } from '@/lib/use-form-errors'

/**
 * 送信時に落ちた欄のまとめ（★V7 sTJsh §6）。
 *
 * 欄の下に出る文だけだと、長い画面ではどこを直せばいいか見失う。
 * 保存を押したときに限って上に「何か所・どの欄か」を出し、
 * 「1つ目へ」で最初の欄へフォーカスを移す。欄が直るとまとめからも消える。
 *
 * `useFormErrors` と組み合わせて使う:
 * ```tsx
 * <ValidationSummary problems={fields.listProblems()} onFocusFirst={fields.focusFirst} />
 * ```
 */
export default function ValidationSummary({
  problems,
  onFocusFirst,
}: {
  problems: FormFieldProblem[]
  onFocusFirst?: () => void
}) {
  if (problems.length === 0) return null
  return (
    <div
      role="alert"
      data-design-part="validation-summary"
      className="border-danger bg-danger-bg text-danger rounded-control border px-4 py-3"
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium">
          <AlertCircle size={15} aria-hidden className="mr-1.5 -mt-0.5 inline-block" />
          {problems.length}か所直してください：
          {problems.map((problem, index) => (
            <span key={problem.key}>
              {index > 0 ? '・' : ''}
              {problem.label}
            </span>
          ))}
        </p>
        {onFocusFirst ? (
          <button
            type="button"
            onClick={onFocusFirst}
            className="text-danger shrink-0 text-sm font-semibold underline underline-offset-2 hover:opacity-80"
          >
            1つ目へ→
          </button>
        ) : null}
      </div>
    </div>
  )
}
