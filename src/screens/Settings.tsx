import { useRef, useState } from "react";
import { connectSync, disconnectSync, exportBackup, importBackup, setPrefs, syncNow, useStore } from "../data/store";
import { TOKEN_URL } from "../data/gist";
import { normalizeMdbKey, normalizeOmdbKey, testMdbKey, testOmdbKey } from "../data/api";
import { ExternalLink, RefreshCw } from "lucide-react";

function ago(t: number): string {
  if (!t) return "nunca";
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return "agora mesmo";
  if (s < 3600) return `há ${Math.round(s / 60)} min`;
  return new Intl.DateTimeFormat("pt-PT", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(t);
}

function SyncCard() {
  const sync = useStore((s) => s.sync);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const connected = !!sync.token;

  const connect = async () => {
    setBusy(true); setErr(null);
    try { await connectSync(token); setToken(""); }
    catch (e) { setErr(e instanceof Error ? e.message : "Não foi possível ligar."); disconnectSync(); }
    finally { setBusy(false); }
  };

  return (
    <div className="card setting" id="sincronizar">
      <h3>Sincronização entre aparelhos</h3>
      {connected ? (
        <>
          <p className="small muted" style={{ margin: 0 }}>
            Ligado à conta do GitHub <b style={{ color: "var(--fg)" }}>{sync.login}</b>. As séries, os episódios vistos e as chaves ficam iguais aqui e no telemóvel.
          </p>
          <div className="line" style={{ flexWrap: "wrap" }}>
            <span className="small" style={{ flex: 1, color: sync.status === "error" ? "var(--film)" : "var(--muted)" }}>
              {sync.status === "syncing" ? "A sincronizar…" : sync.status === "error" ? sync.error : `Sincronizado ${ago(sync.lastSync)}`}
            </span>
            <button className="btn tonal" disabled={sync.status === "syncing"} onClick={() => syncNow()}><RefreshCw size={16} />Sincronizar agora</button>
            <button className="btn ghost" onClick={disconnectSync}>Desligar</button>
          </div>
        </>
      ) : (
        <>
          <p className="small muted" style={{ margin: 0 }}>
            Guarda as tuas séries num ficheiro secreto na tua conta do GitHub, para ficarem iguais no telemóvel e no computador. Só é preciso fazer isto uma vez em cada aparelho.
          </p>
          <ol className="small" style={{ margin: 0, paddingLeft: 20, display: "grid", gap: 4 }}>
            <li>Abre <a className="primary-text" href={TOKEN_URL} target="_blank" rel="noopener" style={{ fontWeight: 800 }}>esta página do GitHub <ExternalLink size={12} style={{ verticalAlign: -1 }} /></a>. A opção <b>gist</b> já vem marcada.</li>
            <li>Em <b>Expiration</b>, escolhe <b>No expiration</b> e carrega em <b>Generate token</b> no fim da página.</li>
            <li>Copia o código que começa por <b>ghp_</b> e cola-o aqui. Usa o mesmo código na app do telemóvel.</li>
          </ol>
          <div className="line" style={{ flexWrap: "wrap" }}>
            <input className="field" style={{ flex: "1 1 260px" }} type="password" placeholder="ghp_…" aria-label="Chave do GitHub" autoComplete="off"
              value={token} onChange={(e) => setToken(e.target.value)} />
            <button className="btn filled" disabled={busy || token.trim().length < 20} onClick={connect}>{busy ? "A ligar…" : "Ligar"}</button>
          </div>
          {err && <p className="small" style={{ margin: 0, color: "var(--film)" }}>{err}</p>}
        </>
      )}
    </div>
  );
}

function KeyField({ label, value, onSave, placeholder }: { label: string; value: string; onSave: (v: string) => void; placeholder: string }) {
  const [v, setV] = useState(value);
  const [saved, setSaved] = useState(false);
  return (
    <div className="line" style={{ flexWrap: "wrap" }}>
      <input className="field" style={{ flex: "1 1 260px" }} type="password" aria-label={label} placeholder={placeholder}
        value={v} onChange={(e) => { setV(e.target.value); setSaved(false); }} autoComplete="off" />
      <button className="btn filled" onClick={() => { onSave(v.trim()); setSaved(true); }}>{saved ? "Guardado" : "Guardar"}</button>
    </div>
  );
}

function MdbField() {
  const key = useStore((s) => s.prefs.mdblistKey);
  const [v, setV] = useState(key);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async (text: string) => {
    const k = normalizeMdbKey(text);
    setV(k); setPrefs({ mdblistKey: k }); setBusy(true);
    setResult(k ? await testMdbKey(k) : null);
    setBusy(false);
  };
  return (
    <>
      <div className="line" style={{ flexWrap: "wrap" }}>
        <input className="field" style={{ flex: "1 1 260px" }} aria-label="Chave do MDBList" placeholder="Chave do MDBList"
          value={v} onChange={(e) => { setV(e.target.value); setResult(null); }} autoComplete="off" spellCheck={false} />
        <button className="btn filled" disabled={busy} onClick={() => save(v)}>{busy ? "A testar…" : "Guardar e testar"}</button>
      </div>
      {result && <p className="small" style={{ margin: 0, fontWeight: 700, color: result.ok ? "var(--new)" : "var(--film)" }}>{result.message}</p>}
    </>
  );
}

function OmdbField() {
  const key = useStore((s) => s.prefs.omdbKey);
  const [v, setV] = useState(key);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async (text: string) => {
    const k = normalizeOmdbKey(text);
    setV(k); setPrefs({ omdbKey: k }); setBusy(true);
    setResult(k ? await testOmdbKey(k) : null);
    setBusy(false);
  };
  return (
    <>
      <p className="small muted" style={{ margin: 0 }}>Podes colar a chave sozinha ou o link completo do email do OMDb. Antes de a usar, carrega no link de ativação desse email.</p>
      <div className="line" style={{ flexWrap: "wrap" }}>
        <input className="field" style={{ flex: "1 1 260px" }} aria-label="Chave do OMDb" placeholder="Chave do OMDb (8 letras e números)"
          value={v} onChange={(e) => { setV(e.target.value); setResult(null); }} autoComplete="off" spellCheck={false} />
        <button className="btn filled" disabled={busy} onClick={() => save(v)}>{busy ? "A testar…" : "Guardar e testar"}</button>
      </div>
      {result && <p className="small" style={{ margin: 0, fontWeight: 700, color: result.ok ? "var(--new)" : "var(--film)" }}>{result.message}</p>}
    </>
  );
}

export default function Settings() {
  const prefs = useStore((s) => s.prefs);
  const busy = useStore((s) => s.refreshing);
  const [status, setStatus] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const doExport = () => {
    const blob = new Blob([exportBackup()], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `guia-estreias-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    setStatus("Cópia de segurança guardada na pasta de transferências.");
  };

  const doImport = async (file: File) => {
    setStatus("A importar… pode demorar um pouco.");
    try {
      const n = await importBackup(await file.text());
      setStatus(n === 1 ? "Importada 1 série." : `Importadas ${n} séries.`);
    } catch {
      setStatus("Este ficheiro não é uma cópia de segurança do Guia de Estreias.");
    }
  };

  return (
    <div className="settings">
      <SyncCard />
      <div className="card setting">
        <h3>Cópia de segurança</h3>
        <p className="small muted" style={{ margin: 0 }}>
          Guarda tudo num ficheiro, ou importa o ficheiro exportado na app do telemóvel. Com a sincronização ligada não precisas disto.
        </p>
        <div className="line">
          <button className="btn tonal" onClick={doExport}>Exportar</button>
          <button className="btn tonal" disabled={busy} onClick={() => fileRef.current?.click()}>Importar</button>
          <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) doImport(f); e.target.value = ""; }} />
        </div>
        {status && <p className="small primary-text" style={{ margin: 0 }}>{status}</p>}
      </div>

      <div className="card setting">
        <div className="line">
          <div style={{ flex: 1 }}>
            <h3>Proteção contra spoilers</h3>
            <p className="small muted" style={{ margin: "4px 0 0" }}>Esconde o nome dos episódios que ainda não viste.</p>
          </div>
          <button className={`switch${prefs.hideSpoilers ? " on" : ""}`} role="switch" aria-checked={prefs.hideSpoilers} aria-label="Proteção contra spoilers"
            onClick={() => setPrefs({ hideSpoilers: !prefs.hideSpoilers })} />
        </div>
      </div>

      <div className="card setting">
        <h3>Filmes e mais aguardadas (TMDB)</h3>
        <p className="small muted" style={{ margin: 0 }}>Cola o "API Read Access Token" do TMDB (o texto comprido que começa por eyJ). Se o importares da app do telemóvel, não precisas de fazer nada aqui.</p>
        <KeyField label="Chave do TMDB" placeholder="API Read Access Token" value={prefs.tmdbToken} onSave={(v) => setPrefs({ tmdbToken: v })} />
      </div>

      <div className="card setting">
        <h3>Todas as pontuações (MDBList)</h3>
        <p className="small muted" style={{ margin: 0 }}>
          IMDb, Rotten Tomatoes (🍅 críticos e 🍿 público), Metacritic, TMDB, Letterboxd e Trakt, nas séries e nos filmes.
          Cria conta gratuita em <a className="primary-text" href="https://mdblist.com/preferences/" target="_blank" rel="noopener" style={{ fontWeight: 800 }}>mdblist.com</a>,
          abre <b>Preferences</b> e copia a <b>API Key</b>. Com esta chave já não precisas da do OMDb.
        </p>
        <MdbField />
      </div>

      <div className="card setting">
        <h3>Pontuações do IMDb (OMDb) · alternativa</h3>
        <p className="small muted" style={{ margin: 0 }}>Com a chave do OMDb vês a nota do IMDb nas séries e nos filmes, e a do Rotten Tomatoes nos filmes.</p>
        <OmdbField />
      </div>

      <div className="card setting">
        <h3>Sobre</h3>
        <p className="small muted" style={{ margin: 0 }}>
          Datas de estreia dos EUA. Séries: TVmaze (CC BY-SA). Anime: AniList. Filmes: TMDB. Este produto usa a API do TMDB mas não é endossado nem certificado pelo TMDB.
          As tuas séries, os episódios vistos e as chaves ficam guardados só neste browser.
        </p>
      </div>
    </div>
  );
}
