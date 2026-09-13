import Database from 'better-sqlite3'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  join(import.meta.dirname, '..', 'migrations', '294_ec_connectors.sql'),
  'utf8',
)

function database() {
  const sqlite = new Database(':memory:')
  sqlite.pragma('foreign_keys = ON')
  sqlite.exec('CREATE TABLE line_accounts (id TEXT PRIMARY KEY)')
  sqlite.exec("INSERT INTO line_accounts (id) VALUES ('account-a'), ('account-b')")
  sqlite.exec(migration)
  return sqlite
}

describe('migration 294 EC connectors', () => {
  it('stores one account-scoped connector without plaintext secrets', () => {
    const sqlite = database()
    sqlite.prepare(`INSERT INTO ec_connectors
      (id, line_account_id, provider, shop_domain, inbound_secret_encrypted,
       inbound_secret_last4, event_types_json, identity_rules_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        'connector-a', 'account-a', 'shopify', 'nen-store.myshopify.com',
        'v1.encrypted.value', '8f3a', '["ec.order.confirmed"]',
        '["verified_email"]', '2026-09-06', '2026-09-06',
      )

    const columns = sqlite.prepare('PRAGMA table_info(ec_connectors)').all() as Array<{ name: string }>
    expect(columns.map((column) => column.name)).not.toContain('inbound_secret')
    expect(sqlite.prepare('SELECT inbound_secret_last4 FROM ec_connectors').get()).toEqual({
      inbound_secret_last4: '8f3a',
    })
    expect(() => sqlite.prepare(`INSERT INTO ec_connectors
      (id, line_account_id, provider, shop_domain, created_at, updated_at)
      VALUES ('connector-b', 'account-a', 'ec_cube', 'shop.example', '2026-09-06', '2026-09-06')`).run())
      .toThrow(/UNIQUE/)
    sqlite.close()
  })

  it('rejects unknown providers, states and malformed rule lists', () => {
    const sqlite = database()
    const insert = sqlite.prepare(`INSERT INTO ec_connectors
      (id, line_account_id, provider, shop_domain, status, event_types_json,
       identity_rules_json, created_at, updated_at)
      VALUES (?, 'account-a', ?, 'shop.example', ?, ?, '[]', '2026-09-06', '2026-09-06')`)
    expect(() => insert.run('bad-provider', 'stripe', 'connected', '[]')).toThrow(/CHECK/)
    expect(() => insert.run('bad-state', 'shopify', 'stopped', '[]')).toThrow(/CHECK/)
    expect(() => insert.run('bad-json', 'shopify', 'connected', '{}')).toThrow(/CHECK/)
    sqlite.close()
  })
})
