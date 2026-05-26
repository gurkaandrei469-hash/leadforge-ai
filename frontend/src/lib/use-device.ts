'use client';
import { useEffect, useState } from 'react';

export interface DeviceInfo {
  /** True when viewport <= 768px — primary "mobile" gate */
  isMobile: boolean;
  /** True when viewport between 768px and 1024px */
  isTablet: boolean;
  /** True when viewport > 1024px — full desktop */
  isDesktop: boolean;
  /** OS-detected: iPhone / iPad (running iOS) */
  isIOS: boolean;
  /** OS-detected: Android */
  isAndroid: boolean;
  /** True for any touch-primary device */
  isTouch: boolean;
  /** True when launched via "Add to Home Screen" (PWA mode) */
  isStandalone: boolean;
  /** True when prefers-reduced-motion is set — respect for accessibility */
  prefersReducedMotion: boolean;
}

const DEFAULT: DeviceInfo = {
  isMobile: false,
  isTablet: false,
  isDesktop: true,
  isIOS: false,
  isAndroid: false,
  isTouch: false,
  isStandalone: false,
  prefersReducedMotion: false,
};

/**
 * Reactive device detection. Updates on resize, orientation change, and OS
 * theme/motion preference change. Returns conservative defaults during SSR so
 * hydration matches; the real values kick in on first effect.
 */
export function useDevice(): DeviceInfo {
  const [info, setInfo] = useState<DeviceInfo>(DEFAULT);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const compute = (): DeviceInfo => {
      const ua = navigator.userAgent || '';
      const platform = (navigator as any).userAgentData?.platform ?? navigator.platform ?? '';
      const w = window.innerWidth;

      // iPadOS reports as Mac with touch points — detect via touch + Macintosh UA
      const isIOSDevice =
        /iPad|iPhone|iPod/.test(ua) ||
        (platform === 'MacIntel' && navigator.maxTouchPoints > 1);

      const isAndroidDevice = /Android/.test(ua);

      const isTouchPrimary = window.matchMedia?.('(pointer: coarse)')?.matches ?? false;
      const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false;

      const isStandalonePWA =
        window.matchMedia?.('(display-mode: standalone)')?.matches ||
        (window.navigator as any).standalone === true;

      return {
        isMobile: w <= 768,
        isTablet: w > 768 && w <= 1024,
        isDesktop: w > 1024,
        isIOS: isIOSDevice,
        isAndroid: isAndroidDevice,
        isTouch: isTouchPrimary,
        isStandalone: isStandalonePWA,
        prefersReducedMotion,
      };
    };

    setInfo(compute());

    const onResize = () => setInfo(compute());
    window.addEventListener('resize', onResize, { passive: true });
    window.addEventListener('orientationchange', onResize);

    const mqStandalone = window.matchMedia('(display-mode: standalone)');
    const mqMotion     = window.matchMedia('(prefers-reduced-motion: reduce)');
    mqStandalone.addEventListener?.('change', onResize);
    mqMotion.addEventListener?.('change', onResize);

    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
      mqStandalone.removeEventListener?.('change', onResize);
      mqMotion.removeEventListener?.('change', onResize);
    };
  }, []);

  return info;
}

/**
 * Cheap one-shot helper for places that just need a yes/no on mobile and
 * don't want a full hook subscription. SSR-safe (returns false).
 */
export function isMobileNow(): boolean {
  if (typeof window === 'undefined') return false;
  return window.innerWidth <= 768;
}
