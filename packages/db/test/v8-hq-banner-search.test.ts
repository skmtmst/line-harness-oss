import { expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { readFileSync } from 'node:fs'
import { asD1 } from './d1-test-helper'
import { countBannerImages, createBannerProject, createBannerImage, listBannerImages } from '../src/banner-generation'
import { createMedia } from '../src/media/index'

it('全件検索の総数はページ位置で変わらず、配布先が複数でも画像は一件になる', async () => {
  const raw = new Database(':memory:')
  try {
    raw.exec(readFileSync(new URL('../bootstrap.sql', import.meta.url), 'utf8'))
    const db = asD1(raw), tenantId = 't'
    raw.prepare('INSERT INTO tenants(id,name) VALUES (?,?)').run(tenantId,'試験')
    const project = await createBannerProject(db, { tenantId, name: '秋の画像' })
    raw.exec("INSERT INTO tenants(id,name) VALUES('other','別'); INSERT INTO line_accounts(id,tenant_id,channel_id,name,channel_access_token,channel_secret) VALUES('foreign','other','foreign','別','x','x')")
    const foreign = await createMedia(db, {kind:'image',lineAccountId:'foreign',filename:'x.png',mimeType:'image/png',sizeBytes:1,r2Key:'foreign/key'})
    await expect(createBannerImage(db,{tenantId,projectId:project.id,mediaId:foreign.id,generationId:null,sequence:1,source:'upload'})).rejects.toThrow('media_cross_tenant_reference')
    for (let i = 0; i < 3; i++) {
      const media = await createMedia(db, { kind: 'image', lineAccountId: null, filename: `image-${i}.png`, mimeType: 'image/png', sizeBytes: 10, r2Key: `test/${i}` })
      await createBannerImage(db, { tenantId, projectId: project.id, mediaId: media.id, generationId: null, sequence: i + 1, source: 'upload' })
    }
    const list = await listBannerImages(db, { tenantId, query: '秋の画像', limit: 1 })
    expect(list).toHaveLength(1)
    expect(await countBannerImages(db, { tenantId, query: '秋の画像', before: list[0].created_at })).toEqual({ all: 3, favorite: 0, delivered: 0, unused: 3 })
    expect(await listBannerImages(db, { tenantId: 'other', query: '秋の画像' })).toEqual([])
  } finally { raw.close() }
})
