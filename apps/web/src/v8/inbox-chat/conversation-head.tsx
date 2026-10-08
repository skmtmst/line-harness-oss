'use client'

/*
 * ★V8 会話の頭（M0393 XqSvX「会話の頭」）。LINE の会話もメールの会話も同じ形にする
 * （オーナー指摘：メールと LINE で頭の形がばらばら）。
 *
 *   顔28・名前15/600・その下に補足（LINE・2時間前／メール・件名）
 *   右に ☆（LINE だけ）・担当：名前 ⌄・● 対応状況 ⌄・🔍（LINE だけ）・右の列の出し入れ
 */
import { useState, type ReactNode } from 'react'
import { ChevronLeft, PanelRight, Search, Star } from 'lucide-react'
import type { OperatorOption } from '@/components/chats/inbox-dropdown'
import Avatar from '@/components/shared/avatar'
import { HeadOperatorMenu, HeadStatusMenu, type HeadStatus } from './head-menus'
import styles from './inbox-chat.module.css'

export default function ConversationHead({
  name,
  pictureUrl,
  sub,
  subTitle,
  onBack,
  attention,
  operator,
  status,
  search,
  panel,
  extra,
}: {
  name: string
  pictureUrl?: string | null
  /** 名前の下の1行（LINE・2時間前／メール・件名） */
  sub: string
  subTitle?: string
  /** 狭い幅で一覧へ戻る */
  onBack?: () => void
  attention?: { on: boolean; saving: boolean; onToggle: () => void }
  operator: { value: string; operators: OperatorOption[]; onChange: (next: string) => void }
  status: { value: HeadStatus; onChange: (next: HeadStatus) => void }
  search?: { open: boolean; onToggle: () => void }
  panel?: { open: boolean; onToggle: () => void }
  /** 頭の右端の前に足すもの（あれば） */
  extra?: ReactNode
}) {
  const [nameExpanded, setNameExpanded] = useState(false)
  return (
    <div className={styles.chead} data-inbox-v8="conversation-head">
      <div className={styles.cheadWho}>
        {onBack ? (
          <button type="button" className={`${styles.cheadBack} lg:hidden`} aria-label="戻る" onClick={onBack}>
            <ChevronLeft aria-hidden="true" />
          </button>
        ) : null}
        {/* 顔は共通の Avatar（一覧の行と同じ色・頭文字の決まり）。 */}
        <Avatar name={name} src={pictureUrl} size={28} />
        <div className={styles.cheadText}>
          <button
            type="button"
            className={styles.cheadName}
            title={name}
            aria-expanded={nameExpanded}
            onClick={() => setNameExpanded((now) => !now)}
          >
            {name}
          </button>
          <p className={styles.cheadSub} title={subTitle ?? sub}>{sub}</p>
        </div>
      </div>
      <div className={styles.cheadTools}>
        {attention ? (
          <button
            type="button"
            className={`${styles.cheadSquare} ${styles.cheadStar}`}
            aria-label={attention.on ? '注目から外す' : '注目にする'}
            aria-pressed={attention.on}
            disabled={attention.saving}
            onClick={attention.onToggle}
          >
            <Star aria-hidden="true" fill={attention.on ? 'currentColor' : 'none'} />
          </button>
        ) : null}
        <HeadOperatorMenu value={operator.value} operators={operator.operators} onChange={operator.onChange} />
        <HeadStatusMenu value={status.value} onChange={status.onChange} />
        {extra}
        {panel ? (
          <button
            type="button"
            className={styles.cheadSquare}
            data-inbox-v6="customer-info-toggle"
            aria-expanded={panel.open}
            onClick={panel.onToggle}
          >
            <PanelRight aria-hidden="true" />
            <span className="sr-only">{panel.open ? '顧客情報を閉じる' : '顧客情報を表示'}</span>
          </button>
        ) : null}
      </div>
      {/*
        ★V8：絵（eovoG）の頭は ☆・担当・対応状況・右の列の出し入れの4つ。🔍 を同じ段に置くと
        担当・対応状況が左へ44ずれるので、頭の下の右端に重ねて浮かせる（⌘F でも開く）。
        探す帯が開いている間は帯の「探すのをやめる」で閉じるので隠す。
      */}
      {search ? (
        <button
          type="button"
          className={`${styles.cheadSquare} ${styles.cheadSearch}`}
          data-design-node="bvHXu"
          aria-label="会話の中を探す（⌘F）"
          aria-expanded={search.open}
          onClick={search.onToggle}
        >
          <Search aria-hidden="true" />
        </button>
      ) : null}
    </div>
  )
}
