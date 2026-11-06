import { fetchApi } from '../../api'
import type { TagCsvImportInputRow,TagCsvImportPreview,TagCsvImportResult } from '@line-crm/shared'

/** Parse CSV in the existing store importer, then send the same row format here. tagId is an HQ template ID. */
export const hqTagImportApi={
  preview:(rows:TagCsvImportInputRow[])=>fetchApi<{success:boolean;data:TagCsvImportPreview}>('/api/hq/templates/tags/import/preview',{method:'POST',body:JSON.stringify({rows})}),
  execute:(rows:TagCsvImportInputRow[])=>fetchApi<{success:boolean;data:TagCsvImportResult}>('/api/hq/templates/tags/import',{method:'POST',body:JSON.stringify({rows})}),
}
