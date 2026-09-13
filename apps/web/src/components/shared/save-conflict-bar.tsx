'use client'

import Notice from './notice'
import styles from './save-conflict-bar.module.css'

export type SaveConflictBarProps = {
  /** 何が起きたか。利用者が次にすることまで含めた一文。 */
  message: string
  /** 出口の名前。省くとボタンを出さない。 */
  actionLabel?: string
  onAction?: () => void
  /** 実ブラウザ検査が掴むための目印。 */
  actionQa?: string
}

/**
 * 保存が弾かれたことを、**タブや覆いに関係なく**知らせる帯。
 *
 * 画面の中に書くと、タブで切り替わる側に入ってしまったり、覆い
 * （`aria-modal` のダイアログ）の下敷きになったりする。実際に回答フォームの
 * 編集画面では、409 の文言がデザイン設定タブでは DOM にも出ず、オプション
 * 設定タブでは覆いの下に隠れていた（#723 の独立審査）。**押した人は何も
 * 起きないので「保存された」と思って離れる。**
 *
 * 位置と重なりは `save-conflict-bar.module.css` が持つ。呼び出し側に
 * `z-[60]` を手書きさせると、共通部品を通らない直書きとして design-debt に
 * 数えられる。
 *
 * 見た目は共通の `Notice`（tone=error）をそのまま使う。独自の配色を作らない。
 *
 * **読み上げについて。**覆いが出ているあいだは `aria-modal` の外にあるため、
 * 読み上げソフトがここへ辿り着けないことがある。見えていることは実ブラウザ
 * 検査で確かめているが、読み上げでの到達は確かめていない。
 */
export default function SaveConflictBar({
  message,
  actionLabel,
  onAction,
  actionQa,
}: SaveConflictBarProps) {
  return (
    <div className={styles.bar} data-design-part="save-conflict-bar">
      <div className={styles.inner}>
        <Notice tone="error" message={message} className={styles.notice} />
        {actionLabel && onAction ? (
          <button type="button" onClick={onAction} data-qa={actionQa} className={styles.action}>
            {actionLabel}
          </button>
        ) : null}
      </div>
    </div>
  )
}
