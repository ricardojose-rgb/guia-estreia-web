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

const positions = new Map<string, number>();

/** Guarda a posição de cada página e repõe-na quando se volta atrás. */
export function ScrollMemory() {
  const loc = useLocation();
  const type = useNavigationType();

  useEffect(() => {
    try { history.scrollRestoration = "manual"; } catch { /* sem suporte */ }
  }, []);

  useEffect(() => {
    let frame = 0;
    const save = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => positions.set(loc.key, window.scrollY));
    };
    window.addEventListener("scroll", save, { passive: true });

    const target = type === "POP" ? positions.get(loc.key) : undefined;
    let timer = 0, stopped = false;
    const stop = () => { stopped = true; window.clearInterval(timer); };
    if (target != null && target > 0) {
      // O conteúdo pode demorar a aparecer: tenta durante uns segundos até a página ter altura suficiente
      const started = Date.now();
      const tryRestore = () => {
        if (stopped) return;
        window.scrollTo(0, target);
        if (Math.abs(window.scrollY - target) < 2 || Date.now() - started > 4000) stop();
      };
      tryRestore();
      timer = window.setInterval(tryRestore, 80);
      // Se a pessoa começar a mexer, deixa de insistir
      for (const ev of ["wheel", "touchstart", "keydown", "mousedown"]) window.addEventListener(ev, stop, { once: true, passive: true });
    } else if (type !== "POP") {
      window.scrollTo(0, 0);
    }
    return () => {
      stop();
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", save);
      for (const ev of ["wheel", "touchstart", "keydown", "mousedown"]) window.removeEventListener(ev, stop);
    };
  }, [loc.key, type]);

  return null;
}
