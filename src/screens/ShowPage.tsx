import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Check, ChevronDown, ChevronUp, ExternalLink } from "lucide-react";
import type { Episode, Scores, TmShow } from "../data/types";
import { channelOf, friendlyError, showScores, TvMaze } from "../data/api";
import { catchUp, follow, markWatched, setWatched, toEpisodes, unfollow, useStore } from "../data/store";
import { episodeCode, episodeTitle, ptAirTime, relativeDay, shortDate, statusPt, stripHtml, usToday } from "../data/dates";
import { Empty, Poster, ScoreChips, Spinner } from "../ui/components";

export default function ShowPage() {
  const id = Number(useParams().id);
  const nav = useNavigate();
  const followed = useStore((s) => !!s.shows[id]);
  const localEps = useStore((s) => s.episodes[id]);
  const watched = useStore((s) => s.watched);
  const hide = useStore((s) => s.prefs.hideSpoilers);
  const omdb = useStore((s) => s.prefs.omdbKey);
  const pending = useStore((s) => !!s.pending[`t${id}`]);
  const [show, setShow] = useState<TmShow | null>(null);
  const [remote, setRemote] = useState<Episode[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [scores, setScores] = useState<Scores | null>(null);
  const [open, setOpen] = useState<Record<number, boolean>>({});
  const today = usToday();

  useEffect(() => {
    let alive = true;
    setShow(null); setError(null); setScores(null); setOpen({});
    TvMaze.show(id).then((s) => {
      if (!alive) return;
      setShow(s);
      setScores({ imdbId: s.externals?.imdb, tvmaze: s.rating?.average });
      showScores(omdb, s.externals?.imdb, s.rating?.average).then((sc) => alive && setScores(sc));
    }, (e) => alive && setError(e));
    TvMaze.episodes(id).then((e) => alive && setRemote(toEpisodes(id, e)), () => {});
    window.scrollTo(0, 0);
    return () => { alive = false; };
  }, [id, omdb]);

  const episodes = followed && localEps?.length ? localEps : remote ?? [];
  const seasons = useMemo(() => {
    const m = new Map<number, Episode[]>();
    for (const e of episodes) (m.get(e.season) ?? m.set(e.season, []).get(e.season)!).push(e);
    return [...m.entries()].sort((a, b) => b[0] - a[0]);
  }, [episodes]);

  if (error && !show) return <Empty title="Não foi possível abrir a série" body={friendlyError(error)} action={<button className="btn tonal" onClick={() => nav(0)}>Tentar outra vez</button>} />;
  if (!show) return <Spinner />;

  const next = episodes.filter((e) => e.airdate && e.airdate > today).sort((a, b) => a.airdate!.localeCompare(b.airdate!))[0];
  const behind = episodes.filter((e) => e.season > 0 && e.airdate && e.airdate <= today && !watched[e.id]).length;
  const summary = stripHtml(show.summary);
  const q = encodeURIComponent(show.name);
  const lastSeason = seasons[0]?.[0];

  return (
    <>
      <div className="hero">
        {show.image?.original && <div className="backdrop" style={{ backgroundImage: `url(${show.image.original})` }} />}
        <div className="fade" />
        <button className="btn ghost back" onClick={() => nav(-1)}><ArrowLeft size={18} />Voltar</button>
        <div className="content">
          <Poster src={show.image?.medium} large={show.image?.original} title={show.name} channel={channelOf(show)} width={160} />
          <div className="info">
            <h1>{show.name}</h1>
            <span className="muted">{[show.premiered?.slice(0, 4), channelOf(show), statusPt(show.status)].filter(Boolean).join(" · ")}</span>
            {!!show.genres?.length && <span className="muted small">{show.genres.join(", ")}</span>}
            <ScoreChips scores={scores} />
            {next && (
              <span className="primary-text" style={{ fontWeight: 800 }}>
                Próximo: {episodeCode(next.season, next.number)} · {relativeDay(next.airdate!, today)} (EUA)
                {ptAirTime(next.airstamp, next.airtime) && <><br />Em Portugal: {ptAirTime(next.airstamp, next.airtime)}</>}
              </span>
            )}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
              {followed
                ? <button className="btn tonal" onClick={() => unfollow(id)}><Check size={17} strokeWidth={3} />A seguir</button>
                : <button className="btn filled" disabled={pending} onClick={() => follow(show)}>{pending ? "A adicionar…" : "Seguir"}</button>}
              {followed && behind > 0 && <button className="btn ghost" onClick={() => catchUp(id)}>Já vi tudo até hoje</button>}
            </div>
          </div>
        </div>
      </div>

      {summary && <p style={{ maxWidth: "72ch", fontSize: 15, lineHeight: 1.6 }}>{summary}</p>}
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", margin: "0 -12px" }}>
        <a className="btn ghost" href={`https://www.rottentomatoes.com/search?search=${q}`} target="_blank" rel="noopener">Rotten Tomatoes <ExternalLink size={14} /></a>
        <a className="btn ghost" href={`https://www.justwatch.com/pt/pesquisa?q=${q}`} target="_blank" rel="noopener">Onde ver (JustWatch) <ExternalLink size={14} /></a>
        {show.externals?.imdb && <a className="btn ghost" href={`https://www.imdb.com/title/${show.externals.imdb}/`} target="_blank" rel="noopener">IMDb <ExternalLink size={14} /></a>}
      </div>
      {!followed && episodes.length > 0 && <p className="small muted">Segue a série para marcares os episódios que já viste.</p>}

      {seasons.map(([season, eps]) => {
        const aired = eps.filter((e) => e.airdate && e.airdate <= today);
        const seen = eps.filter((e) => watched[e.id]).length;
        const isOpen = open[season] ?? (aired.some((e) => !watched[e.id]) || season === lastSeason);
        const allSeen = aired.length > 0 && aired.every((e) => watched[e.id]);
        return (
          <section key={season}>
            <div className="season-head">
              <button style={{ flex: 1, textAlign: "left", display: "flex", alignItems: "center", gap: 10 }} onClick={() => setOpen((o) => ({ ...o, [season]: !isOpen }))}>
                <h3>{season === 0 ? "Especiais" : `Temporada ${season}`}</h3>
                <span className="small muted">{followed ? `${seen} de ${eps.length} vistos` : `${eps.length} episódios`}</span>
                {isOpen ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
              </button>
              {followed && aired.length > 0 && (
                <button className="btn ghost" onClick={() => setWatched(id, aired.map((e) => e.id), !allSeen)}>{allSeen ? "Desmarcar" : "Marcar vistos"}</button>
              )}
            </div>
            {isOpen && (
              <div className="rows two">
                {eps.map((e) => {
                  const w = !!watched[e.id];
                  const isAired = !!e.airdate && e.airdate <= today;
                  const pt = ptAirTime(e.airstamp, e.airtime);
                  return (
                    <div className="ep" key={e.id}>
                      <span className="num">{e.number != null ? String(e.number).padStart(2, "0") : "—"}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="clamp1" style={{ fontWeight: 700 }}>{episodeTitle(e.name, hide && !w) ?? `Episódio ${e.number ?? ""}`}</div>
                        <div className="small" style={{ color: !isAired && e.airdate ? "var(--primary)" : "var(--muted)" }}>
                          {!e.airdate ? "Data por anunciar" : isAired ? shortDate(e.airdate, 0) : `Estreia ${relativeDay(e.airdate, today).toLowerCase()} (EUA)${pt ? ` · em Portugal ${pt}` : ""}`}
                        </div>
                      </div>
                      {followed && isAired && (
                        <button className={`check${w ? " on" : ""}`} aria-label={w ? "Marcar como não visto" : "Marcar como visto"}
                          onClick={() => (w ? setWatched(id, [e.id], false) : markWatched(e))}>
                          <Check size={16} strokeWidth={3.2} />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        );
      })}
    </>
  );
}
