// Segunda alternativa para o anime: Kitsu (usa-se se o AniList e o MyAnimeList/Jikan falharem).
// Ids: -(10 000 000 + id do Kitsu), para não se confundirem com os do AniList (positivos) nem do MyAnimeList (negativos pequenos).
import type { AniDetails, AniMedia } from "./types";

export const KITSU_OFFSET = 10_000_000;
const BASE = "https://kitsu.io/api/edge";

async function kitsu<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Accept: "application/vnd.api+json" },
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error(`Kitsu ${res.status}`);
  return res.json() as Promise<T>;
}

interface KAnime {
  id: string;
  attributes: {
    canonicalTitle?: string; titles?: { en?: string; en_us?: string; en_jp?: string; ja_jp?: string };
    posterImage?: { small?: string; medium?: string; large?: string; original?: string } | null;
    coverImage?: { large?: string; original?: string } | null;
    averageRating?: string | null; episodeCount?: number | null; episodeLength?: number | null;
    subtype?: string | null; status?: string | null; startDate?: string | null; synopsis?: string | null;
    userCount?: number | null; nsfw?: boolean; slug?: string;
  };
}

const FORMAT: Record<string, string> = { TV: "TV", ONA: "ONA", OVA: "OVA", movie: "MOVIE", special: "SPECIAL", music: "SPECIAL" };
const STATUS: Record<string, string> = { current: "RELEASING", finished: "FINISHED", upcoming: "NOT_YET_RELEASED", unreleased: "NOT_YET_RELEASED", tba: "NOT_YET_RELEASED" };

function fromKitsu(k: KAnime): AniMedia {
  const a = k.attributes;
  const [y, m, d] = (a.startDate ?? "").split("-").map(Number);
  const poster = a.posterImage;
  return {
    id: -(KITSU_OFFSET + Number(k.id)),
    title: { english: a.titles?.en ?? a.titles?.en_us ?? null, romaji: a.titles?.en_jp ?? a.canonicalTitle ?? "" },
    coverImage: { medium: poster?.small ?? poster?.medium ?? null, large: poster?.medium ?? poster?.large ?? null, extraLarge: poster?.original ?? poster?.large ?? null },
    averageScore: a.averageRating ? Math.round(Number(a.averageRating)) : null,
    episodes: a.episodeCount ?? null,
    format: FORMAT[a.subtype ?? ""] ?? a.subtype ?? null,
    status: STATUS[a.status ?? ""] ?? null,
    genres: [],
    nextAiringEpisode: null,
    siteUrl: `https://kitsu.app/anime/${a.slug ?? k.id}`,
    popularity: a.userCount ?? 0,
    isAdult: !!a.nsfw,
    startDate: y ? { year: y, month: m || null, day: d || null } : null,
  };
}

const list = (r: { data: KAnime[] }) => r.data.map(fromKitsu).filter((m) => !m.isAdult);

function seasonNow(): { season: string; year: number } {
  const now = new Date();
  const mth = now.getUTCMonth() + 1;
  const season = mth <= 3 ? "winter" : mth <= 6 ? "spring" : mth <= 9 ? "summer" : "fall";
  return { season, year: now.getUTCFullYear() };
}

export async function kitsuSeason(): Promise<AniMedia[]> {
  const { season, year } = seasonNow();
  const q = `/anime?filter[season]=${season}&filter[seasonYear]=${year}&sort=-userCount&page[limit]=20`;
  const pages = await Promise.all([0, 20].map((o) => kitsu<{ data: KAnime[] }>(`${q}&page[offset]=${o}`).catch(() => ({ data: [] }))));
  const seen = new Set<number>();
  const out = pages.flatMap(list).filter((m) => ["TV", "ONA"].includes(m.format ?? "") && !seen.has(m.id) && (seen.add(m.id), true));
  if (!out.length) throw new Error("Kitsu sem resultados");
  return out;
}

export async function kitsuUpcoming(): Promise<AniMedia[]> {
  return list(await kitsu<{ data: KAnime[] }>(`/anime?filter[status]=upcoming&sort=-userCount&page[limit]=20`));
}

export async function kitsuSearch(q: string): Promise<AniMedia[]> {
  return list(await kitsu<{ data: KAnime[] }>(`/anime?filter[text]=${encodeURIComponent(q)}&page[limit]=20`));
}

export async function kitsuDetails(kitsuId: number): Promise<AniDetails> {
  const r = await kitsu<{ data: KAnime }>(`/anime/${kitsuId}`);
  const m = fromKitsu(r.data);
  const a = r.data.attributes;
  return { ...m, bannerImage: a.coverImage?.large ?? null, description: a.synopsis ?? null, season: null, seasonYear: m.startDate?.year ?? null,
    duration: a.episodeLength ?? null, studios: { nodes: [] }, externalLinks: [], idMal: null };
}
