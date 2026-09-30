'use client'

import { useEffect, useState } from 'react'
import { useBrand } from '@/lib/use-brand'
import { loadAdminVersion } from '@/lib/admin-version-cache'
import { isRealVersion } from '@/lib/deploy-info'
import styles from './sidebar-identity.module.css'

/**
 * 共通メニューのいちばん上。**アイコン ＋ 会社名 ＋ バージョン**だけ。
 *
 * ここには 2026-08-26 まで「現在のLINEアカウント」の切替カードがあった。
 * 切替は共通トップバーへ移したので、ここは**いまどの会社の管理画面を
 * 見ているか**だけを示す（Pencil `J33xq/V2WbXF`、`docs/v6-common-rules.md` §1）。
 *
 * 枠も影も付けない。カードにすると、下のメニューと同じ重さに見えて、
 * 押せるものだと読み違える。ここは押せない。
 */
/*
 * アイコンに出す1文字。会社名の頭が「株式会社」などの法人格だと、どの
 * 会社も同じ「株」になってしまうので、そこを外してから1文字目を取る。
 * 特定の契約先の名前は書かない。
 */
const CORPORATE_PREFIXES = [
  '一般社団法人', '一般財団法人', '公益社団法人', '公益財団法人',
  '特定非営利活動法人', '社会福祉法人', '医療法人', '学校法人', '宗教法人',
  '独立行政法人', '株式会社', '有限会社', '合同会社', '合名会社', '合資会社',
  '相互会社',
]

export function brandInitial(name: string): string {
  const trimmed = name.trim()
  for (const prefix of CORPORATE_PREFIXES) {
    if (trimmed.startsWith(prefix)) {
      const rest = trimmed.slice(prefix.length).trimStart()
      // 「株式会社」だけのときは外さない（空の丸になる）。
      if (rest) return [...rest][0]
    }
    if (trimmed.endsWith(prefix)) {
      const rest = trimmed.slice(0, -prefix.length).trimEnd()
      if (rest) return [...rest][0]
    }
  }
  return [...trimmed][0] ?? ''
}

export default function SidebarIdentity() {
  const brand = useBrand()
  const [version, setVersion] = useState('')

  useEffect(() => {
    let cancelled = false
    // 更新案内の帯と同じ版番号を共有する（2回取らない）。
    ;(async () => {
      try {
        const { version } = await loadAdminVersion()
        if (!cancelled && version) setVersion(version)
      } catch {
        // 取れなければ出さない。「Ver. -」のような穴埋めはしない。
      }
    })()
    return () => { cancelled = true }
  }, [])

  const name = brand.name || '管理画面'
  const initial = brandInitial(name)

  return (
    <div className={styles.root} data-design-node="J33xq/V2WbXF">
      <span className={styles.mark} aria-hidden="true">{initial}</span>
      <span className={styles.text}>
        <span className={styles.name} title={name}>{name}</span>
        {/* V8 では社名の下に製品名を出す（版の情報はメニューの一番下にある）。
            v7 では今までどおり版を出す。 */}
        <span className={`${styles.version} v8-only`}>LINE Harness</span>
        {isRealVersion(version) && <span className={`${styles.version} v7-only`}>Ver. {version.trim()}</span>}
      </span>
    </div>
  )
}
