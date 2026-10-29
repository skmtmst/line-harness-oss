'use client'

import { useTenantName } from '@/lib/use-tenant-name'
import styles from './sidebar-identity.module.css'

/**
 * 共通メニューのいちばん上。統括名と製品名だけを表示する。
 *
 * ここには 2026-08-26 まで「現在のLINEアカウント」の切替カードがあった。
 * 切替は共通トップバーへ移したので、ここは**いまどの会社の管理画面を
 * 見ているか**だけを示す（Pencil `J33xq/V2WbXF`、`docs/v8-design-rules.md` §5）。
 *
 * 枠も影も付けない。カードにすると、下のメニューと同じ重さに見えて、
 * 押せるものだと読み違える。ここは押せない。
 */
export default function SidebarIdentity() {
  const name = useTenantName()
  return <SidebarBrand name={name} />
}

/** 取得処理を持たない共通の看板。運営では必要に応じて印も表示する。 */
export function SidebarBrand({ name, mark }: { name: string; mark?: string }) {
  return (
    <div className={`${styles.root} ${mark ? '' : styles.textOnly}`} data-design-node="J33xq/V2WbXF">
      {mark ? <span className={styles.mark} aria-hidden="true">{mark}</span> : null}
      <span className={styles.text}>
        <span className={styles.name} title={name}>{name}</span>
        <span className={styles.version}>musubo</span>
      </span>
    </div>
  )
}
