'use client'

import { File as FileIcon, FileAudio, FileUp, Loader } from 'lucide-react'
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from 'react'
import styles from './media-slot.module.css'
import { TextField } from './text-field'

/**
 * 画像・動画・ファイルを入れる所。Pencil ★V8 の採用案 Z7vd2（B-128「画像を追加する所」）。
 *
 * - 薄い灰の地＋薄い線 1px・角丸 12。真ん中に灰色のファイルの印（上向き矢印）→太字の題
 *   「〇〇を追加」→小さい説明「ドラッグ＆ドロップ／またはクリックしてファイルをアップロード」
 *   →制限（1ファイル〇メガバイト以内・形式）→（あるときだけ）文字リンク「URL で入れる」「登録メディアから選ぶ」
 * - 枠全体が押せる（［ファイルを選ぶ］ボタンは置かない）。キーボードは題のボタンで開く
 * - 状態：空・ドラッグ中（線と印が青・地が薄い青）・アップロード中（％）・入った（枠いっぱいに出し、
 *   右上に［差し替える］［消す］）・失敗（赤い線と理由1行）
 * - `size="compact"` は小さい所（カルーセルのカード 180×140 など）。文字を減らした形
 *
 * 送り先は呼ぶ側が `upload` で渡す（API はこの部品の中で選ばない）。`upload` を渡さず
 * `onFile` を渡すと、検査を通ったファイルをそのまま渡す（取り込みは呼ぶ側が持つ）。
 * あとから選んだ画像・消す・`scope` が変わったあとに遅れて返った取り込みは反映しない。
 */
export type MediaSlotKind = 'image' | 'video' | 'audio' | 'file'

const NOUN: Record<MediaSlotKind, string> = { image: '画像', video: '動画', audio: '音声', file: 'ファイル' }

const FORMAT_NAMES: Record<string, string> = {
  'image/jpeg': 'JPEG',
  'image/jpg': 'JPEG',
  'image/png': 'PNG',
  'image/gif': 'GIF',
  'image/webp': 'WebP',
  'image/svg+xml': 'SVG',
  'image/*': '画像',
  'video/mp4': 'MP4',
  'video/quicktime': 'MOV',
  'video/*': '動画',
  'audio/mpeg': 'MP3',
  'audio/mp4': 'M4A',
  'audio/x-m4a': 'M4A',
  'audio/*': '音声',
  'application/pdf': 'PDF',
}

/** accept の書き方から「JPEG・PNG」のような形式の名前を作る。 */
export function formatNamesOf(accept?: string): string {
  if (!accept) return ''
  const names: string[] = []
  for (const rule of accept.split(',').map((part) => part.trim().toLowerCase()).filter(Boolean)) {
    const name = FORMAT_NAMES[rule] ?? (rule.startsWith('.') ? rule.slice(1).toUpperCase() : '')
    if (name && !names.includes(name)) names.push(name)
  }
  return names.join('・')
}

/** バイト数を「12.4MB」「800KB」に。 */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    const mb = bytes / (1024 * 1024)
    return `${Number.isInteger(mb) ? mb : mb.toFixed(1)}MB`
  }
  return `${Math.max(1, Math.round(bytes / 1024))}KB`
}

/** ファイルが accept に合うか。種類も名前も分からないときは断らない。 */
export function fileMatchesAccept(file: { type?: string; name?: string }, accept?: string): boolean {
  if (!accept) return true
  const type = (file.type || '').toLowerCase()
  const name = (file.name || '').toLowerCase()
  if (!type && !name) return true
  return accept
    .split(',')
    .map((rule) => rule.trim().toLowerCase())
    .filter(Boolean)
    .some((rule) => {
      if (rule.endsWith('/*')) return type.startsWith(rule.slice(0, -1))
      if (rule.startsWith('.')) return name.endsWith(rule)
      return type === rule
    })
}

/** 受け取りの失敗理由。日本語の理由だけを出し、「API error: 500」などの英語は案内文に置き換える。 */
function reasonOf(caught: unknown): string {
  const text = caught instanceof Error ? String(caught.message) : typeof caught === 'string' ? caught : ''
  return /^API error: /.test(text) || !/[ぁ-んァ-ヶ一-龠]/u.test(text) ? '' : text
}

export interface MediaSlotProps {
  /** 何を入れるか。印・言葉・入ったときの見せ方が変わる。 */
  kind?: MediaSlotKind
  /** 太字の題（「メイン画像を追加」など）。読み上げの名前にもなる。 */
  title: string
  /** 今入っているもの（URL）。空なら空の形。 */
  value?: string | null
  /** 入ったときに URL の代わりに見せる名前（動画・ファイル）。 */
  valueName?: string
  /** 入った画像の代わりの文。 */
  previewAlt?: string
  /** 入った画像の収め方。既定は枠いっぱい（cover）。 */
  fit?: 'cover' | 'contain'
  /** input の accept と同じ書き方。 */
  accept?: string
  /** 上限の大きさ（バイト）。超えたら送らずに理由を出す。 */
  maxBytes?: number
  /** 制限の行を自分で書くとき（「1ファイル10メガバイト以内・JPEG・PNG」など。括弧は部品が付ける）。 */
  limitText?: string
  /** 呼ぶ側の検査。理由を返すと送らない。 */
  validate?: (file: File) => string | Promise<string>
  /** 送り先。返した URL を `onChange` へ渡す。進みは `progress(0〜100)` で知らせる。 */
  upload?: (file: File, progress: (percent: number) => void) => Promise<string>
  /** 入った・消した。 */
  onChange?: (url: string | null) => void
  /** `upload` を渡さないとき、検査を通ったファイルを受け取る。 */
  onFile?: (file: File) => void
  /** 消す。渡さなければ `onChange(null)`。 */
  onRemove?: () => void
  /** false で［消す］を出さない（登録済みで外せないものなど。差し替えはできる）。 */
  removable?: boolean
  /** 渡すと「URL で入れる」を出す（押したときの動きは呼ぶ側）。 */
  onUrl?: () => void
  /**
   * 渡すと「URL で入れる」を出し、押すと枠の下に URL の欄を開く（部品が持つ）。
   * `open` を渡すと最初から開く（URL だけが入っているときなど）。
   */
  urlEntry?: { id?: string; value: string; onChange: (url: string) => void; label: string; placeholder?: string; open?: boolean }
  /** 渡すと「登録メディアから選ぶ」を出す。 */
  onMediaPick?: () => void
  /** 呼ぶ側が持つ取り込み中（`onFile` のとき）。 */
  busy?: boolean
  /** 呼ぶ側が持つ進み（0〜100）。 */
  progress?: number
  /** 呼ぶ側が持つ失敗の理由。 */
  error?: string
  /** 取り込み中が変わったら知らせる（保存を止めるなど）。 */
  onBusyChange?: (busy: boolean) => void
  /** これが変わったら、前の取り込みの返事を反映しない（カード・アカウントの切り替え）。 */
  scope?: string
  /** 読み取りのみ。押せる口を出さない。 */
  readOnly?: boolean
  disabled?: boolean
  /** 小さい所（カルーセルのカードなど）。文字を減らす。 */
  size?: 'regular' | 'compact'
  /** 決まった縦横（「1 / 1」「20 / 13」など）。 */
  aspectRatio?: string
  /** 貼り付け（Cmd+V）でも受ける。 */
  acceptPaste?: boolean
  /** 枠の下に足す補足（URL の入力欄など）。 */
  children?: ReactNode
  'data-testid'?: string
}

export default function MediaSlot({
  kind = 'image',
  title,
  value,
  valueName,
  previewAlt,
  fit = 'cover',
  accept,
  maxBytes,
  limitText,
  validate,
  upload,
  onChange,
  onFile,
  onRemove,
  removable = true,
  onUrl,
  urlEntry,
  onMediaPick,
  busy: busyProp,
  progress: progressProp,
  error: errorProp,
  onBusyChange,
  scope,
  readOnly = false,
  disabled = false,
  size = 'regular',
  aspectRatio,
  acceptPaste = false,
  children,
  'data-testid': testId,
}: MediaSlotProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const dragCount = useRef(0)
  const gen = useRef(0)
  const alive = useRef(true)
  const scopeRef = useRef(scope)
  scopeRef.current = scope
  const busyChange = useRef(onBusyChange)
  busyChange.current = onBusyChange
  const [drag, setDrag] = useState<'idle' | 'active' | 'reject'>('idle')
  const [ownBusy, setOwnBusy] = useState(false)
  const [ownProgress, setOwnProgress] = useState<number | null>(null)
  const [ownError, setOwnError] = useState('')
  const [urlOpen, setUrlOpen] = useState(Boolean(urlEntry?.open))
  /** ファイルを受け取る口があるか。無ければ URL・登録メディアだけの形。 */
  const canFile = Boolean(upload || onFile)

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      gen.current += 1
      busyChange.current?.(false)
    }
  }, [])

  // 取り込み中に外から値が変わった（URL を手で入れた・ほかで選んだ）ら、遅れて返る取り込みは捨てる。
  const busyRef = useRef(false)
  const firstValue = useRef(true)
  useEffect(() => {
    if (firstValue.current) {
      firstValue.current = false
      return
    }
    if (!busyRef.current) return
    gen.current += 1
    busyRef.current = false
    setOwnBusy(false)
    setOwnProgress(null)
    busyChange.current?.(false)
  }, [value])

  // 場所（カード・アカウント）が変わったら、前の取り込みの失敗の理由は消す。
  useEffect(() => {
    setOwnError('')
  }, [scope])

  const busy = Boolean(busyProp) || ownBusy
  const progress = progressProp ?? ownProgress
  const error = errorProp || ownError
  const interactive = !readOnly && !disabled && !busy && canFile
  const compact = size === 'compact'
  const noun = NOUN[kind]
  const formats = formatNamesOf(accept)
  const limit =
    limitText ??
    (compact
      ? maxBytes
        ? `${formatBytes(maxBytes)} 以内`
        : ''
      : [maxBytes ? `1ファイル${formatBytes(maxBytes).replace('MB', 'メガバイト')}以内` : '', formats]
          .filter(Boolean)
          .join('・'))

  const setBusy = useCallback((next: boolean) => {
    busyRef.current = next
    setOwnBusy(next)
    busyChange.current?.(next)
  }, [])

  const send = useCallback(
    async (file: File, ticket: number, sendFile: NonNullable<MediaSlotProps['upload']>) => {
      const requestedScope = scopeRef.current
      setOwnProgress(null)
      setBusy(true)
      try {
        const url = await sendFile(file, (percent) => {
          if (ticket === gen.current && alive.current) setOwnProgress(Math.min(100, Math.max(0, Math.round(percent))))
        })
        if (ticket !== gen.current || !alive.current) return
        if (scopeRef.current !== requestedScope) {
          setOwnError(`編集中の場所が変わったため、${NOUN[kind]}を反映しませんでした。選び直してください。`)
          return
        }
        onChange?.(url)
      } catch (caught) {
        if (ticket !== gen.current || !alive.current) return
        setOwnError(reasonOf(caught) || `${NOUN[kind]}を取り込めませんでした。もう一度選んでください。`)
      } finally {
        if (ticket === gen.current && alive.current) {
          setBusy(false)
          setOwnProgress(null)
        }
      }
    },
    [kind, onChange, setBusy],
  )

  const take = useCallback(
    (file: File) => {
      if (readOnly || disabled) return
      setOwnError('')
      if (!fileMatchesAccept(file, accept)) {
        setOwnError(formats ? `${formats} の${noun}を選んでください` : `この${noun}は入れられません`)
        return
      }
      if (maxBytes && file.size > maxBytes) {
        setOwnError(`${noun}が大きすぎます（${formatBytes(file.size)}）`)
        return
      }
      const ticket = ++gen.current
      const start = (reason: string) => {
        if (ticket !== gen.current || !alive.current) return
        if (reason) {
          setOwnError(reason)
          return
        }
        if (!upload) {
          onFile?.(file)
          return
        }
        void send(file, ticket, upload)
      }
      // 検査が同期なら、その場で送り始める（続けて選んだ順を崩さない）。
      const checked = validate ? validate(file) : ''
      if (typeof checked === 'string') start(checked)
      else void checked.then(start, () => start(`この${noun}は入れられません`))
    },
    [accept, disabled, formats, maxBytes, noun, onFile, readOnly, upload, validate, send],
  )

  const openPicker = () => {
    if (interactive) inputRef.current?.click()
  }

  const clear = () => {
    gen.current += 1
    if (ownBusy) setBusy(false)
    setOwnProgress(null)
    setOwnError('')
    if (onRemove) onRemove()
    else onChange?.(null)
  }

  const checkDrag = (event: DragEvent) => {
    event.preventDefault()
    if (!interactive) return
    if (event.type === 'dragenter') dragCount.current += 1
    const items = [...(event.dataTransfer?.items ?? [])].filter((item) => item.kind === 'file')
    const ok = items.every((item) => {
      const file = item.getAsFile()
      return fileMatchesAccept({ type: file?.type || item.type, name: file?.name }, accept)
    })
    setDrag(ok ? 'active' : 'reject')
  }
  const leaveDrag = (event: DragEvent) => {
    event.preventDefault()
    dragCount.current = Math.max(0, dragCount.current - 1)
    if (dragCount.current === 0) setDrag('idle')
  }
  const drop = (event: DragEvent) => {
    event.preventDefault()
    dragCount.current = 0
    setDrag('idle')
    if (!interactive) return
    const file = event.dataTransfer?.files?.[0]
    if (file) void take(file)
  }
  const paste = (event: ClipboardEvent) => {
    if (!acceptPaste || readOnly || disabled) return
    const item = [...(event.clipboardData?.items ?? [])].find((entry) => entry.kind === 'file' || entry.type.startsWith(`${kind}/`))
    const file = item?.getAsFile()
    if (file) {
      event.preventDefault()
      void take(file)
    }
  }

  const filled = Boolean(value) && !busy
  const state = busy
    ? 'busy'
    : drag === 'active'
      ? 'drag'
      : drag === 'reject' || error
        ? 'error'
        : filled
          ? 'filled'
          : 'empty'

  const stop = (event: MouseEvent) => event.stopPropagation()
  const onKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === ' ') event.stopPropagation()
  }

  const links =
    !readOnly && !busy && (onUrl || urlEntry || onMediaPick) ? (
      <span className={styles.links}>
        {onUrl || urlEntry ? (
          <button
            type="button"
            className={styles.link}
            disabled={disabled}
            aria-expanded={urlEntry ? urlOpen : undefined}
            onClick={(event) => { stop(event); if (onUrl) onUrl(); else setUrlOpen((open) => !open) }}
          >
            URL で入れる
          </button>
        ) : null}
        {onMediaPick ? (
          <button type="button" className={styles.link} disabled={disabled} onClick={(event) => { stop(event); onMediaPick() }}>
            登録メディアから選ぶ
          </button>
        ) : null}
      </span>
    ) : null

  let body: ReactNode
  if (busy) {
    body = (
      <span className={styles.center} role="status">
        <Loader aria-hidden="true" className={styles.spin} />
        <span className={styles.title}>{progress == null ? 'アップロード中…' : `アップロード中… ${progress}%`}</span>
        {compact ? null : <span className={styles.desc}>そのまま待つか、ほかの欄を入れて進めます</span>}
      </span>
    )
  } else if (filled && drag === 'idle') {
    body = (
      <>
        {kind === 'image' ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className={styles.preview} data-fit={fit} src={value ?? ''} alt={previewAlt ?? title.replace(/を追加$/, '')} />
        ) : kind === 'video' ? (
          <video className={styles.preview} data-fit={fit} src={value ?? ''} preload="metadata" muted aria-label={previewAlt ?? valueName ?? noun} />
        ) : (
          <span className={styles.center}>
            {kind === 'audio' ? <FileAudio aria-hidden="true" className={styles.icon} /> : <FileIcon aria-hidden="true" className={styles.icon} />}
            <span className={styles.fileName} title={valueName ?? value ?? ''}>{valueName ?? value}</span>
          </span>
        )}
        {readOnly ? null : (
          <span className={styles.actions}>
            {canFile ? (
              <button type="button" className={styles.pill} disabled={disabled} onClick={(event) => { stop(event); openPicker() }}>
                差し替える
              </button>
            ) : null}
            {removable ? (
              <button type="button" className={styles.pill} disabled={disabled} onClick={(event) => { stop(event); clear() }}>
                消す
              </button>
            ) : null}
          </span>
        )}
        {error ? <span className={styles.filledError} role="alert">{error}</span> : null}
      </>
    )
  } else {
    const inner = (
      <>
        <FileUp aria-hidden="true" className={styles.icon} />
        <span className={styles.title}>{readOnly ? `${noun}はありません` : title}</span>
        {readOnly ? null : drag === 'reject' ? (
          <span className={styles.reason}>{formats ? `${formats} の${noun}を選んでください` : `この${noun}は入れられません`}</span>
        ) : error ? (
          <>
            <span className={styles.reason} role="alert">{error}</span>
            {limit ? <span className={styles.desc}>{limit}</span> : null}
          </>
        ) : !canFile ? (
          limit ? <span className={styles.desc}>{compact ? limit : `（${limit}）`}</span> : null
        ) : (
          <>
            <span className={styles.desc}>
              ドラッグ＆ドロップ
              <br />
              {compact ? 'またはクリック' : 'またはクリックしてファイルをアップロード'}
            </span>
            {limit ? <span className={styles.desc}>{compact ? limit : `（${limit}）`}</span> : null}
          </>
        )}
      </>
    )
    body = (
      <span className={styles.center}>
        {readOnly || !canFile ? (
          inner
        ) : (
          <button type="button" className={styles.hit} disabled={!interactive} onClick={(event) => { stop(event); openPicker() }} onKeyDown={onKey}>
            {inner}
          </button>
        )}
        {drag === 'idle' ? links : null}
      </span>
    )
  }

  return (
    <div className={styles.root} data-testid={testId}>
      <div
        role="group"
        aria-label={title}
        aria-busy={busy || undefined}
        aria-invalid={state === 'error' || undefined}
        data-design-node="Z7vd2"
        data-state={state}
        data-size={size}
        data-kind={kind}
        data-readonly={readOnly || undefined}
        data-disabled={disabled || undefined}
        className={styles.frame}
        style={aspectRatio ? { aspectRatio } : undefined}
        tabIndex={acceptPaste && interactive ? -1 : undefined}
        onClick={() => {
          if (!filled) openPicker()
        }}
        data-file={canFile || undefined}
        onDragEnter={checkDrag}
        onDragOver={checkDrag}
        onDragLeave={leaveDrag}
        onDrop={drop}
        onPaste={paste}
      >
        {body}
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          disabled={!interactive}
          tabIndex={-1}
          aria-hidden="true"
          aria-label={`${title}（ファイル）`}
          className={styles.input}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => {
            const file = event.target.files?.[0]
            // 同じファイルを選び直せるよう、毎回空に戻す。
            event.target.value = ''
            if (file) void take(file)
          }}
        />
      </div>
      {urlEntry && urlOpen && !readOnly ? (
        <TextField
          id={urlEntry.id}
          type="url"
          aria-label={urlEntry.label}
          value={urlEntry.value}
          disabled={disabled}
          placeholder={urlEntry.placeholder ?? 'https://…'}
          onChange={(event) => urlEntry.onChange(event.target.value)}
        />
      ) : null}
      {children}
    </div>
  )
}
