// Pequenas ferramentas usadas em todo o app.

export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];

// localStorage com prefixo; funciona (sem guardar) quando o armazenamento está bloqueado
const PREFIXO = 'viagem-motorhome.';
export const store = {
  get(k) { try { return localStorage.getItem(PREFIXO + k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(PREFIXO + k, v); } catch { /* sem armazenamento */ } },
};

export const nf = (v, d = 0) => v.toLocaleString('pt-BR', { maximumFractionDigits: d, minimumFractionDigits: d });
export const fmtKm = (km) => `${nf(km, km < 20 ? 1 : 0)} km`;
/** horas → "3h25" / "40 min", arredondado de 5 em 5 minutos */
export function fmtH(h) {
  let m = Math.max(5, Math.round((h * 60) / 5) * 5);
  const H = Math.floor(m / 60); m -= H * 60;
  return H ? `${H}h${m ? String(m).padStart(2, '0') : ''}` : `${m} min`;
}
/** motorhome anda mais devagar que o carro do roteador: estimativa de +25% */
export const MOTORHOME = 1.25;
/** "2026-10-23", "sex" → "sex 23/10" */
export function fmtData(iso, semana) {
  const [, m, d] = iso.split('-');
  return `${semana} ${d}/${m}`;
}
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
/** "2026-10-04" → "04/10/2026"; "2026-09" → "09/2026" */
export function fmtDia(iso) {
  if (!iso) return '';
  const p = iso.split('-');
  return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : p.length === 2 ? `${p[1]}/${p[0]}` : iso;
}
export function isDark() {
  const r = document.documentElement;
  return r.dataset.theme === 'dark' || (!r.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
}
export const reduzMovimento = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
/** data local de hoje em "AAAA-MM-DD" */
export function hojeISO(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
/** dias inteiros entre duas datas "AAAA-MM-DD" */
export function diasEntre(a, b) {
  const t = (s) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
  return Math.round((t(b) - t(a)) / 864e5);
}

/**
 * Nascer e pôr do sol (algoritmo da NOAA, erro de ~1 min). iso = "AAAA-MM-DD"; utc = fuso em horas (ex.: −7).
 * Devolve { nasce, poe } em horas locais decimais (ex.: 6.95 = 6h57).
 */
export function sol(lat, lon, iso, utc) {
  const [y, m, d] = iso.split('-').map(Number);
  const n = Math.round((Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 1)) / 864e5) + 1;
  const g = (2 * Math.PI / 365) * (n - 1);
  const eq = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const dec = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g)
    - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const r = Math.PI / 180, la = lat * r;
  const ha = Math.acos(Math.cos(90.833 * r) / (Math.cos(la) * Math.cos(dec)) - Math.tan(la) * Math.tan(dec)) / r;
  return { nasce: (720 - 4 * (lon + ha) - eq) / 60 + utc, poe: (720 - 4 * (lon - ha) - eq) / 60 + utc };
}
/** horas decimais → "18h05" */
export function fmtHora(h) {
  let min = Math.round(h * 60);
  return `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}`;
}

// uma cor por dia, do vermelho (começo) ao roxo (fim): dá para ver a sequência no mapa
export const COR_DIA = ['#c8324b', '#dc5a32', '#e58a1f', '#cf9f0c', '#9fa21f', '#62a33a', '#2f9e5b',
  '#14998a', '#1b8bb0', '#2f6fc0', '#5a5ccb', '#8450c0', '#b04aa5'];
export const corDia = (n) => COR_DIA[(n - 1) % COR_DIA.length];

// ícones (traço 24×24, como os do Andrelândia)
export const ICONE = {
  lua: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.5 14.6A8 8 0 1 1 9.4 4.5a6.4 6.4 0 0 0 10.1 10.1Z"/></svg>',
  cama: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 18V7"/><path d="M3 14h18v4"/><path d="M21 14v-2.5a2.5 2.5 0 0 0-2.5-2.5H11v5"/><circle cx="7" cy="11" r="1.8"/></svg>',
  aviao: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3c.8 0 1.3.9 1.3 2v4.5l7.2 4v2l-7.2-2.2V18l2.2 1.6V21L12 20l-3.5 1v-1.4l2.2-1.6v-4.7l-7.2 2.2v-2l7.2-4V5c0-1.1.5-2 1.3-2Z"/></svg>',
  navegar: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 11 21 3l-8 18-2-8Z"/></svg>',
  compartilhar: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="18" cy="5.5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="18.5" r="2.5"/><path d="m8.2 10.8 7.6-4.1M8.2 13.2l7.6 4.1"/></svg>',
  voltar: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14.5 6-6 6 6 6"/></svg>',
  seguir: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9.5 6 6 6-6 6"/></svg>',
  enquadrar: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>',
  estrela: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.8l-5.2 2.8 1-5.8-4.3-4.1 5.9-.8Z"/></svg>',
  sol: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
};
// um ícone por tipo de opcional
export const TIPO_OPC = {
  trilha: { nome: 'Trilha', plural: 'Trilhas', cor: '#2f8a3c', icone: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3.5c1.8 0 2.8 1.9 2.8 4.2S9.9 12.5 8 12.5 5.2 10 5.2 7.7 6.2 3.5 8 3.5ZM6.2 14.5h3.6M16 9c1.8 0 2.8 1.9 2.8 4.2S17.9 18 16 18s-2.8-2.5-2.8-4.8S14.2 9 16 9ZM14.2 20h3.6"/></svg>' },
  mirante: { nome: 'Mirante', plural: 'Mirantes', cor: '#1e78b4', icone: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>' },
  passeio: { nome: 'Passeio', plural: 'Passeios', cor: '#14897c', icone: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="18" r="2"/><circle cx="18" cy="6" r="2"/><path d="M6 16V10a4 4 0 0 1 8 0v4a4 4 0 0 0 8 0M18 8v0"/></svg>' },
  atracao: { nome: 'Atração', plural: 'Atrações', cor: '#7a4fb3', icone: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 21h18M5 21V10l7-5 7 5v11M9 21v-6h6v6"/></svg>' },
  comida: { nome: 'Comida', plural: 'Comida', cor: '#b5532a', icone: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3v18M4.5 3v5a2.5 2.5 0 0 0 5 0V3M17 21V3c-2.2 0-3.5 2.5-3.5 6s1.3 4 3.5 4"/></svg>' },
  pratico: { nome: 'Prático', plural: 'Prático', cor: '#6b7770', icone: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3c3.5 4.6 6 8 6 11a6 6 0 0 1-12 0c0-3 2.5-6.4 6-11Z"/></svg>' },
};
