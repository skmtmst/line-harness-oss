'use client'

import SearchField from './search-field'
import Select from './select'

/**
 * 一覧の上に置く、フォルダ・検索・並び順の帯。
 *
 * 一斉配信・テンプレート・シナリオ・リマインダは、設計上どれも
 * 「フォルダの行 ＋ 検索と並び順の行」という同じ形をしている。
 * 画面ごとに書くと、間隔や並びがそのつどずれる。
 *
 * フォルダと並び順は、仕組みがまだ無いので押せない状態で出す。
 * 何も出さないより「ここに何が来るか」が見えている方がよい。
 */
export default function ListToolbar({
  folders,
  searchPlaceholder,
  searchValue,
  onSearchChange,
  sortLabel,
}: {
  /**
   * フォルダの名前。先頭は「すべて」を想定し、それだけ押せる。
   *
   * 省略すると帯そのものを出さない。設計でフォルダを横の帯ではなく
   * 左の縦パネルに置いている画面（友だち属性のタグ）は、そちらが
   * 本物のフォルダなので、ここに空の帯が二重に並ばないようにする。
   */
  folders?: string[]
  searchPlaceholder: string
  searchValue: string
  onSearchChange: (value: string) => void
  /** 並び順の既定の表示。設計にある文言をそのまま出す。 */
  sortLabel: string
}) {
  return (
    <>
      {folders && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="text-ink-faint text-xs">フォルダ</span>
          {folders.map((label, i) => (
            <button
              key={label}
              disabled={i > 0}
              title={i > 0 ? 'フォルダ分けは準備中です' : undefined}
              className={`rounded-pill px-3 py-1 text-xs ${
                i === 0
                  ? 'bg-accent text-on-accent'
                  : 'border-hairline text-ink-faint border opacity-50'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      <div className="bg-canvas rounded-card border-hairline mb-3 flex flex-wrap items-center gap-2 border p-3">
        <SearchField
          placeholder={searchPlaceholder}
          aria-label={searchPlaceholder}
          value={searchValue}
          onChange={onSearchChange}
          onClear={() => onSearchChange('')}
          className="min-w-0 flex-1"
        />
        <span className="text-ink-faint text-xs whitespace-nowrap">並び順</span>
        <Select
          aria-label="並び順"
          value="default"
          options={[{ value: 'default', label: sortLabel }]}
          onChange={() => {}}
          disabled
        />
        <span className="text-ink-faint text-xs whitespace-nowrap">表示</span>
        <Select
          aria-label="表示件数"
          value="20"
          options={[{ value: '20', label: '20件表示' }]}
          onChange={() => {}}
          size="page-size"
          disabled
        />
        <button
          disabled
          title="保存した条件は準備中です"
          className="border-hairline text-ink-faint rounded-control border px-3 py-2 text-sm opacity-50"
        >
          保存した条件
        </button>
      </div>
    </>
  )
}
