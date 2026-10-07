// Memória da navegação: posição da página, posição dos carrosséis e texto das pesquisas.
// Ao voltar atrás, cada página fica onde estava.
import { useEffect, useState } from "react";
import { useLocation, useNavigationType } from "react-router-dom";

const values = new Map<string, unknown>();

/** Como useState, mas o valor sobrevive a sair e voltar à página (enquanto o separador estiver aberto). */
export function useSessionState<T>(key: string, initial: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => (values.has(key) ? (values.get(key) as T) : initial));
  return [v, (x: T) => { values.set(key, x); setV(x); }];
}

/** Posição horizontal guardada de um carrossel. */
export const carouselPos = new Map<string, number>();

type Anchor = { key: string; offset: number };
type Saved = { y: number; anchors: Anchor[] };
const positions = new Map<string, Saved>();

/**
 * Os primeiros elementos marcados (data-anchor) visíveis no ecrã e a distância de cada um ao topo.
 * Guardamos vários: se o primeiro desaparecer (ex.: marcaste o episódio como visto), usa-se o seguinte.
 */
function currentAnchors(): Anchor[] {
  const out: Anchor[] = [];
  for (const el of document.querySelectorAll<HTMLElement>("[data-anchor]")) {
    const r = el.getBoundingClientRect();
    if (r.height > 0 && r.bottom > 8 && r.top < window.innerHeight) {
      out.push({ key: el.dataset.anchor!, offset: r.top });
      if (out.length >= 8) break;
    }
  }
  return out;
}

function findAnchor(key: string): HTMLElement | null {
  for (const el of document.querySelectorAll<HTMLElement>("[data-anchor]")) if (el.dataset.anchor === key) return el;
  return null;
}

/**
 * Guarda a posição de cada página e repõe-na quando se volta atrás.
 * Não guarda só os píxeis: guarda o cartão que estava no topo do ecrã e volta a alinhá-lo
 * enquanto a página acaba de carregar (imagens, estreias, etc.), para não "fugir" para baixo.
 */
export function ScrollMemory() {
  const loc = useLocation();
  const type = useNavigationType();

  useEffect(() => {
    try { history.scrollRestoration = "manual"; } catch { /* sem suporte */ }
  }, []);

  useEffect(() => {
    let frame = 0;
    let restoring = false;
    const save = () => {
      if (restoring) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => positions.set(loc.key, { y: window.scrollY, anchors: currentAnchors() }));
    };
    window.addEventListener("scroll", save, { passive: true });

    const saved = type === "POP" ? positions.get(loc.key) : undefined;
    let timer = 0;
    let ro: ResizeObserver | null = null;
    const events = ["wheel", "touchstart", "keydown", "mousedown"];
    const stop = () => {
      if (!restoring) return;
      restoring = false;
      window.clearInterval(timer);
      ro?.disconnect();
      for (const ev of events) window.removeEventListener(ev, stop);
    };
    if (saved && saved.y > 0) {
      restoring = true;
      const started = Date.now();
      const align = () => {
        if (!restoring) return;
        let hit: { el: HTMLElement; offset: number } | null = null;
        for (const a of saved.anchors) { const el = findAnchor(a.key); if (el) { hit = { el, offset: a.offset }; break; } }
        if (hit) {
          const diff = hit.el.getBoundingClientRect().top - hit.offset;
          if (Math.abs(diff) >= 1) window.scrollBy(0, diff);
        } else {
          window.scrollTo(0, saved.y);
        }
        // Continua a acertar durante uns segundos, enquanto o conteúdo muda de altura
        if (Date.now() - started > 15000) stop();
      };
      align();
      timer = window.setInterval(align, 100);
      ro = new ResizeObserver(() => requestAnimationFrame(align));
      ro.observe(document.body);
      // Se a pessoa mexer, deixa-a em paz
      for (const ev of events) window.addEventListener(ev, stop, { passive: true });
    } else if (type !== "POP") {
      window.scrollTo(0, 0);
    }
    return () => {
      stop();
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", save);
    };
  }, [loc.key, type]);

  return null;
}
