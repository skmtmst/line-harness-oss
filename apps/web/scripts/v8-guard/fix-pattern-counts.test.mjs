import test from 'node:test'
import assert from 'node:assert/strict'
import { countFixPatterns,countTable } from './fix-pattern-counts.mjs'

test('counting retains clipping and overlap defects without allowances',()=>{
  const zero=Object.fromEntries(Array.from({length:10},(_,i)=>[`F${i+1}`,0]))
  const r=countFixPatterns({counts:zero,findings:[]},{failures:['B-191 選ぶ欄の文字切れ','U5 道具の重なり']},{failures:[{kind:'clip',text:'20件表示'}]})
  assert.equal(r.counts.F1,2);assert.equal(r.counts.F2,0);assert.equal(r.counts.F6,1)
})
test('an unmeasured case has empty cells and cannot become a passing zero',()=>{
  const t=countTable([{board:'x',route:'/x',width:1152,error:'No page template',errors:[],writes:[]}])
  assert.ok(t.includes('unmeasured: No page template'))
  const values=t.trimEnd().split('\n')[1].split('\t')
  assert.deepEqual(values.slice(3,13),Array(10).fill(''))
  assert.ok(!t.includes('\tpass\t'))
})
test('a visual state defect cannot become a pass when the old pattern counts are zero',()=>{
  const output=countTable([{board:'conflict',route:'/edit',width:1152,counts:{},findings:[],errors:[],writes:[],visualState:{findings:[{kind:'state-mismatch'}]}}])
  assert.ok(output.includes('\tfail\t'))
  assert.ok(!output.includes('\tpass\t'))
})
