// Tipos partilhados. Os nomes seguem os da app Android para a cópia de segurança ser compatível.

export interface Show {
  id: number; // id do TVmaze
  name: string;
  imageUrl?: string | null;
  imageLarge?: string | null;
  channel?: string | null;
  status?: string | null;
  summary?: string | null;
  genres?: string[];
  premiered?: string | null;
  imdb?: string | null;
  rating?: number | null;
  addedAt: number;
}

export interface Episode {
  id: number;
  showId: number;
  season: number;
  number: number | null;
  name: string | null;
  airdate: string | null; // yyyy-MM-dd, data dos EUA
  airstamp: string | null; // ISO com fuso
  airtime: string | null; // HH:mm (vazio nos lançamentos de streaming)
  runtime: number | null;
}

export interface WatchedEntry {
  showId: number;
  watchedAt: number;
}

export interface Prefs {
  tmdbToken: string;
  omdbKey: string;
  hideSpoilers: boolean;
}

// ---- TVmaze ----
export interface TmImage { medium?: string | null; original?: string | null }
export interface TmChannel { id?: number; name?: string | null; country?: { code?: string | null } | null }
export interface TmShow {
  id: number;
  name: string;
  type?: string | null;
  language?: string | null;
  genres?: string[];
  status?: string | null;
  premiered?: string | null;
  summary?: string | null;
  image?: TmImage | null;
  network?: TmChannel | null;
  webChannel?: TmChannel | null;
  externals?: { imdb?: string | null; thetvdb?: number | null } | null;
  rating?: { average?: number | null } | null;
}
export interface TmEpisode {
  id: number;
  name?: string | null;
  season: number;
  number?: number | null;
  type?: string | null;
  airdate?: string | null;
  airtime?: string | null;
  airstamp?: string | null;
  runtime?: number | null;
  show?: TmShow;
  _embedded?: { show?: TmShow };
}

/** Uma estreia (série nova ou regresso de temporada) no calendário dos EUA. */
export interface Premiere {
  showId: number;
  title: string;
  date: string;
  season: number;
  isNew: boolean;
  channel: string | null;
  imageUrl: string | null;
}

// ---- AniList ----
export interface AniMedia {
  id: number;
  title: { romaji?: string | null; english?: string | null };
  coverImage?: { medium?: string | null; large?: string | null; extraLarge?: string | null } | null;
  averageScore?: number | null;
  episodes?: number | null;
  format?: string | null;
  status?: string | null;
  genres?: string[];
  nextAiringEpisode?: { episode: number; airingAt: number } | null;
  siteUrl?: string | null;
  popularity?: number;
  isAdult?: boolean;
  startDate?: { year?: number | null; month?: number | null; day?: number | null } | null;
}
export interface AnimeEpisode { episode: number; airingAt: number; media: AniMedia }

// ---- TMDB ----
export interface TmdbMovie {
  id: number;
  title: string;
  original_title?: string;
  release_date?: string;
  poster_path?: string | null;
  overview?: string;
  popularity?: number;
}
export interface Anticipated {
  tmdbId: number;
  title: string;
  originalTitle: string;
  posterUrl: string | null;
  date: string | null;
  season: number | null;
  isNew: boolean;
  network: string | null;
  rank: number;
}

export interface Scores {
  imdb?: string | null;
  imdbVotes?: string | null;
  imdbId?: string | null;
  rottenTomatoes?: string | null;
  tvmaze?: number | null;
}

/** Formato da cópia de segurança (igual ao da app Android). */
export interface Backup {
  version: number;
  exportedAt: number;
  shows: { id: number; name: string }[];
  watched: { episodeId: number; showId: number; watchedAt: number }[];
  tmdbToken?: string | null;
  omdbKey?: string | null;
}
