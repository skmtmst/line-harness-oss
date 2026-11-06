import test from 'node:test'
import assert from 'node:assert/strict'
import {referenceChecks,checkMeasuredResult} from './speed-check.mjs'
import {spawnSync} from 'node:child_process'
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
const names=['dashboard','inbox','friends','broadcasts','broadcast-new','templates','booking','answers','tags','settings','friends-2000']
const fixture=()=>({complete:true,policy:{profile:'ci',sampleCount:5,timeFactor:1.3},measured:names.map(name=>({name,showMs:1000,longTaskMs:50,rows:2000,renderedRows:13,samples:Array.from({length:5},()=>({showMs:1000,longTaskMs:50,rows:2000,renderedRows:13}))}))})
test('CI・検証・手元が同じ5回と目標を使い、1ms超過も隠さない',()=>{
 assert.ok(Object.values(referenceChecks(fixture())).every(c=>c.passed))
 for(const [name,key,value,check] of [['tags','showMs',1001,'perf3'],['friends-2000','longTaskMs',66,'perf3'],['friends-2000','longTaskMs',66,'stress'],['broadcast-new','longTaskMs',51,'train17']]) {
  const result=fixture(),row=result.measured.find(r=>r.name===name)
  row[key]=value;row.samples.forEach(s=>s[key]=value)
  assert.equal(referenceChecks(result)[check].passed,false)
 }
})
test('違う条件・3回・欠測・未描画・途中結果・偽の中央値を合格にしない',()=>{
 for(const corrupt of [r=>r.policy.profile='local',r=>r.policy.timeFactor=2,r=>r.measured[0].samples.pop(),r=>r.complete=false,r=>r.measured.pop()]) {
  const r=fixture();corrupt(r);assert.throws(()=>referenceChecks(r))
 }
 for(const corrupt of [r=>r.measured[0].showMs=1,r=>r.measured[3].samples[0].longTaskMs=null,r=>r.measured[10].samples[0].renderedRows=0]) {
  const r=fixture();corrupt(r);assert.ok(Object.values(referenceChecks(r)).some(c=>!c.passed))
 }
})
test('同じ結果の2000件判定は、読む端末のCI環境変数で50/65msへ変わらない',()=>{
 const dir=mkdtempSync(join(tmpdir(),'speed-policy-recorded-'))
 try {
  const result=fixture(),row=result.measured.find(r=>r.name==='friends-2000')
  row.longTaskMs=63;row.samples.forEach(s=>s.longTaskMs=63)
  const path=join(dir,'speed.json');writeFileSync(path,JSON.stringify(result))
  for(const profile of ['local','ci']) {
   const run=spawnSync(process.execPath,['apps/web/scripts/v8-guard/stress-targets.mjs',path],{encoding:'utf8',env:{...process.env,V8_SPEED_PROFILE:profile}})
   assert.equal(run.status,0,run.stderr)
  }
  result.policy.timeFactor=2;writeFileSync(path,JSON.stringify(result))
  const broken=spawnSync(process.execPath,['apps/web/scripts/v8-guard/stress-targets.mjs',path],{encoding:'utf8'})
  assert.equal(broken.status,1)
  assert.match(broken.stderr,/保存した測定条件/)
 } finally {rmSync(dir,{recursive:true,force:true})}
})

test("速度の判定と共通入口が超過と測定不正を区別し、CLIの超過は表を出して終了0にする",()=>{
 const dir=mkdtempSync(join(tmpdir(),'speed-train17-report-'))
 try {
  const path=join(dir,'speed.json'),summary=join(dir,'summary.md')
  const result=fixture(),row=result.measured[0]
  row.showMs=1086;row.samples.forEach(s=>s.showMs=1086)
  const checks=referenceChecks(result)
  result.targetExceedances=[{screen:'dashboard',metric:'showMs',value:1086,limit:1000,unit:'ms',check:'target'}]
  assert.doesNotThrow(()=>checkMeasuredResult(result))
  assert.equal(result.exceedances.length,1)
  assert.equal(checks.train17.measurementFailed,false)
  assert.deepEqual(checks.train17.exceedances,[{screen:'dashboard',metric:'showMs',value:1086,limit:1000,unit:'ms',check:'train17'}])
  writeFileSync(path,JSON.stringify(result))
  for(const mode of ['report','enforce']) {
   const run=spawnSync(process.execPath,['apps/web/scripts/v8-guard/stgfix17-targets.mjs',path],{encoding:'utf8',env:{...process.env,V8_SPEED_ENFORCEMENT:mode,GITHUB_STEP_SUMMARY:summary}})
   assert.equal(run.status,mode==='report'?0:1,run.stderr)
  }
  assert.match(readFileSync(summary,'utf8'),/dashboard \| showMs \| 1086ms \| 1000ms \| \+86ms/)
  writeFileSync(path,JSON.stringify(checkMeasuredResult(result)))
  for(const mode of ['report','enforce']) {
   const run=spawnSync(process.execPath,['apps/web/scripts/v8-guard/speed-report.mjs',path],{encoding:'utf8',env:{...process.env,V8_SPEED_ENFORCEMENT:mode,GITHUB_STEP_SUMMARY:summary,SPEED_BUDGET_OUTCOME:'success',STRESS_SPEED_OUTCOME:'success',PERF3_TARGETS_OUTCOME:'success'}})
   assert.equal(run.status,mode==='report'?0:1,run.stderr)
   assert.match(run.stdout,/超過/)
  }
  row.samples[0].showMs=null
  assert.equal(referenceChecks(result).train17.measurementFailed,true)
  assert.throws(()=>checkMeasuredResult(result),/欠測/)
  writeFileSync(path,JSON.stringify(result))
  for(const script of ['stgfix17-targets','perf3-targets','stress-targets']) {
   const broken={...result,complete:false}
   writeFileSync(path,JSON.stringify(broken))
   const run=spawnSync(process.execPath,[`apps/web/scripts/v8-guard/${script}.mjs`,path],{encoding:'utf8',env:{...process.env,V8_SPEED_ENFORCEMENT:'report'}})
   assert.equal(run.status,1)
  }
 } finally {rmSync(dir,{recursive:true,force:true})}
})
