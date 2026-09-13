'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Suspense, useEffect, useState } from 'react'
import { api, type Recipe } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import { usePageTitle } from '@/components/shell/page-chrome'
import ListState from '@/components/shared/list-state'
import SelectField from '@/components/shared/select-field'
import StatusBadge from '@/components/shared/status-badge'
import StickyBar from '@/components/shared/sticky-bar'
import { TextField } from '@/components/shared/text-field'
import { Field } from '@/components/shared/form-controls'
import { CareCard } from '@/components/shared/side-cards'
import {
  CARE_ITEMS,
  ITEMS_UNDECIDED_NOTE,
  apiRecipeFeatureSummary,
  apiRecipeRequirements,
  apiRecipeRest,
  createButtonLabel,
  prefixedName,
} from '../recipe-catalog'
import styles from './clone.module.css'

/** 設計 ★V6 34-3「レシピを複製する」（`D5UaX`）。 */
function RecipeClone() {
  /*
    **`[recipeId]` は使えない。** 静的書き出し（`output: 'export'`）なので
    ビルド時に全IDが分からない動的セグメントは書き出せない
    （`route-integrity.test.ts`）。ほかの画面と同じく `?id=` で表す。
    要件 §5-3 の `/recipes/{recipeId}/clone` はこの形に読み替える。
  */
  const search = useSearchParams()
  const id = search?.get('id') ?? ''

  const { selectedAccountId, selectedAccount, loading: accountLoading } = useAccount()
  const [recipe, setRecipe] = useState<Recipe | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [prefix, setPrefix] = useState('')
  const [cloneState, setCloneState] = useState<'idle' | 'saving' | 'success' | 'error'>('idle')

  usePageTitle(recipe ? `${recipe.name}を作る` : null)

  useEffect(() => {
    if (accountLoading) return
    let alive = true
    setStatus('loading')
    void api.recipes
      .get(id, selectedAccountId ?? undefined)
      .then((res) => {
        if (!alive) return
        if (!res.success) {
          setStatus('error')
          return
        }
        setRecipe(res.data)
        setStatus('ready')
      })
      .catch(() => {
        if (alive) setStatus('error')
      })
    return () => {
      alive = false
    }
  }, [accountLoading, id, selectedAccountId])

  if (status === 'error') {
    return (
      <ListState
        kind="error"
        title="レシピを読み込めませんでした"
        description="時間をおいてもう一度お試しください。"
        action={
          <Link href="/recipes" className={styles.backLink}>
            レシピ一覧へ
          </Link>
        }
      />
    )
  }

  if (status !== 'ready' || !recipe) return <ListState kind="loading" />

  const requirements = apiRecipeRequirements(recipe)
  const rest = apiRecipeRest(recipe)
  const canClone = Boolean(selectedAccountId) && recipe.missingFeatures.length === 0 && recipe.items !== null

  const clone = async () => {
    if (!selectedAccountId || !canClone || cloneState === 'saving') return
    setCloneState('saving')
    try {
      const result = await api.recipes.clone(
        recipe.id,
        { accountId: selectedAccountId, namePrefix: prefix || null, expectedVersion: recipe.version },
        crypto.randomUUID(),
      )
      setCloneState(result.success ? 'success' : 'error')
    } catch {
      setCloneState('error')
    }
  }

  return (
    <div className={styles.page}>
      <nav className={styles.breadcrumb} aria-label="パンくず">
        <Link href="/recipes">レシピ</Link>
        <span aria-hidden>›</span>
        <span>{recipe.name}</span>
      </nav>

      <>
          <div className={styles.columns}>
            <div className={styles.main}>
              <section className={styles.block}>
                <h2 className={styles.blockTitle}>名前の付け方</h2>
                <Field label="名前のあたまに付ける文字（任意）" htmlFor="recipe-clone-prefix">
                  <TextField
                    id="recipe-clone-prefix"
                    placeholder="例：2026春"
                    value={prefix}
                    onChange={(e) => setPrefix(e.target.value)}
                  />
                </Field>
                <p className={styles.hint}>
                  付けると「{prefixedName(prefix, recipe.name)}
                  」のようになります。同じレシピを何度も使うとき、どれがどれか分かりやすくなります。
                </p>
                <label className={styles.accountLabel} htmlFor="recipe-clone-account">
                  どのLINEアカウントに作るか（必須）
                </label>
                <SelectField
                  id="recipe-clone-account"
                  className={styles.accountSelect}
                  value={selectedAccountId ?? ''}
                  disabled={!selectedAccountId}
                  options={[{
                    value: selectedAccountId ?? '',
                    label: selectedAccount?.name ?? 'アカウントが選ばれていません',
                  }]}
                />
                <p className={styles.hint}>
                  作る先はいま選んでいるアカウントです。変えるときは上のLINEアカウントから選び直します。
                </p>
              </section>

              <section className={styles.block}>
                <h2 className={styles.blockTitle}>
                  作られるもの{recipe.itemCount != null ? ` ${recipe.itemCount}件` : ''}
                </h2>
                <p className={styles.hint}>
                  すべて下書きで作られます。動きはじめるのは、ひとつずつ公開してからです。
                </p>
                {recipe.items ? (
                  <ul className={styles.items}>
                    {recipe.items.map((item) => (
                      <li key={`${item.kind}-${item.name}`} className={styles.item}>
                        <span className={styles.itemKind}>{item.kind}</span>
                        <span className={styles.itemName}>{prefixedName(prefix, item.name)}</span>
                        <span className={styles.itemNote}>{item.note}</span>
                        <StatusBadge tone="neutral" size="compact">
                          下書き
                        </StatusBadge>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className={styles.undecided}>{ITEMS_UNDECIDED_NOTE}</p>
                )}
                {rest ? <p className={styles.hint}>{rest}</p> : null}
              </section>
            </div>

            <aside className={styles.side} aria-label="この画面の案内">
              <section className={styles.sideCard}>
                <h2 className={styles.sideTitle}>必要な機能</h2>
                <ul className={styles.features}>
                  {requirements.map((requirement) => {
                    return (
                      <li key={requirement.key ?? 'friend-attributes'} className={styles.feature}>
                        <StatusBadge tone={requirement.on ? 'success' : 'warning'} size="compact">
                          {requirement.on ? 'オン' : 'オフ'}
                        </StatusBadge>
                        <span>{requirement.label}</span>
                      </li>
                    )
                  })}
                </ul>
                <p className={styles.hint}>{apiRecipeFeatureSummary(recipe)}</p>
              </section>

              <section className={styles.sideCard}>
                <h2 className={styles.sideTitle}>作ったあと</h2>
                <ul className={styles.notes}>
                  <li>できたものはすべて下書きです。放っておいても、友だちには何も届きません。</li>
                  <li>
                    公開するときは、シナリオ・ルールをひとつずつ開いて確かめてから公開します。
                  </li>
                  <li>できたものはレシピとつながりません。名前も中身も自由に直せます。</li>
                  <li>どのレシピから作ったかは記録に残ります。あとから見返せます。</li>
                </ul>
              </section>
              <CareCard items={[...CARE_ITEMS]} />
            </aside>
          </div>

          <StickyBar
            status={cloneState === 'success'
              ? '下書きを作りました。レシピ一覧から作成回数を確認できます。'
              : cloneState === 'error'
                ? '作れませんでした。入力と必要な機能を確認して、もう一度お試しください。'
                : undefined}
            actions={
              <>
                <Link href="/recipes" className={styles.cancel}>
                  やめる
                </Link>
                <button
                  type="button"
                  className={canClone ? styles.primary : styles.blocked}
                  disabled={!canClone || cloneState === 'saving'}
                  onClick={() => void clone()}
                >
                  {cloneState === 'saving' ? '作っています…' : createButtonLabel(recipe)}
                </button>
              </>
            }
          />
        </>
    </div>
  )
}

export default function RecipeClonePage() {
  return (
    <Suspense fallback={<ListState kind="loading" />}>
      <RecipeClone />
    </Suspense>
  )
}
