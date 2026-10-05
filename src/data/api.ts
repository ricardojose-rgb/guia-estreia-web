import { get as idbGet, set as idbSet } from "idb-keyval";
import type { AniDetails, AniMedia, AnimeEpisode, Anticipated, HomeMovie, MovieDetails, Premiere, ScoreItem, Scores, TmdbMovie, TmEpisode, TmShow } from "./types";
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

/** Procura animes pelo nome (AniList). */
export async function searchAnime(q: string): Promise<AniMedia[]> {
  const query = `query ($q: String) { Page(page: 1, perPage: 20) {
    media(search: $q, type: ANIME, isAdult: false, sort: SEARCH_MATCH) { ${ANI_FIELDS} startDate { year month day } nextAiringEpisode { episode airingAt } } } }`;
  const r = await ani<{ Page: { media: AniMedia[] } }>(query, { q });
  return r.Page.media;
}

/** Tudo o que a página do anime mostra; cache de 12 horas. */
export function animeDetails(id: number): Promise<AniDetails> {
  return cached(`anime:${id}`, 12 * 3600_000, async () => {
    const query = `query ($id: Int) { Media(id: $id, type: ANIME) { ${ANI_FIELDS} idMal bannerImage description(asHtml: false) season seasonYear duration
      startDate { year month day } nextAiringEpisode { episode airingAt } studios(isMain: true) { nodes { name } } externalLinks { site url type } } }`;
    const r = await ani<{ Media: AniDetails }>(query, { id });
    return r.Media;
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

/** Aceita a chave sozinha ou o link do email do OMDb ("...apikey=abcd1234"). */
export function normalizeOmdbKey(text: string): string {
  const t = text.trim();
  const m = t.match(/apikey=([A-Za-z0-9]+)/i);
  return (m ? m[1] : t).replace(/[^A-Za-z0-9]/g, "");
}

async function omdbGet(query: string, key: string): Promise<Omdb & { Error?: string }> {
  const res = await fetch(`https://www.omdbapi.com/?${query}&apikey=${encodeURIComponent(normalizeOmdbKey(key))}`);
  // O OMDb responde 401 com uma mensagem quando a chave não é válida ou não foi ativada
  const body = await res.json().catch(() => null);
  if (!body) throw new HttpError(res.status);
  return body;
}

/** Explica em português o erro do OMDb. */
export function omdbErrorPt(err?: string): string {
  const e = (err ?? "").toLowerCase();
  if (e.includes("invalid api key") || e.includes("no api key")) return "A chave do OMDb não é válida. Confirma que carregaste no link de ativação que veio no email do OMDb.";
  if (e.includes("limit")) return "Chegaste ao limite diário do OMDb (1000 pedidos). Volta a funcionar amanhã.";
  return err ? `O OMDb respondeu: ${err}` : "O OMDb não respondeu. Tenta outra vez daqui a pouco.";
}

/** Testa a chave com uma série conhecida. */
export async function testOmdbKey(key: string): Promise<{ ok: boolean; message: string }> {
  try {
    const r = await omdbGet("i=tt0944947", key);
    if (r.Response === "True") return { ok: true, message: `Chave válida ✓ (Game of Thrones: IMDb ${r.imdbRating}/10)` };
    return { ok: false, message: omdbErrorPt(r.Error) };
  } catch {
    return { ok: false, message: "Sem ligação ao OMDb. Verifica a internet e tenta outra vez." };
  }
}

// Só se guardam em cache as respostas com sucesso; um erro volta a ser tentado na próxima vez.
async function okOnly(key: string, ttl: number, load: () => Promise<Scores | null>): Promise<Scores | null> {
  const hit = await idbGet<{ at: number; value: Scores }>(key).catch(() => undefined);
  if (hit && Date.now() - hit.at < ttl && hit.value.imdb) return hit.value;
  const value = await load();
  if (value?.imdb) idbSet(key, { at: Date.now(), value }).catch(() => {});
  return value;
}

export async function showScores(key: string, imdbId: string | null | undefined, tvmaze?: number | null): Promise<Scores> {
  if (!key || !imdbId) return { imdbId, tvmaze };
  const s = await okOnly(`omdb2:${imdbId}`, 7 * 86400_000, async () => {
    const r = await omdbGet(`i=${imdbId}`, key);
    return r.Response === "True" ? toScores(r, tvmaze) : null;
  }).catch(() => null);
  return s ? { ...s, tvmaze } : { imdbId, tvmaze };
}

export async function movieScores(key: string, m: TmdbMovie): Promise<Scores> {
  if (!key) return {};
  const s = await okOnly(`omdb2:m${m.id}`, 3 * 86400_000, async () => {
    const t = encodeURIComponent(m.original_title || m.title);
    const y = m.release_date?.slice(0, 4);
    const r = await omdbGet(`t=${t}&type=movie${y ? `&y=${y}` : ""}`, key);
    return r.Response === "True" ? toScores(r) : null;
  }).catch(() => null);
  return s ?? {};
}

// ---------------- Imagens ----------------
/** Versão em alta resolução para ver em ecrã inteiro. */
export function largeImage(url?: string | null): string | null {
  if (!url) return null;
  return url.replace("/medium_portrait/", "/original_untouched/").replace(/\/t\/p\/w\d+\//, "/t/p/original/");
}

// ---------------- MDBList (todas as pontuações: IMDb, Rotten Tomatoes, Metacritic, TMDB…) ----------------
// GET https://api.mdblist.com/{imdb|tmdb}/{movie|show}/{id}?apikey=…  →  { ratings: [{ source, value, score, votes }] }

type MdbRating = { source?: string; value?: number | null; score?: number | null; votes?: number | string | null };

const ORDER = ["imdb", "tomatoes", "popcorn", "metacritic", "tmdb", "letterboxd", "myanimelist"];

function mdbItems(ratings: MdbRating[]): ScoreItem[] {
  const out: ScoreItem[] = [];
  for (const src of ORDER) {
    const r = ratings.find((x) => (x.source === src || (src === "popcorn" && x.source === "tomatoesaudience")) && (x.value ?? x.score ?? 0) > 0);
    if (!r) continue;
    const v = r.value ?? null, sc = r.score ?? null;
    const votes = r.votes == null ? null : Number(r.votes) || null;
    const one = (n: number) => n.toFixed(1).replace(".", ",");
    let text: string, pct: number;
    switch (src) {
      case "imdb": case "myanimelist": text = one(v ?? (sc ?? 0) / 10); pct = sc ?? (v ?? 0) * 10; break;
      case "letterboxd": text = one(v ?? (sc ?? 0) / 20); pct = sc ?? (v ?? 0) * 20; break;
      case "metacritic": text = String(Math.round(v ?? sc ?? 0)); pct = v ?? sc ?? 0; break;
      default: { const p = Math.round(src === "tmdb" || src === "trakt" ? (sc ?? (v ?? 0) * (v != null && v <= 10 ? 10 : 1)) : (v ?? sc ?? 0)); text = `${p}%`; pct = p; }
    }
    out.push({ source: src, text, pct, votes });
  }
  return out;
}

export function normalizeMdbKey(text: string): string {
  const t = text.trim();
  const m = t.match(/apikey=([A-Za-z0-9]+)/i);
  return (m ? m[1] : t).replace(/[^A-Za-z0-9]/g, "");
}

async function mdbGet(key: string, provider: "imdb" | "tmdb", type: "movie" | "show", id: string | number): Promise<{ status: number; body: any }> {
  const res = await fetch(`https://api.mdblist.com/${provider}/${type}/${encodeURIComponent(String(id))}?apikey=${encodeURIComponent(normalizeMdbKey(key))}`);
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

function mdbErrorPt(status: number, body: any): string {
  const e = String(body?.error ?? body?.message ?? "").toLowerCase();
  if (status === 429 || e.includes("limit")) return "Chegaste ao limite diário do MDBList (1000 pedidos). Volta a funcionar amanhã.";
  if (status === 401 || status === 403 || e.includes("key")) return "A chave do MDBList não é válida. Copia-a outra vez em mdblist.com → Preferences.";
  return `O MDBList respondeu com um erro (${status}). Tenta outra vez daqui a pouco.`;
}

export async function testMdbKey(key: string): Promise<{ ok: boolean; message: string }> {
  try {
    const r = await mdbGet(key, "imdb", "show", "tt0944947");
    const items = r.status === 200 ? mdbItems(r.body?.ratings ?? []) : [];
    if (items.length) {
      const imdb = items.find((i) => i.source === "imdb")?.text, rt = items.find((i) => i.source === "tomatoes")?.text;
      return { ok: true, message: `Chave válida ✓ (Game of Thrones: IMDb ${imdb ?? "—"} · Rotten Tomatoes ${rt ?? "—"})` };
    }
    return { ok: false, message: mdbErrorPt(r.status, r.body) };
  } catch {
    return { ok: false, message: "O browser não conseguiu contactar o MDBList. Verifica a internet; se continuar, as pontuações aparecem na app do telemóvel." };
  }
}

async function mdbScores(key: string, provider: "imdb" | "tmdb", type: "movie" | "show", id: string | number): Promise<ScoreItem[] | null> {
  const ck = `mdb:${provider}:${type}:${id}`;
  const hit = await idbGet<{ at: number; value: ScoreItem[] }>(ck).catch(() => undefined);
  if (hit && Date.now() - hit.at < 7 * 86400_000) return hit.value;
  const r = await mdbGet(key, provider, type, id);
  if (r.status === 404) { idbSet(ck, { at: Date.now(), value: [] }).catch(() => {}); return []; }
  if (r.status !== 200) return null;
  const items = mdbItems(r.body?.ratings ?? []);
  idbSet(ck, { at: Date.now(), value: items }).catch(() => {});
  return items;
}

/** Pontuações de uma série: MDBList se houver chave, senão OMDb, senão TVmaze. */
export async function scoresForShow(prefs: { mdblistKey: string; omdbKey: string }, imdbId: string | null | undefined, tvmaze?: number | null): Promise<Scores> {
  if (prefs.mdblistKey && imdbId) {
    const all = await mdbScores(prefs.mdblistKey, "imdb", "show", imdbId).catch(() => null);
    if (all?.length) return { all, imdbId, tvmaze };
  }
  return showScores(prefs.omdbKey, imdbId, tvmaze);
}

/** Pontuações de um filme: MDBList (pelo id do TMDB) se houver chave, senão OMDb. */
export async function scoresForMovie(prefs: { mdblistKey: string; omdbKey: string }, m: TmdbMovie): Promise<Scores> {
  if (prefs.mdblistKey) {
    const all = await mdbScores(prefs.mdblistKey, "tmdb", "movie", m.id).catch(() => null);
    if (all?.length) return { all };
  }
  return movieScores(prefs.omdbKey, m);
}

// ---------------- Filmes em casa (digital e Blu-ray) ----------------
// O TMDB guarda as datas de lançamento por país e por tipo: 1 antestreia, 2 e 3 cinema, 4 digital, 5 físico (Blu-ray/DVD).

type ReleaseDates = { results?: { iso_3166_1: string; release_dates: { type: number; release_date: string }[] }[] };
type Providers = { results?: Record<string, { flatrate?: { provider_name: string; logo_path?: string | null }[] }> };

async function homeDetails(token: string, m: TmdbMovie): Promise<HomeMovie | null> {
  return cached(`home:${m.id}`, 24 * 3600_000, async () => {
    const d = await tmdb<TmdbMovie & { release_dates?: ReleaseDates; "watch/providers"?: Providers }>(token,
      `movie/${m.id}?language=pt-PT&append_to_response=release_dates,watch/providers`);
    const us = d.release_dates?.results?.find((r) => r.iso_3166_1 === "US")?.release_dates ?? [];
    const first = (types: number[]) => us.filter((x) => types.includes(x.type)).map((x) => x.release_date.slice(0, 10)).sort()[0] ?? null;
    const digitalDate = first([4]), physicalDate = first([5]), theatricalDate = first([2, 3]);
    const homeDate = [digitalDate, physicalDate].filter(Boolean).sort()[0] as string | undefined;
    if (!homeDate) return null;
    const pt = d["watch/providers"]?.results?.PT?.flatrate ?? [];
    return {
      ...m, title: d.title || m.title, overview: d.overview || m.overview,
      homeDate, digitalDate, physicalDate, theatricalDate,
      providersPT: pt.map((p) => ({ name: p.provider_name, logo: p.logo_path ? `https://image.tmdb.org/t/p/w92${p.logo_path}` : null })),
    };
  }).catch(() => null);
}

/** Filmes que chegam (ou chegaram há pouco) a casa nos EUA: digital/streaming ou Blu-ray. */
export function homeReleases(token: string): Promise<HomeMovie[]> {
  const today = usToday();
  return cached(`home:list:${today}`, 6 * 3600_000, async () => {
    const from = addDays(today, -30), to = addDays(today, 90);
    const pages = await Promise.all([1, 2, 3].map((p) =>
      tmdb<{ results: TmdbMovie[] }>(token,
        `discover/movie?language=pt-PT&region=US&with_release_type=4|5&release_date.gte=${from}&release_date.lte=${to}&sort_by=popularity.desc&include_adult=false&page=${p}`)
        .catch((e) => { if (p === 1) throw e; return { results: [] }; })));
    const seen = new Set<number>();
    const base = pages.flatMap((p) => p.results).filter((m) => !seen.has(m.id) && seen.add(m.id)).slice(0, 50);
    const out: HomeMovie[] = [];
    for (let i = 0; i < base.length; i += 10) {
      const batch = await Promise.all(base.slice(i, i + 10).map((m) => homeDetails(token, m)));
      for (const h of batch) if (h && h.homeDate >= from && h.homeDate <= to) out.push(h);
    }
    return out.sort((a, b) => a.homeDate.localeCompare(b.homeDate) || (b.popularity ?? 0) - (a.popularity ?? 0));
  });
}

/** Filmes mais aguardados em casa nos próximos 6 meses. */
export function anticipatedHome(token: string): Promise<HomeMovie[]> {
  const today = usToday();
  return cached(`home:anticipated:${today}`, 12 * 3600_000, async () => {
    const r = await tmdb<{ results: TmdbMovie[] }>(token,
      `discover/movie?language=pt-PT&region=US&with_release_type=4|5&release_date.gte=${addDays(today, 1)}&release_date.lte=${addDays(today, 180)}&sort_by=popularity.desc&include_adult=false`);
    const list = await Promise.all(r.results.slice(0, 20).map((m) => homeDetails(token, m)));
    return list.filter((h): h is HomeMovie => !!h && h.homeDate > today);
  });
}

// ---------------- Filmes: pesquisa e detalhes ----------------

export async function searchMovies(token: string, q: string): Promise<TmdbMovie[]> {
  const r = await tmdb<{ results: TmdbMovie[] }>(token, `search/movie?language=pt-PT&include_adult=false&query=${encodeURIComponent(q)}`);
  return r.results;
}

type Prov = { provider_name: string; logo_path?: string | null };
const provList = (l?: Prov[]) => (l ?? []).map((p) => ({ name: p.provider_name, logo: p.logo_path ? `https://image.tmdb.org/t/p/w92${p.logo_path}` : null }));

/** Tudo o que a página do filme mostra; cache de 24 horas. */
export function movieDetails(token: string, id: number): Promise<MovieDetails> {
  return cached(`movie:${id}`, 24 * 3600_000, async () => {
    type D = {
      id: number; title: string; original_title?: string; overview?: string; poster_path?: string | null; backdrop_path?: string | null;
      release_date?: string; runtime?: number | null; genres?: { name: string }[]; imdb_id?: string | null;
      release_dates?: ReleaseDates;
      "watch/providers"?: { results?: Record<string, { flatrate?: Prov[]; rent?: Prov[]; buy?: Prov[] }> };
    };
    const d = await tmdb<D>(token, `movie/${id}?language=pt-PT&append_to_response=release_dates,watch/providers`);
    const us = d.release_dates?.results?.find((r) => r.iso_3166_1 === "US")?.release_dates ?? [];
    const first = (types: number[]) => us.filter((x) => types.includes(x.type)).map((x) => x.release_date.slice(0, 10)).sort()[0] ?? null;
    const digitalDate = first([4]), physicalDate = first([5]);
    const theatricalDate = first([2, 3]) ?? d.release_date ?? null;
    const pt = d["watch/providers"]?.results?.PT;
    const rent = [...(pt?.rent ?? []), ...(pt?.buy ?? [])].filter((p, i, a) => a.findIndex((x) => x.provider_name === p.provider_name) === i);
    return {
      id: d.id, title: d.title, originalTitle: d.original_title ?? d.title, overview: d.overview ?? "",
      poster: d.poster_path ?? null, backdrop: d.backdrop_path ?? null, year: d.release_date?.slice(0, 4) ?? null,
      runtime: d.runtime ?? null, genres: (d.genres ?? []).map((g) => g.name), imdbId: d.imdb_id ?? null,
      theatricalDate, digitalDate, physicalDate,
      homeDate: [digitalDate, physicalDate].filter(Boolean).sort()[0] ?? null,
      providersPT: provList(pt?.flatrate), rentPT: provList(rent),
    };
  });
}
