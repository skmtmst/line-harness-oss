'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { api, type Recipe } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import { usePageTitle } from '@/components/shell/page-chrome'
import ListState from '@/components/shared/list-state'
import PageHeader from '@/components/shared/page-header'
import StatusBadge from '@/components/shared/status-badge'
import {
  apiRecipeRequirements,
  featureLabel,
} from './recipe-catalog'
import styles from './recipes.module.css'

/**
 * 設計 ★V6 34-2「レシピ一覧」（`y0P0Qx`）。
 *
 * レシピ・必要機能・複製回数はサーバの正本を読む。
 */
export default function RecipesPage() {
  usePageTitle('レシピ')
  const { selectedAccountId, loading: accountLoading } = useAccount()
  const [recipes, setRecipes] = useState<Recipe[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')

  useEffect(() => {
    if (accountLoading) return
    let alive = true
    setStatus('loading')
    void api.recipes
      .list(selectedAccountId ?? undefined)
      .then((res) => {
        if (!alive) return
        if (!res.success) {
          setStatus('error')
          return
        }
        setRecipes(res.data)
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

      {status !== 'ready' ? (
        <ListState kind={status === 'error' ? 'error' : 'loading'} />
      ) : recipes.length === 0 ? (
        <ListState
          kind="empty"
          title="使えるレシピがありません"
          description="レシピが追加されるまでお待ちください。"
        />
      ) : (
        <ul className={styles.list} aria-label="レシピ">
            {recipes.map((recipe) => {
              const requirements = apiRecipeRequirements(recipe)
              const missingLabels = recipe.missingFeatures.map(featureLabel)
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
                        {requirements.map((requirement) => {
                          return (
                            <StatusBadge
                              key={requirement.key ?? 'friend-attributes'}
                              tone={requirement.on ? 'neutral' : 'warning'}
                              size="compact"
                            >
                              {requirement.on ? requirement.label : `${requirement.label}（オフ）`}
                            </StatusBadge>
                          )
                        })}
                      </span>
                    </div>
                    <p className={styles.count}>これまで {recipe.cloneCount} 回作られました</p>
                  </div>

                  <div className={styles.actions}>
                    {recipe.missingFeatures.length === 0 ? (
                      <Link href={`/recipes/clone?id=${encodeURIComponent(recipe.id)}`} className={styles.primary}>
                        このレシピで作る
                      </Link>
                    ) : (
                      <span className={styles.blocked}>機能をオンにしてから</span>
                    )}
                    <Link href={`/recipes/clone?id=${encodeURIComponent(recipe.id)}`} className={styles.secondary}>
                      中身を見る
                    </Link>
                    {missingLabels.length > 0 ? (
                      <p className={styles.reason}>
                        「機能設定」で{missingLabels.join('と')}をオンにすると使えます
                      </p>
                    ) : null}
                  </div>
                </li>
              )
            })}
          </ul>
      )}
    </div>
  )
}
