'use client'

/*
 * ★V8 権限なし（板 `O5tUeE`）。
 * API が 403 を返したときに出す共通の板。V8 のときだけ呼ぶ。
 * v7 の権限案内（各画面の ListState）は変えない。
 *
 * 役割の仕組みは作らない。いまの役割・要る役割・管理者名は、
 * 呼ぶ側が知っている表示名だけを渡す。知らない欄は出さない
 * （分からない役割を断定しない）。
 * 戻り先はダッシュボードが既定。画面の中へ戻るときは onBack を渡す。
 */
import { Lock } from 'lucide-react'
import Button from '@/components/shared/button'
import styles from './no-permission-v8.module.css'

export type NoPermissionV8Props = {
  /** 機能名。「○○を開く権限がありません」になる。 */
  featureName: string
  /** いまの役割の表示名（例：担当者）。分からなければ出さない。 */
  roleLabel?: string | null
  /** 要る役割の表示名（例：運用）。分からなければ出さない。 */
  requiredRoleLabel?: string | null
  /** 頼む管理者の表示名。分からなければ出さない。 */
  adminName?: string | null
  /** 役割でできることを見る口。無い画面へ送らないため、あるときだけ出す。 */
  capabilitiesHref?: string | null
  /** 戻るボタンの文言。既定はダッシュボードへ戻る。 */
  backLabel?: string
  /** 戻り先。既定はダッシュボード。画面の中へ戻るときは onBack を使う。 */
  backHref?: string
  /** 渡すと href の代わりに押したときの動きになる。 */
  onBack?: () => void
}

export default function NoPermissionV8({
  featureName,
  roleLabel,
  requiredRoleLabel,
  adminName,
  capabilitiesHref,
  backLabel = 'ダッシュボードへ戻る',
  backHref = '/',
  onBack,
}: NoPermissionV8Props) {
  const requiredPart = requiredRoleLabel
    ? `${featureName}は「${requiredRoleLabel}」以上の役割で使えます。`
    : ''
  return (
    <div data-design-node="O5tUeE" className={styles.board}>
      <h1 className={styles.headTitle}>{featureName}</h1>
      <p className={styles.headDescription}>この機能は、あなたの役割では開けません。</p>

      <div className={styles.card}>
        <span className={styles.lockWrap} aria-hidden="true">
          <Lock size={20} />
        </span>
        <p className={styles.title}>{featureName}を開く権限がありません</p>
        <p className={styles.description}>
          {roleLabel ? `いまの役割は「${roleLabel}」です。` : 'この画面を開く権限がありません。'}
          {requiredPart}
          必要なら、管理者に役割の変更を頼んでください。
        </p>
        {roleLabel || adminName ? (
          <p className={styles.roleRow}>
            {roleLabel ? (
              <>
                <span>いまの役割</span>
                <span className={styles.roleBadge}>{roleLabel}</span>
              </>
            ) : null}
            {adminName ? <span>管理者：{adminName}</span> : null}
          </p>
        ) : null}
        <div className={styles.actions}>
          {capabilitiesHref ? (
            <Button type="button" variant="secondary" href={capabilitiesHref}>
              役割でできることを見る
            </Button>
          ) : null}
          {onBack ? (
            <Button type="button" variant="primary" onClick={onBack}>
              {backLabel}
            </Button>
          ) : (
            <Button type="button" variant="primary" href={backHref}>
              {backLabel}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
