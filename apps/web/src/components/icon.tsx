import type { ReactNode } from "react";

export function Icon({ name, size = 20 }: { name: string; size?: number }) {
  const paths: Record<string, ReactNode> = {
    home: (
      <>
        <path d="m3 10 9-7 9 7v11H3Z" />
        <path d="M9 21v-8h6v8" />
      </>
    ),
    book: (
      <>
        <path d="M12 5v16M3 3c4-1 6 0 9 2 3-2 5-3 9-2v16c-4-1-6 0-9 2-3-2-5-3-9-2Z" />
      </>
    ),
    search: (
      <>
        <circle cx="10.5" cy="10.5" r="6.5" />
        <path d="m16 16 5 5" />
      </>
    ),
    down: <path d="m6 9 6 6 6-6" />,
    info: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 11v6m0-10h.01" />
      </>
    ),
    contract: (
      <>
        <path d="M14 3H5v18h14V8Z" />
        <path d="M14 3v5h5M8 12h8m-8 4h5" />
      </>
    ),
    grant: (
      <>
        <rect x="3" y="7" width="18" height="14" rx="2" />
        <path d="M12 7v14M3 12h18M12 7H7a2.5 2.5 0 1 1 2.5-2.5L12 7Zm0 0h5a2.5 2.5 0 1 0-2.5-2.5L12 7Z" />
      </>
    ),
    handoff: (
      <>
        <path d="M3 7h16m-4-4 4 4-4 4M21 17H5m4-4-4 4 4 4" />
      </>
    ),
    device: (
      <>
        <rect x="3" y="4" width="18" height="13" rx="2" />
        <path d="M8 21h8m-4-4v4" />
      </>
    ),
    overview: (
      <>
        <rect x="3" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" />
        <rect x="14" y="14" width="7" height="7" rx="1.5" />
      </>
    ),
    milestones: (
      <>
        <path d="M9 6h11M9 12h11M9 18h11" />
        <path d="m3 6 1 1 2-2m-3 7 1 1 2-2m-3 7 1 1 2-2" />
      </>
    ),
    team: (
      <>
        <circle cx="9" cy="8" r="3" />
        <path d="M3 20v-2a6 6 0 0 1 12 0v2M16 5a3 3 0 0 1 0 6m2 3a5 5 0 0 1 3 4v2" />
      </>
    ),
    history: (
      <>
        <path d="M3 10a9 9 0 1 1 2 8M3 4v6h6m3-5v7l4 2" />
      </>
    ),
    arrow: <path d="M5 12h14m-5-5 5 5-5 5" />,
    chevron: <path d="m9 5 7 7-7 7" />,
    back: <path d="M19 12H5m5-5-5 5 5 5" />,
    check: <path d="m5 12 4 4L19 6" />,
    alert: (
      <>
        <path d="m12 3 10 18H2L12 3Z" />
        <path d="M12 9v4m0 4h.01" />
      </>
    ),
    network: (
      <>
        <circle cx="12" cy="12" r="3" />
        <circle cx="12" cy="3" r="1" />
        <circle cx="4" cy="18" r="1" />
        <circle cx="20" cy="18" r="1" />
        <path d="M12 4v5m-2 5-5 3m9-3 5 3" />
      </>
    ),
    wallet: (
      <>
        <path d="M4 6V4h15v4M4 6h16v14H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Z" />
        <path d="M20 11h-6v4h6" />
        <circle cx="16" cy="13" r=".5" />
      </>
    ),
    copy: (
      <>
        <rect x="8" y="8" width="12" height="12" rx="2" />
        <path d="M16 8V4H4v12h4" />
      </>
    ),
    plus: <path d="M12 5v14M5 12h14" />,
    download: (
      <>
        <path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5" />
      </>
    ),
    upload: (
      <>
        <path d="M12 16V4m-5 5 5-5 5 5M4 16v5h16v-5" />
      </>
    ),
    refresh: (
      <>
        <path d="M20 7v5h-5M4 17v-5h5M6 6a8 8 0 0 1 13 2M5 16a8 8 0 0 0 13 2" />
      </>
    ),
    shield: (
      <>
        <path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z" />
        <path d="m8 12 3 3 5-6" />
      </>
    ),
    settings: (
      <>
        <path d="M4 6h16M4 12h16M4 18h16" />
        <circle cx="9" cy="6" r="2" />
        <circle cx="15" cy="12" r="2" />
        <circle cx="8" cy="18" r="2" />
      </>
    ),
    close: <path d="m6 6 12 12M18 6 6 18" />,
    link: (
      <>
        <path d="m10 14 4-4m-6 6-2 2a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m4 0 2-2a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0" />
      </>
    ),
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name] ?? paths.arrow}
    </svg>
  );
}
