'use client'

import { useCallback, useEffect, useState, type ComponentPropsWithRef, type HTMLAttributes, type ReactNode } from 'react'
import { Check, CircleAlert, CircleCheck, Info, TriangleAlert, X } from 'lucide-react'
import HelpTip from './help-tip'
import styles from './notice.module.css'
import { humanizeErrorText } from './human-error-text'
import { jstDate } from '@/lib/jst-datetime'

/** 知らせは案内・成功・注意・危険の4種類。呼び名と見た目はここが持つ。 */
export type NoticeTone = 'info' | 'success' | 'warn' | 'danger'
type CanonicalTone = NoticeTone

/* 正本は Pencil ★V8 `ThDed`「帯/案内」。下の節点の印 uR9s8 は前の版から引き継いだ値で、4種とも同じ。 */
const NODE_BY_TONE: Record<CanonicalTone, string> = {
  info: 'uR9s8',
  success: 'uR9s8',
  warn: 'uR9s8',
  danger: 'uR9s8',
}

const ICON_BY_TONE: Record<CanonicalTone, typeof CircleCheck> = {
  info: Info,
  success: CircleCheck,
  warn: TriangleAlert,
  danger: CircleAlert,
}

export type NoticeProps = Omit<HTMLAttributes<HTMLDivElement>, 'children'> & {
  ref?: ComponentPropsWithRef<'div'>['ref']
  'data-design-node'?: string
  tone: NoticeTone
  density?: 'compact'
  /** 2行の競合通知。既定の案内帯は変えない。 */
  heading?: ReactNode
  /** 保存の状況など、説明の下に並べる状態。 */
  states?: readonly { label: string; state: 'done' | 'pending' }[]
  /** 区切り線の下の控えめな操作。確認と遷移は呼び出し側が持つ。 */
  footer?: ReactNode
  /** 内容を短い丸の印で伝える。既定の図柄も引き続き使える。 */
  marker?: 'dot'
  /** カード内などの小さな帯。案内・成功の本文は1行に省略し、title で全文を渡す。警告・危険は折り返す。 */
  compact?: boolean
  /** 枠線のない注意帯を描く板だけで指定する。既定の帯は変えない。 */
  appearance?: 'soft'
  /** 本文（1〜2文）。`children` があるときはそちらが勝つ。 */
  message?: string
  children?: ReactNode
  /** 右の操作。主操作は1つ、副操作と並べられる。 */
  action?: ReactNode
  /** 長い本文を持つ帯では、狭幅時だけ操作を本文の下へ置ける。 */
  actionLayout?: 'stack-on-narrow'
  /** 閉じる印を出す。押すと呼ばれる。 */
  onClose?: () => void
  /**
   * 読まなくても操作できる定義だけの補足。文のすぐ右の「？」へ入れる
   * （★管理画面・§2-1b）。警告・失敗・操作の結果は入れない。
   */
  help?: ReactNode
  /** 「？」の見出し。省略時は「この案内」。 */
  helpLabel?: string
  /** 長い説明がある場所。渡すと吹き出しに「くわしく」が出る。 */
  helpHref?: string
  /**
   * 左の図柄の差し替え。省略時は種類の既定印。
   * `null` で図柄なし。 の帯は順序印（list-ordered）のため口を用意。
   * 既定の描画は変えない（管理画面 の画素も不変）。
   */
  icon?: ReactNode
  /** アカウントの短い説明。既定の帯の色・寸法は変えない。 */
  presentation?: 'account-note' | 'ops'
}

/**
 * 帯（Notice）。`note-bar` と1本化した正本。見た目は CSS が持つ。
 *
 * 一時的な知らせ（「保存しました」など）はここに置かず Toast
 *（`./toast` の `notifyToast`）へ送る。帯は読み直しても残る内容だけ。
 */
export default function Notice({
  tone,
  density,
  heading,
  states,
  footer,
  marker,
  compact = false,
  appearance,
  message,
  children,
  action,
  actionLayout,
  onClose,
  className,
  help,
  helpLabel,
  helpHref,
  icon,
  presentation,
  role,
  ...props
}: NoticeProps) {
  const canonical = tone
  const Icon = ICON_BY_TONE[canonical]
  const node = NODE_BY_TONE[canonical]
  const hasHelp = help !== undefined && help !== null
  const helpTip = hasHelp ? (
    <HelpTip label={`${helpLabel ?? 'この案内'}の説明`}>
      {help}
      {helpHref ? <a href={helpHref}>くわしく</a> : null}
    </HelpTip>
  ) : null
  return (
    <div
      {...props}
      className={[styles.notice, styles[canonical], heading ? styles.twoLine : null, className].filter(Boolean).join(' ')}
      // 呼び出し側が role を指定したらそれを優先する（下書きの競合帯の alert など）。
      // 指定がないときだけ、種類から既定（危険＝alert、ほかは note）を決める。
      role={role ?? (canonical === 'danger' ? 'alert' : 'note')}
      data-compact={compact || undefined}
      data-appearance={appearance}
      data-design-part="notice"
      data-tone={canonical}
      data-density={density}
      data-presentation={presentation}
      data-action-layout={action ? actionLayout : undefined}
      data-has-action={!!action || undefined}
      data-marker={marker}
      data-design-node={props['data-design-node'] ?? node}
    >
      {marker === 'dot' && icon === undefined ? <span className={styles.icon} aria-hidden="true" /> : icon === undefined ? (
        <Icon className={styles.icon} aria-hidden="true" size={16} />
      ) : icon === null ? null : (
        <span className={styles.icon} aria-hidden="true">{icon}</span>
      )}
      <div className={styles.message}>
        {heading ? <><div className={styles.headingRow}><div className={styles.heading}>{heading}</div>{hasHelp ? helpTip : null}</div><div className={styles.description}>{typeof children === 'string' ? humanizeErrorText(children) : children ?? (message === undefined ? message : humanizeErrorText(message))}</div></>
          : typeof children === 'string' ? humanizeErrorText(children) : children ?? (message === undefined ? message : humanizeErrorText(message))}
        {hasHelp && !heading ? helpTip : null}
        {states?.length ? <NoticeStates items={states} /> : null}
        {footer ? <div className={styles.footer}>{footer}</div> : null}
      </div>
      {action ? <span className={styles.action}>{action}</span> : null}
      {onClose ? <button type="button" className={styles.close} onClick={onClose} aria-label="通知を閉じる"><X aria-hidden="true" size={16} /></button> : null}
    </div>
  )
}

/** 色だけに頼らず、保存の状態を印と言葉で伝える。 */
export function NoticeStates({ items }: { items: NonNullable<NoticeProps['states']> }) {
  return <ul className={styles.states} aria-label="保存の状態">
    {items.map(({ label, state }) => <li key={label} className={styles.state}>
      <span className={styles.stateMark} data-state={state} aria-hidden="true">{state === 'done' ? <Check size={16} /> : null}</span>
      {label}
    </li>)}
  </ul>
}

const CLOSED_TODAY_PREFIX = 'lh:notice-closed:'

/**
 * 帯の［閉じる］（`onClose`）を、その端末でその日だけ効かせる。
 * 日本時間で日が変わると、また出る。保存できない端末では、その画面の間だけ閉じる。
 */
export function useNoticeClosedToday(key: string) {
  const [closed, setClosed] = useState(false)
  useEffect(() => {
    try { setClosed(localStorage.getItem(CLOSED_TODAY_PREFIX + key) === jstDate()) } catch { setClosed(false) }
  }, [key])
  const close = useCallback(() => {
    setClosed(true)
    try { localStorage.setItem(CLOSED_TODAY_PREFIX + key, jstDate()) } catch { /* この画面の間だけ閉じる */ }
  }, [key])
  return { closed, close }
}
