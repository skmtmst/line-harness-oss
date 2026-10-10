import { expect, it } from 'vitest'
import { csvFileName, CSV_EXPORT_LABEL } from './csv-file-name'
it('B-158 決まり7：日本時間の日付で機能名を保存し、朝9時前でも前日に戻らない', () => {
 expect(csvFileName('友だち', new Date('2026-10-08T15:00:00Z'))).toBe('友だち_2026-10-09.csv')
 expect(csvFileName('友だち', new Date('2026-10-08T14:59:59Z'))).toBe('友だち_2026-10-08.csv')
 expect(csvFileName('予約台帳_2026-10-01.csv', new Date('2026-10-08T15:00:00Z'))).toBe('予約台帳_2026-10-09.csv')
 expect(CSV_EXPORT_LABEL).toBe('CSVで書き出す')
})
