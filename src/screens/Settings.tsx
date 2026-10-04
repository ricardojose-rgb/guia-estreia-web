import { useRef, useState } from "react";
import { exportBackup, importBackup, setPrefs, useStore } from "../data/store";

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
      <div className="card setting">
        <h3>Passar as séries do telemóvel para aqui</h3>
        <p className="small muted" style={{ margin: 0 }}>
          Na app do telemóvel, abre Definições → Cópia de segurança → Exportar e envia o ficheiro para o computador (por email, Google Drive ou AirDrop). Depois carrega em Importar aqui. As chaves do TMDB e do OMDb vêm incluídas.
          O mesmo ficheiro funciona no sentido contrário.
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
        <h3>Pontuações do IMDb e Rotten Tomatoes (OMDb)</h3>
        <p className="small muted" style={{ margin: 0 }}>Com a chave do OMDb vês a nota do IMDb nas séries e nos filmes, e a do Rotten Tomatoes nos filmes.</p>
        <KeyField label="Chave do OMDb" placeholder="Chave do OMDb" value={prefs.omdbKey} onSave={(v) => setPrefs({ omdbKey: v })} />
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
