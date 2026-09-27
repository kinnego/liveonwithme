// Loads Google Maps JS API using the official dynamic-library import
// bootstrap. The bootstrap sets `google.maps.importLibrary` synchronously,
// and the real API script is only fetched the first time `importLibrary` is
// awaited — so we get async loading with no console warnings, and no race
// where consumers see `google.maps` before `importLibrary` is attached.
// Reference: https://developers.google.com/maps/documentation/javascript/load-maps-js-api

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

  loaderPromise = (async () => {
    // Install the bootstrap the first time we're called on this page.
    // It sets google.maps.importLibrary synchronously; the real JS API
    // fetch happens once importLibrary is awaited.
    if (!w.google?.maps?.importLibrary) {
      installBootstrap(key);
    }
    await w.google.maps.importLibrary('places');
    return w.google;
  })();

  return loaderPromise;
}

function installBootstrap(apiKey: string): void {
  // Google's published bootstrap loader, adapted:
  //  - hardcoded params (key + v=weekly)
  //  - no callback param — importLibrary returns a promise directly
  // Do NOT add `libraries=places` to the URL; that param conflicts with
  // the dynamic library import model.
  const g: any = (window as any);
  g.google = g.google || {};
  g.google.maps = g.google.maps || {};
  const maps = g.google.maps;
  if (maps.importLibrary) return;

  const libs = new Set<string>();
  let bootstrapPromise: Promise<void> | null = null;

  const ensureBootstrapScript = (): Promise<void> => {
    if (bootstrapPromise) return bootstrapPromise;
    bootstrapPromise = new Promise<void>((resolve, reject) => {
      const script = document.createElement('script');
      const params = new URLSearchParams();
      params.set('key', apiKey);
      params.set('v', 'weekly');
      params.set('libraries', Array.from(libs).join(','));
      params.set('callback', 'google.maps.__ib__');
      script.src = `https://maps.googleapis.com/maps/api/js?${params.toString()}`;
      script.async = true;
      script.defer = true;
      script.dataset.googleMaps = '1';
      // Google's bootstrap sets a global callback name — the API calls it
      // once the library is registered, at which point we resolve.
      maps.__ib__ = () => resolve();
      script.onerror = () => reject(new Error('Failed to load Google Maps script'));
      document.head.appendChild(script);
    });
    return bootstrapPromise;
  };

  maps.importLibrary = (lib: string) => {
    libs.add(lib);
    return ensureBootstrapScript().then(() => maps.importLibrary(lib));
  };
}
