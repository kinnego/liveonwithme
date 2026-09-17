'use client';
import { useRef, useState } from 'react';

type Props = {
  src: string;
  initialFocalX?: number;
  initialFocalY?: number;
  onSave: (focalX: number, focalY: number) => void;
  onCancel: () => void;
};

const clamp = (n: number) => Math.max(0, Math.min(1, n));

export default function PhotoFocusEditor({
  src,
  initialFocalX = 0.5,
  initialFocalY = 0.5,
  onSave,
  onCancel,
}: Props) {
  const imgRef = useRef<HTMLImageElement>(null);
  const [x, setX] = useState(clamp(initialFocalX));
  const [y, setY] = useState(clamp(initialFocalY));

  function updateFromEvent(clientX: number, clientY: number) {
    const rect = imgRef.current?.getBoundingClientRect();
    if (!rect) return;
    setX(clamp((clientX - rect.left) / rect.width));
    setY(clamp((clientY - rect.top) / rect.height));
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(20,26,24,.72)',
        zIndex: 50,
        display: 'grid',
        placeItems: 'center',
        padding: 20,
      }}
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--paper)',
          borderRadius: 20,
          padding: 20,
          maxWidth: 640,
          width: '100%',
          boxShadow: 'var(--shadow)',
        }}
      >
        <h3 style={{ marginTop: 0 }}>Choose the focal point</h3>
        <p className="muted" style={{ marginTop: 0, fontSize: 14 }}>
          Tap or click on the part of the photograph you want to keep centred when we crop it.
        </p>

        <div
          style={{
            position: 'relative',
            borderRadius: 14,
            overflow: 'hidden',
            border: '1px solid var(--line)',
            marginBottom: 16,
            cursor: 'crosshair',
            userSelect: 'none',
          }}
          onClick={(e) => updateFromEvent(e.clientX, e.clientY)}
          onTouchStart={(e) => {
            const t = e.touches[0];
            if (t) updateFromEvent(t.clientX, t.clientY);
          }}
        >
          <img
            ref={imgRef}
            src={src}
            alt="Adjust framing"
            draggable={false}
            style={{ display: 'block', width: '100%', height: 'auto' }}
          />
          <div
            aria-hidden
            style={{
              position: 'absolute',
              left: `${x * 100}%`,
              top: `${y * 100}%`,
              transform: 'translate(-50%, -50%)',
              width: 26,
              height: 26,
              borderRadius: '50%',
              border: '3px solid white',
              boxShadow: '0 0 0 2px rgba(20,26,24,.55)',
              pointerEvents: 'none',
            }}
          />
        </div>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="button"
            onClick={() => onSave(Number(x.toFixed(3)), Number(y.toFixed(3)))}
          >
            Save framing
          </button>
          <button type="button" className="button secondary" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="button secondary"
            onClick={() => {
              setX(0.5);
              setY(0.5);
            }}
          >
            Reset to centre
          </button>
        </div>
      </div>
    </div>
  );
}
