export function shortPublishAt(local: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(local.trim())
  if (!match) return local.trim()
  return `${Number(match[2])}/${Number(match[3])} ${match[4]}:${match[5]}`
}

export function longPublishAt(local: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(local.trim())
  if (!match) return local.trim()
  const week = '日月火水木金土'[new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).getDay()]
  return `${Number(match[2])}/${Number(match[3])}（${week}）${match[4]}:${match[5]}`
}
