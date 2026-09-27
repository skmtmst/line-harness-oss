'use client'

import Select from '@/components/shared/select'
import { TextInput } from '@/components/shared/form-controls'

export type DefaultValueMode = 'text' | 'single' | 'multi' | 'file'

/**
 * R139: 既定値の入力欄。種類に合う形で出す。
 *
 * 以前はどの種類も文字列の入力欄1つで、複数選択の既定値は保存時に
 * 「選択肢IDの配列で指定してください」で弾かれ、画面からは指定でき
 * なかった。登録済みの選択肢から選ぶ形にし、APIへは配列（複数選択）
 * ・選択肢名（単一選択）で渡す。存在しない値は選べない作りのため、
 * 保存前の突き合わせは呼び出し側の保存直前検査が担う。
 */
export default function DefaultValueInput({
  mode,
  options,
  textValue,
  onTextChange,
  singleValue,
  onSingleChange,
  multiValue,
  onMultiChange,
  disabled,
  inputId,
}: {
  mode: DefaultValueMode
  /** 登録済みの選択肢名（1行1つで入れたもの）。 */
  options: string[]
  textValue: string
  onTextChange: (value: string) => void
  singleValue: string
  onSingleChange: (value: string) => void
  multiValue: string[]
  onMultiChange: (value: string[]) => void
  disabled?: boolean
  inputId?: string
}) {
  if (mode === 'multi') {
    if (options.length === 0) {
      return (
        <p className="text-xs leading-5 text-ink-faint">
          先に選択肢を入力すると、ここから既定値を選べます。何も選ばなければ既定値なしになります。
        </p>
      )
    }
    return (
      <fieldset>
        <legend className="sr-only">既定値（複数選択可）</legend>
        <div className="space-y-1">
          {options.map((option) => {
            const checked = multiValue.includes(option)
            return (
              <label key={option} className="flex cursor-pointer items-center gap-2 py-1 text-sm text-ink">
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={disabled}
                  onChange={(event) => {
                    onMultiChange(
                      event.target.checked
                        ? [...multiValue, option]
                        : multiValue.filter((item) => item !== option),
                    )
                  }}
                  className="h-4 w-4 accent-accent"
                />
                <span className="min-w-0 flex-1 truncate" title={option}>{option}</span>
              </label>
            )
          })}
        </div>
        <p className="mt-2 text-xs leading-5 text-ink-faint">
          空欄のとき選んだ値が使われます。何も選ばなければ既定値なしになります。
        </p>
      </fieldset>
    )
  }
  if (mode === 'single') {
    return (
      <>
        <Select
          id={inputId}
          value={singleValue}
          onChange={onSingleChange}
          disabled={disabled}
          aria-label="既定値"
          size="full"
          options={[{ value: '', label: '未設定' }, ...options.map((option) => ({ value: option, label: option }))]}
        />
        <p className="mt-2 text-xs leading-5 text-ink-faint">
          空欄のとき選んだ値が使われます。選択肢を変えたら選び直してください。
        </p>
      </>
    )
  }
  if (mode === 'file') {
    return <TextInput id={inputId} value="" disabled placeholder="画像・PDFには設定できません" onChange={() => {}} />
  }
  return (
    <TextInput
      id={inputId}
      value={textValue}
      onChange={(event) => onTextChange(event.target.value)}
      disabled={disabled}
      placeholder="未設定"
    />
  )
}
