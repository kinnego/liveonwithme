let loaderPromise: Promise<any> | null = null;

export function loadGoogleMaps(): Promise<any> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Google Maps can only be loaded in the browser'));
  }
  const w = window as any;
  if (w.google?.maps?.places) return Promise.resolve(w.google);
  if (loaderPromise) return loaderPromise;

  const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!key) {
    return Promise.reject(new Error('NEXT_PUBLIC_GOOGLE_MAPS_API_KEY is not configured'));
  }

  loaderPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-google-maps]');
    if (existing) {
      existing.addEventListener('load', () => resolve((window as any).google));
      existing.addEventListener('error', () => reject(new Error('Failed to load Google Maps')));
      return;
    }
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(
      key
    )}&libraries=places&v=weekly`;
    script.async = true;
    script.defer = true;
    script.dataset.googleMaps = '1';
    script.onload = () => {
      const g = (window as any).google;
      if (!g?.maps?.places) {
        reject(new Error('Google Maps loaded but Places library is unavailable'));
        return;
      }
      resolve(g);
    };
    script.onerror = () => reject(new Error('Failed to load Google Maps script'));
    document.head.appendChild(script);
  });

  return loaderPromise;
}
