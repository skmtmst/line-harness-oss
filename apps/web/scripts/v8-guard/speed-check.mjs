/** CI・検証・手元の共通入口。上限と既存の参考チェックの扱いは変えない。 */
import {spawnSync} from 'node:child_process'
import {readFileSync,writeFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
import {assertStressTargets} from './stress-targets.mjs'
import {assertPerf3Targets} from './perf3-targets.mjs'
import {assertStgfix17Targets} from './stgfix17-targets.mjs'
import {speedPolicy} from './speed-policy.mjs'

export function referenceChecks(result) {
 const checks={}
 // どの端末でも同じ1.3倍の予算比較。固定目標50/65/1000msには倍率を足さない。
 const policy=speedPolicy('ci')
 if(result.policy?.profile!==policy.profile || result.policy?.timeFactor!==policy.timeFactor || result.policy?.sampleCount!==policy.sampleCount) throw new Error('共通の測定条件（ci・5回・1.3倍）と一致しません')
 if(result.error || result.complete!==true || result.measured?.length!==11 || result.measured.some(m=>m.samples?.length!==5)) throw new Error('11場面を各5回測った証拠がありません')
 for(const [name,check] of Object.entries({stress:r=>assertStressTargets(r,policy),perf3:assertPerf3Targets,train17:assertStgfix17Targets})) {
  try {check(result);checks[name]={passed:true}} catch(error) {checks[name]={passed:false,error:error.message}}
 }
 return checks
}

if(process.argv[1]===fileURLToPath(import.meta.url)) {
 const [url,out]=process.argv.slice(2)
 if(!url?.startsWith('http') || !out) throw new Error('pnpm qa:speed <本番用書き出しのURL> <結果JSON>')
 const measured=spawnSync(process.execPath,[fileURLToPath(new URL('./speed-budget.mjs',import.meta.url)),url,out],{stdio:'inherit',env:{...process.env,V8_SPEED_PROFILE:'ci',V8_GUARD_STUB_API:'1'}})
 let checks,complete=false
 try {
  const result=JSON.parse(readFileSync(out,'utf8'))
  checks=referenceChecks(result)
  complete=true
  result.checks={budget:{passed:measured.status===0},...checks}
  writeFileSync(out,`${JSON.stringify(result,null,2)}\n`)
  for(const [name,status] of Object.entries(result.checks)) console.log(`${name}: ${status.passed?'合格':status.error??'超過または測定失敗'}`)
 } catch(error) {console.error(error.message);process.exitCode=1}
 if(measured.status!==0 || Object.values(checks??{}).some(c=>!c.passed)) process.exitCode=1
 // 合否の55測定を終えてから別に診断。トレース負荷を正式の中央値へ混ぜない。
 if(complete && process.exitCode && process.env.CI==='true') {
  const trace=spawnSync(process.execPath,[fileURLToPath(new URL('./perf3-profile.mjs',import.meta.url)),url,`${out}.diagnosis`,'1'],{stdio:'inherit',env:{...process.env,PERF3_DIAGNOSE:'only',PERF3_SCREENS:'broadcast-new,templates,tags,friends-2000'}})
  if(trace.status!==0) console.error('別の診断は未完了です。正式の測定結果と失敗判定は維持します。')
 }
}
