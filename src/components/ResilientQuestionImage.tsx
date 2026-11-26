/**
 * Resilient Question / Answer Image Renderer
 * Renders question & answer diagrams reliably across BOTH:
 *  - Full-stack Express server (`/api/question-image/{imageId}`)
 *  - Static deployments (e.g. GitHub Pages) or cold restarts via automatic
 *    read-through fallback to Firebase Firestore (`question_images/{imageId}`).
 * Caches resolved Data URLs in memory so print/preview/explorer switching is instantaneous.
 */

import React, { useEffect, useState } from 'react';
import {
  extractImageIdFromUrl,
  getQuestionImageFromFirebase,
} from '../services/firebase.ts';

// Module-level cache of resolved `/api/question-image/{id}` -> dataUrl
const resolvedImageCache = new Map<string, string>();
const inFlightImageFetches = new Map<string, Promise<string | null>>();

async function resolveImageFromFirestore(src: string): Promise<string | null> {
  if (resolvedImageCache.has(src)) {
    return resolvedImageCache.get(src)!;
  }
  const imageId = extractImageIdFromUrl(src);
  if (!imageId) return null;

  if (inFlightImageFetches.has(imageId)) {
    return inFlightImageFetches.get(imageId)!;
  }

  const p = getQuestionImageFromFirebase(imageId)
    .then(rec => {
      if (rec?.dataUrl) {
        resolvedImageCache.set(src, rec.dataUrl);
        return rec.dataUrl;
      }
      return null;
    })
    .catch(() => null)
    .finally(() => {
      inFlightImageFetches.delete(imageId);
    });

  inFlightImageFetches.set(imageId, p);
  return p;
}

export interface ResilientQuestionImageProps
  extends Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'src'> {
  src: string;
}

export const ResilientQuestionImage: React.FC<ResilientQuestionImageProps> = ({
  src,
  alt = 'ಚಿತ್ರ',
  onError,
  ...rest
}) => {
  const [effectiveSrc, setEffectiveSrc] = useState<string>(
    () => resolvedImageCache.get(src) || src
  );
  const [triedFirestore, setTriedFirestore] = useState<boolean>(() =>
    resolvedImageCache.has(src)
  );

  useEffect(() => {
    const cached = resolvedImageCache.get(src);
    if (cached) {
      setEffectiveSrc(cached);
      setTriedFirestore(true);
    } else {
      setEffectiveSrc(src);
      setTriedFirestore(false);
    }
  }, [src]);

  const handleImgError = (e: React.SyntheticEvent<HTMLImageElement, Event>) => {
    if (!triedFirestore) {
      const imageId = extractImageIdFromUrl(src);
      if (imageId) {
        setTriedFirestore(true);
        resolveImageFromFirestore(src).then(dataUrl => {
          if (dataUrl) {
            setEffectiveSrc(dataUrl);
          }
        });
        return;
      }
    }
    if (onError) {
      onError(e);
    }
  };

  return (
    <img
      src={effectiveSrc}
      alt={alt}
      referrerPolicy="no-referrer"
      onError={handleImgError}
      {...rest}
    />
  );
};
