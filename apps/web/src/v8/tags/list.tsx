'use client'

/*
 * ★V8 友だち属性の一覧（Pencil：タグ `I1E7Bt`・1152 `aPeD8`・閲覧のみ `fkGUR`）。
 *
 * 型（PageFrame・PageHeading）で板の頭・閲覧のみの帯・タブの段を組み、
 * 本文はタブごとに切り替える。どのタブもこの場所に一から書いた
 * （tags-tab・fields-tab・marks-tab・searches-tab）。
 *
 * 受け付ける URL と指定は今と同じ：`/tags`・`/tags?tab=fields|marks|searches`・
 * 行の詳細は `?tag=<id>`。
 */
import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Eye, Plus, Upload } from 'lucide-react'
import type { Tag, TagGroup } from '@line-crm/shared'
import { usePageCrumbs, usePageTitle } from '@/components/shell/page-chrome'
import { PageFrame, PageHeading } from '@/components/templates/page-frame'
import { useStaffRole, canManageRole } from '@/lib/staff-role'
import { useNarrowViewport } from '@/lib/use-narrow-viewport'
import { useFeatureVisibility } from '@/lib/use-feature-visibility'
import type { FeatureKey } from '@/lib/feature-settings'
import { FeatureDisabledScreen } from '@/components/feature-disabled-gate'
import { Tabs } from '@/components/shared/tabs'
import Button from '@/components/shared/button'
import TagsTab from './tags-tab'
import MarksTab from './marks-tab'
import SearchesTab from './searches-tab'
import FieldsTab from './fields-tab'
import styles from './list.module.css'

const TABS = [
  ['tags', 'タグ'],
  ['fields', '友だち情報欄'],
  ['marks', '対応マーク'],
  ['searches', '保存した検索'],
] as const
export type TagsTabKey = (typeof TABS)[number][0]

/** タブと機能設定キーの対応（v7 `tags-page-v4.tsx` の TAB_FEATURE と同じ）。「タグ」は必須機能。 */
const TAB_FEATURE: Partial<Record<TagsTabKey, FeatureKey>> = {
  fields: 'friend_fields',
  marks: 'support_marks',
  searches: 'saved_searches',
}

export default function TagsList({
  accountId = null,
  fixture,
}: {
  accountId?: string | null
  /** 試験用の固定表示。渡すと読みに行かない。 */
  fixture?: { items: Tag[]; groups: TagGroup[] }
}) {
  usePageTitle('友だち属性')
  usePageCrumbs([{ label: 'ホーム', href: '/' }])

  const router = useRouter()
  const params = useSearchParams()
  const rawTab = params.get('tab')
  const routeTab: TagsTabKey = TABS.some(([key]) => key === rawTab) ? (rawTab as TagsTabKey) : 'tags'
  const [fixtureTab, setFixtureTab] = useState<TagsTabKey>('tags')
  const tab = fixture ? fixtureTab : routeTab
  const [csvOpen, setCsvOpen] = useState(false)

  /*
   * 閲覧のみ（staff）：作る・編集・削除・並べ替え・CSV・フォルダ追加は
   * 押せない形で出す。役割が取れるまで null なので、そのあいだは押せる見た目
   * （最後の守りはサーバの 403）。
   */
  const staffRole = useStaffRole()
  const canEdit = staffRole === null || canManageRole(staffRole)
  const readOnly = staffRole !== null && !canEdit
  const narrow = useNarrowViewport()

  const visibility = useFeatureVisibility(fixture ? null : accountId)
  const tabEnabled = (key: TagsTabKey) => {
    if (fixture) return true
    const featureKey = TAB_FEATURE[key]
    return !featureKey || visibility.enabled(featureKey)
  }
  const currentTabFeature = TAB_FEATURE[tab]
  const currentTabBlocked =
    !fixture && !!currentTabFeature && visibility.status === 'ready' && !visibility.enabled(currentTabFeature)

  const boardId = tab === 'marks' ? 'vKDj5' : tab === 'searches' ? 'IWnYX' : tab === 'fields' ? 'q5gbcM' : tab !== 'tags' ? undefined : readOnly ? 'fkGUR' : narrow ? 'aPeD8' : 'I1E7Bt'

  /* 見出しの右はタブごとの作る口。閲覧のみには押せない作る口を置かない（2026-10-06 オーナー決定）。 */
  const actions = currentTabBlocked ? null : tab === 'tags' ? (
    canEdit ? (
      <Button type="button" onClick={() => setCsvOpen(true)}>
        <Upload size={15} aria-hidden="true" />
        CSVで一括登録する
      </Button>
    ) : null
  ) : tab === 'marks' ? (
    canEdit ? (
      <Button href="/tags/marks/new" variant="primary"><Plus size={15} aria-hidden="true" />マークを作る</Button>
    ) : null
  ) : tab === 'searches' ? (
    <Button href="/friends" variant="primary"><Plus size={15} aria-hidden="true" />友だち一覧で条件を作る</Button>
  ) : null

  return (
    <PageFrame kind="list" boardId={boardId}>
      <PageHeading
        headingSize="regular"
        title="友だち属性"
        description="友だちに付ける印（タグ）・入力してもらう項目・対応の印・保存した条件をまとめて管理します。"
        actions={actions}
      />

      {readOnly ? (
        <div className={styles.readonlyRow}>
          <p className={styles.readonlyBand}>
            <Eye className={styles.readonlyIcon} aria-hidden="true" />
            閲覧のみで見ています。変える操作は管理者に頼んでください。
          </p>
        </div>
      ) : null}

      <div className={styles.tabs} data-design="GroupTabs">
        <Tabs
          items={TABS.filter(([key]) => tabEnabled(key)).map(([key, label]) => ({
            label,
            current: tab === key,
            onClick: () => (fixture ? setFixtureTab(key) : router.replace(key === 'tags' ? '/tags' : `/tags?tab=${key}`)),
          }))}
        />
      </div>

      {currentTabBlocked ? (
        <div className={styles.otherTab}>
          <FeatureDisabledScreen featureId={currentTabFeature} />
        </div>
      ) : tab === 'tags' ? (
        <TagsTab
          accountId={accountId}
          fixture={fixture}
          canEdit={canEdit}
          narrow={narrow}
          csvOpen={csvOpen}
          onCsvClose={() => setCsvOpen(false)}
        />
      ) : tab === 'marks' ? (
        <MarksTab accountId={accountId} canEdit={canEdit} />
      ) : tab === 'searches' ? (
        <SearchesTab accountId={accountId} canEdit={canEdit} />
      ) : (
        <FieldsTab accountId={accountId} canEdit={canEdit} narrow={narrow} />
      )}
    </PageFrame>
  )
}
