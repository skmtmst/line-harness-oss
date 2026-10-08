'use client'

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
 * v7 はトーク背景色のパネル、v8（夕15・cfVyj）は本物のスマホ 330×690。
 * 2つの枠を両方 DOM に置いて CSS で隠すと、同じ中身が2つ見えてしまう
 * （支援技術・画面の試験が両方を拾う）ので、`<html data-theme>` を読んで
 * 片方だけを描く。書き出された HTML も最初の描画も v7 で、data-theme が
 * v8 のブラウザだけスマホへ入れ替わる。設定画面でその場で切り替えた
 * ときは合図（ADMIN_THEME_CHANGED_EVENT）で追いかける。
 *
 * 見た目の上書きは `line-preview.module.css`（`[data-theme='v8']` の下
 * とスマホの節）に置く。幅・高さ・配置は呼び出し側が包んで渡す
 * （v7 の部品は幅を持たない）。
 */
import { useSyncExternalStore, type ReactNode } from 'react'
import { BatteryFull, ChevronDown, ChevronLeft, Menu, Phone, Search, Signal, Wifi } from 'lucide-react'
import HelpTip from './help-tip'
import { ADMIN_THEME_CHANGED_EVENT } from '@/lib/events'
import styles from './line-preview.module.css'

export interface LinePreviewProps {
  /** 枠の中身。各画面の吹き出し・カードをそのまま渡す。 */
  children?: ReactNode
  /** V8で画面が指定する題。nullなら外側の題だけを使う。 */
  title?: string | null
  /**
   * 題の下に見える札。届く日時・件数など、その場で見せたい情報。
   * 動く内容なので ? には入れず、見えるまま残す。
   * v8 のスマホではトークの中の日付の札の位置に出る。
   */
  caption?: ReactNode
  /** 静かな説明だけ。題の横の？に入り、本文には出さない。 */
  note?: string
  /** 送り主の表示名（分かっている画面だけ渡す）。v8 ではトーク頭の名前になる。 */
  accountName?: string
  /**
   * まだ中身が無いとき。`true` なら `children` を空の箱で出し、
   * 文字ならその文を空の箱で出す。
   */
  empty?: boolean | string
}

/** 設定画面でその場でテーマを切り替えたときの合図を受ける。 */
const subscribeTheme = (onChange: () => void) => {
  /*
   * 出来事を張れる窓が無い最小 DOM の試験環境では、切り替えの合図を
   * 受けられないので v7 のまま描く（書き出しと同じ扱い）。
   */
  if (typeof window.addEventListener !== 'function') return () => {}
  window.addEventListener(ADMIN_THEME_CHANGED_EVENT, onChange)
  return () => window.removeEventListener(ADMIN_THEME_CHANGED_EVENT, onChange)
}
const readIsV8 = () => document.documentElement?.getAttribute('data-theme') === 'v8'
/* 書き出し（SSR/書き出した静的HTML）は常に v7。ブラウザ側で v8 を読み直す。 */
const readIsV8OnServer = () => false

export default function LinePreview({
  children,
  title = 'LINEでの見え方',
  caption,
  note,
  accountName,
  empty = false,
}: LinePreviewProps) {
  const v8 = useSyncExternalStore(subscribeTheme, readIsV8, readIsV8OnServer)

  /*
   * ★V8（夕15・cfVyj）：本物のスマホの枠 330×690。題は外の上、
   * 届く日時はトークの中の日付の札の位置、中身はトークの中だけが
   * 縦に送れる。見た目は line-preview.module.css の v8 節に集める。
   */
  if (v8) {
    return (
      <section aria-label="LINEでの見え方" className={styles.phoneRoot}>
        {/* 題は列の左、スマホはその下の真ん中。テンプレートでは「届き方」や外側の題を使う。 */}
        {title !== null ? <p className={styles.phoneTitle}>
          <span>{title}</span>
          {note ? <HelpTip label="LINEでの見え方の説明">{note}</HelpTip> : null}
        </p> : null}
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
    )
  }

  return (
    <section aria-label="LINEプレビュー" className={`${styles.frame} rounded-card bg-line-talk p-4`}>
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
  )
}

/** cfVyj の受信メッセージ。日時・送り主・本文をそのまま渡す。 */
export function LinePreviewMessage({ accountName, avatar, time, children }: {
  accountName: string; avatar: ReactNode; time: string; children: ReactNode
}) {
  return <div className={styles.messageRow}>
    <span className={styles.senderAvatar}>{avatar}</span>
    <div className={styles.senderBody}>
      <span className={styles.senderName}>{accountName}</span>
      <div className={styles.bubbleRow}>
        <div className={styles.bubble}>
          <svg className={styles.tail} viewBox="0 0 10 8" aria-hidden="true"><path d="M8 0 0 6 10 8Z" fill="currentColor" /></svg>
          <div className={styles.bubbleBody}><span className={styles.bubbleText}>{children}</span></div>
        </div>
        <span className={styles.messageTime}>{time}</span>
      </div>
    </div>
  </div>
}

/** cfVyj の商品カード。操作は必ず呼び出し側から渡す。 */
export function LinePreviewCard({ imageUrl, title, description, price, time, actions }: {
  imageUrl: string; title: string; description: string; price: string; time: string;
  actions: Array<{ label: string; onClick: () => void; secondary?: boolean }>
}) {
  return <div className={styles.cardRow}>
    <div className={styles.productCard}>
      <div className={styles.productImage} role="img" aria-label={title} style={{ backgroundImage: `url(${JSON.stringify(imageUrl)})` }} />
      <div className={styles.productCopy}>
        <span className={styles.productTitle}>{title}</span>
        <span className={styles.productDescription}>{description}</span>
        <span className={styles.priceRow}><span className={styles.price}>{price}</span><span className={styles.tax}>税込</span></span>
      </div>
      {actions.map(action => <button key={action.label} type="button" className={`${styles.productAction} ${action.secondary ? styles.secondaryAction : ''}`} onClick={action.onClick}>{action.label}</button>)}
    </div>
    <span className={styles.messageTime}>{time}</span>
  </div>
}
