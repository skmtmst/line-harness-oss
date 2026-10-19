import { formatYen } from '@line-crm/shared';
import Button from './ui/button/index.js';
import { useId, useState } from 'react';
import type { RestaurantCustomerCourse } from '@line-crm/shared';
import Card from './ui/card.js';
import { ChoiceInput, FormChoiceRow, FieldLabel } from './forms/controls.js';

export default function CourseChoice({courses,value,onChange,disabled=false,compact=false}:{courses:RestaurantCustomerCourse[];value:string|null;onChange:(id:string|null)=>void;disabled?:boolean;compact?:boolean}) {
 const groupId=useId();
 const [open,setOpen]=useState(false);
 const choose=(id:string|null)=>{onChange(id);setOpen(false);};
 const choices=<div role="radiogroup" aria-labelledby={groupId}>
   <FormChoiceRow selected={!value}><ChoiceInput type="radio" name={groupId} checked={!value} disabled={disabled} onChange={()=>choose(null)} />席のみ（120分）</FormChoiceRow>
   {courses.map(c=><FormChoiceRow key={c.id} selected={value===c.id}><ChoiceInput type="radio" name={groupId} checked={value===c.id} disabled={disabled} onChange={()=>choose(c.id)} /><span className="min-w-0 truncate" title={`${c.name}・${formatYen(c.price).replace(/^¥/, '')}円・${c.durationMinutes}分`}>{c.name}・{formatYen(c.price).replace(/^¥/, '')}円・{c.durationMinutes}分</span></FormChoiceRow>)}
  </div>;
 if(compact)return <div className="relative"><Button variant="restaurant-select" type="button" aria-expanded={open} disabled={disabled} onClick={()=>setOpen(v=>!v)}><span id={groupId} className="min-w-0 truncate" title={courses.find(c=>c.id===value)?.name}>{`コース：${courses.find(c=>c.id===value)?.name??'席のみ'}`}</span><span className="shrink-0" aria-hidden="true">⌄</span></Button>{open && <Card className="absolute inset-x-0 top-full z-10 mt-2 space-y-2 p-3">{choices}</Card>}</div>;
 return <Card className="p-4 mb-4 space-y-2">
  <FieldLabel id={groupId}>コース</FieldLabel>
  {choices}
 </Card>;
}
