'use client'

import SelectField from '@/components/shared/select-field'
import type { Area } from './canvas-editor'
import type { RichMenuAreaIntent } from '@/lib/api'

type Option = { id: string; name: string }

type Props = {
  area: Area
  /** 同じメニュー内の他ページ。「メニューを切り替える」の行き先。 */
  pages: Option[]
  tags: Option[]
  templates: Option[]
  forms: Option[]
  trackedLinks: Option[]
  /** このボタンが今月押された回数。数えられない種類なら null。 */
  taps: { count: number; viaTrackedLink: number } | null
  onUpdate: (patch: Partial<Area>) => void
  onDelete: () => void
}

/**
 * 押された回数を数えられる種類か。
 *
 * URLを開く（計測リンクなし）・電話・回答フォームは、LINE の中や外で完結して
 * しまい、押されたことがこちらに届かない。数えられないものを「0回」と出すと
 * 「誰も押していない」と読めてしまうので、種類で分けて扱う。
 */
export function isTapCountable(area: Area): boolean {
  const intent = intentOf(area)
  if (intent === 'url') return Boolean(area.trackedLinkId)
  return intent !== 'tel' && intent !== 'form'
}

/** 運用者に見せる選択肢。並びは使う頻度の順。 */
const INTENT_OPTIONS: { value: RichMenuAreaIntent; label: string; hint: string }[] = [
  { value: 'url', label: 'URLを開く', hint: 'ホームページや申し込みページに飛ばす' },
  { value: 'text', label: 'メッセージを送る', hint: '押した人がその言葉を送ったことにする' },
  { value: 'template', label: 'テンプレートを送る', hint: '作ってあるメッセージをこちらから送る' },
  { value: 'form', label: '回答フォームを開く', hint: 'アンケートや申し込みフォームを開く' },
  { value: 'tel', label: '電話をかける', hint: 'スマホの電話アプリが立ち上がる' },
  { value: 'switch', label: 'メニューを切り替える', hint: 'タブのように別ページを出す' },
  { value: 'postback', label: 'こちらで処理する', hint: '自動応答やオートメーションの合図を送る（上級）' },
]

/** intent から、LINE に登録するときの種類を決める。 */
export function actionTypeForIntent(intent: RichMenuAreaIntent): Area['actionType'] {
  switch (intent) {
    case 'url':
    case 'tel':
    case 'form':
      return 'uri'
    case 'text':
      return 'message'
    case 'switch':
      return 'richmenuswitch'
    case 'template':
    case 'postback':
      return 'postback'
  }
}

/** 種類を変えたときの、入力欄の初期値。 */
function defaultActionData(intent: RichMenuAreaIntent): Record<string, unknown> {
  switch (intent) {
    case 'url':
      return { uri: '' }
    case 'tel':
      return { tel: '' }
    case 'text':
      return { text: '' }
    case 'form':
      return {}
    case 'template':
      return {}
    case 'switch':
      return { targetPageId: '' }
    case 'postback':
      return { data: '', displayText: '' }
  }
}

/** 昔つくったボタン（intent なし）を、いまの言い方に読み替える。 */
export function intentOf(area: Area): RichMenuAreaIntent {
  if (area.intent) return area.intent
  switch (area.actionType) {
    case 'uri':
      return 'url'
    case 'message':
      return 'text'
    case 'richmenuswitch':
      return 'switch'
    case 'postback':
      return 'postback'
  }
}

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <label className="block">
      <span className="text-ink-secondary text-xs font-medium">{label}</span>
      {hint && <span className="text-ink-faint block text-[11px]">{hint}</span>}
      <div className="mt-1">{children}</div>
    </label>
  )
}

const inputClass =
  'border-hairline rounded-control focus:ring-accent block w-full border px-2 py-1 text-sm focus:ring-2 focus:outline-none'

function NumField({
  label,
  value,
  onChange,
}: {
  label: string
  value: number
  onChange: (v: number) => void
}) {
  return (
    <label className="block">
      <span className="text-ink-faint text-xs">{label}</span>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(parseInt(e.target.value, 10) || 0)}
        className={`mt-0.5 ${inputClass}`}
      />
    </label>
  )
}

export function AreaProperties({
  area,
  pages,
  tags,
  templates,
  forms,
  trackedLinks,
  taps,
  onUpdate,
  onDelete,
}: Props) {
  const data = (area.actionData ?? {}) as Record<string, unknown>
  const intent = intentOf(area)
  const selectedTagIds = area.tagIds ?? []

  function changeIntent(next: RichMenuAreaIntent) {
    onUpdate({
      intent: next,
      actionType: actionTypeForIntent(next),
      actionData: defaultActionData(next),
      // 種類が変わると使わなくなる設定は消す。残すと保存時に紛れ込む。
      templateId: next === 'template' ? area.templateId : null,
      formId: next === 'form' ? area.formId : null,
      trackedLinkId: next === 'url' ? area.trackedLinkId : null,
    })
  }

  function toggleTag(tagId: string) {
    const next = selectedTagIds.includes(tagId)
      ? selectedTagIds.filter((t) => t !== tagId)
      : [...selectedTagIds, tagId]
    onUpdate({ tagIds: next })
  }

  // タグ付けとスコアは、押されたことがこちらに届くボタンでしか使えない。
  // URL・電話・フォームは LINE の中で完結してしまい、押されたことが分からない。
  const sideEffectsAvailable = intent === 'text' || intent === 'template' || intent === 'postback'

  return (
    <div className="space-y-3 text-sm">
      <div className="flex items-center justify-between">
        <h3 className="text-ink-secondary font-semibold">選択中のボタン</h3>
        <button onClick={onDelete} className="text-xs text-red-600 hover:underline">
          削除
        </button>
      </div>

      <Field label="ボタン名" hint="管理用の呼び名。友だちには表示されません。">
        <input
          value={area.label ?? ''}
          onChange={(e) => onUpdate({ label: e.target.value })}
          maxLength={60}
          placeholder="例：予約する"
          className={inputClass}
        />
      </Field>

      <div className="border-hairline bg-canvas-sunken rounded-control border px-3 py-2">
        <div className="text-ink-faint text-[11px]">今月押された回数</div>
        {isTapCountable(area) ? (
          <>
            <div className="text-ink text-lg font-bold tabular-nums">
              {taps?.count ?? 0}
              <span className="text-ink-faint ml-0.5 text-xs font-normal">回</span>
            </div>
            {taps && taps.viaTrackedLink > 0 && (
              <p className="text-ink-faint text-[11px]">
                うち {taps.viaTrackedLink} 回は計測リンクで数えた分です。
                同じ計測リンクを他でも使っていると、その分も入ります。
              </p>
            )}
          </>
        ) : (
          <p className="text-ink-faint text-[11px] leading-snug">
            この動きは数えられません。
            {intent === 'url'
              ? '上の「計測リンクを使う」を選ぶと数えられます。'
              : 'LINE の中で完結するため、押されたことがこちらに届きません。'}
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <NumField label="x" value={area.boundsX} onChange={(v) => onUpdate({ boundsX: v })} />
        <NumField label="y" value={area.boundsY} onChange={(v) => onUpdate({ boundsY: v })} />
        <NumField
          label="幅"
          value={area.boundsWidth}
          onChange={(v) => onUpdate({ boundsWidth: v })}
        />
        <NumField
          label="高さ"
          value={area.boundsHeight}
          onChange={(v) => onUpdate({ boundsHeight: v })}
        />
      </div>

      <Field label="押したときの動き" hint="タップしたときに何が起きるかを決めます。">
        <SelectField
          value={intent}
          onChange={(e) => changeIntent(e.target.value as RichMenuAreaIntent)}
          options={INTENT_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
          className={inputClass}
        />
        <p className="text-ink-faint mt-1 text-[11px]">
          {INTENT_OPTIONS.find((o) => o.value === intent)?.hint}
        </p>
      </Field>

      {intent === 'url' && (
        <>
          <Field
            label="計測リンクを使う"
            hint="選ぶと、押された回数が数えられます。計測リンク側にタグを設定していれば、それも付きます。"
          >
            <select
              value={area.trackedLinkId ?? ''}
              onChange={(e) => onUpdate({ trackedLinkId: e.target.value || null })}
              className={inputClass}
            >
              <option value="">使わない（下のURLをそのまま開く）</option>
              {trackedLinks.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </Field>

          {area.trackedLinkId ? (
            // 計測リンクを選んだら、飛び先はそちらの設定が使われる。
            // URL 欄を残すと「どっちが使われるのか」が分からなくなる。
            <p className="text-ink-faint text-[11px]">
              飛び先は、選んだ計測リンクの設定が使われます。変えるときは「計測リンク」の画面で編集してください。
            </p>
          ) : (
            <Field label="URL">
              <input
                type="url"
                value={(data.uri as string) ?? ''}
                onChange={(e) => onUpdate({ actionData: { ...data, uri: e.target.value } })}
                placeholder="https://..."
                className={inputClass}
              />
            </Field>
          )}
        </>
      )}

      {intent === 'tel' && (
        <Field label="電話番号" hint="ハイフンはあってもなくても構いません。">
          <input
            type="tel"
            value={(data.tel as string) ?? ''}
            onChange={(e) => onUpdate({ actionData: { ...data, tel: e.target.value } })}
            placeholder="0312345678"
            className={inputClass}
          />
        </Field>
      )}

      {intent === 'text' && (
        <Field label="送るテキスト" hint="押した人が、この言葉を送ったことになります。">
          <input
            value={(data.text as string) ?? ''}
            onChange={(e) => onUpdate({ actionData: { ...data, text: e.target.value } })}
            maxLength={300}
            className={inputClass}
          />
        </Field>
      )}

      {intent === 'template' && (
        <Field label="送るテンプレート" hint="押されたら、こちらからこのメッセージを送ります。">
          <select
            value={area.templateId ?? ''}
            onChange={(e) => onUpdate({ templateId: e.target.value || null })}
            className={inputClass}
          >
            <option value="">選択...</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          {templates.length === 0 && (
            <p className="mt-1 text-[11px] text-amber-600">
              テンプレートがまだありません。先に「テンプレート」で作ってください。
            </p>
          )}
        </Field>
      )}

      {intent === 'form' && (
        <Field label="開く回答フォーム">
          <select
            value={area.formId ?? ''}
            onChange={(e) => onUpdate({ formId: e.target.value || null })}
            className={inputClass}
          >
            <option value="">選択...</option>
            {forms.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
          {forms.length === 0 && (
            <p className="mt-1 text-[11px] text-amber-600">
              回答フォームがまだありません。先に「回答フォーム」で作ってください。
            </p>
          )}
        </Field>
      )}

      {intent === 'switch' && (
        <Field label="切り替え先のページ">
          <select
            value={(data.targetPageId as string) ?? ''}
            onChange={(e) => onUpdate({ actionData: { ...data, targetPageId: e.target.value } })}
            className={inputClass}
          >
            <option value="">選択...</option>
            {pages.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          {pages.length < 2 && (
            <p className="mt-1 text-[11px] text-amber-600">
              タブの切り替えには2ページ以上必要です。先にページを追加してください。
            </p>
          )}
        </Field>
      )}

      {intent === 'postback' && (
        <>
          <Field label="合図の文字列（postback data）">
            <input
              value={(data.data as string) ?? ''}
              onChange={(e) => onUpdate({ actionData: { ...data, data: e.target.value } })}
              maxLength={200}
              className={inputClass}
            />
          </Field>
          <Field label="トークに残す文言（任意）">
            <input
              value={(data.displayText as string) ?? ''}
              onChange={(e) => onUpdate({ actionData: { ...data, displayText: e.target.value } })}
              maxLength={300}
              className={inputClass}
            />
          </Field>
        </>
      )}

      {/* 押されたときの追加の動き */}
      <div className="border-hairline space-y-3 border-t pt-3">
        <p className="text-ink-secondary text-xs font-medium">押されたときに、あわせて行うこと</p>

        {!sideEffectsAvailable ? (
          <p className="text-ink-faint text-[11px]">
            {intent === 'url'
              ? 'URLを開くボタンでタグを付けたいときは、上の「計測リンクを使う」を選んでください。計測リンク側でタグを設定できます。'
              : 'この動きは LINE の中で完結するため、押されたことがこちらに届きません。タグ付けやスコアは設定できません。'}
          </p>
        ) : (
          <>
            <Field label="タグを付ける">
              {tags.length === 0 ? (
                <p className="text-ink-faint text-[11px]">タグがまだありません。</p>
              ) : (
                <div className="border-hairline max-h-32 space-y-1 overflow-y-auto rounded border p-2">
                  {tags.map((t) => (
                    <label key={t.id} className="flex cursor-pointer items-center gap-2 text-xs">
                      <input
                        type="checkbox"
                        checked={selectedTagIds.includes(t.id)}
                        onChange={() => toggleTag(t.id)}
                      />
                      <span className="truncate">{t.name}</span>
                    </label>
                  ))}
                </div>
              )}
            </Field>

            <Field label="スコアを足す" hint="マイナスを入れると減ります。空欄なら何もしません。">
              <input
                type="number"
                value={area.scoreChange ?? ''}
                onChange={(e) =>
                  onUpdate({
                    scoreChange: e.target.value === '' ? null : parseInt(e.target.value, 10) || 0,
                  })
                }
                placeholder="例：10"
                className={inputClass}
              />
            </Field>

            {intent === 'text' && (area.tagIds?.length || area.scoreChange) ? (
              <p className="text-ink-faint text-[11px]">
                タグかスコアを設定すると、押されたことを受け取るしくみに切り替わります。
                トークの見え方は変わりません。
              </p>
            ) : null}
          </>
        )}
      </div>
    </div>
  )
}
