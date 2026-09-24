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

function FixedValue({ label, children }: { label: string; children: (value: string, onChange: (value: string) => void) => React.ReactNode }) {
  const [value, setValue] = useState('')
  return (
    <div>
      <p className="mb-2 text-xs font-bold text-ink-secondary">{label}</p>
      {children(value, setValue)}
    </div>
  )
}

function FixedValues({ label, initial, children }: { label: string; initial: string[]; children: (values: string[], onChange: (values: string[]) => void) => React.ReactNode }) {
  const [values, setValues] = useState(initial)
  return (
    <div>
      <p className="mb-2 text-xs font-bold text-ink-secondary">{label}</p>
      {children(values, setValues)}
    </div>
  )
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
          <FixedValue label="閉じている">
            {(value, onChange) => (
              <div style={{ width: 320 }}>
                <Combobox aria-label="テンプレート" options={TEMPLATE_OPTIONS} value={value} onChange={onChange} placeholder="テンプレートを選ぶ" />
              </div>
            )}
          </FixedValue>
          <FixedValue label="入力中：一致した所を太字、↑↓で選ぶ行は灰色の地">
            {(value, onChange) => (
              <div style={{ width: 320 }}>
                <Combobox aria-label="テンプレート" options={TEMPLATE_OPTIONS} value={value} onChange={onChange} initialText="予約" defaultOpen />
              </div>
            )}
          </FixedValue>
          <FixedValue label="候補なし：何を探したかを書き、次の一手（作る）を出す">
            {(value, onChange) => (
              <div style={{ width: 320 }}>
                <Combobox aria-label="テンプレート" options={TEMPLATE_OPTIONS} value={value} onChange={onChange} initialText="ギフト" defaultOpen onCreate={() => undefined} createLabel={(query) => `新しいタグ「${query}」を作る`} />
              </div>
            )}
          </FixedValue>
          <FixedValue label="読み込み中：候補の場所を空けたまま文字で伝える">
            {(value, onChange) => (
              <div style={{ width: 320 }}>
                <Combobox aria-label="テンプレート" options={TEMPLATE_OPTIONS} value={value} onChange={onChange} initialText="予" defaultOpen loading />
              </div>
            )}
          </FixedValue>
          <FixedValue label="誤り：欄の下に、何をすれば通るかを書く">
            {(value, onChange) => (
              <div style={{ width: 320 }}>
                <Combobox aria-label="テンプレート" options={TEMPLATE_OPTIONS} value={value} onChange={onChange} placeholder="テンプレートを選ぶ" error="テンプレートを1つ選んでください" />
              </div>
            )}
          </FixedValue>
        </section>
        <section className="space-y-6">
          <h2 className="text-base font-bold">2. 複数選択（タグ・宛先）</h2>
          <FixedValues label="選んだ後：札で並べ、入り切らない分は「+3」。押すと全部を出す" initial={['nen', 'regular', 'proposal', 'cancel', 'gift']}>
            {(values, onChange) => (
              <div style={{ width: 380 }}>
                <MultiSelect aria-label="タグ" options={TAG_OPTIONS} values={values} onChange={onChange} maxChips={2} />
              </div>
            )}
          </FixedValues>
          <FixedValues label="開いている：選んでも閉じない。行の頭は共通チェックボックス" initial={['nen', 'regular']}>
            {(values, onChange) => (
              <div style={{ width: 380 }}>
                <MultiSelect aria-label="タグ" options={TAG_OPTIONS} values={values} onChange={onChange} initialQuery="定" defaultOpen />
              </div>
            )}
          </FixedValues>
          <FixedValues label="誤り：欄の下に、何をすれば通るかを書く" initial={[]}>
            {(values, onChange) => (
              <div style={{ width: 380 }}>
                <MultiSelect aria-label="タグ" options={TAG_OPTIONS} values={values} onChange={onChange} placeholder="タグを選ぶ" error="配信先のタグを1つ以上選んでください" />
              </div>
            )}
          </FixedValues>
        </section>
      </div>
    </>
  )
}
