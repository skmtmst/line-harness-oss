'use client'

/**
 * オプション設定の各区画。編集画面のタブ（答え終わったあと・受付と見た目）に
 * そのまま並べるものと、設定の窓（OptionsDialog）で使うものは同じにする。
 *
 * 触る頻度が低いものは窓にまとめていたが、V8（XXFT4・tpRRT）ではタブに直接
 * 出す。区画の中身はどちらでも同じ。
 */

import type { FormAction, FormOptions } from '@line-crm/shared'
import ActionEditor from './action-editor'
import { describeAction } from './form-update-summary'
import type { FormRefs } from './form-refs'
import Checkbox from '@/components/shared/checkbox'
import DateTimeField from '@/components/shared/date-time-field'
import { TextInput } from '@/components/shared/form-controls'
import Toggle from '@/components/shared/toggle'

/**
 * 期限を初めてONにしたときの初期値。日本時間で「7日後の23:59」。
 * 決め打ちの日付を表示だけに置くと、入れた覚えのない日が
 * そのまま保存されてしまうため、ONにした時点で実値を入れる。
 */
export function defaultDeadlineEndsAt(): string {
  const jst = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000 + 9 * 60 * 60 * 1000)
  return `${jst.toISOString().slice(0, 10)}T23:59`
}

export function OptionCard({ checked, onChange, label, note }: { checked: boolean; onChange: (next: boolean) => void; label: string; note: string }) {
  return <Checkbox checked={checked} onCheckedChange={onChange} description={note} className="rounded-control border border-hairline p-3">{label}</Checkbox>
}

export function FieldLine({ label, children }: { label: string; children: React.ReactNode }) {
  return <label><span className="text-ink-secondary mb-1 block text-xs font-medium">{label}</span>{children}</label>
}

/** 答え終わったあとのお礼の文（XXFT4）。 */
export function ThanksSection({ value, onChange }: { value: FormOptions; onChange: (next: Partial<FormOptions>) => void }) {
  return (
    <section data-design-node="XXFT4-thanks" className="bg-canvas rounded-card border-hairline border p-4">
      <h2 className="text-ink text-sm font-bold">答え終わったときの画面</h2>
      <div className="mt-3">
        <FieldLine label="お礼の文">
          <TextInput
            value={value.thanksText ?? ''}
            onChange={(e) => onChange({ thanksText: e.target.value })}
            placeholder="ご回答ありがとうございました。"
          />
        </FieldLine>
      </div>
    </section>
  )
}

/** 答え終わったあとに行うこと（XXFT4）。上から順に行う。 */
export function AfterActionsSection({ value, refs, onChange }: { value: FormOptions; refs: FormRefs; onChange: (next: Partial<FormOptions>) => void }) {
  return (
    <section data-design-node="XXFT4-actions" className="bg-canvas rounded-card border-hairline border p-4">
      <h2 className="text-ink text-sm font-bold">答え終わったら行うこと</h2>
      <p className="text-ink-faint mt-1 text-xs">上から順に行います。カルーセル・質問・自動応答からも同じ画面が開きます</p>
      <ul className="mt-3 space-y-2">
        {(value.afterActions ?? []).map((action, index) => (
          <li key={index} className="border-hairline text-ink flex items-center gap-2 rounded-control border px-3 py-2 text-sm">
            <span className="text-ink-faint tabular-nums">{index + 1}</span>
            <span className="min-w-0 flex-1 truncate">{describeAction(action, refs)}</span>
          </li>
        ))}
      </ul>
      {(value.afterActions ?? []).length === 0 && (
        <p className="text-ink-secondary mt-2 text-sm">実行することはまだありません</p>
      )}
      <details className="group mt-3 min-w-0">
        <summary className="border-accent text-accent-deep rounded-control inline-block cursor-pointer list-none border px-3 py-2 text-xs font-medium">アクションを設定</summary>
        <div className="bg-canvas mt-3 min-w-0 p-3 shadow-float">
          <ActionEditor value={value.afterActions ?? []} onChange={(afterActions: FormAction[]) => onChange({ afterActions })} refs={refs} />
        </div>
      </details>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FieldLine label="答えたあとに開くページ（任意）">
          <TextInput
            type="url"
            value={value.thanksUrl ?? ''}
            onChange={(e) => onChange({ thanksUrl: e.target.value || null })}
            placeholder="https://..."
          />
        </FieldLine>
      </div>
    </section>
  )
}

/** 受付のきまり（tpRRT）。開始と上限の数は型にあるものだけ出す。 */
export function ReceptionSection({ value, onChange }: { value: FormOptions; onChange: (next: Partial<FormOptions>) => void }) {
  return (
    <>
      <section data-design-node="tpRRT-reception" className="bg-canvas rounded-card border-hairline border p-4">
        <h2 className="text-ink text-sm font-bold">受付のきまり</h2>
        <div className="mt-3 grid gap-2">
          <OptionCard
            checked={value.oncePerFriend?.enabled ?? false}
            onChange={(enabled) => onChange({ oncePerFriend: { ...value.oncePerFriend, enabled } })}
            label="1人1回だけ答えられるようにする"
            note="2回目に開いた人には「回答済みです」と出ます"
          />
          <div className="rounded-control border border-hairline p-3">
            <Toggle
              checked={value.totalLimit?.enabled ?? false}
              onChange={(enabled) => onChange({ totalLimit: { ...value.totalLimit, enabled, ...(enabled && !value.totalLimit?.max ? { max: 300 } : {}) } })}
              label="答えの数が上限になったら締め切る"
            />
            <span className="text-ink mt-1 flex flex-wrap items-center gap-2 text-sm">
              答えの数が
              <input
                type="number"
                min={1}
                value={value.totalLimit?.max ?? 300}
                disabled={!(value.totalLimit?.enabled ?? false)}
                onChange={(e) => onChange({ totalLimit: { ...value.totalLimit, enabled: true, max: Math.max(1, Number(e.target.value) || 0) } })}
                aria-label="締め切る件数"
                className="border-hairline bg-canvas text-ink rounded-control w-24 border px-2 py-1 text-sm"
              />
              件になったら締め切る
            </span>
          </div>
        </div>
      </section>

      <section data-design-node="tpRRT-reception-more" className="bg-canvas rounded-card border-hairline border p-4">
        <h2 className="text-ink text-sm font-bold">受付のきまり（つづき）</h2>
        <div className="mt-3 grid gap-2">
          <OptionCard
            checked={value.restorePrevious ?? false}
            onChange={(restorePrevious) => onChange({ restorePrevious })}
            label="前回の答えを最初から入れておく"
            note="同じ人が答え直すとき、前の内容が入った状態で開きます。別の端末では戻せません"
          />
          <OptionCard
            checked={value.confirmDialog?.enabled ?? false}
            onChange={(enabled) => onChange({ confirmDialog: { ...value.confirmDialog, enabled } })}
            label="送信する前に確認画面を出す"
            note="入力ミスを減らせます。ブロックが多いフォームで効きます"
          />
          <OptionCard
            checked={value.deadline?.enabled ?? false}
            onChange={(enabled) => onChange({ deadline: { ...value.deadline, enabled, ...(enabled && !value.deadline?.endsAt ? { endsAt: defaultDeadlineEndsAt() } : {}) } })}
            label="受付の期限を決める"
            note="期限を過ぎたら、開いても「受付は終了しました」と出ます"
          />
        </div>
        {value.deadline?.enabled && (
          <div className="bg-accent-soft mt-2 grid grid-cols-1 gap-3 rounded-control p-3 sm:grid-cols-2">
            <FieldLine label="受付の期限">
              <DateTimeField aria-label="受付の期限" value={value.deadline.endsAt ?? ''} onChange={(v) => onChange({ deadline: { ...value.deadline, enabled: true, endsAt: v } })} />
            </FieldLine>
            <FieldLine label="期限を過ぎた人に出す文">
              <TextInput
                type="text"
                value={value.deadline.message ?? ''}
                onChange={(e) => onChange({ deadline: { ...value.deadline, enabled: true, message: e.target.value } })}
              />
            </FieldLine>
          </div>
        )}
      </section>
    </>
  )
}

/** 見た目の言葉（tpRRT）。ページの題名とボタンの言葉。 */
export function WordsSection({ value, onChange }: { value: FormOptions; onChange: (next: Partial<FormOptions>) => void }) {
  return (
    <section data-design-node="tpRRT-words" className="bg-canvas rounded-card border-hairline border p-4">
      <h2 className="text-ink text-sm font-bold">見た目の言葉</h2>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <FieldLine label="ページの題名">
          <TextInput
            type="text"
            value={value.pageTitle ?? ''}
            onChange={(e) => onChange({ pageTitle: e.target.value || null })}
            placeholder="回答フォーム"
          />
        </FieldLine>
        <FieldLine label="送信ボタンの文字">
          <TextInput
            type="text"
            value={value.submitLabel ?? ''}
            onChange={(e) => onChange({ submitLabel: e.target.value })}
            placeholder="送信する"
            style={{ maxWidth: '10rem' }}
            aria-label="送信ボタンの文字"
          />
        </FieldLine>
        <FieldLine label="ページ送りの文字">
          <div className="flex gap-2">
            <TextInput value={value.prevLabel ?? ''} onChange={(e) => onChange({ prevLabel: e.target.value })} aria-label="前へボタンの文字" />
            <TextInput value={value.nextLabel ?? ''} onChange={(e) => onChange({ nextLabel: e.target.value })} aria-label="次へボタンの文字" />
          </div>
        </FieldLine>
      </div>
    </section>
  )
}
