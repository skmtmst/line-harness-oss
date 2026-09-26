/*
 * カード・一覧の中の表は、表の外側の余白を左右で同じにする。
 *
 * 最後の列（札・操作・数字）が右の枠に近すぎる表を全画面で洗い出す作業の
 * 記録。原因は3つに分かれる。
 *
 * - 操作・数字の列が広すぎて中身が左に残る → 列を中身の幅で固定するか、
 *   中身を右へ寄せる（右端の余白＝左端の余白になる）。
 * - ボタンが列からはみ出す → 列をボタン幅まで広げる。
 * - 見出しと本文で外側の余白が違う（Th 12px に対して td px-4 など）→
 *   先頭・末尾のセルに見出し・本文の両方で同じ余白を付ける。
 *
 * 対象外：読み上げ専用の表（bar-chart の srOnly。目に見えない）、
 * 中身が空のとき表自体を出さない画面（空状態の計測は表の余白ではない）。
 */

import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const SRC = path.join(__dirname, '..')

function read(...segments: string[]): string {
  return fs.readFileSync(path.join(SRC, ...segments), 'utf8')
}

/** 注釈を落とす。 */
function code(src: string): string {
  return src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

describe('表の外側の余白の洗い出し', () => {
  it('/accounts：外側は px-5、操作列は固定＋右寄せ', () => {
    const body = code(read('app', 'accounts', 'page.tsx'))
    expect(body).toContain('<Th className="pl-5">アカウント</Th>')
    expect(body).toContain('w-28 pr-5">操作')
    expect(body).toContain('py-3 pr-4 pl-5')
    expect(body).toContain('py-3 pr-5 pl-4 text-right')
  })

  it('/affiliates：外側は px-5、操作列は中身の幅で固定', () => {
    const body = code(read('app', 'affiliates', 'tabs.tsx'))
    expect(body).toContain('<Th className="pl-5">アフィリエイター</Th>')
    expect(body).toContain('w-44 pr-5">操作')
  })

  it('/common-actions：操作列は中身の幅で固定＋右寄せ', () => {
    const body = code(read('app', 'common-actions', 'page.tsx'))
    expect(body).toContain('<Th align="right" className="w-44">操作</Th>')
  })

  it('/ops/audit：IP は右へ寄せる', () => {
    const body = code(read('app', 'ops', 'audit', 'page.tsx'))
    expect(body).toContain('<Th className="w-36" align="right">IP</Th>')
    expect(body).toContain('<Td align="right">')
  })

  it('/ops/members：名前・メールは幅を切らずに吸収する', () => {
    const body = code(read('app', 'ops', 'members', 'page.tsx'))
    expect(body).not.toContain('<Th className="w-72">名前</Th>')
    expect(body).not.toContain('<Th className="w-52">メール</Th>')
  })

  it('/ops/tenants（/ops の行き先）：操作列はボタン幅まで広げる', () => {
    const body = code(read('app', 'ops', 'tenants', 'page.tsx'))
    expect(body).toContain('<Th className="w-36" align="right">操作</Th>')
  })

  it('/ops/dashboard：契約先で吸収し、使用率は右へ寄せる', () => {
    const body = code(read('app', 'ops', 'dashboard', 'page.tsx'))
    expect(body).toContain('<Th>上限に近い契約先</Th>')
    expect(body).toContain('<Th className="w-28" align="right">使用率</Th>')
    expect(body).toContain('<Td align="right">')
  })

  it('/nen-campaigns：操作列はボタンがはみ出さない幅にする', () => {
    const body = code(read('app', 'nen-campaigns', 'nen-overview.tsx'))
    expect(body).toContain('<Th className="w-36 sticky right-0')
    expect(body).toContain('<Th className="w-32 sticky right-0')
  })

  it('/rich-menus：外側は px-5、操作列はボタン幅で固定', () => {
    const body = code(read('app', 'rich-menus', 'page.tsx'))
    expect(body).toContain("width: '12rem'")
    expect(body).toContain('<Th className="pl-5">メニュー</Th>')
    expect(body).toContain('sticky right-0 pr-5">操作')
  })

  it('/ec-commerce：操作列は中身の幅で固定', () => {
    const body = code(read('app', 'ec-commerce', 'page.tsx'))
    expect(body).toContain('<Th align="right" className="w-44">操作</Th>')
  })

  it('/ec-commerce/identity-candidates：操作列は2ボタン幅で固定', () => {
    const body = code(read('app', 'ec-commerce', 'identity-candidates', 'page.tsx'))
    expect(body).toContain('<Th align="right" className="w-56">操作</Th>')
  })

  it('/friends/migrations：外側は px-5、状態の札は固定幅', () => {
    const body = code(read('app', 'friends', 'migrations', 'page.tsx'))
    expect(body).toContain('<Th className="pl-5">日時</Th>')
    expect(body).toContain('<Th className="w-28 pr-5">状態</Th>')
  })

  it('/reminders/new：外側は16pxにそろえ、操作は右へ寄せる', () => {
    const body = code(read('app', 'reminders', 'new', 'page.tsx'))
    expect(body).toContain('<Th className="pl-4">ひな形</Th>')
    expect(body).toContain('<Th align="right" className="pr-4">操作</Th>')
    expect(body).toContain('py-2 pr-2 pl-4')
    expect(body).toContain('py-2 pr-4 pl-2 text-right')
  })

  it('/settings/manual-links：操作は右へ寄せる', () => {
    const body = code(read('app', 'settings', 'manual-links', 'page.tsx'))
    expect(body).toContain('<Th align="right">操作</Th>')
    expect(body).toContain('<Td align="right">')
  })

  it('/duplicates：外側は見出しの余白にそろえ、操作は右へ寄せる', () => {
    const body = code(read('app', 'duplicates', 'page.tsx'))
    // 候補の表（20px）。
    expect(body).toContain('<Th className="pl-5">候補</Th>')
    expect(body).toContain('<Th align="right" className="pr-5">操作</Th>')
    expect(body).toContain('truncate py-3 pr-3 pl-5')
    expect(body).toContain('whitespace-nowrap py-2 pr-5 pl-3 text-right')
    // アカウント別の表（20px）。
    expect(body).toContain('<Th className="pl-5">アカウント</Th>')
    expect(body).toContain('pr-5">重複率')
    expect(body).toContain('truncate py-4 pr-4 pl-5')
    expect(body).toContain('py-4 pr-5 pl-4 text-right tabular-nums')
    // 行列の表（16px。列数が可変のため末尾列は要素指定）。
    expect(body).toContain('<Th className="pl-4">行')
    expect(body).toContain('truncate pr-4')
    expect(body).toContain('[data-duplicates-matrix] tr > :last-child')
  })

  it('/tags・/tags/folders/new：先頭列と操作列の外側をそろえる', () => {
    const body = code(read('components', 'friend-fields', 'tags-page-v4.tsx'))
    expect(body).toContain('<th className="w-11 px-3 py-3" />')
    // 見出し「操作」は2文字で1行のため w-16。外側の余白 px-3 は先頭列とそろえる。
    expect(body).toContain('sticky right-0 w-16 whitespace-nowrap px-3 py-3 text-left">操作')
    expect(body).toContain('cursor-grab px-3 py-3')
  })

  it('/inflow-links：外側は見出しの余白（20px）にそろえる', () => {
    const body = code(read('app', 'inflow-links', 'page.tsx'))
    expect(body).toContain('<col className="w-14" />')
    expect(body).toContain('<col className="w-32" />')
    expect(body).toContain('<Th className="pl-5">')
    expect(body).toContain('<Th align="right" className="pr-5">編集</Th>')
    expect(body).toContain('py-3 pr-2 pl-5')
    expect(body).toContain('py-3 pr-5 pl-2 text-right')
  })

  it('/friends/identity-candidates：外側は20px、採用する値は固定幅', () => {
    const body = code(read('app', 'friends', 'identity-candidates', 'page.tsx'))
    expect(body).toContain('<Th className="pl-5">項目</Th>')
    expect(body).toContain('<Th className="w-36 pr-5">採用する値</Th>')
    expect(body).toContain('<Td className="pl-5">')
    expect(body).toContain('<Td className="pr-5">')
  })

  it('/ops/members：自分自身の行にも「—」を置き、右端を空にしない', () => {
    const body = code(read('app', 'ops', 'members', 'page.tsx'))
    expect(body).toContain('<span className="text-ink-faint text-xs">—</span>')
  })
})
