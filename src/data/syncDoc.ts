// Formato e regras de junção da sincronização (iguais na app Android).
//
// Cada acontecimento tem uma marca temporal; ganha sempre o mais recente:
//  - seguir uma série (shows[id].addedAt) vs deixar de seguir (removed[id])
//  - marcar um episódio como visto (watched[ep][1]) vs desmarcar (unwatched[ep])
// Assim dois aparelhos podem mudar coisas diferentes ao mesmo tempo sem se apagarem um ao outro.

export const SYNC_FILE = "guia-estreias-sync.json";

export interface SyncDoc {
  v: 2;
  updatedAt: number;
  shows: Record<string, { name: string; addedAt: number }>;
  removed: Record<string, number>;
  watched: Record<string, [showId: number, at: number]>;
  unwatched: Record<string, number>;
  animeLinks: Record<string, number>;
  keys: { tmdb?: string | null; omdb?: string | null };
}

export const emptyDoc = (): SyncDoc => ({ v: 2, updatedAt: 0, shows: {}, removed: {}, watched: {}, unwatched: {}, animeLinks: {}, keys: {} });

/** Lê um documento remoto, tolerando campos em falta. */
export function parseDoc(text: string | null | undefined): SyncDoc {
  if (!text) return emptyDoc();
  try {
    const d = JSON.parse(text);
    return { ...emptyDoc(), ...d, keys: { ...(d.keys ?? {}) } };
  } catch { return emptyDoc(); }
}

/** Junta dois documentos. É comutativa e idempotente: merge(a,b) == merge(b,a). */
export function merge(a: SyncDoc, b: SyncDoc): SyncDoc {
  const out = emptyDoc();
  for (const src of [a, b]) {
    for (const [id, s] of Object.entries(src.shows)) {
      const cur = out.shows[id];
      if (!cur || s.addedAt > cur.addedAt || (s.addedAt === cur.addedAt && s.name > cur.name)) out.shows[id] = { name: s.name, addedAt: s.addedAt };
    }
    for (const [id, at] of Object.entries(src.removed)) out.removed[id] = Math.max(out.removed[id] ?? 0, at);
    for (const [id, w] of Object.entries(src.watched)) {
      const cur = out.watched[id];
      if (!cur || w[1] > cur[1]) out.watched[id] = [w[0], w[1]];
    }
    for (const [id, at] of Object.entries(src.unwatched)) out.unwatched[id] = Math.max(out.unwatched[id] ?? 0, at);
    for (const [id, tv] of Object.entries(src.animeLinks)) out.animeLinks[id] = tv;
  }
  // Fica só o acontecimento mais recente de cada item
  for (const id of Object.keys(out.shows)) {
    const r = out.removed[id];
    if (r != null) { if (r >= out.shows[id].addedAt) delete out.shows[id]; else delete out.removed[id]; }
  }
  for (const id of Object.keys(out.watched)) {
    const u = out.unwatched[id];
    if (u != null) { if (u >= out.watched[id][1]) delete out.watched[id]; else delete out.unwatched[id]; }
  }
  out.keys = { tmdb: a.keys.tmdb || b.keys.tmdb || null, omdb: a.keys.omdb || b.keys.omdb || null };
  out.updatedAt = Math.max(a.updatedAt, b.updatedAt);
  return out;
}

/** Texto canónico (chaves ordenadas) para saber se algo mudou. */
export function canonical(d: SyncDoc): string {
  const sort = (o: Record<string, unknown>) => Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]));
  return JSON.stringify({
    v: 2, shows: sort(d.shows), removed: sort(d.removed), watched: sort(d.watched), unwatched: sort(d.unwatched),
    animeLinks: sort(d.animeLinks), keys: { tmdb: d.keys.tmdb || null, omdb: d.keys.omdb || null },
  });
}
