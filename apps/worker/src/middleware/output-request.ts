export function isOutputRequest(path: string, format?: string, method = 'GET'): boolean {
  return format === 'csv' || /\.(csv|zip)$|\/(export|download)(\/|$)|\/form-files\/[^/]+\/content$/.test(path) || (method === 'POST' && path.endsWith('/exports'));
}
