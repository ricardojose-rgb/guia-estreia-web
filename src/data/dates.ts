// Datas: a agenda de séries segue os EUA (Nova Iorque); horas mostradas em Portugal.

export const LISBON = "Europe/Lisbon";
export const NEW_YORK = "America/New_York";

/** yyyy-MM-dd no fuso indicado. */
export function isoDay(d: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

export const usToday = () => isoDay(new Date(), NEW_YORK);
export const ptToday = () => isoDay(new Date(), LISBON);

export function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

const WEEKDAYS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
const WEEKDAYS_SHORT = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
export const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
export const MONTHS_SHORT = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

function parts(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return { y, m, d, wd };
}

/** "Hoje", "Amanhã", "Ontem" ou "Quarta-feira, 7 de outubro". */
export function relativeDay(iso: string, today: string): string {
  if (iso === today) return "Hoje";
  if (iso === addDays(today, 1)) return "Amanhã";
  if (iso === addDays(today, -1)) return "Ontem";
  const { m, d, wd } = parts(iso);
  const name = WEEKDAYS[wd];
  const full = wd === 0 || wd === 6 ? name : `${name}-feira`;
  return `${full[0].toUpperCase()}${full.slice(1)}, ${d} de ${MONTHS[m - 1]}`;
}

export function shortDate(iso: string, withYearIfNot?: number): string {
  const { y, m, d } = parts(iso);
  const yr = withYearIfNot !== undefined && y !== withYearIfNot ? ` ${y}` : "";
  return `${d} ${MONTHS_SHORT[m - 1]}${yr}`;
}

export function weekdayShort(iso: string): string {
  return WEEKDAYS_SHORT[parts(iso).wd];
}

/** Dia e hora em Portugal a partir de um instante ("sex 02:00"). */
export function ptDayTime(date: Date): { day: string; time: string; label: string } {
  const day = isoDay(date, LISBON);
  const time = new Intl.DateTimeFormat("pt-PT", { timeZone: LISBON, hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
  return { day, time, label: `${weekdayShort(day)} ${time}` };
}

/** Hora em Portugal de um episódio do TVmaze, ou null se não tiver hora certa. */
export function ptAirTime(airstamp: string | null | undefined, airtime: string | null | undefined): string | null {
  if (!airstamp || !airtime) return null;
  const t = new Date(airstamp);
  if (isNaN(t.getTime())) return null;
  return ptDayTime(t).label;
}

export const episodeCode = (season: number, number: number | null | undefined) =>
  number == null ? `T${season} Especial` : `T${season} E${number}`;

/** Esconde "Episode 5" e afins; com spoilers escondidos, devolve null. */
export function episodeTitle(name: string | null | undefined, hide: boolean): string | null {
  if (hide || !name) return null;
  if (/^Episode \d+$/i.test(name.trim())) return null;
  return name;
}

export function stripHtml(s: string | null | undefined): string {
  if (!s) return "";
  const div = document.createElement("div");
  div.innerHTML = s;
  return (div.textContent || "").trim();
}

export function seasonOf(d: Date): { season: "WINTER" | "SPRING" | "SUMMER" | "FALL"; year: number } {
  const iso = isoDay(d, "Asia/Tokyo");
  const [y, m] = iso.split("-").map(Number);
  const season = m <= 3 ? "WINTER" : m <= 6 ? "SPRING" : m <= 9 ? "SUMMER" : "FALL";
  return { season, year: y };
}

export const SEASON_PT: Record<string, string> = { WINTER: "inverno", SPRING: "primavera", SUMMER: "verão", FALL: "outono" };

export function statusPt(s: string | null | undefined): string | null {
  switch (s) {
    case "Running": return "Em exibição";
    case "Ended": return "Terminada";
    case "To Be Determined": return "Futuro incerto";
    case "In Development": return "Em produção";
    default: return null;
  }
}
