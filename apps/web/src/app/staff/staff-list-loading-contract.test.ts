import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const directory = dirname(fileURLToPath(import.meta.url))
const staffSource = readFileSync(join(directory, 'page.tsx'), 'utf8')

describe('V6 30 一覧の読み方(#572 #515中2)', () => {
  it('入った記録は「入った記録」タブでだけ読む', () => {
    // 親の先読みと表の再取得の二重取りをやめる。
    expect(staffSource).toContain("if (tab !== 'audit') return")
    expect(staffSource).toContain('api.audit.events({ lineAccountId: selectedAccountId ?? undefined, limit: 200 })')
    expect(staffSource).not.toContain('api.audit.events({ lineAccountId: scope, limit: 200 })')
  })

  it('200件打ち切りは黙って切らず注記する', () => {
    expect(staffSource).toContain('setUsersTotal(usersResult.data.pagination?.total')
    expect(staffSource).toContain('全${usersTotal}人中${accessUsers.length}人まで読み込み')
  })
})
