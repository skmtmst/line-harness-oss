/** 撮影時のCSV確認用。手元のファイルは読まず、指定した見本だけを選ぶ。 */
export async function applyFileState(page, sample) {
  if (!sample || typeof sample.name !== 'string' || !/^[\w-]+\.csv$/.test(sample.name) || typeof sample.text !== 'string') {
    throw new Error('CSVの見本名と本文を指定してください')
  }
  const buffer = Buffer.from(sample.text, 'utf8')
  if (!buffer.length || buffer.length > 64 * 1024) throw new Error('撮影のCSV見本は1〜65536バイトです')
  const url = new URL(page.url())
  if (!['localhost', '127.0.0.1'].includes(url.hostname)) throw new Error('CSVの撮影は手元の見本画面で実行してください')
  await page.locator('input[type="file"]').first().setInputFiles({ name: sample.name, mimeType: 'text/csv', buffer })
  await page.getByText(sample.name, { exact: true }).first().waitFor({ state: 'visible' })
  await page.waitForTimeout(300)
}
