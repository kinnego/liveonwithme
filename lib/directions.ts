// Pure, firestore-free helper for the "Directions to the grave" link.
// Split out of lib/plot.ts so the public memorial page can import it
// without dragging the firestore client SDK into its bundle.

export function walkingDirectionsUrl(coords: { lat: number; lng: number }): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${coords.lat},${coords.lng}&travelmode=walking`;
}
