const glyphs = {
  layers: <path d="m3 7 9-4 9 4-9 4zM3 12l9 4 9-4M3 17l9 4 9-4" />,
  up: <path d="M12 20V4m-6 6 6-6 6 6" />,
  folder: <path d="M3 6h7l2 3h9v11H3z" />,
  page: <path d="M5 3h9l5 5v13H5zM14 3v6h5M8 13h8m-8 4h6" />,
  notes: <path d="M5 3h14v18H5zM3 7h4m-4 5h4m-4 5h4m3-9h6m-6 4h6" />,
  play: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="3" />
      <path d="m10 8 6 4-6 4z" />
    </>
  ),
  chat: <path d="M4 4h16v12H9l-5 4zM8 8h8m-8 4h6" />,
  book: (
    <path d="M3 5c4-1 6-1 9 1 3-2 5-2 9-1v14c-3-1-6-1-9 1-3-2-6-2-9-1zM12 6v14" />
  ),
  compass: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m15.5 8.5-2 5-5 2 2-5z" />
    </>
  ),
};
export function InkIcon({ name }) {
  return (
    <span className="icon" aria-hidden="true">
      <svg viewBox="0 0 24 24">{glyphs[name]}</svg>
    </span>
  );
}
