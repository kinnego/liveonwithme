'use client';
// A subtle music player for a memorial's chosen song.
//
// UX intent: never autoplay. Grieving visitors on shared devices, at work, on
// public transport should not have music blast at them unannounced. The
// visitor makes the choice by tapping "Play their song" in the hero. Once
// playing, a small floating pill sits at the bottom-right so they can stop it
// or navigate away easily.
//
// We use a hidden YouTube iframe rather than the JS API. That keeps the
// bundle small and avoids needing to load YouTube's API script. The tradeoff
// is we don't get fine-grained playback state (buffered/paused/ended) — we
// only know "user pressed play" and "user pressed stop". That's enough for
// this feature.

import { useState } from 'react';

type Props = {
  videoId: string;
  label: string; // e.g. "Play their song" or "Play Mary's song"
};

export default function SongPlayer({ videoId, label }: Props) {
  const [playing, setPlaying] = useState(false);

  return (
    <>
      {!playing && (
        <button
          type="button"
          onClick={(e) => {
            // The hero <section> around us opens a photo lightbox on click.
            // Stop that so tapping the play pill doesn't also expand the hero
            // image at the same time.
            e.stopPropagation();
            setPlaying(true);
          }}
          className="songPill"
          aria-label={label}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <polygon points="6 4 20 12 6 20 6 4" fill="currentColor" stroke="none" />
          </svg>
          <span>{label}</span>
        </button>
      )}

      {playing && (
        <>
          {/*
            Hidden iframe. Position it off-screen but keep it in the DOM so
            audio keeps playing. We can't use display:none — that stops
            playback in some browsers.
          */}
          <iframe
            title="Song player"
            src={`https://www.youtube.com/embed/${encodeURIComponent(videoId)}?autoplay=1&modestbranding=1&rel=0&playsinline=1`}
            allow="autoplay; encrypted-media"
            style={{
              position: 'fixed',
              left: -9999,
              top: -9999,
              width: 1,
              height: 1,
              border: 0,
            }}
          />
          <div className="songBar" role="status" aria-live="polite">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M9 18V5l12-2v13" />
              <circle cx="6" cy="18" r="3" />
              <circle cx="18" cy="16" r="3" />
            </svg>
            <span>Now playing</span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setPlaying(false);
              }}
              aria-label="Stop the music"
              className="songStop"
            >
              Stop
            </button>
          </div>
        </>
      )}
    </>
  );
}
