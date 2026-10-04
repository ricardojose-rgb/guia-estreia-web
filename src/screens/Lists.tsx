import { Link, useNavigate } from "react-router-dom";
import { Fragment, useEffect, useMemo, useState } from "react";
import type { AniMedia, AnimeEpisode, Premiere, TmdbMovie } from "../data/types";
import {
  aniTitle, animeSchedule, animeSeason, animeUpcoming, anticipatedMovies, friendlyError, movieScores, premieres, tmdbPoster, upcomingMovies,
} from "../data/api";
import { followAnime, followById, setWatched, markWatched, useStore } from "../data/store";
import { agendaEpisodes, type AgendaEpisode } from "../data/selectors";
import { addDays, episodeCode, episodeTitle, MONTHS_SHORT, ptAirTime, ptDayTime, ptToday, SEASON_PT, seasonOf, shortDate, usToday } from "../data/dates";
import { AniScore, Carousel, Chips, DayHeader, Empty, FollowButton, Poster, ScoreChips, Spinner, Tag, useAsync } from "../ui/components";
import { Check } from "lucide-react";

// ---------------- Séries ----------------

type SeriesFilter = "all" | "mine" | "new" | "ret";

export function SeriesAgenda() {
  const shows = useStore((s) => s.shows);
  const episodes = useStore((s) => s.episodes);
  const watched = useStore((s) => s.watched);
  const pending = useStore((s) => s.pending);
  const hide = useStore((s) => s.prefs.hideSpoilers);
  const [filter, setFilter] = useState<SeriesFilter>("all");
  const today = usToday();
  const prem = useAsync(() => premieres(), []);

  const eps = useMemo(() => agendaEpisodes(shows, episodes, watched, addDays(today, -7), addDays(today, 60)), [shows, episodes, watched, today]);
  const behind = eps.filter((e) => e.airdate! < today && !e.watched);
  const upcoming = eps.filter((e) => e.airdate! >= today);

  type Row = { date: string; ep?: AgendaEpisode; p?: Premiere };
  const rows = useMemo<Row[]>(() => {
    const mineKeys = new Set(upcoming.map((e) => `${e.showId}-${e.airdate}`));
    const p = (prem.data ?? []).filter((x) => !mineKeys.has(`${x.showId}-${x.date}`));
    const mine: Row[] = upcoming.map((e) => ({ date: e.airdate!, ep: e }));
    const pr: Row[] = p.map((x) => ({ date: x.date, p: x }));
    const chosen = filter === "all" ? [...mine, ...pr]
      : filter === "mine" ? [...mine, ...pr.filter((r) => shows[r.p!.showId])]
      : filter === "new" ? pr.filter((r) => r.p!.isNew) : pr.filter((r) => !r.p!.isNew);
    return chosen.sort((a, b) => a.date.localeCompare(b.date) || (a.ep ? 0 : 1) - (b.ep ? 0 : 1));
  }, [upcoming, prem.data, filter, shows]);

  const groups = groupBy(rows, (r) => r.date);
  return (
    <>
      <p className="eyebrow" style={{ marginTop: 14 }}>Datas dos EUA</p>
      <Chips value={filter} onChange={setFilter} options={[
        { value: "all", label: "Tudo" }, { value: "mine", label: "As minhas" }, { value: "new", label: "Séries novas" }, { value: "ret", label: "Regressos" },
      ]} />
      {prem.loading && filter !== "mine" && <div className="small muted" style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 12 }}><span className="spinner" />A carregar as estreias das próximas 3 semanas…</div>}
      {prem.error != null && <p className="small muted">{friendlyError(prem.error)} <button className="btn ghost" onClick={prem.reload}>Tentar outra vez</button></p>}

      {behind.length > 0 && (filter === "all" || filter === "mine") && (
        <>
          <h2 className="h2">Por ver · últimos 7 dias</h2>
          <div className="rows two">{behind.map((e) => <EpisodeRow key={`b${e.id}`} e={e} hide={hide} today={today} />)}</div>
        </>
      )}
      {!rows.length && !prem.loading && (
        filter === "mine" && !Object.keys(shows).length
          ? <Empty title="Ainda não segues séries" body="Procura as séries que vês e carrega em ＋. Os próximos episódios aparecem aqui." action={<Link className="btn filled" to="/descobrir">Procurar séries</Link>} />
          : <Empty title="Nada marcado" body="Não há estreias neste filtro para as próximas semanas." />
      )}
      {groups.map(([date, items]) => (
        <Fragment key={date}>
          <DayHeader date={date} today={today} />
          <div className="rows two">
            {items.map((r) => r.ep
              ? <EpisodeRow key={`e${r.ep.id}`} e={r.ep} hide={hide} today={today} />
              : <PremiereRow key={`p${r.p!.showId}-${r.p!.season}`} p={r.p!} followed={!!shows[r.p!.showId]} loading={!!pending[`t${r.p!.showId}`]} />)}
          </div>
        </Fragment>
      ))}
      <p className="small muted" style={{ marginTop: 28 }}>Os episódios que estreiam à noite nos EUA ficam normalmente disponíveis no dia seguinte em Portugal. Dados: TVmaze.</p>
    </>
  );
}

function EpisodeRow({ e, hide, today }: { e: AgendaEpisode; hide: boolean; today: string }) {
  const aired = e.airdate! <= today;
  const pt = ptAirTime(e.airstamp, e.airtime);
  return (
    <div className="row">
      <Poster src={e.show.imageUrl} large={e.show.imageLarge} title={e.show.name} channel={e.show.channel} width={48} />
      <Link to={`/serie/${e.showId}`} className="body">
        <span><Tag kind="mine">Sigo</Tag></span>
        <span className="title clamp1">{e.show.name}</span>
        <span className="small muted clamp1">{[episodeCode(e.season, e.number), episodeTitle(e.name, hide && !e.watched), e.show.channel].filter(Boolean).join(" · ")}</span>
        {pt && <span className="small primary-text">Em Portugal: {pt}</span>}
      </Link>
      {aired && (
        <button className={`check${e.watched ? " on" : ""}`} aria-label={e.watched ? "Marcar como não visto" : "Marcar como visto"}
          onClick={() => (e.watched ? setWatched(e.showId, [e.id], false) : markWatched(e))}>
          <Check size={16} strokeWidth={3.2} />
        </button>
      )}
    </div>
  );
}

export function PremiereRow({ p, followed, loading }: { p: Premiere; followed: boolean; loading: boolean }) {
  return (
    <div className="row">
      <Poster src={p.imageUrl} title={p.title} channel={p.channel} width={48} />
      <Link to={`/serie/${p.showId}`} className="body">
        <span>{followed ? <Tag kind="mine">Sigo</Tag> : p.isNew ? <Tag kind="new">Nova série</Tag> : <Tag kind="ret">Temporada {p.season}</Tag>}</span>
        <span className="title clamp1">{p.title}</span>
        <span className="small muted clamp1">{[p.isNew ? "Estreia" : "Regressa", p.channel].filter(Boolean).join(" · ")}</span>
      </Link>
      <FollowButton followed={followed} loading={loading} onClick={() => followById(p.showId, p.title)} />
    </div>
  );
}

// ---------------- Anime ----------------

/** Episódios de anime dos próximos 14 dias, em hora de Portugal. */
export function AnimeAgenda() {
  const [filter, setFilter] = useState<"pop" | "all">("pop");
  const sched = useAsync(() => animeSchedule(), []);
  const today = ptToday();
  const now = Date.now() / 1000 - 3 * 3600;
  const list = (sched.data ?? []).filter((e) => e.airingAt >= now && (filter === "all" || (e.media.popularity ?? 0) >= 15000));
  const groups = groupBy(list, (e) => ptDayTime(new Date(e.airingAt * 1000)).day);
  return (
    <>
      <p className="eyebrow" style={{ marginTop: 14 }}>Hora de Portugal · próximos 14 dias</p>
      <Chips value={filter} onChange={setFilter} options={[{ value: "pop", label: "Populares" }, { value: "all", label: "Todos" }]} />
      {sched.loading && <Spinner />}
      {sched.error != null && <Empty title="Não foi possível carregar" body={friendlyError(sched.error)} action={<button className="btn tonal" onClick={sched.reload}>Tentar outra vez</button>} />}
      {groups.map(([day, items]) => (
        <Fragment key={day}>
          <DayHeader date={day} today={today} />
          <div className="rows two">{items.map((e) => <AnimeEpisodeRow key={`${e.media.id}-${e.episode}`} e={e} />)}</div>
        </Fragment>
      ))}
      {sched.data && <p className="small muted" style={{ marginTop: 28 }}>Dados: AniList. As horas são as da estreia no Japão convertidas para Portugal. As plataformas de streaming podem disponibilizar o episódio mais tarde.</p>}
    </>
  );
}

function AnimeEpisodeRow({ e }: { e: AnimeEpisode }) {
  const t = ptDayTime(new Date(e.airingAt * 1000));
  const m = e.media;
  return (
    <a className="row" href={m.siteUrl ?? undefined} target="_blank" rel="noopener">
      <span className="time">{t.time}</span>
      <Poster src={m.coverImage?.large ?? m.coverImage?.medium} large={m.coverImage?.extraLarge} title={aniTitle(m)} width={44} />
      <span className="body">
        <span className="title clamp2" style={{ fontSize: 15 }}>{aniTitle(m)}</span>
        <span className="small" style={{ color: e.episode === 1 ? "var(--new)" : "var(--muted)" }}>
          {e.episode === 1 ? "Estreia · " : ""}Ep {e.episode}{m.episodes ? ` de ${m.episodes}` : ""}
        </span>
      </span>
      {m.averageScore != null && <AniScore score={m.averageScore} />}
    </a>
  );
}

type AnimeSort = "airing" | "pop" | "top";

/** Descobrir anime: mais aguardados e a temporada atual. */
export function AnimeDiscover() {
  const [sort, setSort] = useState<AnimeSort>("airing");
  const season = useAsync(() => animeSeason(), []);
  const upcoming = useAsync(() => animeUpcoming(), []);
  const links = useStore((s) => s.animeLinks);
  const shows = useStore((s) => s.shows);
  const pending = useStore((s) => s.pending);
  const today = ptToday();
  const { season: sn, year } = seasonOf(new Date());

  const all = season.data ?? [];
  const list = sort === "airing"
    ? all.filter((m) => m.nextAiringEpisode).sort((a, b) => a.nextAiringEpisode!.airingAt - b.nextAiringEpisode!.airingAt)
    : sort === "pop" ? [...all].sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0))
    : all.filter((m) => m.averageScore != null).sort((a, b) => (b.averageScore ?? 0) - (a.averageScore ?? 0));

  const row = (m: AniMedia) => {
    const followed = !!(links[m.id] && shows[links[m.id]]);
    const n = m.nextAiringEpisode;
    const t = n ? ptDayTime(new Date(n.airingAt * 1000)) : null;
    return (
      <div className="row" key={m.id}>
        <Poster src={m.coverImage?.large ?? m.coverImage?.medium} large={m.coverImage?.extraLarge} title={aniTitle(m)} width={52} />
        <a className="body" href={m.siteUrl ?? undefined} target="_blank" rel="noopener">
          <span className="title clamp2">{aniTitle(m)}</span>
          {n && t && <span className="small primary-text">Ep {n.episode}{m.episodes ? ` de ${m.episodes}` : ""} · {t.label}</span>}
          <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {m.averageScore != null && <AniScore score={m.averageScore} />}
            <span className="small muted clamp1">{(m.genres ?? []).slice(0, 2).join(", ")}</span>
          </span>
        </a>
        <FollowButton followed={followed} loading={!!pending[`a${m.id}`]} onClick={() => followAnime(m, aniTitle(m))} />
      </div>
    );
  };

  const groups = sort === "airing" ? groupBy(list, (m) => ptDayTime(new Date(m.nextAiringEpisode!.airingAt * 1000)).day) : null;
  return (
    <>
      <p className="eyebrow" style={{ marginTop: 14 }}>Temporada de {SEASON_PT[sn]} {year} · horas de Portugal · dados AniList</p>
      <Carousel title="Mais aguardados" items={(upcoming.data ?? []).map((m, i) => ({
        key: `u${m.id}`, title: aniTitle(m), image: m.coverImage?.extraLarge ?? m.coverImage?.large, large: m.coverImage?.extraLarge,
        line1: dateLabel(m) ?? "Data por anunciar", line2: m.format === "MOVIE" ? "Filme" : m.format === "ONA" ? "Streaming" : "Série",
        rank: i + 1, href: m.siteUrl ?? undefined,
      }))} />
      <h2 className="h2">Esta temporada</h2>
      <Chips value={sort} onChange={setSort} options={[{ value: "airing", label: "No ar" }, { value: "pop", label: "Populares" }, { value: "top", label: "Mais bem avaliados" }]} />
      {season.loading && <Spinner />}
      {season.error != null && <Empty title="Não foi possível carregar" body={friendlyError(season.error)} action={<button className="btn tonal" onClick={season.reload}>Tentar outra vez</button>} />}
      {groups
        ? groups.map(([day, items]) => <Fragment key={day}><DayHeader date={day} today={today} /><div className="rows two">{items.map(row)}</div></Fragment>)
        : <div className="rows two" style={{ marginTop: 12 }}>{list.map(row)}</div>}
    </>
  );
}

function dateLabel(m: AniMedia): string | null {
  const d = m.startDate;
  if (!d?.year) return null;
  if (!d.month) return `${d.year}`;
  if (!d.day) return `${MONTHS_SHORT[d.month - 1]} ${d.year}`;
  return `${d.day} ${MONTHS_SHORT[d.month - 1]} ${d.year}`;
}

// ---------------- Filmes ----------------

export function MoviesList({ withAnticipated = false }: { withAnticipated?: boolean }) {
  const token = useStore((s) => s.prefs.tmdbToken);
  const omdb = useStore((s) => s.prefs.omdbKey);
  const nav = useNavigate();
  const movies = useAsync(() => (token ? upcomingMovies(token) : Promise.resolve([] as TmdbMovie[])), [token]);
  const ant = useAsync(() => (token && withAnticipated ? anticipatedMovies(token) : Promise.resolve([] as TmdbMovie[])), [token, withAnticipated]);
  const today = usToday();
  const year = Number(today.slice(0, 4));

  if (!token) return (
    <div className="card notice" style={{ marginTop: 18 }}>
      <h3>Liga os filmes ao TMDB</h3>
      <p className="muted small" style={{ margin: 0 }}>A lista de filmes vem do TMDB, que pede uma chave gratuita. Se já a puseste na app do telemóvel, importa a cópia de segurança nas Definições e fica igual aqui.</p>
      <button className="btn tonal" onClick={() => nav("/definicoes")}>Abrir Definições</button>
    </div>
  );

  const list = (movies.data ?? []).filter((m) => m.release_date);
  const groups = groupBy(list, (m) => m.release_date!);
  return (
    <>
      {withAnticipated && <Carousel title="Mais aguardados" items={(ant.data ?? []).map((m, i) => ({
        key: `am${m.id}`, title: m.title, image: tmdbPoster(m.poster_path), large: tmdbPoster(m.poster_path, "original"),
        line1: m.release_date ? shortDate(m.release_date, year) : null, rank: i + 1, href: `https://www.themoviedb.org/movie/${m.id}`,
      }))} />}
      {withAnticipated && <h2 className="h2">Próximas estreias</h2>}
      {!withAnticipated && <p className="eyebrow" style={{ marginTop: 14 }}>Estreias nos EUA</p>}
      {movies.loading && <Spinner />}
      {movies.error != null && <Empty title="Não foi possível carregar" body={friendlyError(movies.error)} action={<button className="btn tonal" onClick={movies.reload}>Tentar outra vez</button>} />}
      {groups.map(([date, items]) => (
        <Fragment key={date}>
          <DayHeader date={date} today={today} />
          <div className="rows two">{items.map((m) => <MovieRow key={m.id} m={m} omdb={omdb} />)}</div>
        </Fragment>
      ))}
      {movies.data && <p className="small muted" style={{ marginTop: 28 }}>Dados de filmes: TMDB. Este produto usa a API do TMDB mas não é endossado nem certificado pelo TMDB.</p>}
    </>
  );
}

function MovieRow({ m, omdb }: { m: TmdbMovie; omdb: string }) {
  const [scores, setScores] = useState<Awaited<ReturnType<typeof movieScores>> | null>(null);
  useEffect(() => { let alive = true; movieScores(omdb, m).then((s) => alive && setScores(s)); return () => { alive = false; }; }, [m.id, omdb]);
  return (
    <div className="row">
      <Poster src={tmdbPoster(m.poster_path, "w185")} large={tmdbPoster(m.poster_path, "original")} title={m.title} width={52} />
      <a className="body" href={`https://www.themoviedb.org/movie/${m.id}`} target="_blank" rel="noopener">
        <span><Tag kind="film">Filme</Tag></span>
        <span className="title clamp2">{m.title}</span>
        <ScoreChips scores={scores} />
        {m.overview && <span className="small muted clamp2">{m.overview}</span>}
      </a>
    </div>
  );
}

// ---------------- util ----------------
export function groupBy<T>(items: T[], key: (t: T) => string): [string, T[]][] {
  const map = new Map<string, T[]>();
  for (const it of items) { const k = key(it); (map.get(k) ?? map.set(k, []).get(k)!).push(it); }
  return [...map.entries()];
}
