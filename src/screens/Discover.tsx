import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search, X } from "lucide-react";
import type { Anticipated, Premiere, TmShow } from "../data/types";
import { anticipatedSeries, channelOf, friendlyError, premieres, tvmazeIdFor, TvMaze } from "../data/api";
import { follow, say, useStore } from "../data/store";
import { shortDate, statusPt, usToday } from "../data/dates";
import { Carousel, Empty, FollowButton, Poster, Spinner, useAsync } from "../ui/components";
import { PremiereRow } from "./Lists";
import { useSessionState } from "../ui/memory";
import { Link } from "react-router-dom";

export function SeriesDiscover() {
  const [q, setQ] = useSessionState("q:series", "");
  const [results, setResults] = useState<{ loading: boolean; error?: unknown; hits?: TmShow[] } | null>(null);
  const shows = useStore((s) => s.shows);
  const pending = useStore((s) => s.pending);
  const token = useStore((s) => s.prefs.tmdbToken);
  const prem = useAsync(() => premieres(), []);
  const ant = useAsync(() => (token ? anticipatedSeries(token) : Promise.resolve([] as Anticipated[])), [token]);
  const [opening, setOpening] = useState<number | null>(null);
  const nav = useNavigate();
  const year = Number(usToday().slice(0, 4));

  useEffect(() => {
    const t = q.trim();
    if (t.length < 2) { setResults(null); return; }
    setResults({ loading: true });
    const h = setTimeout(() => {
      TvMaze.search(t).then((r) => setResults({ loading: false, hits: r.map((x) => x.show) }), (error) => setResults({ loading: false, error }));
    }, 350);
    return () => clearTimeout(h);
  }, [q]);

  const openAnticipated = async (a: Anticipated) => {
    setOpening(a.tmdbId);
    const id = await tvmazeIdFor(token, a).catch(() => null);
    setOpening(null);
    if (id) nav(`/serie/${id}`);
    else say(`"${a.title}" ainda não tem página no guia de episódios. Tenta mais perto da estreia.`);
  };

  const toItem = (a: Anticipated) => ({
    key: `${a.tmdbId}-${a.isNew}`, title: a.title, image: a.posterUrl, rank: a.rank, loading: opening === a.tmdbId,
    line1: [!a.isNew && a.season ? `T${a.season}` : null, a.date ? shortDate(a.date, year) : "Data por anunciar"].filter(Boolean).join(" · "),
    line2: a.network, onClick: () => openAnticipated(a),
  });

  return (
    <>
      <div className="search" style={{ marginTop: 14 }}>
        <Search size={19} className="muted" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Procurar uma série" aria-label="Procurar uma série" />
        {q && <button aria-label="Limpar pesquisa" onClick={() => setQ("")}><X size={18} /></button>}
      </div>

      {results && (
        <>
          {results.loading && <Spinner />}
          {results.error != null && <Empty title="Sem resultados" body={friendlyError(results.error)} />}
          {results.hits && !results.hits.length && <Empty title="Sem resultados" body="Não encontrei nenhuma série com esse nome. Experimenta o título original em inglês." />}
          <div className="rows two" style={{ marginTop: 14 }}>
            {results.hits?.map((s) => (
              <div className="row" key={s.id}>
                <Poster src={s.image?.medium} large={s.image?.original} title={s.name} channel={channelOf(s)} width={52} />
                <Link to={`/serie/${s.id}`} className="body">
                  <span className="title clamp2">{s.name}</span>
                  <span className="small muted clamp1">{[s.premiered?.slice(0, 4), channelOf(s), statusPt(s.status)].filter(Boolean).join(" · ")}</span>
                </Link>
                <FollowButton followed={!!shows[s.id]} loading={!!pending[`t${s.id}`]} onClick={() => follow(s)} />
              </div>
            ))}
          </div>
        </>
      )}

      {!results && (
        <>
          {!token ? (
            <div className="card notice" style={{ marginTop: 22 }}>
              <h3>Ativa as séries mais aguardadas</h3>
              <p className="muted small" style={{ margin: 0 }}>Precisa da chave gratuita do TMDB, a mesma dos filmes. Se já a tens na app do telemóvel, importa a cópia de segurança nas Definições.</p>
              <button className="btn tonal" onClick={() => nav("/definicoes")}>Abrir Definições</button>
            </div>
          ) : (
            <>
              {ant.loading && <Spinner />}
              <Carousel title="Séries novas mais aguardadas" items={(ant.data ?? []).filter((a) => a.isNew).map(toItem)} />
              <Carousel title="Temporadas mais aguardadas" items={(ant.data ?? []).filter((a) => !a.isNew).map(toItem)} />
            </>
          )}
          <PremiereSection title="Séries novas nas próximas 3 semanas" list={prem.data?.filter((p) => p.isNew)} loading={prem.loading} shows={shows} pending={pending} />
          <PremiereSection title="Regressos nas próximas 3 semanas" list={prem.data?.filter((p) => !p.isNew)} loading={false} shows={shows} pending={pending} />
        </>
      )}
    </>
  );
}

function PremiereSection({ title, list, loading, shows, pending }: {
  title: string; list?: Premiere[]; loading: boolean; shows: Record<number, unknown>; pending: Record<string, true>;
}) {
  if (loading) return <Spinner />;
  if (!list?.length) return null;
  return (
    <>
      <h2 className="h2">{title}</h2>
      <div className="rows two">
        {list.map((p) => <PremiereRow key={`${p.showId}-${p.season}`} p={p} followed={!!shows[p.showId]} loading={!!pending[`t${p.showId}`]} />)}
      </div>
    </>
  );
}
