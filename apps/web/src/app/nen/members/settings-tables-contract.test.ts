import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
const HERE = dirname(fileURLToPath(import.meta.url))
const RANK = readFileSync(join(HERE,'../../../v8/nen-members/ranks.tsx'),'utf8')
const LIFETIME = readFileSync(join(HERE,'../../../v8/nen-members/lifetime.tsx'),'utf8')
const MEMBERS = readFileSync(join(HERE,'../../../v8/nen-members/list.tsx'),'utf8')
const CSS = readFileSync(join(HERE,'../../../v8/nen-members/members.module.css'),'utf8')
describe('V8 会員設定の狭幅と列幅', () => {
 it('ランク設定は狭い区画で同期の欄を畳み、入力を縮められる', () => {
 expect(CSS).toMatch(/@container \(max-width: 900px\)[\s\S]*?\.rankSplit/)
 expect(CSS).toMatch(/\.rankColName\s*\{[^}]*min-width: 0/)
 expect(RANK).toContain('styles.rankColAction')
 })
 it('ライフタイムの説明は省略して全文も読める', () => {
 expect(LIFETIME).toContain("title={row.benefit ?? ''}")
 expect(CSS).toMatch(/\.lifeColBenefit\s*\{[^}]*text-overflow: ellipsis/)
 expect(CSS).toMatch(/\.lifeColTitle\s*\{[^}]*min-width: 0/)
 })
 it('ランクの見出しと行は同じ列の幅を使う', () => {
 expect(CSS).toMatch(/\.rankHeadRow,\s*\.rankRow\s*\{/)
 })
 it('ライフタイムの見出しと行は同じ列の幅を使う', () => {
 expect(CSS).toMatch(/\.lifeHeadRow,\s*\.lifeRow,/)
 })
 it('会員一覧は見出しと行に同じグリッドを使う', () => {
 expect(MEMBERS).toContain("columns: 'var(--tpl-rest3-mb-cols)'")
 expect(MEMBERS).toContain('<GridHeadRow className={`${styles.mRow}')
 expect(MEMBERS).toContain('<GridRow className={styles.mRow}')
 })
 it('一覧の畳む列は見出しと行の両方に指定する', () => {
 const head=MEMBERS.slice(MEMBERS.indexOf('<GridHeadRow'),MEMBERS.indexOf('</GridHeadRow>'))
 const body=MEMBERS.slice(MEMBERS.indexOf('function MemberRow'))
 expect(head.match(/styles.mWide/g)).toHaveLength(2)
 expect(body.match(/styles.mWide/g)).toHaveLength(2)
 })
})
