// Clima de cada pernoite: previsão da Open-Meteo (até 16 dias à frente, guardada no aparelho) e, fora dela, a normal
// da época (data/clima.json, feito pelo tools/build_clima.ps1). Bloco "Clima no pernoite" na ficha do dia (com avisos
// de frio, calor, vento e neve na Tioga) e etiqueta "noite/máxima" na lista dos dias.

const API = 'https://api.open-meteo.com/v1/forecast';
const VARS = ['temperature_2m_max', 'temperature_2m_min', 'precipitation_probability_max', 'precipitation_sum', 'snowfall_sum', 'wind_gusts_10m_max', 'weather_code'];
const CHAVE = 'clima.prev';      // previsão guardada (localStorage, com a hora em que veio)
const VALIDADE = 3 * 3600e3;     // depois de 3 h, renova se houver sinal
const JANELA = 16;               // dias de previsão (hoje + 15)
const FRIO = 0, CALOR = 35, VENTO = 60;   // °C, °C, km/h
// pontos de passagem com clima próprio (aparecem quando estão nas paradas do dia em uso)
const PASSAGEM = { 9: [{ id: 'tioga_pass', nome: 'Tioga Pass', em: 'na Tioga Pass', tioga: true }, { id: 'badwater', nome: 'Badwater', em: 'em Badwater' }] };

// ícones do tempo (traço 24×24, como os do app)
const NUVEM = (y = 0) => `<path d="M6.5 ${14 + y}h11a3.5 3.5 0 0 0 .3-7 5.5 5.5 0 0 0-10.4 1.4A2.9 2.9 0 0 0 6.5 ${14 + y}Z"/>`;
const SVG = (p) => `<svg viewBox="0 0 24 24" aria-hidden="true">${p}</svg>`;
const ICO = {
  sol: SVG('<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/>'),
  solnuvem: SVG('<path d="M8.5 3v1.5M3 8.5h1.5M4.6 4.6l1 1M12.4 4.6l-1 1"/><path d="M5.6 11.4a3.5 3.5 0 1 1 6.2-3.2"/>' + NUVEM(4)),
  nuvem: SVG(NUVEM(3)),
  neblina: SVG(NUVEM(-1) + '<path d="M4 16.5h16M6.5 20h11"/>'),
  chuva: SVG(NUVEM(0) + '<path d="m8.5 17-1 3M12.5 17l-1 3M16.5 17l-1 3"/>'),
  neve: SVG(NUVEM(0) + '<path d="M8 17.5v.01M12 17.5v.01M16 17.5v.01M10 20.5v.01M14 20.5v.01" stroke-width="2.6"/>'),
  raio: SVG(NUVEM(0) + '<path d="m12.5 14-2.5 3.8h3.5L11 22"/>'),
  termo: SVG('<path d="M10 14.2V5a2 2 0 0 1 4 0v9.2a4 4 0 1 1-4 0Z"/><path d="M12 9v7.5"/><path d="M17 5h2.5M17 8.5h2.5"/>'),
};
// código do tempo (WMO) → texto e ícone
const TEMPO = {
  0: ['Céu limpo', 'sol'], 1: ['Quase limpo', 'sol'], 2: ['Parcialmente nublado', 'solnuvem'], 3: ['Nublado', 'nuvem'],
  45: ['Neblina', 'neblina'], 48: ['Neblina com geada', 'neblina'],
  51: ['Garoa fraca', 'chuva'], 53: ['Garoa', 'chuva'], 55: ['Garoa forte', 'chuva'], 56: ['Garoa congelante', 'neve'], 57: ['Garoa congelante', 'neve'],
  61: ['Chuva fraca', 'chuva'], 63: ['Chuva', 'chuva'], 65: ['Chuva forte', 'chuva'], 66: ['Chuva congelante', 'neve'], 67: ['Chuva congelante forte', 'neve'],
  71: ['Neve fraca', 'neve'], 73: ['Neve', 'neve'], 75: ['Neve forte', 'neve'], 77: ['Grãos de neve', 'neve'],
  80: ['Pancadas de chuva', 'chuva'], 81: ['Pancadas de chuva', 'chuva'], 82: ['Pancadas fortes de chuva', 'chuva'],
  85: ['Pancadas de neve', 'neve'], 86: ['Pancadas fortes de neve', 'neve'],
  95: ['Trovoada', 'raio'], 96: ['Trovoada com granizo', 'raio'], 99: ['Trovoada com granizo', 'raio'],
};

let ctx, U;
let normais = null;     // data/clima.json (null enquanto não carregou ou se ainda não foi gerado)
let estadoNormais = 'carregando';   // 'ok' | 'vazio' (arquivo sem lugares) | 'erro' (não carregou)
let prev = null;        // { em, ids, locais: { id: { elev, t, max, min, prob, mm, cm, raj, cod } } }
let buscando = false, falhou = false, ouvindo = false;
let tentou = 0;         // hora do último pedido (depois de uma falha, espera 2 min para tentar de novo)

// ---------- formatos ----------
/** temperatura → "−2°" (sinal de menos de verdade, sem "−0") */
function grau(t) {
  const r = Math.round(t);
  return `${r < 0 ? '−' : ''}${Math.abs(r)}°`;
}
const ddmm = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
function maisDias(iso, k) {
  return new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) + k * 864e5).toISOString().slice(0, 10);
}
/** hora da previsão guardada: "04/10 às 14h" (relógio do aparelho) */
function quando(ms) {
  const d = new Date(ms);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')} às ${d.getHours()}h`;
}

// ---------- previsão (Open-Meteo, um pedido com todos os lugares) ----------
/** pernoites de todos os dias (planos A e B) e pontos de passagem: o plano pode mudar sem sinal */
function idsPrev() {
  const s = new Set();
  for (const d of ctx.dias) {
    s.add(d.pernoite.ponto);
    if (d.planoB?.pernoite) s.add(d.planoB.pernoite.ponto);
  }
  for (const l of Object.values(PASSAGEM)) for (const x of l) s.add(x.id);
  return [...s].filter((id) => ctx.dados.pontos[id]);
}
/** a viagem está a menos de 16 dias (ou acontecendo)? fora disso não há o que prever */
const naJanela = () => ctx.HOJE >= maisDias(ctx.dias[0].data, -(JANELA - 1)) && ctx.HOJE <= ctx.dados.roteiro.fim.data;
/** a previsão guardada precisa ser renovada? */
const velha = () => !prev || prev.ids !== idsPrev().join(',') || Date.now() - prev.em > VALIDADE;

async function buscar({ forcar = false } = {}) {
  if (buscando || !navigator.onLine || !naJanela()) return;
  if (falhou && !forcar && Date.now() - tentou < 120e3) return;
  buscando = true; tentou = Date.now();
  redesenhar();
  const ids = idsPrev(), P = ctx.dados.pontos;
  const url = `${API}?latitude=${ids.map((id) => P[id].lat).join(',')}&longitude=${ids.map((id) => P[id].lon).join(',')}`
    + `&daily=${VARS.join(',')}&timezone=auto&forecast_days=${JANELA}`;
  const ac = new AbortController(), t = setTimeout(() => ac.abort(), 20000);
  try {
    const r = await fetch(url, { signal: ac.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    let j = await r.json();
    if (!Array.isArray(j)) j = [j];   // um lugar só vem como objeto
    if (j.length !== ids.length) throw new Error(`vieram ${j.length} lugares de ${ids.length}`);
    const locais = {};
    ids.forEach((id, i) => {
      const D = j[i].daily;
      locais[id] = { elev: j[i].elevation, t: D.time, max: D.temperature_2m_max, min: D.temperature_2m_min, prob: D.precipitation_probability_max,
        mm: D.precipitation_sum, cm: D.snowfall_sum, raj: D.wind_gusts_10m_max, cod: D.weather_code };
    });
    prev = { em: Date.now(), ids: ids.join(','), locais };
    U.store.set(CHAVE, JSON.stringify(prev));
    falhou = false;
  } catch (e) {
    falhou = true;
    console.warn('clima (previsão):', e.message ?? e);
  } finally {
    clearTimeout(t);
    buscando = false;
    redesenhar();
  }
}
/** previsão de um lugar numa data (null se a data não está na previsão guardada) */
function prevDe(id, iso) {
  const L = prev?.locais?.[id];
  const i = L?.t?.indexOf(iso) ?? -1;
  if (i < 0 || L.max[i] == null || L.min[i] == null) return null;
  return { max: L.max[i], min: L.min[i], prob: L.prob?.[i], mm: L.mm?.[i], cm: L.cm?.[i], raj: L.raj?.[i], cod: L.cod?.[i], elev: L.elev };
}

// ---------- normal da época (data/clima.json) ----------
async function carregarNormais() {
  try {
    const r = await fetch('data/clima.json');
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    normais = j?.lugares && Object.keys(j.lugares).length ? j : null;
    estadoNormais = normais ? 'ok' : 'vazio';
  } catch (e) { estadoNormais = 'erro'; console.warn('clima (normais):', e.message ?? e); }
  redesenhar();
}
function normalDe(id, iso) {
  const L = normais?.lugares?.[id], v = L?.normais?.[iso.slice(5)];
  return v ? { ...v, elev: L.elev } : null;
}
const anos = () => (normais?.anos ? `${normais.anos[0]}–${normais.anos[1]}` : '');

/** clima de um ponto numa data: previsão se houver, senão a normal; noite = mínima da madrugada seguinte */
function climaDe(id, iso, { noite = false } = {}) {
  const p = prevDe(id, iso);
  if (p) {
    const pn = noite ? prevDe(id, maisDias(iso, 1)) : null;
    return { tipo: 'prev', ...p, noite: pn?.min ?? p.min, noiteDoDia: noite && !pn };
  }
  const nm = normalDe(id, iso);
  return nm ? { tipo: 'normal', ...nm, noite: nm.min } : { tipo: 'nada' };
}
const climaDoDia = (d) => climaDe(ctx.ativo(d).pernoite.ponto, d.data, { noite: true });
/** pontos de passagem do dia que estão na rota em uso, na ordem do caminho */
function passagens(d) {
  const par = ctx.ativo(d).paradas;
  return (PASSAGEM[d.n] ?? []).filter((x) => par.includes(x.id)).sort((a, b) => par.indexOf(a.id) - par.indexOf(b.id))
    .map((x) => ({ ...x, c: climaDe(x.id, d.data) })).filter((x) => x.c.tipo !== 'nada');
}

// ---------- avisos ----------
const TXT_FRIO = 'Aquecedor, saco de dormir de inverno; proteja a água do motorhome.';
const TXT_CALOR = 'Leve muita água, faça as trilhas só cedo e fique de olho no motor e no ar-condicionado.';
const TXT_VENTO = 'Veículo alto: cuidado com o vento lateral; reduza a velocidade em trechos abertos e pontes.';
function avisos(d, c, extras) {
  const L = [];   // [forte?, html]
  if (c.tipo === 'prev') {
    if (c.noite <= FRIO) L.push([true, `<b>Noite abaixo de zero (${grau(c.noite)}).</b> ${TXT_FRIO}`]);
    if (c.cm > 0) L.push([true, `<b>Neve prevista (${U.nf(c.cm, 1)} cm).</b> Estrada escorregadia: confira as condições antes de sair.`]);
    if (c.max >= CALOR) L.push([false, `<b>Calor de ${grau(c.max)}.</b> ${TXT_CALOR}`]);
    if (c.raj >= VENTO) L.push([false, `<b>Rajadas de até ${Math.round(c.raj)} km/h.</b> ${TXT_VENTO}`]);
  } else if (c.tipo === 'normal') {
    if (c.min <= FRIO) L.push([true, `<b>Noites abaixo de zero nesta época (média ${grau(c.min)}).</b> ${TXT_FRIO}`]);
    else if (c.min_abs <= FRIO) L.push([false, `<b>Pode gear: já fez ${grau(c.min_abs)} nesta época.</b> ${TXT_FRIO}`]);
    if (c.max >= CALOR) L.push([false, `<b>Calor: a máxima média passa de 35 °C.</b> ${TXT_CALOR}`]);
    else if (c.max_abs >= CALOR) L.push([false, `<b>Pode passar de 35 °C (já fez ${grau(c.max_abs)}).</b> ${TXT_CALOR}`]);
  }
  for (const x of extras) {
    const e = x.c, planoB = d.planoB && !ctx.usaB(d.n) ? ' <button type="button" class="lnk" data-clima-planob>Veja o plano B</button>.' : '';
    if (x.tioga) {
      // neve no dia ou na véspera pode fechar a estrada
      const vesp = e.tipo === 'prev' ? (prevDe(x.id, maisDias(d.data, -1))?.cm ?? 0) : 0;
      const cm = e.tipo === 'prev' ? (e.cm ?? 0) + vesp : 0;
      if (cm > 0) L.unshift([true, `<b>Neve prevista na Tioga Pass (${U.nf(cm, 1)} cm${vesp > 0 ? ' entre a véspera e o dia' : ''}): risco de a Tioga fechar.</b>${planoB}`]);
      else if (e.tipo === 'normal' && e.neve > 0) L.unshift([false, `<b>Neva em ${Math.round(e.neve)}% dos dias nesta época na Tioga Pass: risco de a Tioga fechar.</b>${planoB}`]);
    }
    const calor = e.tipo === 'prev' ? e.max >= CALOR : e.max_abs >= CALOR;
    if (calor) L.push([false, `<b>Calor ${x.em}: ${e.tipo === 'prev' ? grau(e.max) : `já fez ${grau(e.max_abs)} nesta época`}.</b> ${TXT_CALOR}`]);
    if (e.tipo === 'prev' && e.raj >= VENTO) L.push([false, `<b>Rajadas de até ${Math.round(e.raj)} km/h ${x.em}.</b> ${TXT_VENTO}`]);
  }
  return L.map(([forte, h]) => `<p class="cc-warn${forte ? ' cc-warn--ov' : ''}">${h}</p>`).join('');
}

// ---------- bloco da ficha ----------
const num = (rot, val, extra = '', cls = '') => `<div${cls ? ` class="${cls}"` : ''}><dt>${rot}</dt><dd>${val}${extra ? `<small>${extra}</small>` : ''}</dd></div>`;
const frio = (t) => (t <= FRIO ? 'is-frio' : '');
const quente = (t) => (t >= CALOR ? 'is-quente' : '');
/** altitude → "3.031 m" / "−86 m" */
const metros = (e) => (e != null ? `${e < 0 ? '−' : ''}${U.nf(Math.abs(Math.round(e)))} m` : '');

function htmlNumeros(c) {
  const L = c.tipo === 'prev' ? [
    num('Máx.', grau(c.max), '', quente(c.max)),
    num('Noite', grau(c.noite), '', frio(c.noite)),
    num('Chuva', c.prob != null ? `${Math.round(c.prob)}%` : '—', c.mm >= 1 ? `${U.nf(c.mm, c.mm < 10 ? 1 : 0)} mm` : ''),
    num('Rajada', c.raj != null ? Math.round(c.raj) : '—', 'km/h', c.raj >= VENTO ? 'is-quente' : ''),
    c.cm > 0 ? num('Neve', U.nf(c.cm, 1), 'cm', 'is-frio') : '',
  ] : [
    num('Máx.', grau(c.max), '', quente(c.max)),
    num('Noite', grau(c.min), '', frio(c.min)),
    num('Mais frio', grau(c.min_abs), c.ano_min ? `em ${c.ano_min}` : '', frio(c.min_abs)),
    num('Chuva', c.chuva != null ? `${Math.round(c.chuva)}%` : '—', 'dos dias'),
    c.neve > 0 ? num('Neve', `${Math.round(c.neve)}%`, 'dos dias', 'is-frio') : '',
    num('Rajada', c.rajada != null ? Math.round(c.rajada) : '—', 'km/h'),
  ];
  const k = L.filter(Boolean).length;
  // colunas: até 5 numa linha (6 viram 2 × 3); no painel estreito, 4 viram 2 × 2 e 5 ou 6 viram 3 por linha
  return `<dl class="clima-num" style="--n:${k > 5 ? 3 : k};--m:${k === 4 ? 2 : Math.min(k, 3)}">${L.join('')}</dl>`;
}
function htmlPassagem(x) {
  const e = x.c, alt = metros(e.elev);
  const txt = e.tipo === 'prev'
    ? [TEMPO[e.cod]?.[0], `máx. ${grau(e.max)}`, `mín. ${grau(e.min)}`, e.cm > 0 ? `neve ${U.nf(e.cm, 1)} cm` : '', e.raj >= VENTO ? `rajada ${Math.round(e.raj)} km/h` : '']
    : ['normal da época', `máx. ${grau(e.max)}`, `mín. ${grau(e.min)}`, e.neve > 0 ? `neve em ${Math.round(e.neve)}% dos dias` : ''];
  return `<li><b>${U.esc(x.nome)}</b>${alt ? `<small>${alt}</small>` : ''}<span>${txt.filter(Boolean).join(' · ')}</span></li>`;
}

function htmlBloco(d) {
  const pn = ctx.ativo(d).pernoite, c = climaDoDia(d), extras = passagens(d);
  const inicioPrev = maisDias(d.data, -(JANELA - 1));
  const passou = d.data < ctx.HOJE;
  let ic, titulo, sub;
  if (c.tipo === 'prev') {
    const t = TEMPO[c.cod] ?? ['Previsão', 'nuvem'];
    ic = ICO[t[1]]; titulo = t[0];
    sub = `Previsão de ${quando(prev.em)}${velha() && !navigator.onLine ? ' · sem sinal' : ''}`;
  } else {
    ic = ICO.termo;
    titulo = c.tipo === 'normal' ? 'Normal da época' : 'Sem previsão ainda';
    const falta = passou ? '' : inicioPrev > ctx.HOJE ? `Previsão a partir de ${ddmm(inicioPrev)}`
      : buscando ? 'Buscando a previsão…' : !navigator.onLine ? 'Sem sinal para buscar a previsão' : falhou ? 'A previsão não veio agora' : '';
    sub = [c.tipo === 'normal' ? `média de ${anos()}` : '', falta].filter(Boolean).join(' · ');
    if (c.tipo === 'nada') {
      const motivo = { vazio: 'a normal da época ainda não foi calculada', erro: 'a normal da época não carregou' }[estadoNormais];
      sub = [falta, motivo].filter(Boolean).join(' · ');
    }
  }
  const nota = c.tipo === 'prev'
    ? `Previsão Open-Meteo para o ponto do pernoite. Noite = mínima ${c.noiteDoDia ? 'do dia (a madrugada seguinte ainda não entrou na previsão)' : 'da madrugada seguinte'}. Muda de um dia para o outro: confira na véspera.`
    : c.tipo === 'normal' ? `Normal = média de ${anos()} em ±${normais.janela_dias ?? 3} dias desta data (ERA5, ajustada pela altitude). É uma estimativa, não previsão: o modelo suaviza as madrugadas, e em vale ou montanha costuma fazer alguns graus a menos.` : '';
  return `<section class="blk clima" id="clima-${d.n}">
    <h3>Clima no pernoite <span>${U.esc(pn.nome)}</span></h3>
    <div class="clima-top"><i class="clima-ic${c.tipo === 'prev' ? '' : ' is-normal'}">${ic}</i>
      <div><b>${titulo}</b><small>${U.esc(sub)}</small></div></div>
    ${c.tipo === 'nada' ? '' : htmlNumeros(c)}
    ${extras.length ? `<h4 class="clima-h" id="clima-cam-${d.n}">No caminho</h4><ul class="clima-extra" aria-labelledby="clima-cam-${d.n}">${extras.map(htmlPassagem).join('')}</ul>` : ''}
    ${avisos(d, c, extras)}
    ${nota ? `<p class="cc-note">${nota}</p>` : ''}</section>`;
}

// ---------- etiqueta na lista dos dias ----------
function tagDia(d) {
  const c = climaDoDia(d);
  if (c.tipo === 'nada') return `<span class="clima-tag" data-clima-tag="${d.n}" hidden></span>`;
  const nor = c.tipo === 'normal', ti = nor ? '~' : '';
  // cor própria (senão herda a cor do dia, que o botão define em --c)
  const cor = c.noite <= FRIO ? 'var(--hydro)' : c.max >= CALOR ? 'var(--g-alta)' : 'var(--ink-soft)';
  const dica = `${nor ? 'Normal da época' : 'Previsão'} no pernoite: noite ${grau(c.noite)}, máxima ${grau(c.max)}`;
  return `<span class="tag clima-tag" data-clima-tag="${d.n}" style="--c:${cor}" title="${dica}"><span class="sr-only">${dica}</span><span aria-hidden="true">${ti}${grau(c.noite)}/${grau(c.max)}</span></span>`;
}

/** dados novos: troca só o bloco do dia aberto e as etiquetas (sem redesenhar a ficha dos outros) */
function redesenhar() {
  if (!ctx) return;
  const n = ctx.diaAberto(), el = n != null && document.getElementById(`clima-${n}`);
  if (el) el.outerHTML = htmlBloco(ctx.diaPorN.get(n));
  for (const t of U.$$('#trip [data-clima-tag]')) {
    const d = ctx.diaPorN.get(+t.dataset.climaTag);
    if (d) t.outerHTML = tagDia(d);
  }
}

// ---------- estilo ----------
const CSS = `
  .clima-top { display: grid; grid-template-columns: 40px 1fr; gap: 10px; align-items: center; }
  .clima-ic { width: 40px; height: 40px; border-radius: 10px; display: grid; place-items: center; font-style: normal; color: var(--hydro); background: color-mix(in srgb, var(--hydro) 14%, transparent); }
  .clima-ic.is-normal { color: var(--contour); background: color-mix(in srgb, var(--contour) 14%, transparent); }
  .clima-ic svg { width: 26px; height: 26px; fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
  .clima-top b { display: block; font: 700 17px/1.15 var(--f-display); letter-spacing: .02em; }
  .clima-top small { display: block; font: 11.5px/1.35 var(--f-data); color: var(--ink-soft); }
  .clima { container-type: inline-size; }
  .clima-num { margin: 0; display: grid; grid-template-columns: repeat(var(--n, 4), minmax(0, 1fr)); gap: 6px; }
  @container (max-width: 330px) { .clima-num { grid-template-columns: repeat(var(--m, 2), minmax(0, 1fr)); } }
  .clima-num div { display: grid; gap: 3px; align-content: start; padding: 7px 6px 8px; border-radius: 8px; background: var(--tile); text-align: center; }
  .clima-num dt { font: 600 10px/1.1 var(--f-display); letter-spacing: .1em; text-transform: uppercase; color: var(--ink-soft); }
  .clima-num dd { margin: 0; font: 700 19px/1 var(--f-display); }
  .clima-num dd small { display: block; margin-top: 2px; font: 500 10.5px/1.2 var(--f-body); color: var(--ink-soft); }
  .clima-num .is-frio dd { color: var(--hydro); }
  .clima-num .is-quente dd { color: var(--g-alta); }
  .clima-h { margin: 2px 0 -2px; font: 600 10.5px/1.2 var(--f-display); letter-spacing: .12em; text-transform: uppercase; color: var(--ink-soft); }
  .clima-extra { list-style: none; margin: 0; padding: 0; display: grid; gap: 5px; }
  .clima-extra li { display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 8px; padding: 6px 9px; border-radius: 8px; border: 1px dashed var(--panel-line); font-size: 13.5px; }
  .clima-extra b { font: 700 14px/1.2 var(--f-display); letter-spacing: .03em; text-transform: uppercase; }
  .clima-extra small { font: 11px var(--f-data); color: var(--ink-soft); }
  .clima-extra span { flex: 1 1 100%; font: 12px/1.4 var(--f-data); color: var(--ink-soft); }
  .clima .lnk { text-decoration: underline; }
`;

// ---------- início ----------
export function iniciar(c) {
  ctx = c; U = c.util;
  if (!document.getElementById('mod-clima')) {
    const st = document.createElement('style');
    st.id = 'mod-clima'; st.textContent = CSS;
    document.head.append(st);
  }
  try { prev = JSON.parse(U.store.get(CHAVE) ?? 'null'); } catch { prev = null; }
  ctx.registrar({
    blocoDia: { lugar: 'depois-tempo', html: htmlBloco },
    tagDia,
    aoRenderDia: (n, el) => {
      if (velha()) buscar();   // renova quando a ficha é aberta (se tiver mais de 3 h e houver sinal)
      if (ouvindo) return;
      ouvindo = true;          // #day continua o mesmo: um ouvinte só, por delegação
      el.addEventListener('click', (e) => {
        if (!e.target.closest('[data-clima-planob]')) return;
        const r = document.getElementById(`rb-${ctx.diaAberto()}`);
        r?.closest('.route-pick')?.scrollIntoView({ block: 'center', behavior: U.reduzMovimento() ? 'auto' : 'smooth' });
        r?.focus({ preventScroll: true });
      });
    },
    aoSinal: (online) => { if (online && velha()) buscar({ forcar: true }); else redesenhar(); },
  });
  if (velha()) buscar();
  // app aberto por muito tempo: confere ao voltar para ele e a cada 30 min
  document.addEventListener('visibilitychange', () => { if (!document.hidden && velha()) buscar(); });
  setInterval(() => { if (!document.hidden && velha()) buscar(); }, 30 * 60e3);
  // a normal vem do próprio app (casco offline): espera por ela para a primeira ficha já sair completa
  return carregarNormais();
}
