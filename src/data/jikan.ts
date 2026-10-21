// Alternativa ao AniList: Jikan (dados do MyAnimeList). Usa-se quando o AniList falha.
// Os animes que vêm daqui têm id negativo (-id do MyAnimeList) para não se confundirem com os do AniList.
import type { AniDetails, AniMedia } from "./types";

const BASE = "https://api.jikan.moe/v4";

// Limite do Jikan: 3 pedidos por segundo. Fila simples com intervalo mínimo e nova tentativa em 429.
let chain: Promise<unknown> = Promise.resolve();
function jikan<T>(path: string): Promise<T> {
  const run = async (): Promise<T> => {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(`${BASE}${path}`, { headers: { Accept: "application/json" } });
      if (res.status === 429 && attempt < 3) { await new Promise((r) => setTimeout(r, 1200 * (attempt + 1))); continue; }
      if (!res.ok) throw new Error(`Jikan ${res.status}`);
      return res.json() as Promise<T>;
    }
  };
  const p = chain.then(run, run);
  chain = p.then(() => new Promise((r) => setTimeout(r, 400)), () => new Promise((r) => setTimeout(r, 400)));
  return p;
}

type JDate = { day?: number | null; month?: number | null; year?: number | null };
export interface JAnime {
  mal_id: number; url?: string; title: string; title_english?: string | null;
  images?: { jpg?: { image_url?: string; large_image_url?: string }; webp?: { large_image_url?: string } };
  type?: string | null; episodes?: number | null; status?: string | null; score?: number | null; members?: number | null;
  genres?: { name: string }[]; aired?: { from?: string | null; prop?: { from?: JDate } };
  broadcast?: { day?: string | null; time?: string | null; timezone?: string | null };
  synopsis?: string | null; season?: string | null; year?: number | null; duration?: string | null;
  studios?: { name: string }[]; streaming?: { name: string; url: string }[]; rating?: string | null;
}

const FORMAT: Record<string, string> = { TV: "TV", "TV Special": "SPECIAL", ONA: "ONA", OVA: "OVA", Movie: "MOVIE", Special: "SPECIAL" };
const STATUS: Record<string, string> = { "Currently Airing": "RELEASING", "Finished Airing": "FINISHED", "Not yet aired": "NOT_YET_RELEASED" };
const DAYS = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];

/** Próxima emissão semanal a partir do dia e hora do Japão ("Mondays", "23:30"). */
function nextBroadcast(b?: JAnime["broadcast"]): number | null {
  if (!b?.day || !b.time) return null;
  const dow = DAYS.indexOf(b.day);
  const [h, m] = b.time.split(":").map(Number);
  if (dow < 0 || isNaN(h)) return null;
  // Hora do Japão = UTC+9, sem horário de verão
  const now = new Date();
  const jstNow = new Date(now.getTime() + 9 * 3600_000);
  let days = (dow - jstNow.getUTCDay() + 7) % 7;
  const cand = () => Date.UTC(jstNow.getUTCFullYear(), jstNow.getUTCMonth(), jstNow.getUTCDate() + days, h, m || 0) - 9 * 3600_000;
  if (cand() < now.getTime() - 3600_000) days += 7;
  return Math.floor(cand() / 1000);
}

export function fromJikan(a: JAnime): AniMedia {
  const from = a.aired?.prop?.from;
  const airing = STATUS[a.status ?? ""] === "RELEASING";
  const next = airing ? nextBroadcast(a.broadcast) : null;
  const large = a.images?.jpg?.large_image_url ?? a.images?.jpg?.image_url ?? null;
  return {
    id: -a.mal_id,
    title: { english: a.title_english ?? null, romaji: a.title },
    coverImage: { medium: a.images?.jpg?.image_url ?? large, large, extraLarge: a.images?.webp?.large_image_url ?? large },
    averageScore: a.score != null ? Math.round(a.score * 10) : null,
    episodes: a.episodes ?? null,
    format: FORMAT[a.type ?? ""] ?? a.type ?? null,
    status: STATUS[a.status ?? ""] ?? null,
    genres: (a.genres ?? []).map((g) => g.name),
    // O MyAnimeList não diz o número do próximo episódio: 0 = só sabemos o dia e a hora
    nextAiringEpisode: next ? { episode: 0, airingAt: next } : null,
    siteUrl: a.url ?? `https://myanimelist.net/anime/${a.mal_id}`,
    popularity: a.members ?? 0,
    isAdult: (a.rating ?? "").startsWith("Rx"),
    startDate: from ? { year: from.year ?? null, month: from.month ?? null, day: from.day ?? null } : null,
  };
}

function detailsFromJikan(a: JAnime): AniDetails {
  const m = fromJikan(a);
  return {
    ...m,
    bannerImage: null,
    description: a.synopsis ?? null,
    season: a.season ? a.season.toUpperCase() : null,
    seasonYear: a.year ?? null,
    duration: a.duration ? Number(a.duration.match(/\d+/)?.[0]) || null : null,
    studios: { nodes: (a.studios ?? []).map((s) => ({ name: s.name })) },
    externalLinks: (a.streaming ?? []).map((s) => ({ site: s.name, url: s.url, type: "STREAMING" })),
    idMal: a.mal_id,
  };
}

const uniq = (list: AniMedia[]) => {
  const seen = new Set<number>();
  return list.filter((m) => !m.isAdult && !seen.has(m.id) && (seen.add(m.id), true));
};

export async function jikanSeason(): Promise<AniMedia[]> {
  const pages = await Promise.all([1, 2].map((p) => jikan<{ data: JAnime[] }>(`/seasons/now?sfw=true&limit=25&page=${p}`).catch(() => ({ data: [] }))));
  return uniq(pages.flatMap((p) => p.data.map(fromJikan))).filter((m) => ["TV", "ONA"].includes(m.format ?? ""));
}

export async function jikanUpcoming(): Promise<AniMedia[]> {
  const r = await jikan<{ data: JAnime[] }>(`/seasons/upcoming?sfw=true&limit=25`);
  return uniq(r.data.map(fromJikan)).sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0));
}

export async function jikanSearch(q: string): Promise<AniMedia[]> {
  const r = await jikan<{ data: JAnime[] }>(`/anime?sfw=true&limit=20&q=${encodeURIComponent(q)}`);
  return uniq(r.data.map(fromJikan));
}

export async function jikanDetails(malId: number): Promise<AniDetails> {
  const r = await jikan<{ data: JAnime }>(`/anime/${malId}/full`);
  return detailsFromJikan(r.data);
}
