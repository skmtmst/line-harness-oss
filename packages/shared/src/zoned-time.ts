/** 現地の暦で日数をずらし、壁時計の時刻をUTCへ変換する。 */
export function zonedWallTime(date: string, time: string, timeZone: string, offsetDays = 0): string {
  const [year,month,day] = date.split('-').map(Number);
  const [hour,minute] = time.split(':').map(Number);
  const target = Date.UTC(year,month-1,day+offsetDays,hour,minute);
  const formatter = new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
  const civilAt = (instant: number) => {
    const p = Object.fromEntries(formatter.formatToParts(new Date(instant)).map(item=>[item.type,item.value]));
    return Date.UTC(Number(p.year),Number(p.month)-1,Number(p.day),Number(p.hour),Number(p.minute),Number(p.second));
  };
  const offsets = new Set([-86400000,86400000].map(delta=>civilAt(target+delta)-(target+delta)));
  const candidates = [...offsets].map(offset=>({at:target-offset,civil:civilAt(target-offset)}));
  // 二度ある時刻は先の一回。存在しない時刻は時計を進めた側へ寄せる。
  const exact = candidates.filter(item=>item.civil===target).sort((a,b)=>a.at-b.at);
  const selected = exact[0] ?? candidates.filter(item=>item.civil>target).sort((a,b)=>a.civil-b.civil)[0];
  if (!selected) throw new Error('invalid_zoned_wall_time');
  return new Date(selected.at).toISOString();
}
