import { useEffect, useState, type ReactNode } from "react";
import { Check, Plus, X } from "lucide-react";
import { largeImage } from "../data/api";
import { dismissToast, useStore } from "../data/store";
import type { Scores } from "../data/types";
import { relativeDay, shortDate } from "../data/dates";

/** Cor estável por canal, para a capa de reserva quando não há imagem. */
function channelColor(channel?: string | null): string {
  const c = (channel ?? "").toLowerCase();
  if (c.includes("netflix")) return "#b81d24";
  if (c.includes("hbo")) return "#5b2dcc";
  if (c.includes("apple")) return "#2f2f33";
  if (c.includes("disney")) return "#113ccf";
  if (c.includes("prime") || c.includes("amazon")) return "#00769a";
  if (c.includes("hulu")) return "#128f4e";
  if (c.includes("paramount") || c.includes("cbs")) return "#0b57d0";
  if (c.includes("peacock") || c.includes("nbc")) return "#8a5a00";
  return "#4353e8";
}

const initials = (t: string) =>
  t.split(/[\s:\-]+/).filter((w) => w && /[\p{L}\p{N}]/u.test(w[0])).slice(0, 2).map((w) => w[0].toUpperCase()).join("") || "?";

/** Poster com capa de reserva. Com zoomable, clicar abre a imagem em grande. */
export function Poster({ src, large, title, channel, width, zoomable = true, rank }: {
  src?: string | null; large?: string | null; title: string; channel?: string | null; width: number | string; zoomable?: boolean; rank?: number;
}) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState(false);
  const show = src && !failed;
  return (
    <>
      <div
        className={`poster${zoomable && show ? " zoomable" : ""}`}
        style={{ width }}
        onClick={zoomable && show ? (e) => { e.preventDefault(); e.stopPropagation(); setOpen(true); } : undefined}
        role={zoomable && show ? "button" : undefined}
        aria-label={zoomable && show ? `Ver imagem de ${title} em grande` : undefined}
      >
        {(!show || !loaded) && <div className="mono" style={{ background: channelColor(channel) }}>{initials(title)}</div>}
        {show && <img src={src!} alt="" loading="lazy" style={{ opacity: loaded ? 1 : 0 }} onLoad={() => setLoaded(true)} onError={() => setFailed(true)} />}
        {rank != null && <span className="rank">{rank}</span>}
      </div>
      {open && <ImageViewer src={large ?? largeImage(src) ?? src!} fallback={src!} title={title} onClose={() => setOpen(false)} />}
    </>
  );
}

/** Imagem em ecrã inteiro. Clique para ampliar; Esc ou clique fora para fechar. */
export function ImageViewer({ src, fallback, title, onClose }: { src: string; fallback: string; title: string; onClose: () => void }) {
  const [url, setUrl] = useState(fallback);
  const [zoom, setZoom] = useState(1);
  useEffect(() => {
    // Mostra logo a pequena e troca pela grande quando carregar
    const img = new Image();
    img.onload = () => setUrl(src);
    img.src = src;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [src, onClose]);
  return (
    <div className="viewer" onClick={onClose} onWheel={(e) => setZoom((z) => Math.min(4, Math.max(1, z - e.deltaY / 400)))}>
      <button className="close" aria-label="Fechar" onClick={onClose}><X size={22} /></button>
      <img
        src={url} alt={title}
        style={{ transform: `scale(${zoom})`, cursor: zoom > 1 ? "zoom-out" : "zoom-in" }}
        onClick={(e) => { e.stopPropagation(); setZoom((z) => (z > 1 ? 1 : 2)); }}
      />
      <div className="cap">{title}</div>
    </div>
  );
}

export type TagKind = "mine" | "new" | "ret" | "film";
export const Tag = ({ kind, children }: { kind: TagKind; children: ReactNode }) => <span className={`tag ${kind}`}>{children}</span>;

/** Botão de seguir: ＋, depois indicador, depois pílula verde "A seguir". */
export function FollowButton({ followed, loading, onClick }: { followed: boolean; loading?: boolean; onClick: () => void }) {
  if (followed) return <span className="following"><Check size={15} strokeWidth={3} />A seguir</span>;
  if (loading) return <span className="follow" style={{ background: "none" }}><span className="spinner" /></span>;
  return (
    <button className="follow" title="Seguir" aria-label="Seguir" onClick={(e) => { e.preventDefault(); e.stopPropagation(); onClick(); }}>
      <Plus size={20} strokeWidth={2.6} />
    </button>
  );
}

export function Segmented<T extends string>({ options, value, onChange }: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="segmented" role="tablist">
      {options.map((o) => (
        <button key={o.value} role="tab" aria-selected={o.value === value} className={o.value === value ? "on" : ""} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

export function Chips<T extends string>({ options, value, onChange }: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="chips">
      {options.map((o) => (
        <button key={o.value} className={`chip${o.value === value ? " on" : ""}`} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

export function DayHeader({ date, today }: { date: string; today: string }) {
  const near = [today].includes(date) || relativeDay(date, today).length < 8;
  return (
    <div className={`day${date === today ? " today" : ""}`}>
      <span className="label">{relativeDay(date, today)}</span>
      {near && <span className="muted small">{shortDate(date)}</span>}
    </div>
  );
}

export function Empty({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return <div className="empty"><h3>{title}</h3><p>{body}</p>{action}</div>;
}

export const Spinner = () => <div className="center"><span className="spinner" /></div>;

const SCORE_META: Record<string, { label: string; title: string }> = {
  imdb: { label: "IMDb", title: "IMDb" },
  tomatoes: { label: "", title: "Rotten Tomatoes (críticos)" },
  popcorn: { label: "", title: "Rotten Tomatoes (público)" },
  metacritic: { label: "Metacritic", title: "Metacritic" },
  tmdb: { label: "TMDB", title: "TMDB" },
  letterboxd: { label: "Letterboxd", title: "Letterboxd" },
  trakt: { label: "Trakt", title: "Trakt" },
  myanimelist: { label: "MAL", title: "MyAnimeList" },
};

function ScoreItemChip({ it, imdbId, rtQuery }: { it: import("../data/types").ScoreItem; imdbId?: string | null; rtQuery?: string }) {
  const meta = SCORE_META[it.source] ?? { label: it.source, title: it.source };
  const votes = it.votes ? ` · ${it.votes.toLocaleString("pt-PT")} votos` : "";
  let cls = "score tm", icon = "";
  if (it.source === "imdb") cls = "score imdb";
  else if (it.source === "tomatoes") { cls = `score rt ${it.pct >= 60 ? "fresh" : "rotten"}`; icon = "🍅"; }
  else if (it.source === "popcorn") { cls = `score pop ${it.pct >= 60 ? "fresh" : "rotten"}`; icon = "🍿"; }
  else if (it.source === "metacritic") cls = `score mc ${it.pct >= 61 ? "good" : it.pct >= 40 ? "mixed" : "bad"}`;
  const href = it.source === "imdb" && imdbId ? `https://www.imdb.com/title/${imdbId}/`
    : (it.source === "tomatoes" || it.source === "popcorn") && rtQuery ? `https://www.rottentomatoes.com/search?search=${encodeURIComponent(rtQuery)}` : undefined;
  const inner = <>{icon && <span aria-hidden="true">{icon}</span>}{meta.label && <small>{meta.label.toUpperCase()}</small>}{it.text}</>;
  return href
    ? <a className={cls} href={href} target="_blank" rel="noopener" title={meta.title + votes}>{inner}</a>
    : <span className={cls} title={meta.title + votes}>{inner}</span>;
}

export function ScoreChips({ scores, title }: { scores: Scores | null | undefined; title?: string }) {
  if (!scores) return null;
  if (scores.all?.length) {
    return (
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {scores.all.map((it) => <ScoreItemChip key={it.source} it={it} imdbId={scores.imdbId} rtQuery={title} />)}
      </div>
    );
  }
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {scores.imdb && (
        <a className="score imdb" href={scores.imdbId ? `https://www.imdb.com/title/${scores.imdbId}/` : undefined} target="_blank" rel="noopener">
          <small>IMDB</small>{scores.imdb}/10
        </a>
      )}
      {scores.rottenTomatoes && <span className="score rt fresh"><span aria-hidden="true">🍅</span>{scores.rottenTomatoes}</span>}
      {!scores.imdb && scores.tvmaze != null && <span className="score tm"><small>TVMAZE</small>{scores.tvmaze.toFixed(1).replace(".", ",")}/10</span>}
    </div>
  );
}

export function AniScore({ score }: { score: number }) {
  const bg = score >= 75 ? "#1f8a5b" : score >= 60 ? "#b7791f" : "#6b7280";
  return <span className="score ani" style={{ background: bg }}>{score}%</span>;
}

export interface CarouselItem {
  key: string; title: string; image?: string | null; large?: string | null;
  line1?: string | null; line2?: string | null; rank?: number; loading?: boolean; onClick?: () => void; href?: string;
}

export function Carousel({ title, items }: { title: string; items: CarouselItem[] }) {
  if (!items.length) return null;
  return (
    <section>
      <h2 className="h2">{title}</h2>
      <div className="carousel">
        {items.map((it) => {
          const inner = (
            <>
              <div style={{ position: "relative" }}>
                <Poster src={it.image} large={it.large} title={it.title} width="100%" zoomable={false} rank={it.rank} />
                {it.loading && <div className="center" style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,.35)", borderRadius: 12 }}><span className="spinner" /></div>}
              </div>
              <span className="clamp2" style={{ fontWeight: 800 }}>{it.title}</span>
              {it.line1 && <span className="small primary-text clamp1">{it.line1}</span>}
              {it.line2 && <span className="small muted clamp1">{it.line2}</span>}
            </>
          );
          return it.href
            ? <a key={it.key} className="item" href={it.href} target="_blank" rel="noopener">{inner}</a>
            : <button key={it.key} className="item" onClick={it.onClick} disabled={it.loading}>{inner}</button>;
        })}
      </div>
    </section>
  );
}

export function Toasts() {
  const toast = useStore((s) => s.toast);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(dismissToast, toast.action ? 7000 : 3500);
    return () => clearTimeout(t);
  }, [toast]);
  if (!toast) return null;
  return (
    <div className="toast" role="status" key={toast.id}>
      <span>{toast.text}</span>
      {toast.actionLabel && <button onClick={() => { toast.action?.(); dismissToast(); }}>{toast.actionLabel}</button>}
    </div>
  );
}

/** Carrega dados assíncronos com estado de carregamento e erro. */
export function useAsync<T>(load: () => Promise<T>, deps: unknown[]) {
  const [state, setState] = useState<{ data?: T; error?: unknown; loading: boolean }>({ loading: true });
  const [n, setN] = useState(0);
  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: undefined }));
    load().then((data) => alive && setState({ data, loading: false }), (error) => alive && setState({ error, loading: false }));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, n]);
  return { ...state, reload: () => setN((x) => x + 1) };
}
