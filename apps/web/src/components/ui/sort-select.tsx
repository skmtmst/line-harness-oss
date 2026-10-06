'use client'

import Select, { type SelectOption } from '@/components/shared/select'
import { useAdminTheme } from '@/lib/use-admin-theme'

/**
 * 一覧ツールバーの並び替え（監査 #668）。
 *
 * 「並び順」の字ラベルと、選択中の語が切れない幅をセットにする。
 * 画面ごとに選び欄を素で置くと、ラベルの有無や幅がばらける
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
  label = '並び順',
  treatment = 'box',
}: {
  options: SelectOption[]
  value: string
  onChange: (value: string) => void
  className?: string
  /** 板 `apLqS` は「並び：」。他は今のまま。 */
  label?: string
  /** 'text' で枠なし文字＋上下矢印（x6QsVz の並び替え）。v8 だけ。 */
  treatment?: 'box' | 'text'
}) {
  const theme = useAdminTheme()
  // ★V8（c4n9Kr）：「並び：〇〇」を1つの箱の中に出す（箱の外に見出しを置かない）。v7 は今のまま。
  if (theme === 'v8') {
    const name = label.replace(/：$/, '') || '並び順'
    return (
      <Select
        value={value}
        onChange={onChange}
        aria-label={name}
        label={name}
        options={options}
        treatment={treatment}
        className="w-auto max-w-full"
      />
    )
  }
  return (
    <label className={['flex min-w-0 items-center gap-2', className].filter(Boolean).join(' ')}>
      <span className="text-ink-faint text-xs whitespace-nowrap">{label}</span>
      <Select
        value={value}
        onChange={onChange}
        aria-label={label.replace(/：$/, '') || '並び順'}
        options={options}
        className="w-auto min-w-40 max-w-full"
      />
    </label>
  )
}
