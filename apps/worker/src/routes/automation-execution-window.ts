

export function defaultWindow() {
  const to = new Date();
  const from = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1_000);
  return { from: from.toISOString(), to: to.toISOString() };
}
