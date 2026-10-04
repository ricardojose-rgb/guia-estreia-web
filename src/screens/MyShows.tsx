import { Link } from "react-router-dom";
import { useMemo, useState } from "react";
import { useStore } from "../data/store";
import { progress, stats } from "../data/selectors";
import { addDays, shortDate, usToday } from "../data/dates";
import { Empty, Poster, Segmented } from "../ui/components";

export default function MyShows() {
  const shows = useStore((s) => s.shows);
  const episodes = useStore((s) => s.episodes);
  const watched = useStore((s) => s.watched);
  const today = usToday();
  const list = useMemo(() => progress(shows, episodes, watched, today), [shows, episodes, watched, today]);
  const st = useMemo(() => stats(episodes, watched), [episodes, watched]);
  const [tab, setTab] = useState<"active" | "ended">(() => { try { return (localStorage.getItem("tab:series") as "active" | "ended") || "active"; } catch { return "active"; } });
  const choose = (t: "active" | "ended") => { setTab(t); try { localStorage.setItem("tab:series", t); } catch { /* sem armazenamento */ } };
  // Terminadas: séries que acabaram e não vão voltar (estado "Ended" no TVmaze)
  const ended = list.filter((p) => p.show.status === "Ended");
  const active = list.filter((p) => p.show.status !== "Ended");
  const shown = tab === "ended" ? ended : active;

  return (
    <>
      <p className="eyebrow" style={{ margin: "0 0 18px" }}>
        {list.length} {list.length === 1 ? "série" : "séries"}
        {st.episodes > 0 && ` · ${st.episodes} ${st.episodes === 1 ? "episódio visto" : "episódios vistos"}${st.hours > 0 ? ` · cerca de ${st.hours} ${st.hours === 1 ? "hora" : "horas"}` : ""}`}
      </p>
      {list.length > 0 && (
        <Segmented value={tab} onChange={choose} options={[
          { value: "active", label: `A acompanhar · ${active.length}` },
          { value: "ended", label: `Terminadas · ${ended.length}` },
        ]} />
      )}
      {list.length > 0 && !shown.length && (tab === "ended"
        ? <Empty title="Nenhuma série terminada" body="As séries que acabarem e não forem voltar passam para aqui automaticamente." />
        : <Empty title="Nada a acompanhar" body="Todas as séries que segues já terminaram. Procura séries novas em Descobrir." action={<Link className="btn filled" to="/descobrir">Descobrir</Link>} />)}
      <div style={{ height: 14 }} />
      {!list.length && <Empty title="A tua lista está vazia" body="Procura uma série e carrega em ＋. Ficas a saber quando sai cada episódio e podes marcar o que já viste." action={<Link className="btn filled" to="/descobrir">Procurar séries</Link>} />}
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
