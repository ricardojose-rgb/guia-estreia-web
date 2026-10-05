// Página de um anime: dados do AniList, próximo episódio em hora de Portugal e o botão Seguir.
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Check, ExternalLink } from "lucide-react";
import { useEffect } from "react";
import { aniTitle, animeDetails, animeTvmazeId, friendlyError } from "../data/api";
import { followAnime, unfollow, useStore } from "../data/store";
import { MONTHS_SHORT, ptDayTime, SEASON_PT } from "../data/dates";
import { AniScore, Empty, Poster, Spinner, useAsync } from "../ui/components";
import type { AniMedia } from "../data/types";

const FORMAT_PT: Record<string, string> = { TV: "Série", TV_SHORT: "Série curta", ONA: "Streaming", OVA: "OVA", MOVIE: "Filme", SPECIAL: "Especial" };
const STATUS_PT: Record<string, string> = { RELEASING: "Em exibição", FINISHED: "Terminado", NOT_YET_RELEASED: "Ainda não estreou", HIATUS: "Em pausa", CANCELLED: "Cancelado" };

export function aniDate(m: Pick<AniMedia, "startDate">): string | null {
  const d = m.startDate;
  if (!d?.year) return null;
  if (!d.month) return `${d.year}`;
  if (!d.day) return `${MONTHS_SHORT[d.month - 1]} ${d.year}`;
  return `${d.day} ${MONTHS_SHORT[d.month - 1]} ${d.year}`;
}

/** Texto do AniList sem etiquetas HTML e sem a nota "(Source: …)". */
function cleanDescription(s?: string | null): string {
  return (s ?? "").replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "").replace(/\(Source:[^)]*\)/gi, "").replace(/\n{3,}/g, "\n\n").trim();
}

export function AnimePage() {
  const id = Number(useParams().id);
  const nav = useNavigate();
  const d = useAsync(() => animeDetails(id), [id]);
  const known = useStore((s) => s.animeLinks[id]);
  // Como nas séries: abre logo a página dos episódios. Só fica aqui se o anime ainda não estiver no TVmaze.
  const tv = useAsync(async () => known ?? (d.data ? await animeTvmazeId(d.data).catch(() => null) : undefined), [d.data, known]);
  useEffect(() => {
    if (tv.data) nav(`/serie/${tv.data}?ani=${id}`, { replace: true });
  }, [tv.data, id, nav]);
  const linked = useStore((s) => s.animeLinks[id]);
  const followed = useStore((s) => !!(s.animeLinks[id] && s.shows[s.animeLinks[id]]));
  const pending = useStore((s) => !!s.pending[`a${id}`]);
  useEffect(() => { window.scrollTo(0, 0); }, [id]);

  if (d.error) return <Empty title="Não foi possível abrir o anime" body={friendlyError(d.error)} action={<button className="btn tonal" onClick={d.reload}>Tentar outra vez</button>} />;
  if (!d.data || tv.loading || tv.data) return <Spinner />;
  const m = d.data;
  const title = aniTitle(m);
  const next = m.nextAiringEpisode;
  const nextT = next ? ptDayTime(new Date(next.airingAt * 1000)) : null;
  const studio = m.studios?.nodes?.[0]?.name;
  const desc = cleanDescription(m.description);
  const streaming = (m.externalLinks ?? []).filter((l) => l.type === "STREAMING");
  const meta = [
    m.format ? FORMAT_PT[m.format] ?? m.format : null,
    m.season && m.seasonYear ? `${SEASON_PT[m.season] ?? m.season} ${m.seasonYear}` : aniDate(m),
    m.episodes ? `${m.episodes} episódios` : null,
    m.duration ? `${m.duration} min` : null,
    studio,
  ].filter(Boolean).join(" · ");

  return (
    <>
      <div className="hero">
        {(m.bannerImage || m.coverImage?.extraLarge) && <div className="backdrop" style={{ backgroundImage: `url(${m.bannerImage ?? m.coverImage?.extraLarge})` }} />}
        <div className="fade" />
        <button className="btn ghost back" onClick={() => nav(-1)}><ArrowLeft size={18} />Voltar</button>
        <div className="content">
          <Poster src={m.coverImage?.large ?? m.coverImage?.medium} large={m.coverImage?.extraLarge} title={title} width={160} />
          <div className="info">
            <h1>{title}</h1>
            {m.title.romaji && m.title.romaji !== title && <span className="small muted">{m.title.romaji}</span>}
            <span className="muted">{meta}</span>
            <span style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              {m.averageScore != null && <AniScore score={m.averageScore} />}
              <span className="small muted">{[m.status ? STATUS_PT[m.status] : null, (m.genres ?? []).slice(0, 3).join(", ")].filter(Boolean).join(" · ")}</span>
            </span>
            {next && nextT && <span style={{ fontWeight: 800, color: "var(--primary)" }}>Episódio {next.episode} · {nextT.label} (hora de Portugal)</span>}
            {!next && m.status === "NOT_YET_RELEASED" && <span style={{ fontWeight: 800, color: "var(--primary)" }}>Estreia: {aniDate(m) ?? "data por anunciar"}</span>}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
              {followed
                ? <>
                    <button className="btn tonal" onClick={() => unfollow(linked)}><Check size={17} strokeWidth={3} />A seguir</button>
                    <Link className="btn ghost" to={`/serie/${linked}`}>Ver episódios</Link>
                  </>
                : <button className="btn filled" disabled={pending} onClick={() => followAnime(m, title)}>{pending ? "A adicionar…" : "Seguir"}</button>}
            </div>
          </div>
        </div>
      </div>

      <p className="small muted">Este anime ainda não tem guia de episódios. Assim que tiver (normalmente perto da estreia), carregar nele abre logo os episódios.</p>
      {desc && <p style={{ maxWidth: "72ch", fontSize: 15, lineHeight: 1.6, whiteSpace: "pre-line" }}>{desc}</p>}

      {streaming.length > 0 && (
        <>
          <h2 className="h2">Onde ver</h2>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {streaming.map((l) => <a key={l.url} className="btn tonal" href={l.url} target="_blank" rel="noopener">{l.site} <ExternalLink size={14} /></a>)}
          </div>
        </>
      )}

      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", margin: "18px -12px 0" }}>
        {m.siteUrl && <a className="btn ghost" href={m.siteUrl} target="_blank" rel="noopener">AniList <ExternalLink size={14} /></a>}
        {m.idMal && <a className="btn ghost" href={`https://myanimelist.net/anime/${m.idMal}`} target="_blank" rel="noopener">MyAnimeList <ExternalLink size={14} /></a>}
      </div>
      <p className="small muted" style={{ marginTop: 18 }}>Dados de anime: AniList. Os episódios vêm do TVmaze quando segues o anime.</p>
    </>
  );
}
