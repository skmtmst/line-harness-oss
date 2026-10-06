'use client'

import React, { type ReactNode } from 'react'
import { CircleCheck, Trash2, TriangleAlert } from 'lucide-react'
import Dialog from './dialog'

interface ConfirmDialogProps {
  open: boolean
  title: string
  description: string
  confirmLabel?: string
  cancelLabel?: string
  destructive?: boolean
  /**
   * 説明文を琥珀帯で囲む（CFAyf 送受信を止める）。
   * destructive（赤い題・ボタン）とは独立に使える。
   */
  warning?: boolean
  /**
   * 説明文を桃箱で囲む（YZ57z 解除。題は箱の外・説明だけ箱の中）。
   * destructive（赤い題・ボタン）とは独立に使える。
   */
  dangerBand?: boolean
  busy?: boolean
  error?: string
  /**
   * 押す前に読み合わせる中身。
   *
   * **確認は「はい／いいえ」だけでは足りないことがある。** 一斉配信の
   * 最終確認は、対象人数・配信日時・送る中身を並べてから決める
   * （設計 `FpgxH`）。`Dialog` はもともと受け取れるので、素通しにする。
   */
  children?: ReactNode
  /** 見出しの左に置く絵。危険な操作は警告、と一目で分かるようにする。 */
  titleIcon?: ReactNode
  /** 実行ボタンの中、文字の左に置く絵。 */
  confirmIcon?: ReactNode
  /** この確認画面に対応するPencilの実Node。 */
  designNode?: string
  /** ★V8：絵の窓の頭の余白（Dialog の designHeaderPadding と同じ）。渡さなければ今までどおり。 */
  designHeaderPadding?: string
  /** ★V8：絵の窓の頭の高さ px（Dialog の designHeaderHeight と同じ）。渡さなければ今までどおり。 */
  designHeaderHeight?: number
  /** ★V8：絵の窓の幅 px（Dialog の designWidth と同じ）。 */
  designWidth?: number
  /** ★V8：絵の窓の上からの位置 px（Dialog の designTop と同じ）。 */
  designTop?: number
  /**
   * 主にする操作。`'cancel'` は取消（残る方）を主の緑にし、実行を枠線にする。
   * 未保存の離脱確認で使い、うっかり Enter や緑で入力が消える向きにしない。
   * 印も付けない（緑のチェックは「完了・成功」の意味のため）。
   */
  primaryAction?: 'confirm' | 'cancel'
  /**
   * `undefined` を渡すと**確認のボタンそのものが出ない**（`Dialog` の作り）。
   * 数えられていない人数のまま送らせない、といった止め方に使う。
   */
  onConfirm?: () => void
  onCancel: () => void
}

/** ブラウザ標準 confirm の代わりに使う、管理画面共通の確認ダイアログ。 */
export default function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = '実行する',
  cancelLabel = 'キャンセル',
  destructive = false,
  warning = false,
  dangerBand = false,
  busy = false,
  error,
  children,
  titleIcon,
  confirmIcon,
  designNode,
  designHeaderPadding,
  designHeaderHeight,
  designWidth,
  designTop,
  primaryAction = 'confirm',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  /*
   * 未保存の離脱確認（主が取消）は印を付けない。緑のチェックは
   * 「完了・成功」の意味なので、まだ何も済んでいない窓には出さない。
   * 危険な操作の警告印は従来どおり残す。
   */
  const shownTitleIcon = titleIcon ?? (primaryAction === 'cancel'
    ? undefined
    : destructive
      ? <TriangleAlert size={22} />
      : <CircleCheck size={22} />)
  const shownConfirmIcon = confirmIcon ?? (destructive ? <Trash2 size={16} /> : undefined)

  return (
    <Dialog
      open={open}
      title={title}
      description={description}
      tone={destructive ? 'destructive' : 'default'}
      descriptionBand={dangerBand ? 'danger' : warning ? 'warning' : undefined}
      confirmLabel={confirmLabel}
      cancelLabel={cancelLabel}
      busy={busy}
      error={error}
      primaryAction={primaryAction}
      titleIcon={shownTitleIcon}
      confirmIcon={shownConfirmIcon}
      designNode={designNode}
      designHeaderPadding={designHeaderPadding}
      designHeaderHeight={designHeaderHeight}
      designWidth={designWidth}
      designTop={designTop}
      confirmation
      compact={!children}
      onConfirm={onConfirm}
      onCancel={onCancel}
    >
      {children}
    </Dialog>
  )
}
