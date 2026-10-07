import { useEffect, useMemo, useState } from "react";
import { openResolved, rtSearch, rtUrl } from "../data/links";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Bookmark, BookmarkCheck, Check, ExternalLink } from "lucide-react";
import type { MovieDetails, MovieEntry, Scores } from "../data/types";
import { friendlyError, movieDetails, scoresForMovie, tmdbPoster } from "../data/api";
import { addMovie, removeMovie, setMovieWatched, toMovieEntry, useStore } from "../data/store";
import { shortDate, usToday } from "../data/dates";
import { Empty, Poster, ScoreChips, Segmented, Spinner, useAsync } from "../ui/components";

/** Estado de um filme em relação à casa: já disponível, data prevista, ou só no cinema. */
export function homeStatus(d: MovieDetails | undefined, today: string, year: number): { text: string; ready: boolean } {
  if (!d) return { text: "", ready: false };
  if (d.providersPT.length) return { text: `Em ${d.providersPT[0].name}${d.providersPT.length > 1 ? ` e mais ${d.providersPT.length - 1}` : ""}`, ready: true };
  if (d.homeDate && d.homeDate <= today) return { text: d.rentPT.length ? `Para alugar · ${d.rentPT[0].name}` : "Já em digital", ready: true };
  if (d.homeDate) return { text: `${d.digitalDate === d.homeDate ? "Digital" : "Blu-ray"} ${shortDate(d.homeDate, year)}`, ready: false };
  if (d.theatricalDate && d.theatricalDate > today) return { text: `Cinema ${shortDate(d.theatricalDate, year)}`, ready: false };
  if (d.theatricalDate) return { text: "Ainda só no cinema", ready: false };
  return { text: "Data por anunciar", ready: false };
}

/** Botões "Quero ver" e "Visto" de um filme. */
export function MovieButtons({ entry, compact = false }: { entry: MovieEntry; compact?: boolean }) {
  const inList = useStore((s) => !!s.movies[entry.id]);
  const seen = useStore((s) => !!s.moviesWatched[entry.id]);
  const stop = (f: () => void) => (e: React.MouseEvent) => { e.preventDefault(); e.stopPropagation(); f(); };
  if (compact) {
    return (
      <span style={{ display: "flex", gap: 6 }}>
        {seen
          ? <button className="following" title="Visto — carrega para desmarcar" onClick={stop(() => setMovieWatched(entry, false))}><Check size={15} strokeWidth={3} />Visto</button>
          : inList
            ? <button className="following" style={{ background: "var(--primary-soft)", color: "var(--on-primary-soft)" }} title="Na tua lista — carrega para tirar" onClick={stop(() => removeMovie(entry.id))}><BookmarkCheck size={15} />Na lista</button>
            : <button className="follow" title="Quero ver" aria-label="Quero ver" onClick={stop(() => addMovie(entry))}><Bookmark size={18} /></button>}
      </span>
    );
  }
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      {inList && !seen
        ? <button className="btn tonal" onClick={() => removeMovie(entry.id)}><BookmarkCheck size={17} />Na lista</button>
        : !seen && <button className="btn filled" onClick={() => addMovie(entry)}><Bookmark size={17} />Quero ver</button>}
      {seen
        ? <button className="btn tonal" onClick={() => setMovieWatched(entry, false)}><Check size={17} strokeWidth={3} />Visto</button>
        : <button className="btn ghost" onClick={() => setMovieWatched(entry, true)}><Check size={17} strokeWidth={3} />Já vi</button>}
      {seen && <button className="btn ghost" onClick={() => removeMovie(entry.id)}>Tirar dos meus filmes</button>}
    </div>
  );
}

// ---------------- Os meus filmes ----------------

export function MyMovies() {
  const movies = useStore((s) => s.movies);
  const watched = useStore((s) => s.moviesWatched);
  const token = useStore((s) => s.prefs.tmdbToken);
  const [tab, setTab] = useState<"todo" | "seen">(() => { try { return (localStorage.getItem("tab:movies") as "todo" | "seen") || "todo"; } catch { return "todo"; } });
  const choose = (t: "todo" | "seen") => { setTab(t); try { localStorage.setItem("tab:movies", t); } catch { /* sem armazenamento */ } };
  const all = Object.values(movies);
  const todo = all.filter((m) => !watched[m.id]).sort((a, b) => b.addedAt - a.addedAt);
  const seen = all.filter((m) => watched[m.id]).sort((a, b) => watched[b.id] - watched[a.id]);

  // Datas e onde ver dos filmes por ver (para saber se já estão em casa)
  const ids = todo.map((m) => m.id).join(",");
  const details = useAsync(async () => {
    if (!token || !todo.length) return {} as Record<number, MovieDetails>;
    const out: Record<number, MovieDetails> = {};
    for (let i = 0; i < todo.length; i += 8) {
      const batch = await Promise.all(todo.slice(i, i + 8).map((m) => movieDetails(token, m.id).catch(() => null)));
      batch.forEach((d) => { if (d) out[d.id] = d; });
    }
    return out;
  }, [token, ids]);
  const today = usToday();
  const year = Number(today.slice(0, 4));
  const ready = todo.filter((m) => homeStatus(details.data?.[m.id], today, year).ready);
  const waiting = todo.filter((m) => !homeStatus(details.data?.[m.id], today, year).ready);

  const tile = (m: MovieEntry, line: string, accent = false) => (
    <Link key={m.id} to={`/filme/${m.id}`} className="tile" data-anchor={`t-${m.id}`}>
      <Poster src={tmdbPoster(m.poster)} large={tmdbPoster(m.poster, "original")} title={m.title} width="100%" zoomable={false} />
      <span className="clamp2" style={{ fontWeight: 800 }}>{m.title}</span>
      <span className="small" style={{ color: accent ? "var(--new)" : "var(--muted)", fontWeight: accent ? 800 : 500 }}>{line}</span>
    </Link>
  );

  return (
    <>
      <p className="eyebrow" style={{ margin: "0 0 18px" }}>{todo.length} por ver · {seen.length} {seen.length === 1 ? "visto" : "vistos"}</p>
      <Segmented value={tab} onChange={choose} options={[
        { value: "todo", label: `Por ver · ${todo.length}` }, { value: "seen", label: `Vistos · ${seen.length}` },
      ]} />
      {!token && <p className="small muted">Para veres quando cada filme chega a casa, junta a chave do TMDB nas Definições.</p>}
      {tab === "todo" && (
        !todo.length
          ? <Empty title="Ainda não tens filmes por ver" body="Em Descobrir → Filmes, carrega no marcador de um filme para o juntares aqui. Ficas a saber quando chega a casa." action={<Link className="btn filled" to="/descobrir">Descobrir filmes</Link>} />
          : <>
              {ready.length > 0 && <h2 className="h2">Já podes ver em casa</h2>}
              <div className="poster-grid">{ready.map((m) => tile(m, homeStatus(details.data?.[m.id], today, year).text, true))}</div>
              {waiting.length > 0 && <h2 className="h2">{ready.length ? "À espera" : "Os teus filmes por ver"}</h2>}
              <div className="poster-grid">{waiting.map((m) => tile(m, details.loading && !details.data ? "…" : homeStatus(details.data?.[m.id], today, year).text))}</div>
            </>
      )}
      {tab === "seen" && (
        !seen.length
          ? <Empty title="Nenhum filme visto" body="Marca os filmes que já viste com Já vi, na página do filme." />
          : <div className="poster-grid" style={{ marginTop: 14 }}>{seen.map((m) => tile(m, `Visto a ${new Intl.DateTimeFormat("pt-PT", { day: "numeric", month: "short", year: "numeric" }).format(watched[m.id])}`))}</div>
      )}
    </>
  );
}

// ---------------- Página do filme ----------------

export function MoviePage() {
  const id = Number(useParams().id);
  const nav = useNavigate();
  const token = useStore((s) => s.prefs.tmdbToken);
  const omdb = useStore((s) => s.prefs.omdbKey);
  const mdb = useStore((s) => s.prefs.mdblistKey);
  const stored = useStore((s) => s.movies[id]);
  const d = useAsync(() => (token ? movieDetails(token, id) : Promise.reject(new Error("sem chave"))), [token, id]);
  const [scores, setScores] = useState<Scores | null>(null);
  const today = usToday();
  const year = Number(today.slice(0, 4));

  useEffect(() => {
    if (!d.data) return;
    let alive = true;
    scoresForMovie({ omdbKey: omdb, mdblistKey: mdb }, { id, title: d.data.title, original_title: d.data.originalTitle, release_date: d.data.theatricalDate ?? undefined })
      .then((s) => alive && setScores({ ...s, imdbId: s.imdbId ?? d.data!.imdbId }));
    window.scrollTo(0, 0);
    return () => { alive = false; };
  }, [d.data, id, omdb, mdb]);

  const entry = useMemo<MovieEntry | null>(() => d.data ? toMovieEntry({ id, title: d.data.title, poster: d.data.poster, year: d.data.year }) : stored ?? null, [d.data, stored, id]);

  if (!token) return <Empty title="Falta a chave do TMDB" body="A página dos filmes usa o TMDB. Junta a chave nas Definições." action={<Link className="btn filled" to="/definicoes">Abrir Definições</Link>} />;
  if (d.error) return <Empty title="Não foi possível abrir o filme" body={friendlyError(d.error)} action={<button className="btn tonal" onClick={d.reload}>Tentar outra vez</button>} />;
  if (!d.data || !entry) return <Spinner />;
  const m = d.data;
  const st = homeStatus(m, today, year);
  const dates = [
    m.theatricalDate && ["Cinema", m.theatricalDate],
    m.digitalDate && ["Digital", m.digitalDate],
    m.physicalDate && ["Blu-ray", m.physicalDate],
  ].filter(Boolean) as [string, string][];

  return (
    <>
      <div className="hero">
        {(m.backdrop || m.poster) && <div className="backdrop" style={{ backgroundImage: `url(${tmdbPoster(m.backdrop ?? m.poster, "w780")})` }} />}
        <div className="fade" />
        <button className="btn ghost back" onClick={() => nav(-1)}><ArrowLeft size={18} />Voltar</button>
        <div className="content">
          <Poster src={tmdbPoster(m.poster)} large={tmdbPoster(m.poster, "original")} title={m.title} width={160} />
          <div className="info">
            <h1>{m.title}</h1>
            <span className="muted">{[m.year, m.runtime ? `${Math.floor(m.runtime / 60)} h ${m.runtime % 60} min` : null, m.genres.slice(0, 3).join(", ")].filter(Boolean).join(" · ")}</span>
            <ScoreChips scores={scores} title={m.originalTitle || m.title} ids={{ imdb: m.imdbId, tmdbMovie: m.id }} />
            {st.text && <span style={{ fontWeight: 800, color: st.ready ? "var(--new)" : "var(--primary)" }}>{st.ready ? "✓ " : ""}{st.text}</span>}
            <MovieButtons entry={entry} />
          </div>
        </div>
      </div>

      {m.overview && <p style={{ maxWidth: "72ch", fontSize: 15, lineHeight: 1.6 }}>{m.overview}</p>}

      {dates.length > 0 && (
        <>
          <h2 className="h2">Datas nos EUA</h2>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {dates.map(([k, v]) => (
              <div key={k} className="card" style={{ padding: "10px 16px", display: "grid", gap: 2 }}>
                <span className="eyebrow">{k}</span>
                <span style={{ fontWeight: 800, color: v <= today ? "var(--fg)" : "var(--primary)" }}>{shortDate(v, year)}{v <= today ? " ✓" : ""}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {(m.providersPT.length > 0 || m.rentPT.length > 0) && (
        <>
          <h2 className="h2">Onde ver em Portugal</h2>
          {[["Incluído na subscrição", m.providersPT], ["Alugar ou comprar", m.rentPT]].map(([label, list]) => (list as MovieDetails["providersPT"]).length > 0 && (
            <div key={label as string} style={{ display: "grid", gap: 8, marginBottom: 12 }}>
              <span className="small muted">{label as string}</span>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                {(list as MovieDetails["providersPT"]).map((p) => (
                  <span key={p.name} style={{ display: "flex", gap: 8, alignItems: "center" }} className="small">
                    {p.logo && <img src={p.logo} alt="" style={{ width: 30, height: 30, borderRadius: 8 }} />}{p.name}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </>
      )}

      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", margin: "18px -12px 0" }}>
        <a className="btn ghost" href={rtSearch(m.originalTitle || m.title)} target="_blank" rel="noopener"
          onClick={(e) => openResolved(e, () => rtUrl({ imdb: m.imdbId, tmdbMovie: m.id }, m.originalTitle || m.title))}>Rotten Tomatoes <ExternalLink size={14} /></a>
        <a className="btn ghost" href={`https://www.themoviedb.org/movie/${m.id}/watch?locale=PT`} target="_blank" rel="noopener">Onde ver em Portugal <ExternalLink size={14} /></a>
        {m.imdbId && <a className="btn ghost" href={`https://www.imdb.com/title/${m.imdbId}/`} target="_blank" rel="noopener">IMDb <ExternalLink size={14} /></a>}
        <a className="btn ghost" href={`https://www.themoviedb.org/movie/${m.id}`} target="_blank" rel="noopener">TMDB <ExternalLink size={14} /></a>
      </div>
      <p className="small muted" style={{ marginTop: 18 }}>Dados de filmes: TMDB. Onde ver: JustWatch, através do TMDB.</p>
    </>
  );
}
