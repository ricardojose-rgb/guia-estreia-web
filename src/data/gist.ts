import { SYNC_FILE } from "./syncDoc";

// Acesso ao GitHub Gist (um ficheiro secreto na conta do utilizador).

export class GistError extends Error {
  constructor(public status: number, msg: string) { super(msg); }
}

async function gh<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
    cache: "no-store",
  });
  if (res.status === 401) throw new GistError(401, "A chave do GitHub não é válida ou expirou. Cria uma nova nas Definições.");
  if (res.status === 403 || res.status === 404) throw new GistError(res.status, "A chave do GitHub não tem permissão para gists. Cria-a com a opção \"gist\" marcada.");
  if (!res.ok) throw new GistError(res.status, `O GitHub respondeu com um erro (${res.status}). Tenta outra vez daqui a pouco.`);
  return res.json();
}

interface GistFile { content?: string; truncated?: boolean; raw_url?: string }
interface Gist { id: string; files: Record<string, GistFile>; updated_at: string }

export async function whoAmI(token: string): Promise<string> {
  const u = await gh<{ login: string }>(token, "/user");
  return u.login;
}

/** Procura o gist de sincronização; cria-o se não existir. */
export async function findOrCreateGist(token: string, initial: string): Promise<string> {
  for (let page = 1; page <= 5; page++) {
    const list = await gh<Gist[]>(token, `/gists?per_page=100&page=${page}`);
    const hit = list.find((g) => g.files && g.files[SYNC_FILE]);
    if (hit) return hit.id;
    if (list.length < 100) break;
  }
  const created = await gh<Gist>(token, "/gists", {
    method: "POST",
    body: JSON.stringify({
      description: "Guia de Estreias — sincronização (não apagar)",
      public: false,
      files: { [SYNC_FILE]: { content: initial } },
    }),
  });
  return created.id;
}

export async function readGist(token: string, id: string): Promise<string | null> {
  const g = await gh<Gist>(token, `/gists/${id}`);
  const f = g.files[SYNC_FILE];
  if (!f) return null;
  if (f.truncated && f.raw_url) {
    const raw = await fetch(f.raw_url, { cache: "no-store" });
    return raw.ok ? raw.text() : null;
  }
  return f.content ?? null;
}

export async function writeGist(token: string, id: string, content: string): Promise<void> {
  await gh<Gist>(token, `/gists/${id}`, { method: "PATCH", body: JSON.stringify({ files: { [SYNC_FILE]: { content } } }) });
}

/** Link para criar a chave já com a permissão certa. */
export const TOKEN_URL = "https://github.com/settings/tokens/new?scopes=gist&description=Guia%20de%20Estreias";
