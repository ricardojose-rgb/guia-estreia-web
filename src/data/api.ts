import { get as idbGet, set as idbSet } from "idb-keyval";
import type { AniMedia, AnimeEpisode, Anticipated, Premiere, Scores, TmdbMovie, TmEpisode, TmShow } from "./types";
import { addDays, seasonOf, usToday } from "./dates";

export class HttpError extends Error {
  constructor(public status: number) { super(`HTTP ${status}`); }
}

export function friendlyError(e: unknown): string {
  if (e instanceof HttpError) {
    if (e.status === 401) return "A chave não é válida. Confirma-a nas Definições.";
    return `O serviço respondeu com um erro (${e.status}). Tenta outra vez daqui a pouco.`;
  }
  if (e instanceof TypeError) return "Sem ligação à internet. Verifica a rede e tenta outra vez.";
  return "Não foi possível carregar os dados. Tenta outra vez.";
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Cache com validade, guardada no IndexedDB do browser. */
async function cached<T>(key: string, ttlMs: number, load: () => Promise<T>, force = false): Promise<T> {
  if (!force) {
    const hit = await idbGet<{ at: number; value: T }>(key).catch(() => undefined);
    if (hit && Date.now() - hit.at < ttlMs) return hit.value;
  }
  const value = await load();
  idbSet(key, { at: Date.now(), value }).catch(() => {});
  return value;
}

// ---------------- TVmaze ----------------
// Limite do TVmaze: 20 pedidos em 10 segundos. Fila com intervalo mínimo e nova tentativa em 429.
let tvChain: Promise<unknown> = Promise.resolve();
let lastTv = 0;

async function tvGet<T>(path: string): Promise<T> {
  const run = async (): Promise<T> => {
    for (let attempt = 0; ; attempt++) {
      const wait = lastTv + 300 - Date.now();
      if (wait > 0) await sleep(wait);
      lastTv = Date.now();
      const res = await fetch(`https://api.tvmaze.com${path}`);
      if (res.status === 429 && attempt < 3) { await sleep(1500 * (attempt + 1)); continue; }
      if (!res.ok) throw new HttpError(res.status);
      return res.json();
    }
  };
  const p = tvChain.then(run, run);
  tvChain = p.catch(() => {});
  return p;
}

export const TvMaze = {
  search: (q: string) => tvGet<{ score: number; show: TmShow }[]>(`/search/shows?q=${encodeURIComponent(q)}`),
  show: (id: number) => tvGet<TmShow>(`/shows/${id}`),
  episodes: (id: number) => tvGet<TmEpisode[]>(`/shows/${id}/episodes?specials=1`),
  scheduleUs: (date: string) => tvGet<TmEpisode[]>(`/schedule?country=US&date=${date}`),
  scheduleWeb: (date: string) => tvGet<TmEpisode[]>(`/schedule/web?date=${date}`),
  async lookup(imdb?: string | null, tvdb?: number | null): Promise<TmShow | null> {
    const q = imdb ? `imdb=${imdb}` : tvdb ? `thetvdb=${tvdb}` : null;
    if (!q) return null;
    try { return await tvGet<TmShow>(`/lookup/shows?${q}`); }
    catch (e) { if (e instanceof HttpError && e.status === 404) return null; throw e; }
  },
};

export const channelOf = (s: TmShow) => s.webChannel?.name ?? s.network?.name ?? null;

const INTERESTING = new Set(["Scripted", "Animation", "Documentary", "Reality"]);

/** Séries novas e regressos de temporada nos próximos [days] dias (TV dos EUA e streaming). */
export function premieres(days = 21, force = false): Promise<Premiere[]> {
  const today = usToday();
  return cached(`premieres:${today}`, 12 * 3600_000, async () => {
    const out = new Map<string, Premiere>();
    for (let i = 0; i < days; i++) {
      const day = addDays(today, i);
      const [tv, web] = await Promise.all([
        TvMaze.scheduleUs(day).catch(() => [] as TmEpisode[]),
        TvMaze.scheduleWeb(day).catch(() => [] as TmEpisode[]),
      ]);
      for (const ep of [...tv, ...web]) {
        const show = ep.show ?? ep._embedded?.show;
        if (!show || ep.number !== 1 || ep.season < 1) continue;
        if (!INTERESTING.has(show.type ?? "")) continue;
        if (show.language && show.language !== "English") continue;
        if (show.network && show.network.country?.code !== "US") continue;
        const wc = show.webChannel?.country?.code;
        if (!show.network && wc && wc !== "US") continue;
        const key = `${show.id}-${ep.season}`;
        if (!out.has(key)) out.set(key, {
          showId: show.id, title: show.name, date: ep.airdate || day, season: ep.season,
          isNew: ep.season === 1, channel: channelOf(show), imageUrl: show.image?.medium ?? null,
        });
      }
    }
    return [...out.values()].sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
  }, force);
}

// ---------------- AniList ----------------
const ANI_FIELDS = `id title { romaji english } coverImage { medium large extraLarge } averageScore episodes format status genres siteUrl popularity isAdult`;
const ANIME_FORMATS = new Set(["TV", "TV_SHORT", "ONA"]);

async function ani<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch("https://graphql.anilist.co", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new HttpError(res.status);
  const json = await res.json();
  return json.data as T;
}

export const aniTitle = (m: AniMedia) => m.title.english || m.title.romaji || "";

/** Animes da temporada atual e os que continuam no ar da anterior. */
export function animeSeason(): Promise<AniMedia[]> {
  return cached("anime:season", 6 * 3600_000, async () => {
    const now = new Date();
    const cur = seasonOf(now);
    const prev = seasonOf(new Date(now.getTime() - 92 * 86400_000));
    const q = `query ($season: MediaSeason, $year: Int, $page: Int) { Page(page: $page, perPage: 50) {
      media(season: $season, seasonYear: $year, type: ANIME, sort: POPULARITY_DESC, isAdult: false) { ${ANI_FIELDS} nextAiringEpisode { episode airingAt } } } }`;
    type R = { Page: { media: AniMedia[] } };
    const [a, b, c] = await Promise.all([
      ani<R>(q, { season: cur.season, year: cur.year, page: 1 }),
      ani<R>(q, { season: cur.season, year: cur.year, page: 2 }).catch(() => ({ Page: { media: [] } })),
      ani<R>(q, { season: prev.season, year: prev.year, page: 1 }).catch(() => ({ Page: { media: [] } })),
    ]);
    const continuing = c.Page.media.filter((m) => m.status === "RELEASING");
    const seen = new Set<number>();
    return [...a.Page.media, ...b.Page.media, ...continuing].filter((m) => {
      if (seen.has(m.id) || !ANIME_FORMATS.has(m.format ?? "")) return false;
      seen.add(m.id); return true;
    });
  });
}

/** Todos os episódios de anime dos próximos 14 dias. */
export function animeSchedule(): Promise<AnimeEpisode[]> {
  return cached("anime:schedule", 3 * 3600_000, async () => {
    const now = Math.floor(Date.now() / 1000);
    const q = `query ($from: Int, $to: Int, $page: Int) { Page(page: $page, perPage: 50) {
      pageInfo { hasNextPage }
      airingSchedules(airingAt_greater: $from, airingAt_lesser: $to, sort: TIME) { episode airingAt media { ${ANI_FIELDS} } } } }`;
    type R = { Page: { pageInfo: { hasNextPage: boolean }; airingSchedules: { episode: number; airingAt: number; media: AniMedia | null }[] } };
    const out: AnimeEpisode[] = [];
    for (let page = 1; page <= 8; page++) {
      const r = await ani<R>(q, { from: now - 6 * 3600, to: now + 14 * 86400, page });
      for (const a of r.Page.airingSchedules) {
        if (a.media && !a.media.isAdult && ANIME_FORMATS.has(a.media.format ?? "")) out.push({ episode: a.episode, airingAt: a.airingAt, media: a.media });
      }
      if (!r.Page.pageInfo.hasNextPage) break;
    }
    return out;
  });
}

/** Animes que ainda não estrearam, por popularidade. */
export function animeUpcoming(): Promise<AniMedia[]> {
  return cached("anime:upcoming", 12 * 3600_000, async () => {
    const q = `query { Page(page: 1, perPage: 25) {
      media(status: NOT_YET_RELEASED, type: ANIME, sort: POPULARITY_DESC, isAdult: false) { ${ANI_FIELDS} startDate { year month day } } } }`;
    const r = await ani<{ Page: { media: AniMedia[] } }>(q);
    return r.Page.media.filter((m) => ANIME_FORMATS.has(m.format ?? "") || m.format === "MOVIE");
  });
}

/** Tira "Season 3", "2nd Season", "Part 2" e afins do título de um anime. */
export function cleanAnimeTitle(t: string): string {
  return t
    .replace(/\b(season|part|cour)\s*\d+\b/gi, "")
    .replace(/\b\d+(st|nd|rd|th)\s+season\b/gi, "")
    .replace(/\bfinal season\b/gi, "")
    .replace(/\s+[-–:]\s*$/, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Encontra no TVmaze a série correspondente a um anime. */
export async function findAnimeShow(m: AniMedia): Promise<TmShow | null> {
  const names = [m.title.english, m.title.romaji].filter(Boolean) as string[];
  const candidates = [...new Set(names.flatMap((n) => [cleanAnimeTitle(n), n, n.split(":")[0].trim()]))].filter((c) => c.length >= 2);
  for (const q of candidates) {
    const hits = await TvMaze.search(q).catch(() => []);
    const hit = hits.find((h) => h.show.type === "Animation" || h.show.language === "Japanese");
    if (hit) return hit.show;
  }
  return null;
}

// ---------------- TMDB ----------------
async function tmdb<T>(token: string, path: string): Promise<T> {
  const res = await fetch(`https://api.themoviedb.org/3/${path}`, {
    headers: { Authorization: `Bearer ${token}`, accept: "application/json" },
  });
  if (!res.ok) throw new HttpError(res.status);
  return res.json();
}

export const tmdbPoster = (p?: string | null, size = "w342") => (p ? `https://image.tmdb.org/t/p/${size}${p}` : null);

/** Próximas estreias de filmes nos EUA. */
export function upcomingMovies(token: string): Promise<TmdbMovie[]> {
  return cached("movies:upcoming", 12 * 3600_000, async () => {
    const today = usToday();
    const pages = await Promise.all([1, 2, 3].map((p) =>
      tmdb<{ results: TmdbMovie[] }>(token, `movie/upcoming?language=pt-PT&region=US&page=${p}`).catch((e) => { if (p === 1) throw e; return { results: [] }; })));
    const seen = new Set<number>();
    return pages.flatMap((p) => p.results)
      .filter((m) => !seen.has(m.id) && seen.add(m.id) && (m.release_date ?? "") >= today)
      .sort((a, b) => (a.release_date ?? "").localeCompare(b.release_date ?? "") || (b.popularity ?? 0) - (a.popularity ?? 0));
  });
}

/** Filmes mais aguardados dos próximos 6 meses. */
export function anticipatedMovies(token: string): Promise<TmdbMovie[]> {
  return cached("movies:anticipated", 12 * 3600_000, async () => {
    const t = usToday();
    const r = await tmdb<{ results: TmdbMovie[] }>(token,
      `discover/movie?language=pt-PT&region=US&sort_by=popularity.desc&include_adult=false&with_release_type=2|3&primary_release_date.gte=${addDays(t, 1)}&primary_release_date.lte=${addDays(t, 180)}`);
    return r.results.slice(0, 20);
  });
}

/** Séries mais aguardadas: novas e temporadas novas nos próximos 4 meses. */
export function anticipatedSeries(token: string): Promise<Anticipated[]> {
  return cached("series:anticipated", 12 * 3600_000, async () => {
    const today = usToday();
    const until = addDays(today, 120);
    const base = "discover/tv?language=pt-PT&sort_by=popularity.desc&include_adult=false&with_type=2|4&without_genres=10763|10764|10767";
    type Tv = { id: number; name: string; original_name?: string; poster_path?: string | null; first_air_date?: string };
    const [n, r] = await Promise.all([
      tmdb<{ results: Tv[] }>(token, `${base}&first_air_date.gte=${today}&first_air_date.lte=${until}`),
      tmdb<{ results: Tv[] }>(token, `${base}&air_date.gte=${today}&air_date.lte=${until}&first_air_date.lte=${addDays(today, -60)}`),
    ]);
    const newOnes = n.results.slice(0, 20), back = r.results.slice(0, 20);
    const all = [...newOnes.map((t) => [t, true] as const), ...back.map((t) => [t, false] as const)];
    const details = await Promise.all(all.map(([t]) =>
      tmdb<{ next_episode_to_air?: { air_date?: string; season_number?: number } | null; networks?: { name?: string }[] }>(token, `tv/${t.id}?language=en-US`).catch(() => null)));
    const out: Anticipated[] = all.map(([t, isNew], i) => {
      const d = details[i];
      return {
        tmdbId: t.id, title: t.name, originalTitle: t.original_name ?? t.name, posterUrl: tmdbPoster(t.poster_path),
        date: d?.next_episode_to_air?.air_date ?? t.first_air_date ?? null,
        season: d?.next_episode_to_air?.season_number ?? (isNew ? 1 : null), isNew,
        network: d?.networks?.[0]?.name ?? null,
        rank: isNew ? i + 1 : i - newOnes.length + 1,
      };
    });
    return out.filter((a) => a.isNew || (a.date != null && a.date >= today));
  });
}

/** Converte uma série do TMDB no id do TVmaze. */
export async function tvmazeIdFor(token: string, a: Anticipated): Promise<number | null> {
  const ext = await tmdb<{ imdb_id?: string | null; tvdb_id?: number | null }>(token, `tv/${a.tmdbId}/external_ids`).catch(() => null);
  const found = await TvMaze.lookup(ext?.imdb_id, ext?.tvdb_id).catch(() => null);
  if (found) return found.id;
  const hits = await TvMaze.search(a.originalTitle).catch(() => []);
  return hits.find((h) => h.score > 0.6)?.show.id ?? null;
}

// ---------------- OMDb ----------------
type Omdb = { Response: string; imdbID?: string; imdbRating?: string; imdbVotes?: string; Ratings?: { Source: string; Value: string }[] };

function toScores(r: Omdb, tvmaze?: number | null): Scores {
  const ok = r.Response === "True";
  const v = (x?: string) => (ok && x && x !== "N/A" ? x : null);
  return {
    imdb: v(r.imdbRating), imdbVotes: v(r.imdbVotes), imdbId: ok ? r.imdbID ?? null : null,
    rottenTomatoes: ok ? r.Ratings?.find((x) => x.Source === "Rotten Tomatoes")?.Value ?? null : null,
    tvmaze: tvmaze ?? null,
  };
}

export async function showScores(key: string, imdbId: string | null | undefined, tvmaze?: number | null): Promise<Scores> {
  if (!key || !imdbId) return { imdbId, tvmaze };
  return cached(`omdb:${imdbId}`, 7 * 86400_000, async () => {
    const res = await fetch(`https://www.omdbapi.com/?i=${imdbId}&apikey=${encodeURIComponent(key)}`);
    if (!res.ok) throw new HttpError(res.status);
    return toScores(await res.json(), tvmaze);
  }).catch(() => ({ imdbId, tvmaze }));
}

export async function movieScores(key: string, m: TmdbMovie): Promise<Scores> {
  if (!key) return {};
  return cached(`omdb:m${m.id}`, 3 * 86400_000, async () => {
    const t = encodeURIComponent(m.original_title || m.title);
    const y = m.release_date?.slice(0, 4);
    const res = await fetch(`https://www.omdbapi.com/?t=${t}&type=movie${y ? `&y=${y}` : ""}&apikey=${encodeURIComponent(key)}`);
    if (!res.ok) throw new HttpError(res.status);
    return toScores(await res.json());
  }).catch(() => ({}));
}

// ---------------- Imagens ----------------
/** Versão em alta resolução para ver em ecrã inteiro. */
export function largeImage(url?: string | null): string | null {
  if (!url) return null;
  return url.replace("/medium_portrait/", "/original_untouched/").replace(/\/t\/p\/w\d+\//, "/t/p/original/");
}
