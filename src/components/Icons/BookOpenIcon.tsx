/**
 * BookOpenIcon - Shared open book icon
 */

export default function BookOpenIcon({ className, size = 48 }: { className?: string; size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="currentColor"
      className={className}
    >
      <path d="M21 4H3c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm-9 14H9V8h3v10zm3 0H9V6h6v12z"/>
    </svg>
  );
}
