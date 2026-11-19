// Figma에서 쓴 아이콘과 같은 모양 (24×24, 선 2px)
const P = {
  back: <path d="M15 18l-6-6 6-6" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" strokeWidth="2.6" />,
  chev: <path d="M9 6l6 6-6 6" />,
  more: (
    <g fill="currentColor" stroke="none">
      <circle cx="5" cy="12" r="1.8" />
      <circle cx="12" cy="12" r="1.8" />
      <circle cx="19" cy="12" r="1.8" />
    </g>
  ),
  grid: (
    <g>
      <rect x="3.5" y="3.5" width="7" height="7" rx="2" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="2" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="2" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="2" />
    </g>
  ),
  book: (
    <g>
      <rect x="4" y="5" width="12" height="15" rx="2.5" />
      <path d="M8 3h9.5A2.5 2.5 0 0 1 20 5.5V17" />
    </g>
  ),
  user: (
    <g>
      <circle cx="12" cy="8.5" r="3.8" />
      <path d="M4.5 20c1.2-3.6 4-5.3 7.5-5.3s6.3 1.7 7.5 5.3" />
    </g>
  ),
  spark: <path d="M12 2.5l2.2 6.3 6.3 2.2-6.3 2.2L12 19.5l-2.2-6.3L3.5 11l6.3-2.2z" fill="currentColor" stroke="none" />,
  clock: (
    <g>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </g>
  ),
  share: <path d="M12 15V4M7.5 8.5L12 4l4.5 4.5M5 13v5.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V13" />,
  search: (
    <g>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16l4 4" />
    </g>
  ),
  lock: (
    <g>
      <rect x="5" y="10.5" width="14" height="10" rx="2.5" />
      <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />
    </g>
  ),
  nfc: <path d="M8.5 8.5a5 5 0 0 1 0 7M12 5.5a9 9 0 0 1 0 13M15.5 2.5a13 13 0 0 1 0 19" />,
  plus: <path d="M12 5v14M5 12h14" />,
  camera: (
    <g>
      <path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2l1.5-2h6l1.5 2h2A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z" />
      <circle cx="12" cy="13" r="3.5" />
    </g>
  ),
  trash: <path d="M5 7h14M10 4h4M8 7l1 13h6l1-13" />,
};

export default function Icon({ name, size = 24, className, style }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
      style={style}
    >
      {P[name]}
    </svg>
  );
}
