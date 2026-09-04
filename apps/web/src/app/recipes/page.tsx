'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import { DEFAULT_FEATURES } from '@/lib/feature-settings'
import { usePageTitle } from '@/components/shell/page-chrome'
import ListState from '@/components/shared/list-state'
import NoteBar from '@/components/shared/note-bar'
import PageHeader from '@/components/shared/page-header'
import StatusBadge from '@/components/shared/status-badge'
import {
  CLONE_COUNT_UNAVAILABLE,
  RECIPES,
  recipeAction,
  requirementIsOn,
} from './recipe-catalog'
import styles from './recipes.module.css'

/**
 * 設計 ★V6 34-2「レシピ一覧」（`y0P0Qx`）。
 *
 * **複製する仕組みはまだ無い。**（`POST /api/recipes/{id}/clone`、台帳 #134）
 * 数を作って「作れます」と見せず、押せない理由を出して止める。
 * 中身（作られるもの）は静的な見本なので、先に見せられる。
 */
const CLONE_API_READY = false

export default function RecipesPage() {
  usePageTitle('レシピ')
  const { selectedAccountId, loading: accountLoading } = useAccount()
  const [features, setFeatures] = useState<Record<string, boolean> | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')

  useEffect(() => {
    if (accountLoading) return
    if (!selectedAccountId) {
      setFeatures(DEFAULT_FEATURES)
      setStatus('ready')
      return
    }
    let alive = true
    setStatus('loading')
    void api.featureSettings
      .get(selectedAccountId)
      .then((res) => {
        if (!alive) return
        if (!res.success) {
          setStatus('error')
          return
        }
        setFeatures({ ...DEFAULT_FEATURES, ...res.data.features })
        setStatus('ready')
      })
      .catch(() => {
        if (alive) setStatus('error')
      })
    return () => {
      alive = false
    }
  }, [accountLoading, selectedAccountId])

  return (
    <div className={styles.page}>
      <PageHeader
        breadcrumb={[{ label: 'レシピ' }]}
        title="レシピから作る"
        description="よくある組み立てを、まとめて下書きにします。作られるのは、ふつうのタグ・ルール・シナリオ・テンプレートです。レシピとはつながらないので、あとから自由に直せます。公開はひとつずつ自分で行います。"
      />

      {status !== 'ready' || !features ? (
        <ListState kind={status === 'error' ? 'error' : 'loading'} />
      ) : (
        <>
          {!CLONE_API_READY ? (
            <NoteBar tone="warn">
              いまはレシピの中身を見るところまでです。まとめて下書きを作る仕組みは、まだ入っていません。
            </NoteBar>
          ) : null}

          <ul className={styles.list} aria-label="レシピ">
            {RECIPES.map((recipe) => {
              const action = recipeAction(recipe, features, CLONE_API_READY)
              return (
                <li key={recipe.id} className={styles.card}>
                  <div className={styles.body}>
                    <h2 className={styles.name}>{recipe.name}</h2>
                    <p className={styles.purpose}>{recipe.purpose}</p>
                    <p className={styles.line}>
                      <span className={styles.label}>作られるもの：</span>
                      {recipe.creates}
                    </p>
                    <div className={styles.line}>
                      <span className={styles.label}>必要な機能：</span>
                      <span className={styles.requirements}>
                        {recipe.requirements.map((r) => {
                          const on = requirementIsOn(r, features)
                          return (
                            <StatusBadge
                              key={r.label}
                              tone={on ? 'neutral' : 'warning'}
                              size="compact"
                            >
                              {on ? r.label : `${r.label}（オフ）`}
                            </StatusBadge>
                          )
                        })}
                      </span>
                    </div>
                    <p className={styles.count}>{CLONE_COUNT_UNAVAILABLE}</p>
                  </div>

                  <div className={styles.actions}>
                    {action.href ? (
                      <Link href={action.href} className={styles.primary}>
                        {action.label}
                      </Link>
                    ) : (
                      <span className={styles.blocked}>{action.label}</span>
                    )}
                    <Link href={`/recipes/clone?id=${encodeURIComponent(recipe.id)}`} className={styles.secondary}>
                      中身を見る
                    </Link>
                    {action.reason ? <p className={styles.reason}>{action.reason}</p> : null}
                  </div>
                </li>
              )
            })}
          </ul>
        </>
      )}
    </div>
  )
}
