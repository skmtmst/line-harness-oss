import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const directory = dirname(fileURLToPath(import.meta.url))
const staffSource = readFileSync(join(directory, 'page.tsx'), 'utf8')
const newStaffSource = readFileSync(join(directory, 'new/page.tsx'), 'utf8')
const switchSource = readFileSync(join(directory, '../../components/ui/notification-switch.tsx'), 'utf8')

describe('V6 30 ログインユーザーの画面契約', () => {
  it('4つのV6実Nodeと共通タブを実URLへ接続する', () => {
    expect(staffSource).toContain('data-design-node="e3jz3"')
    expect(staffSource).toContain('data-design-node="EOTS4"')
    expect(staffSource).toContain('data-design-node="jwVlo"')
    expect(newStaffSource).toContain('data-design-node="I3ZSrU"')
    expect(staffSource).toContain('<MergedTabs')
    expect(staffSource).toContain("{ key: 'audit', label: '入った記録' }")
  })

  it('画面名は共通トップバーだけに置き、本文へ重ねない', () => {
    expect(staffSource).not.toContain("import Header from '@/components/layout/header'")
    expect(newStaffSource).toContain('showHeader={false}')
  })

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

  it('不要な導線と追加画面の記入例を表示しない', () => {
    expect(staffSource).not.toContain('権限を編集')
    expect(staffSource).not.toContain('設定を促す')
    expect(newStaffSource).not.toContain('山本 恭平')
    expect(newStaffSource).not.toContain('yamamoto@example.com')
  })

  it('利用停止を主操作にし、監査履歴を消す物理削除は出さない', () => {
    expect(staffSource).toContain('このユーザーを無効にする')
    expect(staffSource).toContain('このユーザーを有効にする')
    expect(staffSource).not.toContain('このユーザーを完全に削除する')
    expect(staffSource).not.toContain('完全に削除する')
  })

  it('一覧は1440pxで横スクロールさせない7列の固定表にする', () => {
    expect(staffSource).toContain('w-full table-fixed text-sm')
    expect(staffSource).toContain('colSpan={7}')
    expect(staffSource).not.toContain('min-w-[1180px]')
  })
})
