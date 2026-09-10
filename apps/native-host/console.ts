// Warnings and errors from every root, kept for the screen receipts so agents see them
// without reading Metro's log. LogBox's on-screen banner is disabled in index.tsx because a
// design canvas must not paint a yellow bar into its captures.
const recent: string[] = [];
const format = (value: unknown) => {
  if (value instanceof Error) return value.message;
  if (typeof value === 'string') return value;
  try { return JSON.stringify(value); } catch { return String(value); }
};
for (const level of ['warn', 'error'] as const) {
  const original = console[level].bind(console);
  console[level] = (...args: unknown[]) => {
    const line = `${level}: ${args.map(format).join(' ')}`.replace(/\s+/g, ' ').slice(0, 400);
    if (recent.at(-1) !== line) recent.push(line);
    if (recent.length > 20) recent.shift();
    original(...args);
  };
}
export const recentConsole = () => recent.slice(-8);
