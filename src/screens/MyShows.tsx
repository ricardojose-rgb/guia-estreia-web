import { Link, useNavigate } from "react-router-dom";
import type { Show } from "../data/types";
import { useMemo, useState } from "react";
import { useStore } from "../data/store";
import { progress, stats } from "../data/selectors";
import { addDays, shortDate, usToday } from "../data/dates";
import { Empty, Poster, Segmented } from "../ui/components";

/** Um anime é uma série ligada a um anime do AniList ou com o género "Anime" no TVmaze. */
export function isAnime(show: Show, animeLinks: Record<number, number>): boolean {
  return Object.values(animeLinks).includes(show.id) || (show.genres ?? []).includes("Anime");
}

export default function MyShows({ kind = "series" }: { kind?: "series" | "anime" }) {
  const anime = kind === "anime";
  const allShows = useStore((s) => s.shows);
  const links = useStore((s) => s.animeLinks);
  const shows = useMemo(() => Object.fromEntries(Object.entries(allShows).filter(([, sh]) => isAnime(sh, links) === anime)), [allShows, links, anime]);
  const episodes = useStore((s) => s.episodes);
  const watched = useStore((s) => s.watched);
  const today = usToday();
  const list = useMemo(() => progress(shows, episodes, watched, today), [shows, episodes, watched, today]);
  const st = useMemo(() => {
    const ids = new Set(Object.keys(shows).map(Number));
    return stats(Object.fromEntries(Object.entries(episodes).filter(([id]) => ids.has(Number(id)))) as typeof episodes,
      Object.fromEntries(Object.entries(watched).filter(([, w]) => ids.has(w.showId))) as typeof watched);
  }, [episodes, watched, shows]);
  const nav = useNavigate();
  const word = (n: number) => anime ? (n === 1 ? "anime" : "animes") : (n === 1 ? "série" : "séries");
  const goDiscover = () => { try { localStorage.setItem("tab:discover", anime ? "anime" : "series"); } catch { /* sem armazenamento */ } nav("/descobrir"); };
  const tabKey = anime ? "tab:anime" : "tab:series";
  const [tab, setTab] = useState<"active" | "ended">(() => { try { return (localStorage.getItem(tabKey) as "active" | "ended") || "active"; } catch { return "active"; } });
  const choose = (t: "active" | "ended") => { setTab(t); try { localStorage.setItem(tabKey, t); } catch { /* sem armazenamento */ } };
  // Terminadas: séries que acabaram e não vão voltar (estado "Ended" no TVmaze)
  const ended = list.filter((p) => p.show.status === "Ended");
  const active = list.filter((p) => p.show.status !== "Ended");
  const shown = tab === "ended" ? ended : active;

  return (
    <>
      <p className="eyebrow" style={{ margin: "0 0 18px" }}>
        {list.length} {word(list.length)}
        {st.episodes > 0 && ` · ${st.episodes} ${st.episodes === 1 ? "episódio visto" : "episódios vistos"}${st.hours > 0 ? ` · cerca de ${st.hours} ${st.hours === 1 ? "hora" : "horas"}` : ""}`}
      </p>
      {list.length > 0 && (
        <Segmented value={tab} onChange={choose} options={[
          { value: "active", label: `A acompanhar · ${active.length}` },
          { value: "ended", label: `${anime ? "Terminados" : "Terminadas"} · ${ended.length}` },
        ]} />
      )}
      {list.length > 0 && !shown.length && (tab === "ended"
        ? <Empty title={anime ? "Nenhum anime terminado" : "Nenhuma série terminada"} body={`${anime ? "Os animes" : "As séries"} que acabarem passam para aqui automaticamente.`} />
        : <Empty title="Nada a acompanhar" body={`Tudo o que segues já terminou. Procura ${anime ? "animes" : "séries"} novos em Descobrir.`} action={<button className="btn filled" onClick={goDiscover}>Descobrir</button>} />)}
      <div style={{ height: 14 }} />
      {!list.length && (anime
        ? <Empty title="Ainda não segues nenhum anime" body="Em Descobrir → Anime procura um anime ou escolhe um da temporada e carrega em ＋. Ficas a saber quando sai cada episódio, em hora de Portugal." action={<button className="btn filled" onClick={goDiscover}>Procurar animes</button>} />
        : <Empty title="A tua lista está vazia" body="Procura uma série e carrega em ＋. Ficas a saber quando sai cada episódio e podes marcar o que já viste." action={<button className="btn filled" onClick={goDiscover}>Procurar séries</button>} />)}
      <div className="poster-grid">
        {shown.map(({ show, aired, watched: w, next }) => {
          const left = Math.max(0, aired - w);
          const line = left > 0 ? `${left} por ver`
            : next ? `Próximo: ${next === addDays(today, 1) ? "amanhã" : shortDate(next)}`
            : show.status === "Ended" ? "Vista até ao fim" : "Em dia";
          return (
            <Link key={show.id} to={`/serie/${show.id}`} className="tile">
              <Poster src={show.imageUrl} large={show.imageLarge} title={show.name} channel={show.channel} width="100%" zoomable={false} />
              <span className="clamp2" style={{ fontWeight: 800 }}>{show.name}</span>
              <span className="small" style={{ color: left > 0 ? "var(--primary)" : "var(--muted)" }}>{line}</span>
              {aired > 0 && <div className="bar"><i style={{ width: `${Math.min(100, (w / aired) * 100)}%` }} /></div>}
            </Link>
          );
        })}
      </div>
    </>
  );
}
