'use client'

import { useState } from 'react'
import SampleScreenNotice from '@/components/ui/sample-screen-notice'
import Combobox from '@/components/shared/combobox'
import type { ComboboxOption } from '@/components/shared/combobox'
import MultiSelect from '@/components/shared/multi-select'
import type { MultiSelectOption } from '@/components/shared/multi-select'

/*
 * ★V7 候補つき入力・複数選択（WUVcz）の見た目照合用。固定の見本データ。
 * 実際のデータの閲覧・編集はできない（SampleScreenNotice を頭に置く）。
 *
 * 設計の書き出しと同じ並び。1節は4列・2節は3列。
 * 候補の一覧は欄から下へ浮くので、各マスは一覧ぶんの高さを空けておく。
 * 1440px では設計の 320/380 が4列に入らないため、欄は列いっぱいに広げる。
 */

const TEMPLATE_OPTIONS: ComboboxOption[] = [
  { value: 'prev-day', label: '予約前日のご案内', hint: 'テキスト' },
  { value: 'prev-hour', label: '予約1時間前のご案内', hint: 'テキスト' },
  { value: 'change', label: '予約変更のお知らせ', hint: 'カード' },
]

const TAG_OPTIONS: MultiSelectOption[] = [
  { value: 'nen', label: 'NEN会員', dot: 'green' },
  { value: 'regular', label: '定期便', dot: 'blue' },
  { value: 'proposal', label: '定期便提案対象', dot: 'amber' },
  { value: 'cancel', label: '定期便解約', dot: 'gray' },
  { value: 'gift', label: 'ギフト' },
]

/** 1マス。説明文の上に浮く一覧ぶんの高さを空け、重ならないようにする。 */
function Cell({ caption, children }: { caption: string; children: React.ReactNode }) {
  return (
    <div className="min-h-72">
      {children}
      <div aria-hidden="true" className="h-56" />
      <p className="mt-2 text-xs text-ink-secondary">{caption}</p>
    </div>
  )
}

function Single({ children }: { children: (value: string, onChange: (value: string) => void) => React.ReactNode }) {
  const [value, setValue] = useState('')
  return <>{children(value, setValue)}</>
}

function Multiple({ initial, children }: { initial: string[]; children: (values: string[], onChange: (values: string[]) => void) => React.ReactNode }) {
  const [values, setValues] = useState(initial)
  return <>{children(values, setValues)}</>
}

export default function V7ComboboxVisualQaPage() {
  return (
    <>
      <SampleScreenNotice
        what="★V7 候補つき入力・複数選択の表示確認"
        backHref="/"
        backLabel="トップへ戻る"
      />
      <div className="space-y-10 p-6">
        <section className="space-y-6">
          <h2 className="text-base font-bold">1. 候補つき入力（1つ選ぶ）</h2>
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-4">
            <Cell caption="閉じている">
              <Single>
                {(value, onChange) => (
                  <Combobox aria-label="テンプレート" options={TEMPLATE_OPTIONS} value={value} onChange={onChange} placeholder="テンプレートを選ぶ" />
                )}
              </Single>
            </Cell>
            <Cell caption="入力中：一致した所を太字、↑↓で選ぶ行は灰色の地">
              <Single>
                {(value, onChange) => (
                  <Combobox aria-label="テンプレート" options={TEMPLATE_OPTIONS} value={value} onChange={onChange} initialText="予約" defaultOpen />
                )}
              </Single>
            </Cell>
            <Cell caption="候補なし：何を探したかを書き、次の一手（作る）を出す">
              <Single>
                {(value, onChange) => (
                  <Combobox aria-label="テンプレート" options={TEMPLATE_OPTIONS} value={value} onChange={onChange} initialText="ギフト" defaultOpen onCreate={() => undefined} createLabel={(query) => `新しいタグ「${query}」を作る`} />
                )}
              </Single>
            </Cell>
            <Cell caption="読み込み中：候補の場所を空けたまま文字で伝える">
              <Single>
                {(value, onChange) => (
                  <Combobox aria-label="テンプレート" options={TEMPLATE_OPTIONS} value={value} onChange={onChange} initialText="予" defaultOpen loading />
                )}
              </Single>
            </Cell>
          </div>
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-4">
            <Cell caption="誤り：欄の下に、何をすれば通るかを書く">
              <Single>
                {(value, onChange) => (
                  <Combobox aria-label="テンプレート" options={TEMPLATE_OPTIONS} value={value} onChange={onChange} placeholder="テンプレートを選ぶ" error="テンプレートを1つ選んでください" />
                )}
              </Single>
            </Cell>
          </div>
        </section>
        <section className="space-y-6">
          <h2 className="text-base font-bold">2. 複数選択（タグ・宛先）</h2>
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-3">
            <Cell caption="選んだ後：札で並べ、入り切らない分は「+3」。押すと全部を出す">
              <Multiple initial={['nen', 'regular', 'proposal', 'cancel', 'gift']}>
                {(values, onChange) => (
                  <MultiSelect aria-label="タグ" options={TAG_OPTIONS} values={values} onChange={onChange} maxChips={2} />
                )}
              </Multiple>
            </Cell>
            <Cell caption="開いている：選んでも閉じない。行の頭は共通チェックボックス">
              <Multiple initial={['nen', 'regular']}>
                {(values, onChange) => (
                  <MultiSelect aria-label="タグ" options={TAG_OPTIONS} values={values} onChange={onChange} initialQuery="定" defaultOpen />
                )}
              </Multiple>
            </Cell>
            <Cell caption="誤り：欄の下に、何をすれば通るかを書く">
              <Multiple initial={[]}>
                {(values, onChange) => (
                  <MultiSelect aria-label="タグ" options={TAG_OPTIONS} values={values} onChange={onChange} placeholder="タグを選ぶ" error="配信先のタグを1つ以上選んでください" />
                )}
              </Multiple>
            </Cell>
          </div>
        </section>
      </div>
    </>
  )
}
