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
    const body = code(read('v8', 'automations', 'common-actions.tsx'))
    expect(body).toContain('<Th className={styles.colOps}>操作</Th>')
    expect(read('v8', 'automations', 'common-actions.module.css')).toContain('.colOps')
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

  it('/ops/dashboard：契約先で吸収し、使用率は右へ寄せる', () => {
    const body = code(read('app', 'ops', 'dashboard', 'page.tsx'))
    expect(body).toContain('<Th>上限に近い契約先</Th>')
    expect(body).toContain('<Th className="w-28" align="right">使用率</Th>')
    expect(body).toContain('<Td align="right">')
  })

  it('/nen-campaigns：操作列はボタンがはみ出さない幅にする', () => {
    const body = code(read('v8', 'nen-campaigns', 'list.tsx'))
    expect(body.match(/<Th className=\{styles.colMenu\}/g)).toHaveLength(3)
    expect(body.match(/<Td className=\{styles.colMenu\}/g)).toHaveLength(3)
    expect(read('v8', 'nen-campaigns', 'list.module.css')).toContain('width: var(--tpl-nc-menu-size)')
  })

  it('/rich-menus：外側は px-5、操作列はボタン幅で固定', () => {
    const body = code(read('v8', 'rich-menus', 'list.tsx'))
    expect(body).toContain('className={styles.menuCell}')
    const css = read('v8', 'rich-menus', 'list.module.css')
    expect(css).toContain('.colMenu { width: var(--tpl-rml-col-menu); }')
    expect(css).toContain('justify-content: flex-end')
  })

  it('/ec-commerce：操作列は中身の幅で固定', () => {
    const body = code(read('app', 'ec-commerce', 'page.tsx'))
    expect(body).toContain('<Th align="right" className="w-44">操作</Th>')
  })

  it('/ec-commerce/identity-candidates：操作列は2ボタン幅で固定', () => {
    const body = code(read('app', 'ec-commerce', 'identity-candidates', 'page.tsx'))
    expect(body).toContain('<Th align="right" className="w-56">操作</Th>')
  })

  it('/friends/migrations：V8の表は左右のセル余白を設計値で保つ', () => {
    const css = read('v8', 'friends', 'migrations', 'migrations.module.css')
    expect(css).toMatch(/\.table thead th\.th:first-child[^{]*\{[^}]*padding-left: var\(--tpl-fr-cell-inset\)/)
    expect(css).toMatch(/\.table td\.td:last-child[^{]*\{[^}]*padding-right: var\(--tpl-fr-cell-inset\)/)
  })

  it('/duplicates：外側は見出しの余白にそろえ、操作は右へ寄せる', () => {
    const body = code(read('app', 'duplicates', 'duplicates-v8.tsx'))
    expect(body).toContain('<th>操作</th>')
    expect(body).toContain('className={styles.linkAction}')
    expect(read('app', 'friends', 'friends-v8.module.css')).toContain('.table td')
    expect(read('app', 'friends', 'friends-v8.module.css')).toContain('.linkAction')
    expect(body).toContain('candidate.left.label')
    expect(body).toContain('candidate.right.label')

  })

  it('/tags・/tags/folders/new：先頭列と操作列の外側をそろえる', () => {
    const body = code(read('components', 'friend-fields', 'tags-page-v4.tsx'))
    // 共通 Th（余白 12px＝px-3 を持つ）へ寄せた後は幅だけ指定する。
    // 先頭列 w-11（44px）、操作列は編集＋…の2点分の128px（64pxでは枠付きボタンが切れる。m21o・m22b）。
    expect(body).toContain('<Th style={{ width: 44 }}>')
    expect(body).toContain('<Th style={{ width: 128 }} className="sticky right-0')
    expect(body).toContain('>操作</Th>')
    expect(body).toContain('cursor-grab')
  })

  it('/friends/identity-candidates：V8の表は左右のセル余白を設計値で保つ', () => {
    const css = read('v8', 'friends', 'compare', 'compare.module.css')
    expect(css).toMatch(/\.table thead th\.th:first-child[^{]*\{[^}]*padding-left: var\(--tpl-fr-cell-inset\)/)
    expect(css).toMatch(/\.table td\.td:last-child[^{]*\{[^}]*padding-right: var\(--tpl-fr-cell-inset\)/)
  })

  it('/ops/members：自分自身の行にも「—」を置き、右端を空にしない', () => {
    const body = code(read('app', 'ops', 'members', 'page.tsx'))
    expect(body).toContain('<span className="text-ink-faint text-xs">—</span>')
  })
})
