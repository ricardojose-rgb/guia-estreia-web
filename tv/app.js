/* Guia de Estreias — versão TV (Samsung Tizen 6 / Chromium 76).
 * Só leitura: lê o gist de sincronização (o mesmo do telemóvel e do site) e mostra
 * "Para ver", a agenda das tuas séries (datas dos EUA, horas de Portugal) e os teus filmes.
 * Escrito em ES2017 de propósito: o browser da TV não conhece ?. nem ??. */
(function () {
  "use strict";

  var SYNC_FILE = "guia-estreias-sync.json";
  var LS_CFG = "gtv:cfg";
  var LS_DOC = "gtv:doc";
  var LS_SHOW = "gtv:show:"; // + id
  var SHOW_TTL = 6 * 3600 * 1000;
  var MOVIE_TTL = 24 * 3600 * 1000;
  var REFRESH_EVERY = 30 * 60 * 1000;

  var KEY = { LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, ENTER: 13, BACK: 10009, ESC: 27, BACKSPACE: 8, RED: 403, DONE: 65376, CANCEL: 65385 };

  // ---------------- Estado ----------------
  var cfg = readJson(LS_CFG) || { gistId: "" };
  var data = { doc: null, shows: {}, watched: {}, movies: [], tmdb: null, error: null, loadedAt: 0 };
  var tab = "upnext";
  var loading = false;

  // ---------------- Utilitários ----------------
  function $(sel, root) { return (root || document).querySelector(sel); }
  function readJson(k) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch (e) { return null; } }
  function writeJson(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* cheio: segue em memória */ } }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function or(a, b) { return a == null ? b : a; }
  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  function stripHtml(s) { var d = document.createElement("div"); d.innerHTML = s || ""; return (d.textContent || "").trim(); }

  /** Extrai o id do gist de um id solto ou de um link. */
  function parseGistId(text) {
    var m = String(text || "").match(/[0-9a-f]{20,}/gi);
    return m ? m[m.length - 1].toLowerCase() : "";
  }

  // ---------------- Datas (EUA para a agenda, Portugal para as horas) ----------------
  var NY = "America/New_York", PT = "Europe/Lisbon";
  var WD = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
  var WDS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
  var MON = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
  var MONS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

  function isoDay(d, tz) {
    var p = {};
    new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" })
      .formatToParts(d).forEach(function (x) { p[x.type] = x.value; });
    return p.year + "-" + p.month + "-" + p.day;
  }
  function usToday() { return isoDay(new Date(), NY); }
  function addDays(iso, n) {
    var a = iso.split("-").map(Number);
    return new Date(Date.UTC(a[0], a[1] - 1, a[2] + n)).toISOString().slice(0, 10);
  }
  function parts(iso) { var a = iso.split("-").map(Number); return { y: a[0], m: a[1], d: a[2], wd: new Date(Date.UTC(a[0], a[1] - 1, a[2])).getUTCDay() }; }
  function relativeDay(iso, today) {
    if (iso === today) return "Hoje";
    if (iso === addDays(today, 1)) return "Amanhã";
    if (iso === addDays(today, -1)) return "Ontem";
    var p = parts(iso), name = WD[p.wd], full = p.wd === 0 || p.wd === 6 ? name : name + "-feira";
    return full.charAt(0).toUpperCase() + full.slice(1) + ", " + p.d + " de " + MON[p.m - 1];
  }
  function shortDate(iso) { var p = parts(iso); return p.d + " " + MONS[p.m - 1] + (p.y !== parts(usToday()).y ? " " + p.y : ""); }
  function ptTime(stamp, airtime) {
    if (!stamp || !airtime) return null;
    var t = new Date(stamp);
    if (isNaN(t.getTime())) return null;
    var day = isoDay(t, PT);
    var hm = new Intl.DateTimeFormat("pt-PT", { timeZone: PT, hour: "2-digit", minute: "2-digit", hour12: false }).format(t);
    return WDS[parts(day).wd] + " " + hm;
  }
  function epCode(s, n) { return n == null ? "S" + pad2(s) + " Especial" : "S" + pad2(s) + "E" + pad2(n); }
  function epTitle(name) { return !name || /^Episode \d+$/i.test(name.trim()) ? null : name; }

  // ---------------- Rede ----------------
  var lastTv = 0, tvChain = Promise.resolve();
  /** TVmaze: um pedido de cada vez, com pausa (limite de 20 pedidos por 10 s). */
  function tvGet(path) {
    var run = function () {
      return (async function () {
        for (var attempt = 0; ; attempt++) {
          var wait = lastTv + 350 - Date.now();
          if (wait > 0) await sleep(wait);
          lastTv = Date.now();
          var res = await fetch("https://api.tvmaze.com" + path);
          if (res.status === 429 && attempt < 3) { await sleep(1500 * (attempt + 1)); continue; }
          if (!res.ok) throw new Error("TVmaze " + res.status);
          return res.json();
        }
      })();
    };
    var p = tvChain.then(run, run);
    tvChain = p.catch(function () {});
    return p;
  }

  async function fetchGist(id) {
    var res = await fetch("https://api.github.com/gists/" + id, { headers: { Accept: "application/vnd.github+json" }, cache: "no-store" });
    if (res.status === 404) throw new Error("Não encontrei esse gist. Confirma o código nas Definições.");
    if (res.status === 403 || res.status === 429) throw new Error("O GitHub limitou os pedidos por agora. Mostro os últimos dados guardados.");
    if (!res.ok) throw new Error("O GitHub respondeu com o erro " + res.status + ".");
    var g = await res.json();
    var f = g.files && g.files[SYNC_FILE];
    if (!f) throw new Error("Esse gist não tem os dados do Guia de Estreias.");
    if (f.truncated && f.raw_url) {
      var raw = await fetch(f.raw_url, { cache: "no-store" });
      return JSON.parse(await raw.text());
    }
    return JSON.parse(f.content);
  }

  /** Série + episódios, com cache de 6 h. Guarda os episódios em formato compacto. */
  async function loadShow(id, force) {
    var c = readJson(LS_SHOW + id);
    if (c && !force && Date.now() - c.at < SHOW_TTL) return c;
    try {
      var s = await tvGet("/shows/" + id + "?embed=episodes");
      var ch = (s.webChannel && s.webChannel.name) || (s.network && s.network.name) || null;
      var eps = ((s._embedded && s._embedded.episodes) || []).map(function (e) {
        return [e.id, e.season, or(e.number, null), e.name || null, e.airdate || null, e.airstamp || null, e.airtime || null, or(e.runtime, null)];
      });
      var out = {
        at: Date.now(), id: s.id, name: s.name, channel: ch, status: s.status || null,
        image: (s.image && (s.image.medium || s.image.original)) || null,
        imageLarge: (s.image && (s.image.original || s.image.medium)) || null,
        summary: stripHtml(s.summary).slice(0, 600), genres: s.genres || [], eps: eps,
      };
      writeJson(LS_SHOW + id, out);
      return out;
    } catch (e) {
      if (c) return c; // sem rede: usa o que havia
      throw e;
    }
  }
  function ep(a) { return { id: a[0], season: a[1], number: a[2], name: a[3], airdate: a[4], airstamp: a[5], airtime: a[6], runtime: a[7] }; }

  async function tmdbHome(token, id) {
    var key = "gtv:movie:" + id, c = readJson(key);
    if (c && Date.now() - c.at < MOVIE_TTL) return c;
    try {
      var res = await fetch("https://api.themoviedb.org/3/movie/" + id + "?language=pt-PT&append_to_response=release_dates,watch/providers",
        { headers: { Authorization: "Bearer " + token, accept: "application/json" } });
      if (!res.ok) throw new Error("TMDB " + res.status);
      var d = await res.json();
      var us = [];
      ((d.release_dates && d.release_dates.results) || []).forEach(function (r) { if (r.iso_3166_1 === "US") us = r.release_dates; });
      var first = function (types) { return us.filter(function (x) { return types.indexOf(x.type) >= 0; }).map(function (x) { return x.release_date.slice(0, 10); }).sort()[0] || null; };
      var pt = (d["watch/providers"] && d["watch/providers"].results && d["watch/providers"].results.PT && d["watch/providers"].results.PT.flatrate) || [];
      var out = {
        at: Date.now(), overview: d.overview || "", runtime: d.runtime || null,
        theatrical: first([2, 3]), digital: first([4]), physical: first([5]),
        providers: pt.map(function (p) { return p.provider_name; }),
      };
      writeJson(key, out);
      return out;
    } catch (e) { return c || null; }
  }

  // ---------------- Carregar tudo ----------------
  /** Aplica as regras do documento de sincronização: ganha sempre o acontecimento mais recente. */
  function resolveDoc(doc) {
    var shows = {}, watched = {}, movies = [];
    var removed = doc.removed || {}, unw = doc.unwatched || {};
    Object.keys(doc.shows || {}).forEach(function (id) { var s = doc.shows[id]; if (!(removed[id] >= s.addedAt)) shows[id] = s; });
    Object.keys(doc.watched || {}).forEach(function (id) { var w = doc.watched[id]; if (!(unw[id] >= w[1])) watched[id] = w[0]; });
    var mr = doc.moviesRemoved || {}, mw = doc.moviesWatched || {}, mu = doc.moviesUnwatched || {};
    Object.keys(doc.movies || {}).forEach(function (id) {
      var m = doc.movies[id];
      if (mr[id] >= m.addedAt) return;
      var seen = mw[id] != null && !(mu[id] >= mw[id]);
      movies.push({ id: Number(id), title: m.title, poster: m.poster, year: m.year, addedAt: m.addedAt, seen: seen });
    });
    movies.sort(function (a, b) { return (a.seen ? 1 : 0) - (b.seen ? 1 : 0) || b.addedAt - a.addedAt; });
    return { shows: shows, watched: watched, movies: movies, tmdb: (doc.keys && doc.keys.tmdb) || null };
  }

  async function loadAll(force) {
    if (!cfg.gistId || loading) return;
    loading = true;
    status(force ? "A atualizar…" : "A carregar…");
    var doc = null;
    try {
      doc = await fetchGist(cfg.gistId);
      writeJson(LS_DOC, doc);
      data.error = null;
    } catch (e) {
      doc = readJson(LS_DOC);
      data.error = e.message || String(e);
    }
    if (doc) {
      var r = resolveDoc(doc);
      data.doc = doc; data.watched = r.watched; data.movies = r.movies; data.tmdb = r.tmdb;
      var ids = Object.keys(r.shows), shows = {}, done = 0;
      // Mostra logo o que está em cache e vai preenchendo
      ids.forEach(function (id) { var c = readJson(LS_SHOW + id); if (c) shows[id] = c; });
      data.shows = shows;
      render();
      for (var i = 0; i < ids.length; i++) {
        try { shows[ids[i]] = await loadShow(ids[i], force); } catch (e) { /* uma série falhou: segue */ }
        done++;
        if (done % 8 === 0) { status("A carregar séries… " + done + "/" + ids.length); render(); }
      }
      data.shows = shows;
      data.loadedAt = Date.now();
    }
    loading = false;
    status(data.error, data.error ? 6000 : 0);
    render();
    if (data.tmdb) loadMovieDates();
  }

  async function loadMovieDates() {
    for (var i = 0; i < data.movies.length; i++) {
      var m = data.movies[i];
      if (m.seen || m.home) continue;
      m.home = await tmdbHome(data.tmdb, m.id);
    }
    if (tab === "movies") render();
  }

  // ---------------- Derivar listas ----------------
  function upNext() {
    var today = usToday(), out = [];
    Object.keys(data.shows).forEach(function (id) {
      var s = data.shows[id];
      var eps = s.eps.map(ep).filter(function (e) { return e.season > 0 && e.airdate && e.airdate <= today; })
        .sort(function (a, b) { return a.season - b.season || (a.number || 0) - (b.number || 0); });
      var un = eps.filter(function (e) { return !data.watched[e.id]; });
      if (!un.length) return;
      var started = eps.length > un.length;
      out.push({ show: s, episode: un[0], remaining: un.length, started: started, latest: un[0].airdate });
    });
    return out.sort(function (a, b) { return (b.started ? 1 : 0) - (a.started ? 1 : 0) || b.latest.localeCompare(a.latest); });
  }

  function agenda(from, to) {
    var out = [];
    Object.keys(data.shows).forEach(function (id) {
      var s = data.shows[id];
      s.eps.forEach(function (a) {
        var e = ep(a);
        if (e.airdate && e.airdate >= from && e.airdate <= to) { e.show = s; e.watched = !!data.watched[e.id]; out.push(e); }
      });
    });
    return out.sort(function (a, b) { return a.airdate.localeCompare(b.airdate) || a.show.name.localeCompare(b.show.name) || a.season - b.season || (a.number || 0) - (b.number || 0); });
  }

  // ---------------- Desenhar ----------------
  function poster(src, name, cls) {
    return src ? '<img class="' + (cls || "poster") + '" src="' + esc(src) + '" alt="">'
      : '<div class="' + (cls || "poster") + ' ph">' + esc((name || "?").charAt(0)) + "</div>";
  }

  function render() {
    var main = $("#main");
    var tabs = document.querySelectorAll(".tab");
    for (var i = 0; i < tabs.length; i++) tabs[i].classList.toggle("active", tabs[i].getAttribute("data-tab") === tab);
    var html;
    if (tab === "settings" || !cfg.gistId) html = settingsView();
    else if (!data.doc) html = data.error ? errorView() : '<div class="spinner"></div><p class="center">A ler as tuas séries…</p>';
    else if (tab === "upnext") html = upNextView();
    else if (tab === "agenda") html = agendaView();
    else html = moviesView();
    var keep = focused && main.contains(focused) ? focused.getAttribute("data-key") : null;
    main.innerHTML = '<div class="scroller" id="scroller">' + html + "</div>";
    bindSettings();
    if (keep) { var again = main.querySelector('[data-key="' + keep + '"]'); if (again) focus(again); else if (focused && !document.body.contains(focused)) focus(firstTab()); }
    else if (focused && !document.body.contains(focused)) focus(firstTab());
    scrollIntoView();
  }

  function upNextView() {
    var list = upNext(), total = list.reduce(function (n, u) { return n + u.remaining; }, 0);
    if (!Object.keys(data.doc.shows || {}).length) return empty("Ainda não segues séries", "Segue séries no telemóvel ou no computador; aparecem aqui sozinhas.");
    if (!list.length) return empty("Estás em dia", "Não tens episódios por ver. Os próximos estão na Agenda.");
    var today = usToday();
    var card = function (u) {
      var e = u.episode;
      var extra = [u.remaining > 1 ? "mais " + (u.remaining - 1) + " por ver" : null,
        e.airdate >= addDays(today, -1) ? "estreou " + relativeDay(e.airdate, today).toLowerCase() : null,
        e.runtime ? e.runtime + " min" : null].filter(Boolean).join(" · ");
      return '<button class="card focusable" data-key="u' + u.show.id + '" data-show="' + u.show.id + '">' + poster(u.show.image, u.show.name) +
        '<div><div class="t">' + esc(u.show.name) + '</div><div class="s">' + esc([epCode(e.season, e.number), epTitle(e.name)].filter(Boolean).join(" · ")) +
        '</div><div class="x">' + esc(extra || u.show.channel || "") + "</div></div></button>";
    };
    var watching = list.filter(function (u) { return u.started; }), fresh = list.filter(function (u) { return !u.started; });
    return '<p class="eyebrow">' + total + " " + (total === 1 ? "episódio" : "episódios") + " por ver</p>" +
      (watching.length ? '<h2 class="h2">A ver</h2><div class="grid">' + watching.map(card).join("") + "</div>" : "") +
      (fresh.length ? '<h2 class="h2">Ainda não começaste</h2><div class="grid">' + fresh.map(card).join("") + "</div>" : "");
  }

  function agendaView() {
    var today = usToday(), list = agenda(addDays(today, -1), addDays(today, 13));
    if (!list.length) return empty("Nada nas próximas duas semanas", "Quando as tuas séries tiverem episódios marcados, aparecem aqui com a data dos EUA.");
    var byDay = {}, days = [];
    list.forEach(function (e) { if (!byDay[e.airdate]) { byDay[e.airdate] = []; days.push(e.airdate); } byDay[e.airdate].push(e); });
    return '<p class="eyebrow">Datas dos EUA · horas de Portugal</p>' + days.map(function (d) {
      return '<section class="day' + (d === today ? " today" : "") + '"><h3>' + esc(relativeDay(d, today)) +
        (d === today || d === addDays(today, 1) || d === addDays(today, -1) ? '<span class="muted">' + esc(shortDate(d)) + "</span>" : "") +
        '</h3><div class="grid">' + byDay[d].map(function (e) {
          var t = ptTime(e.airstamp, e.airtime);
          var pills = (e.number === 1 && e.season === 1 ? '<span class="pill new">Série nova</span>' : e.number === 1 ? '<span class="pill mine">Regresso</span>' : "") +
            (e.watched ? '<span class="pill seen">Visto</span>' : "");
          return '<button class="card focusable" data-key="a' + e.id + '" data-show="' + e.show.id + '">' + poster(e.show.image, e.show.name) +
            '<div><div class="t">' + esc(e.show.name) + '</div><div class="s">' + pills + esc(epCode(e.season, e.number)) + (epTitle(e.name) ? " · " + esc(epTitle(e.name)) : "") +
            '</div><div class="x">' + esc([e.show.channel, t ? "em Portugal " + t : null].filter(Boolean).join(" · ")) + "</div></div></button>";
        }).join("") + "</div></section>";
    }).join("");
  }

  function moviesView() {
    if (!data.movies.length) return empty("A tua lista de filmes está vazia", "Os filmes que guardares no telemóvel ou no computador aparecem aqui.");
    var toSee = data.movies.filter(function (m) { return !m.seen; }), seen = data.movies.filter(function (m) { return m.seen; });
    var today = usToday();
    var card = function (m) {
      var h = m.home, line = m.year || "";
      if (h) {
        var home = [h.digital, h.physical].filter(Boolean).sort()[0];
        if (h.providers && h.providers.length) line = "Em " + h.providers[0];
        else if (home) line = (home <= today ? "Em casa desde " : "Em casa a ") + shortDate(home);
        else if (h.theatrical) line = (h.theatrical <= today ? "No cinema desde " : "Cinema a ") + shortDate(h.theatrical);
      }
      return '<button class="pcard focusable" data-key="m' + m.id + '" data-movie="' + m.id + '">' +
        poster(m.poster ? "https://image.tmdb.org/t/p/w342" + m.poster : null, m.title, "") +
        '<div class="t">' + esc(m.title) + '</div><div class="x">' + esc(line) + "</div></button>";
    };
    return (toSee.length ? '<p class="eyebrow">' + toSee.length + " por ver</p><div class=\"posters\">" + toSee.map(card).join("") + "</div>" : "") +
      (seen.length ? '<h2 class="h2">Vistos</h2><div class="posters">' + seen.map(card).join("") + "</div>" : "");
  }

  function empty(title, body) { return '<div class="empty"><h2>' + esc(title) + "</h2><p>" + esc(body) + "</p></div>"; }
  function errorView() {
    return '<div class="empty"><h2>Não consegui ler os dados</h2><p>' + esc(data.error) + '</p><button class="btn filled focusable" data-key="retry" data-act="retry">Tentar outra vez</button></div>';
  }

  function settingsView() {
    var n = data.doc ? Object.keys(resolveDoc(data.doc).shows).length : 0;
    return '<div class="form"><h2 class="h2">Ligar ao Guia de Estreias</h2>' +
      "<p>Escreve o código do teu gist de sincronização. Encontras-o no site, em <code>Definições → Sincronização → Código para a app da TV</code>. Também aceito o link do gist.</p>" +
      "<p>Dica: a app SmartThings no telemóvel tem teclado para escrever na TV.</p>" +
      '<input class="field focusable" id="gist" data-key="gist" type="text" autocomplete="off" spellcheck="false" placeholder="ex.: 3f9a…" value="' + esc(cfg.gistId) + '">' +
      '<div class="row"><button class="btn filled focusable" data-key="save" data-act="save">Guardar e carregar</button>' +
      '<button class="btn focusable" data-key="clear" data-act="clear">Limpar cache</button></div>' +
      '<dl class="kv"><dt>Séries seguidas</dt><dd>' + (data.doc ? n : "—") + "</dd>" +
      "<dt>Última atualização</dt><dd>" + (data.loadedAt ? new Date(data.loadedAt).toLocaleString("pt-PT") : "—") + "</dd>" +
      "<dt>Estado</dt><dd>" + esc(data.error || (data.doc ? "Ligado" : "Por ligar")) + "</dd>" +
      "<dt>Versão</dt><dd>1.0.0 · só leitura (marca os vistos no telemóvel)</dd></dl></div>";
  }

  function bindSettings() {
    var input = $("#gist");
    if (!input) return;
    input.addEventListener("keydown", function (ev) {
      var k = ev.keyCode;
      if (k === KEY.ENTER || k === KEY.DONE) { ev.preventDefault(); ev.stopPropagation(); input.blur(); saveGist(); }
      else if (k === KEY.CANCEL || k === KEY.BACK || k === KEY.ESC) { ev.preventDefault(); ev.stopPropagation(); input.blur(); }
      else if (k === KEY.UP || k === KEY.DOWN) { ev.preventDefault(); ev.stopPropagation(); input.blur(); move(k); }
    });
  }

  function saveGist() {
    var id = parseGistId($("#gist") ? $("#gist").value : "");
    if (!id) { status("Esse código não parece um gist.", 4000); return; }
    if (id !== cfg.gistId) { cfg.gistId = id; writeJson(LS_CFG, cfg); data.doc = null; data.shows = {}; }
    tab = "upnext";
    render();
    loadAll(true);
  }

  // ---------------- Detalhe ----------------
  var overlayOpen = false, beforeOverlay = null;
  function openShow(id) {
    var s = data.shows[id];
    if (!s) return;
    var today = usToday();
    var eps = s.eps.map(ep).filter(function (e) { return e.season > 0 && e.airdate; })
      .sort(function (a, b) { return a.season - b.season || (a.number || 0) - (b.number || 0); });
    var firstUnseen = 0;
    for (var i = 0; i < eps.length; i++) { if (!data.watched[eps[i].id] && eps[i].airdate <= today) { firstUnseen = i; break; } if (i === eps.length - 1) firstUnseen = Math.max(0, eps.length - 3); }
    var show = eps.slice(firstUnseen, firstUnseen + 7);
    var seen = eps.filter(function (e) { return data.watched[e.id]; }).length;
    var aired = eps.filter(function (e) { return e.airdate <= today; }).length;
    var meta = [s.channel, s.genres && s.genres.slice(0, 3).join(", "), aired ? seen + "/" + aired + " vistos" : null].filter(Boolean).join(" · ");
    openOverlay('<div class="detail">' + poster(s.imageLarge || s.image, s.name, "big") + "<div><h1>" + esc(s.name) + '</h1><div class="meta">' + esc(meta) + "</div>" +
      (s.summary ? '<div class="sum">' + esc(s.summary) + "</div>" : "") +
      '<div class="eplist">' + show.map(function (e) {
        var t = ptTime(e.airstamp, e.airtime);
        return '<div class="ep' + (data.watched[e.id] ? " seen" : "") + '"><b>' + esc(epCode(e.season, e.number)) + "</b><span>" + esc(epTitle(e.name) || "") +
          '</span><span class="when">' + esc(e.airdate <= today ? (data.watched[e.id] ? "Visto" : shortDate(e.airdate)) : (e.airdate <= addDays(today, 6) ? relativeDay(e.airdate, today).split(",")[0] : shortDate(e.airdate)) + (t ? " · " + t : "")) + "</span></div>";
      }).join("") + '</div><div class="row" style="margin-top:30px"><button class="btn filled focusable" data-act="close">Voltar</button></div></div></div>');
  }
  function openMovie(id) {
    var m = null;
    data.movies.forEach(function (x) { if (x.id === id) m = x; });
    if (!m) return;
    var h = m.home || {};
    var rows = [["Cinema (EUA)", h.theatrical], ["Digital (EUA)", h.digital], ["Blu-ray (EUA)", h.physical]].filter(function (r) { return r[1]; });
    openOverlay('<div class="detail">' + poster(m.poster ? "https://image.tmdb.org/t/p/w500" + m.poster : null, m.title, "big") + "<div><h1>" + esc(m.title) + '</h1><div class="meta">' +
      esc([m.year, h.runtime ? h.runtime + " min" : null, m.seen ? "Visto" : "Por ver"].filter(Boolean).join(" · ")) + "</div>" +
      (h.overview ? '<div class="sum">' + esc(h.overview) + "</div>" : "") +
      (rows.length ? '<dl class="kv" style="margin-top:0">' + rows.map(function (r) { return "<dt>" + r[0] + "</dt><dd>" + esc(shortDate(r[1])) + "</dd>"; }).join("") + "</dl>" : "") +
      (h.providers && h.providers.length ? '<dl class="kv"><dt>Em Portugal</dt><dd>' + esc(h.providers.join(", ")) + "</dd></dl>" : "") +
      '<div class="row" style="margin-top:30px"><button class="btn filled focusable" data-act="close">Voltar</button></div></div></div>');
  }
  function openOverlay(html) {
    var o = $("#overlay");
    beforeOverlay = focused;
    o.innerHTML = html; o.hidden = false; overlayOpen = true;
    focus(o.querySelector(".focusable"));
  }
  function closeOverlay() {
    var o = $("#overlay");
    o.hidden = true; o.innerHTML = ""; overlayOpen = false;
    focus(beforeOverlay && document.body.contains(beforeOverlay) ? beforeOverlay : firstTab());
  }

  // ---------------- Foco e navegação com o comando ----------------
  var focused = null;
  function firstTab() { return document.querySelector('.tab[data-tab="' + tab + '"]') || document.querySelector(".tab"); }
  function focus(el) {
    if (!el) return;
    if (focused) focused.classList.remove("focused");
    focused = el;
    el.classList.add("focused");
    if (el.classList.contains("tab")) {
      var t = el.getAttribute("data-tab");
      if (t !== tab) { tab = t; render(); }
      var sc = $("#scroller"); if (sc) { sc.style.transform = "translateY(0)"; }
    } else scrollIntoView();
  }
  var scrollY = 0;
  function scrollIntoView() {
    var sc = $("#scroller"), main = $("#main");
    if (!sc || !focused || !sc.contains(focused)) { if (sc && focused && focused.classList.contains("tab")) { scrollY = 0; sc.style.transform = "translateY(0)"; } return; }
    var view = main.clientHeight, top = 0, el = focused;
    while (el && el !== sc) { top += el.offsetTop; el = el.offsetParent; }
    var h = focused.offsetHeight;
    // Cabeçalho do dia/secção visível acima do cartão
    if (top - scrollY < 60) scrollY = Math.max(0, top - 90);
    else if (top + h - scrollY > view - 30) scrollY = top + h - view + 60;
    scrollY = Math.max(0, Math.min(scrollY, Math.max(0, sc.scrollHeight - view)));
    sc.style.transform = "translateY(" + -scrollY + "px)";
  }
  function candidates() {
    var root = overlayOpen ? $("#overlay") : document;
    var list = root.querySelectorAll(".focusable"), out = [];
    for (var i = 0; i < list.length; i++) if (overlayOpen || !$("#overlay").contains(list[i])) out.push(list[i]);
    return out;
  }
  function move(key) {
    if (!focused || !document.body.contains(focused)) { focus(firstTab()); return; }
    var from = focused.getBoundingClientRect(), fx = from.left + from.width / 2, fy = from.top + from.height / 2;
    var best = null, bestScore = Infinity;
    candidates().forEach(function (el) {
      if (el === focused) return;
      var r = el.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2, dx = x - fx, dy = y - fy, main, side;
      if (key === KEY.RIGHT) { if (r.left < from.right - 4) return; main = dx; side = dy; }
      else if (key === KEY.LEFT) { if (r.right > from.left + 4) return; main = -dx; side = dy; }
      else if (key === KEY.DOWN) { if (r.top < from.bottom - 4) return; main = dy; side = dx; }
      else { if (r.bottom > from.top + 4) return; main = -dy; side = dx; }
      var score = main + Math.abs(side) * (key === KEY.UP || key === KEY.DOWN ? 0.35 : 2.5);
      if (score < bestScore) { bestScore = score; best = el; }
    });
    // Subir do conteúdo vai sempre para o separador ativo; descer dos separadores entra no primeiro cartão
    if (!overlayOpen && key === KEY.UP && !focused.classList.contains("tab") && (!best || best.classList.contains("tab"))) best = firstTab();
    if (!overlayOpen && key === KEY.DOWN && focused.classList.contains("tab")) {
      best = candidates().filter(function (el) { return !el.classList.contains("tab"); })[0] || null;
    }
    if (best) focus(best);
  }
  function activate() {
    if (!focused) return;
    var act = focused.getAttribute("data-act");
    if (focused.id === "gist") { focused.focus(); return; } // abre o teclado da TV
    if (act === "close") return closeOverlay();
    if (act === "save") return saveGist();
    if (act === "retry") return loadAll(true);
    if (act === "clear") {
      Object.keys(localStorage).forEach(function (k) { if (k.indexOf("gtv:show:") === 0 || k.indexOf("gtv:movie:") === 0 || k === LS_DOC) localStorage.removeItem(k); });
      status("Cache limpa. A carregar de novo…", 3000); data.doc = null; data.shows = {}; render(); loadAll(true); return;
    }
    if (focused.classList.contains("tab")) { var c = candidates().filter(function (el) { return !el.classList.contains("tab"); })[0]; if (c) focus(c); return; }
    if (focused.getAttribute("data-show")) return openShow(focused.getAttribute("data-show"));
    if (focused.getAttribute("data-movie")) return openMovie(Number(focused.getAttribute("data-movie")));
  }
  function back() {
    if (overlayOpen) return closeOverlay();
    if (!focused.classList.contains("tab")) { focus(firstTab()); return; }
    try { tizen.application.getCurrentApplication().exit(); } catch (e) { /* fora da TV */ }
  }

  document.addEventListener("keydown", function (ev) {
    if (document.activeElement && document.activeElement.tagName === "INPUT") return; // o campo trata das suas teclas
    var k = ev.keyCode;
    if (k === KEY.LEFT || k === KEY.RIGHT || k === KEY.UP || k === KEY.DOWN) { ev.preventDefault(); move(k); }
    else if (k === KEY.ENTER) { ev.preventDefault(); activate(); }
    else if (k === KEY.BACK || k === KEY.ESC || k === KEY.BACKSPACE) { ev.preventDefault(); back(); }
    else if (k === KEY.RED || k === 82 /* R no PC */) { ev.preventDefault(); loadAll(true); }
  });
  // Rato/apontador (o comando Smart da Samsung também tem modo apontador)
  document.addEventListener("click", function (ev) {
    var el = ev.target.closest ? ev.target.closest(".focusable") : null;
    if (el) { focus(el); activate(); }
  });

  // ---------------- Estado, relógio, arranque ----------------
  var statusTimer = 0;
  function status(text, ms) {
    var s = $("#status");
    clearTimeout(statusTimer);
    if (!text) { s.hidden = true; return; }
    s.textContent = text; s.hidden = false;
    if (ms) statusTimer = setTimeout(function () { s.hidden = true; }, ms);
  }
  function tick() {
    var d = new Date();
    $("#clock").textContent = new Intl.DateTimeFormat("pt-PT", { timeZone: PT, hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
  }

  try { tizen.tvinputdevice.registerKey("ColorF0Red"); } catch (e) { /* fora da TV */ }
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden && Date.now() - data.loadedAt > REFRESH_EVERY) loadAll(false);
  });
  setInterval(function () { if (!document.hidden) loadAll(false); }, REFRESH_EVERY);
  setInterval(tick, 10000); tick();

  // Arranque: mostra os últimos dados guardados enquanto vai buscar os novos
  var cachedDoc = readJson(LS_DOC);
  if (cfg.gistId && cachedDoc) {
    var r0 = resolveDoc(cachedDoc);
    data.doc = cachedDoc; data.watched = r0.watched; data.movies = r0.movies; data.tmdb = r0.tmdb;
    Object.keys(r0.shows).forEach(function (id) { var c = readJson(LS_SHOW + id); if (c) data.shows[id] = c; });
  }
  if (!cfg.gistId) tab = "settings";
  render();
  focus(firstTab());
  if (cfg.gistId) loadAll(false);

  // Para testes no PC
  window.__gtv = { parseGistId: parseGistId, resolveDoc: resolveDoc, upNext: upNext, agenda: agenda, data: data, cfg: cfg };
})();
