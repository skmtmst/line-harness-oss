/** 一覧の既定件数と、同じ選択肢を共有する画面の追加の刻み。 */
export const DEFAULT_PAGE_SIZE = 20
export const PAGE_SIZES: readonly number[] = [10, 20, 50]
export const EXTENDED_PAGE_SIZES: readonly number[] = [10, 20, 30, 40, 50]

export const pageSizeLabel = (size: number) => `${size}件表示`
export const pageSizeOptions = (sizes: readonly number[]) => sizes.map(size => ({ value: String(size), label: pageSizeLabel(size) }))
