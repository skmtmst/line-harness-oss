/*
 * LINEプレビュー（★V7 の共通部品、B-6）。
 *
 * 自動応答・一斉配信・リマインダ・テンプレート・ウェビナー・イベント・
 * リッチメニュー・友だち追加・予約で割れていた枠（青い地・緑の枠・
 * 濃い緑・白）を、LINE のトーク画面に近い1つの見た目にそろえる。
 * 地はトーク背景色（`bg-line-talk`）、題は「LINEプレビュー」。
 *
 * 中身（吹き出し・カード・ボタン）は各画面の描き方をそのまま `children`
 * で渡す。枠だけが共通。届く日時の札など動く情報は `caption` で見える
 * まま残し、静かな説明だけ `note`（題の横の？）へ入れる。失敗・警告・
 * 数字そのものは ? に入れない（共通ルール 2-1b）。
 *
 * 見た目はトークンのユーティリティだけで組む。V8 の枠の上書きだけ
 * `line-preview.module.css`（`[data-theme='v8']` の下）に置く。
 * 幅・高さ・配置は呼び出し側が包んで渡す（部品は幅を持たない）。
 */
import type { ReactNode } from 'react'
import { BatteryFull, ChevronDown, ChevronLeft, Menu, Phone, Search, Signal, Wifi } from 'lucide-react'
import HelpTip from './help-tip'
import styles from './line-preview.module.css'

export interface LinePreviewProps {
  /** 枠の中身。各画面の吹き出し・カードをそのまま渡す。 */
  children?: ReactNode
  /**
   * 題の下に見える札。届く日時・件数など、その場で見せたい情報。
   * 動く内容なので ? には入れず、見えるまま残す。
   */
  caption?: ReactNode
  /** 静かな説明だけ。題の横の？に入り、本文には出さない。 */
  note?: string
  /** 送り主の表示名（分かっている画面だけ渡す）。 */
  accountName?: string
  /**
   * まだ中身が無いとき。`true` なら `children` を空の箱で出し、
   * 文字ならその文を空の箱で出す。
   */
  empty?: boolean | string
}

export default function LinePreview({
  children,
  caption,
  note,
  accountName,
  empty = false,
}: LinePreviewProps) {
  return (
    <>
      <section aria-label="LINEプレビュー" className={`${styles.frame} v7-only rounded-card bg-line-talk p-4`}>
        <p className="flex items-center justify-center gap-1.5 text-center text-sm font-bold text-ink">
          <span>LINEプレビュー</span>
          {note ? <HelpTip label="LINEプレビューの説明">{note}</HelpTip> : null}
        </p>
        {accountName ? <p className="mt-0.5 text-center text-xs text-ink-secondary">{accountName}</p> : null}
        {caption ? (
          <p className="mt-2 flex justify-center">
            <span className="inline-flex items-center gap-1 rounded-pill bg-canvas px-3 py-1 text-xs font-semibold text-ink">{caption}</span>
          </p>
        ) : null}
        {typeof empty === 'string' ? (
          <div className="border-ink-secondary mt-3 rounded-control border border-dashed p-7 text-center text-xs leading-relaxed whitespace-pre-wrap text-ink">{empty}</div>
        ) : empty ? (
          <div className="border-ink-secondary mt-3 rounded-control border border-dashed p-7 text-center text-xs leading-relaxed whitespace-pre-wrap text-ink">{children}</div>
        ) : (
          <div className="mt-3">{children}</div>
        )}
      </section>
      {/*
        ★V8（夕15・cfVyj）：本物のスマホの枠 330×690。題は外の上、
        届く日時はトークの中の日付の札の位置、中身はトークの中だけが
        縦に送れる。見た目は line-preview.module.css の v8 節に集める。
      */}
      <section aria-label="LINEプレビュー" className={`${styles.phoneRoot} v8-only`}>
        <p className={styles.phoneTitle}>
          <span>LINEプレビュー</span>
          {note ? <HelpTip label="LINEプレビューの説明">{note}</HelpTip> : null}
        </p>
        <div className={styles.phone}>
          <div className={styles.screen}>
            <div className={styles.statusBar}>
              <span className={styles.clock}>9:41</span>
              <span className={styles.island} aria-hidden="true" />
              <span className={styles.statusIcons}>
                <Signal size={15} strokeWidth={1.8} aria-hidden="true" />
                <Wifi size={15} strokeWidth={1.8} aria-hidden="true" />
                <BatteryFull size={20} strokeWidth={1.8} aria-hidden="true" />
              </span>
            </div>
            <div className={styles.talkHead}>
              <ChevronLeft size={20} aria-hidden="true" />
              <span className={styles.talkName}>{accountName ?? '公式アカウント'}</span>
              <Search size={17} aria-hidden="true" />
              <Phone size={17} aria-hidden="true" />
              <Menu size={17} aria-hidden="true" />
            </div>
            <div className={styles.talk}>
              <p className={styles.dateChip}><span>{caption ?? '今日'}</span></p>
              {empty ? (
                <p className={styles.emptyNote}>
                  {typeof empty === 'string' ? empty : children}
                </p>
              ) : (
                children
              )}
            </div>
            <div className={styles.menuBar}>
              <span>メニュー</span>
              <ChevronDown size={12} aria-hidden="true" />
            </div>
            <div className={styles.homeBar}><span className={styles.homeLine} aria-hidden="true" /></div>
          </div>
        </div>
      </section>
    </>
  )
}
