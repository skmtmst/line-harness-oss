'use client'

import MultiSelect from '@/components/shared/multi-select'
import Select from '@/components/shared/select'
import type { Area } from './canvas-editor'
import { RICH_MENU_ACTION_TYPE_BY_INTENT, richMenuUriError, type RichMenuAreaIntent } from '@line-crm/shared'

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
  onDelete?: () => void
  /** 新規作成では座標・実績・削除を隠し、動きの設定だけを使う。 */
  showManagementDetails?: boolean
  allowedIntents?: RichMenuAreaIntent[]
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
  // 日時を選ぶボタンは postback で届くので数えられる。コピーは端末の中で
  // 完結し、押されたことがこちらに届かない。
  if (intent === 'datetime') return true
  if (intent === 'clipboard') return false
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
  { value: 'datetime', label: '日時を選ぶ', hint: 'カレンダーや時計を出して選んでもらう' },
  { value: 'clipboard', label: '文字をコピーする', hint: '合言葉などを端末に写す' },
]

/** intent から、LINE に登録するときの種類を決める。 */
export function actionTypeForIntent(intent: RichMenuAreaIntent): Area['actionType'] {
  return RICH_MENU_ACTION_TYPE_BY_INTENT[intent]
}

/** ボタンの動きを人間の言葉で返す。キャンバスのエリア一覧でも使う。 */
export function intentLabelOf(area: Area): string {
  return INTENT_OPTIONS.find((o) => o.value === intentOf(area))?.label ?? 'ボタン'
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
    case 'datetime':
      return { mode: 'datetime', initial: '', max: '', min: '' }
    case 'clipboard':
      return { text: '' }
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
    case 'datetimepicker':
      return 'datetime'
    case 'clipboard':
      return 'clipboard'
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
  'border-hairline rounded-control block w-full border px-2 py-1 text-sm'

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
  showManagementDetails = true,
  allowedIntents,
}: Props) {
  const data = (area.actionData ?? {}) as Record<string, unknown>
  const intent = intentOf(area)
  const selectedTagIds = area.tagIds ?? []
  const intentOptions = allowedIntents
    ? INTENT_OPTIONS.filter((option) => allowedIntents.includes(option.value))
    : INTENT_OPTIONS

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

  // タグ付けとスコアは、押されたことがこちらに届くボタンでしか使えない。
  // URL・電話・フォーム・コピーは LINE の中で完結してしまい、押されたことが分からない。
  // 日時を選ぶボタンは postback で届くので使える。
  const sideEffectsAvailable =
    intent === 'text' || intent === 'template' || intent === 'postback' || intent === 'datetime'

  return (
    <div className="space-y-3 text-sm">
      <div className="flex items-center justify-between">
        <h3 className="text-ink-secondary font-semibold">選択中のボタン</h3>
        {showManagementDetails && onDelete ? (
          <button type="button" onClick={onDelete} className="text-xs text-danger hover:underline">
            削除する
          </button>
        ) : null}
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

      {showManagementDetails ? (
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
      ) : null}

      {showManagementDetails ? (
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
      ) : null}

      <Field label="押したときの動き" hint="タップしたときに何が起きるかを決めます。">
        <Select
          aria-label="押したときの動き"
          size="full"
          value={intent}
          onChange={(value) => changeIntent(value as RichMenuAreaIntent)}
          options={intentOptions.map((o) => ({ value: o.value, label: o.label }))}
        />
        <p className="text-ink-faint mt-1 text-[11px]">
          {intentOptions.find((o) => o.value === intent)?.hint}
        </p>
      </Field>

      {intent === 'url' && (
        <>
          <Field
            label="計測リンクを使う"
            hint="選ぶと、押された回数が数えられます。計測リンク側にタグを設定していれば、それも付きます。"
          >
            <Select
              value={area.trackedLinkId ?? ''}
              onChange={(value) => onUpdate({ trackedLinkId: value || null })}
              aria-label="計測リンクを使う"
              options={[
                { value: '', label: '使わない（下のURLをそのまま開く）' },
                ...trackedLinks.map((l) => ({ value: l.id, label: l.name })),
              ]}
              size="full"
            />
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
                aria-invalid={Boolean(String(data.uri ?? '').trim()) && richMenuUriError(String(data.uri ?? '')) !== null}
                className={inputClass}
              />
              {/* R203: URLでない文字列はその場で理由を出す。空欄は「未設定」側の表示が担う。 */}
              {String(data.uri ?? '').trim() && richMenuUriError(String(data.uri ?? '')) ? (
                <p role="alert" className="text-danger mt-1 text-xs">
                  {richMenuUriError(String(data.uri ?? ''))}
                </p>
              ) : null}
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
          <Select
            value={area.templateId ?? ''}
            onChange={(value) => onUpdate({ templateId: value || null })}
            aria-label="送るテンプレート"
            options={[
              { value: '', label: '選択...' },
              ...templates.map((t) => ({ value: t.id, label: t.name })),
            ]}
            size="full"
          />
          {templates.length === 0 && (
            <p className="mt-1 text-[11px] text-status-warn-deep">
              テンプレートがまだありません。先に「テンプレート」で作ってください。
            </p>
          )}
        </Field>
      )}

      {intent === 'form' && (
        <Field label="開く回答フォーム">
          <Select
            value={area.formId ?? ''}
            onChange={(value) => onUpdate({ formId: value || null })}
            aria-label="開く回答フォーム"
            options={[
              { value: '', label: '選択...' },
              ...forms.map((f) => ({ value: f.id, label: f.name })),
            ]}
            size="full"
          />
          {forms.length === 0 && (
            <p className="mt-1 text-[11px] text-status-warn-deep">
              回答フォームがまだありません。先に「回答フォーム」で作ってください。
            </p>
          )}
        </Field>
      )}

      {intent === 'switch' && (
        <Field label="切り替え先のページ">
          <Select
            value={(data.targetPageId as string) ?? ''}
            onChange={(value) => onUpdate({ actionData: { ...data, targetPageId: value } })}
            aria-label="切り替え先のページ"
            options={[
              { value: '', label: '選択...' },
              ...pages.map((p) => ({ value: p.id, label: p.name })),
            ]}
            size="full"
          />
          {pages.length < 2 && (
            <p className="mt-1 text-[11px] text-status-warn-deep">
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

      {intent === 'datetime' && (
        <>
          <Field label="日時の種類" hint="友だちに見せるカレンダーや時計の形を決めます。">
            <Select
              value={(data.mode as string) ?? 'datetime'}
              onChange={(value) => onUpdate({ actionData: { ...data, mode: value } })}
              aria-label="日時の種類"
              options={[
                { value: 'date', label: '日付（2026-10-01）' },
                { value: 'time', label: '時刻（10:00）' },
                { value: 'datetime', label: '日時（2026-10-01 10:00）' },
              ]}
              size="full"
            />
          </Field>
          <Field label="はじめの値（任意）" hint="空欄なら、開いたときの日時が使われます。">
            <input
              value={(data.initial as string) ?? ''}
              onChange={(e) => onUpdate({ actionData: { ...data, initial: e.target.value } })}
              placeholder="例：2026-10-01"
              className={inputClass}
            />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="いちばん前（任意）">
              <input
                value={(data.min as string) ?? ''}
                onChange={(e) => onUpdate({ actionData: { ...data, min: e.target.value } })}
                placeholder="例：2026-09-01"
                className={inputClass}
              />
            </Field>
            <Field label="いちばん後（任意）">
              <input
                value={(data.max as string) ?? ''}
                onChange={(e) => onUpdate({ actionData: { ...data, max: e.target.value } })}
                placeholder="例：2026-12-31"
                className={inputClass}
              />
            </Field>
          </div>
        </>
      )}

      {intent === 'clipboard' && (
        <Field label="コピーする文字" hint="押すと、この文字が友だちの端末に写ります。">
          <input
            value={(data.text as string) ?? ''}
            onChange={(e) => onUpdate({ actionData: { ...data, text: e.target.value } })}
            maxLength={1000}
            placeholder="例：合言葉は「さくら」"
            className={inputClass}
          />
        </Field>
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
            {/*
              R19/R20: 検索なしの小さな選択枠を、共通の複数選択（★V7 WUVcz §2）へ。
              外側の label で包むと各項目の label と入れ子になり、先頭項目の
              読み上げに全タグ名が混ざる。見出しは span、欄の名前は
              MultiSelect の aria-label、各項目は個別の名前だけにする。
            */}
            <div>
              <span className="text-ink-secondary text-xs font-medium">タグを付ける</span>
              {tags.length === 0 ? (
                <p className="text-ink-faint mt-1 text-[11px]">タグがまだありません。</p>
              ) : (
                <MultiSelect
                  aria-label="タグを付ける"
                  options={tags.map((t) => ({ value: t.id, label: t.name }))}
                  values={selectedTagIds}
                  onChange={(next) => onUpdate({ tagIds: next })}
                  placeholder="タグを選ぶ"
                  className="mt-1 w-full"
                />
              )}
            </div>

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
