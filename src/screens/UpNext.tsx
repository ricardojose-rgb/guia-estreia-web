import { Link } from "react-router-dom";
import { Check } from "lucide-react";
import { useMemo } from "react";
import { markWatched, setWatched, catchUp, useStore } from "../data/store";
import { upNext } from "../data/selectors";
import { episodeCode, episodeTitle, relativeDay, usToday, addDays } from "../data/dates";
import { Empty, Poster } from "../ui/components";

export default function UpNextScreen() {
  const shows = useStore((s) => s.shows);
  const episodes = useStore((s) => s.episodes);
  const watched = useStore((s) => s.watched);
  const hide = useStore((s) => s.prefs.hideSpoilers);
  const ready = useStore((s) => s.ready);
  const today = usToday();
  const list = useMemo(() => upNext(shows, episodes, watched, today), [shows, episodes, watched, today]);
  const total = list.reduce((n, u) => n + u.remaining, 0);
  const watching = list.filter((u) => u.started);
  const notStarted = list.filter((u) => !u.started);

  if (!ready) return null;
  return (
    <>
      <p className="eyebrow" style={{ margin: "0 0 4px" }}>
        {total === 0 ? "Tudo em dia" : `${total} ${total === 1 ? "episódio" : "episódios"} por ver`}
      </p>
      {!list.length && (
        Object.keys(shows).length === 0
          ? <Empty title="Começa por seguir uma série" body="Aqui aparece o próximo episódio que tens para ver de cada série, com um botão para o marcares como visto." action={<Link className="btn filled" to="/descobrir">Procurar séries</Link>} />
          : <Empty title="Estás em dia" body="Não tens episódios por ver. Os próximos aparecem na Agenda." />
      )}
      {watching.length > 0 && <h2 className="h2">A ver</h2>}
      <div className="grid-cards">
        {watching.map((u) => <Card key={u.show.id} u={u} hide={hide} today={today} />)}
      </div>
      {notStarted.length > 0 && <h2 className="h2">Ainda não começaste</h2>}
      <div className="grid-cards">
        {notStarted.map((u) => <Card key={u.show.id} u={u} hide={hide} today={today} notStarted />)}
      </div>
    </>
  );
}

function Card({ u, hide, today, notStarted }: { u: ReturnType<typeof upNext>[number]; hide: boolean; today: string; notStarted?: boolean }) {
  const e = u.episode;
  const extra = [
    u.remaining > 1 ? `mais ${u.remaining - 1} por ver` : null,
    e.airdate && e.airdate >= addDays(today, -1) ? `estreou ${relativeDay(e.airdate, today).toLowerCase()}` : null,
    e.runtime ? `${e.runtime} min` : null,
  ].filter(Boolean).join(" · ");
  return (
    <div className="card upnext" data-anchor={`u-${u.show.id}`}>
      <Poster src={u.show.imageUrl} large={u.show.imageLarge} title={u.show.name} channel={u.show.channel} width={64} />
      <Link to={`/serie/${u.show.id}`} className="body">
        <span className="clamp1" style={{ fontWeight: 800, fontSize: 16 }}>{u.show.name}</span>
        <span className="clamp1">{[episodeCode(e.season, e.number), episodeTitle(e.name, hide)].filter(Boolean).join(" · ")}</span>
        {extra && <span className="small muted">{extra}</span>}
        {notStarted && u.remaining > 1 && (
          <button className="small primary-text" style={{ justifySelf: "start", textAlign: "left", fontWeight: 800, padding: "2px 0" }}
            onClick={(ev) => { ev.preventDefault(); catchUp(u.show.id); }}>Já viste tudo? Marcar em dia</button>
        )}
      </Link>
      <button className="btn tonal" onClick={() => (notStarted ? setWatched(u.show.id, [e.id], true) : markWatched(e))}>
        <Check size={17} strokeWidth={3} />Visto
      </button>
    </div>
  );
}
