'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Suspense, useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import { DEFAULT_FEATURES } from '@/lib/feature-settings'
import { usePageTitle } from '@/components/shell/page-chrome'
import ListState from '@/components/shared/list-state'
import NoteBar from '@/components/shared/note-bar'
import PageHeader from '@/components/shared/page-header'
import StatusBadge from '@/components/shared/status-badge'
import StickyBar from '@/components/shared/sticky-bar'
import { TextField } from '@/components/shared/text-field'
import { Field } from '@/components/shared/form-controls'
import { CareCard } from '@/components/shared/side-cards'
import {
  CARE_ITEMS,
  CLONE_UNAVAILABLE_NOTE,
  ITEMS_UNDECIDED_NOTE,
  RECIPES,
  createButtonLabel,
  featureSummary,
  prefixedName,
  requirementIsOn,
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
  const recipe = RECIPES.find((r) => r.id === id) ?? null

  const { selectedAccountId, selectedAccount, loading: accountLoading } = useAccount()
  const [features, setFeatures] = useState<Record<string, boolean> | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [prefix, setPrefix] = useState('')

  usePageTitle(recipe?.name ?? null)

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

  if (!recipe) {
    return (
      <ListState
        kind="empty"
        title="そのレシピはありません"
        description="レシピ一覧から選び直してください。"
        action={
          <Link href="/recipes" className={styles.backLink}>
            レシピ一覧へ
          </Link>
        }
      />
    )
  }

  return (
    <div className={styles.page}>
      <PageHeader
        breadcrumb={[{ label: 'レシピ', href: '/recipes' }, { label: recipe.name }]}
        title={recipe.name}
        description={recipe.purpose}
      />

      {status !== 'ready' || !features ? (
        <ListState kind={status === 'error' ? 'error' : 'loading'} />
      ) : (
        <>
          <NoteBar tone="warn">{CLONE_UNAVAILABLE_NOTE}</NoteBar>

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
              </section>

              <section className={styles.block}>
                <h2 className={styles.blockTitle}>どのLINEアカウントに作るか（必須）</h2>
                <p className={styles.accountName}>
                  {selectedAccount?.name ?? 'アカウントが選ばれていません'}
                </p>
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
                {recipe.itemsRest ? <p className={styles.hint}>{recipe.itemsRest}</p> : null}
              </section>

              <section className={styles.block}>
                <h2 className={styles.blockTitle}>必要な機能</h2>
                <ul className={styles.features}>
                  {recipe.requirements.map((r) => {
                    const on = requirementIsOn(r, features)
                    return (
                      <li key={r.label} className={styles.feature}>
                        <StatusBadge tone={on ? 'success' : 'warning'} size="compact">
                          {on ? 'オン' : 'オフ'}
                        </StatusBadge>
                        <span>{r.label}</span>
                      </li>
                    )
                  })}
                </ul>
                <p className={styles.hint}>{featureSummary(recipe, features)}</p>
              </section>

              <section className={styles.block}>
                <h2 className={styles.blockTitle}>作ったあと</h2>
                <ul className={styles.notes}>
                  <li>できたものはすべて下書きです。放っておいても、友だちには何も届きません。</li>
                  <li>
                    公開するときは、シナリオ・ルールをひとつずつ開いて確かめてから公開します。
                  </li>
                  <li>できたものはレシピとつながりません。名前も中身も自由に直せます。</li>
                  <li>どのレシピから作ったかは記録に残ります。あとから見返せます。</li>
                </ul>
              </section>
            </div>

            <aside className={styles.side} aria-label="この画面の案内">
              <CareCard items={[...CARE_ITEMS]} />
            </aside>
          </div>

          <StickyBar
            status={CLONE_UNAVAILABLE_NOTE}
            actions={
              <>
                <Link href="/recipes" className={styles.cancel}>
                  やめる
                </Link>
                <span className={styles.blocked}>{createButtonLabel(recipe)}</span>
              </>
            }
          />
        </>
      )}
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
