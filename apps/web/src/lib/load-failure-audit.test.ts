import {readFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
import {describe,it,expect} from 'vitest'
// @ts-expect-error JS AST inspector is exercised at runtime.
import {auditLoadFailures,auditScreenLoads,unapprovedLoadFailures} from '../../scripts/load-failure-audit.mjs'
describe("failure versus empty AST guard",()=>{
 it.each([
  'function Page(){ list().catch(()=>setItems([])) }',
  'function Page(){ list().catch(()=>setItems([] as Row[])) }',
  'function Page(){try{await list()}catch{setItems([]);setStatus("ready")}}',
  'function Page(){setItems(response.success ? response.data : [])}',
  'function Page(){if(!response.success){setItems([]);setStatus("ready")}}',
  'function Page(){setItems(result.status === "fulfilled" ? result.value : [])}',
 ])('detects actual failing branches: %s',source=>expect(auditLoadFailures(source).length).toBeGreaterThan(0))
 it('an error reset does not excuse converting failure to ready',()=>{
  const rows=auditLoadFailures('function Page(){list().catch(()=>{setError(null);setItems([]);setStatus("ready")})}')
  expect(unapprovedLoadFailures(rows,[])).toHaveLength(1)
 })
 it('a scoped allowance cannot excuse edits or extra copies',()=>{
  const rows=auditLoadFailures('function Page(){list().catch(()=>setItems([]))}')
  const allow=[{filename:rows[0].filename,fingerprint:rows[0].fingerprint,reason:'人工対照'}]
  expect(unapprovedLoadFailures(rows,allow)).toEqual([])
  expect(unapprovedLoadFailures([...rows,...rows],allow)).toHaveLength(1)
  const changed=auditLoadFailures('function Page(){list().catch(()=>{setItems([]);setStatus("ready")})}')
  expect(unapprovedLoadFailures(changed,allow)).toHaveLength(1)
 })
 it('an error state name alone cannot approve a newly introduced empty failure branch',()=>{
  const rows=auditLoadFailures('function Page(){list().catch(()=>{setItems([]);setError("failed");setStatus("ready")})}')
  expect(unapprovedLoadFailures(rows,[],[])).toHaveLength(1)
  const reviewed=[{...rows[0],reason:'人工対照'}]
  expect(unapprovedLoadFailures(rows,[],reviewed)).toEqual([])
  expect(unapprovedLoadFailures([...rows,...rows],[],reviewed)).toHaveLength(1)
  const changed=auditLoadFailures('function Page(){list().catch(()=>{setItems([]);setError("failed");setStatus("ready");setBusy(false)})}')
  expect(unapprovedLoadFailures(changed,[],reviewed)).toHaveLength(1)
 })
 it('successful empty and loading reset are not failure branches',()=>expect(auditLoadFailures('function Page(){setItems([]);if(response.success){setItems(response.data)}}')).toEqual([]))
 it('the full app and v8 trees contain no unapproved empty failure branches',()=>{
  const root=fileURLToPath(new URL('../../',import.meta.url))
  const allow=JSON.parse(readFileSync(new URL('../../scripts/load-failure-allowlist.json',import.meta.url),'utf8'))
  const reviewed=JSON.parse(readFileSync(new URL('../../scripts/load-failure-reviewed.json',import.meta.url),'utf8'))
  const rows=auditScreenLoads(root)
  expect(unapprovedLoadFailures(rows,allow,reviewed)).toEqual([])
  expect(reviewed.filter((a:{filename:string;fingerprint:string;disposition:string})=>!rows.some((r:{filename:string;fingerprint:string;disposition:string})=>r.filename===a.filename&&r.fingerprint===a.fingerprint&&r.disposition===a.disposition))).toEqual([])
  expect(allow.filter((a:{filename:string;fingerprint:string})=>!rows.some((r:{filename:string;fingerprint:string})=>r.filename===a.filename&&r.fingerprint===a.fingerprint))).toEqual([])
 })
})
