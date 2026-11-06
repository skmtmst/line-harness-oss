function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** path/method/成功のschemaは保持し、失敗だけを実行時の共通境界とそろえる。 */
export function withApiErrorContract<T extends object>(paths: T): T {
  const result = structuredClone(paths);
  for (const path of Object.values(result)) {
    for (const operation of Object.values(record(path))) {
      const responses = record(record(operation).responses);
      for (const [status, value] of Object.entries(responses)) {
        const response = record(value);
        response.headers = { ...record(response.headers), 'X-Request-ID': {
          description: 'サーバーが採番した依頼の相関ID。問い合わせとログ・監査の照合に使います。',
          schema: { type: 'string', format: 'uuid' },
        } };
        if (!(Number(status) >= 400 || status === 'default')) continue;
        const original = record(record(record(response.content)['application/json']).schema);
        const properties = { ...record(original.properties) };
        for (const key of ['success', 'error', 'code', 'message', 'requestId', 'fields']) delete properties[key];
        const required = Array.isArray(original.required) ? original.required.filter(key => key in properties) : [];
        response.content = { 'application/json': { schema: Object.keys(properties).length
          ? { allOf: [{ $ref: '#/components/schemas/ApiErrorResponse' }, { type: 'object', properties, ...(required.length ? { required } : {}) }] }
          : { $ref: '#/components/schemas/ApiErrorResponse' } } };
      }
    }
  }
  return result;
}
