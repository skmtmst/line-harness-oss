'use client'

import SelectField, { type SelectOption } from '@/components/shared/select-field'

/**
 * 一覧ツールバーの並び替え（監査 #668）。
 *
 * 「並び順」の字ラベルと、選択中の語が切れない幅をセットにする。
 * 画面ごとに素の SelectField を置くと、ラベルの有無や幅がばらける
 * ——共通情報は既定幅 176px のままで「使われている数が多い順」が
 * 「使われている数が多…」と切れていた。
 *
 * 幅は `w-auto` で最長の選択肢へ合わせ、`min-w-40` を下限にする。
 * これより短い選択肢しか無い画面で、帯の中だけ小さな箱が浮かない。
 */
export default function SortSelect({
  options,
  value,
  onChange,
  className,
}: {
  options: SelectOption[]
  value: string
  onChange: (value: string) => void
  className?: string
}) {
  return (
    <label className={['flex min-w-0 items-center gap-2', className].filter(Boolean).join(' ')}>
      <span className="text-ink-faint text-xs whitespace-nowrap">並び順</span>
      <SelectField
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-label="並び順"
        options={options}
        className="w-auto min-w-40 max-w-full"
      />
    </label>
  )
}
