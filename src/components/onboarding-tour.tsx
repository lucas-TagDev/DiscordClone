"use client";

import { useCallback, useEffect, useLayoutEffect, useState } from "react";

/**
 * Tutorial guiado: escurece a tela, destaca um elemento marcado com
 * `data-tour="<target>"` e mostra um balão explicando o que ele faz. Passos sem
 * alvo (ou com o alvo escondido, como no celular) aparecem centralizados.
 */
export type OnboardingStep = {
  /** Valor de `data-tour` do elemento destacado; sem alvo = cartão no centro. */
  target?: string;
  title: string;
  body: React.ReactNode;
};

type Props = {
  /** O pai monta o tour só quando aberto, então cada abertura recomeça do passo 1. */
  open: boolean;
  steps: OnboardingStep[];
  onClose: () => void;
};

type Rect = { top: number; left: number; width: number; height: number };

const HIGHLIGHT_PADDING = 6;
const CARD_WIDTH = 320;
const GAP = 14;
const VIEWPORT_MARGIN = 12;

const readTargetRect = (target?: string): Rect | null => {
  if (!target || typeof document === "undefined") return null;
  const element = document.querySelector<HTMLElement>(`[data-tour="${target}"]`);
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return null;
  return {
    top: rect.top - HIGHLIGHT_PADDING,
    left: rect.left - HIGHLIGHT_PADDING,
    width: rect.width + HIGHLIGHT_PADDING * 2,
    height: rect.height + HIGHLIGHT_PADDING * 2,
  };
};

/** Coloca o balão à direita do alvo; sem espaço, abaixo, acima ou à esquerda. */
const placeCard = (rect: Rect | null, cardHeight: number): { top: number; left: number } => {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const width = Math.min(CARD_WIDTH, viewportWidth - VIEWPORT_MARGIN * 2);
  const clampLeft = (value: number) => Math.min(Math.max(value, VIEWPORT_MARGIN), viewportWidth - width - VIEWPORT_MARGIN);
  const clampTop = (value: number) => Math.min(Math.max(value, VIEWPORT_MARGIN), viewportHeight - cardHeight - VIEWPORT_MARGIN);

  if (!rect) {
    return { top: clampTop((viewportHeight - cardHeight) / 2), left: clampLeft((viewportWidth - width) / 2) };
  }

  if (rect.left + rect.width + GAP + width <= viewportWidth - VIEWPORT_MARGIN) {
    return { top: clampTop(rect.top), left: rect.left + rect.width + GAP };
  }
  if (rect.top + rect.height + GAP + cardHeight <= viewportHeight - VIEWPORT_MARGIN) {
    return { top: rect.top + rect.height + GAP, left: clampLeft(rect.left) };
  }
  if (rect.top - GAP - cardHeight >= VIEWPORT_MARGIN) {
    return { top: rect.top - GAP - cardHeight, left: clampLeft(rect.left) };
  }
  return { top: clampTop(rect.top), left: clampLeft(rect.left - GAP - width) };
};

export function OnboardingTour({ open, steps, onClose }: Props) {
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const [card, setCard] = useState<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);

  const step = steps[Math.min(index, steps.length - 1)];
  const isLast = index >= steps.length - 1;

  const measure = useCallback(() => {
    if (!open || !step) return;
    const nextRect = readTargetRect(step.target);
    setRect(nextRect);
    setPosition(placeCard(nextRect, card?.offsetHeight ?? 220));
  }, [card, open, step]);

  useLayoutEffect(() => {
    if (!open) return;
    // Rola o alvo para a vista e mede no próximo quadro, já com o layout final.
    if (step?.target) {
      document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`)?.scrollIntoView({ block: "nearest" });
    }
    const frame = window.requestAnimationFrame(measure);
    return () => window.cancelAnimationFrame(frame);
  }, [measure, open, step]);

  useEffect(() => {
    if (!open) return;
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [measure, open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowRight") setIndex((value) => Math.min(value + 1, steps.length - 1));
      if (event.key === "ArrowLeft") setIndex((value) => Math.max(value - 1, 0));
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, open, steps.length]);

  if (!open || !step) return null;

  return (
    <div className="fixed inset-0 z-[90]" role="dialog" aria-modal="true" aria-label="Tutorial">
      {/* Clicar fora não fecha: evita perder o tutorial sem querer. */}
      {rect ? (
        <div
          className="pointer-events-none fixed rounded-xl transition-all duration-300"
          style={{
            top: rect.top,
            left: rect.left,
            width: rect.width,
            height: rect.height,
            // Anel + brilho + escurecimento do resto da tela, tudo num box-shadow só.
            boxShadow:
              "0 0 0 2px var(--tk-accent-soft, #a78bfa), 0 0 24px 4px var(--tk-accent-glow, rgba(139,92,246,0.6)), 0 0 0 9999px rgba(5, 3, 15, 0.72)",
          }}
        />
      ) : (
        <div className="fixed inset-0 bg-[rgba(5,3,15,0.72)]" />
      )}

      <div
        ref={setCard}
        className="fixed rounded-xl border border-[var(--tk-border-strong)] bg-[var(--tk-bg-panel)] p-4 text-[var(--tk-text)] shadow-2xl transition-[top,left] duration-300"
        style={{
          width: `min(${CARD_WIDTH}px, calc(100vw - ${VIEWPORT_MARGIN * 2}px))`,
          top: position?.top ?? "50%",
          left: position?.left ?? "50%",
          visibility: position ? "visible" : "hidden",
        }}
      >
        <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--tk-accent-soft)]">
          Passo {index + 1} de {steps.length}
        </p>
        <h3 className="mt-1 text-base font-bold text-[var(--tk-text-strong)]">{step.title}</h3>
        <div className="mt-2 space-y-2 text-sm leading-relaxed text-[var(--tk-text-muted)]">{step.body}</div>

        <div className="mt-4 flex items-center gap-2">
          <button
            type="button"
            onClick={onClose}
            className="mr-auto text-xs text-[var(--tk-text-faint)] hover:text-[var(--tk-text)]"
          >
            Pular tutorial
          </button>
          {index > 0 && (
            <button
              type="button"
              onClick={() => setIndex((value) => value - 1)}
              className="rounded-[3px] px-3 py-1.5 text-xs font-medium text-[var(--tk-text-muted)] hover:bg-[var(--tk-bg-hover)] hover:text-[var(--tk-text)]"
            >
              Voltar
            </button>
          )}
          <button
            type="button"
            autoFocus
            onClick={() => (isLast ? onClose() : setIndex((value) => value + 1))}
            className="rounded-[3px] bg-[var(--tk-accent)] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[var(--tk-accent-hover)]"
          >
            {isLast ? "Começar" : "Próximo"}
          </button>
        </div>
      </div>
    </div>
  );
}
