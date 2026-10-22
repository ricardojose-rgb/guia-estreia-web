import { Link, useNavigate } from "react-router-dom";
import { Search, X } from "lucide-react";
import { MovieButtons } from "./Movies";
import { Fragment, useEffect, useMemo, useState } from "react";
import type { AniMedia, AnimeEpisode, HomeMovie, Premiere, TmdbMovie } from "../data/types";
import {
  aniTitle, animeSchedule, animeSeason, animeUpcoming, searchAnime, anticipatedHome, friendlyError, homeReleases, scoresForMovie, premieres, searchMovies, tmdbPoster,
} from "../data/api";
import { followAnime, followById, setWatched, markWatched, toMovieEntry, useStore } from "../data/store";
import { agendaEpisodes, type AgendaEpisode } from "../data/selectors";
import { addDays, jpDayTime, jpToday, episodeCode, episodeTitle, MONTHS_SHORT, ptAirTime, ptDayTime, ptToday, SEASON_PT, seasonOf, shortDate, usToday } from "../data/dates";
import { useSessionState } from "../ui/memory";
import { isAnime } from "./MyShows";
import { AniScore, Carousel, Chips, DayHeader, Empty, FollowButton, Poster, ScoreChips, Spinner, Tag, useAsync } from "../ui/components";
import { Check } from "lucide-react";

// ---------------- Séries ----------------

/**
 * Agenda das séries (ou dos animes) que segues: só episódios teus, nada de séries que não vês.
 * Séries em datas dos EUA; animes agrupados pelo dia em Portugal.
 */
export function SeriesAgenda({ kind = "series" }: { kind?: "series" | "anime" }) {
  const anime = kind === "anime";
  const allShows = useStore((s) => s.shows);
  const links = useStore((s) => s.animeLinks);
  const episodes = useStore((s) => s.episodes);
  const watched = useStore((s) => s.watched);
  const hide = useStore((s) => s.prefs.hideSpoilers);
  const today = usToday();
  const ptNow = ptToday();
  const shows = useMemo(() => Object.fromEntries(Object.entries(allShows).filter(([, sh]) => isAnime(sh, links) === anime)), [allShows, links, anime]);

  const eps = useMemo(() => agendaEpisodes(shows, episodes, watched, addDays(today, -7), addDays(today, 60)), [shows, episodes, watched, today]);
  // Datas sempre as de origem (EUA nas séries, Japão nos animes); a hora em Portugal aparece no cartão
  const dayOf = (e: AgendaEpisode) => e.airdate!;
  const ref = anime ? jpToday() : today;
  const behind = eps.filter((e) => dayOf(e) < ref && !e.watched);
  const upcoming = eps.filter((e) => dayOf(e) >= ref);
  // Vários episódios da mesma série no mesmo dia ficam num só cartão
  const groups = groupBy(groupEpisodes(upcoming, (e) => `${e.showId}-${dayOf(e)}`).sort((a, b) => dayOf(a[0]).localeCompare(dayOf(b[0]))), (g) => dayOf(g[0]));
  const word = anime ? "animes" : "séries";

  return (
    <>
      <p className="eyebrow" style={{ marginTop: 14 }}>{anime ? "Os animes que segues · datas do Japão" : `As ${word} que segues · datas dos EUA`}</p>
      {!Object.keys(shows).length && (
        <Empty title={`Ainda não segues ${word}`} body={`Procura em Descobrir e carrega em ＋. Os próximos episódios aparecem aqui.`}
          action={<Link className="btn filled" to="/descobrir">Descobrir</Link>} />
      )}
      {behind.length > 0 && (
        <>
          <h2 className="h2">Por ver · últimos 7 dias</h2>
          <div className="rows cards">{groupEpisodes(behind, (e) => `${e.showId}`).map((g) => <EpisodeRow key={`b${g[0].id}`} eps={g} hide={hide} today={ref} />)}</div>
        </>
      )}
      {Object.keys(shows).length > 0 && !upcoming.length && !behind.length && (
        <Empty title="Nada marcado" body={`Não há episódios novos das tuas ${word} nos próximos dois meses.`} />
      )}
      {groups.map(([date, items]) => (
        <Fragment key={date}>
          <DayHeader date={date} today={ref} />
          <div className="rows cards">{items.map((g) => <EpisodeRow key={`e${g[0].id}`} eps={g} hide={hide} today={ref} />)}</div>
        </Fragment>
      ))}
      <p className="small muted" style={{ marginTop: 28 }}>{anime
        ? "As datas são as da estreia no Japão; a hora em Portugal aparece em cada episódio. As plataformas de streaming podem disponibilizar o episódio um pouco mais tarde. Dados: TVmaze."
        : "Os episódios que estreiam à noite nos EUA ficam normalmente disponíveis no dia seguinte em Portugal. Dados: TVmaze."}</p>
    </>
  );
}

/** Junta episódios pela chave (mesma série, ou mesma série e dia), mantendo a ordem. */
function groupEpisodes(list: AgendaEpisode[], key: (e: AgendaEpisode) => string): AgendaEpisode[][] {
  const map = new Map<string, AgendaEpisode[]>();
  for (const e of list) { const k = key(e); (map.get(k) ?? map.set(k, []).get(k)!).push(e); }
  return [...map.values()].map((g) => g.sort((a, b) => a.season - b.season || (a.number ?? 0) - (b.number ?? 0)));
}

/** "T1 E1–E4" ou "T1 E9 – T2 E2". */
function episodeRange(g: AgendaEpisode[]): string {
  const a = g[0], b = g[g.length - 1];
  if (a.season === b.season && a.number != null && b.number != null) return `${episodeCode(a.season, a.number)}–E${String(b.number).padStart(2, "0")}`;
  return `${episodeCode(a.season, a.number)} – ${episodeCode(b.season, b.number)}`;
}

function EpisodeRow({ eps, hide, today }: { eps: AgendaEpisode[]; hide: boolean; today: string }) {
  const e = eps[0];
  const many = eps.length > 1;
  const aired = e.airdate! <= today;
  const allWatched = eps.every((x) => x.watched);
  const sameDay = eps.every((x) => x.airdate === e.airdate);
  const pt = ptAirTime(e.airstamp, e.airtime);
  return (
    <div className="row" data-anchor={`e-${e.id}`}>
      <Link to={`/serie/${e.showId}`} className="body">
        <Poster src={e.show.imageUrl} large={e.show.imageLarge} title={e.show.name} channel={e.show.channel} width="100%" zoomable={false} />
        <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}><Tag kind="mine">Sigo</Tag>{many && <Tag kind="new">{eps.length} episódios</Tag>}</span>
        <span className="title clamp1">{e.show.name}</span>
        <span className="small muted clamp1">{many
          ? [episodeRange(eps), sameDay ? (aired ? "saíram todos" : "saem todos de uma vez") : null].filter(Boolean).join(" · ")
          : [episodeCode(e.season, e.number), episodeTitle(e.name, hide && !e.watched), e.show.channel].filter(Boolean).join(" · ")}</span>
        {pt && <span className="small primary-text">Em Portugal: {pt}</span>}
      </Link>
      {aired && (
        <button className={`check${allWatched ? " on" : ""}`} aria-label={allWatched ? "Marcar como não visto" : many ? `Marcar os ${eps.length} como vistos` : "Marcar como visto"}
          onClick={() => (allWatched ? setWatched(e.showId, eps.map((x) => x.id), false) : many ? setWatched(e.showId, eps.filter((x) => !x.watched).map((x) => x.id), true) : markWatched(e))}>
          <Check size={16} strokeWidth={3.2} />
        </button>
      )}
    </div>
  );
}

export function PremiereRow({ p, followed, loading }: { p: Premiere; followed: boolean; loading: boolean }) {
  return (
    <div className="row" data-anchor={`p-${p.showId}-${p.season}`}>
      <Link to={`/serie/${p.showId}`} className="body">
        <Poster src={p.imageUrl} title={p.title} channel={p.channel} width="100%" zoomable={false} />
        <span>{followed ? <Tag kind="mine">Sigo</Tag> : p.isNew ? <Tag kind="new">Nova série</Tag> : <Tag kind="ret">Temporada {p.season}</Tag>}</span>
        <span className="title clamp1">{p.title}</span>
        <span className="small muted clamp1">{[p.isNew ? "Estreia" : "Regressa", p.channel].filter(Boolean).join(" · ")}</span>
      </Link>
      <FollowButton followed={followed} loading={loading} onClick={() => followById(p.showId, p.title)} />
    </div>
  );
}

// ---------------- Anime ----------------

/** Agenda dos animes que segues (episódios do TVmaze, em hora de Portugal). */
export function AnimeAgenda() {
  return <SeriesAgenda kind="anime" />;
}

function AnimeEpisodeRow({ e }: { e: AnimeEpisode }) {
  const t = ptDayTime(new Date(e.airingAt * 1000));
  const m = e.media;
  return (
    <Link className="row" to={`/anime/${m.id}`} data-anchor={`ae-${m.id}-${e.episode}`}>
      <span className="body">
        <Poster src={m.coverImage?.large ?? m.coverImage?.medium} large={m.coverImage?.extraLarge} title={aniTitle(m)} width="100%" zoomable={false} />
        <span className="time">{t.time}</span>
        <span className="title clamp2" style={{ fontSize: 15 }}>{aniTitle(m)}</span>
        <span className="small" style={{ color: e.episode === 1 ? "var(--new)" : "var(--muted)" }}>
          {e.episode === 1 ? "Estreia · " : ""}Ep {e.episode}{m.episodes ? ` de ${m.episodes}` : ""}
        </span>
      </span>
      {m.averageScore != null && <AniScore score={m.averageScore} />}
    </Link>
  );
}

type AnimeSort = "airing" | "pop" | "top";

/** Descobrir anime: mais aguardados e a temporada atual. */
export function AnimeDiscover() {
  const [sort, setSort] = useSessionState<AnimeSort>("sort:anime", "airing");
  const [q, setQ] = useSessionState("q:anime", "");
  const nav = useNavigate();
  const results = useAsync(() => (q.trim().length >= 2 ? new Promise<AniMedia[]>((res, rej) => setTimeout(() => searchAnime(q.trim()).then(res, rej), 350)) : Promise.resolve(null)), [q]);
  const season = useAsync(() => animeSeason(), []);
  const upcoming = useAsync(() => animeUpcoming(), []);
  const links = useStore((s) => s.animeLinks);
  const shows = useStore((s) => s.shows);
  const pending = useStore((s) => s.pending);
  const today = jpToday();
  const { season: sn, year } = seasonOf(new Date());

  const all = season.data ?? [];
  const list = sort === "airing"
    ? all.filter((m) => m.nextAiringEpisode).sort((a, b) => a.nextAiringEpisode!.airingAt - b.nextAiringEpisode!.airingAt)
    : sort === "pop" ? [...all].sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0))
    : all.filter((m) => m.averageScore != null).sort((a, b) => (b.averageScore ?? 0) - (a.averageScore ?? 0));

  const row = (m: AniMedia) => {
    const followed = !!(links[m.id] && shows[links[m.id]]);
    const n = m.nextAiringEpisode;
    const t = n ? jpDayTime(new Date(n.airingAt * 1000)) : null;
    const pt = n ? ptDayTime(new Date(n.airingAt * 1000)) : null;
    return (
      <div className="row" key={m.id} data-anchor={`a-${m.id}`}>
        <Link className="body" to={`/anime/${m.id}`}>
          <Poster src={m.coverImage?.large ?? m.coverImage?.medium} large={m.coverImage?.extraLarge} title={aniTitle(m)} width="100%" zoomable={false} />
          <span className="title clamp2">{aniTitle(m)}</span>
          {n && t && <span className="small primary-text">{n.episode > 0 ? `Ep ${n.episode}${m.episodes ? ` de ${m.episodes}` : ""}` : "Próximo ep."} · {t.label} Japão</span>}
          {pt && <span className="small muted">Em Portugal: {pt.label}</span>}
          {!n && m.status === "NOT_YET_RELEASED" && <span className="small primary-text">Estreia {dateLabel(m) ?? "por anunciar"}</span>}
          {!n && m.status === "FINISHED" && <span className="small muted">Terminado{m.startDate?.year ? ` · ${m.startDate.year}` : ""}</span>}
          <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {m.averageScore != null && <AniScore score={m.averageScore} />}
            <span className="small muted clamp1">{(m.genres ?? []).slice(0, 2).join(", ")}</span>
          </span>
        </Link>
        <FollowButton followed={followed} loading={!!pending[`a${m.id}`]} onClick={() => followAnime(m, aniTitle(m))} />
      </div>
    );
  };

  // Se a fonte não der as horas de emissão (Kitsu), mostra os que estão no ar sem agrupar por dia
  const noTimes = sort === "airing" && !list.length && all.length > 0;
  const shownList = noTimes ? all.filter((m) => m.status === "RELEASING").sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0)) : list;
  const groups = sort === "airing" && !noTimes ? groupBy(list, (m) => jpDayTime(new Date(m.nextAiringEpisode!.airingAt * 1000)).day) : null;
  return (
    <>
      <div className="search" style={{ marginTop: 14 }}>
        <Search size={19} className="muted" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Procurar um anime" aria-label="Procurar um anime" />
        {q && <button aria-label="Limpar pesquisa" onClick={() => setQ("")}><X size={18} /></button>}
      </div>
      {q.trim().length >= 2 && (
        <>
          {results.loading && <Spinner />}
          {results.error != null && <Empty title="Sem resultados" body={friendlyError(results.error)} />}
          {results.data && !results.data.length && <Empty title="Sem resultados" body="Não encontrei nenhum anime com esse nome. Experimenta o nome em japonês (romaji) ou em inglês." />}
          <div className="rows cards" style={{ marginTop: 14 }}>{(results.data ?? []).map(row)}</div>
        </>
      )}
      {q.trim().length < 2 && <>
      <p className="eyebrow" style={{ marginTop: 14 }}>Temporada de {SEASON_PT[sn]} {year} · datas do Japão · dados {(season.data?.[0]?.id ?? 1) <= -10_000_000 ? "Kitsu" : (season.data?.[0]?.id ?? 1) < 0 ? "MyAnimeList" : "AniList"}</p>
      <Carousel title="Mais aguardados" items={(upcoming.data ?? []).map((m, i) => ({
        key: `u${m.id}`, title: aniTitle(m), image: m.coverImage?.extraLarge ?? m.coverImage?.large, large: m.coverImage?.extraLarge,
        line1: dateLabel(m) ?? "Data por anunciar", line2: m.format === "MOVIE" ? "Filme" : m.format === "ONA" ? "Streaming" : "Série",
        rank: i + 1, onClick: () => nav(`/anime/${m.id}`),
      }))} />
      <h2 className="h2">Esta temporada</h2>
      <Chips value={sort} onChange={setSort} options={[{ value: "airing", label: "No ar" }, { value: "pop", label: "Populares" }, { value: "top", label: "Mais bem avaliados" }]} />
      {season.loading && <Spinner />}
      {season.error != null && <Empty title="Não foi possível carregar" body={friendlyError(season.error)} action={<button className="btn tonal" onClick={season.reload}>Tentar outra vez</button>} />}
      {groups
        ? groups.map(([day, items]) => <Fragment key={day}><DayHeader date={day} today={today} /><div className="rows cards">{items.map(row)}</div></Fragment>)
        : <div className="rows cards" style={{ marginTop: 12 }}>{shownList.map(row)}</div>}
      </>}
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
  const mdb = useStore((s) => s.prefs.mdblistKey);
  const nav = useNavigate();
  const movies = useAsync(() => (token ? homeReleases(token) : Promise.resolve([] as HomeMovie[])), [token]);
  const ant = useAsync(() => (token && withAnticipated ? anticipatedHome(token) : Promise.resolve([] as HomeMovie[])), [token, withAnticipated]);
  const [q, setQ] = useSessionState("q:movies", "");
  const results = useAsync(() => (q.trim().length >= 2 ? new Promise<TmdbMovie[]>((res, rej) => setTimeout(() => searchMovies(token, q.trim()).then(res, rej), 350)) : Promise.resolve(null)), [q]);
  const today = usToday();
  const year = Number(today.slice(0, 4));

  if (!token) return (
    <div className="card notice" style={{ marginTop: 18 }}>
      <h3>Liga os filmes ao TMDB</h3>
      <p className="muted small" style={{ margin: 0 }}>A lista de filmes vem do TMDB, que pede uma chave gratuita. Se já a puseste na app do telemóvel, a sincronização traz a chave para aqui.</p>
      <button className="btn tonal" onClick={() => nav("/definicoes")}>Abrir Definições</button>
    </div>
  );

  const all = movies.data ?? [];
  const coming = all.filter((m) => m.homeDate >= today);
  const out = all.filter((m) => m.homeDate < today).reverse();
  const groups = groupBy(coming, (m) => m.homeDate);
  return (
    <>
      {withAnticipated && (
        <div className="search" style={{ marginTop: 14 }}>
          <Search size={19} className="muted" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Procurar um filme" aria-label="Procurar um filme" />
          {q && <button aria-label="Limpar pesquisa" onClick={() => setQ("")}><X size={18} /></button>}
        </div>
      )}
      {withAnticipated && q.trim().length >= 2 && (
        <>
          {results.loading && <Spinner />}
          {results.data && !results.data.length && <Empty title="Sem resultados" body="Não encontrei nenhum filme com esse nome." />}
          <div className="rows cards" style={{ marginTop: 14 }}>
            {(results.data ?? []).map((m) => (
              <div className="row" key={m.id} data-anchor={`ms-${m.id}`}>
                <Link className="body" to={`/filme/${m.id}`}>
                  <Poster src={tmdbPoster(m.poster_path, "w342")} large={tmdbPoster(m.poster_path, "original")} title={m.title} width="100%" zoomable={false} />
                  <span className="title clamp2">{m.title}</span>
                  <span className="small muted">{m.release_date?.slice(0, 4) ?? "Sem data"}</span>
                </Link>
                <MovieButtons entry={toMovieEntry(m)} compact />
              </div>
            ))}
          </div>
        </>
      )}
      {!(withAnticipated && q.trim().length >= 2) && <>
      <p className="eyebrow" style={{ marginTop: 14 }}>Quando chegam a casa nos EUA · digital (streaming e aluguer) e Blu-ray</p>
      {withAnticipated && <Carousel title="Mais aguardados em casa" items={(ant.data ?? []).map((m, i) => ({
        key: `am${m.id}`, title: m.title, image: tmdbPoster(m.poster_path), large: tmdbPoster(m.poster_path, "original"),
        line1: `${m.digitalDate === m.homeDate ? "Digital" : "Blu-ray"} · ${shortDate(m.homeDate, year)}`,
        line2: m.theatricalDate ? `Cinema: ${shortDate(m.theatricalDate, year)}` : null,
        rank: i + 1, onClick: () => nav(`/filme/${m.id}`),
      }))} />}
      {movies.loading && <div className="small muted" style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 14 }}><span className="spinner" />A procurar as datas de digital e Blu-ray…</div>}
      {movies.error != null && <Empty title="Não foi possível carregar" body={friendlyError(movies.error)} action={<button className="btn tonal" onClick={movies.reload}>Tentar outra vez</button>} />}
      {coming.length > 0 && <h2 className="h2">Chegam em breve</h2>}
      {groups.map(([date, items]) => (
        <Fragment key={date}>
          <DayHeader date={date} today={today} />
          <div className="rows cards">{items.map((m) => <MovieRow key={m.id} m={m} omdb={omdb} mdb={mdb} year={year} />)}</div>
        </Fragment>
      ))}
      {out.length > 0 && (
        <>
          <h2 className="h2">Já disponíveis · últimos 30 dias</h2>
          <div className="rows cards">{out.map((m) => <MovieRow key={m.id} m={m} omdb={omdb} mdb={mdb} year={year} showDate />)}</div>
        </>
      )}
      {movies.data && !all.length && <Empty title="Sem filmes" body="Não encontrei filmes a sair em digital ou Blu-ray nas próximas semanas." />}
      </>}
      {movies.data && <p className="small muted" style={{ marginTop: 28 }}>Datas dos EUA; em Portugal o digital costuma chegar na mesma altura ou pouco depois. Dados de filmes: TMDB. Este produto usa a API do TMDB mas não é endossado nem certificado pelo TMDB.</p>}
    </>
  );
}

function MovieRow({ m, omdb, mdb, year, showDate }: { m: HomeMovie; omdb: string; mdb: string; year: number; showDate?: boolean }) {
  const [scores, setScores] = useState<Awaited<ReturnType<typeof scoresForMovie>> | null>(null);
  useEffect(() => { let alive = true; scoresForMovie({ omdbKey: omdb, mdblistKey: mdb }, m).then((s) => alive && setScores(s)); return () => { alive = false; }; }, [m.id, omdb, mdb]);
  const parts = [
    m.digitalDate ? `Digital ${shortDate(m.digitalDate, year)}` : null,
    m.physicalDate ? `Blu-ray ${shortDate(m.physicalDate, year)}` : null,
    m.theatricalDate ? `Cinema ${shortDate(m.theatricalDate, year)}` : null,
  ].filter(Boolean).join(" · ");
  return (
    <div className="row" data-anchor={`m-${m.id}`}>
      <Link className="body" to={`/filme/${m.id}`}>
        <Poster src={tmdbPoster(m.poster_path, "w342")} large={tmdbPoster(m.poster_path, "original")} title={m.title} width="100%" zoomable={false} />
        <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {m.digitalDate === m.homeDate && <Tag kind="film">Digital</Tag>}
          {m.physicalDate && <Tag kind="ret">Blu-ray</Tag>}
          {showDate && <span className="small muted">{shortDate(m.homeDate, year)}</span>}
        </span>
        <span className="title clamp2">{m.title}</span>
        <span className="small muted clamp1">{parts}</span>
        <ScoreChips scores={scores} title={m.original_title || m.title} ids={{ tmdbMovie: m.id }} />
        {m.providersPT.length > 0 && (
          <span className="small" style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <span className="muted">Em Portugal:</span>
            {m.providersPT.slice(0, 4).map((p) => p.logo
              ? <img key={p.name} src={p.logo} alt={p.name} title={p.name} style={{ width: 22, height: 22, borderRadius: 6 }} />
              : <span key={p.name}>{p.name}</span>)}
          </span>
        )}
      </Link>
      <MovieButtons entry={toMovieEntry(m)} compact />
    </div>
  );
}

// ---------------- util ----------------
export function groupBy<T>(items: T[], key: (t: T) => string): [string, T[]][] {
  const map = new Map<string, T[]>();
  for (const it of items) { const k = key(it); (map.get(k) ?? map.set(k, []).get(k)!).push(it); }
  return [...map.entries()];
}
