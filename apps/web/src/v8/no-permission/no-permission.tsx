'use client'

/*
 * ★V8 権限なし（板 `O5tUeE`）。画面の一覧の口が 403 を返したときに、画面ごとこれに替える。
 * 題（機能名）と一行の説明、板の真ん中に鍵の札。いまの役割・要る役割・管理者名は、
 * 呼ぶ側が知っている表示名だけを渡す（分からない役割を断定しない）。
 * app/no-permission/no-permission-v8.tsx（一覧の中に置く版）を写して、板全体の形にした。
 */
import { BookOpen, CircleHelp, Lock } from 'lucide-react'
import Button from '@/components/shared/button'
import styles from './no-permission.module.css'

export type NoPermissionBoardProps = {
  /** 機能名。題と「○○を開く権限がありません」になる。 */
  featureName: string
  /** いまの役割の表示名。分からなければ出さない。 */
  roleLabel?: string | null
  /** 要る役割の表示名。分からなければ出さない。 */
  requiredRoleLabel?: string | null
  /** 頼む管理者の表示名。分からなければ出さない。 */
  adminName?: string | null
  /** 役割でできることを見る口。あるときだけ出す。 */
  capabilitiesHref?: string | null
  /** 戻り先。既定はダッシュボード。 */
  backHref?: string
  backLabel?: string
}

export default function NoPermissionBoard({
  featureName,
  roleLabel,
  requiredRoleLabel,
  adminName,
  capabilitiesHref,
  backHref = '/',
  backLabel = 'ダッシュボードへ戻る',
}: NoPermissionBoardProps) {
  return (
    <div data-design-node="O5tUeE" className={styles.board}>
      <div className={styles.head}>
        <h1 className={styles.title}>{featureName}</h1>
        <p className={styles.description}>この機能は、あなたの役割では開けません。</p>
      </div>
      <div className={styles.center}>
        <section className={styles.card} role="alert">
          <span className={styles.lock} aria-hidden="true"><Lock size={24} /></span>
          <h2 className={styles.cardTitle}>{featureName}を開く権限がありません</h2>
          <p className={styles.cardText}>
            {roleLabel ? `いまの役割は「${roleLabel}」です。` : 'この画面を開く権限がありません。'}
            {requiredRoleLabel ? `${featureName}は「${requiredRoleLabel}」以上の役割で使えます。` : ''}
            必要なら、管理者に役割の変更を頼んでください。
          </p>
          {roleLabel || adminName ? (
            <p className={styles.roleRow}>
              {roleLabel ? <><span>いまの役割</span><span className={styles.roleBadge}>{roleLabel}</span></> : null}
              {adminName ? <span>{`管理者：${adminName}`}</span> : null}
            </p>
          ) : null}
          <div className={styles.actions}>
            {capabilitiesHref ? (
              <Button href={capabilitiesHref} variant="secondary"><BookOpen size={15} aria-hidden="true" />役割でできることを見る</Button>
            ) : null}
            <Button href={backHref} variant="primary"><CircleHelp size={15} aria-hidden="true" />{backLabel}</Button>
          </div>
        </section>
      </div>
    </div>
  )
}
