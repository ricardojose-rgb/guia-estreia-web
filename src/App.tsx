import { useState, type ReactNode } from "react";
import { HashRouter, NavLink, Route, Routes, useLocation } from "react-router-dom";
import { CalendarDays, CirclePlay, Clapperboard, Compass, Library, RefreshCw, Settings as Cog } from "lucide-react";
import { MoviePage, MyMovies } from "./screens/Movies";
import { refreshAll, useStore } from "./data/store";
import { Segmented, Toasts } from "./ui/components";
import UpNextScreen from "./screens/UpNext";
import MyShows from "./screens/MyShows";
import ShowPage from "./screens/ShowPage";
import Settings from "./screens/Settings";
import { SeriesDiscover } from "./screens/Discover";
import { AnimeAgenda, AnimeDiscover, MoviesList, SeriesAgenda } from "./screens/Lists";

const NAV = [
  { to: "/", label: "Para ver", icon: CirclePlay, end: true },
  { to: "/agenda", label: "Agenda", icon: CalendarDays },
  { to: "/series", label: "Séries", icon: Library },
  { to: "/filmes", label: "Filmes", icon: Clapperboard },
  { to: "/descobrir", label: "Descobrir", icon: Compass },
];

type Kind = "series" | "anime" | "movies";
const KINDS: { value: Kind; label: string }[] = [
  { value: "series", label: "Séries" }, { value: "anime", label: "Anime" }, { value: "movies", label: "Filmes" },
];

function usePersisted<T extends string>(key: string, initial: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => { try { return (localStorage.getItem(key) as T) || initial; } catch { return initial; } });
  return [v, (x: T) => { setV(x); try { localStorage.setItem(key, x); } catch { /* sem armazenamento */ } }];
}

function Agenda() {
  const [kind, setKind] = usePersisted<Kind>("tab:agenda", "series");
  return (
    <>
      <Segmented options={KINDS} value={kind} onChange={setKind} />
      {kind === "series" ? <SeriesAgenda /> : kind === "anime" ? <AnimeAgenda /> : <MoviesList />}
    </>
  );
}

function Discover() {
  const [kind, setKind] = usePersisted<Kind>("tab:discover", "series");
  return (
    <>
      <Segmented options={KINDS} value={kind} onChange={setKind} />
      {kind === "series" ? <SeriesDiscover /> : kind === "anime" ? <AnimeDiscover /> : <MoviesList withAnticipated />}
    </>
  );
}

function Page({ title, children }: { title: string; children: ReactNode }) {
  const refreshing = useStore((s) => s.refreshing);
  const hasShows = useStore((s) => Object.keys(s.shows).length > 0);
  return (
    <div className="page">
      <header className="topbar">
        <h1>{title}</h1>
        {hasShows && (
          <button className="btn ghost" onClick={() => refreshAll()} disabled={refreshing} title="Atualizar as tuas séries">
            <RefreshCw size={17} className={refreshing ? "spin" : ""} style={refreshing ? { animation: "spin 1s linear infinite" } : undefined} />
            <span className="hide-sm">{refreshing ? "A atualizar…" : "Atualizar"}</span>
          </button>
        )}
        <NavLink to="/definicoes" className="btn ghost" aria-label="Definições" title="Definições"><Cog size={19} /></NavLink>
      </header>
      {children}
    </div>
  );
}

function SyncBadge() {
  const sync = useStore((s) => s.sync);
  const label = !sync.token ? "Sincronização desligada" : sync.status === "syncing" ? "A sincronizar…" : sync.status === "error" ? "Erro na sincronização" : "Sincronizado";
  const color = !sync.token ? "var(--muted)" : sync.status === "error" ? "var(--film)" : "var(--new)";
  return (
    <NavLink to="/definicoes" className="nav-item" style={{ fontSize: 13, fontWeight: 700 }} title={sync.error ?? label}>
      <span style={{ width: 8, height: 8, borderRadius: 99, background: color, marginLeft: 6, marginRight: 6 }} />{label}
    </NavLink>
  );
}

function Shell() {
  const loc = useLocation();
  const isShow = loc.pathname.startsWith("/serie/") || loc.pathname.startsWith("/filme/");
  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand"><img src="./icon.svg" alt="" />Guia de Estreias</div>
        {NAV.map(({ to, label, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end} className={({ isActive }) => `nav-item${isActive ? " active" : ""}`}>
            <Icon size={20} />{label}
          </NavLink>
        ))}
        <div className="spacer" />
        <SyncBadge />
        <NavLink to="/definicoes" className={({ isActive }) => `nav-item${isActive ? " active" : ""}`}><Cog size={20} />Definições</NavLink>
      </aside>
      <main className="main">
        <Routes>
          <Route path="/" element={<Page title="Para ver"><UpNextScreen /></Page>} />
          <Route path="/agenda" element={<Page title="Agenda"><Agenda /></Page>} />
          <Route path="/series" element={<Page title="As minhas séries"><MyShows /></Page>} />
          <Route path="/descobrir" element={<Page title="Descobrir"><Discover /></Page>} />
          <Route path="/definicoes" element={<Page title="Definições"><Settings /></Page>} />
          <Route path="/serie/:id" element={<div className="page"><ShowPage /></div>} />
          <Route path="/filmes" element={<Page title="Os meus filmes"><MyMovies /></Page>} />
          <Route path="/filme/:id" element={<div className="page"><MoviePage /></div>} />
        </Routes>
      </main>
      {!isShow && (
        <nav className="bottomnav">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end} className={({ isActive }) => (isActive ? "active" : "")}>
              <span className="pill"><Icon size={22} /></span>{label}
            </NavLink>
          ))}
        </nav>
      )}
      <Toasts />
    </div>
  );
}

export default function App() {
  return <HashRouter><Shell /></HashRouter>;
}
