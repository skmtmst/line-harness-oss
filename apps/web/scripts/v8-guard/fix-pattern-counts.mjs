/** Aggregate the existing detectors; no thresholds or board allowances. */
export function countFixPatterns(patterns, skeleton, layout) {
  const counts = { ...patterns.counts }, findings = [...patterns.findings]
  for (const [reason, count] of Object.entries(skeleton.failureCounts ?? Object.fromEntries(skeleton.failures.map(reason=>[reason,1])))) {
    const pattern = /文字切れ|見本文字/.test(reason) ? 'F1' : 'F6'
    counts[pattern] += count
    findings.push({ pattern, reason, count, detector: 'list-skeleton' })
  }
  for (const defect of layout.failures) {
    const pattern = defect.kind === 'clip' ? 'F1' : ['wrap','squash'].includes(defect.kind) ? 'F2' : 'F6'
    counts[pattern]++
    findings.push({ pattern, reason: defect.kind, detector:'layout-defects', ...defect })
  }
  return { counts, findings }
}
export function countTable(results) {
  const keys = Array.from({length:10},(_,i)=>`F${i+1}`)
  const cells = value => String(value ?? '').replace(/[\t\r\n]/g,' ')
  return [['board','route','width',...keys,'pageScopes','overflow','errors','writes','status','sha'], ...results.map(r=>[
    r.board,r.route,r.width,...keys.map(k=>r.error ? '' : r.counts?.[k]),r.coverage?.pages,r.overflow,r.errors.length,r.writes.length,
    r.error ? `unmeasured: ${r.error}` : r.findings.length || r.overflow || r.errors.length || r.writes.length || r.visualState?.findings.length ? 'fail' : 'pass',r.version?.git_commit,
  ])].map(row=>row.map(cells).join('\t')).join('\n')+'\n'
}

/** Static candidates remain candidates, even when the measured state is clean. */
export function sourceCountTable(results) {
  const rows = results.flatMap(r=>r.sourceCandidates?.map(hit=>[r.board,r.width,hit.category==='c'?'F6':hit.category==='b'?'F5/F6':'F3/F5',hit.file,hit.line,hit.pattern,hit.category,hit.text.replace(/[\t\r\n]/g,' ')] )??[])
  return [['board','width','patternFamily','file','line','catalogPattern','kind','evidence'],...rows].map(row=>row.join('\t')).join('\n')+'\n'
}
