interface MarkProps {
  size?: number;
  className?: string;
}

/**
 * Kx monogram: a white K stem, a cyan upper arm, a white lower arm, and an "x" formed by an
 * emerald and a cyan stroke crossing — sharp square caps, no fills.
 */
export function KxMark({ size = 28, className }: MarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      className={className}
      role="img"
      aria-label="Kairox"
    >
      <g strokeLinecap="square" strokeWidth={3}>
        <path d="M7 6v20" stroke="#FFFFFF" />
        <path d="M7.8 16.2 17 6" stroke="#00F0FF" />
        <path d="M10.6 13.4 17 26" stroke="#FFFFFF" />
        <path d="m18 14 8 12" stroke="#10B981" />
        <path d="m26 14-8 12" stroke="#00F0FF" />
      </g>
    </svg>
  );
}

interface LogoProps {
  size?: number;
  className?: string;
  wordmarkClassName?: string;
}

export function KairoxLogo({ size = 28, className = "", wordmarkClassName = "text-lg" }: LogoProps) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <KxMark size={size} />
      <span className={`font-bold tracking-tight text-white ${wordmarkClassName}`}>
        Kair<span className="text-cyan">ox</span>
      </span>
    </span>
  );
}

export default KairoxLogo;
