'use client';

// Thin wrapper so `yet-another-react-lightbox` plus its Zoom/Captions plugins
// and stylesheets can be pulled into one lazy chunk by next/dynamic. Keeping
// the imports here (not in MemorialView) is the whole point — the ~77 KB JS
// and ~6 KB CSS only download when a visitor actually opens a photo.

import Lightbox from 'yet-another-react-lightbox';
import Zoom from 'yet-another-react-lightbox/plugins/zoom';
import Captions from 'yet-another-react-lightbox/plugins/captions';
import 'yet-another-react-lightbox/styles.css';
import 'yet-another-react-lightbox/plugins/captions.css';

export type MemorialLightboxSlide = {
  src: string;
  alt?: string;
  title?: string;
  description?: string;
};

type Props = {
  open: boolean;
  close: () => void;
  index: number;
  slides: MemorialLightboxSlide[];
};

export default function MemorialLightbox({ open, close, index, slides }: Props) {
  return (
    <Lightbox
      open={open}
      close={close}
      index={index}
      slides={slides}
      plugins={[Zoom, Captions]}
      controller={{ closeOnBackdropClick: true }}
      zoom={{ maxZoomPixelRatio: 3, scrollToZoom: true }}
      carousel={{ finite: slides.length <= 1 }}
      styles={{ container: { backgroundColor: 'rgba(15, 22, 20, 0.94)' } }}
    />
  );
}
