import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const directory = dirname(fileURLToPath(import.meta.url))
const staffSource = readFileSync(join(directory, 'page.tsx'), 'utf8')
const newStaffSource = readFileSync(join(directory, 'new/page.tsx'), 'utf8')
const switchSource = readFileSync(join(directory, '../../components/ui/notification-switch.tsx'), 'utf8')

describe('V2 10-2 ログインユーザーのPen表示', () => {
  it('集計カードをPenの105px高と文字階層に固定する', () => {
    expect(staffSource).toContain('h-[105px]')
    expect(staffSource).toContain('rounded-[18px]')
    expect(staffSource).toContain('p-[15px]')
    expect(staffSource).toContain('gap-[5px]')
    expect(staffSource).toContain('text-xl font-bold leading-[1.45]')
    expect(staffSource).toContain('text-[11px] leading-[1.45]')
  })

  it('V2 10-2と10-2-1でPen寸法の通知スイッチを共通利用する', () => {
    expect(staffSource).toContain("@/components/ui/notification-switch")
    expect(newStaffSource).toContain("@/components/ui/notification-switch")
    expect(switchSource).toContain('h-5 w-[34px]')
    expect(switchSource).toContain('left-0.5 top-0.5 h-4 w-4')
    expect(switchSource).toContain("translate-x-[14px]")
    expect(switchSource).toContain('overflow-hidden')
  })
})
