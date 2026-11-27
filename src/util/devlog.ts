/** Tiny dev-only logger: compiled out of production builds (the DEV check is a build-time constant). */
export function devLog(...args: unknown[]): void {
  if (import.meta.env.DEV) console.info(...args);
}
