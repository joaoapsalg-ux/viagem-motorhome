// Demonstração animada sobre o mapa. "▶ Demonstração" (ficha do dia): a câmera passeia pela rota do dia, a linha vai
// sendo desenhada e um cartão mostra a foto e o que importa de cada lugar (km e tempo do trecho, sol, clima da noite,
// altitude, opcionais por perto, pernoite). "▶ A viagem em 2 minutos" (lista dos dias): uma cena por dia.
// Controles: pausar, anterior/seguinte, fechar; teclado espaço, ← →, Esc. Tocar no mapa pausa.
// Contrato dos módulos: src/mod/LEIAME.md.

const PERTO_KM = 5;        // opcional a menos disso de um lugar do dia entra no cartão dele; mais longe, ganha cena própria
const MAX_LONGE = 3;       // no máximo 3 cenas de opcionais longe das paradas
const ALVO = { dia: 90, viagem: 120 };   // duração máxima de cada demonstração (s)
const PITCH = 50;
// duração mínima (s) e quanto dela a câmera leva voando até o lugar (fração, teto em s)
const TEMPO = {
  abertura: [8, 0.3, 2.6], saida: [6.5, 0.4, 2.8], parada: [7, 0.45, 3.6], opcional: [6.5, 0.45, 3.4], pernoite: [8, 0.45, 3.6],
  'viagem-abertura': [6.5, 0.4, 2.6], 'viagem-dia': [7.5, 0.55, 4.2], 'viagem-fim': [6.5, 0.4, 2.8],
};
const DIF = { facil: 'fácil', moderada: 'moderada', dificil: 'difícil' };
const G_ALERTA = { alta: 0, media: 1 };
const NOME_G = { alta: 'Alerta alto', media: 'Atenção' };
const SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
// camadas da rota do app que ficam apagadas enquanto a linha da demonstração é desenhada por cima
const APAGAR = ['r-ativa', 'r-shuttle', 'r-contorno'];

const ICO = {
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7.5 4.8v14.4L19 12Z" fill="currentColor"/></svg>',
  pausa: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.5 5.5v13M15.5 5.5v13" stroke-width="3"/></svg>',
  ant: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6.5v11L10 12Z" fill="currentColor"/><path d="M6.5 6v12"/></svg>',
  prox: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6.5v11l8-5.5Z" fill="currentColor"/><path d="M17.5 6v12"/></svg>',
  x: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  km: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.5 3.5 5 20.5M15.5 3.5l3.5 17M12 4.5v3M12 10.5v3M12 16.5v3"/></svg>',
  relogio: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>',
  alt: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m2.5 19.5 6.5-11 4 6.5 2.5-4 6 8.5Z"/></svg>',
  termo: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 14.5V5a2 2 0 0 0-4 0v9.5a4 4 0 1 0 4 0Z"/><path d="M12 11v6"/></svg>',
  aviso: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5 2.8 19.5h18.4Z"/><path d="M12 10v4.5"/><circle cx="12" cy="17" r=".6" fill="currentColor"/></svg>',
  pin: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-6.5-6.2-6.5-11a6.5 6.5 0 0 1 13 0c0 4.8-6.5 11-6.5 11Z"/><circle cx="12" cy="10" r="2.3"/></svg>',
  onibus: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="3.5" width="14" height="14" rx="2.5"/><path d="M5 11h14M8 17.5V20M16 17.5V20"/></svg>',
  custo: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v18M16.5 7.5c0-1.7-2-3-4.5-3s-4.5 1.3-4.5 3 2 2.6 4.5 3 4.5 1.4 4.5 3.2-2 3-4.5 3-4.5-1.3-4.5-3"/></svg>',
  cal: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16v14H4ZM4 10h16M8 3v4M16 3v4"/></svg>',
};

const CSS = `
  .demo-btn svg, .demo-viagem svg { width: 14px; height: 14px; }
  .demo-viagem { flex: 0 0 auto; width: 100%; padding: 11px 12px; font-size: 13.5px; border-color: color-mix(in srgb, var(--accent) 55%, var(--panel-line)); color: var(--accent); }
  #demo-cartao { z-index: 5; bottom: calc(18px + env(safe-area-inset-bottom, 0px)); left: calc(var(--side-w) + (100vw - var(--side-w)) / 2); transform: translateX(-50%);
    width: min(800px, calc(100vw - var(--side-w) - 40px)); box-sizing: border-box; padding: 12px 12px 18px; overflow: hidden; container: demo / inline-size; }
  #demo-cartao.is-sem-foto { width: min(600px, calc(100vw - var(--side-w) - 40px)); }
  .demo-in { display: grid; grid-template-columns: minmax(0, 44%) minmax(0, 1fr); grid-template-rows: minmax(0, 1fr); gap: 0 16px; max-height: min(300px, 50vh); }
  #demo-cartao.is-sem-foto .demo-in { grid-template-columns: minmax(0, 1fr); }
  .demo-ft { margin: 0; display: grid; gap: 4px; align-content: start; min-width: 0; }
  .demo-fotos { aspect-ratio: 16 / 9; border-radius: 8px; overflow: hidden; display: grid; gap: 2px; background: color-mix(in srgb, var(--ink) 9%, var(--tile)); }
  .demo-fotos.is-2 { grid-template-columns: 1fr 1fr; }
  .demo-fotos.is-3 { grid-template-columns: 2fr 1fr; grid-template-rows: 1fr 1fr; }
  .demo-fotos.is-3 img:first-child { grid-row: span 2; }
  .demo-fotos img { display: block; width: 100%; height: 100%; min-height: 0; object-fit: cover; opacity: 0; transition: opacity .5s ease; }
  .demo-fotos img.is-ok { opacity: 1; }
  .demo-fotos.is-1 img.is-ok { animation: demo-kb 11s ease-out forwards; }
  .demo-fotos img.is-sem { visibility: hidden; }
  @keyframes demo-kb { from { transform: scale(1); } to { transform: scale(1.08); } }
  .demo-ft figcaption { font: 10.5px/1.35 var(--f-data); color: var(--ink-soft); overflow: hidden; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; }
  .demo-ft figcaption a { color: inherit; text-decoration: none; }
  .demo-ft figcaption a:hover { text-decoration: underline; }
  .demo-corpo { display: grid; grid-template-rows: auto minmax(0, 1fr); gap: 2px; min-width: 0; min-height: 0; }
  .demo-top { display: flex; align-items: center; gap: 6px; min-width: 0; }
  .demo-top .eyebrow { flex: 1; min-width: 0; line-height: 1.35; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .demo-top .day-dot { background: var(--c, var(--accent)); width: 10px; height: 10px; border-radius: 3px; margin-right: 5px; }
  .demo-ctl { flex: 0 0 auto; display: flex; gap: 2px; }
  .demo-ctl button { all: unset; cursor: pointer; box-sizing: border-box; width: 36px; height: 36px; display: grid; place-items: center; border-radius: 8px; color: var(--ink-soft); }
  .demo-ctl button:hover { color: var(--ink); background: color-mix(in srgb, var(--ink) 8%, transparent); }
  .demo-ctl button:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
  .demo-ctl button[data-demo-ctl="pausa"] { background: var(--accent); color: var(--panel); }
  .demo-ctl button[data-demo-ctl="pausa"]:hover { background: color-mix(in srgb, var(--accent) 85%, var(--ink)); color: var(--panel); }
  .demo-ctl button[data-demo-ctl="pausa"]:focus-visible { outline-color: var(--ink); outline-offset: 2px; }
  .demo-ctl button[disabled] { opacity: .35; cursor: default; pointer-events: none; }
  .demo-ctl svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
  .demo-txt { overflow: auto; min-height: 0; display: grid; gap: 6px; align-content: start; padding: 2px 4px 2px 0; overscroll-behavior: contain; scrollbar-width: thin; scrollbar-color: var(--panel-line) transparent; }
  .demo-txt:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 4px; }
  /* o título fica preso no alto enquanto o texto rola (sozinho ou pela pessoa) */
  .demo-txt h2 { position: sticky; top: -2px; z-index: 1; margin: 0; padding-bottom: 2px; background: var(--panel); font: 700 24px/1.05 var(--f-display); letter-spacing: .02em; text-transform: uppercase; text-wrap: balance; }
  .demo-txt h2::after { content: ''; position: absolute; left: 0; right: 0; top: 100%; height: 7px; background: linear-gradient(var(--panel), transparent); pointer-events: none; }
  .demo-txt h2 .arr { color: var(--ink-soft); font-weight: 600; }
  .demo-texto { margin: 0; font-size: 14px; line-height: 1.45; }
  .demo-texto:empty, .demo-nota:empty { display: none; }
  .demo-fatos, .demo-ops { list-style: none; margin: 0; padding: 0; display: grid; gap: 3px; }
  .demo-fatos li { display: grid; grid-template-columns: 16px minmax(0, 1fr); gap: 7px; align-items: start; font: 12.5px/1.4 var(--f-data); }
  .demo-fatos li > i { display: grid; padding-top: 1px; color: var(--contour); }
  .demo-fatos li > i svg { width: 15px; height: 15px; fill: none; stroke: currentColor; stroke-width: 1.9; stroke-linecap: round; stroke-linejoin: round; }
  .demo-fatos li b { font-weight: 500; color: var(--contour); }
  .demo-fatos li.is-alta, .demo-fatos li.is-media { --g: var(--g-media); padding: 4px 6px; border-left: 3px solid var(--g); border-radius: 0 6px 6px 0; background: color-mix(in srgb, var(--g) 10%, transparent); font-family: var(--f-body); font-size: 13px; }
  .demo-fatos li.is-alta { --g: var(--g-alta); }
  .demo-fatos li.is-alta > i, .demo-fatos li.is-media > i { color: color-mix(in srgb, var(--g) 70%, var(--ink)); }
  .demo-fatos li.is-alta b, .demo-fatos li.is-media b { color: inherit; font-weight: 600; }
  .demo-ops li { display: grid; grid-template-columns: 40px minmax(0, 1fr); gap: 8px; align-items: center; padding: 4px; border-radius: 8px; background: var(--tile); border-left: 3px solid var(--t, var(--gold)); }
  .demo-ops .demo-op-im { position: relative; width: 40px; height: 40px; border-radius: 6px; overflow: hidden; display: grid; place-items: center; background: color-mix(in srgb, var(--t) 16%, transparent); color: color-mix(in srgb, var(--t) 70%, var(--ink)); }
  .demo-ops .demo-op-im img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; display: block; }
  .demo-ops .demo-op-im svg { width: 20px; height: 20px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
  .demo-ops b { display: block; font: 700 14px/1.15 var(--f-display); letter-spacing: .02em; }
  .demo-ops small { display: block; font: 11.5px/1.3 var(--f-data); color: var(--ink-soft); }
  .demo-nota { margin: 0; font-size: 12.5px; line-height: 1.45; color: var(--ink-soft); }
  .demo-barra { position: absolute; left: 12px; right: 12px; bottom: 7px; height: 4px; display: flex; gap: 3px; }
  .demo-barra span { flex: 1 1 0; min-width: 2px; border-radius: 2px; overflow: hidden; background: color-mix(in srgb, var(--ink) 13%, transparent); }
  .demo-barra i { display: block; height: 100%; width: 0; background: var(--c, var(--accent)); }
  #demo-cartao.is-pausado .demo-barra span.is-on i { animation: demo-pisca 1.4s ease-in-out infinite; }
  @keyframes demo-pisca { 50% { opacity: .35; } }
  .demo-entra { animation: demo-entra .45s ease-out; }
  @keyframes demo-entra { from { opacity: 0; transform: translateY(6px); } }
  #demo-selo { position: fixed; z-index: 4; top: calc(22px + env(safe-area-inset-top, 0px)); left: calc(var(--side-w) + (100vw - var(--side-w)) / 2); transform: translateX(-50%);
    display: grid; justify-items: center; gap: 4px; color: #fff; text-shadow: 0 2px 14px rgba(0,0,0,.5), 0 0 2px rgba(0,0,0,.6); pointer-events: none; white-space: nowrap; opacity: 0; transition: opacity .6s ease; }
  #demo-selo.is-on { opacity: 1; }
  #net:not([hidden]) ~ #demo-selo { top: calc(62px + env(safe-area-inset-top, 0px)); }   /* sem sinal: abaixo do aviso */
  #demo-selo b { font: 700 clamp(40px, 8vw, 64px)/0.95 var(--f-display); letter-spacing: .04em; text-transform: uppercase; }
  #demo-selo span { font: 600 14px/1.2 var(--f-display); letter-spacing: .14em; text-transform: uppercase; }
  body.demo-on #nav, body.demo-on #estrada-cartao, body.demo-on #day-badge { display: none !important; }
  body.demo-on .maplibregl-ctrl-bottom-right { bottom: var(--demo-h, 0px) !important; }
  /* cartão estreito (celular, tablet com o painel aberto): foto em cima, texto embaixo com rolagem própria */
  @container demo (max-width: 560px) {
    .demo-in { grid-template-columns: minmax(0, 1fr); grid-template-rows: auto minmax(0, 1fr); gap: 6px; max-height: min(56vh, calc(100dvh - var(--map-bottom, 0px) - 140px)); }
    .demo-fotos { aspect-ratio: auto; height: min(56.25cqw, 17vh); }
    .demo-ft figcaption { -webkit-line-clamp: 2; }
    .demo-top .eyebrow { white-space: normal; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
    .demo-txt { max-height: 19vh; gap: 5px; }
    .demo-txt h2 { font-size: 20px; }
    .demo-texto { font-size: 13.5px; line-height: 1.4; }
  }
  @media (max-width: 700px) {
    #demo-cartao, #demo-cartao.is-sem-foto { left: 8px; right: 8px; width: auto; transform: none; bottom: calc(var(--map-bottom, 0px) + 8px); padding: 8px 8px 15px; }
    .demo-ctl button { width: 40px; height: 40px; }
    .demo-barra { left: 8px; right: 8px; bottom: 6px; }
    #demo-selo { top: calc(14px + env(safe-area-inset-top, 0px)); }
  }
  @media (prefers-reduced-motion: reduce) {
    .demo-entra, .demo-fotos.is-1 img.is-ok, #demo-cartao.is-pausado .demo-barra span.is-on i { animation: none; }
    .demo-fotos img, #demo-selo { transition: none; }
  }
`;

let ctx, U, cartao, selo, el = {};
let clima = null, perfis = null;   // data/clima.json e data/perfis.json (null enquanto não vieram ou se faltarem)
let demo = null;                   // a demonstração em andamento
const medidas = new Map();         // id da rota → { co, cum (km acumulado em cada vértice), total }
const root = document.documentElement;

/** para os testes no Chrome sem janela (o SwiftShader desenha poucos quadros por segundo): ritmo e estado */
export const _teste = {
  ritmo: 1,
  estado: () => demo && { tipo: demo.tipo, n: demo.n, k: demo.k, t: +demo.t.toFixed(2), pausado: demo.pausado,
    cenas: demo.cenas.map((c) => ({ tipo: c.tipo, titulo: c.titulo, dur: +c.dur.toFixed(1), fotos: c.fotos.length, h0: c.h0, h1: c.h1 })) },
  ir: (k) => { if (!demo) return; if (demo.pausado) continuar(); irPara(k); },
  pausar: () => { if (demo && !demo.pausado) pausar(); },
};

export function iniciar(c) {
  ctx = c; U = c.util;
  const st = document.createElement('style');
  st.id = 'mod-demo';
  st.textContent = CSS;
  document.head.append(st);
  montarCartao();
  carregarDados();   // segundo plano: só enriquecem os cartões
  // os botões ficam na ficha do dia e na lista dos dias (redesenhadas com innerHTML): clique por delegação
  U.$('#day').addEventListener('click', (e) => {
    const b = e.target.closest('[data-demo-dia]');
    if (b) return comecar({ tipo: 'dia', n: +b.dataset.demoDia });
    // "No mapa", ver uma parada ou um opcional na ficha: a câmera vai para lá, então a demonstração pausa (como ao mexer no mapa)
    if (demo && e.target.closest('[data-act="enquadrar"], [data-ponto-mapa], [data-op-mapa], [data-ponto]:not([aria-expanded])')) {
      demo.mexeu = true;
      if (!demo.pausado) pausar();
    }
  });
  U.$('#trip').addEventListener('click', (e) => { if (e.target.closest('[data-demo-viagem]')) comecar({ tipo: 'viagem' }); });
  addEventListener('keydown', teclado, true);   // antes dos atalhos do app (← → trocam de dia, Esc volta)
  // mexer no mapa pausa (a pessoa quer olhar); "continuar" leva a câmera de volta à cena
  const mapEl = U.$('#map'), mexeu = () => { if (!demo) return; demo.mexeu = true; if (!demo.pausado) pausar(); };
  mapEl.addEventListener('pointerdown', mexeu, true);
  mapEl.addEventListener('wheel', mexeu, { capture: true, passive: true });
  addEventListener('resize', () => { if (demo) demo.margemSuja = true; });
  new ResizeObserver(() => { if (demo) demo.margemSuja = true; }).observe(cartao);

  ctx.registrar({
    botaoDia: (d) => `<button type="button" class="btn btn--small demo-btn" data-demo-dia="${d.n}" aria-label="Demonstração animada do dia ${d.n}">${ICO.play}Demonstração</button>`,
    aoRenderViagem: (lista) => {
      if (lista.querySelector('[data-demo-viagem]')) return;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn demo-viagem';
      b.dataset.demoViagem = '';
      b.innerHTML = `${ICO.play}A viagem em 2 minutos`;
      const st3 = lista.querySelector('.stats3');
      if (st3) st3.after(b); else lista.prepend(b);
    },
    // no celular, abrir uma parte do painel cobre o cartão: a demonstração para
    aoMostrarPainel: () => { if (demo && ctx.celular()) encerrar({ restaurar: false }); },
  });
}

async function carregarDados() {
  const ler = async (u) => { try { const r = await fetch(u); return r.ok ? await r.json() : null; } catch { return null; } };
  [clima, perfis] = await Promise.all([ler('data/clima.json'), ler('data/perfis.json')]);
  if (!Object.keys(clima?.lugares ?? {}).length) clima = null;
}

// ---------- contas no mapa ----------
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const suave = (u) => (u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2);
const difAng = (a, b) => ((((b - a) % 360) + 540) % 360) - 180;
const merc = ([lon, lat]) => [(lon + 180) / 360, (1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) / 2];
const geo = ([x, y]) => [x * 360 - 180, (360 / Math.PI) * Math.atan(Math.exp((1 - 2 * y) * Math.PI)) - 90];
function distKm([lo1, la1], [lo2, la2]) {
  const r = Math.PI / 180, a = Math.sin(((la2 - la1) * r) / 2) ** 2 + Math.cos(la1 * r) * Math.cos(la2 * r) * Math.sin(((lo2 - lo1) * r) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(a));
}
/** rota com o km acumulado em cada vértice (a linha simplificada: o total é perto do km do OSRM, não igual) */
function medir(id) {
  if (medidas.has(id)) return medidas.get(id);
  const co = ctx.rotaPorId.get(id).geometry.coordinates, cum = [0];
  for (let i = 1; i < co.length; i++) cum.push(cum[i - 1] + distKm(co[i - 1], co[i]));
  const R = { id, co, cum, total: cum.at(-1) };
  medidas.set(id, R);
  return R;
}
function indiceEm(R, h) {   // último vértice com km ≤ h
  let a = 0, b = R.cum.length - 1;
  while (a < b) { const m = (a + b + 1) >> 1; if (R.cum[m] <= h) a = m; else b = m - 1; }
  return a;
}
function pontoEm(R, h) {
  h = clamp(h, 0, R.total);
  const i = indiceEm(R, h);
  if (i >= R.co.length - 1) return R.co.at(-1);
  const s = R.cum[i + 1] - R.cum[i], t = s ? (h - R.cum[i]) / s : 0, a = R.co[i], b = R.co[i + 1];
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}
/** a linha do começo até o km h */
function fatia(R, h) {
  if (!(h > 0)) return [];
  return [...R.co.slice(0, indiceEm(R, Math.min(h, R.total)) + 1), pontoEm(R, h)];
}
/** ponto mais perto na linha, procurando só daqui para a frente (laços e idas e voltas: o caminho segue na ordem) */
function projetar(R, [lon, lat], o0 = 0) {
  const k = Math.cos((lat * Math.PI) / 180), co = R.co;
  let melhor = Infinity, km = 0, ordem = o0;
  for (let i = Math.max(0, Math.floor(o0)); i < co.length - 1; i++) {
    const ax = (co[i][0] - lon) * k, ay = co[i][1] - lat, bx = (co[i + 1][0] - lon) * k, by = co[i + 1][1] - lat;
    const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
    let t = L ? clamp(-(ax * dx + ay * dy) / L, 0, 1) : 0;
    if (i + t < o0) t = o0 - i;
    const px = ax + t * dx, py = ay + t * dy, dd = px * px + py * py;
    if (dd < melhor) { melhor = dd; ordem = i + t; km = R.cum[i] + t * (R.cum[i + 1] - R.cum[i]); }
  }
  return { km, ordem, dist: Math.sqrt(melhor) * 111.32 };
}
/** rumo (graus, 0 = norte) de a para b; null se for o mesmo lugar */
function rumoEntre(a, b) {
  const [x0, y0] = merc(a), [x1, y1] = merc(b);
  if (Math.hypot(x1 - x0, y1 - y0) < 1e-8) return null;
  return (Math.atan2(x1 - x0, -(y1 - y0)) * 180) / Math.PI;
}
/** rumo de quem chega ao km h pela rota (no começo, o de quem sai) */
const rumoNaRota = (R, h) => rumoEntre(pontoEm(R, h - 2.5), pontoEm(R, h)) ?? rumoEntre(pontoEm(R, h), pontoEm(R, h + 2.5));

/** área do mapa à mostra (sem a parte coberta pelo painel, gaveta ou cartão) */
function areaVisivel() {
  const m = ctx.mapa(), c = m.map.getContainer(), p = m.pad ?? {};
  return [Math.max(80, c.clientWidth - (p.left ?? 0) - (p.right ?? 0)), Math.max(80, c.clientHeight - (p.top ?? 0) - (p.bottom ?? 0))];
}
/** câmera que mostra todos os pontos na área à mostra */
function enquadrar(pts, { pitch = 0, bearing = 0, maxZoom = 12, minZoom = 3 } = {}) {
  if (!ctx.mapa() || !pts.length) return null;
  const [W, H] = areaVisivel(), b = (bearing * Math.PI) / 180, cs = Math.cos(b), sn = Math.sin(b);
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const p of pts) {
    const [x, y] = merc(p), sx = x * cs + y * sn, sy = -x * sn + y * cs;
    if (sx < x0) x0 = sx; if (sx > x1) x1 = sx; if (sy < y0) y0 = sy; if (sy > y1) y1 = sy;
  }
  // margens: à direita mais (os nomes dos marcadores abrem para a direita)
  const w = Math.max(60, W - 96), h = Math.max(60, H - 56);
  let z = Math.log2(Math.min(w / (Math.max(x1 - x0, 1e-9) * 512), h / (Math.max(y1 - y0, 1e-9) * 512)));
  z = clamp(z - pitch / 90, minZoom, maxZoom);   // inclinada, a parte de cima fica mais longe: afasta um pouco
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  return { c: geo([cx * cs - cy * sn, cx * sn + cy * cs]), z, b: bearing, p: pitch };
}
function camAtual() {
  const m = ctx.mapa().map;
  return { c: m.getCenter().toArray(), z: m.getZoom(), b: m.getBearing(), p: m.getPitch() };
}
/**
 * Voo de A até B como o flyTo do MapLibre (van Wijk e Nuij: afasta no meio do caminho para a velocidade parecer
 * constante), mas calculado aqui para andar junto com o relógio da cena (pausa, anterior/seguinte, linha desenhada).
 */
function caminho(A, B) {
  const [W, H] = areaVisivel(), m0 = merc(A.c), m1 = merc(B.c), ws = 512 * 2 ** A.z;
  const u1 = Math.hypot((m1[0] - m0[0]) * ws, (m1[1] - m0[1]) * ws), rho = 1.42, rho2 = rho * rho;
  const w0 = Math.max(W, H), w1 = w0 / 2 ** (B.z - A.z);
  let wf, uf, S;
  if (u1 < 1e-6) {
    S = Math.abs(Math.log(w1 / w0)) / rho;
    const k = w1 < w0 ? -1 : 1;
    wf = (s) => Math.exp(k * rho * s); uf = () => 0;
  } else {
    const r = (i) => { const b = (w1 * w1 - w0 * w0 + (i ? -1 : 1) * rho2 * rho2 * u1 * u1) / (2 * (i ? w1 : w0) * rho2 * u1); return Math.log(Math.sqrt(b * b + 1) - b); };
    const r0 = r(0);
    S = (r(1) - r0) / rho;
    wf = (s) => Math.cosh(r0) / Math.cosh(r0 + rho * s);
    uf = (s) => (w0 * ((Math.cosh(r0) * Math.tanh(r0 + rho * s) - Math.sinh(r0)) / rho2)) / u1;
  }
  const db = difAng(A.b, B.b);
  return (k) => {
    if (k >= 1) return B;
    const s = k * S, f = uf(s);
    let z = A.z + Math.log2(1 / wf(s)), c = geo([m0[0] + (m1[0] - m0[0]) * f, m0[1] + (m1[1] - m0[1]) * f]);
    if (!Number.isFinite(z) || !c.every(Number.isFinite)) { z = A.z + (B.z - A.z) * k; c = [A.c[0] + (B.c[0] - A.c[0]) * k, A.c[1] + (B.c[1] - A.c[1]) * k]; }
    return { c, z, b: A.b + db * k, p: A.p + (B.p - A.p) * k };
  };
}

// ---------- dados de apoio ----------
const grau = (v) => `${U.nf(Math.round(v))} °C`.replace('-', '−');
/** clima normal da noite no pernoite (data/clima.json); onde: 'no pernoite' na abertura, nada no cartão do pernoite */
function climaNoite(id, iso, onde = '') {
  const v = clima?.lugares?.[id]?.normais?.[iso.slice(5)];
  if (v?.min == null) return null;
  const neve = v.neve > 0 ? `; neve em ${U.nf(v.neve)}% dos dias` : '';
  const dia = v.max == null ? '' : `máx. ~${grau(v.max)} de dia `;
  return F('termo', `~${grau(v.min)} à noite`, `${onde ? `${onde}, ` : '· '}${dia}(normal da época, ${clima.anos?.join('–') ?? 'ERA5'}${neve})`);
}
function perfilDe(id) {
  const p = perfis?.[id] ?? perfis?.rotas?.[id] ?? perfis?.perfis?.[id] ?? perfis?.itens?.[id];
  const d = p?.d ?? p?.km, z = p?.z ?? p?.alt;
  return Array.isArray(d) && Array.isArray(z) && d.length > 1 && d.length === z.length ? { d, z } : null;
}
/** altitude no km h da linha (o perfil tem o próprio km: ajusta pela proporção) */
function altitudeEm(R, h) {
  const p = perfilDe(R.id);
  if (!p) return null;
  const x = clamp((h * p.d.at(-1)) / R.total, p.d[0], p.d.at(-1));
  let i = 0;
  while (i < p.d.length - 2 && p.d[i + 1] < x) i++;
  const s = p.d[i + 1] - p.d[i], t = s ? (x - p.d[i]) / s : 0;
  const z = p.z[i] + (p.z[i + 1] - p.z[i]) * t;
  return Number.isFinite(z) ? z : null;
}
const fatoAltitude = (z) => (z == null ? null : F('alt', sinal(`~${U.nf(Math.round(z / 10) * 10)} m`), 'de altitude (estimada)'));
/** sinal de menos tipográfico nos números negativos (Badwater fica abaixo do nível do mar) */
const sinal = (s) => s.replace(/(^|[\s~])-(?=\d)/g, '$1−');
/** hora de sair para devolver o veículo no prazo (arredondada para baixo, de 5 em 5 min) */
const saidaAte = (d, T) => U.fmtHora(Math.floor((d.prazo - T.estrada - 0.5) * 12) / 12);
const minusc = (s) => (s ? s[0].toLowerCase() + s.slice(1) : '');
function alertaDoDia(n) {
  const opc = new Set(ctx.dados.roteiro.opcionais.flatMap((o) => o.alertas ?? []));
  return ctx.dados.alertas.itens.filter((a) => !a.geral && !opc.has(a.id) && a.dias?.includes(n) && G_ALERTA[a.gravidade] != null)
    .sort((x, y) => G_ALERTA[x.gravidade] - G_ALERTA[y.gravidade])[0] ?? null;
}
/** fato do cartão: ícone, parte em destaque, resto do texto e gravidade (alerta) */
function F(ic, b, t, g) { return { ic, b: b ?? '', t: t ?? '', g: g ?? '' }; }
const temFoto = (f) => !!(f?.foto || f?.mini);
const fotoDe = (chave) => { const f = ctx.foto(chave); return temFoto(f) ? f : null; };
const textoDe = (chave) => ctx.foto(chave)?.texto ?? '';
const queroSet = () => ctx.quero();
function metaOp(o) {
  const t = U.TIPO_OPC[o.tipo] ?? U.TIPO_OPC.atracao;
  return [t.nome, o.duracao_h ? `~${U.fmtH(o.duracao_h)}` : '',
    o.distancia_km ? `${U.nf(o.distancia_km, o.distancia_km < 10 ? 1 : 0)} km${o.desnivel_m ? `, +${U.nf(o.desnivel_m)} m` : ''}` : '',
    DIF[o.dificuldade] ?? ''].filter(Boolean).join(' · ');
}

// ---------- cenas de um dia ----------
function cenasDoDia(d) {
  const n = d.n, a = ctx.ativo(d), P = ctx.rotaAtiva(d).properties, R = medir(P.id), cor = U.corDia(n);
  const shuttle = P.tipo === 'shuttle', T = ctx.tempoDoDia(d), itens = ctx.listaParadas(d);
  const nome = ctx.nomePonto, notas = ctx.dados.roteiro.notasPontos ?? {}, quero = queroSet();
  const lugares = itens.map((it) => ctx.llPonto(it.id));
  const pn = a.pernoite;

  // opcionais que merecem aparecer: os marcados e os imperdíveis (perto de um lugar do dia → no cartão dele)
  const perto = itens.map(() => []), longe = [];
  for (const o of ctx.opsDoDia(n)) {
    const q = quero.has(o.id);
    if (!q && (o.prioridade !== 'imperdivel' || o.estado === 'fechado')) continue;
    let j = 0, dm = Infinity;
    lugares.forEach((ll, i) => { const x = distKm(ll, [o.lon, o.lat]); if (x < dm) { dm = x; j = i; } });
    if (dm <= PERTO_KM) perto[j].push(o);
    else if (o.dia === n || q) longe.push({ o, q, ...projetar(R, [o.lon, o.lat]) });
  }
  const ordemOp = (x, y) => quero.has(y.id) - quero.has(x.id) || (x.tipo === 'pratico') - (y.tipo === 'pratico');
  perto.forEach((l) => l.sort(ordemOp));
  longe.sort((x, y) => ordemOp(x.o, y.o));
  const extras = longe.slice(0, MAX_LONGE).sort((x, y) => x.ordem - y.ordem);
  const fotoComOp = (chave, ops) => fotoDe(chave) ?? ops.map((o) => fotoDe('o:' + o.id)).find(Boolean) ?? null;

  const cenas = [];
  // 1. o dia: o trecho inteiro, km, tempo, sol, clima da noite e o alerta mais importante
  const fatos = [shuttle ? F('onibus', U.fmtKm(P.km), `de shuttle (~${U.fmtH(P.horas)} só de ida); o motorhome fica no camping`)
    : F('km', U.fmtKm(P.km), `~${U.fmtH(T.estrada)} de motorhome (${U.fmtH(P.horas)} de carro; estimativa)`)];
  if (d.prazo) fatos.push(F('relogio', `Devolução até ${d.prazo}h:`, `com ~${U.fmtH(T.estrada)} de estrada, saia até ~${saidaAte(d, T)}`));
  fatos.push(F('sol', 'Sol:', T.mudaFuso ? `nasce ${U.fmtHora(T.nasce)} (${T.ini.nome}) · põe ${U.fmtHora(T.poe)} (${T.fim.nome}), hora local`
    : `nasce ${U.fmtHora(T.nasce)} · põe ${U.fmtHora(T.poe)} (${U.fmtH(T.luz)} de luz${d.livre_desde > T.nasce ? ` depois da retirada, às ${d.livre_desde}h` : ''})`));
  if (T.n) fatos.push(F('estrela', `${T.n} opciona${T.n > 1 ? 'is marcados' : 'l marcado'}`, `(+${U.fmtH(T.opc)})`));
  const cn = climaNoite(pn.ponto, d.data, 'no pernoite');
  if (cn) fatos.push(cn);
  const pf = perfilDe(R.id);
  if (pf) fatos.push(F('alt', sinal(`${U.nf(Math.round(Math.min(...pf.z)))} a ${U.nf(Math.round(Math.max(...pf.z)))} m`), 'de altitude no caminho'));
  if (a.b) fatos.push(F('aviso', 'Plano B ·', a.b.titulo, 'media'));
  const al = alertaDoDia(n);
  if (al) fatos.push(F('aviso', `${NOME_G[al.gravidade]} ·`, al.titulo, al.gravidade));
  const mosaico = [];
  itens.forEach((it, i) => {
    if (it.papel === 'inicio') return;
    for (const f of [fotoDe('p:' + it.id), ...perto[i].map((o) => fotoDe('o:' + o.id))]) if (f && !mosaico.some((x) => x.foto === f.foto)) mosaico.push(f);
  });
  cenas.push({ tipo: 'abertura', rot: 'O dia', cor, rota: R.id, h0: 0, h1: 0, ponta: false,
    titulo: `${a.de} → ${a.para}`, texto: a.programacao, nota: '', fatos, ops: [], fotos: mosaico.slice(0, 3),
    selo: { b: `Dia ${n}`, s: `${U.fmtData(d.data, d.semana)} · ${d.estado}` },
    camera: () => enquadrar([...R.co, ...lugares], { pitch: 30, maxZoom: shuttle ? 12.5 : 11.5 }), giro: 5, aproxima: 0.15 });

  // 2. a saída
  const ini = itens[0], fIni = fotoComOp('p:' + ini.id, perto[0]);
  const fatosIni = [F('sol', 'Nascer do sol:', U.fmtHora(T.nasce))];
  if (d.livre_desde) fatosIni.push(F('relogio', `A partir das ${d.livre_desde}h:`, 'retirada do veículo à tarde'));
  if (d.prazo) fatosIni.push(F('relogio', `Saia até ~${saidaAte(d, T)}`, `para devolver até ${d.prazo}h`));
  if (!ini.fora) fatosIni.push(fatoAltitude(altitudeEm(R, 0)));
  const txtIni = textoDe('p:' + ini.id);
  if (txtIni && notas[ini.id]) fatosIni.push(F('pin', null, notas[ini.id]));
  cenas.push({ tipo: 'saida', rot: 'Saída', cor, rota: R.id, h0: 0, h1: 0, ponta: !ini.fora,
    titulo: nome(ini.id), texto: txtIni || notas[ini.id] || '', nota: a.notas ? `Para saber: ${a.notas}` : '', fatos: fatosIni.filter(Boolean),
    ops: perto[0], fotos: fIni ? [fIni] : [],
    camera: () => ({ c: lugares[0], z: 12, b: ini.fora ? rumoEntre(lugares[0], R.co[0]) : rumoNaRota(R, 0), p: PITCH }), giro: 12, aproxima: 0.2 });

  // 3. as paradas (e os opcionais longe delas, na ordem do caminho); 4. o pernoite
  let h = 0, ordem = 0, iPar = 0, acum = 0, anterior = nome(ini.id);
  const nPar = itens.filter((it) => it.papel === 'parada').length;
  const poeExtras = (ate) => {
    while (extras.length && extras[0].ordem <= ate) {
      const x = extras.shift(), o = x.o, q = quero.has(o.id), f = fotoDe('o:' + o.id), t = U.TIPO_OPC[o.tipo] ?? U.TIPO_OPC.atracao;
      const h1 = Math.max(h, x.km), fs = [F('relogio', null, metaOp(o))];
      if (o.acesso) fs.push(F('pin', 'Acesso:', o.acesso));
      if (o.custo) fs.push(F('custo', 'Custo:', o.custo));
      if (o.reserva) fs.push(F('cal', 'Reserva:', o.reserva));
      if (x.dist >= 1) fs.push(F('pin', null, `a ~${U.nf(x.dist, x.dist < 10 ? 1 : 0)} km da rota do dia`));
      cenas.push({ tipo: 'opcional', rot: `Opcional · ${t.nome}${q ? ' · ★ marcado' : ' · imperdível'}`, cor, rota: R.id, h0: h, h1, ponta: true,
        titulo: o.nome, texto: textoDe('o:' + o.id) || o.resumo, nota: o.estado !== 'ok' && o.situacao ? o.situacao : o.dica || '', fatos: fs, ops: [],
        fotos: f ? [f] : [], camera: () => ({ c: [o.lon, o.lat], z: 12.5, b: rumoNaRota(R, h1), p: PITCH }), giro: 12, aproxima: 0.25 });
      h = h1; ordem = Math.max(ordem, x.ordem);
    }
  };
  itens.forEach((it, i) => {
    if (it.papel === 'inicio') return;
    const ll = lugares[i], pern = it.papel === 'pernoite';
    let alvo = null;
    if (pern) poeExtras(Infinity);
    else if (!it.fora) { alvo = it.id === P.pontos[0] ? { km: 0, ordem: 0 } : projetar(R, ll, ordem); poeExtras(alvo.ordem); }
    const h0 = h, h1 = pern ? R.total : alvo ? Math.max(h, alvo.km) : h;
    const ops = perto[i], f = fotoComOp('p:' + it.id, ops), fs = [];
    if (it.km != null) {
      acum += it.km;
      fs.push(shuttle ? F('onibus', `+${U.fmtKm(it.km)}`, `de shuttle desde ${anterior}`)
        : F('km', `+${U.fmtKm(it.km)} · ~${U.fmtH(ctx.horasMotorhome(it.min / 60))}`, `de motorhome desde ${anterior}`));
      if (!pern && acum < P.km - 0.5) fs.push(F('pin', null, `${U.fmtKm(acum)} de ${U.fmtKm(P.km)} do dia`));
    }
    const texto = textoDe('p:' + it.id), nota = notas[it.id] ?? '';
    if (!it.fora) fs.push(fatoAltitude(altitudeEm(R, h1)));
    else if (!pern && !/fora d[ao] (rota|linha)/i.test(nota)) fs.push(F('pin', null, shuttle ? 'fora da linha do shuttle' : 'fora da rota do veículo'));
    let cena;
    if (pern) {
      fs.unshift(F('cama', pn.tipo, [pn.preco ? `US$ ${pn.preco}/noite` : '', pn.reserva ? `reserva: ${pn.reserva}` : ''].filter(Boolean).map((x) => `· ${x}`).join(' ')));
      fs.push(F('sol', 'Pôr do sol:', U.fmtHora(T.poe)));
      const c2 = climaNoite(pn.ponto, d.data);
      if (c2) fs.push(c2);
      if (pn.alternativa) fs.push(F('pin', 'Alternativa:', pn.alternativa));
      const prox = ctx.diaPorN.get(n + 1);
      if (prox) { const A = ctx.ativo(prox); fs.push(F('seguir', 'Amanhã:', `dia ${prox.n}, ${A.de} → ${A.para} (${U.fmtKm(ctx.rotaAtiva(prox).properties.km)})`)); }
      else fs.push(F('seguir', 'Amanhã:', minusc(ctx.dados.roteiro.fim.texto)));
      cena = { tipo: 'pernoite', rot: 'Pernoite', titulo: pn.nome, texto: texto || nota, nota: [pn.notas, texto ? nota : ''].filter(Boolean).join(' ') };
    } else {
      iPar++;
      cena = { tipo: 'parada', rot: `Parada ${iPar} de ${nPar}`, titulo: nome(it.id), texto: texto || nota, nota: texto ? nota : '' };
    }
    const b = it.fora ? rumoEntre(pontoEm(R, h0), ll) : rumoNaRota(R, h1);
    cenas.push({ ...cena, cor, rota: R.id, h0, h1, ponta: !it.fora || pern, fatos: fs.filter(Boolean), ops, fotos: f ? [f] : [],
      camera: () => ({ c: ll, z: shuttle ? 13 : it.fora ? 12.5 : 12, b, p: PITCH }), giro: 12, aproxima: 0.25 });
    h = h1;
    if (alvo) { ordem = alvo.ordem; anterior = nome(it.id); }
  });
  return cenas;
}

// ---------- a viagem em 2 minutos ----------
function cenasDaViagem() {
  const dias = ctx.dias, rt = ctx.dados.roteiro, quero = queroSet();
  const ativos = dias.map((d) => ({ d, a: ctx.ativo(d), P: ctx.rotaAtiva(d).properties }));
  let km = 0, h = 0;
  for (const { P } of ativos) if (P.tipo !== 'shuttle') { km += P.km; h += P.horas; }
  const cantos = (() => {
    let a = Infinity, b = Infinity, c = -Infinity, e = -Infinity;
    for (const { P } of ativos) for (const [x, y] of medir(P.id).co) { if (x < a) a = x; if (y < b) b = y; if (x > c) c = x; if (y > e) e = y; }
    return [[a, b], [c, e], [a, e], [c, b]];
  })();
  const noitesHotel = ativos.filter(({ a }) => a.pernoite.tipo === 'Hotel').length;
  const estados = [...new Set(dias.flatMap((d) => d.estado.split('/')))];
  const destinos = [...new Set(ativos.map(({ a }) => a.para))];
  const listaPt = (l) => (l.length > 1 ? `${l.slice(0, -1).join(', ')} e ${l.at(-1)}` : l.join(''));
  const fatosTotais = [
    F('km', `${U.nf(Math.round(km / 10) * 10)} km`, `~${Math.round(ctx.horasMotorhome(h))} h ao volante (motorhome, estimativa)`),
    F('cama', `${dias.length - noitesHotel} noites no motorhome`, noitesHotel ? `e ${noitesHotel} no hotel` : ''),
    F('pin', null, estados.join(' · ')),
  ];
  const planosB = ativos.filter(({ a }) => a.b).map(({ d, a }) => `dia ${d.n} (${a.b.titulo})`);
  const cenas = [];
  const todo = () => enquadrar(cantos, { pitch: 20, maxZoom: 8 });
  const [, m0, d0] = dias[0].data.split('-'), [yf, mf, df] = rt.fim.data.split('-');
  cenas.push({ tipo: 'viagem-abertura', rot: 'A viagem', cor: 'var(--accent)', titulo: rt.titulo, h0: null, h1: null, feito: 0, ponta: false,
    texto: `De ${d0}/${m0} a ${df}/${mf}/${yf}: ${listaPt(destinos)}.`, nota: planosB.length ? `Pelo plano B: ${planosB.join('; ')}.` : '',
    fatos: fatosTotais, ops: [], fotos: [], selo: { b: 'Costa Oeste', s: `${dias.length} dias de motorhome` }, camera: todo, giro: 3, aproxima: 0.1 });
  const usadas = new Set();
  ativos.forEach(({ d, a, P }, i) => {
    const R = medir(P.id), T = ctx.tempoDoDia(d), shuttle = P.tipo === 'shuttle';
    const lugares = [...a.paradas, a.pernoite.ponto].filter((id) => id !== ctx.inicioDe(d));
    let f = null;
    for (const id of lugares) { const x = fotoDe('p:' + id); if (x && !usadas.has(x.foto)) { f = x; break; } }
    if (!f) f = ctx.opsDoDia(d.n).filter((o) => o.dia === d.n && (quero.has(o.id) || o.prioridade === 'imperdivel')).map((o) => fotoDe('o:' + o.id)).find((x) => x && !usadas.has(x.foto)) ?? null;
    if (f) usadas.add(f.foto);
    const fs = [shuttle ? F('onibus', U.fmtKm(P.km), 'de shuttle; o motorhome fica no camping') : F('km', U.fmtKm(P.km), `~${U.fmtH(T.estrada)} de motorhome`),
      F('cama', null, a.pernoite.nome), F('sol', 'Sol:', `${U.fmtHora(T.nasce)}–${U.fmtHora(T.poe)}${T.mudaFuso ? ' (hora local; o fuso muda no caminho)' : ''}`)];
    if (T.n) fs.push(F('estrela', `${T.n} opciona${T.n > 1 ? 'is marcados' : 'l marcado'}`));
    if (a.b) fs.push(F('aviso', 'Plano B ·', a.b.titulo, 'media'));
    const al = alertaDoDia(d.n);
    if (al?.gravidade === 'alta') fs.push(F('aviso', `${NOME_G.alta} ·`, al.titulo, 'alta'));
    const pts = [...R.co, ...ctx.listaParadas(d).map((it) => ctx.llPonto(it.id))];
    cenas.push({ tipo: 'viagem-dia', n: d.n, rot: `Dia ${d.n} · ${U.fmtData(d.data, d.semana)}`, cor: U.corDia(d.n),
      titulo: `${a.de} → ${a.para}`, texto: a.programacao, nota: '', fatos: fs, ops: [], fotos: f ? [f] : [],
      rota: R.id, h0: 0, h1: R.total, feito: i, ponta: true, selo: { b: `Dia ${d.n}`, s: `${U.fmtData(d.data, d.semana)} · ${d.estado}` },
      camera: () => enquadrar(pts, { pitch: 35, maxZoom: shuttle ? 12 : 10.5 }), giro: 4, aproxima: 0.12 });
  });
  const sem = SEMANA[new Date(Date.UTC(+yf, +mf - 1, +df)).getUTCDay()];
  cenas.push({ tipo: 'viagem-fim', rot: 'Volta', cor: 'var(--accent)', titulo: `Volta · ${sem} ${df}/${mf}`, h0: null, h1: null, feito: dias.length, ponta: false,
    texto: rt.fim.texto, nota: 'Distâncias pela estrada (OSRM/OpenStreetMap); tempos de motorhome estimados. Confira os alertas na véspera de cada trecho.',
    fatos: fatosTotais, ops: [], fotos: [], camera: todo, giro: -3, aproxima: 0.1 });
  return cenas;
}

/** duração de cada cena pelo tanto de texto (dá tempo de ler), sem passar do alvo da demonstração */
function ajustarTempos(cenas, alvo, minimo) {
  const palavras = (sc) => [sc.titulo, sc.texto, sc.nota, ...sc.fatos.map((f) => `${f.b} ${f.t}`), ...sc.ops.map((o) => o.nome)].join(' ').split(/\s+/).filter(Boolean).length;
  for (const sc of cenas) sc.dur = Math.max(TEMPO[sc.tipo][0], Math.min(11, 2.6 + palavras(sc) * 0.1));
  const total = cenas.reduce((s, sc) => s + sc.dur, 0);
  if (total > alvo) for (const sc of cenas) sc.dur = Math.max(minimo, (sc.dur * alvo) / total);
  for (const sc of cenas) sc.tv = Math.min(TEMPO[sc.tipo][2], sc.dur * TEMPO[sc.tipo][1]);
}

// ---------- cartão ----------
function montarCartao() {
  cartao = document.createElement('section');
  cartao.id = 'demo-cartao';
  cartao.className = 'sheet';
  cartao.hidden = true;
  cartao.setAttribute('aria-label', 'Demonstração');
  cartao.innerHTML = `
    <div class="demo-in">
      <figure class="demo-ft" hidden></figure>
      <div class="demo-corpo">
        <div class="demo-top">
          <span class="eyebrow" data-demo-el="passo"></span>
          <div class="demo-ctl" role="group" aria-label="Controles da demonstração">
            <button type="button" data-demo-ctl="ant" aria-label="Cena anterior" title="Cena anterior (←)">${ICO.ant}</button>
            <button type="button" data-demo-ctl="pausa" aria-label="Pausar" title="Pausar (espaço)">${ICO.pausa}</button>
            <button type="button" data-demo-ctl="prox" aria-label="Cena seguinte" title="Cena seguinte (→)">${ICO.prox}</button>
            <button type="button" data-demo-ctl="fechar" aria-label="Fechar a demonstração" title="Fechar (Esc)">${ICO.x}</button>
          </div>
        </div>
        <div class="demo-txt" data-demo-el="txt" tabindex="0" role="group" aria-labelledby="demo-tit">
          <h2 id="demo-tit" data-demo-el="tit"></h2>
          <p class="demo-texto" data-demo-el="texto"></p>
          <ul class="demo-fatos" data-demo-el="fatos"></ul>
          <ul class="demo-ops" data-demo-el="ops" aria-label="Opcionais por perto" hidden></ul>
          <p class="demo-nota" data-demo-el="nota"></p>
        </div>
      </div>
    </div>
    <div class="demo-barra" data-demo-el="barra" aria-hidden="true"></div>`;
  document.body.append(cartao);
  for (const x of cartao.querySelectorAll('[data-demo-el]')) el[x.dataset.demoEl] = x;
  el.ft = cartao.querySelector('.demo-ft');
  // a pessoa rolou ou tocou no texto: a rolagem automática da cena para
  for (const ev of ['wheel', 'touchstart', 'pointerdown', 'keydown']) el.txt.addEventListener(ev, () => { if (demo) demo.rolouMao = true; }, { passive: true });
  el.pausa = cartao.querySelector('[data-demo-ctl="pausa"]');
  el.ant = cartao.querySelector('[data-demo-ctl="ant"]');
  cartao.addEventListener('click', (e) => {
    const c = e.target.closest('[data-demo-ctl]')?.dataset.demoCtl;
    if (!c || !demo) return;
    if (c === 'ant') anterior();
    else if (c === 'prox') proxima();
    else if (c === 'pausa') alternarPausa();
    else if (c === 'fechar') encerrar();
  });
  selo = document.createElement('div');
  selo.id = 'demo-selo';
  selo.setAttribute('aria-hidden', 'true');
  document.body.append(selo);
}

/** quantas fotos cabem: no cartão estreito (celular, tablet com o painel aberto) só uma, para o crédito caber inteiro */
const fotosMax = () => (cartao.offsetWidth && cartao.offsetWidth <= 560 ? 1 : 3);
function htmlFotos(fotos) {
  const fs = navigator.onLine ? fotos.filter(temFoto).slice(0, fotosMax()) : [];   // sem sinal: só o texto
  if (!fs.length) return '';
  const imgs = fs.map((f, i) => {
    const grande = fs.length === 1 || i === 0;
    const srcset = grande && f.mini && f.foto ? ` srcset="${U.esc(f.mini)} 500w, ${U.esc(f.foto)} 960w" sizes="(max-width: 700px) 94vw, 360px"` : '';
    return `<img src="${U.esc(f.mini || f.foto)}"${srcset} alt="${U.esc(f.alt || f.titulo || '')}" decoding="async">`;
  }).join('');
  const creditos = fs.filter((f) => f.credito).map((f) => ({ f, t: `${f.credito}${f.licenca && !f.credito.includes(f.licenca) ? `, ${f.licenca}` : ''}` }));
  const cred = creditos.map(({ f, t }) => (f.pagina ? `<a href="${U.esc(f.pagina)}" target="_blank" rel="noopener">${U.esc(t)}</a>` : U.esc(t))).join(' · ');
  const rot = `${fs.length > 1 ? 'Fotos' : 'Foto'}: `;
  // crédito inteiro também no title (se um nome muito longo passar das linhas do cartão)
  return `<div class="demo-fotos is-${fs.length}">${imgs}</div>${cred ? `<figcaption title="${U.esc(rot + creditos.map((x) => x.t).join(' · '))}">${rot}${cred}</figcaption>` : ''}`;
}
function htmlFato(f) {
  return `<li${f.g ? ` class="is-${f.g}"` : ''}><i aria-hidden="true">${ICO[f.ic] ?? U.ICONE[f.ic] ?? ''}</i><span>${f.b ? `<b>${U.esc(f.b)}</b>${f.t ? ' ' : ''}` : ''}${U.esc(f.t)}</span></li>`;
}
function htmlOp(o) {
  const t = U.TIPO_OPC[o.tipo] ?? U.TIPO_OPC.atracao, f = navigator.onLine ? fotoDe('o:' + o.id) : null, q = queroSet().has(o.id);
  // a miniatura fica por cima do ícone do tipo: se não carregar (sem sinal), sai e o ícone aparece
  const im = f ? `<img src="${U.esc(f.mini || f.foto)}" alt="" loading="lazy" decoding="async" onerror="this.remove()">` : '';
  return `<li style="--t:${q ? 'var(--gold)' : t.cor}"><span class="demo-op-im" aria-hidden="true">${t.icone}${im}</span>
    <span><b>${q ? '★ ' : ''}${U.esc(o.nome)}</b><small>${U.esc(metaOp(o))}${q ? ' · marcado' : o.prioridade === 'imperdivel' ? ' · imperdível' : ''}</small></span></li>`;
}

function desenharCartao(sc, k) {
  const D = demo;
  cartao.style.setProperty('--c', sc.cor);
  cartao.setAttribute('aria-label', D.tipo === 'dia' ? `Demonstração do dia ${D.n}` : 'Demonstração da viagem');
  el.passo.innerHTML = `<span class="day-dot"></span>${U.esc(sc.passo)}`;
  const [de, para] = sc.titulo.split(' → ');
  el.tit.innerHTML = para != null ? `${U.esc(de)} <span class="arr">→</span> ${U.esc(para)}` : U.esc(sc.titulo);
  el.texto.textContent = sc.texto ?? '';
  el.fatos.innerHTML = sc.fatos.map(htmlFato).join('');
  el.ops.innerHTML = sc.ops.slice(0, 3).map(htmlOp).join('');
  el.ops.hidden = !sc.ops.length;
  el.nota.textContent = sc.nota ?? '';
  el.txt.scrollTop = 0;
  // fotos: aparecem quando carregam; se nenhuma carregar (sem sinal), o cartão fica só com o texto
  const fh = htmlFotos(sc.fotos);
  el.ft.innerHTML = fh;
  el.ft.hidden = !fh;
  cartao.classList.toggle('is-sem-foto', !fh);
  const imgs = [...el.ft.querySelectorAll('img')];
  const conferir = () => {
    if (imgs.length && imgs.every((im) => im.classList.contains('is-sem'))) { el.ft.hidden = true; cartao.classList.add('is-sem-foto'); demo && (demo.margemSuja = true); }
  };
  for (const im of imgs) {
    const ok = () => im.classList.add('is-ok'), ruim = () => { im.classList.add('is-sem'); conferir(); };
    if (im.complete) { if (im.naturalWidth) ok(); else ruim(); } else { im.addEventListener('load', ok, { once: true }); im.addEventListener('error', ruim, { once: true }); }
  }
  const corpo = cartao.querySelector('.demo-corpo');
  if (!U.reduzMovimento()) { corpo.classList.remove('demo-entra'); void corpo.offsetWidth; corpo.classList.add('demo-entra'); }
  // na primeira cena "anterior" fica desligado; se o foco estava nele, passa para o pausar (não se perde)
  if (k === 0 && document.activeElement === el.ant) el.pausa.focus({ preventScroll: true });
  el.ant.disabled = k === 0;
  D.margemSuja = true;
  // barra: a cena atual em andamento, as anteriores cheias
  [...el.barra.children].forEach((s, i) => { s.classList.toggle('is-on', i === k); s.firstChild.style.width = i < k ? '100%' : '0%'; });
}
function montarBarra() {
  el.barra.innerHTML = demo.cenas.map((sc) => `<span style="flex-grow:${sc.dur.toFixed(2)};--c:${sc.cor}"><i></i></span>`).join('');
}
function botaoPausa() {
  const p = demo?.pausado;
  el.pausa.innerHTML = p ? ICO.play : ICO.pausa;
  el.pausa.setAttribute('aria-label', p ? 'Continuar' : 'Pausar');
  el.pausa.title = p ? 'Continuar (espaço)' : 'Pausar (espaço)';
  cartao.classList.toggle('is-pausado', !!p);
}
/** fotos da próxima cena pedidas adiantado (com o mesmo srcset, o navegador escolhe o mesmo arquivo) */
function precarregar(sc) {
  if (!sc || !navigator.onLine) return;
  const fs = sc.fotos.filter(temFoto).slice(0, fotosMax());
  fs.forEach((f, i) => {
    const im = new Image();
    im.decoding = 'async';
    if ((fs.length === 1 || i === 0) && f.mini && f.foto) { im.sizes = '(max-width: 700px) 94vw, 360px'; im.srcset = `${f.mini} 500w, ${f.foto} 960w`; }
    im.src = f.mini || f.foto;
  });
}

// ---------- camadas no mapa ----------
const vazio = () => ({ type: 'FeatureCollection', features: [] });
function garantirCamadas() {
  const m = ctx.mapa()?.map;
  if (!m || !demo || m.getLayer('demo-ponta')) return !!m;
  try {
    // a troca de tema/fundo (setStyle) apaga o que é nosso: recria por cima das linhas do app
    for (const id of ['demo-ponta', 'demo-linha', 'demo-linha-c', 'demo-feito', 'demo-feito-c']) if (m.getLayer(id)) m.removeLayer(id);
    for (const id of ['demo-linha', 'demo-feito']) if (m.getSource(id)) m.removeSource(id);
    const M = ctx.mapa(), contorno = M.st?.fundo !== 'satelite' && M.escuroReal ? '#0b100e' : '#ffffff';
    const larg = (k) => ['interpolate', ['linear'], ['zoom'], 4, 3 * k, 8, 4.5 * k, 12, 6.5 * k, 16, 9 * k];
    const camadas = [];
    for (const f of ['demo-feito', 'demo-linha']) {
      camadas.push({ id: `${f}-c`, type: 'line', source: f, filter: ['==', ['geometry-type'], 'LineString'], layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': contorno, 'line-width': ['interpolate', ['linear'], ['zoom'], 4, 6, 8, 8, 12, 11, 16, 15], 'line-opacity': 0.9 } });
      camadas.push({ id: f, type: 'line', source: f, filter: ['==', ['geometry-type'], 'LineString'], layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': ['get', 'cor'], 'line-width': larg(1) } });
    }
    camadas.push({ id: 'demo-ponta', type: 'circle', source: 'demo-linha', filter: ['==', ['geometry-type'], 'Point'],
      paint: { 'circle-color': ['get', 'cor'], 'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 5, 12, 8], 'circle-stroke-color': contorno, 'circle-stroke-width': 3 } });
    m.addSource('demo-feito', { type: 'geojson', data: vazio() });
    m.addSource('demo-linha', { type: 'geojson', data: vazio() });
    const L = m.getStyle().layers, i = L.findIndex((l) => l.id === 'r-toque'), antes = i >= 0 ? L[i + 1]?.id : undefined;
    for (const c of camadas) m.addLayer(c, antes);
    // a rota do app fica apagada por baixo (é o "plano"); a desenhada por cima é o caminho feito
    demo.orig = {};
    for (const id of APAGAR) {
      if (!m.getLayer(id)) continue;
      const o = m.getPaintProperty(id, 'line-opacity');
      demo.orig[id] = o;
      m.setPaintProperty(id, 'line-opacity', ['*', 0.35, o ?? 1]);
    }
    demo.cabeca = NaN; demo.feitoK = NaN;   // redesenha
    return true;
  } catch (e) {
    return false;   // estilo ainda carregando: tenta no próximo quadro
  }
}
function limparMapa(D) {
  const m = ctx.mapa()?.map;
  if (!m) return;
  try {
    for (const id of ['demo-ponta', 'demo-linha', 'demo-linha-c', 'demo-feito', 'demo-feito-c']) if (m.getLayer(id)) m.removeLayer(id);
    for (const id of ['demo-linha', 'demo-feito']) if (m.getSource(id)) m.removeSource(id);
    for (const [id, o] of Object.entries(D.orig ?? {})) if (m.getLayer(id)) m.setPaintProperty(id, 'line-opacity', o);
  } catch (e) { console.warn('demo (mapa):', e); }
}
/** linha do dia até o km h, com a ponta; e, na viagem, os dias já feitos */
function desenharLinha(sc, t) {
  const D = demo, m = ctx.mapa()?.map;
  if (!m?.getSource('demo-linha')) return;
  if (sc.feito != null && D.feitoK !== sc.feito) {
    D.feitoK = sc.feito;
    m.getSource('demo-feito').setData({ type: 'FeatureCollection', features: ctx.dias.slice(0, sc.feito).map((d) => (
      { type: 'Feature', properties: { cor: U.corDia(d.n) }, geometry: { type: 'LineString', coordinates: medir(ctx.rotaAtiva(d).properties.id).co } })) });
  }
  const h = sc.h1 == null ? null : U.reduzMovimento() || !sc.tv ? sc.h1 : sc.h0 + (sc.h1 - sc.h0) * suave(clamp(t / sc.tv, 0, 1));
  const chave = `${sc.rota}:${h == null ? '-' : h.toFixed(3)}:${sc.ponta}`;
  if (chave === D.cabeca) return;
  D.cabeca = chave;
  const fs = [];
  if (h != null && sc.rota) {
    const R = medir(sc.rota), co = fatia(R, h), cor = sc.cor;
    if (co.length > 1) fs.push({ type: 'Feature', properties: { cor }, geometry: { type: 'LineString', coordinates: co } });
    if (sc.ponta) fs.push({ type: 'Feature', properties: { cor }, geometry: { type: 'Point', coordinates: pontoEm(R, h) } });
  }
  m.getSource('demo-linha').setData({ type: 'FeatureCollection', features: fs });
}
/** margem de baixo do mapa = altura do cartão (o centro da vista fica na parte à mostra) */
function aplicarMargem() {
  const D = demo, M = ctx.mapa();
  if (!D.margemSuja) return;
  D.margemSuja = false;
  const r = cartao.getBoundingClientRect(), cont = M?.map.getContainer().getBoundingClientRect();
  const fundo = cont ? cont.bottom : innerHeight, baixo = Math.max(0, Math.round(fundo - r.top + 10));
  root.style.setProperty('--demo-h', `${Math.max(0, Math.round(innerHeight - r.top + 4))}px`);
  if (M && Math.abs((M.pad?.bottom ?? 0) - baixo) > 1) M.setPadding({ bottom: baixo }, false);
}
/** câmera da cena no tempo t (depois do voo, um giro lento em volta do lugar) */
function camNaCena(sc, t) {
  const B = sc.cam;
  if (!B) return null;
  const u = U.reduzMovimento() ? 0 : clamp((t - sc.tv) / Math.max(0.1, sc.dur - sc.tv), 0, 1);
  return { ...B, b: B.b + (sc.giro ?? 0) * u, z: B.z + (sc.aproxima ?? 0) * u };
}
function aplicarCamera(sc, t) {
  const D = demo, M = ctx.mapa();
  if (!M || !sc.cam) return;
  const V = D.voo;
  let st;
  if (V && V.dur > 0 && t < V.t0 + V.dur) { V.f ??= caminho(V.A, V.B); st = V.f(suave(clamp((t - V.t0) / V.dur, 0, 1))); }
  else st = camNaCena(sc, t);
  // parada (fim do giro, movimento reduzido): não pede quadro novo ao mapa à toa
  const chave = `${st.c[0].toFixed(7)},${st.c[1].toFixed(7)},${st.z.toFixed(4)},${st.b.toFixed(2)},${st.p.toFixed(2)},${M.pad.bottom}`;
  if (chave === D.ultCam && !M.map.isMoving()) return;
  D.ultCam = chave;
  M.map.jumpTo({ center: st.c, zoom: st.z, bearing: st.b, pitch: st.p, padding: M.pad });
}

// ---------- andamento ----------
function comecar(op) {
  let cenas;
  try { cenas = op.tipo === 'dia' ? cenasDoDia(ctx.diaPorN.get(op.n)) : cenasDaViagem(); } catch (e) { console.warn('demo:', e); ctx.aviso('Não deu para montar a demonstração.'); return; }
  if (!cenas?.length) return;
  const recolhido = demo ? demo.recolhido : ctx.recolhido();   // trocando de demonstração: vale o estado de antes da primeira
  if (demo) encerrar({ troca: true });
  ajustarTempos(cenas, ALVO[op.tipo], op.tipo === 'dia' ? 5.5 : 6);
  cenas.forEach((sc, i) => { sc.passo = op.tipo === 'dia' ? `Dia ${op.n} · ${i + 1} de ${cenas.length} · ${sc.rot}` : `${i + 1} de ${cenas.length}${sc.rot ? ` · ${sc.rot}` : ''}`; });
  demo = { ...op, cenas, k: -1, t: 0, pausado: false, mexeu: false, ultimo: null, recolhido, margemSuja: true, cabeca: '', feitoK: NaN, orig: null };
  document.body.classList.add('demo-on');
  if (ctx.celular()) ctx.setCollapsed(true);   // no celular fica só a barra: o cartão e o mapa dividem a tela
  cartao.hidden = false;
  montarBarra();
  garantirCamadas();
  irPara(0, { inicio: true });
  botaoPausa();
  el.pausa.focus({ preventScroll: true });
  demo.raf = requestAnimationFrame(quadro);
}
function irPara(k, { inicio = false } = {}) {
  const D = demo;
  k = clamp(k, 0, D.cenas.length - 1);
  D.k = k; D.t = 0; D.mexeu = false; D.rolouMao = false;
  const sc = D.cenas[k];
  desenharCartao(sc, k);
  if (ctx.mapa()) {
    aplicarMargem();   // o cartão mudou de tamanho: a área à mostra muda antes de enquadrar
    sc.cam = sc.camera?.() ?? null;
    if (sc.cam) {
      const A = camAtual();
      if (sc.cam.b == null) sc.cam.b = A.b;
      D.voo = { A, B: sc.cam, t0: 0, dur: U.reduzMovimento() ? 0 : sc.tv, f: null };
    }
  }
  precarregar(D.cenas[k + 1]);
  const ajuda = inicio ? `${D.tipo === 'dia' ? `Demonstração do dia ${D.n}` : 'A viagem em 2 minutos'}, ${D.cenas.length} cenas. Espaço pausa, setas trocam de cena, Esc fecha. ` : '';
  ctx.anunciar(`${ajuda}${sc.passo}: ${sc.titulo}.`);
}
function quadro(ts) {
  const D = demo;
  if (!D) return;
  D.raf = requestAnimationFrame(quadro);
  // aparelho lento: até 4 quadros por segundo o relógio anda certo; menos que isso (ou aba escondida), anda mais devagar
  const dt = D.ultimo == null ? 0 : Math.min(0.25, (ts - D.ultimo) / 1000) * _teste.ritmo;
  D.ultimo = ts;
  // a pessoa abriu outro dia (ou um dia, na viagem): a demonstração para onde está
  const aberto = ctx.diaAberto();
  if (D.tipo === 'dia' ? aberto !== D.n : aberto != null) { encerrar({ restaurar: false }); return; }
  if (!D.pausado) {
    D.t += dt;
    if (D.t >= D.cenas[D.k].dur) {
      if (D.k + 1 >= D.cenas.length) { encerrar({ fim: true }); return; }
      irPara(D.k + 1);
    }
  }
  const sc = D.cenas[D.k];
  if (!D.pausado && !D.rolouMao) rolarTexto(sc, D.t);
  if (ctx.mapa()) {
    aplicarMargem();
    if (garantirCamadas()) desenharLinha(sc, D.t);
    if (!D.pausado) aplicarCamera(sc, D.t);
  }
  selo.classList.toggle('is-on', !!sc.selo && D.t < 2.6 && (D.t > 0.15 || D.pausado));
  if (sc.selo && selo.dataset.k !== String(D.k)) {
    selo.dataset.k = String(D.k);
    selo.innerHTML = `<b>${U.esc(sc.selo.b)}</b><span>${U.esc(sc.selo.s)}</span>`;
  }
  const s = el.barra.children[D.k];
  if (s) s.firstChild.style.width = `${Math.min(100, (100 * D.t) / sc.dur).toFixed(1)}%`;
}
/**
 * Texto maior que o cartão (celular, pernoite com muitos fatos): rola sozinho entre 30% e 90% da cena, para dar
 * para ler tudo sem tocar. Com movimento reduzido, pula de página em página em vez de deslizar.
 */
function rolarTexto(sc, t) {
  const tx = el.txt, sobra = tx.scrollHeight - tx.clientHeight;
  if (sobra < 6) return;
  const u = clamp((t - sc.dur * 0.3) / (sc.dur * 0.6), 0, 1);
  let y;
  if (U.reduzMovimento()) { const passos = Math.ceil(sobra / Math.max(40, tx.clientHeight * 0.8)); y = sobra * Math.min(1, Math.floor(u * (passos + 1)) / passos); }
  else y = sobra * suave(u);
  if (Math.abs(tx.scrollTop - y) >= 1) tx.scrollTop = Math.round(y);
}
function pausar() {
  const D = demo;
  if (!D) return;
  D.pausado = true;
  botaoPausa();
  ctx.anunciar('Demonstração pausada.');
}
function continuar() {
  const D = demo;
  if (!D) return;
  D.pausado = false; D.ultimo = null;
  // mexeram no mapa: a câmera volta, voando, para onde a cena estaria
  if (D.mexeu && ctx.mapa()) {
    const sc = D.cenas[D.k], dur = U.reduzMovimento() ? 0 : 1.6;
    if (sc.cam) D.voo = { A: camAtual(), B: camNaCena(sc, D.t + dur), t0: D.t, dur, f: null };
  }
  D.mexeu = false;
  botaoPausa();
}
function alternarPausa() { if (demo?.pausado) continuar(); else pausar(); }
function proxima() {
  if (!demo) return;
  if (demo.k + 1 >= demo.cenas.length) return encerrar({ fim: true });
  if (demo.pausado) continuar();
  irPara(demo.k + 1);
}
function anterior() {
  if (!demo) return;
  if (demo.pausado) continuar();
  irPara(demo.t > 2.5 || demo.k === 0 ? demo.k : demo.k - 1);   // como num tocador: volta ao começo da cena, depois à anterior
}
/**
 * Fecha a demonstração: tira a linha e o cartão, devolve a gaveta/margem do mapa e, se restaurar, volta a câmera ao
 * trecho do dia (ou à viagem toda). restaurar = false quando a pessoa já foi para outro lugar do app; troca = outra
 * demonstração começa em seguida (o cartão, a gaveta e o foco ficam como estão).
 */
function encerrar({ restaurar = true, fim = false, troca = false } = {}) {
  const D = demo;
  if (!D) return;
  demo = null;
  cancelAnimationFrame(D.raf);
  limparMapa(D);
  selo.classList.remove('is-on');
  delete selo.dataset.k;   // a próxima demonstração redesenha o selo da cena 0
  if (troca) return;
  const focoDentro = cartao.contains(document.activeElement);
  cartao.hidden = true;
  document.body.classList.remove('demo-on');
  root.style.removeProperty('--demo-h');
  // devolve a gaveta (celular) e refaz a margem do mapa (o app recalcula a parte coberta)
  ctx.setCollapsed(restaurar ? D.recolhido : ctx.recolhido());
  const M = ctx.mapa();
  if (restaurar && M) {
    if (D.tipo === 'dia') {
      const d = ctx.diaPorN.get(D.n), f = ctx.rotaAtiva(d);
      M.enquadrar(caixa([...f.geometry.coordinates, ...ctx.listaParadas(d).map((it) => ctx.llPonto(it.id))]), { maxZoom: f.properties.tipo === 'shuttle' ? 12.8 : 12 });
    } else M.enquadrar(caixa(ctx.dias.flatMap((d) => ctx.rotaAtiva(d).geometry.coordinates)), { maxZoom: 9 });
  }
  if (focoDentro) U.$(D.tipo === 'dia' ? `[data-demo-dia="${D.n}"]` : '[data-demo-viagem]')?.focus({ preventScroll: true });
  ctx.anunciar(fim ? 'Fim da demonstração.' : 'Demonstração fechada.');
}
function caixa(pts) {
  let a = Infinity, b = Infinity, c = -Infinity, e = -Infinity;
  for (const [x, y] of pts) { if (x < a) a = x; if (y < b) b = y; if (x > c) c = x; if (y > e) e = y; }
  return [[a, b], [c, e]];
}
function teclado(e) {
  // campos de texto e janelas de outros módulos (o Esc delas fecha a janela, não a demonstração) ficam de fora
  if (!demo || e.ctrlKey || e.metaKey || e.altKey || e.target.closest?.('input, textarea, select, [contenteditable], dialog, [role="dialog"]')) return;
  const k = e.key;
  if (k === ' ' || k === 'Spacebar') {
    if (e.target.closest?.('button, a, summary')) return;   // no botão, o espaço é o clique dele
    alternarPausa();
  } else if (k === 'ArrowRight') proxima();
  else if (k === 'ArrowLeft') anterior();
  else if (k === 'Escape') encerrar();
  else return;
  e.preventDefault();
  e.stopPropagation();
}
