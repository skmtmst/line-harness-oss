import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'

/**
 * 点検 #500 の「中」掲載一覧N+1の再発防止。
 * 掲載先の取得が写真の件数によらず1回であること、掲載ごとの振り分けが
 * 従来の形のままであることを見る。
 */

const accessMocks = vi.hoisted(() => ({
  canAccessAllLineAccounts: vi.fn(),
}))

vi.mock('../services/account-access.js', () => accessMocks)

const { nenMembers } = await import('./nen-members.js')

type Row = Record<string, unknown>

function fakeDb(options: { publications: Row[]; placements: Row[] }) {
  const prepareCalls: string[] = []
  return {
    prepareCalls,
    db: {
      prepare: (sql: string) => ({
        bind: (..._args: unknown[]) => ({
          all: async () => {
            prepareCalls.push(sql)
            if (sql.includes('nen_photo_publication_placements')) {
              return { results: options.placements }
            }
            return { results: options.publications }
          },
          first: async () => null,
          run: async () => ({}),
        }),
      }),
    },
  }
}

const publications = [
  { id: 'pub-1', photo_id: 'ph-1', status: 'published', image_url: 'https://example.com/1.jpg' },
  { id: 'pub-2', photo_id: 'ph-2', status: 'published', image_url: 'https://example.com/2.jpg' },
]

const placements = [
  { publication_id: 'pub-1', id: 'pl-1', placement_type: 'site', placement_label: 'NENコラム', view_count: 10 },
  { publication_id: 'pub-1', id: 'pl-2', placement_type: 'form', placement_label: '回答フォーム', view_count: 3 },
  { publication_id: 'pub-2', id: 'pl-3', placement_type: 'site', placement_label: 'NENコラム', view_count: 7 },
]

function createApp(db: unknown) {
  const app = new Hono<any>()
  app.use('*', async (c, next) => {
    // ownerは閲覧権限の確認を通る（本物のrequirePhotoPermissionを使う）。
    c.set('staff', { id: 'staff-1', role: 'owner', readOnly: false, tenantId: 'tenant-a' })
    c.env = { DB: db }
    await next()
  })
  app.route('/', nenMembers)
  return app
}

beforeEach(() => {
  vi.clearAllMocks()
  accessMocks.canAccessAllLineAccounts.mockResolvedValue(true)
})

describe('掲載一覧の掲載先取得（#500 中・N+1）', () => {
  it('写真が2枚でも掲載先の問い合わせは1回', async () => {
    const fake = fakeDb({ publications, placements })
    const response = await createApp(fake.db).request(
      '/api/nen-members/photos/publications?accountId=account-1',
    )
    expect(response.status).toBe(200)
    const placementQueries = fake.prepareCalls.filter((sql) =>
      sql.includes('nen_photo_publication_placements'),
    )
    expect(placementQueries).toHaveLength(1)
    expect(placementQueries[0]).toContain('IN (')
  })

  it('掲載ごとの振り分けは従来の形のまま', async () => {
    const fake = fakeDb({ publications, placements })
    const response = await createApp(fake.db).request(
      '/api/nen-members/photos/publications?accountId=account-1',
    )
    const body = await response.json() as {
      success: boolean
      data: {
        items: Array<{ placements: Array<Record<string, unknown>> }>
        summary: { publishedCount: number }
      }
    }
    expect(body.success).toBe(true)
    expect(body.data.items).toHaveLength(2)
    // publication_id は振り分け用で、返さない。
    expect(body.data.items[0].placements).toEqual([
      { id: 'pl-1', placement_type: 'site', placement_label: 'NENコラム', view_count: 10 },
      { id: 'pl-2', placement_type: 'form', placement_label: '回答フォーム', view_count: 3 },
    ])
    expect(body.data.items[1].placements).toEqual([
      { id: 'pl-3', placement_type: 'site', placement_label: 'NENコラム', view_count: 7 },
    ])
    expect(body.data.summary.publishedCount).toBe(2)
  })

  it('掲載が0件なら掲載先を取りに行かない', async () => {
    const fake = fakeDb({ publications: [], placements: [] })
    const response = await createApp(fake.db).request(
      '/api/nen-members/photos/publications?accountId=account-1',
    )
    expect(response.status).toBe(200)
    expect(fake.prepareCalls.filter((sql) =>
      sql.includes('nen_photo_publication_placements'),
    )).toHaveLength(0)
    expect(await response.json()).toMatchObject({
      success: true,
      data: { items: [], summary: { publishedCount: 0 } },
    })
  })
})
