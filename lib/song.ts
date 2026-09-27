// Parses common YouTube URL shapes into a video ID. Everything else returns
// null so the caller can reject the input (invalid URL, non-YouTube link,
// playlist without a video, etc.). We only accept YouTube for now — hosting
// user-uploaded MP3s would add copyright/moderation liability we're not ready
// to take on.

// Written in the first person deliberately: for memorials it reads like a
// farewell note from the person; for legacy pages it works as a self-chosen
// signature. Custodians can override it per memorial.
export const DEFAULT_SONG_LABEL = 'Play a song to remember me';

export function parseYoutubeVideoId(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\./, '');

  if (host === 'youtu.be') {
    const id = url.pathname.slice(1).split('/')[0];
    return isValidId(id) ? id : null;
  }

  if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com') {
    if (url.pathname === '/watch') {
      const id = url.searchParams.get('v') || '';
      return isValidId(id) ? id : null;
    }
    const match = url.pathname.match(/^\/(embed|shorts|live)\/([^/?#]+)/);
    if (match) {
      return isValidId(match[2]) ? match[2] : null;
    }
  }

  return null;
}

function isValidId(id: string): boolean {
  return /^[a-zA-Z0-9_-]{11}$/.test(id);
}
