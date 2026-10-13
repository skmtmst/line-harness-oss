import { describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
// @ts-expect-error Node のソース検査を同じ故障注入で確認する。
import { inspectB244Source, inspectB244Tree } from '../../scripts/verify-b244.mjs'

describe('B-244/245 ソースの見張り', () => {
  it('必須・任意の矛盾と保存検査の定義抜けを止める', () => {
    expect(inspectB244Source('<Field required optional />').map((r: {kind:string}) => r.kind)).toEqual(['requirement-conflict'])
    expect(inspectB244Source("fields.define('name','名前',check); <Field requirement={fields.requirement('name')} />").map((r: {kind:string}) => r.kind)).toEqual(['requirement-without-definition'])
    expect(inspectB244Source("fields.define('name','名前',check,{required:true}); <Field requirement={fields.requirement('name')} />")).toEqual([])
  })
  it('一覧の常設の案内だけを止め、状態の知らせと確認の窓は残す', () => {
    expect(inspectB244Source('<ListPage><Notice tone="info">毎回出る説明</Notice></ListPage>').map((r: {kind:string}) => r.kind)).toEqual(['permanent-list-notice'])
    expect(inspectB244Source('<ListPage>{unset && <Notice tone="info">未設定</Notice>}<Dialog><Notice tone="info">確認</Notice></Dialog></ListPage>')).toEqual([])
  })
  it('読み込んだフックが返す同じ欄定義だけを追い、定義抜けと別の欄への取り違えは止める', () => {
    const root = mkdtempSync(join(tmpdir(), 'b244-hook-'))
    try {
      mkdirSync(join(root, 'src/v8/settings'), { recursive: true })
      mkdirSync(join(root, 'src/app'), { recursive: true })
      const hook = join(root, 'src/v8/settings/use-config.ts')
      const screen = join(root, 'src/v8/settings/screen.tsx')
      writeFileSync(screen, "import {useConfig as useSettings} from './use-config'; const {configFields:fields}=useSettings(); <Field requirement={fields.requirement('name')}/>;")
      writeFileSync(hook, "export function useConfig(){const errors=useFormErrors(); errors.define('name','名前',check,{required:true}); return {configFields:errors}}")
      expect(inspectB244Tree(root).errors).toEqual([])
      for (const source of [
        "export function useConfig(){const errors=useFormErrors(); errors.define('name','名前',check); return {configFields:errors}}",
        "export function useConfig(){const errors=useFormErrors(); errors.define('other','別の欄',check,{required:true}); return {configFields:errors}}",
        "export function useConfig(){const errors=useFormErrors(); errors.define('name','名前',check,{required:true}); return {otherFields:errors}}",
        "export function otherHook(){errors.define('name','名前',check,{required:true}); return {configFields:errors}} export function useConfig(){return {configFields:unrelated}}",
        "export function useConfig(){function unrelated(){errors.define('name','名前',check,{required:true})} return {configFields:errors}}",
      ]) {
        writeFileSync(hook, source)
        expect(inspectB244Tree(root).errors.map((r: {kind:string}) => r.kind)).toEqual(['requirement-without-definition'])
      }
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
  it('対象の全V8ファイルに違反がない', () => {
    expect(inspectB244Tree(new URL('../..', import.meta.url).pathname).errors).toEqual([])
  })
})
