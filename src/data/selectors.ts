import type { Episode, Show, WatchedEntry } from "./types";

// Funções puras para derivar listas a partir do estado (usar com useMemo nos ecrãs).

export interface AgendaEpisode extends Episode {
  show: Show;
  watched: boolean;
}

export function agendaEpisodes(
  shows: Record<number, Show>, episodes: Record<number, Episode[]>, watched: Record<number, WatchedEntry>,
  from: string, to: string,
): AgendaEpisode[] {
  const out: AgendaEpisode[] = [];
  for (const [sid, eps] of Object.entries(episodes)) {
    const show = shows[Number(sid)];
    if (!show) continue;
    for (const e of eps) {
      if (e.airdate && e.airdate >= from && e.airdate <= to) out.push({ ...e, show, watched: !!watched[e.id] });
    }
  }
  return out.sort((a, b) => (a.airdate ?? "").localeCompare(b.airdate ?? "") || a.show.name.localeCompare(b.show.name) || a.season - b.season || (a.number ?? 0) - (b.number ?? 0));
}

export interface UpNext {
  episode: Episode;
  show: Show;
  remaining: number;
  started: boolean;
  lastWatched: number;
}

/** O próximo episódio por ver de cada série, com as séries vistas mais recentemente primeiro. */
export function upNext(
  shows: Record<number, Show>, episodes: Record<number, Episode[]>, watched: Record<number, WatchedEntry>, today: string,
): UpNext[] {
  const out: UpNext[] = [];
  for (const show of Object.values(shows)) {
    const eps = (episodes[show.id] ?? [])
      .filter((e) => e.season > 0 && e.airdate && e.airdate <= today)
      .sort((a, b) => a.season - b.season || (a.number ?? 0) - (b.number ?? 0));
    const unwatched = eps.filter((e) => !watched[e.id]);
    if (!unwatched.length) continue;
    const mine = Object.values(watched).filter((w) => w.showId === show.id);
    out.push({
      episode: unwatched[0], show, remaining: unwatched.length,
      started: mine.length > 0, lastWatched: Math.max(0, ...mine.map((w) => w.watchedAt)),
    });
  }
  return out.sort((a, b) => b.lastWatched - a.lastWatched || (b.episode.airdate ?? "").localeCompare(a.episode.airdate ?? ""));
}

export interface Progress {
  show: Show;
  aired: number;
  watched: number;
  next: string | null;
}

export function progress(
  shows: Record<number, Show>, episodes: Record<number, Episode[]>, watched: Record<number, WatchedEntry>, today: string,
): Progress[] {
  return Object.values(shows).map((show) => {
    const eps = episodes[show.id] ?? [];
    const airedEps = eps.filter((e) => e.season > 0 && e.airdate && e.airdate <= today);
    const next = eps.filter((e) => e.airdate && e.airdate > today).map((e) => e.airdate!).sort()[0] ?? null;
    return { show, aired: airedEps.length, watched: airedEps.filter((e) => watched[e.id]).length, next };
  }).sort((a, b) => (a.next ? 0 : 1) - (b.next ? 0 : 1) || (a.next ?? "").localeCompare(b.next ?? "") || a.show.name.localeCompare(b.show.name));
}

export function stats(episodes: Record<number, Episode[]>, watched: Record<number, WatchedEntry>) {
  let minutes = 0, count = 0;
  for (const eps of Object.values(episodes)) for (const e of eps) if (watched[e.id]) { count++; minutes += e.runtime ?? 0; }
  return { episodes: count, hours: Math.round(minutes / 60) };
}
