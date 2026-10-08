'use client'

import React, { useContext, useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Check, X } from 'lucide-react'
import Button from './button'
import IconButton from './icon-button'
import { OverlayDepthContext, useOverlayFocus, useV8Leave } from './overlay-utils'
import styles from './dialog.module.css'

export type DialogProps = {
  open: boolean
  /** V8 の幅。v7 の寸法は維持する。 */
  size?: 'medium' | 'large'
  /**
   * ★V8：絵の窓の幅（px）。絵ごとに 480〜720 とばらばらなので、画面が絵の値を渡す。
   * 渡さなければ size の幅のまま。v7 では効かない。
   */
  designWidth?: number
  /** ★V8：絵の窓の上からの位置（px）。渡すと上寄せにする。渡さなければ今までどおり。v7 では効かない。 */
  designTop?: number
  /**
   * ★V8：絵の窓の頭（題と×の行）の余白。CSS の padding と同じ書き方（例 `'20px 20px 0'`）。
   * 小窓だけの絵（MyJP7・F1LK4e・CVz5d など）は頭が今の共通の値（上20・左右24・下8）より
   * 詰まっているので、絵の値を画面から渡す。渡さなければ今までどおり。v7 では効かない。
   * 読み方：~/lh-work/design/v8/html/<板>.html の窓（角丸16px の箱）の padding が上と左右、
   * 窓の gap が頭と次の段の間。
   */
  designHeaderPadding?: string
  /** ★V8：絵の窓の頭の高さ（px）。渡すと頭の行をこの高さに固定する。渡さなければ中身なり。v7 では効かない。 */
  designHeaderHeight?: number
  /** 段の帯を使わず、題・手順・本文・操作を1枚に続ける窓（hadfk）。既定の窓は変えない。 */
  layout?: 'continuous'
  /** 手順の帯。本文のスクロールから独立させる。 */
  steps?: ReactNode
  /** 操作の左に出す現在の手順など。 */
  footerLead?: ReactNode
  title: string
  description?: string
  tone?: 'default' | 'destructive'
  /**
   * 説明文を帯で囲む。'warning' は琥珀帯（CFAyf 送受信を止める）。
   * 'danger' は桃箱（YZ57z 解除。題は箱の外・説明だけ箱の中）。
   * tone（題・ボタンの色）とは独立。渡さなければ帯なし。
   */
  descriptionBand?: 'warning' | 'danger'
  busy?: boolean
  /** 実行ボタンを押せない形で出す（確かめのチェックが入るまで、など）。処理中の busy とは別。 */
  confirmDisabled?: boolean
  error?: string
  confirmLabel?: string
  cancelLabel?: string
  onConfirm?: () => void
  onCancel: () => void
  children?: ReactNode
  footer?: ReactNode
  /**
   * 見出しの左に置く絵。渡さなければ今までどおり何も足さない。
   * 危険な操作の確認で「これは戻せない」を一目で分かるようにするため。
   */
  titleIcon?: ReactNode
  /** 実行ボタンの中、文字の左に置く絵。処理中は文字だけにする。 */
  confirmIcon?: ReactNode
  /** 参照画像の固定比較やページ内プレビューで、背景を付けず面だけ表示する。 */
  modal?: boolean
  /** 画面固有のPencil Node。未指定なら共通部品のNodeだけを持つ。 */
  designNode?: string
  /** ConfirmDialog の構造。重要操作でも説明を赤帯へ入れない。 */
  confirmation?: boolean
  /** 本文を持たない短い確認窓。 */
  compact?: boolean
  /**
   * 主にする操作。`'confirm'`（既定）は実行が主、`'cancel'` は取消が主。
   * 未保存の離脱確認のように「残る方」を主の緑にし、離れる方を枠線にするとき
   * `'cancel'` を渡す。×と背景は取消と同じ動きのまま変えない。
   */
  primaryAction?: 'confirm' | 'cancel'
  /** ★V8：下のボタンの並び。省くと今までどおり右寄せ。'center' は中央（E-3 ウォークイン PUWyq）。v7 では効かない。 */
  footerAlign?: 'center'
}

/** Pencil V6 `J6x4Q` と重要操作 `H2S1T4` を1つにした共通ダイアログ。 */
export default function Dialog({
  open,
  size = 'medium',
  designWidth,
  designTop,
  designHeaderPadding,
  designHeaderHeight,
  layout,
  steps,
  footerLead,
  title,
  description,
  tone = 'default',
  descriptionBand,
  busy = false,
  error,
  confirmLabel = '保存する',
  cancelLabel = 'キャンセル',
  confirmDisabled = false,
  onConfirm,
  onCancel,
  children,
  footer,
  titleIcon,
  confirmIcon,
  modal = true,
  designNode,
  confirmation = false,
  compact = false,
  primaryAction = 'confirm',
  footerAlign,
}: DialogProps) {
  const depth = useContext(OverlayDepthContext)
  const titleId = useId()
  const descriptionId = useId()
  const [mounted, setMounted] = useState(false)
  /* ★V8 仕上げ（M10）：閉じるときは逆再生してから外す（v8 のみ）。 */
  const leaving = useV8Leave(open)
  /*
   * open=true で初回マウントした場合、最初の描画は通常DOMで、effect後に
   * portal へ移る。フォーカス制御は portal の準備ができてから始める
   * （DEEP-15）。useOverlayFocus 側もイベント時に ref.current を読むため、
   * 常時マウントから開く場合も同じ経路で正しい面を掴む。
   */
  const cancelRef = useRef<HTMLButtonElement>(null)
  const panelRef = useOverlayFocus(
    open && modal && mounted,
    onCancel,
    busy,
    // 主が取消の窓は、開いた直後の標的を主のボタンへ寄せる。Enter を押しても
    // 残る方が動く向きにする（×と背景は従来どおり取消）。
    primaryAction === 'cancel' ? () => cancelRef.current : undefined,
  )
  const confirmationSizeClass = confirmation && compact
    ? tone === 'destructive'
      ? styles.destructiveConfirmation
      : styles.compactConfirmation
    : ''

  useEffect(() => setMounted(true), [])
  if (!open && !leaving) return null

  const titleNode = (
    <h2 id={titleId} className={`${styles.title} ${tone === 'destructive' ? styles.destructiveTitle : styles.standardTitle}`}>{title}</h2>
  )
  /* YZ57z 解除の桃箱は「題は箱の外・説明だけ箱の中」のため、題と説明を分けておく。
     かけらは描画に出ない（囲み要素なし）。渡さないときは h2 そのまま。 */
  const titlePart = (<>{titleIcon ? (
    <div className={styles.titleRow}>
      <span className={styles.titleIcon} aria-hidden="true">{titleIcon}</span>
      {titleNode}
    </div>
  ) : titleNode}</>)
  const descriptionNode = description ? <p id={descriptionId} className={styles.description}>{description}</p> : null
  const heading = (
    <>
      {/* 絵が無いときは今までどおり h2 を直接置く。囲むと既存の余白が動く。 */}
      {titlePart}
      {descriptionNode}
    </>
  )
  const panel = (
    <div
      ref={panelRef}
      className={`${styles.panel} ${styles.standardPanel} ${confirmation ? styles.confirmationPanel : ''} ${confirmationSizeClass}`}
      role={tone === 'destructive' ? 'alertdialog' : 'dialog'}
      aria-modal={modal || undefined}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      aria-busy={busy || undefined}
      tabIndex={-1}
      data-closing={leaving || undefined}
      data-size={size}
      data-layout={layout}
      data-footer-align={footerAlign}
      data-design-width={designWidth ? '' : undefined}
      data-design-header-padding={designHeaderPadding ? '' : undefined}
      data-design-header-height={designHeaderHeight ? '' : undefined}
      style={designWidth || designHeaderPadding || designHeaderHeight ? ({
        ...(designWidth ? { '--dialog-design-width': `${designWidth}px` } : {}),
        ...(designHeaderPadding ? { '--dialog-design-header-padding': designHeaderPadding } : {}),
        ...(designHeaderHeight ? { '--dialog-design-header-height': `${designHeaderHeight}px` } : {}),
      } as CSSProperties) : undefined}
      data-design-part="dialog"
      data-design-node={tone === 'destructive' ? 'H2S1T4' : 'J6x4Q'}
    >
      <div className={styles.headerRow}>
        <div className={styles.headerContent}>
          {descriptionBand === 'danger' && description ? (
            <>
              {titlePart}
              <div className={`${styles.callout} ${styles.calloutDanger}`} data-qa-dialog-callout>{descriptionNode}</div>
            </>
          ) : (tone === 'destructive' && !confirmation) || descriptionBand === 'warning' ? <div className={`${styles.callout} ${descriptionBand === 'warning' ? styles.calloutWarning : ''}`} data-qa-dialog-callout>{heading}</div> : heading}
        </div>
        {/* 閉じ方は必ず右上の×。フッターの「閉じる」ボタンは置かない（UI-25）。 */}
        <IconButton aria-label="閉じる" title="閉じる" className={styles.close} onClick={onCancel} disabled={busy}>
          <X aria-hidden="true" size={18} />
        </IconButton>
      </div>
      {steps ? <div className={styles.steps}>{steps}</div> : null}
      {children ? <div className={styles.content}>{children}</div> : null}
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      <div className={styles.footer}>
      {footer ?? (onConfirm ? (
        /*
         * 実行・取消は共通Buttonの役割（primary/danger/secondary）をそのまま
         * 使う（#976 U077/U083/U084）。ここで赤や緑を自前で持つと、コントラストが
         * 画面ごとにずれる。横幅の指定だけ `.designButton` で足す。
         * 実行ボタンの無い参照窓では「キャンセル」を出さない。閉じ方は右上の×
         * に一本化する（UI-25）。
         */
        <div className={styles.actions}>
          {footerLead ? <span className={styles.footerLead}>{footerLead}</span> : null}
          <Button
            data-dialog-action={primaryAction === 'cancel' ? 'primary' : 'secondary'}
            variant={primaryAction === 'cancel' ? 'primary' : undefined}
            className={styles.designButton}
            ref={primaryAction === 'cancel' ? cancelRef : undefined}
            onClick={onCancel}
            disabled={busy}
          >
            {cancelLabel}
          </Button>
          <Button
            data-dialog-action={primaryAction === 'cancel' ? 'secondary' : tone === 'destructive' ? 'danger' : 'primary'}
            variant={primaryAction === 'cancel' ? 'secondary' : tone === 'destructive' ? 'danger' : 'primary'}
            className={styles.designButton}
            onClick={onConfirm}
            disabled={busy || confirmDisabled} busy={busy} busyLabel="処理中…">
            {!busy && confirmIcon ? <span className={styles.buttonIcon} aria-hidden="true">{confirmIcon}</span> : null}
            {confirmLabel}
          </Button>
        </div>
      ) : null)}
      </div>
    </div>
  )

  if (!modal) return <OverlayDepthContext.Provider value={depth + 1}>{panel}</OverlayDepthContext.Provider>
  const overlay = (
    <div className={`${styles.overlay} ${confirmation && compact ? styles.confirmationOverlay : ''}`} role="presentation" data-closing={leaving || undefined} data-design-node={designNode} data-design-top={designTop ? '' : undefined} style={designTop ? ({ '--dialog-design-top': `${designTop}px` } as CSSProperties) : undefined} onMouseDown={(event) => {
      if (!busy && event.target === event.currentTarget) onCancel()
    }}>
      {panel}
    </div>
  )
  return <OverlayDepthContext.Provider value={depth + 1}>{mounted && typeof document !== 'undefined' ? createPortal(overlay, document.body) : overlay}</OverlayDepthContext.Provider>
}

/** q3DPdz の手順。済みは戻れるボタン、現在は aria-current で伝える。 */
export function DialogSteps({ steps }: { steps: Array<{ label: string; done?: boolean; current?: boolean; onSelect?: () => void }> }) {
  return <nav aria-label="手順" className={styles.stepItems}>
    {steps.map((step, index) => <React.Fragment key={step.label}>
      {index > 0 ? <span className={styles.stepLine} aria-hidden="true" /> : null}
      <button type="button" className={styles.stepItem} onClick={step.onSelect} disabled={!step.onSelect} aria-current={step.current ? 'step' : undefined}>
        <span className={`${styles.stepCircle} ${step.done ? styles.stepDone : step.current ? styles.stepCurrent : ''}`}>
          {step.done ? <Check size={12} aria-hidden="true" /> : index + 1}
        </span>
        <span>{step.label}</span>
      </button>
    </React.Fragment>)}
  </nav>
}
