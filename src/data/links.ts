// Ligações diretas para a página certa no Rotten Tomatoes e para "onde ver" em Portugal.
// O Rotten Tomatoes não tem API: o identificador da página (ex.: "m/dune_part_two", "tv/the_bear")
// vem do Wikidata, procurado pelo id do IMDb, do TMDB ou do TVmaze. Sem resultado, cai na pesquisa.
import { get as idbGet, set as idbSet } from "idb-keyval";

export type Ids = { imdb?: string | null; tmdbMovie?: number | null; tmdbTv?: number | null; tvmaze?: number | null };
type Found = { rt: string | null; tmdbTv: number | null };

const WEEK = 7 * 86400_000;
const memo = new Map<string, Promise<Found>>();

function keyOf(ids: Ids): string | null {
  if (ids.imdb) return `imdb:${ids.imdb}`;
  if (ids.tmdbMovie) return `tmdbm:${ids.tmdbMovie}`;
  if (ids.tmdbTv) return `tmdbt:${ids.tmdbTv}`;
  if (ids.tvmaze) return `tvmaze:${ids.tvmaze}`;
  return null;
}

async function wikidata(ids: Ids): Promise<Found> {
  const conds: string[] = [];
  if (ids.imdb) conds.push(`{ ?i wdt:P345 "${ids.imdb}" }`);
  if (ids.tmdbMovie) conds.push(`{ ?i wdt:P4947 "${ids.tmdbMovie}" }`);
  if (ids.tmdbTv) conds.push(`{ ?i wdt:P4983 "${ids.tmdbTv}" }`);
  if (ids.tvmaze) conds.push(`{ ?i wdt:P8600 "${ids.tvmaze}" }`);
  if (!conds.length) return { rt: null, tmdbTv: null };
  const q = `SELECT ?rt ?tv WHERE { ${conds.join(" UNION ")} OPTIONAL { ?i wdt:P1258 ?rt } OPTIONAL { ?i wdt:P4983 ?tv } } LIMIT 20`;
  const res = await fetch(`https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(q)}`, {
    headers: { accept: "application/sparql-results+json" },
  });
  if (!res.ok) throw new Error(`wikidata ${res.status}`);
  const j = await res.json() as { results: { bindings: { rt?: { value: string }; tv?: { value: string } }[] } };
  const rts = j.results.bindings.map((b) => b.rt?.value).filter((v): v is string => !!v)
    // a página principal ("tv/the_bear") e não a de uma temporada ("tv/the_bear/s01")
    .sort((a, b) => a.length - b.length);
  const tv = j.results.bindings.map((b) => Number(b.tv?.value)).find((n) => n > 0) ?? null;
  return { rt: rts[0] ?? null, tmdbTv: tv };
}

function lookup(ids: Ids): Promise<Found> {
  const k = keyOf(ids);
  if (!k) return Promise.resolve({ rt: null, tmdbTv: null });
  let p = memo.get(k);
  if (!p) {
    p = (async () => {
      const hit = await idbGet<{ at: number; value: Found }>(`links:${k}`).catch(() => undefined);
      if (hit && Date.now() - hit.at < WEEK) return hit.value;
      const value = await wikidata(ids);
      idbSet(`links:${k}`, { at: Date.now(), value }).catch(() => {});
      return value;
    })().catch(() => { memo.delete(k); return { rt: null, tmdbTv: null }; });
    memo.set(k, p);
  }
  return p;
}

export const rtSearch = (title: string) => `https://www.rottentomatoes.com/search?search=${encodeURIComponent(title)}`;

/** Página do filme ou série no Rotten Tomatoes (ou a pesquisa, se não a encontrar). */
export async function rtUrl(ids: Ids, title: string): Promise<string> {
  const f = await lookup(ids);
  return f.rt ? `https://www.rottentomatoes.com/${f.rt.replace(/^\/+/, "")}` : rtSearch(title);
}

/** Página "onde ver" em Portugal (dados do JustWatch, mostrados pelo TMDB). */
export async function watchUrl(ids: Ids, title: string, kind: "movie" | "tv", tmdbToken?: string): Promise<string> {
  if (kind === "movie" && ids.tmdbMovie) return `https://www.themoviedb.org/movie/${ids.tmdbMovie}/watch?locale=PT`;
  let tv = ids.tmdbTv ?? (await lookup(ids)).tmdbTv;
  if (!tv && tmdbToken && ids.imdb) {
    tv = await fetch(`https://api.themoviedb.org/3/find/${ids.imdb}?external_source=imdb_id`, {
      headers: { Authorization: `Bearer ${tmdbToken}`, accept: "application/json" },
    }).then((r) => r.ok ? r.json() : null).then((j) => j?.tv_results?.[0]?.id ?? null).catch(() => null);
  }
  if (tv) return `https://www.themoviedb.org/tv/${tv}/watch?locale=PT`;
  return `https://www.google.com/search?q=${encodeURIComponent(`${title} site:justwatch.com/pt`)}`;
}

/**
 * Abre um separador já no clique (para o navegador não o bloquear) e só depois
 * aponta-o para a ligação certa, que pode demorar um instante a descobrir.
 */
export function openResolved(e: { preventDefault(): void }, resolve: () => Promise<string>) {
  e.preventDefault();
  const w = window.open("about:blank", "_blank");
  if (w) w.opener = null;
  resolve().then((url) => { if (w) w.location.href = url; else window.open(url, "_blank"); });
}
