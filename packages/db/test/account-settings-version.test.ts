import Database from 'better-sqlite3'
import { beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  getVersionedAccountSetting,
  saveVersionedAccountSetting,
} from '../src/account-settings.js'
import { asD1 } from './d1-test-helper.js'

let sqlite: Database.Database
let db: D1Database

beforeEach(() => {
  sqlite = new Database(':memory:')
  sqlite.exec(readFileSync(join(import.meta.dirname, '..', 'bootstrap.sql'), 'utf8'))
  sqlite.prepare("INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret) VALUES ('account-1', 'channel', 'LINE', 'token', 'secret')").run()
  db = asD1(sqlite)
})

describe('版つきアカウント設定', () => {
  it('設定一式を1行で保存し、版を進める', async () => {
    const first = await saveVersionedAccountSetting(db, {
      accountId: 'account-1', key: 'feature.settings_bundle_v1', expectedVersion: 0,
      data: { features: { scenarios: true }, sidebarItemOrder: { delivery: ['scenarios'] } },
    })
    expect(first).toMatchObject({ status: 'saved', setting: { version: 1 } })

    const second = await saveVersionedAccountSetting(db, {
      accountId: 'account-1', key: 'feature.settings_bundle_v1', expectedVersion: 1,
      data: { features: { scenarios: false }, sidebarItemOrder: { delivery: ['scenarios'] } },
    })
    expect(second).toMatchObject({ status: 'saved', setting: { version: 2 } })
    expect(await getVersionedAccountSetting(db, 'account-1', 'feature.settings_bundle_v1'))
      .toMatchObject({ version: 2, data: { features: { scenarios: false } } })
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM account_settings WHERE line_account_id = 'account-1' AND key = 'feature.settings_bundle_v1'").get())
      .toEqual({ count: 1 })
  })

  it('古い版からの保存は新しい設定を上書きしない', async () => {
    await saveVersionedAccountSetting(db, {
      accountId: 'account-1', key: 'feature.settings_bundle_v1', expectedVersion: 0,
      data: { features: { scenarios: true } },
    })
    const conflict = await saveVersionedAccountSetting(db, {
      accountId: 'account-1', key: 'feature.settings_bundle_v1', expectedVersion: 0,
      data: { features: { scenarios: false } },
    })

    expect(conflict).toMatchObject({ status: 'conflict', current: { version: 1 } })
    expect(await getVersionedAccountSetting(db, 'account-1', 'feature.settings_bundle_v1'))
      .toMatchObject({ version: 1, data: { features: { scenarios: true } } })
  })
})
