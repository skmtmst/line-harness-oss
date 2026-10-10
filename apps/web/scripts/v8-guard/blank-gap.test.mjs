import test from 'node:test'
import assert from 'node:assert/strict'
import { assess, ownerOf } from './blank-gap.mjs'
const finding = excess => ({kind:'vertical',where:'between',excess,container:{sel:'main > div.edit_side__abc123'}})
const result = findings => ({findings,bands:[]})
test('96pxから停止、48〜95pxは参考、除外は止めず横の空きも止める',()=>{
 const r=assess(result([finding(47),finding(48),finding(95),finding(96),{...finding(300),excluded:'preview'},{...finding(300),where:'page-bottom'},{...finding(944),kind:'horizontal'}]),'/test',1152,[])
 assert.equal(r.failures.length,2);assert.equal(r.warnings.length,2);assert.equal(r.excluded.length,2)
})
test('許容は画面・幅・持ち主・上限が一致するものだけ',()=>{
 const f=finding(120), allowances=[{route:'/test',width:1152,owner:ownerOf(f),maxExcess:120,reason:'確認待ち'}]
 assert.equal(assess(result([f]),'/test',1152,allowances).allowed.length,1)
 for(const [route,width,excess] of [['/other',1152,120],['/test',1440,120],['/test',1152,121]])assert.equal(assess(result([finding(excess)]),route,width,allowances).failures.length,1)
})
test('全マスに中身+16より24以上の余りがある時だけ止める',()=>{
 const band=contentH=>({findings:[],bands:[{cardH:[160,160],contentH}]})
 assert.equal(assess(band([120,120]),'/test',1152,[]).failures.length,1)
 assert.equal(assess(band([121,120]),'/test',1152,[]).failures.length,0)
})
