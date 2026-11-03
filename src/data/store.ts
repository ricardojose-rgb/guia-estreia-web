import { useSyncExternalStore } from "react";
import { del as idbDel, get as idbGet, set as idbSet } from "idb-keyval";
import type { AniMedia, Backup, Episode, MovieEntry, Prefs, Show, TmEpisode, TmShow, WatchedEntry } from "./types";
import { channelOf, findAnimeShow, friendlyError, TvMaze } from "./api";
import { usToday } from "./dates";
import { canonical, emptyDoc, merge, parseDoc, type SyncDoc } from "./syncDoc";
import { findOrCreateGist, GistError, readGist, whoAmI, writeGist } from "./gist";

export interface Toast { id: number; text: string; actionLabel?: string; action?: () => void }

export interface SyncState {
  token: string;
  gistId: string;
  login: string;
  lastSync: number;
  status: "off" | "syncing" | "ok" | "error";
  error: string | null;
}

interface State {
  shows: Record<number, Show>;
  episodes: Record<number, Episode[]>;
  watched: Record<number, WatchedEntry>;
  animeLinks: Record<number, number>; // id AniList -> id TVmaze
  removed: Record<number, number>; // série -> quando deixou de ser seguida
  unwatched: Record<number, number>; // episódio -> quando foi desmarcado
  movies: Record<number, MovieEntry>; // filmes na lista (por ver e vistos)
  moviesRemoved: Record<number, number>;
  moviesWatched: Record<number, number>; // filme -> quando foi visto
  moviesUnwatched: Record<number, number>;
  sync: SyncState;
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
  removed: saved.removed ?? {},
  unwatched: saved.unwatched ?? {},
  movies: saved.movies ?? {},
  moviesRemoved: saved.moviesRemoved ?? {},
  moviesWatched: saved.moviesWatched ?? {},
  moviesUnwatched: saved.moviesUnwatched ?? {},
  sync: { token: "", gistId: "", login: "", lastSync: 0, ...(saved.sync ?? {}), status: saved.sync?.token ? "ok" : "off", error: null },
  prefs: { tmdbToken: "", omdbKey: "", mdblistKey: "", hideSpoilers: false, ...(saved.prefs ?? {}) },
  pending: {},
  refreshing: false,
  ready: false,
  toast: null,
};

const listeners = new Set<() => void>();

function persist() {
  try {
    const { shows, watched, animeLinks, prefs, removed, unwatched, movies, moviesRemoved, moviesWatched, moviesUnwatched } = state;
    const { token, gistId, login, lastSync } = state.sync;
    localStorage.setItem(LS, JSON.stringify({ shows, watched, animeLinks, prefs, removed, unwatched, movies, moviesRemoved, moviesWatched, moviesUnwatched,
      sync: { token, gistId, login, lastSync } }));
  } catch { /* armazenamento cheio ou bloqueado: continua em memória */ }
}

let applyingRemote = false;

function setState(patch: Partial<State> | ((s: State) => Partial<State>), save = true) {
  const p = typeof patch === "function" ? patch(state) : patch;
  state = { ...state, ...p };
  if (save) persist();
  listeners.forEach((l) => l());
  // Qualquer mudança aos dados sincronizados agenda uma sincronização
  if (save && !applyingRemote && ("shows" in p || "watched" in p || "removed" in p || "unwatched" in p || "animeLinks" in p ||
    "movies" in p || "moviesRemoved" in p || "moviesWatched" in p || "moviesUnwatched" in p)) scheduleSync();
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
  if (state.sync.token) syncNow();
  // Sincroniza ao voltar à janela e a cada 5 minutos
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") syncNow(); });
  window.addEventListener("focus", () => syncNow());
  setInterval(() => { if (document.visibilityState === "visible") syncNow(); }, 5 * 60_000);
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

export async function follow(show: TmShow, aniId?: number) {
  const key = `t${show.id}`;
  setPending(key, true);
  try {
    // Se veio de um anime, guarda a ligação para ficar no separador Anime
    setState((s) => ({ shows: { ...s.shows, [show.id]: toShow(show) }, removed: without(s.removed, show.id),
      ...(aniId ? { animeLinks: { ...s.animeLinks, [aniId]: show.id } } : {}) }));
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
    setState((st) => ({ shows: { ...st.shows, [id]: toShow(s) }, removed: without(st.removed, id) }));
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
    setState((s) => ({ shows: { ...s.shows, [show.id]: toShow(show) }, animeLinks: { ...s.animeLinks, [m.id]: show.id }, removed: without(s.removed, show.id) }));
    await refreshShow(show.id).catch(() => {});
    say(`✓ A seguir ${show.name}`);
  } catch (e) { say(friendlyError(e)); }
  finally { setPending(key, false); }
}

export function unfollow(id: number) {
  const name = state.shows[id]?.name ?? "a série";
  // Os episódios vistos ficam guardados: se voltares a seguir a série, o progresso volta
  setState((s) => {
    const shows = { ...s.shows }; delete shows[id];
    const episodes = { ...s.episodes }; delete episodes[id];
    return { shows, episodes, removed: { ...s.removed, [id]: Date.now() } };
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
    const u = { ...s.unwatched };
    const now = Date.now();
    for (const id of ids) {
      if (on) { w[id] = { showId, watchedAt: now }; delete u[id]; }
      else { delete w[id]; u[id] = now; }
    }
    return { watched: w, unwatched: u };
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
    mdblistKey: state.prefs.mdblistKey || null,
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
          mdblistKey: st.prefs.mdblistKey || b.mdblistKey || "",
        },
      };
    });
  } finally { setState({ refreshing: false }, false); }
  return ok;
}

const without = <T,>(o: Record<number, T>, id: number) => { const c = { ...o }; delete c[id]; return c; };

// ---------- sincronização (GitHub Gist) ----------

function toDoc(s: State): SyncDoc {
  const d = emptyDoc();
  d.updatedAt = Date.now();
  for (const sh of Object.values(s.shows)) d.shows[sh.id] = { name: sh.name, addedAt: sh.addedAt };
  for (const [id, at] of Object.entries(s.removed)) d.removed[id] = at;
  for (const [id, w] of Object.entries(s.watched)) d.watched[id] = [w.showId, w.watchedAt];
  for (const [id, at] of Object.entries(s.unwatched)) d.unwatched[id] = at;
  for (const [id, tv] of Object.entries(s.animeLinks)) d.animeLinks[id] = tv;
  for (const m of Object.values(s.movies)) d.movies![m.id] = { title: m.title, poster: m.poster, year: m.year, addedAt: m.addedAt };
  for (const [id, at] of Object.entries(s.moviesRemoved)) d.moviesRemoved![id] = at;
  for (const [id, at] of Object.entries(s.moviesWatched)) d.moviesWatched![id] = at;
  for (const [id, at] of Object.entries(s.moviesUnwatched)) d.moviesUnwatched![id] = at;
  d.keys = { tmdb: s.prefs.tmdbToken || null, omdb: s.prefs.omdbKey || null, mdblist: s.prefs.mdblistKey || null };
  return d;
}

/** Aplica o documento junto ao estado local; devolve as séries novas que é preciso carregar. */
function applyDoc(d: SyncDoc): number[] {
  const toLoad: number[] = [];
  applyingRemote = true;
  try {
    setState((s) => {
      const shows: Record<number, Show> = {};
      for (const [id, info] of Object.entries(d.shows)) {
        const n = Number(id);
        const local = s.shows[n];
        if (local) shows[n] = { ...local, addedAt: info.addedAt };
        else { shows[n] = { id: n, name: info.name, addedAt: info.addedAt }; toLoad.push(n); }
      }
      const episodes = { ...s.episodes };
      for (const id of Object.keys(s.shows)) if (!shows[Number(id)]) delete episodes[Number(id)];
      const watched: Record<number, WatchedEntry> = {};
      for (const [id, [showId, at]] of Object.entries(d.watched)) watched[Number(id)] = { showId, watchedAt: at };
      return {
        shows, episodes, watched,
        removed: Object.fromEntries(Object.entries(d.removed).map(([k, v]) => [Number(k), v])),
        unwatched: Object.fromEntries(Object.entries(d.unwatched).map(([k, v]) => [Number(k), v])),
        animeLinks: Object.fromEntries(Object.entries(d.animeLinks).map(([k, v]) => [Number(k), v])),
        movies: Object.fromEntries(Object.entries(d.movies ?? {}).map(([k, v]) => [Number(k), { id: Number(k), ...v }])),
        moviesRemoved: numKeys(d.moviesRemoved), moviesWatched: numKeys(d.moviesWatched), moviesUnwatched: numKeys(d.moviesUnwatched),
        prefs: { ...s.prefs, tmdbToken: s.prefs.tmdbToken || d.keys.tmdb || "", mdblistKey: s.prefs.mdblistKey || d.keys.mdblist || "", omdbKey: s.prefs.omdbKey || d.keys.omdb || "" },
      };
    });
  } finally { applyingRemote = false; }
  return toLoad;
}

let syncTimer: ReturnType<typeof setTimeout> | null = null;
let syncing: Promise<void> | null = null;
let again = false;

function scheduleSync() {
  if (!state.sync.token) return;
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => { syncTimer = null; syncNow(); }, 2500);
}

function setSync(p: Partial<SyncState>) {
  setState((s) => ({ sync: { ...s.sync, ...p } }), "token" in p || "gistId" in p || "lastSync" in p || "login" in p);
}

/** Junta o que está no GitHub com o que está aqui e grava o resultado nos dois lados. */
export function syncNow(): Promise<void> {
  if (!state.sync.token || !state.ready) return Promise.resolve();
  if (syncing) { again = true; return syncing; }
  syncing = (async () => {
    const { token } = state.sync;
    setSync({ status: "syncing", error: null });
    try {
      let gistId = state.sync.gistId;
      if (!gistId) { gistId = await findOrCreateGist(token, canonical(toDoc(state))); setSync({ gistId }); }
      const remoteText = await readGist(token, gistId);
      const remote = parseDoc(remoteText);
      const merged = merge(toDoc(state), remote);
      const toLoad = applyDoc(merged);
      if (canonical(merged) !== canonical(remote)) await writeGist(token, gistId, JSON.stringify({ ...merged, updatedAt: Date.now() }));
      setSync({ status: "ok", lastSync: Date.now(), error: null });
      // Séries que vieram do outro aparelho: carregar dados e episódios
      for (const id of toLoad) {
        try {
          const show = await TvMaze.show(id);
          applyingRemote = true;
          try { setState((s) => (s.shows[id] ? { shows: { ...s.shows, [id]: toShow(show, s.shows[id].addedAt) } } : {}), true); }
          finally { applyingRemote = false; }
          await refreshShow(id);
        } catch { /* tenta outra vez na próxima atualização */ }
      }
    } catch (e) {
      const msg = e instanceof GistError ? e.message : "Sem ligação ao GitHub. Volta a tentar quando tiveres internet.";
      setSync({ status: "error", error: msg });
      if (e instanceof GistError && e.status === 404) setSync({ gistId: "" });
    } finally {
      syncing = null;
      if (again) { again = false; scheduleSync(); }
    }
  })();
  return syncing;
}

/** Liga a sincronização com uma chave do GitHub. */
export async function connectSync(token: string): Promise<string> {
  const t = token.trim();
  const login = await whoAmI(t);
  setSync({ token: t, login, gistId: "", status: "syncing", error: null });
  await syncNow();
  if (state.sync.status === "error") throw new Error(state.sync.error ?? "Erro");
  return login;
}

export function disconnectSync() {
  setSync({ token: "", gistId: "", login: "", lastSync: 0, status: "off", error: null });
}

const numKeys = (o?: Record<string, number>) => Object.fromEntries(Object.entries(o ?? {}).map(([k, v]) => [Number(k), v]));

// ---------- filmes ----------

export function toMovieEntry(m: { id: number; title: string; poster_path?: string | null; poster?: string | null; release_date?: string | null; year?: string | null }): MovieEntry {
  return { id: m.id, title: m.title, poster: m.poster ?? m.poster_path ?? null, year: m.year ?? m.release_date?.slice(0, 4) ?? null, addedAt: Date.now() };
}

/** Junta à lista "Por ver". */
export function addMovie(m: MovieEntry) {
  setState((s) => ({ movies: { ...s.movies, [m.id]: { ...m, addedAt: Date.now() } }, moviesRemoved: without(s.moviesRemoved, m.id) }));
  say(`✓ ${m.title} adicionado aos teus filmes`);
}

/** Tira o filme da lista (por ver e vistos). */
export function removeMovie(id: number) {
  const name = state.movies[id]?.title ?? "O filme";
  setState((s) => {
    const movies = { ...s.movies }; delete movies[id];
    return { movies, moviesRemoved: { ...s.moviesRemoved, [id]: Date.now() } };
  });
  say(`${name} saiu dos teus filmes`);
}

/** Marca como visto (e junta à lista se ainda não estiver) ou desmarca. */
export function setMovieWatched(m: MovieEntry, on: boolean) {
  const now = Date.now();
  setState((s) => {
    const movies = s.movies[m.id] ? s.movies : { ...s.movies, [m.id]: { ...m, addedAt: now } };
    if (on) return { movies, moviesRemoved: without(s.moviesRemoved, m.id), moviesWatched: { ...s.moviesWatched, [m.id]: now }, moviesUnwatched: without(s.moviesUnwatched, m.id) };
    return { moviesWatched: without(s.moviesWatched, m.id), moviesUnwatched: { ...s.moviesUnwatched, [m.id]: now } };
  });
  if (on) say(`✓ ${m.title} marcado como visto`);
}
