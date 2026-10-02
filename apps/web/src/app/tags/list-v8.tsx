'use client'

/*
 * ★V8 友だち属性の一覧（Pencil「★V8 画面の地図」の友だち属性の行：
 * タグ `I1E7Bt`・友だち情報欄 `q5gbcM`・対応マーク `vKDj5`・保存した検索 `IWnYX`、
 * 状態の板は `U0aKD`）。
 *
 * v7 の一覧（components/friend-fields/tags-page-v4.tsx）とは別の部品として持つ。
 * データの口は同じ。違いは置き場と見せ方だけ——見出しの右にタブごとの
 * 作る口、タグと友だち情報欄は左にフォルダの列、行の右端は「…」。
 * v7 を直す必要が出たら tags-page-v4.tsx 側も同じ判断を入れる（V8 完成までの二重管理）。
 */
import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { usePageCrumbs, usePageTitle } from '@/components/shell/page-chrome'
import { useStaffRole, canManageRole } from '@/lib/staff-role'
import { useFeatureVisibility } from '@/lib/use-feature-visibility'
import type { FeatureKey } from '@/lib/feature-settings'
import { FeatureDisabledScreen } from '@/components/feature-disabled-gate'
import { Tabs } from '@/components/shared/tabs'
import Button from '@/components/shared/button'
import TagsTabV8 from './tags-tab-v8'
import FieldsTabV8 from './fields-tab-v8'
import MarksTabV8 from './marks-v8'
import SearchesTabV8 from './searches-v8'
import styles from './list-v8.module.css'

const TABS = [
  ['tags', 'タグ'],
  ['fields', '友だち情報欄'],
  ['marks', '対応マーク'],
  ['searches', '保存した検索'],
] as const
type TabKey = (typeof TABS)[number][0]

/**
 * タブと機能設定キーの対応。「タグ」自体は必須機能なのでキーを持たない。
 * キーを持つタブは、担当accountの機能がオフならタブごと隠す。
 * （v7 `tags-page-v4.tsx` の TAB_FEATURE と同じ）
 */
const TAB_FEATURE: Partial<Record<TabKey, FeatureKey>> = {
  fields: 'friend_fields',
  marks: 'support_marks',
  searches: 'saved_searches',
}

export default function TagsListV8({
  fixture,
  accountId = null,
}: {
  fixture?: { items: import('@line-crm/shared').Tag[]; groups: import('@line-crm/shared').TagGroup[] }
  accountId?: string | null
}) {
  usePageTitle('友だち属性')
  usePageCrumbs([{ label: 'ホーム', href: '/' }])

  const router = useRouter()
  const params = useSearchParams()
  const rawTab = params.get('tab')
  const routeTab: TabKey = TABS.some(([key]) => key === rawTab) ? (rawTab as TabKey) : 'tags'
  const [fixtureTab, setFixtureTab] = useState<TabKey>('tags')
  const tab = fixture ? fixtureTab : routeTab
  const [csvOpen, setCsvOpen] = useState(false)

  /*
   * 閲覧のみ（staff）：作る・編集・削除・並べ替え・CSV・フォルダ追加は
   * 押せない形で出す（specs/pages/02-friend-attributes.md「状態」）。
   * サーバの requireRole('owner','admin') と同じ境目。役割が取れるまで
   * null なので、そのあいだは今までどおり押せる見た目にしておく
   * （最後の守りはサーバの 403）。
   */
  const staffRole = useStaffRole()
  const canEdit = staffRole === null || canManageRole(staffRole)

  // fixture は試験用の固定表示なので機能設定を読みに行かない。
  const visibility = useFeatureVisibility(fixture ? null : accountId)
  const tabEnabled = (key: TabKey) => {
    if (fixture) return true
    const featureKey = TAB_FEATURE[key]
    return !featureKey || visibility.enabled(featureKey)
  }
  const currentTabFeature = TAB_FEATURE[tab]
  const currentTabBlocked =
    !fixture && !!currentTabFeature && visibility.status === 'ready' && !visibility.enabled(currentTabFeature)

  return (
    <div className={styles.board}>
      <div data-design="Head">
        <div className={styles.head}>
          <div className={styles.headText}>
            <h2 className={styles.headTitle}>友だち属性</h2>
            <p className={styles.headDescription}>
              タグ・友だち情報欄・対応マーク・保存した検索をここで管理します。
            </p>
          </div>
          {/* 見出しの右はタブごとの作る口（仕様 02-friend-attributes「今の操作 → V8 の置き場」）。 */}
          <div className={styles.headAction}>
            {currentTabBlocked ? null : tab === 'tags' ? (
              <Button type="button" disabled={!canEdit} onClick={() => setCsvOpen(true)}>
                CSVで一括登録する
              </Button>
            ) : tab === 'marks' ? (
              // Button のリンク型は disabled を取れないので、閲覧のみでは押せないボタン型に替える。
              canEdit ? (
                <Button href="/tags/marks/new" variant="primary">＋ マークを作る</Button>
              ) : (
                <Button type="button" variant="primary" disabled>＋ マークを作る</Button>
              )
            ) : tab === 'searches' ? (
              <Button href="/friends" variant="primary">友だち一覧で条件を作る</Button>
            ) : null}
          </div>
        </div>
        <div data-design="GroupTabs">
          <Tabs
            items={TABS.filter(([key]) => tabEnabled(key)).map(([key, label]) => ({
              label,
              current: tab === key,
              onClick: () => (fixture ? setFixtureTab(key) : router.replace(key === 'tags' ? '/tags' : `/tags?tab=${key}`)),
            }))}
          />
        </div>
      </div>

      <div data-design="Body">
        {currentTabBlocked ? (
          // 直URL（?tab=fields など）でも本文へ進ませず、機能設定への導線を出す。
          <FeatureDisabledScreen featureId={currentTabFeature} />
        ) : tab === 'tags' ? (
          <TagsTabV8
            accountId={accountId}
            fixture={fixture}
            canEdit={canEdit}
            csvOpen={csvOpen}
            onCsvClose={() => setCsvOpen(false)}
          />
        ) : tab === 'fields' ? (
          <FieldsTabV8 accountId={accountId} canEdit={canEdit} />
        ) : tab === 'marks' ? (
          <MarksTabV8 accountId={accountId} canEdit={canEdit} />
        ) : (
          <SearchesTabV8 accountId={accountId} canEdit={canEdit} />
        )}
      </div>
    </div>
  )
}
