'use client'

import { useEffect, useLayoutEffect, useRef, type ClipboardEvent, type KeyboardEvent } from 'react'
import { Check } from 'lucide-react'
import styles from './otp-input.module.css'

/**
 * 認証コード入力（6マス）。Pencil ★V8 `RfHCo`「OTP入力」、できたときは `cMbie`。
 *
 * 2段階認証・重要操作の再確認の6桁コードを、1マス1桁で入れる。
 * 動きの手本は kobra.systems の Input OTP（コードは写していない）。
 *
 * - 値は左から詰めた数字の列（`value`）。空いたマスを押しても、次に入れるマスへ移る
 * - 貼り付け・自動入力（iPhone・Mac のパスワード機能など）は、押した位置から振り分ける。
 *   `autoComplete="one-time-code"` は1マス目だけに付ける。全部に付けると、
 *   自動入力の6桁が1マス目にまとめて入り、最後の1桁しか残らなかった（旧ログイン画面）
 * - Backspace は消して前へ、Delete はそのマスを消す、←→・Home・End で移動
 * - 日本語入力の変換中は受け取らない
 * - 6マスは1つのまとまり（role="group"）。名前は `labelledBy`（見出しの id）か `label` で渡す
 * - 全角の数字（１２３）は半角にして受ける。数字以外は入らない
 * - 6桁そろった瞬間に `onComplete` を1回だけ呼ぶ（送るボタンを押させない）。確かめている間
 *   （`busy`）は枠を押せない形にして輪を出し、同じ6桁を二重に送らない
 * - 違った（`invalid` が立った）ら、6桁を消して1マス目へ戻し、枠を赤くして横に揺らす
 *   （動きを減らす設定では揺らさない）。通った（`success`）ら緑の枠と ✓
 */
/** 全角の数字を半角に。数字以外は落とす。 */
export function otpDigits(raw: string): string {
  return raw.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/\D/g, '')
}

/**
 * 確かめの失敗を人の言葉に（サーバーの文をそのまま出さない所だけ置き換える）。
 * 違うコード・回数の上限・期限切れ・使用済み。ほかはそのまま返す。
 */
export function otpFailureMessage(message: string): string {
  if (/正しくありません|invalid|incorrect|違います/i.test(message)) return 'コードが違います。もう一度入れてください'
  // 次にすることまで書いてある文（「ログインからやり直してください」など）はそのまま。
  if (/やり直して/.test(message)) return message
  if (/回数|too many|rate/i.test(message)) return '何度か違うコードが入りました。少し待ってから、もう一度入れてください'
  if (/使用済み/.test(message)) return 'このコードはもう使いました。認証アプリに出ている次のコードを入れてください'
  if (/有効時間|期限|expired/i.test(message)) {
    return /コード/.test(message)
      ? 'コードの時間が切れました。認証アプリに出ている新しいコードを入れてください'
      : '時間が切れました。はじめからやり直してください'
  }
  return message
}

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
  success = false,
  busy = false,
  visualLabel,
}: {
  visualLabel?: string
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
  /**
   * 確認できた（コードが合った）とき true。V8 では6マスに緑の輪郭が
   * 順に描かれる。呼び出し側が検証結果を持っているときだけ渡す。
   */
  success?: boolean
  /** 確かめを送っている間。枠を押せない形にして輪を出す（disabled と同じく入力を止める）。 */
  busy?: boolean
}) {
  const refs = useRef<Array<HTMLInputElement | null>>([])
  /**
   * 値を変えたあとに移るマス。値が画面に反映される前に移ると、移った先が
   * 古い値を見て「空いたマスが先にある」と判断し、1マス目へ戻してしまう。
   */
  const pendingFocus = useRef<number | null>(null)
  const digits = otpDigits(value).slice(0, length)
  const locked = disabled || busy
  const groupRef = useRef<HTMLDivElement | null>(null)

  /*
   * 違った瞬間（invalid が立った）に、6桁を消して1マス目へ戻し、揺れをはじめからやり直す。
   * 画面が key で作り直している場合も、ここは何もしない（値はもう空）。
   */
  const wasInvalid = useRef(invalid)
  const wasBusy = useRef(busy)
  useEffect(() => {
    // 誤りが新しく出たとき。誤りの文が出たまま打ち直して、また違った（確かめが終わった）ときも。
    const rising = invalid && (!wasInvalid.current || (wasBusy.current && !busy))
    wasInvalid.current = invalid
    wasBusy.current = busy
    if (!rising) return
    const group = groupRef.current
    if (group) {
      group.removeAttribute('data-state')
      void group.offsetWidth
      group.setAttribute('data-state', 'error')
    }
    if (digits.length > 0) {
      pendingFocus.current = 0
      onChange('')
    } else {
      focusSlot(0)
    }
    // invalid の立ち上がり・確かめの終わりだけを見る。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invalid, busy])

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
    const clean = otpDigits(next).slice(0, length)
    const target = Math.min(focusIndex, clean.length)
    // 値が変わらない（同じ数字で上書きした）ときは画面が作り直されないので、その場で移る。
    if (clean === digits) {
      focusSlot(target)
      return
    }
    pendingFocus.current = target
    onChange(clean)
    // 6桁そろった瞬間に1回だけ。確かめている間・止めている間は送らない（二重送信を防ぐ）。
    if (clean.length === length && digits.length !== length && !locked) onComplete?.(clean)
  }

  /** 位置 index から数字の並びを書き込む。貼り付け・自動入力・1桁の入力で共通。 */
  const writeFrom = (index: number, incoming: string) => {
    const start = Math.min(index, digits.length)
    const numbers = otpDigits(incoming)
    if (!numbers) return
    const next = (digits.slice(0, start) + numbers + digits.slice(start + numbers.length)).slice(0, length)
    commit(next, start + numbers.length)
  }

  const onKeyDown = (index: number, event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing || event.ctrlKey || event.metaKey || event.altKey) return
    if (/^[0-9０-９]$/.test(event.key)) {
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
    <div className={styles.field}>
      {visualLabel ? <span className={styles.label}>{visualLabel}</span> : null}
    <div
      role="group"
      aria-label={labelledBy ? undefined : (label ?? '認証コード')}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      ref={groupRef}
      className={styles.group}
      data-state={invalid ? 'error' : success ? 'success' : undefined}
      aria-busy={busy || undefined}
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
          disabled={locked}
          value={digits[index] ?? ''}
          className={styles.slot}
          onKeyDown={(event) => onKeyDown(index, event)}
          onPaste={(event) => onPaste(index, event)}
          // 変換確定・自動入力・携帯のキーボードなど、keydown で数字が来ない入力はここで受ける。
          onChange={(event) => {
            const typed = otpDigits(event.target.value)
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
      {busy ? <span className={styles.spinner} aria-hidden="true" /> : null}
      {success && !busy ? <Check className={styles.check} size={18} aria-hidden="true" /> : null}
    </div>
    {/* 確かめている・通ったを読み上げにも伝える（見た目の輪・✓ と同じ時に）。 */}
    <span className={styles.srOnly} role="status" aria-live="polite">{busy ? '確かめています' : success ? '確認できました' : ''}</span>
    </div>
  )
}
