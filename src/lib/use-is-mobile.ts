"use client";

import { useSyncExternalStore } from "react";

// Mesmo ponto de quebra do Tailwind "md": abaixo de 768px vale o layout de celular.
const MOBILE_QUERY = "(max-width: 767px)";

const subscribe = (onChange: () => void) => {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const media = window.matchMedia(MOBILE_QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
};

const getSnapshot = () => (typeof window !== "undefined" && window.matchMedia ? window.matchMedia(MOBILE_QUERY).matches : false);

const getServerSnapshot = () => false;

/** true quando a tela tem largura de celular. */
export const useIsMobile = (): boolean => useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
