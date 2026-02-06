'use client';

interface GenreTagProps {
  name: string;
  slug: string;
  onClick?: (slug: string) => void;
  className?: string;
}

export default function GenreTag({
  name,
  slug,
  onClick,
  className = ''
}: GenreTagProps) {
  const content = (
    <span className={`genre-tag ${className}`}>
      {name}
    </span>
  );

  if (onClick) {
    return (
      <button
        onClick={() => onClick(slug)}
        className="genre-tag clickable"
        type="button"
      >
        {name}
      </button>
    );
  }

  return content;
}
