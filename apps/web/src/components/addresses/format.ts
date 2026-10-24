export function compactAddress(value: string): string {
  return value.length > 24 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value;
}
