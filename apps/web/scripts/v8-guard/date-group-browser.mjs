export default function scanDateGroups() {
 const findings=[],coverage=[]
 for(const table of document.querySelectorAll('table,[role="table"]')) {
  if(!table.getBoundingClientRect().width)continue
  const seen=new Set(),groups=[]
  const rows=[...table.querySelectorAll('tr,[role="row"]')].filter(row=>row.closest('table,[role="table"]')===table)
  const ordinary=rows.filter(row=>!row.hasAttribute('data-table-date-group')&&row.querySelectorAll(':scope > td,:scope > [role="cell"]').length>1)
  const normalHeight=ordinary[0]?.getBoundingClientRect().height
  for(const row of rows) {
   const cells=[...row.querySelectorAll(':scope > td,:scope > th,:scope > [role="cell"]')]
   if(cells.length!==1)continue
   const text=cells[0].textContent.trim(),label=text.replace(/^(今日|昨日)\s*/,''),marked=row.getAttribute('data-table-date-group')
   if(marked===null&&!/^\d{1,2}月\d{1,2}日/.test(label))continue
   const rect=row.getBoundingClientRect();if(!rect.width||!rect.height)continue
   const range=document.createRange();range.selectNodeContents(cells[0]);const textRect=range.getBoundingClientRect()
   const offset=Math.abs((textRect.top+textRect.bottom-rect.top-rect.bottom)/2)
   const key=marked||label
   groups.push({key,text,offset,height:rect.height,normalHeight,rect:rect.toJSON(),textRect:textRect.toJSON()})
   if(offset>2)findings.push({kind:'date-group-offcenter',text,offset})
   if(normalHeight&&rect.height>normalHeight+2)findings.push({kind:'date-group-too-tall',text,height:rect.height,normalHeight})
   if(key&&key!=='unknown'&&seen.has(key))findings.push({kind:'date-group-duplicate',text,key})
   seen.add(key)
  }
  if(groups.length)coverage.push({table:table.getAttribute('aria-label')||table.tagName,groups})
 }
 return {findings,coverage}
}
