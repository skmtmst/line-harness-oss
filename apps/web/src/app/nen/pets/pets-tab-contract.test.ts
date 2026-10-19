import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
const HERE = dirname(fileURLToPath(import.meta.url))
const PAGE = readFileSync(join(HERE,'../../../v8/nen-pets/list.tsx'),'utf8')
const CSS = readFileSync(join(HERE,'../../../v8/nen-pets/pets.module.css'),'utf8')
const PARTS = readFileSync(join(HERE,'../../../v8/nen-pets/parts.tsx'),'utf8')
describe('V8 ペット一覧の操作と狭幅', () => {
 it('操作列は共通のメニュー1つの幅を先に確保する', () => {
 expect(CSS).toMatch(/\.colMenu \{ width: var\(--tpl-nph-menu-size\); \}/)
 expect(PAGE).toContain('<Th className={styles.colMenu}>')
 expect(PAGE).toContain('<Td className={styles.colMenu}>')
 })
 it('操作は共通の行メニューにまとめる', () => {
 expect(PAGE).toContain('<RowMenu subject={name} items={items} />')
 expect(PARTS).toContain('SharedRowMenu')
 })
 it('狭い板でも行の操作は同じ共通メニューで行う', () => {
 expect(PAGE.match(/<RowMenu subject=/g)).toHaveLength(1)
 expect(PARTS).toContain("from '@/components/shared/row-actions'")
 })
 it('操作の幅は見出しと行で揃えてはみ出さない', () => {
 expect(PAGE.match(/styles.colMenu/g)).toHaveLength(2)
 expect(CSS).toMatch(/> th,\s*[\s\S]*?> td \{[^}]*min-width: 0/)
 })
 it('狭い容器では年齢・避妊去勢・運動量を見出しと行で畳む', () => {
 expect(CSS).toContain('@container v8-page (max-width: 1099px)')
 for (const column of ['Age','Neutered','Activity']) {
 expect(CSS).toContain('th.col'+column)
 expect(CSS).toContain('td.col'+column)
 }
 })
 it('短い値は1行省略し、全文も読める', () => {
 expect(CSS).toMatch(/\.cell \{[^}]*text-overflow: ellipsis;[^}]*white-space: nowrap/)
 expect(PAGE).toContain('title={NEUTERED_LABEL[pet.neutered]}')
 expect(PAGE).toContain('title={pet.activityLabel}')
 expect(PAGE).toContain("title={pet.productName ?? '（未設定）'}")
 })
})
