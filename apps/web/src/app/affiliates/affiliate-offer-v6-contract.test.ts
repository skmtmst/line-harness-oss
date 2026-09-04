import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { AffiliateOffer } from '@/lib/api'
import {
  OFFER_CSV_HEADER,
  OFFER_FILTERS,
  OFFER_PAGE_SIZES,
  OFFER_SORTS,
  csvCell,
  offersCsv,
  pageCountOf,
  pageOf,
  selectOffers,
} from './offer-list-view'

const TABS = readFileSync(new URL('./tabs.tsx', import.meta.url), 'utf8')
const NEW_PAGE = readFileSync(new URL('./new/page.tsx', import.meta.url), 'utf8')
const CREATE_PAGE = readFileSync(
  new URL('../../components/shared/create-page.tsx', import.meta.url),
  'utf8',
)

function offer(over: Partial<AffiliateOffer> & { id: string }): AffiliateOffer {
  return {
    name: over.id,
    description: null,
    rewardAmount: null,
    rewardMiles: 0,
    mileageProgramId: 'prog',
    lineAccountId: null,
    tagId: null,
    scenarioId: null,
    isActive: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...over,
  }
}

const OFFERS: AffiliateOffer[] = [
  offer({ id: 'a', name: '初回購入', rewardAmount: 500, rewardMiles: 0, isActive: true, createdAt: '2026-03-01T00:00:00.000Z' }),
  offer({ id: 'b', name: '無料相談', description: '面談で成果', rewardAmount: null, rewardMiles: 100, isActive: false, createdAt: '2026-02-01T00:00:00.000Z' }),
  offer({ id: 'c', name: '定期便', rewardAmount: 1200, rewardMiles: 50, isActive: true, createdAt: '2026-01-15T00:00:00.000Z' }),
]

describe('V6 案件一覧（GH8VL）の見せ方', () => {
  it('絞り込みの札は読み込んだ行から数えられるものだけ持つ', () => {
    expect(OFFER_FILTERS.map((f) => f.key)).toEqual(['open', 'draft', 'hasYen', 'hasMiles'])
  })

  it('札を押すと、その札に合う案件だけ残る', () => {
    const shown = selectOffers(OFFERS, { filters: ['draft'], query: '', sort: 'newest' })
    expect(shown.map((o) => o.id)).toEqual(['b'])
  })

  it('札を2つ押すと足し合わせる。どちらかに合えば残る', () => {
    const shown = selectOffers(OFFERS, { filters: ['open', 'draft'], query: '', sort: 'newest' })
    expect(shown.map((o) => o.id)).toEqual(['a', 'b', 'c'])
  })

  it('報酬ありの札は、円が0またはnullの案件を外す', () => {
    const shown = selectOffers(OFFERS, { filters: ['hasYen'], query: '', sort: 'newest' })
    expect(shown.map((o) => o.id)).toEqual(['a', 'c'])
  })

  it('検索は案件名と説明の両方を見る', () => {
    expect(selectOffers(OFFERS, { filters: [], query: '定期', sort: 'newest' }).map((o) => o.id))
      .toEqual(['c'])
    expect(selectOffers(OFFERS, { filters: [], query: '面談', sort: 'newest' }).map((o) => o.id))
      .toEqual(['b'])
  })

  it('空白だけの検索語では絞り込まない', () => {
    expect(selectOffers(OFFERS, { filters: [], query: '   ', sort: 'newest' })).toHaveLength(3)
  })

  it('並び順は新しい順・名前順・報酬が高い順の3つが動く', () => {
    expect(OFFER_SORTS.map((s) => s.value)).toEqual(['newest', 'name', 'reward'])
    expect(selectOffers(OFFERS, { filters: [], query: '', sort: 'newest' }).map((o) => o.id))
      .toEqual(['a', 'b', 'c'])
    expect(selectOffers(OFFERS, { filters: [], query: '', sort: 'reward' }).map((o) => o.id))
      .toEqual(['c', 'a', 'b'])
  })

  it('並び替えても元の配列は動かさない', () => {
    const before = OFFERS.map((o) => o.id)
    selectOffers(OFFERS, { filters: [], query: '', sort: 'reward' })
    expect(OFFERS.map((o) => o.id)).toEqual(before)
  })

  it('ページ送りは0件でも1ページ、範囲外のページは最後へ寄せる', () => {
    expect(pageCountOf(0, 20)).toBe(1)
    expect(pageCountOf(41, 20)).toBe(3)
    expect(pageOf([1, 2, 3, 4, 5], 2, 2)).toEqual([3, 4])
    expect(pageOf([1, 2, 3, 4, 5], 99, 2)).toEqual([5])
  })

  it('表示件数は設計の3段', () => {
    expect(OFFER_PAGE_SIZES).toEqual([20, 50, 100])
  })

  it('CSVは列がずれない。カンマ・引用符・改行を含む名前を包む', () => {
    expect(csvCell('あ,い')).toBe('"あ,い"')
    expect(csvCell('あ"い')).toBe('"あ""い"')
    expect(csvCell('あ\nい')).toBe('"あ\nい"')
    expect(csvCell(null)).toBe('')
    expect(csvCell(0)).toBe('0')
  })

  it('CSVは画面に出ている行だけを、設計の見出しで書き出す', () => {
    const shown = selectOffers(OFFERS, { filters: ['draft'], query: '', sort: 'newest' })
    const csv = offersCsv(shown, {
      account: () => undefined,
      tag: () => undefined,
      scenario: () => undefined,
      date: (iso) => iso.slice(0, 10),
    })
    const lines = csv.split('\r\n')
    expect(lines[0]).toBe(OFFER_CSV_HEADER.join(','))
    expect(lines).toHaveLength(2)
    expect(lines[1]).toContain('無料相談')
    expect(lines[1]).toContain('下書き')
    expect(csv).not.toContain('初回購入')
  })

  it('名前が引けない参照は、内部IDを出さず未取得と分かる言葉にする', () => {
    const csv = offersCsv([offer({ id: 'x', name: 'X', tagId: 'tag_9' })], {
      account: () => undefined,
      tag: () => undefined,
      scenario: () => undefined,
      date: () => '2026-01-01',
    })
    expect(csv).toContain('—（名前を確認できません）')
    expect(csv).not.toContain('tag_9')
  })
})

describe('V6 案件一覧（GH8VL）の画面', () => {
  it('タブ名と重なる本文見出し「案件」を持たない', () => {
    expect(TABS).not.toContain('<h2 className="text-ink text-base font-semibold">案件</h2>')
  })

  it('案内バーを1本置く', () => {
    expect(TABS).toContain("import NoteBar from '@/components/shared/note-bar'")
    expect(TABS.match(/<NoteBar/g) ?? []).toHaveLength(1)
  })

  it('検索・表示件数・並び順・ページ送りを共通部品でつなぐ', () => {
    expect(TABS).toContain("import SearchField from '@/components/shared/search-field'")
    expect(TABS).toContain("import Select from '@/components/shared/select'")
    expect(TABS).toContain("import Pagination from '@/components/shared/pagination'")
    expect(TABS).toContain("import FilterChip from '@/components/shared/filter-chip'")
  })

  it('口の無い「並び順を保存」を操作として置かない', () => {
    // 注記としては書いてよい。押せる形（JSXの本文）で出ていないことを見る。
    expect(TABS).not.toMatch(/>\s*並び順を保存\s*</)
  })

  it('押せない検索欄・並び順を置かない', () => {
    expect(TABS).not.toContain('準備中')
    expect(TABS).not.toMatch(/<SearchField[^>]*disabled/)
  })

  it('読込中・取得失敗・空を言い分ける', () => {
    expect(TABS).toContain('title="案件を読み込んでいます"')
    expect(TABS).toContain('title="案件を読み込めませんでした"')
    expect(TABS).toContain('title="案件はまだ登録されていません"')
    expect(TABS).toContain('title="絞り込みに合う案件がありません"')
  })

  it('参照名を引けなくても内部IDを画面へ出さない', () => {
    expect(TABS).not.toContain('?? offer.lineAccountId')
    expect(TABS).not.toContain('?? offer.tagId')
    expect(TABS).not.toContain('?? offer.scenarioId')
    expect(TABS).toContain("'—（名前を確認できません）'")
  })
})

describe('V6 アフィリエイターを追加する（xqT1Z）', () => {
  it('設計のV6寸法を使う版を指定する', () => {
    expect(NEW_PAGE).toContain('variant="v6"')
    expect(NEW_PAGE).toContain('designNode="xqT1Z"')
  })

  it('V6版は保存を下部追従バーに置き、カードの中には置かない', () => {
    expect(CREATE_PAGE).toContain("import StickyBar from '@/components/shared/sticky-bar'")
    expect(CREATE_PAGE).toContain('{v6 ? null : <div className="flex flex-wrap gap-2">{actions}</div>}')
  })

  it('V6版だけ設計の余白18pxと右カラム390pxを使い、V5版は動かさない', () => {
    expect(CREATE_PAGE).toContain("v6 ? 'rounded-card space-y-3 p-[18px]' : 'rounded-card space-y-5 p-6'")
    expect(CREATE_PAGE).toContain("v6 ? 'xl:w-[390px]' : 'xl:w-80'")
  })

  it('入力欄は設計の幅を持ち、高さ40pxの共通部品を通す', () => {
    expect(NEW_PAGE).toContain("import { TextInput } from '@/components/shared/form-controls'")
    expect(NEW_PAGE).toContain("const W_NAME = 'w-[360px] max-w-full'")
    expect(NEW_PAGE).toContain("const W_CODE = 'w-[320px] max-w-full'")
    expect(NEW_PAGE).toContain("const W_EMAIL = 'w-[340px] max-w-full'")
    expect(NEW_PAGE).toContain("const W_RATE = 'w-[200px] max-w-full tabular-nums'")
    expect(NEW_PAGE).toContain("const W_HOLD = 'w-[220px] max-w-full tabular-nums'")
  })

  it('口の無い項目は押せない入力欄ではなく、—と理由で出す', () => {
    expect(NEW_PAGE).toContain('function Unavailable(')
    for (const label of ['友だちから選ぶ', '1件あたりの上限', '振込先の登録', '成果時の動き']) {
      expect(NEW_PAGE).toContain(`label="${label}"`)
    }
    // 押せない入力欄を残していない。
    expect(NEW_PAGE).not.toMatch(/<TextInput\s+disabled/)
    expect(NEW_PAGE).not.toContain('<select id="af-account" disabled')
  })

  it('未接続の言い方をそろえる', () => {
    const notWired = NEW_PAGE.match(/まだ繋がっていません。[^"]*が接続されると表示されます。/g) ?? []
    expect(notWired).toHaveLength(4)
  })

  it('URLのコピーは、コードが決まっているときだけ押せる', () => {
    expect(NEW_PAGE).toContain('{previewUrl && (')
    expect(NEW_PAGE).toContain('navigator.clipboard?.writeText(previewUrl)')
  })

  it('基本情報の作成後に追加情報だけ失敗しても、再押下で同じ人を増やさない', () => {
    expect(NEW_PAGE).toContain('const [createdId, setCreatedId]')
    expect(NEW_PAGE).toContain('let affiliateId = createdId')
    expect(NEW_PAGE).toContain('if (!affiliateId) {')
    expect(NEW_PAGE).toContain('if (!update.success)')
    expect(NEW_PAGE).toContain('もう一度押すと、追加情報だけを保存します。')
  })

  it('割合と保留期間をWorkerが受ける範囲で止める', () => {
    expect(NEW_PAGE).toContain('rate <= 0 || rate > 100')
    expect(NEW_PAGE).toContain('!Number.isInteger(days) || days < 0 || days > 365')
  })
})
