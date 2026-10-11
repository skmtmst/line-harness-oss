import Database from 'better-sqlite3'

/** VitestのDateだけでなく、DEFAULT・trigger・SQLのnowも同じ試験時計にする。 */
export function useSqliteClock(raw: Database.Database, now: () => Date): void {
  // 日付の解析・修飾子は本物のSQLiteに任せ、現在時刻だけ渡す。
  const calendar = new Database(':memory:')
  const evaluate = (name: string, args: unknown[]) =>
    (calendar.prepare(`SELECT ${name}(${args.map(() => '?').join(',')}) AS value`)
      .get(...args) as { value: string | number | null }).value

  for (const name of ['date', 'time', 'datetime', 'julianday', 'unixepoch', 'strftime']) {
    raw.function(name, { varargs: true }, (...args) => {
      const timeIndex = name === 'strftime' ? 1 : 0
      if (name === 'strftime' && args.length === 0) return null
      if (args.length === timeIndex) args.push(now().toISOString())
      else if (args[timeIndex] === 'now') args[timeIndex] = now().toISOString()
      else if (args[timeIndex] === 'subsec' || args[timeIndex] === 'subsecond') {
        args.splice(timeIndex, 0, now().toISOString())
      }
      return evaluate(name, args)
    })
  }
  for (const [name, expression] of [
    ['current_timestamp', 'datetime'], ['current_date', 'date'], ['current_time', 'time'],
  ]) {
    raw.function(name, () => evaluate(expression, [now().toISOString()]))
  }

  const close = raw.close.bind(raw)
  raw.close = () => {
    try { return close() } finally { calendar.close() }
  }
}
