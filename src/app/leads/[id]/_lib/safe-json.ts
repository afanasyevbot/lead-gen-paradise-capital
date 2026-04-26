// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function safeJson(val: string | null | undefined): any {
  if (!val) return null;
  try { return JSON.parse(val); } catch { return null; }
}
