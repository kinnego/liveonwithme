// Simple line pictures for the parishes page and leaflet. Plain SVG, so they
// render on the server, print cleanly and follow the text colour.

type P = { size?: number };

function Svg({ size = 40, children }: P & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

/** An open register book with lines of names. */
export function BookIcon(p: P) {
  return (
    <Svg {...p}>
      <path d="M24 12c-4-3-10-4-17-3v27c7-1 13 0 17 3 4-3 10-4 17-3V9c-7-1-13 0-17 3z" />
      <path d="M24 12v27" />
      <path d="M11 17h8M11 22h8M11 27h6M29 17h8M29 22h8M29 27h6" />
    </Svg>
  );
}

/** A magnifying glass over a map pin: find your graveyard. */
export function FindIcon(p: P) {
  return (
    <Svg {...p}>
      <circle cx="21" cy="21" r="12" />
      <path d="M30 30l9 9" />
      <path d="M21 28s-5-4.5-5-8a5 5 0 0 1 10 0c0 3.5-5 8-5 8z" />
      <circle cx="21" cy="20" r="1.6" />
    </Svg>
  );
}

/** A checklist: tell us what your book has. */
export function ChecklistIcon(p: P) {
  return (
    <Svg {...p}>
      <rect x="10" y="7" width="28" height="34" rx="3" />
      <path d="M15 16l2.5 2.5L22 14M15 25l2.5 2.5L22 23M15 34l2.5 2.5L22 32" />
      <path d="M26 17h7M26 26h7M26 35h7" />
    </Svg>
  );
}

/** A phone camera: photograph the pages. */
export function CameraIcon(p: P) {
  return (
    <Svg {...p}>
      <path d="M8 15h7l3-5h12l3 5h7v22H8z" />
      <circle cx="24" cy="25" r="7" />
    </Svg>
  );
}

/** A keyboard: type the names in. */
export function KeyboardIcon(p: P) {
  return (
    <Svg {...p}>
      <rect x="5" y="13" width="38" height="22" rx="3" />
      <path d="M11 20h2M17 20h2M23 20h2M29 20h2M35 20h2M11 26h2M17 26h2M23 26h2M29 26h2M35 26h2M16 31h16" />
    </Svg>
  );
}

/** An envelope: email us for help. */
export function EnvelopeIcon(p: P) {
  return (
    <Svg {...p}>
      <rect x="6" y="11" width="36" height="26" rx="3" />
      <path d="M7 13l17 13 17-13" />
    </Svg>
  );
}

/** A phone showing a pin: pin graves as you walk. */
export function PhonePinIcon(p: P) {
  return (
    <Svg {...p}>
      <rect x="14" y="5" width="20" height="38" rx="4" />
      <path d="M21 39h6" />
      <path d="M24 30s-6-5.5-6-10a6 6 0 0 1 12 0c0 4.5-6 10-6 10z" />
      <circle cx="24" cy="20" r="2" />
    </Svg>
  );
}

/** A headstone with a heart: the family finds the grave. */
export function HeadstoneIcon(p: P) {
  return (
    <Svg {...p}>
      <path d="M13 41V19a11 11 0 0 1 22 0v22" />
      <path d="M8 41h32" />
      <path d="M24 30s-5-3.2-5-6.5a2.8 2.8 0 0 1 5-1.7 2.8 2.8 0 0 1 5 1.7c0 3.3-5 6.5-5 6.5z" />
    </Svg>
  );
}

/** A cloud with an upward arrow: the register goes online. */
export function OnlineIcon(p: P) {
  return (
    <Svg {...p}>
      <path d="M14 34h-1a8 8 0 0 1-1-15.9A11 11 0 0 1 33 15a8.5 8.5 0 0 1 2 18.8" />
      <path d="M24 38V24M18.5 29.5L24 24l5.5 5.5" />
    </Svg>
  );
}

/** A soft round badge holding one of the pictures above. */
export function IconCircle({ size = 56, children }: { size?: number; children: React.ReactNode }) {
  return (
    <div
      style={{
        flex: `0 0 ${size}px`,
        width: size,
        height: size,
        borderRadius: '50%',
        background: 'var(--sage2)',
        color: 'var(--ink)',
        display: 'grid',
        placeItems: 'center',
      }}
    >
      {children}
    </div>
  );
}

/** A bold "OR" between choices, so nobody thinks they must do them all. */
export function OrDivider() {
  return (
    <div aria-hidden="true" style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '4px 0' }}>
      <span style={{ flex: 1, height: 1, background: 'var(--line)' }} />
      <span
        style={{
          fontWeight: 800,
          letterSpacing: '0.12em',
          fontSize: 15,
          padding: '4px 14px',
          borderRadius: 999,
          background: 'var(--ink)',
          color: 'white',
        }}
      >
        OR
      </span>
      <span style={{ flex: 1, height: 1, background: 'var(--line)' }} />
    </div>
  );
}

/** A chat bubble: ChatGPT. */
export function ChatIcon(p: P) {
  return (
    <Svg {...p}>
      <path d="M8 10h32v22H22l-8 7v-7H8z" />
      <path d="M15 18h18M15 24h12" />
    </Svg>
  );
}

/** A table: the tidy list ChatGPT gives back. */
export function TableIcon(p: P) {
  return (
    <Svg {...p}>
      <rect x="7" y="9" width="34" height="30" rx="3" />
      <path d="M7 17h34M7 25h34M7 33h34M19 9v30" />
    </Svg>
  );
}

/**
 * Why the photo route needs ChatGPT, as a picture: photo of a page →
 * ChatGPT types it out as a table → paste it into LiveOnWith.me. With a
 * one-line example of a handwritten entry becoming a row.
 */
export function PhotoToAppFlow({ compact = false }: { compact?: boolean }) {
  const steps = [
    { icon: <CameraIcon size={30} />, label: 'You take a photo of a page' },
    { icon: <ChatIcon size={30} />, label: 'ChatGPT types it out as a list' },
    { icon: <TableIcon size={30} />, label: 'You paste the list in here' },
  ];
  return (
    <div style={{ margin: '12px 0' }}>
      <style>{`
        .ptaFlow { display: grid; grid-template-columns: minmax(0,1fr) auto minmax(0,1fr) auto minmax(0,1fr); gap: 6px; align-items: start; text-align: center; }
        .ptaArrow { color: var(--sage); font-size: 22px; padding-top: 14px; }
        .ptaLabel { font-size: 15px; font-weight: 650; line-height: 1.3; margin-top: 6px; overflow-wrap: break-word; hyphens: none; }
        @media (max-width: 640px) {
          .ptaFlow { grid-template-columns: minmax(0,1fr); gap: 2px; text-align: left; }
          .ptaStep { display: flex; align-items: center; gap: 12px; }
          .ptaStep .ptaLabel { margin-top: 0; font-size: 16px; }
          .ptaArrow { padding: 0; width: 52px; text-align: center; line-height: 1; transform: rotate(90deg); }
        }
      `}</style>
      <div className="ptaFlow" role="img" aria-label="You take a photo of a page, ChatGPT types it out as a list, and you paste the list in here">
        {steps.map((s, i) => (
          <div key={s.label} style={{ display: 'contents' }}>
            {i > 0 && <div className="ptaArrow" aria-hidden="true">→</div>}
            <div className="ptaStep">
              <div style={{ display: 'flex', justifyContent: 'center', flexShrink: 0 }}>
                <IconCircle size={52}>{s.icon}</IconCircle>
              </div>
              <div className="ptaLabel">{s.label}</div>
            </div>
          </div>
        ))}
      </div>
      {!compact && (
        <div
          style={{
            marginTop: 14,
            border: '1px dashed var(--line)',
            borderRadius: 12,
            padding: '10px 12px',
            fontSize: 15,
            background: 'var(--paper)',
          }}
        >
          <div className="muted" style={{ fontSize: 13, marginBottom: 4 }}>For example, a line in the book like:</div>
          <div style={{ fontFamily: 'Georgia, serif', fontStyle: 'italic' }}>
            John Gallagher, Meenacross, died 3rd March 1952, aged 70
          </div>
          <div className="muted" style={{ fontSize: 13, margin: '8px 0 4px' }}>becomes a row like this:</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {[
              ['Surname', 'Gallagher'],
              ['First names', 'John'],
              ['Died', '03/03/1952'],
              ['Age', '70'],
              ['Townland', 'Meenacross'],
            ].map(([h, v]) => (
              <div key={h} style={{ border: '1px solid var(--line)', borderRadius: 8, background: 'white', minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 700, padding: '3px 8px', borderBottom: '1px solid var(--line)' }}>{h}</div>
                <div style={{ fontSize: 14, padding: '3px 8px' }}>{v}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
