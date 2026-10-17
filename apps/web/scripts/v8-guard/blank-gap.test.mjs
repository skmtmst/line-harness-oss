import test from 'node:test'
import assert from 'node:assert/strict'
import { assess, ownerOf } from './blank-gap.mjs'
const finding = excess => ({kind:'vertical',where:'between',excess,container:{sel:'main > div.edit_side__abc123'}})
const result = findings => ({findings,bands:[]})
test('96pxから停止、48〜95pxは参考、除外は止めず横の空きも止める',()=>{
 const r=assess(result([finding(47),finding(48),finding(95),finding(96),{...finding(300),excluded:'preview'},{...finding(300),where:'page-bottom'},{...finding(944),kind:'horizontal'}]),'/test',1152,[])
 assert.equal(r.failures.length,2);assert.equal(r.warnings.length,2);assert.equal(r.excluded.length,2)
})
test('a defect cannot be exempted by its route, owner or previous value',()=>{
 const f=finding(120)
 assert.deepEqual(assess(result([f])).failures,[f])
 assert.deepEqual(assess(result([f])).allowed,[])
})
test('全マスに中身+16より24以上の余りがある時だけ止める',()=>{
 const band=contentH=>({findings:[],bands:[{cardH:[160,160],contentH}]})
 assert.equal(assess(band([120,120]),'/test',1152,[]).failures.length,1)
 assert.equal(assess(band([121,120]),'/test',1152,[]).failures.length,0)
})
