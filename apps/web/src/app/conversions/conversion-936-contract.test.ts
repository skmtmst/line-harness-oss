import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const LIST_PAGE = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8')
const NEW_PAGE = readFileSync(new URL('./new/page.tsx', import.meta.url), 'utf8')
const ANALYTICS_PAGE = readFileSync(new URL('../analytics/page.tsx', import.meta.url), 'utf8')

/**
 * 936 コンバージョン成果地点の作成・差替・境界(N-256〜264)の画面側契約。
 *
 * - N-256: 「使う場所を足す」は実IDを持って分析のファネル作成へ行き、
 *   受け取った側はその地点を「成果」段へ入れておく。
 * - N-258: 作成画面の「使う場所」は実在するオブジェクトのIDだけを選べる。
 *   `conversion-overview` などの仮IDを置かない。
 * - N-264: 保存後は `?highlight=<作った行のID>` で一覧へ戻り、
 *   その行を帯と色で示す。
 */
describe('N-256 使う場所を足す導線', () => {
  it('一覧は実IDを持ってファネル作成へ送る', () => {
    expect(LIST_PAGE).toContain('/analytics?tab=funnel&conversionPointId=')
    expect(LIST_PAGE).toContain('conversionPointName=')
  })

  it('分析側はクエリの実IDをファネル作成の「成果」段へ入れる', () => {
    expect(ANALYTICS_PAGE).toContain("params.get('conversionPointId')")
    expect(ANALYTICS_PAGE).toContain('presetConversion')
    // 2段目の conversion 段へ地点のIDを入れた状態で開く。
    expect(ANALYTICS_PAGE).toContain("kind: 'conversion'")
    expect(ANALYTICS_PAGE).toContain('value: presetConversion?.id')
    // 段の種類 conversion の値は conversionPointId として保存される。
    expect(ANALYTICS_PAGE).toContain("return { conversionPointId: value }")
  })
})

describe('N-258 利用先は実IDだけを選べる', () => {
  it('仮IDの固定候補を置かない', () => {
    expect(NEW_PAGE).not.toContain('USAGE_CHOICES')
    expect(NEW_PAGE).not.toContain("refId: 'conversion-overview'")
    expect(NEW_PAGE).not.toContain("refId: 'purchase-followup'")
    expect(NEW_PAGE).not.toContain("refId: 'conversion-followup'")
  })

  it('候補は実オブジェクトの一覧から読む', () => {
    expect(NEW_PAGE).toContain('api.analytics.v6Funnels.list')
    expect(NEW_PAGE).toContain('api.automations.list')
    expect(NEW_PAGE).toContain('api.nenCampaigns.settings')
    // 読めたものだけを選ばせ、送るのは実ID。
    expect(NEW_PAGE).toContain('refId: funnel.id')
    expect(NEW_PAGE).toContain('refId: campaign.campaignKey')
    expect(NEW_PAGE).toContain('refId: automation.id')
  })
})

describe('N-264 作った行が分かる', () => {
  it('一覧は highlight クエリを読み、帯と行の色で示す', () => {
    expect(LIST_PAGE).toContain("useSearchParams().get('highlight')")
    expect(LIST_PAGE).toContain('highlightedPoint')
    expect(LIST_PAGE).toContain('を保存しました')
    expect(LIST_PAGE).toContain('scrollIntoView')
  })

  it('作成画面は作ったIDを持って一覧へ戻る', () => {
    expect(NEW_PAGE).toContain('successHref=')
    expect(NEW_PAGE).toContain('&highlight=')
  })
})
