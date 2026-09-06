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
import { fieldInput, fieldSelect, type FormRefs } from './form-refs'
import Button from '@/components/shared/button'

function Row({
  label,
  note,
  children,
}: {
  label: string
  note?: string
  children: React.ReactNode
}) {
  return (
    <div className="grid gap-2 py-3 sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-4">
      <div>
        <p className="text-ink text-sm font-medium">{label}</p>
        {note && <p className="text-ink-faint mt-0.5 text-xs leading-relaxed">{note}</p>}
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  )
}

/** 「使う / 使わない」＋使うときだけ出る中身。 */
function Toggle({
  checked,
  onChange,
  label,
  children,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  label: string
  children?: React.ReactNode
}) {
  return (
    <div className="space-y-2">
      <label className="text-ink-secondary flex items-center gap-2 text-sm">
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        {label}
      </label>
      {checked && children}
    </div>
  )
}

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
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="オプション設定"
    >
      <div className="bg-canvas rounded-panel my-8 w-full max-w-3xl shadow-lg">
        <div className="border-hairline flex items-center justify-between border-b px-5 py-3">
          <div>
            <h2 className="text-ink text-base font-bold">オプション設定</h2>
            <p className="mt-0.5 text-xs text-ink-faint">答え終わったあとの動きと、受付のきまり</p>
          </div>
          <button onClick={onClose} className="text-ink-faint hover:text-ink px-2 text-lg">
            ×
          </button>
        </div>

        <div className="divide-hairline max-h-[70vh] divide-y overflow-y-auto px-5 py-2">
          <Row label="答え終わったあと" note="実行すること">
            <ActionEditor
              value={value.afterActions ?? []}
              onChange={(afterActions: FormAction[]) => patch({ afterActions })}
              refs={refs}
            />
          </Row>

          <Row
            label="答えたあとに開くページ（任意）"
            note="URLを使わないときは、下の文を表示します。"
          >
            <input
              type="url"
              value={value.thanksUrl ?? ''}
              onChange={(e) => patch({ thanksUrl: e.target.value || null })}
              placeholder="https://..."
              className={fieldInput}
            />
            <textarea
              rows={2}
              value={value.thanksText ?? ''}
              onChange={(e) => patch({ thanksText: e.target.value })}
              placeholder="ご回答ありがとうございました。"
              className={`${fieldInput} resize-y`}
              aria-label="ページを使わないときに出す文"
            />
          </Row>

          <Row label="受付のきまり" note="同じ人が答え直すときの動きを決めます。">
            <label className="text-ink-secondary flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={value.restorePrevious ?? false}
                onChange={(e) => patch({ restorePrevious: e.target.checked })}
              />
              前回の答えを最初から入れておく
            </label>
          </Row>

          <Row label="ページの名前" note="ブラウザのタブに出ます。">
            <input
              type="text"
              value={value.pageTitle ?? ''}
              onChange={(e) => patch({ pageTitle: e.target.value || null })}
              placeholder="回答フォーム"
              className={fieldInput}
            />
          </Row>

          <Row label="ボタンの文字">
            <div className="flex flex-wrap gap-2">
              <input
                type="text"
                value={value.submitLabel ?? ''}
                onChange={(e) => patch({ submitLabel: e.target.value })}
                placeholder="送信"
                className={`${fieldInput} max-w-[10rem]`}
                aria-label="送信ボタンの文字"
              />
              <input
                type="text"
                value={value.prevLabel ?? ''}
                onChange={(e) => patch({ prevLabel: e.target.value })}
                placeholder="前へ"
                className={`${fieldInput} max-w-[8rem]`}
                aria-label="前へボタンの文字"
              />
              <input
                type="text"
                value={value.nextLabel ?? ''}
                onChange={(e) => patch({ nextLabel: e.target.value })}
                placeholder="次へ"
                className={`${fieldInput} max-w-[8rem]`}
                aria-label="次へボタンの文字"
              />
            </div>
          </Row>

          <Row label="ページの見出し" note="ページが2枚以上のときに出ます。">
            <select
              value={value.sectionHeader ?? 'pageNumber'}
              onChange={(e) =>
                patch({ sectionHeader: e.target.value as FormOptions['sectionHeader'] })
              }
              className={fieldSelect}
            >
              <option value="pageNumber">ページ番号</option>
              <option value="name">ページの名前</option>
              <option value="none">出さない</option>
            </select>
          </Row>

          <Row label="送信前の確認" note="入力ミスを減らせます。ブロックが多いフォームで効きます。">
            <Toggle
              checked={value.confirmDialog?.enabled ?? false}
              onChange={(enabled) =>
                patch({ confirmDialog: { ...value.confirmDialog, enabled } })
              }
              label="送信する前に確認画面を出す"
            >
              <input
                type="text"
                value={value.confirmDialog?.text ?? ''}
                onChange={(e) =>
                  patch({
                    confirmDialog: {
                      ...value.confirmDialog,
                      enabled: true,
                      text: e.target.value,
                    },
                  })
                }
                placeholder="送信してよろしいですか？"
                className={fieldInput}
              />
            </Toggle>
          </Row>

          <Row label="回答期限" note="過ぎたら受け付けません。">
            <Toggle
              checked={value.deadline?.enabled ?? false}
              onChange={(enabled) => patch({ deadline: { ...value.deadline, enabled } })}
              label="受付の期限を決める"
            >
              <input
                type="datetime-local"
                value={value.deadline?.endsAt ?? ''}
                onChange={(e) =>
                  patch({ deadline: { ...value.deadline, enabled: true, endsAt: e.target.value } })
                }
                className={fieldInput}
              />
              <input
                type="text"
                value={value.deadline?.message ?? ''}
                onChange={(e) =>
                  patch({
                    deadline: { ...value.deadline, enabled: true, message: e.target.value },
                  })
                }
                placeholder="このフォームの回答期限は終了しました"
                className={fieldInput}
              />
            </Toggle>
          </Row>

          <Row label="1人1回に制限">
            <Toggle
              checked={value.oncePerFriend?.enabled ?? false}
              onChange={(enabled) =>
                patch({ oncePerFriend: { ...value.oncePerFriend, enabled } })
              }
              label="1人1回だけ答えられるようにする"
            >
              <input
                type="text"
                value={value.oncePerFriend?.message ?? ''}
                onChange={(e) =>
                  patch({
                    oncePerFriend: {
                      ...value.oncePerFriend,
                      enabled: true,
                      message: e.target.value,
                    },
                  })
                }
                placeholder="このフォームは、お一人さま1回までです"
                className={fieldInput}
              />
            </Toggle>
          </Row>

          <Row label="全体の受付数" note="定員に達したら締め切ります。">
            <Toggle
              checked={value.totalLimit?.enabled ?? false}
              onChange={(enabled) => patch({ totalLimit: { ...value.totalLimit, enabled } })}
              label="受け付ける数を決める"
            >
              <input
                type="number"
                min={1}
                value={value.totalLimit?.max ?? ''}
                onChange={(e) =>
                  patch({
                    totalLimit: {
                      ...value.totalLimit,
                      enabled: true,
                      max: Number(e.target.value) || undefined,
                    },
                  })
                }
                placeholder="100"
                className={`${fieldInput} max-w-[10rem]`}
              />
              <input
                type="text"
                value={value.totalLimit?.message ?? ''}
                onChange={(e) =>
                  patch({
                    totalLimit: {
                      ...value.totalLimit,
                      enabled: true,
                      message: e.target.value,
                    },
                  })
                }
                placeholder="このフォームは受付を終了しました"
                className={fieldInput}
              />
            </Toggle>
          </Row>
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
