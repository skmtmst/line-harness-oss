'use client'

/**
 * オプション設定。
 *
 * 1問ずつの設定ではなく、フォーム全体にかかるもの（送ったあとどうするか、
 * いつまで受け付けるか、何回まで答えられるか）をここに集める。
 *
 * 編集画面の本体に並べると、ブロックを並べ替える作業の邪魔になる。
 * 触る頻度が低いので、開いたときだけ出す。
 */

import type { FormAction, FormOptions } from '@line-crm/shared'
import ActionEditor from './action-editor'
import { fieldInput, type FormRefs } from './form-refs'
import Button from '@/components/shared/button'

export default function OptionsDialog({
  value,
  refs,
  onChange,
  onClose,
  onSave,
}: {
  value: FormOptions
  refs: FormRefs
  onChange: (next: FormOptions) => void
  onClose: () => void
  onSave: () => Promise<void>
}) {
  const patch = (next: Partial<FormOptions>) => onChange({ ...value, ...next })

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4"
      style={{ background: 'color-mix(in srgb, var(--color-ink) 40%, transparent)' }}
      role="dialog"
      aria-modal="true"
      aria-label="オプション設定"
    >
      <div className="bg-canvas w-full overflow-hidden rounded-panel shadow-lg" style={{ marginBlock: 74, height: 900, maxWidth: 880 }}>
        <div className="border-hairline flex items-center justify-between border-b px-5 py-3">
          <div>
            <h2 className="text-ink text-base font-bold">オプション設定</h2>
            <p className="mt-0.5 text-xs text-ink-faint">答え終わったあとの動きと、受付のきまり</p>
          </div>
          <button onClick={onClose} className="text-ink-faint hover:text-ink px-2 text-lg">
            ×
          </button>
        </div>

        <div className="overflow-y-auto px-6 py-4" style={{ maxHeight: 760 }}>
          <section>
            <h3 className="text-ink text-sm font-bold">答え終わったあと</h3>
            <div className="bg-canvas-sunken mt-3 rounded-control p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-ink text-xs font-bold">実行すること</p>
                <details className="group">
                  <summary className="border-accent text-accent rounded-control cursor-pointer list-none border px-3 py-2 text-xs font-medium">アクションを設定</summary>
                  <div className="mt-3 p-3 shadow-lg" style={{ minWidth: 680, background: 'var(--color-canvas)' }}>
                    <ActionEditor value={value.afterActions ?? []} onChange={(afterActions: FormAction[]) => patch({ afterActions })} refs={refs} />
                  </div>
                </details>
              </div>
              <p className="text-ink-secondary mt-2 text-sm">タグ「来店アンケート回答済み」を付ける ／ マイルを 50 付与 ／ お礼メッセージを送る</p>
              <p className="text-ink-faint mt-2 text-xs">カルーセルの選択肢・質問の答え・自動応答からも、同じ画面が開きます</p>
            </div>
          </section>

          <div className="mt-3 grid grid-cols-2 gap-3">
            <FieldLine label="答えたあとに開くページ（任意）"><input type="url" value={value.thanksUrl ?? ''} onChange={(e) => patch({ thanksUrl: e.target.value || null })} placeholder="https://..." className={fieldInput} /></FieldLine>
            <FieldLine label="ページを使わないときに出す文"><input value={value.thanksText ?? ''} onChange={(e) => patch({ thanksText: e.target.value })} placeholder="ご回答ありがとうございました。" className={fieldInput} /></FieldLine>
          </div>

          <section className="mt-3">
            <h3 className="text-ink text-sm font-bold">受付のきまり</h3>
            <div className="mt-2 grid gap-2">
              <OptionCard checked={value.oncePerFriend?.enabled ?? false} onChange={(enabled) => patch({ oncePerFriend: { ...value.oncePerFriend, enabled } })} label="1人1回だけ答えられるようにする" note="2回目に開いた人には「回答済みです」と出ます" />
              <OptionCard checked={value.restorePrevious ?? false} onChange={(restorePrevious) => patch({ restorePrevious })} label="前回の答えを最初から入れておく" note="同じ人が答え直すとき、前の内容が入った状態で開きます。別の端末では戻せません" />
              <OptionCard checked={value.deadline?.enabled ?? false} onChange={(enabled) => patch({ deadline: { ...value.deadline, enabled } })} label="受付の期限を決める" note="期限を過ぎたら、開いても「受付は終了しました」と出ます" />
              <OptionCard checked={value.confirmDialog?.enabled ?? false} onChange={(enabled) => patch({ confirmDialog: { ...value.confirmDialog, enabled } })} label="送信する前に確認画面を出す" note="入力ミスを減らせます。ブロックが多いフォームで効きます" />
            </div>
          </section>

          {value.deadline?.enabled && <div className="bg-accent-soft mt-2 grid grid-cols-2 gap-3 rounded-control p-3">
            <FieldLine label="受付の期限"><input type="datetime-local" value={value.deadline.endsAt || '2026-09-30T23:59'} onChange={(e) => patch({ deadline: { ...value.deadline, enabled: true, endsAt: e.target.value } })} className={fieldInput} /></FieldLine>
            <FieldLine label="期限を過ぎた人に出す文"><input type="text" value={value.deadline.message ?? ''} onChange={(e) => patch({ deadline: { ...value.deadline, enabled: true, message: e.target.value } })} className={fieldInput} /></FieldLine>
          </div>}

          <section className="mt-4">
            <h3 className="text-ink text-sm font-bold">見た目の言葉</h3>
            <div className="mt-2 grid grid-cols-3 gap-3"><FieldLine label="ページの題名">
            <input
              type="text"
              value={value.pageTitle ?? ''}
              onChange={(e) => patch({ pageTitle: e.target.value || null })}
              placeholder="回答フォーム"
              className={fieldInput}
            />
          </FieldLine>

          <FieldLine label="送信ボタンの文字">
            <div>
              <input
                type="text"
                value={value.submitLabel ?? ''}
                onChange={(e) => patch({ submitLabel: e.target.value })}
                placeholder="送信"
                className={fieldInput}
                style={{ maxWidth: '10rem' }}
                aria-label="送信ボタンの文字"
              />
            </div>
          </FieldLine>
          <FieldLine label="ページ送りの文字"><div className="flex gap-2"><input value={value.prevLabel ?? ''} onChange={(e) => patch({ prevLabel: e.target.value })} className={fieldInput} aria-label="前へボタンの文字" /><input value={value.nextLabel ?? ''} onChange={(e) => patch({ nextLabel: e.target.value })} className={fieldInput} aria-label="次へボタンの文字" /></div></FieldLine></div>
          </section>
        </div>

        <div className="border-hairline flex justify-end gap-2 border-t px-5 py-3">
          <Button onClick={onClose}>
            閉じる
          </Button>
          <Button variant="primary" onClick={() => void onSave()}>
            保存する
          </Button>
        </div>
      </div>
    </div>
  )
}

function OptionCard({ checked, onChange, label, note }: { checked: boolean; onChange: (next: boolean) => void; label: string; note: string }) {
  return <label className={`rounded-control border p-3 ${checked ? 'border-accent bg-accent-soft' : 'border-hairline'}`}><span className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />{label}</span><span className="text-ink-faint ml-6 mt-1 block text-xs">{note}</span></label>
}

function FieldLine({ label, children }: { label: string; children: React.ReactNode }) {
  return <label><span className="text-accent mb-1 block text-xs font-medium">{label}</span>{children}</label>
}
