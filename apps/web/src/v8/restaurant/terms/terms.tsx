'use client'

/*
 * ★V8 飲食店向け 利用規約（Pencil `VdKOK`）。
 * 左に本文（今と同じ TERMS_DOCUMENT）、右に目次（幅260）と「店舗追加へ戻る」。
 * 目次は条の数が多いので、絵の5行ぶんの高さで中だけ流す（戻るボタンの位置を動かさない）。
 */
import { ArrowLeft } from 'lucide-react'
import { TERMS_DOCUMENT } from '@/content/terms/musubo-terms'
import { usePageCrumbs, usePageTitle } from '@/components/shell/page-chrome'
import { PageFrame, PageHeading } from '@/components/templates/page-frame'
import Button from '@/components/shared/button'
import TermsBody, { termsSectionId } from '../store-new/terms-body'
import styles from './terms.module.css'

/** 「2026-08-23」→「2026/08/23」。 */
function slashDate(value: string): string {
  return value.replace(/-/g, '/')
}

export default function TermsV8() {
  usePageTitle('利用規約')
  usePageCrumbs([{ label: 'ホーム', href: '/' }, { label: 'アカウント', href: '/hq' }, { label: '店舗を追加', href: '/restaurant-test/stores/new' }])
  return (
    <PageFrame kind="list" boardId="VdKOK">
      <PageHeading
        title="利用規約"
        description={`musubo 飲食店向け機能（検証環境）の利用規約と個人情報の取扱い・最終改定 ${slashDate(TERMS_DOCUMENT.updatedAt)}`}
      />
      <div className={styles.body}>
        <article className={styles.document} aria-label={TERMS_DOCUMENT.title}>
          <TermsBody />
        </article>
        <nav className={styles.toc} aria-label="目次">
          <h2 className={styles.tocTitle}>目次</h2>
          <ol className={styles.tocList}>
            {TERMS_DOCUMENT.sections.map((section, index) => (
              <li key={section.heading}>
                <a href={`#${termsSectionId(index)}`} className={styles.tocLink}>{section.heading.replace(/（(.+?)）/, ' $1').replace('★重要', '')}</a>
              </li>
            ))}
          </ol>
          <Button href="/restaurant-test/stores/new"><ArrowLeft aria-hidden className={styles.icon15} />店舗追加へ戻る</Button>
        </nav>
      </div>
    </PageFrame>
  )
}
