'use client'

import { useEffect, useLayoutEffect, useRef, type ClipboardEvent, type KeyboardEvent } from 'react'
import styles from './otp-input.module.css'

/**
 * 認証コード入力（6マス）。Pencil ★V7 `xHzFK`「★ V7 共通 認証コード入力（6マス）」、1マスは `ENP7x`。
 *
 * 2段階認証・重要操作の再確認の6桁コードを、1マス1桁で入れる。
 * 動きの手本は kobra.systems の Input OTP（コードは写していない。docs/v7-reference-ui-adoption.md）。
 *
 * - 値は左から詰めた数字の列（`value`）。空いたマスを押しても、次に入れるマスへ移る
 * - 貼り付け・自動入力（iPhone・Mac のパスワード機能など）は、押した位置から振り分ける。
 *   `autoComplete="one-time-code"` は1マス目だけに付ける。全部に付けると、
 *   自動入力の6桁が1マス目にまとめて入り、最後の1桁しか残らなかった（旧ログイン画面）
 * - Backspace は消して前へ、Delete はそのマスを消す、←→・Home・End で移動
 * - 日本語入力の変換中は受け取らない
 * - 6マスは1つのまとまり（role="group"）。名前は `labelledBy`（見出しの id）か `label` で渡す
 */
export default function OtpInput({
  value,
  onChange,
  onComplete,
  length = 6,
  id,
  label,
  labelledBy,
  describedBy,
  invalid = false,
  disabled = false,
  autoFocus = false,
}: {
  value: string
  onChange: (value: string) => void
  /** 全マスがそろった瞬間に1回呼ぶ。 */
  onComplete?: (value: string) => void
  length?: number
  /** 1マス目の id。見出しの htmlFor や試験から1マス目を指すのに使う。 */
  id?: string
  /** まとまりの読み上げ名。見出しが画面にあるときは labelledBy を使う。 */
  label?: string
  labelledBy?: string
  /** 誤りの文などの id。 */
  describedBy?: string
  invalid?: boolean
  disabled?: boolean
  autoFocus?: boolean
}) {
  const refs = useRef<Array<HTMLInputElement | null>>([])
  /**
   * 値を変えたあとに移るマス。値が画面に反映される前に移ると、移った先が
   * 古い値を見て「空いたマスが先にある」と判断し、1マス目へ戻してしまう。
   */
  const pendingFocus = useRef<number | null>(null)
  const digits = value.replace(/\D/g, '').slice(0, length)

  const focusSlot = (index: number) => {
    const target = refs.current[Math.max(0, Math.min(index, length - 1))]
    target?.focus()
  }

  useEffect(() => {
    if (autoFocus) focusSlot(digits.length)
    // 最初の表示のときだけ。入力のたびに動かさない。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useLayoutEffect(() => {
    if (pendingFocus.current === null) return
    const index = pendingFocus.current
    pendingFocus.current = null
    focusSlot(index)
    // 値が変わったときだけ。focusSlot は毎回作り直されるが中身は同じ。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  const commit = (next: string, focusIndex: number) => {
    const clean = next.replace(/\D/g, '').slice(0, length)
    const target = Math.min(focusIndex, clean.length)
    // 値が変わらない（同じ数字で上書きした）ときは画面が作り直されないので、その場で移る。
    if (clean === digits) {
      focusSlot(target)
      return
    }
    pendingFocus.current = target
    onChange(clean)
    if (clean.length === length && digits.length !== length) onComplete?.(clean)
  }

  /** 位置 index から数字の並びを書き込む。貼り付け・自動入力・1桁の入力で共通。 */
  const writeFrom = (index: number, incoming: string) => {
    const start = Math.min(index, digits.length)
    const numbers = incoming.replace(/\D/g, '')
    if (!numbers) return
    const next = (digits.slice(0, start) + numbers + digits.slice(start + numbers.length)).slice(0, length)
    commit(next, start + numbers.length)
  }

  const onKeyDown = (index: number, event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing || event.ctrlKey || event.metaKey || event.altKey) return
    if (/^\d$/.test(event.key)) {
      event.preventDefault()
      writeFrom(index, event.key)
      return
    }
    switch (event.key) {
      case 'Backspace': {
        event.preventDefault()
        if (index < digits.length) commit(digits.slice(0, index) + digits.slice(index + 1), index)
        else if (index > 0) commit(digits.slice(0, index - 1), index - 1)
        return
      }
      case 'Delete': {
        event.preventDefault()
        if (index < digits.length) commit(digits.slice(0, index) + digits.slice(index + 1), index)
        return
      }
      case 'ArrowLeft':
        event.preventDefault()
        focusSlot(index - 1)
        return
      case 'ArrowRight':
        event.preventDefault()
        focusSlot(Math.min(index + 1, digits.length))
        return
      case 'Home':
        event.preventDefault()
        focusSlot(0)
        return
      case 'End':
        event.preventDefault()
        focusSlot(digits.length)
        return
      default:
    }
  }

  const onPaste = (index: number, event: ClipboardEvent<HTMLInputElement>) => {
    event.preventDefault()
    writeFrom(index, event.clipboardData.getData('text'))
  }

  return (
    <div
      role="group"
      aria-label={labelledBy ? undefined : (label ?? '認証コード')}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      className={styles.group}
    >
      {Array.from({ length }, (_, index) => (
        <input
          key={index}
          ref={(node) => { refs.current[index] = node }}
          id={index === 0 ? id : undefined}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete={index === 0 ? 'one-time-code' : 'off'}
          aria-label={`${index + 1}桁目`}
          aria-invalid={invalid || undefined}
          disabled={disabled}
          value={digits[index] ?? ''}
          className={styles.slot}
          onKeyDown={(event) => onKeyDown(index, event)}
          onPaste={(event) => onPaste(index, event)}
          // 変換確定・自動入力・携帯のキーボードなど、keydown で数字が来ない入力はここで受ける。
          onChange={(event) => {
            const typed = event.target.value.replace(/\D/g, '')
            const current = digits[index] ?? ''
            if (!typed) {
              if (current) commit(digits.slice(0, index) + digits.slice(index + 1), index)
              return
            }
            // 入った数字は、このマスから順に書き込む。フォーカスのたびに中身を選ぶので、
            // 普通に打てば1桁で上書きになる。まとめて入った（自動入力・続けて打たれた）ときは順に並ぶ。
            writeFrom(index, typed)
          }}
          onFocus={(event) => {
            // 空いたマスが先にあるなら、そこへ移る（左から詰めて入れる）。
            if (index > digits.length) {
              focusSlot(digits.length)
              return
            }
            event.currentTarget.select?.()
          }}
        />
      ))}
    </div>
  )
}
