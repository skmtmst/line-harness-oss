'use client'


import { isDeleteConfirmation, normalizeDeleteTitle } from './delete-confirmation'
import React, { useContext, useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Check, X } from 'lucide-react'
import Button from './button'
import IconButton from './icon-button'
import { OverlayDepthContext, useOverlayFocus, useV8Leave } from './overlay-utils'
import styles from './dialog.module.css'
import { useFormInputDirty } from './form-input-dirty'
import { useOverlayDiscard } from './overlay-discard'
import { useStepMotion } from './use-step-motion'
import { dialogWidth } from './destination-policy'

export type DialogProps = {
  open: boolean
  /** V8 の幅。v7 の寸法は維持する。 */
  size?: 'small' | 'medium' | 'large' | 'wide'
  /**
   * ★V8：480・560・720・960の4段。旧指定は共通部品で段へそろえる。
   * 渡さなければ size の幅のまま。v7 では効かない。
   */
  /** 頭・説明・本文・操作を同じ余白で積む小窓（i8F12 等）。 */
  designLayout?: 'stacked'
  /** 確認のボタンを先に置く板だけで指定する。 */
  confirmFirst?: boolean
  designWidth?: number
  /** B-165の共通選択窓だけ640pxの幅を使う。 */
  widthPreset?: 'picker'
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
  /** 指定した窓だけ本文の余白を変える（フォルダ付きの選択窓など）。 */
  designContentPadding?: string
  /** 指定した窓だけ下の操作段の余白を変える。 */
  designFooterPadding?: string
  /** 本文と操作が続く窓では区切り線を省く。既定は線あり。 */
  footerDivider?: boolean
  /** 左の操作で残り幅を埋めるか。既定は埋める。 */
  footerLeadFlexible?: boolean
  /** 題の隣の補足。ほかの窓の題の並びは変えない。 */
  titleHelp?: ReactNode
  /** 段の帯を使わず続ける窓（hadfk）、またはアカウントの窓の余白。既定の窓は変えない。 */
  layout?: 'continuous' | 'account-inset'
  /** 手順の帯。本文のスクロールから独立させる。 */
  steps?: ReactNode
  /** 手順の本文を閉じずに切り替える鍵。StepsのcurrentKeyは自動で読む。 */
  stepKey?: string | number
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
  /** 入力の誤りがある欄など、開いた窓のフォーカス先。省けば従来どおり。 */
  initialFocusId?: string
  dirty?: boolean
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
  footerAlign?: 'center' | 'start'
  /** 絵で操作の間隔が指定されている窓だけに使う。 */
  designFooterGap?: number
}

/** Pencil V6 `J6x4Q` と重要操作 `H2S1T4` を1つにした共通ダイアログ。 */
export default function Dialog({
  open,
  size = 'medium',
  designWidth,
  widthPreset,
  designLayout,
  confirmFirst,
  designTop,
  designHeaderPadding,
  designHeaderHeight,
  designContentPadding,
  designFooterPadding,
  footerDivider = true,
  footerLeadFlexible = true,
  titleHelp,
  layout,
  steps,
  stepKey,
  footerLead,
  title,
  description,
  tone = 'default',
  descriptionBand,
  dirty,
  busy: providedBusy,
  initialFocusId,
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
  designFooterGap,
}: DialogProps) {
  const [automaticBusy, setAutomaticBusy] = useState(false)
  const [automaticError, setAutomaticError] = useState('')
  const automaticLock = useRef(false)
  const automaticGeneration = useRef(0)
  useEffect(() => {
    if (open) return
    automaticGeneration.current += 1
    automaticLock.current = false
    setAutomaticBusy(false)
    setAutomaticError('')
  }, [open])
  const busy = providedBusy ?? automaticBusy
  const runConfirm = onConfirm ? () => {
    if (busy || automaticLock.current) return
    const pending = onConfirm() as unknown
    if (providedBusy !== undefined || !pending || typeof (pending as PromiseLike<unknown>).then !== 'function') return
    const generation = automaticGeneration.current
    automaticLock.current = true
    setAutomaticBusy(true)
    setAutomaticError('')
    void Promise.resolve(pending).catch(() => {
      if (generation === automaticGeneration.current) setAutomaticError('実行できませんでした。もう一度お試しください。')
    }).finally(() => {
      if (generation !== automaticGeneration.current) return
      automaticLock.current = false
      setAutomaticBusy(false)
    })
  } : undefined
  const formInput = useFormInputDirty(open)
  const isDirty = dirty ?? (confirmation ? false : formInput.dirty)
  const discard = useOverlayDiscard(open, isDirty, busy, onCancel)
  const depth = useContext(OverlayDepthContext)
  const titleId = useId()
  const descriptionId = useId()
  const [mounted, setMounted] = useState(false)
  const motion = useStepMotion(Boolean(steps) && open && mounted, stepKey ?? (React.isValidElement<{ currentKey?: string | number }>(steps) ? steps.props.currentKey : undefined))
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
    discard.requestClose,
    busy,
    // 主が取消の窓は、開いた直後の標的を主のボタンへ寄せる。Enter を押しても
    // 残る方が動く向きにする（×と背景は従来どおり取消）。
    initialFocusId ? () => document.getElementById(initialFocusId)
      : primaryAction === 'cancel' ? () => cancelRef.current : undefined,
  )
  const confirmationSizeClass = confirmation && compact
    ? tone === 'destructive'
      ? styles.destructiveConfirmation
      : styles.compactConfirmation
    : ''

  useEffect(() => setMounted(true), [])
  if (!open && !leaving) return null

  const titleNode = (
    <h2 id={titleId} className={`${styles.title} ${tone === 'destructive' ? styles.destructiveTitle : styles.standardTitle}`}>{typeof title === 'string' && tone === 'destructive' && isDeleteConfirmation(confirmLabel) ? normalizeDeleteTitle(title) : title}</h2>
  )
  /* YZ57z 解除の桃箱は「題は箱の外・説明だけ箱の中」のため、題と説明を分けておく。
     かけらは描画に出ない（囲み要素なし）。渡さないときは h2 そのまま。 */
  const titlePart = (<>{titleIcon ? (
    <div className={styles.titleRow}>
      <span className={styles.titleIcon} aria-hidden="true">{titleIcon}</span>
      {titleNode}
      {titleHelp}
    </div>
  ) : titleHelp ? <div className={styles.titleRow}>{titleNode}{titleHelp}</div> : titleNode}</>)
  const descriptionNode = description ? <p id={descriptionId} className={styles.description}>{description}</p> : null
  const heading = (
    <>
      {/* 絵が無いときは今までどおり h2 を直接置く。囲むと既存の余白が動く。 */}
      {titlePart}
      {designLayout === 'stacked' ? null : descriptionNode}
    </>
  )
  const panel = (
    <div
      ref={(element) => { panelRef.current = element; formInput.ref.current = element }}
      onChangeCapture={formInput.onChangeCapture}
      onInputCapture={formInput.onChangeCapture}
      onClickCapture={formInput.onClickCapture}
      className={`${styles.panel} ${styles.standardPanel} ${confirmation ? styles.confirmationPanel : ''} ${confirmationSizeClass}`}
      role={tone === 'destructive' ? 'alertdialog' : 'dialog'}
      aria-modal={modal || undefined}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      aria-busy={busy || undefined}
      tabIndex={-1}
      data-closing={leaving || undefined}
      data-size={size}
      data-design-layout={designLayout}
      data-confirm-first={confirmFirst || undefined}
      data-layout={layout}
      data-footer-align={footerAlign}
      data-design-footer-gap={designFooterGap !== undefined || undefined}
      data-footer-divider={footerDivider ? undefined : 'none'}
      data-footer-lead={footerLeadFlexible ? undefined : 'fixed'}
      data-design-width=""
      data-design-header-padding={designHeaderPadding ? '' : undefined}
      data-design-header-height={designHeaderHeight ? '' : undefined}
      data-design-content-padding={designContentPadding ? '' : undefined}
      style={({
        ...(designFooterGap !== undefined ? { '--dialog-footer-gap': `${designFooterGap}px` } : {}),
        '--dialog-design-width': `${widthPreset === 'picker' ? 640 : dialogWidth((designWidth === 600 ? 560 : designWidth === 844 ? 720 : designWidth) ?? ({ small: 480, medium: 560, large: 720, wide: 960 } as const)[size])}px`,
        ...(designHeaderPadding ? { '--dialog-design-header-padding': designHeaderPadding } : {}),
        ...(designHeaderHeight ? { '--dialog-design-header-height': `${designHeaderHeight}px` } : {}),
        ...(designContentPadding ? { '--dialog-design-content-padding': designContentPadding } : {}),
        ...(designFooterPadding ? { '--dialog-design-footer-padding': designFooterPadding } : {}),
      } as CSSProperties)}
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
        <IconButton aria-label="閉じる" title="閉じる" className={styles.close} onClick={discard.requestClose} disabled={busy}>
          <X aria-hidden="true" size={18} />
        </IconButton>
      </div>
      {designLayout === 'stacked' ? descriptionNode : null}
      {steps ? <div className={styles.steps}>{steps}</div> : null}
      {children ? <div className={styles.content} ref={motion.outerRef}>{steps ? <div ref={motion.innerRef} data-step-content>{children}</div> : children}</div> : null}
      {error || automaticError ? <p className={styles.error} role="alert">{error || automaticError}</p> : null}
      <div className={styles.footer} onClickCapture={(event) => {
        const button = (event.target as Element).closest?.('button')
        if (isDirty && button && /^(閉じる|キャンセル)$/.test(button.textContent?.trim() ?? '')) {
          event.preventDefault(); event.stopPropagation(); discard.requestClose()
        }
      }}>
      {footer != null ? (layout === 'account-inset' ? <div className={styles.insetActions}>{footer}</div> : footer) : (onConfirm ? (
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
            onClick={discard.requestClose}
            disabled={busy}
          >
            {cancelLabel}
          </Button>
          <Button
            data-dialog-action={primaryAction === 'cancel' ? 'secondary' : tone === 'destructive' ? 'danger' : 'primary'}
            variant={primaryAction === 'cancel' ? 'secondary' : tone === 'destructive' ? 'danger' : 'primary'}
            className={styles.designButton}
            onClick={runConfirm}
            disabled={busy || confirmDisabled} busy={busy} busyLabel="処理中…">
            {!busy && confirmIcon ? <span className={styles.buttonIcon} aria-hidden="true">{confirmIcon}</span> : null}
            {tone === 'destructive' && isDeleteConfirmation(confirmLabel) ? '削除する' : confirmLabel}
          </Button>
        </div>
      ) : null)}
      </div>
    </div>
  )

  const discardDialog = discard.confirming ? <Dialog open={discard.confirming} title="入力を破棄しますか？" description="保存していない入力が消えます。" primaryAction="cancel" cancelLabel="編集を続ける" confirmLabel="破棄する" onCancel={discard.continueEditing} onConfirm={discard.discard} busy={busy} confirmation compact /> : null
  if (!modal) return <OverlayDepthContext.Provider value={depth + 1}>{panel}{discardDialog}</OverlayDepthContext.Provider>
  const overlay = (
    <div className={`${styles.overlay} ${confirmation && compact ? styles.confirmationOverlay : ''}`} role="presentation" data-closing={leaving || undefined} data-design-node={designNode} data-design-top={designTop ? '' : undefined} style={designTop ? ({ '--dialog-design-top': `${designTop}px` } as CSSProperties) : undefined} onMouseDown={(event) => {
      if (!busy && event.target === event.currentTarget) discard.requestClose()
    }}>
      {panel}
    </div>
  )
  return <OverlayDepthContext.Provider value={depth + 1}>{discardDialog}{mounted && typeof document !== 'undefined' ? createPortal(overlay, document.body) : overlay}</OverlayDepthContext.Provider>
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
