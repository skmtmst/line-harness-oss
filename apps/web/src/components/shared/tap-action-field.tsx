'use client'

/*
 * 「押したら」の共通の欄（オーナー採用 B-129・Pen YPzmo・2026-10-09）。
 *
 * 左に「押したら」（6つ＋画面が足す種類。開いた一覧は印＋名前＋1行の説明）、右に「中身」
 * （種類ごとに変わる）。カルーセル・リッチメッセージ・リッチメニュー・統括のひな形などが同じ部品を使う。
 * - URL＝URL の入力／テキスト＝文字の入力
 * - 予約・回答フォーム・来店スタンプ＝「選んだもの＋［選ぶ］／［変える］」の1行。押すと窓で選ぶ
 *   （予約メニュー・スタンプカードは任意。空なら予約ページの最初・ふつうのカード）
 * - 予約履歴＝中身なし（「押した人の予約の一覧が開きます」）
 * - 店に LIFF が無いとき：6つとも選べる。LIFF が要る4つを選ぶと、中身の欄に
 *   「この動きは LIFF の設定が要ります」［設定を開く］（統括は配るときに各店の LIFF に置き換えるので出さない）
 * - 閲覧のみ（readOnly）：選ぶ・変えるボタンを置かず、選んでいる値を文字で見せる
 *
 * 種類の定数と URL の組み立て・読み戻しは lib/tap-actions.ts（ここでは持たない）。
 * 保存の形は画面ごとに今のまま（この部品は値 TapActionValue を返すだけ）。
 *
 * ★差し替える所（作ってあるものを選ぶ窓）：下の `TapTargetPicker` だけ。共通の選ぶ窓
 * （作業役 picker の部品・Pen dJZ7Q）ができたら、この関数の中身をその部品の呼び出しに替える。
 */
import { useId, useMemo, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { CalendarCheck, Check, ClipboardList, ExternalLink, History, Info, MessageSquare, Stamp, type LucideIcon } from 'lucide-react'
import {
  TAP_ACTION_DEFS, TAP_ACTION_KINDS, tapActionDef,
  type TapActionKind, type TapActionValue,
} from '@/lib/tap-actions'
import Button from './button'
import Dialog from './dialog'
import SearchField from './search-field'
import Select from './select'
import { TextField } from './text-field'
import styles from './tap-action-field.module.css'

export const TAP_ACTION_ICONS: Record<TapActionKind, LucideIcon> = {
  uri: ExternalLink,
  message: MessageSquare,
  booking: CalendarCheck,
  form: ClipboardList,
  booking_history: History,
  visit_stamp: Stamp,
}

/** 画面が足す種類（リッチメニューの「テンプレートを送る」・カルーセルの「動きを実行する」など）。 */
export interface TapActionExtraKind {
  value: string
  label: string
  description?: string
  icon: LucideIcon
}

/** 作ってあるもの（回答フォーム・予約メニュー・スタンプカード）1つ。 */
export interface TapActionSourceItem {
  id: string
  name: string
  /** 名前の横の小さな補足（「10個で1杯サービス」など）。 */
  note?: string
  /** 新しくは選べない（受け付けを止めた回答フォームなど）。選んであるときは名前と補足を出す。 */
  disabled?: boolean
}

export type TapActionSources = Partial<Record<'form' | 'booking' | 'visit_stamp', TapActionSourceItem[]>>

export interface TapActionFieldProps {
  /** 読み上げ名の頭（「カード1のボタン1」「面 A」）。 */
  name: string
  value: TapActionValue
  /** 変わった所だけ渡す。種類を変えたときは refId を空にして渡す。 */
  onChange: (patch: Partial<TapActionValue>) => void
  /** 出す6つの種類（既定は全部）。並びは絵の順のまま。 */
  kinds?: readonly TapActionKind[]
  /** 6つの後ろに足す種類。中身は renderExtraBody で描く。 */
  extraKinds?: readonly TapActionExtraKind[]
  renderExtraBody?: (kind: string) => ReactNode
  /** 店か統括か。統括は LIFF の案内を出さない（配るときに各店の LIFF に置き換える）。 */
  scope?: 'shop' | 'hq'
  /** 店のアカウントに LIFF があるか。 */
  hasLiff: boolean
  /** ［設定を開く］の行き先（アカウントの設定）。 */
  liffSettingsHref?: string
  readOnly?: boolean
  /** 作ってあるものの候補。読み込み中・読めないときは渡さない（窓に「読み込めませんでした」）。 */
  sources?: TapActionSources
  /** 'row'＝押したら・中身を横に並べる（ボタンの行）。'stack'＝縦に積む（狭い右の列）。 */
  layout?: 'row' | 'stack'
  /** テキストを送るの文字数の上限（LINE の決まりは画面ごとに違う）。 */
  textMax?: number
  /** 押したらのプルダウンの読み上げ名（既定「〇〇を押したら」）。 */
  kindLabel?: string
  className?: string
}

function kindOptionsOf(kinds: readonly TapActionKind[], extras: readonly TapActionExtraKind[], current: string) {
  const base = TAP_ACTION_DEFS.filter((def) => kinds.includes(def.kind) || def.kind === current).map((def) => ({
    value: def.kind as string,
    label: def.label,
    description: def.description,
    icon: TAP_ACTION_ICONS[def.kind],
  }))
  return [...base, ...extras.map((extra) => ({ value: extra.value, label: extra.label, description: extra.description, icon: extra.icon }))]
}

export default function TapActionField({
  name, value, onChange, kinds = TAP_ACTION_KINDS, extraKinds = [], renderExtraBody,
  scope = 'shop', hasLiff, liffSettingsHref = '/accounts', readOnly = false, sources,
  layout = 'row', textMax, kindLabel, className,
}: TapActionFieldProps) {
  const options = useMemo(() => kindOptionsOf(kinds, extraKinds, value.kind), [kinds, extraKinds, value.kind])
  const current = options.find((option) => option.value === value.kind)
  const CurrentIcon = current?.icon
  const def = tapActionDef(value.kind)
  const [picking, setPicking] = useState(false)

  const kindControl = readOnly ? (
    <span className={styles.readKind} aria-label={`${kindLabel ?? `${name}を押したら`}：${current?.label ?? ''}`}>
      {CurrentIcon ? <CurrentIcon className={styles.icon} aria-hidden="true" /> : null}
      <span className={styles.readText}>{current?.label ?? '—'}</span>
    </span>
  ) : (
    <Select
      size="full"
      aria-label={kindLabel ?? `${name}を押したら`}
      value={value.kind}
      icon={CurrentIcon ? <CurrentIcon className={styles.icon} /> : undefined}
      onChange={(next) => { if (next !== value.kind) onChange({ kind: next, refId: '' }) }}
      options={options.map(({ value: optionValue, label, description, icon: Icon }) => ({
        value: optionValue,
        label,
        description,
        leading: <Icon className={styles.icon} />,
      }))}
    />
  )

  let body: ReactNode
  if (!def) {
    body = renderExtraBody?.(value.kind) ?? null
  } else if (def.needsLiff && scope === 'shop' && !hasLiff) {
    body = (
      <p className={styles.liffNote} role="note">
        <Info className={styles.icon} aria-hidden="true" />
        <span className={styles.liffText}>この動きは LIFF の設定が要ります</span>
        {readOnly ? null : <Link href={liffSettingsHref} className={styles.liffLink}>設定を開く</Link>}
      </p>
    )
  } else if (def.kind === 'uri') {
    body = readOnly
      ? <span className={styles.readBody} title={value.uri}>{value.uri || '—'}</span>
      : <TextField type="url" value={value.uri} placeholder="https://example.com" aria-label={`${name}のURL`} onChange={(event) => onChange({ uri: event.target.value })} />
  } else if (def.kind === 'message') {
    const over = textMax !== undefined && [...value.text].length > textMax
    body = readOnly
      ? <span className={styles.readBody} title={value.text}>{value.text || '—'}</span>
      : <TextField value={value.text} placeholder={textMax ? `押した人が送る文（${textMax}文字まで）` : '押した人が送る文'} aria-label={`${name}の送る文`} aria-invalid={over || undefined} title={value.text || undefined} onChange={(event) => onChange({ text: event.target.value })} />
  } else if (def.kind === 'booking_history') {
    body = <span className={styles.fixed}>中身は要りません。押した人の予約の一覧（変更・取り消し）が開きます</span>
  } else {
    const target = def.target!
    const items = sources?.[def.kind as 'form' | 'booking' | 'visit_stamp']
    const picked = items?.find((item) => item.id === value.refId)
    const Icon = TAP_ACTION_ICONS[def.kind]
    const emptyText = target.required
      ? `（${target.noun}を選んでください）`
      : def.kind === 'booking' ? 'メニューを決めずに開く（予約ページの最初）' : 'ふつうのスタンプカードを開く'
    body = (
      <div className={styles.pickRow} data-empty={!value.refId || undefined}>
        <Icon className={styles.icon} aria-hidden="true" />
        <span className={styles.pickText} title={picked?.name}>
          {value.refId ? (
            <>
              <strong className={styles.pickName}>{picked?.name ?? `保存してある${target.noun}`}</strong>
              {picked?.note ? <span className={styles.pickNote}>{picked.note}</span> : def.kind === 'booking' ? <span className={styles.pickNote}>メニューを決めて開く（空のときは予約ページの最初）</span> : null}
            </>
          ) : <span className={styles.pickEmpty}>{emptyText}</span>}
        </span>
        {readOnly ? null : (
          <Button type="button" size="compact" aria-label={`${name}の${target.noun}を${value.refId ? '変える' : '選ぶ'}`} onClick={() => setPicking(true)}>
            {value.refId ? '変える' : '選ぶ'}
          </Button>
        )}
        {picking ? (
          <TapTargetPicker
            noun={target.noun}
            required={target.required}
            emptyLabel={emptyText}
            items={items}
            initialId={value.refId}
            onConfirm={(id) => { onChange({ refId: id }); setPicking(false) }}
            onCancel={() => setPicking(false)}
          />
        ) : null}
      </div>
    )
  }

  return (
    <div className={[styles.root, layout === 'stack' ? styles.stack : styles.row, className].filter(Boolean).join(' ')} data-tap-kind={value.kind}>
      <div className={styles.kind}>{kindControl}</div>
      <div className={styles.body}>{body}</div>
    </div>
  )
}

/**
 * 作ってあるもの（回答フォーム・予約メニュー・スタンプカード）を選ぶ窓。窓の中は仮選択で、
 * ［選ぶ］でだけ値を変える（キャンセル・Esc では変えない）。
 * ★差し替える所：共通の選ぶ窓（作業役 picker・Pen dJZ7Q）ができたらこの中身をその部品にする。
 */
export function TapTargetPicker({ noun, required, emptyLabel, items, initialId, onConfirm, onCancel }: {
  noun: string
  required: boolean
  emptyLabel: string
  /** undefined＝読めなかった。 */
  items: TapActionSourceItem[] | undefined
  initialId: string
  onConfirm: (id: string) => void
  onCancel: () => void
}) {
  const listId = useId()
  const [chosen, setChosen] = useState(initialId)
  const [query, setQuery] = useState('')
  const rows = (items ?? []).filter((item) => !item.disabled || item.id === initialId).filter((item) => item.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  const row = (id: string, label: string, note?: string) => (
    <li key={id || '__none__'}>
      <button type="button" className={styles.option} aria-pressed={chosen === id} onClick={() => setChosen(id)} onDoubleClick={() => onConfirm(id)}>
        <span className={styles.optionText}>
          <span className={styles.optionName}>{label}</span>
          {note ? <span className={styles.optionNote}>{note}</span> : null}
        </span>
        {chosen === id ? <Check className={styles.optionCheck} aria-hidden="true" /> : null}
      </button>
    </li>
  )
  return (
    <Dialog
      open
      title={`${noun}を選ぶ`}
      designWidth={480}
      confirmLabel="選ぶ"
      confirmDisabled={required && !chosen}
      onConfirm={() => onConfirm(chosen)}
      onCancel={onCancel}
    >
      <div className={styles.picker}>
        <SearchField aria-label={`${noun}を探す`} placeholder={`${noun}の名前で探す`} value={query} onChange={setQuery} onClear={() => setQuery('')} />
        {items === undefined ? (
          <p className={styles.pickerEmpty} role="alert">{`${noun}を読み込めませんでした。開き直してください。`}</p>
        ) : (
          <ul className={styles.options} id={listId} aria-label={noun}>
            {required ? null : row('', emptyLabel)}
            {rows.map((item) => row(item.id, item.name, item.note))}
            {rows.length === 0 ? <li className={styles.pickerEmpty}>{items.length === 0 ? `${noun}がまだありません。` : '当てはまるものがありません。'}</li> : null}
          </ul>
        )}
      </div>
    </Dialog>
  )
}
