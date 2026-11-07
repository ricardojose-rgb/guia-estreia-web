// Séries e filmes míticos, para quando apetece rever algo mais antigo.
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { classics, tvmazeIdFor, type Classic } from "../data/api";
import { say, useStore } from "../data/store";
import { Carousel, useAsync } from "../ui/components";
import type { Anticipated } from "../data/types";

const poster = (p: string | null, size = "w342") => (p ? `https://image.tmdb.org/t/p/${size}${p}` : null);
const nota = (v: number) => `★ ${v.toFixed(1).replace(".", ",")}`;

export function ClassicsSection({ kind }: { kind: "tv" | "movie" }) {
  const token = useStore((s) => s.prefs.tmdbToken);
  const rated = useAsync(() => (token ? classics(token, kind, "rated") : Promise.resolve([] as Classic[])), [token, kind]);
  const loved = useAsync(() => (token ? classics(token, kind, "loved") : Promise.resolve([] as Classic[])), [token, kind]);
  const [opening, setOpening] = useState<number | null>(null);
  const nav = useNavigate();
  if (!token) return null;

  const open = async (c: Classic) => {
    if (kind === "movie") return nav(`/filme/${c.id}`);
    setOpening(c.id);
    const id = await tvmazeIdFor(token, { tmdbId: c.id, title: c.title, originalTitle: c.originalTitle } as Anticipated).catch(() => null);
    setOpening(null);
    if (id) nav(`/serie/${id}`);
    else say(`Não encontrei "${c.title}" no guia de episódios.`);
  };
  const items = (list: Classic[] | undefined, prefix: string) => (list ?? []).map((c, i) => ({
    key: `${prefix}${c.id}`, title: c.title, image: poster(c.poster), large: poster(c.poster, "original"),
    line1: [c.year, nota(c.vote)].filter(Boolean).join(" · "), rank: i + 1, loading: opening === c.id, onClick: () => open(c),
  }));
  const word = kind === "tv" ? "Séries míticas" : "Filmes míticos";

  return (
    <>
      <h2 className="h2" style={{ marginTop: 34 }}>Para rever · {kind === "tv" ? "séries" : "filmes"} de sempre</h2>
      <p className="small muted" style={{ marginTop: -6 }}>Com pelo menos 3 anos. Dados: TMDB.</p>
      <Carousel title={`${word} · mais bem cotad${kind === "tv" ? "as" : "os"}`} items={items(rated.data, kind === "tv" ? "cr" : "mr")} />
      <Carousel title={`${word} · mais amad${kind === "tv" ? "as" : "os"}`} items={items(loved.data, kind === "tv" ? "cl" : "ml")} />
    </>
  );
}
