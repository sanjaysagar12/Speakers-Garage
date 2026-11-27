/** The Speaker's Garage mark (public/favicon.svg) with the wordmark. `tone` picks colours for dark or light backgrounds. */
export function Brand({ size = 28, tone = 'dark', className = '' }: { size?: number; tone?: 'dark' | 'light'; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 font-display font-extrabold tracking-tight ${className}`}>
      <img src="/favicon.svg" alt="" width={size} height={size} style={{ width: size, height: size }} />
      <span className={tone === 'light' ? 'text-white' : 'text-pine'} style={{ fontSize: size * 0.62 }}>
        Speaker&apos;s <span className={tone === 'light' ? 'text-[#9FD3C7]' : 'text-moss'}>Garage</span>
      </span>
    </span>
  );
}
