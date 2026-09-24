import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

const SCENARIO_LIST = read('../components/scenarios/scenario-list.tsx')
const AUTO_REPLIES = read('../app/auto-replies/page.tsx')
const FRIEND_ADD = read('../app/friend-add-settings/page.tsx')
const VARS = read('../app/contents/vars/page.tsx')
const NEN_OVERVIEW = read('../app/nen-campaigns/nen-overview.tsx')
const TAGS = read('../components/friend-fields/tags-page-v4.tsx')
const ANALYTICS = read('../app/analytics/page.tsx')
const ANALYTICS_TIME = read('../app/analytics/analytics-time.ts')

/*
 * #640（第5パス D-3）: 表記一貫性。
 * - 1行省略の値は title などで全文を確認できる（狭い列の省略＋title）。
 * - 日時は JST・画面ごとの統一フォーマットで出す。
 */
describe('#640 省略表示の全文確認（title）', () => {
  it('/scenarios: 各行の「配信を始める方法」導線は省略＋title', () => {
    const link = SCENARIO_LIST.match(/配信を始める方法[\s\S]{0,400}?<Link[\s\S]{0,400}?配信を始める方法/)
    expect(SCENARIO_LIST).toContain('title="配信を始める方法"')
    // 狭い「購読 / 読了」列ではみ出さないよう、省略表示にする。
    expect(SCENARIO_LIST).toMatch(/title="配信を始める方法"[\s\S]{0,200}?truncate/)
  })

  it('/scenarios: 購読・読了の数セルは title で全文を出す', () => {
    expect(SCENARIO_LIST).toMatch(/title=\{`購読[\s\S]{0,200}?読了/)
  })

  it('/auto-replies: 操作列と今月の応答セルは title で全文を出す', () => {
    expect(AUTO_REPLIES).toMatch(/whitespace-nowrap"[\s\S]{0,120}?title=\{`今月 /)
    expect(AUTO_REPLIES).toMatch(/title=\{\['編集'[\s\S]{0,200}?join\('・'\)\}/)
  })

  it('/auto-replies: 表の見出しは title で意味を補う', () => {
    expect(AUTO_REPLIES).toContain('title="動く条件（キーワード・適用アカウント）"')
    expect(AUTO_REPLIES).toContain('title="今月動いた回数"')
  })

  it('/friend-add-settings: 設定名・見出し・長い値に title', () => {
    expect(FRIEND_ADD).toMatch(/className="text-ink block truncate font-bold" title=\{rule\.name\}/)
    const thTitles = FRIEND_ADD.match(/<Th title=/g)
    expect(thTitles, '見出しセルの title が足りない').not.toBeNull()
    expect(thTitles!.length).toBeGreaterThanOrEqual(6)
    expect(FRIEND_ADD).toMatch(/block truncate" title=\{rule\.isFallback/)
    expect(FRIEND_ADD).toMatch(/block truncate" title=\{deliverySummary\(rule\)\}/)
  })

  it('/contents/vars: 見出し・使用箇所・更新/操作列に title', () => {
    const thTitles = VARS.match(/<Th[^>]*title=/g)
    expect(thTitles, '見出しセルの title が足りない').not.toBeNull()
    expect(thTitles!.length).toBeGreaterThanOrEqual(6)
    expect(VARS).toMatch(/whitespace-nowrap px-4 py-3 text-xs"[\s\S]{0,200}?title=\{item\.usageCount/)
    expect(VARS).toMatch(/title=\{`最終更新 /)
    expect(VARS).toContain('title="編集・削除"')
  })

  it('/nen-campaigns: 配信名の補足・送った先・並び順に title', () => {
    expect(NEN_OVERVIEW).toMatch(/truncate text-micro text-ink-faint" title=\{setting\.title\}/)
    expect(NEN_OVERVIEW).toMatch(/title=\{`\$\{delivery\.friendName \|\| '名前未取得'\}・/)
    expect(NEN_OVERVIEW).toMatch(/title=\{sort === 'name'/)
  })

  it('/tags: フォルダ札・フォルダ行・使用先セルに title', () => {
    expect(TAGS).toMatch(/rounded-mini border border-hairline bg-canvas px-2" title=\{group\?\.name/)
    expect(TAGS).toMatch(/min-w-0 flex-1 truncate" title=\{row\.name\}/)
    expect(TAGS).toMatch(/truncate px-3 py-3 text-label text-ink" title=\{usageLabel\(tag\)\}/)
  })
})

describe('#640 日時表記の統一（JST・フォーマット）', () => {
  it('/analytics: 配信日時は formatAnalyticsDateTime にそろえる', () => {
    expect(ANALYTICS).not.toContain("slice(0, 16).replace('T', ' ')")
    expect(ANALYTICS).toContain('formatAnalyticsDateTime(item.sentAt)')
  })

  it('/analytics: 集計期間・結果履歴は formatAnalyticsDate にそろえる', () => {
    expect(ANALYTICS).toMatch(/集計期間 \{formatAnalyticsDate\(from\)\}〜\{formatAnalyticsDate\(to\)\}/)
    expect(ANALYTICS).toContain('formatAnalyticsDate(item.latestSnapshot.periodFrom)')
    expect(ANALYTICS).toContain('formatAnalyticsDate(snapshot.periodFrom)')
    // 生の YYYY-MM-DD を表示へ流す残りがないこと（API引数用の slice は許容）。
    expect(ANALYTICS.match(/periodFrom\.slice\(0, 10\)/g) ?? []).toHaveLength(0)
    expect(ANALYTICS.match(/periodTo\.slice\(0, 10\)/g) ?? []).toHaveLength(0)
  })

  it('/tags: 登録日は端末の地域ではなく JST 固定で出す', () => {
    expect(TAGS).toMatch(/function formatDate[\s\S]{0,400}?timeZone: 'Asia\/Tokyo'/)
    expect(TAGS).not.toContain('d.getFullYear()')
  })

  it('/contents/vars: 更新日は JST、日付型の値は formatStamp の「/」区切り', () => {
    expect(VARS).toMatch(/function formatListDate[\s\S]{0,400}?timeZone: 'Asia\/Tokyo'/)
    expect(VARS).toMatch(/formatVarValue\(item\.type, item\.value\)/)
    expect(VARS).toMatch(/formatVarValue\(item\.type, pending\.value\)/)
  })

  it('日時の整形は画面の既存ユーティリティを使う（場当たりの文字列処理を増やさない）', () => {
    expect(ANALYTICS_TIME).toContain("timeZone: 'Asia/Tokyo'")
    expect(VARS).toContain("import { formatStamp } from '@/lib/common-vars'")
  })
})
