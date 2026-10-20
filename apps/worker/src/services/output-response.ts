/** Stamp attribution without changing downloaded bytes or exposing the actor's name. */
export function exportedResponseHeaders(staffId: string, disposition: string | null, at = new Date().toISOString()): Record<string, string> {
  const actor = staffId.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 100);
  const headers: Record<string, string> = { 'X-Exported-By': actor, 'X-Exported-At': at };
  if (disposition) {
    const suffix = `-by-${actor}-${at.replace(/[^0-9TZ]/g, '')}`;
    const stamp = (name: string): string => {
      const dot = name.lastIndexOf('.');
      return dot < 0 ? name + suffix : name.slice(0, dot) + suffix + name.slice(dot);
    };
    headers['Content-Disposition'] = disposition
      .replace(/filename="([^"]+)"/, (_, name: string) => `filename="${stamp(name)}"`)
      .replace(/filename\*=UTF-8''([^;]+)/i, (_: string, encoded: string) => {
        let name: string;
        try { name = decodeURIComponent(encoded); } catch { name = 'download'; }
        return `filename*=UTF-8''${encodeURIComponent(stamp(name))}`;
      });
  }
  return headers;
}
