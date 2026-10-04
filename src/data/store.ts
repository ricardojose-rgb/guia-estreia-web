import { useSyncExternalStore } from "react";
import { del as idbDel, get as idbGet, set as idbSet } from "idb-keyval";
import type { AniMedia, Backup, Episode, Prefs, Show, TmEpisode, TmShow, WatchedEntry } from "./types";
import { channelOf, findAnimeShow, friendlyError, TvMaze } from "./api";
import { usToday } from "./dates";

export interface Toast { id: number; text: string; actionLabel?: string; action?: () => void }

interface State {
  shows: Record<number, Show>;
  episodes: Record<number, Episode[]>;
  watched: Record<number, WatchedEntry>;
  animeLinks: Record<number, number>; // id AniList -> id TVmaze
  prefs: Prefs;
  pending: Record<string, true>;
  refreshing: boolean;
  ready: boolean;
  toast: Toast | null;
}

const LS = "guia-estreias:v1";

function loadLocal(): Partial<State> {
  try {
    const raw = localStorage.getItem(LS);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

const saved = loadLocal();
let state: State = {
  shows: saved.shows ?? {},
  episodes: {},
  watched: saved.watched ?? {},
  animeLinks: saved.animeLinks ?? {},
  prefs: { tmdbToken: "", omdbKey: "", hideSpoilers: false, ...(saved.prefs ?? {}) },
  pending: {},
  refreshing: false,
  ready: false,
  toast: null,
};

const listeners = new Set<() => void>();

function persist() {
  try {
    const { shows, watched, animeLinks, prefs } = state;
    localStorage.setItem(LS, JSON.stringify({ shows, watched, animeLinks, prefs }));
  } catch { /* armazenamento cheio ou bloqueado: continua em memória */ }
}

function setState(patch: Partial<State> | ((s: State) => Partial<State>), save = true) {
  const p = typeof patch === "function" ? patch(state) : patch;
  state = { ...state, ...p };
  if (save) persist();
  listeners.forEach((l) => l());
}

export function useStore<T>(sel: (s: State) => T): T {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
    () => sel(state),
  );
}
export const getState = () => state;

let toastSeq = 0;
export function say(text: string, actionLabel?: string, action?: () => void) {
  setState({ toast: { id: ++toastSeq, text, actionLabel, action } }, false);
}
export const dismissToast = () => setState({ toast: null }, false);

// ---------- arranque ----------
(async () => {
  const ids = Object.keys(state.shows).map(Number);
  const loaded: Record<number, Episode[]> = {};
  await Promise.all(ids.map(async (id) => {
    const eps = await idbGet<Episode[]>(`eps:${id}`).catch(() => undefined);
    if (eps) loaded[id] = eps;
  }));
  setState({ episodes: loaded, ready: true }, false);
  // Atualiza em segundo plano se a última atualização tiver mais de 6 horas
  const last = Number(localStorage.getItem("guia:lastRefresh") || 0);
  if (ids.length && Date.now() - last > 6 * 3600_000) refreshAll(true);
})();

// ---------- conversões ----------
export function toShow(s: TmShow, addedAt = Date.now()): Show {
  return {
    id: s.id, name: s.name,
    imageUrl: s.image?.medium ?? null, imageLarge: s.image?.original ?? null,
    channel: channelOf(s), status: s.status ?? null, summary: s.summary ?? null,
    genres: s.genres ?? [], premiered: s.premiered ?? null,
    imdb: s.externals?.imdb ?? null, rating: s.rating?.average ?? null, addedAt,
  };
}

export function toEpisodes(showId: number, eps: TmEpisode[]): Episode[] {
  return eps.filter((e) => e.type !== "insignificant_special").map((e) => ({
    id: e.id, showId, season: e.season, number: e.number ?? null, name: e.name ?? null,
    airdate: e.airdate || null, airstamp: e.airstamp || null, airtime: e.airtime || null, runtime: e.runtime ?? null,
  }));
}

// ---------- ações ----------
function setPending(key: string, on: boolean) {
  setState((s) => {
    const p = { ...s.pending };
    if (on) p[key] = true; else delete p[key];
    return { pending: p };
  }, false);
}

async function refreshShow(id: number) {
  const eps = toEpisodes(id, await TvMaze.episodes(id));
  await idbSet(`eps:${id}`, eps).catch(() => {});
  setState((s) => ({ episodes: { ...s.episodes, [id]: eps } }), false);
}

export async function follow(show: TmShow) {
  const key = `t${show.id}`;
  setPending(key, true);
  try {
    setState((s) => ({ shows: { ...s.shows, [show.id]: toShow(show) } }));
    await refreshShow(show.id).catch(() => {});
    say(`✓ A seguir ${show.name}`);
  } finally { setPending(key, false); }
}

export async function followById(id: number, name: string) {
  const key = `t${id}`;
  if (state.pending[key]) return;
  setPending(key, true);
  try {
    const s = await TvMaze.show(id);
    setState((st) => ({ shows: { ...st.shows, [id]: toShow(s) } }));
    await refreshShow(id).catch(() => {});
    say(`✓ A seguir ${name}`);
  } catch (e) { say(friendlyError(e)); }
  finally { setPending(key, false); }
}

export async function followAnime(m: AniMedia, title: string) {
  const key = `a${m.id}`;
  if (state.pending[key]) return;
  setPending(key, true);
  try {
    const show = await findAnimeShow(m);
    if (!show) { say(`Não encontrei "${title}" no guia de episódios. Experimenta procurá-lo em Séries.`); return; }
    setState((s) => ({ shows: { ...s.shows, [show.id]: toShow(show) }, animeLinks: { ...s.animeLinks, [m.id]: show.id } }));
    await refreshShow(show.id).catch(() => {});
    say(`✓ A seguir ${show.name}`);
  } catch (e) { say(friendlyError(e)); }
  finally { setPending(key, false); }
}

export function unfollow(id: number) {
  const name = state.shows[id]?.name ?? "a série";
  setState((s) => {
    const shows = { ...s.shows }; delete shows[id];
    const episodes = { ...s.episodes }; delete episodes[id];
    const watched = Object.fromEntries(Object.entries(s.watched).filter(([, w]) => w.showId !== id));
    return { shows, episodes, watched };
  });
  idbDel(`eps:${id}`).catch(() => {});
  say(`Deixaste de seguir ${name}`);
}

export async function refreshAll(silent = false) {
  if (state.refreshing) return;
  if (!silent) setState({ refreshing: true }, false);
  let failed = 0;
  for (const s of Object.values(state.shows)) {
    try {
      const fresh = await TvMaze.show(s.id);
      setState((st) => ({ shows: { ...st.shows, [s.id]: toShow(fresh, s.addedAt) } }));
      await refreshShow(s.id);
    } catch { failed++; }
  }
  localStorage.setItem("guia:lastRefresh", String(Date.now()));
  setState({ refreshing: false }, false);
  if (!silent && failed) say("Não foi possível atualizar todas as séries. Tenta outra vez mais tarde.");
}

export function setWatched(showId: number, ids: number[], on: boolean) {
  if (!ids.length) return;
  setState((s) => {
    const w = { ...s.watched };
    for (const id of ids) { if (on) w[id] = { showId, watchedAt: Date.now() }; else delete w[id]; }
    return { watched: w };
  });
}

const aired = (e: Episode, today: string) => e.season > 0 && !!e.airdate && e.airdate <= today;

/** Marca um episódio; se houver anteriores por ver, oferece marcá-los também. */
export function markWatched(ep: Episode) {
  setWatched(ep.showId, [ep.id], true);
  if (ep.season < 1) return;
  const today = usToday();
  const earlier = (state.episodes[ep.showId] ?? []).filter((e) =>
    e.id !== ep.id && aired(e, today) && !state.watched[e.id] &&
    (e.season < ep.season || (e.season === ep.season && (e.number ?? 0) < (ep.number ?? 0)))).map((e) => e.id);
  if (earlier.length) {
    say(earlier.length === 1 ? "Há 1 episódio anterior por ver." : `Há ${earlier.length} episódios anteriores por ver.`,
      "Marcar vistos", () => setWatched(ep.showId, earlier, true));
  }
}

export function catchUp(showId: number) {
  const today = usToday();
  const ids = (state.episodes[showId] ?? []).filter((e) => aired(e, today)).map((e) => e.id);
  setWatched(showId, ids, true);
  say(`${state.shows[showId]?.name ?? "Série"}: marcados como vistos todos os episódios já estreados`);
}

export function setPrefs(p: Partial<Prefs>) {
  setState((s) => ({ prefs: { ...s.prefs, ...p } }));
}

// ---------- cópia de segurança (compatível com a app Android) ----------
export function exportBackup(): string {
  const b: Backup = {
    version: 1, exportedAt: Date.now(),
    shows: Object.values(state.shows).map((s) => ({ id: s.id, name: s.name })),
    watched: Object.entries(state.watched).map(([id, w]) => ({ episodeId: Number(id), showId: w.showId, watchedAt: w.watchedAt })),
    tmdbToken: state.prefs.tmdbToken || null,
    omdbKey: state.prefs.omdbKey || null,
  };
  return JSON.stringify(b, null, 2);
}

export async function importBackup(text: string): Promise<number> {
  let b: Backup;
  try { b = JSON.parse(text); } catch { throw new Error("formato"); }
  if (!Array.isArray(b.shows) || !Array.isArray(b.watched)) throw new Error("formato");
  setState({ refreshing: true }, false);
  let ok = 0;
  try {
    for (const s of b.shows) {
      if (state.shows[s.id]) { ok++; continue; }
      try {
        const show = await TvMaze.show(s.id);
        setState((st) => ({ shows: { ...st.shows, [s.id]: toShow(show) } }));
        await refreshShow(s.id).catch(() => {});
        ok++;
      } catch { /* série que já não existe no TVmaze */ }
    }
    setState((st) => {
      const w = { ...st.watched };
      for (const x of b.watched) w[x.episodeId] = { showId: x.showId, watchedAt: x.watchedAt };
      return {
        watched: w,
        prefs: {
          ...st.prefs,
          tmdbToken: st.prefs.tmdbToken || b.tmdbToken || "",
          omdbKey: st.prefs.omdbKey || b.omdbKey || "",
        },
      };
    });
  } finally { setState({ refreshing: false }, false); }
  return ok;
}
