/** Node用のソース読取補助。製品の通信・描画には含めない。 */
export function readApiSources(entry: string | URL): Map<string, string>
export function readApiSource(entry: string | URL, encoding?: BufferEncoding): string
