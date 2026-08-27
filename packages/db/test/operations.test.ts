import Database from 'better-sqlite3'
import { beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  getOperationControlSet,
  isOperationCapabilityStopped,
  listOperationTargetResults,
  listOperationIncidents,
  restoreOperationIncident,
  stopOperationCapabilities,
} from '../src/operations.js'
import { asD1 } from './d1-test-helper.js'

let sqlite: Database.Database
let db: D1Database

beforeEach(() => {
  sqlite = new Database(':memory:')
  sqlite.exec(readFileSync(join(import.meta.dirname, '..', 'bootstrap.sql'), 'utf8'))
  sqlite.prepare("INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret) VALUES ('account-1', 'channel', 'LINE', 'token', 'secret')").run()
  db = asD1(sqlite)
})

describe('サーバー正本の緊急停止', () => {
  it('停止対象を1回の版更新で保存し、全体停止をアカウント送信にも効かせる', async () => {
    const stopped = await stopOperationCapabilities(db, {
      lineAccountId: null,
      capabilities: ['broadcast_dispatch', 'scenario_dispatch', 'reminder_dispatch'],
      expectedVersion: 0,
      actorId: 'owner-1',
      reason: '誤配信の防止',
    })
    expect(stopped.status).toBe('changed')
    expect(await isOperationCapabilityStopped(db, 'account-1', 'broadcast_dispatch')).toBe(true)
    expect(await isOperationCapabilityStopped(db, 'account-1', 'automation_actions')).toBe(false)
    expect((await getOperationControlSet(db, null)).version).toBe(1)
  })

  it('古い版の停止を拒否し、先に入った停止を上書きしない', async () => {
    await stopOperationCapabilities(db, {
      lineAccountId: 'account-1', capabilities: ['broadcast_dispatch'],
      expectedVersion: 0, actorId: 'owner-1', reason: '障害対応',
    })
    const stale = await stopOperationCapabilities(db, {
      lineAccountId: 'account-1', capabilities: ['scenario_dispatch'],
      expectedVersion: 0, actorId: 'owner-2', reason: '別の停止',
    })
    expect(stale.status).toBe('conflict')
    const current = await getOperationControlSet(db, 'account-1')
    expect(current.states.broadcast_dispatch).toBe('stopped')
    expect(current.states.scenario_dispatch).toBe('running')
    expect((await listOperationIncidents(db, { accountIds: ['account-1'], includeGlobal: false })))
      .toHaveLength(2)
  })

  it('停止した対象だけを復旧し、履歴を消さない', async () => {
    const stopped = await stopOperationCapabilities(db, {
      lineAccountId: 'account-1', capabilities: ['broadcast_dispatch', 'reminder_dispatch'],
      expectedVersion: 0, actorId: 'owner-1', reason: 'メンテナンス',
    })
    if (stopped.status !== 'changed') throw new Error('stop failed')
    const restored = await restoreOperationIncident(db, {
      incidentId: stopped.incident.id,
      expectedVersion: stopped.control.version,
      actorId: 'owner-2',
    })
    expect(restored.status).toBe('changed')
    expect(await isOperationCapabilityStopped(db, 'account-1', 'broadcast_dispatch')).toBe(false)
    const history = await listOperationIncidents(db, { accountIds: ['account-1'], includeGlobal: false })
    expect(history[0]).toMatchObject({
      id: stopped.incident.id,
      status: 'resolved',
      actorId: 'owner-1',
      resolvedByActorId: 'owner-2',
    })
    expect(history[0].resolvedAt).not.toBeNull()
  })

  it('停止中の制御データが壊れた場合は送信を再開しない', async () => {
    const stopped = await stopOperationCapabilities(db, {
      lineAccountId: 'account-1', capabilities: ['broadcast_dispatch'],
      expectedVersion: 0, actorId: 'owner-1', reason: '障害対応',
    })
    expect(stopped.status).toBe('changed')
    sqlite.prepare("UPDATE operation_control_sets SET states_json = '{broken' WHERE scope_key = 'account-1'").run()
    expect(await isOperationCapabilityStopped(db, 'account-1', 'broadcast_dispatch')).toBe(true)
    const visible = await getOperationControlSet(db, 'account-1')
    expect(visible.activeIncidentId).not.toBeNull()
    expect(Object.values(visible.states).every((state) => state === 'stopped')).toBe(true)
  })

  it('停止中に保留した対象をincidentへ1回だけ記録する', async () => {
    const stopped = await stopOperationCapabilities(db, {
      lineAccountId: 'account-1', capabilities: ['broadcast_dispatch'],
      expectedVersion: 0, actorId: 'owner-1', reason: '障害対応',
    })
    if (stopped.status !== 'changed') throw new Error('stop failed')
    const target = { targetType: 'broadcast', targetId: 'broadcast-1', result: 'held' as const }
    expect(await isOperationCapabilityStopped(db, 'account-1', 'broadcast_dispatch', target)).toBe(true)
    expect(await isOperationCapabilityStopped(db, 'account-1', 'broadcast_dispatch', target)).toBe(true)
    expect(await listOperationTargetResults(db, stopped.incident.id)).toEqual([
      expect.objectContaining({
        incidentId: stopped.incident.id,
        capability: 'broadcast_dispatch',
        targetType: 'broadcast',
        targetId: 'broadcast-1',
        result: 'held',
      }),
    ])
    expect((await listOperationIncidents(db, { accountIds: ['account-1'], includeGlobal: false }))[0]?.targetCounts)
      .toEqual({ held: 1, skippedDueToEmergency: 0, inFlight: 0, failed: 0 })
  })
})
