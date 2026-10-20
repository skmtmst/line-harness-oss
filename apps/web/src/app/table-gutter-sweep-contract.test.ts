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
  it('/accounts：列はV8の板の幅で固定し、操作は1つのメニューにする', () => {
    const body = code(read('v8', 'settings', 'accounts', 'accounts.tsx'))
    const css = read('v8', 'settings', 'accounts', 'accounts.module.css')
    expect(body).toContain('<Th className={styles.colName}>アカウント</Th>')
    expect(body).toContain('<Th className={styles.colMenu}>')
    expect(css).toContain('.colMenu { flex: 0 0 var(--tpl-sa-acc-menu-w); }')
  })

  it('/affiliates：外側はV8の板の余白、操作列は中身の幅で固定', () => {
    const body = code(read('v8', 'affiliates', 'affiliators.tsx'))
    const css = read('v8', 'affiliates', 'affiliates.module.css')
    expect(body).toContain('<Th grow>アフィリエイター</Th>')
    expect(body).toContain('<Th className={styles.colOps}>操作</Th>')
    const frame = read('v8', 'affiliates', 'frame.tsx')
    expect(body).toContain('columnLayout={AFFILIATE_TABLE_LAYOUT}')
    expect(frame).toContain("padding: '0 var(--tpl-list-inset)'")
    expect(frame).toContain("bodyTextSize: 'var(--polish-text-body)'")
    expect(css).toContain('.colOps { width: var(--tpl-af-col-ops); }')
  })

  it('/common-actions：操作列は中身の幅で固定＋右寄せ', () => {
    const body = code(read('v8', 'automations', 'common-actions.tsx'))
    expect(body).toContain('<Th className={styles.colOps}>操作</Th>')
    expect(read('v8', 'automations', 'common-actions.module.css')).toContain('.colOps')
  })

  it('/ops/members：名前は残りの幅を使い、名前とメールの全文を確認できる', () => {
    const body = code(read('v8', 'ops', 'members.tsx'))
    expect(body).toContain('<GridNameCell folder={false}')
    expect(body).toContain("columns: 'minmax(0, 1fr) minmax(0, 1fr)")
    expect(body).toContain('<TruncatedText value={m.email')
    expect(read('v8', 'ops', 'parts.module.css')).toMatch(/\.grow\s*\{[^}]*min-width: 0;[^}]*flex: 1;/)
  })

  it('/ops/dashboard：契約先で吸収し、使用率は右へ寄せる', () => {
    const body = code(read('v8', 'ops', 'dashboard.tsx'))
    expect(body).toContain('<GridCell role="columnheader">契約先</GridCell>')
    expect(body).toContain("columns: 'minmax(0, 1fr)")
    expect(body.match(/<GridCell align="right" title=/g)).toHaveLength(3)
    expect(read('v8', 'ops', 'parts.module.css')).toMatch(/\.num\s*\{[^}]*text-align: right;/)
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

  it('/ec-commerce：操作は行メニューにまとめる', () => {
    const body = code(read('v8', 'settings', 'ec-commerce', 'screen.tsx'))
    expect(body).toContain('<Th><span className={styles.srOnly}>操作</span></Th>')
    expect(body).toContain('<RowMenu')
  })

  it('/friends/migrations：V8の表は左右のセル余白を設計値で保つ', () => {
    const css = read('v8', 'friends', 'migrations', 'migrations.module.css')
    expect(css).toMatch(/\.table thead th\.th:first-child[^{]*\{[^}]*padding-left: var\(--tpl-fr-cell-inset\)/)
    expect(css).toMatch(/\.table td\.td:last-child[^{]*\{[^}]*padding-right: var\(--tpl-fr-cell-inset\)/)
  })

  it('/duplicates：外側は見出しの余白にそろえ、操作は右へ寄せる', () => {
    const body = code(read("app/duplicates/list-screen.tsx"))
    expect(body).toContain('<th>操作</th>')
    expect(body).toContain('className={styles.linkAction}')
    expect(read("app/friends/friends-v8.module.css")).toContain('.table td')
    expect(read("app/friends/friends-v8.module.css")).toContain('.linkAction')
    expect(body).toContain('candidate.left.label')
    expect(body).toContain('candidate.right.label')

  })

  it('/tags・/tags/folders/new：先頭列と操作列の外側をそろえる', () => {
    const body = code(read('v8', 'tags', 'tags-tab.tsx'))
    // 共通 Th（余白 12px＝px-3 を持つ）へ寄せた後は幅だけ指定する。
    // 先頭列 w-11（44px）、操作列は編集＋…の2点分の128px（64pxでは枠付きボタンが切れる。m21o・m22b）。
    expect(body).toContain('<Th className={styles.colName}>タグ</Th>')
    expect(body).toContain('<Th className={styles.colMenu}>')
    expect(body).toContain('<span className="sr-only">操作</span>')
    expect(body).toContain('<ReorderHandle')
  })

  it('/friends/identity-candidates：V8の表は左右のセル余白を設計値で保つ', () => {
    const css = read('v8', 'friends', 'compare', 'compare.module.css')
    expect(css).toMatch(/\.table thead th\.th:first-child[^{]*\{[^}]*padding-left: var\(--tpl-fr-cell-inset\)/)
    expect(css).toMatch(/\.table td\.td:last-child[^{]*\{[^}]*padding-right: var\(--tpl-fr-cell-inset\)/)
  })

  it('/ops/members：自分自身は理由付き操作、閲覧のみは操作を出さない', () => {
    const body = code(read('v8', 'ops', 'members.tsx'))
    expect(body).toContain('readOnly ? null : self ? <RowActions')
    expect(body).toContain("disabled: true, title: '自分の運営アカウントは停止・取り消しできません'")
  })
})
