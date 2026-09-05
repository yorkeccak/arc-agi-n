interface ArcLogoProps {
  className?: string;
  title?: string;
}

export function ArcLogo({ className, title = "ARC-AGI-N" }: ArcLogoProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 154 34"
      role="img"
      aria-label={title}
      xmlns="http://www.w3.org/2000/svg"
    >
      <title>{title}</title>
      <text x="0" y="25" className="arc-logo-type">ARC-AGI-</text>
      <path className="arc-logo-n" d="M108 26V9l19 17V9" />
      <path className="arc-logo-flight" d="M121 11 151 2l-23 15" />
    </svg>
  );
}
