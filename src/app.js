// App da viagem: painel (roteiro, mapa, alertas, sobre), escolha do dia e da rota, e o que o mapa deve mostrar.
import { $, $$, store, nf, fmtKm, fmtH, MOTORHOME, fmtData, fmtDia, esc, isDark, reduzMovimento, hojeISO, diasEntre, corDia, ICONE } from './util.js';
import { resumoArmazenamento, pedirPersistencia, aparar } from './tilecache.js';

// ---------- abertura ----------
const status = $('#status');
function progresso(p, msg) { $('#splash-prog').style.width = `${Math.round(p * 100)}%`; if (msg) $('#splash-msg').textContent = msg; }
function falhou(msg) { status.dataset.error = 'true'; $('#splash-msg').textContent = msg; }
function fecharAbertura() { status.classList.add('is-out'); setTimeout(() => { status.hidden = true; }, 900); }

// service worker: guarda o app para abrir sem sinal (só em https ou no localhost)
if ('serviceWorker' in navigator && (location.protocol === 'https:' || /^(localhost|127\.0\.0\.1)$/.test(location.hostname))) {
  navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('service worker:', e));
  // versão nova instalada enquanto o app estava aberto: avisa (a primeira instalação não conta)
  const tinhaSW = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (tinhaSW) aviso('O app foi atualizado. Recarregue para ver a versão nova.'); });
}
// no app da Tela de Início, pede para o navegador não apagar o que foi guardado
if (matchMedia('(display-mode: standalone)').matches || navigator.standalone) pedirPersistencia();
// o mapa (MapLibre, ~1 MB) começa a carregar junto com os dados, sem esperar por eles
const modMapa = import('./mapa.js');
modMapa.catch(() => { /* tratado na criação do mapa */ });

// ---------- dados ----------
async function lerJSON(u) {
  const r = await fetch(u);
  if (!r.ok) throw new Error(`${u}: HTTP ${r.status}`);
  return r.json();
}
let roteiro, rotas, pontos, alertas;
try {
  progresso(0.1, 'Lendo o roteiro…');
  [roteiro, rotas, pontos, alertas] = await Promise.all(['data/roteiro.json', 'data/rotas.geojson', 'data/pontos.json', 'data/alertas.json'].map(lerJSON));
} catch (e) {
  falhou(`Não deu para ler os dados da viagem (${e.message}). Confira a conexão e recarregue.`);
  throw e;
}
const dias = roteiro.dias;
const diaPorN = new Map(dias.map((d) => [d.n, d]));
const rotaPorId = new Map(rotas.features.map((f) => [f.properties.id, f]));
const opcPorId = new Map(roteiro.opcionais.map((o) => [o.id, o]));
const opcPorRota = new Map(roteiro.opcionais.map((o) => [o.rota, o]));
const notasPonto = roteiro.notasPontos ?? {};
const nomePonto = (id) => pontos[id]?.nome ?? id;
const llPonto = (id) => [pontos[id].lon, pontos[id].lat];
// alertas: os das etapas opcionais aparecem nelas; os gerais só na aba Alertas
const alertaOpc = new Set(roteiro.opcionais.flatMap((o) => o.alertas ?? []));
const alertasDoDia = (n) => alertas.itens.filter((a) => !a.geral && !alertaOpc.has(a.id) && a.dias?.includes(n));
const ORDEM_G = { alta: 0, media: 1, desconhecido: 2, baixa: 3, resolvido: 4 };
const NOME_G = { alta: 'Alta', media: 'Média', baixa: 'Baixa', resolvido: 'Resolvido', desconhecido: 'Sem confirmação' };
const COR_G = { alta: 'var(--g-alta)', media: 'var(--g-media)', baixa: 'var(--g-baixa)', resolvido: 'var(--g-ok)', desconhecido: 'var(--g-nd)' };

// ---------- estado ----------
let sel = null;   // null = viagem toda · { tipo: 'dia', n } · { tipo: 'opc', id }
let verB = store.get('planob') === '1';
let verOpc = store.get('opc') === '1';
let mapa = null;

/** o dia usa o plano B? (escolha guardada; senão, o que o roteiro manda) */
function usaB(n) {
  const d = diaPorN.get(n);
  if (!d?.planoB) return false;
  if (d.planoB.acompanha) return usaB(d.planoB.acompanha);
  const v = store.get(`rota.${n}`);
  return v ? v === 'B' : !!d.usarB;
}
/** rota, paradas, pernoite, textos e destino em uso no dia (o plano B pode trocar cada um) */
function ativo(d) {
  const b = usaB(d.n) ? d.planoB : null;
  return {
    rota: b?.rota ?? d.rota, paradas: b?.paradas ?? d.paradas, pernoite: b?.pernoite ?? d.pernoite,
    de: b?.de ?? d.de, para: b?.para ?? d.para, programacao: b?.programacao ?? d.programacao, notas: b?.notas ?? d.notas, b,
  };
}
const rotaAtiva = (d) => rotaPorId.get(ativo(d).rota);
const inicioDe = (d) => (d.n === 1 ? d.paradas[0] : ativo(diaPorN.get(d.n - 1)).pernoite.ponto);
const ehShuttle = (d) => rotaAtiva(d).properties.tipo === 'shuttle';
const horasMotorhome = (h) => h * MOTORHOME;

/** início, paradas e pernoite do dia, com a distância de cada trecho */
function listaParadas(d) {
  const a = ativo(d), f = rotaPorId.get(a.rota), P = f.properties;
  const naRota = new Set(P.pontos), ini = inicioDe(d), fim = a.pernoite.ponto;
  const itens = [{ id: ini, papel: 'inicio' }];
  for (const id of a.paradas) if (id !== ini && id !== fim) itens.push({ id, papel: 'parada' });
  itens.push({ id: fim, papel: 'pernoite' });
  let k = 0;
  for (const it of itens) {
    it.fora = !naRota.has(it.id);
    // a parada que é o começo da rota (ex.: o shuttle sai do centro de visitantes) não tem trecho até ela
    if (it.papel === 'inicio' || it.fora || (it.papel === 'parada' && it.id === P.pontos[0])) continue;
    const j = P.trechos.findIndex((t, i) => i >= k && t.para === it.id);
    if (j < 0) continue;
    it.km = 0; it.min = 0;
    for (let i = k; i <= j; i++) { it.km += P.trechos[i].km; it.min += P.trechos[i].min; }
    k = j + 1;
  }
  return itens;
}

function totais() {
  let km = 0, h = 0;
  for (const d of dias) {
    const f = rotaAtiva(d);
    if (f.properties.tipo === 'shuttle') continue;
    km += f.properties.km; h += f.properties.horas;
  }
  return { km, h };
}

// ---------- hoje ----------
const HOJE = hojeISO();
const INICIO = dias[0].data, FIM = roteiro.fim.data;
const diaDeHoje = dias.find((d) => d.data === HOJE)?.n ?? null;
function textoHoje() {
  if (HOJE < INICIO) { const f = diasEntre(HOJE, INICIO); return f === 1 ? 'Falta 1 dia para a viagem' : `Faltam ${f} dias para a viagem`; }
  if (diaDeHoje) return `Hoje é o dia ${diaDeHoje} de ${dias.length}`;
  if (HOJE === FIM) return 'Hoje é dia de voltar';
  return 'Viagem concluída';
}

// ---------- o que o mapa mostra ----------
function rotuloRota(p) {
  if (p.tipo === 'opcional') { const o = opcPorRota.get(p.id); return `Opcional ${o?.id ?? ''} · ${o?.de} → ${o?.para} · ${fmtKm(p.km)}`; }
  const d = diaPorN.get(p.dia);
  const b = p.tipo === 'planoB' ? d.planoB : null;
  return `Dia ${p.dia} · ${b?.de ?? d.de} → ${b?.para ?? d.para}${b ? ' (plano B)' : ''} · ${fmtKm(p.km)}`;
}
function fcRotas() {
  const feats = rotas.features.map((f) => {
    const p = f.properties;
    let estado = 'oculta', s = false;
    if (p.tipo === 'opcional') {
      s = sel?.tipo === 'opc' && opcPorId.get(sel.id)?.rota === p.id;
      estado = verOpc || s ? 'opcional' : 'oculta';
    } else {
      s = sel?.tipo === 'dia' && sel.n === p.dia;
      const emUso = (p.tipo === 'planoB') === usaB(p.dia);
      estado = emUso ? (p.tipo === 'shuttle' ? 'shuttle' : 'ativa') : s || verB ? 'alternativa' : 'oculta';
    }
    return { type: 'Feature', geometry: f.geometry,
      properties: { id: p.id, dia: p.dia, tipo: p.tipo, estado, cor: corDia(p.dia), sel: s, apagada: !!sel && !s, rotulo: rotuloRota(p) } };
  });
  feats.sort((a, b) => a.properties.sel - b.properties.sel);   // a escolhida por cima
  return { type: 'FeatureCollection', features: feats };
}

/** pernoites (com as noites), número dos dias no meio de cada trecho e paradas do dia escolhido */
function marcadores() {
  const noites = new Map();
  for (const d of dias) {
    const pn = ativo(d).pernoite;
    if (!noites.has(pn.ponto)) noites.set(pn.ponto, { pn, ns: [] });
    noites.get(pn.ponto).ns.push(d.n);
  }
  const selDia = sel?.tipo === 'dia' ? diaPorN.get(sel.n) : null;
  const fimSel = selDia ? ativo(selDia).pernoite.ponto : null;
  const iniSel = selDia ? inicioDe(selDia) : null;
  const pern = [...noites].map(([id, { pn, ns }]) => {
    const hotel = pn.tipo === 'Hotel';
    const rot = ns.length > 2 ? `${ns[0]}–${ns.at(-1)}` : ns.join('·');
    const ehSel = id === fimSel, ehIni = id === iniSel;
    return {
      chave: `p:${id}`, lngLat: llPonto(id), cls: `mk--stay${ehSel ? ' is-sel' : ''}${selDia && !ehSel && !ehIni ? ' is-dim' : ''}`,
      html: `<span class="g">${hotel ? ICONE.cama : ICONE.lua}${rot}</span><span class="nm">${esc(pn.nome)}</span>`,
      titulo: `${pn.nome}: noite${ns.length > 1 ? 's' : ''} ${ns.join(', ')}`,
      prioridade: ehSel ? 100 : ehIni ? 70 : 50, zoomNome: ehSel || ehIni ? null : 7.5, essencial: ehSel || ehIni,
      aoClicar: () => abrirDia(ns.includes(sel?.n) ? sel.n : ns[0]),
    };
  });
  const rotulosDias = sel ? [] : dias.map((d) => {
    const A = ativo(d);
    return { chave: `d:${d.n}`, lngLat: rotaAtiva(d).properties.meio, cls: 'mk--day', style: `--c:${corDia(d.n)}`,
      html: `<span class="g">${d.n}</span>`, anchor: 'center', offset: [0, 0],
      titulo: `Dia ${d.n}: ${A.de} → ${A.para}`, prioridade: 30, aoClicar: () => abrirDia(d.n) };
  });
  let paradas = [];
  if (selDia) {
    let i = 0;
    paradas = listaParadas(selDia).filter((it) => it.papel === 'parada').map((it) => ({
      chave: `s:${it.id}`, lngLat: llPonto(it.id), cls: `mk--stop${it.fora ? ' is-off' : ''}`, style: `--c:${corDia(selDia.n)}`,
      html: `<span class="g">${++i}</span><span class="nm">${esc(nomePonto(it.id))}</span>`,
      titulo: `Parada ${i}: ${nomePonto(it.id)}`, prioridade: 80 - i, zoomNome: 6, essencial: true,
      aoClicar: () => mapa.voar(llPonto(it.id), 12.5),
    }));
  } else if (sel?.tipo === 'opc') {
    const o = opcPorId.get(sel.id), f = rotaPorId.get(o.rota);
    const ids = [...f.properties.pontos.slice(1), ...(o.marcadores ?? [])];
    paradas = ids.map((id, k) => ({
      chave: `o:${id}`, lngLat: llPonto(id), cls: `mk--stop${f.properties.pontos.includes(id) ? '' : ' is-off'}`, style: '--c:var(--contour)',
      html: `<span class="g">${k + 1}</span><span class="nm">${esc(nomePonto(id))}</span>`, titulo: nomePonto(id),
      prioridade: 80 - k, zoomNome: 6, essencial: true, aoClicar: () => mapa.voar(llPonto(id), 12.5),
    }));
  }
  return { pern, rotulosDias, paradas };
}

function atualizarMapa() {
  if (!mapa) return;
  mapa.setRotas(fcRotas());
  const m = marcadores();
  mapa.setMarcadores('pernoites', m.pern);
  mapa.setMarcadores('dias', m.rotulosDias);
  mapa.setMarcadores('paradas', m.paradas);
}

// ---------- menu: barra de ícones + painel (largura ajustável no computador; gaveta no celular) ----------
const side = $('#side'), pane = $('#pane'), paneBody = $('#pane-body'), root = document.documentElement;
const mqPhone = matchMedia('(max-width: 700px)'), mqWide = matchMedia('(min-width: 1000px)');
const RAIL_W = 68, PANE_MIN = 320, PANE_DEF = 400;
let paneWant = Math.max(PANE_MIN, parseInt(store.get('paneW') ?? '', 10) || PANE_DEF), paneW = paneWant;
let curPane = 'roteiro';
let collapsed = !mqPhone.matches && store.get('paneOpen') === '0';
function layout() {
  // o painel empurra o mapa (no tablet, no máximo 45% da tela, para o trecho ter espaço)
  paneW = Math.min(paneWant, Math.max(PANE_MIN, Math.min(760, innerWidth * (mqWide.matches ? 0.6 : 0.45))));
  root.style.setProperty('--pane-w', `${paneW}px`);
  side.classList.toggle('is-collapsed', collapsed);
  const off = document.body.classList.contains('ui-hidden');
  const w = off || mqPhone.matches ? 0 : !collapsed ? RAIL_W + paneW : RAIL_W;
  root.style.setProperty('--side-w', `${w}px`);
  $$('.rail-btn[data-pane]').forEach((b) => b.setAttribute('aria-current', String(!collapsed && b.dataset.pane === curPane)));
  const ponto = !temAlertaAlto || (!collapsed && curPane === 'alertas');
  $('#rail-dot').hidden = ponto; $('#rail-dot-txt').hidden = ponto;
  syncPadding();
}
function setSheet(s) {
  pane.classList.toggle('is-full', s === 'full'); pane.classList.toggle('is-peek', s === 'peek');
  $('#pane-grip').setAttribute('aria-expanded', String(s === 'full'));
}
function setCollapsed(c) {
  collapsed = c;
  if (!mqPhone.matches) store.set('paneOpen', c ? '0' : '1');
  layout();
}
/** mostra uma parte do painel (abre o painel se estava recolhido); sheet: altura da gaveta no celular */
function showPane(name, { sheet = 'half' } = {}) {
  const changed = name !== curPane;
  curPane = name;
  $$('.pane').forEach((p) => p.classList.toggle('is-on', p.dataset.pane === name));
  if (mqPhone.matches && (collapsed || changed || sheet === 'full')) setSheet(sheet);
  if (changed) paneBody.scrollTop = 0;
  setCollapsed(false);
  if (name === 'sobre') mostrarArmazenamento();
}
$$('.rail-btn[data-pane]').forEach((b) => b.addEventListener('click', () => {
  if (b.dataset.pane === curPane && !collapsed) setCollapsed(true); else showPane(b.dataset.pane);
}));
$('#pane-x').addEventListener('click', () => setCollapsed(true));
{ // largura: arrastar a borda do painel (duplo clique volta ao padrão)
  const grip = $('#pane-resize');
  grip.addEventListener('pointerdown', (e) => {
    grip.setPointerCapture(e.pointerId); grip.classList.add('is-drag'); document.body.classList.add('is-resizing');
    const move = (ev) => { paneWant = Math.max(PANE_MIN, Math.min(760, ev.clientX - RAIL_W)); layout(); };
    const up = () => {
      grip.removeEventListener('pointermove', move); grip.removeEventListener('pointerup', up);
      grip.classList.remove('is-drag'); document.body.classList.remove('is-resizing');
      store.set('paneW', String(Math.round(paneWant)));
    };
    grip.addEventListener('pointermove', move); grip.addEventListener('pointerup', up);
  });
  grip.addEventListener('dblclick', () => { paneWant = PANE_DEF; store.set('paneW', String(PANE_DEF)); layout(); });
}
{ // celular: alça da gaveta — tocar alterna meia/alta; arrastar para cima abre, para baixo baixa e depois recolhe
  const grip = $('#pane-grip');
  let y0 = null;
  grip.addEventListener('pointerdown', (e) => { y0 = e.clientY; grip.setPointerCapture(e.pointerId); });
  grip.addEventListener('pointerup', (e) => {
    if (y0 == null) return;
    const dy = e.clientY - y0; y0 = null;
    const full = pane.classList.contains('is-full'), peek = pane.classList.contains('is-peek');
    if (Math.abs(dy) < 8) setSheet(full ? 'half' : 'full');
    else if (dy < 0) setSheet(peek ? 'half' : 'full');
    else if (full) setSheet('half');
    else if (!peek) setSheet('peek');
    else setCollapsed(true);
  });
  // teclado e leitor de tela (o clique deles vem com detail 0; o do dedo já foi tratado no pointerup)
  grip.addEventListener('click', (e) => { if (e.detail === 0) setSheet(pane.classList.contains('is-full') ? 'half' : 'full'); });
}
// a gaveta cobre a parte de baixo do mapa no celular: o centro da vista vai para o meio da parte à mostra
function coberto() {
  if (!mqPhone.matches || document.body.classList.contains('ui-hidden')) return { bottom: 0 };
  const h = innerHeight;
  return { bottom: Math.round(Math.max(0, Math.min(h * 0.6, h - side.getBoundingClientRect().top))) };
}
function syncPadding(animar = true) {
  const c = coberto();
  root.style.setProperty('--map-bottom', `${c.bottom}px`);
  mapa?.setPadding(c, animar);
}
pane.addEventListener('transitionend', (e) => { if (e.target === pane && e.propertyName === 'height') syncPadding(); });
addEventListener('resize', layout);
mqPhone.addEventListener('change', () => { collapsed = !mqPhone.matches && store.get('paneOpen') === '0'; layout(); });
mqWide.addEventListener('change', layout);
/** no celular, espera a gaveta terminar de mudar de altura antes de mexer a câmera */
function depoisDaGaveta(fn) {
  if (!mqPhone.matches) return fn();
  const anda = pane.getAnimations?.().some((a) => a.transitionProperty === 'height');
  if (!anda) { syncPadding(false); return fn(); }
  let feito = false;
  const ir = () => { if (feito) return; feito = true; pane.removeEventListener('transitionend', fim); clearTimeout(t); syncPadding(false); fn(); };
  const fim = (e) => { if (e.target === pane && e.propertyName === 'height') ir(); };
  pane.addEventListener('transitionend', fim);
  const t = setTimeout(ir, 450);
}

// só o mapa: esconde o menu (botão na barra ou tecla H)
function setUIHidden(h) {
  document.body.classList.toggle('ui-hidden', h);
  $('#ui-toggle').setAttribute('aria-pressed', String(h));
  store.set('uiHidden', h ? '1' : '0');
  layout();
}
$('#ui-toggle').addEventListener('click', () => setUIHidden(true));
$('#ui-restore').addEventListener('click', () => { setUIHidden(false); $('#ui-toggle').focus?.({ preventScroll: true }); });

// ---------- avisos ----------
let toastT = 0;
function aviso(txt) {
  const t = $('#toast');
  t.textContent = txt;   // vazio = escondido (o CSS esconde #toast:empty); a região já existe, então o leitor de tela lê
  clearTimeout(toastT); toastT = setTimeout(() => { t.textContent = ''; }, 5000);
}
/** frase para leitor de tela (região aria-live escondida) */
function anunciar(txt) { const a = $('#anuncio'); a.textContent = ''; requestAnimationFrame(() => { a.textContent = txt; }); }
/** o foco estava no painel ou num marcador? (aí, depois de redesenhar, ele volta para um lugar previsível) */
function focoNaInterface() {
  const a = document.activeElement;
  return !!a && a !== document.body && (side.contains(a) || !!a.closest?.('.mk'));
}

// ---------- tema ----------
async function aplicarTema() {
  $('#sv-mapa').className = `sv ${isDark() ? 'sv--dark' : 'sv--map'}`;
  if (!mapa) return;
  const r = await mapa.setTema(isDark());
  if (r !== 'ok') aviso('Sem sinal: o mapa continua no outro tema até a internet voltar.');
}
function setTheme(t) {
  if (t === 'auto') delete root.dataset.theme; else root.dataset.theme = t;
  store.set('theme', t);
  aplicarTema();
}
{
  const t = ['light', 'dark'].includes(store.get('theme')) ? store.get('theme') : 'auto';
  $(`#th-${t}`).checked = true;
  $$('input[name="theme"]').forEach((r) => r.addEventListener('change', () => { if (r.checked) setTheme(r.value); }));
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', aplicarTema);
  $('#sv-mapa').className = `sv ${isDark() ? 'sv--dark' : 'sv--map'}`;
}

// ---------- painel: a viagem toda ----------
const temAlertaAlto = alertas.itens.some((a) => a.gravidade === 'alta');
function gravMax(lista) { return lista.reduce((g, a) => (ORDEM_G[a.gravidade] < ORDEM_G[g] ? a.gravidade : g), 'resolvido'); }

function renderViagem() {
  const t = totais();
  const avisos = dias.filter((d) => d.usarB && usaB(d.n)).map((d) =>
    `<p class="cc-warn cc-warn--ov"><b>Dia ${d.n} pelo plano B.</b> ${esc(d.usarB)} <button type="button" class="lnk" data-dia="${d.n}">Ver o dia</button></p>`).join('');
  const itens = dias.map((d) => {
    const A = ativo(d), P = rotaAtiva(d).properties, al = alertasDoDia(d.n).filter((a) => a.gravidade === 'alta' || a.gravidade === 'media');
    const tags = [];
    if (d.n === diaDeHoje) tags.push('<span class="tag tag--today">Hoje</span>');
    if (usaB(d.n)) tags.push('<span class="tag tag--b">Plano B</span>');
    else if (d.planoB) tags.push('<span class="tag tag--alt">Tem plano B</span>');
    if (P.tipo === 'shuttle') tags.push('<span class="tag tag--bus">Shuttle</span>');
    if (al.length) tags.push(`<span class="tag" style="--c:${COR_G[gravMax(al)]}">${al.length} alerta${al.length > 1 ? 's' : ''}</span>`);
    const tempo = P.tipo === 'shuttle' ? 'de shuttle' : `~${fmtH(horasMotorhome(P.horas))}`;
    return `<li><button type="button" class="day${d.n === diaDeHoje ? ' is-today' : ''}" data-dia="${d.n}" style="--c:${corDia(d.n)}">
      <i>${d.n}</i><b>${esc(A.de)} → ${esc(A.para)}</b><span class="tags">${tags.join('')}</span>
      <small>${fmtData(d.data, d.semana)} · ${fmtKm(P.km)} · ${tempo}</small></button></li>`;
  }).join('');
  const [, mf, df] = roteiro.fim.data.split('-');
  $('#trip').innerHTML = `
    <p class="trip-status">${textoHoje()}</p>
    <div class="stats3">
      <div><b>${dias.length}</b><span>dias, ${dias.length - 1} pernoites no veículo</span></div>
      <div><b>${nf(Math.round(t.km / 10) * 10)}</b><span>km de estrada</span></div>
      <div><b>~${Math.round(horasMotorhome(t.h))} h</b><span>ao volante (motorhome, estimado)</span></div>
    </div>
    ${avisos}
    <ol class="days" aria-label="Dias da viagem">${itens}</ol>
    <div class="trip-end"><i>${ICONE.aviao}</i><b>dom ${df}/${mf} · volta</b><small>${esc(roteiro.fim.texto)}</small></div>
    <p class="cc-note">Distâncias pela estrada (OSRM/OpenStreetMap). Tempo de motorhome = tempo de carro + 25% (estimativa). A planilha tinha ${nf(dias.reduce((s, d) => s + d.km_planilha, 0))} km.</p>`;
}
$('#trip').addEventListener('click', (e) => {
  const b = e.target.closest('[data-dia]');
  if (b) abrirDia(+b.dataset.dia);
});

// ---------- painel: ficha do dia ----------
function linkNavegar(d) {
  const ids = rotaAtiva(d).properties.pontos, P = ids.map((id) => pontos[id]);
  const ll = (p) => `${p.lat},${p.lon}`;
  const q = new URLSearchParams({ api: '1', origin: ll(P[0]), destination: ll(P.at(-1)), travelmode: 'driving' });
  if (P.length > 2) q.set('waypoints', P.slice(1, -1).map(ll).join('|'));
  return { url: `https://www.google.com/maps/dir/?${q}`, paradas: Math.max(0, P.length - 2) };
}
const linkPonto = (id) => `https://www.google.com/maps/search/?api=1&query=${pontos[id].lat},${pontos[id].lon}`;

function htmlAlerta(a, { comDias = false } = {}) {
  const fontes = (a.fontes ?? []).map((f) => {
    let host = f.url; try { host = new URL(f.url).hostname.replace(/^www\./, ''); } catch { /* mantém */ }
    return `<a href="${esc(f.url)}" target="_blank" rel="noopener">${esc(host)}${f.data ? ` (${fmtDia(f.data)})` : ''}</a>`;
  }).join('');
  const ds = comDias && a.dias?.length && a.dias.length < dias.length
    ? `<div class="dias">${a.dias.map((n) => `<button type="button" data-dia="${n}" style="--dc:${corDia(n)}">Dia ${n}</button>`).join('')}</div>` : '';
  return `<li class="alert" data-g="${esc(a.gravidade)}">
    <div class="top"><b>${esc(a.titulo)}</b><span class="g">${NOME_G[a.gravidade] ?? ''}</span></div>
    <p>${esc(a.situacao)}</p>
    ${a.plano_b ? `<p class="pb"><b>Plano B:</b> ${esc(a.plano_b)}</p>` : ''}
    ${ds}
    ${fontes ? `<div class="src">${fontes}</div>` : ''}</li>`;
}

function renderDia(n) {
  const d = diaPorN.get(n), a = ativo(d), f = rotaPorId.get(a.rota), P = f.properties, cor = corDia(n);
  const shuttle = P.tipo === 'shuttle';
  const itens = listaParadas(d);
  let i = 0;
  const lis = itens.map((it) => {
    const nome = nomePonto(it.id), nota = notasPonto[it.id];
    const papel = it.papel === 'inicio' ? 'is-start' : it.papel === 'pernoite' ? 'is-stay' : '';
    const num = it.papel === 'inicio' ? '▶' : it.papel === 'pernoite' ? '★' : ++i;
    const sub = it.papel === 'inicio' ? 'saída' : it.papel === 'pernoite' ? 'pernoite' : (nota ?? '');
    const leg = it.km != null ? `+${fmtKm(it.km)}<br>${shuttle ? '' : `~${fmtH(horasMotorhome(it.min / 60))}`}` : it.fora && it.papel === 'parada' ? 'fora da rota' : '';
    return `<li class="${papel}${it.fora && it.papel === 'parada' ? ' is-off' : ''}">
      <span class="n" aria-hidden="true">${num}</span>
      <button type="button" class="go" data-ponto="${it.id}"><b>${esc(nome)}</b><small>${esc(sub)}${it.papel !== 'parada' && nota ? ` · ${esc(nota)}` : ''}</small></button>
      <span class="leg">${leg}</span></li>`;
  }).join('');
  const pn = a.pernoite;
  const preco = pn.preco ? `US$ ${pn.preco}/noite` : '';
  const pernoite = `<div class="stay-card"><i>${pn.tipo === 'Hotel' ? ICONE.cama : ICONE.lua}</i>
      <b>${esc(pn.nome)}</b>
      <span class="meta"><span>${esc(pn.tipo)}</span>${preco ? `<span>${preco}</span>` : ''}${pn.reserva ? `<span>reserva: ${esc(pn.reserva)}</span>` : ''}</span>
      <p>${esc(pn.notas ?? '')}${pn.alternativa ? `<br><small>Alternativa: ${esc(pn.alternativa)}</small>` : ''}</p></div>`;
  const pb = d.planoB;
  const escolha = pb ? `<section class="blk route-pick"><h3>Rota do dia</h3>
      <div class="seg2" role="radiogroup" aria-label="Rota do dia ${n}">
        <input type="radio" name="rota-${n}" id="ra-${n}" value="A"${usaB(n) ? '' : ' checked'}${pb.acompanha ? ' disabled' : ''}><label for="ra-${n}">Principal · ${fmtKm(rotaPorId.get(d.rota).properties.km)}</label>
        <input type="radio" name="rota-${n}" id="rb-${n}" value="B"${usaB(n) ? ' checked' : ''}${pb.acompanha ? ' disabled' : ''}><label for="rb-${n}">Plano B · ${fmtKm(rotaPorId.get(pb.rota).properties.km)}</label>
      </div>
      <p class="hint"><b>Plano B (${esc(pb.titulo)}).</b> ${esc(pb.quando)}${pb.acompanha ? ` Segue a escolha do dia ${pb.acompanha}.` : ''}</p></section>` : '';
  const aviso = d.usarB && usaB(n) ? `<p class="cc-warn cc-warn--ov"><b>Usando o plano B.</b> ${esc(d.usarB)}</p>`
    : d.usarB ? `<p class="cc-warn"><b>Atenção:</b> ${esc(d.usarB)} Você escolheu a rota principal.</p>` : '';
  const al = alertasDoDia(n).sort((x, y) => ORDEM_G[x.gravidade] - ORDEM_G[y.gravidade]);
  const tempo = shuttle ? `<span>de shuttle · ${fmtH(P.horas)} só de ida</span>`
    : `<span>${fmtH(P.horas)} de carro</span><span>~${fmtH(horasMotorhome(P.horas))} de motorhome</span>`;
  const nav = shuttle ? null : linkNavegar(d);
  const navegar = shuttle
    ? `<a class="btn btn--main" href="${linkPonto(a.paradas[0])}" target="_blank" rel="noopener">${ICONE.navegar}Shuttle no Google Maps</a>`
    : `<a class="btn btn--main" href="${nav.url}" target="_blank" rel="noopener">${ICONE.navegar}Navegar</a>`;
  const dicaNav = nav && nav.paradas > 3
    ? `<p class="hint">O link leva ${nav.paradas} paradas. Pelo navegador do celular, o Google Maps pode aceitar só 3; no app do Google Maps cabem todas. Confira a lista ao abrir.</p>` : '';
  $('#day').innerHTML = `
    <div class="dsheet-nav">
      <button type="button" class="btn btn--small back" data-act="voltar">${ICONE.voltar}Todos os dias</button>
      <button type="button" class="btn btn--small" data-act="ant" aria-label="Dia anterior"${n === 1 ? ' disabled' : ''}>${ICONE.voltar}</button>
      <button type="button" class="btn btn--small" data-act="prox" aria-label="Dia seguinte"${n === dias.length ? ' disabled' : ''}>${ICONE.seguir}</button>
    </div>
    <header class="cc-head" style="--c:${cor}">
      <span class="eyebrow"><span class="day-dot"></span>Dia ${n} de ${dias.length} · ${fmtData(d.data, d.semana)} · ${esc(d.estado)}${n === diaDeHoje ? ' · hoje' : ''}</span>
      <h2 tabindex="-1">${esc(a.de)} <span class="arr">→</span> ${esc(a.para)}</h2>
      <p class="cc-meta"><b>${fmtKm(P.km)}</b>${tempo}</p>
      <p class="hint">Fuso: ${esc(d.fuso)}</p>
    </header>
    ${aviso}
    <div class="cc-acts">${navegar}
      <button type="button" class="btn btn--small" data-act="enquadrar">${ICONE.enquadrar}No mapa</button>
      <button type="button" class="btn btn--small" data-act="compartilhar">${ICONE.compartilhar}Compartilhar</button></div>
    ${dicaNav}
    <p class="cc-share" id="cc-share" role="status"></p>
    ${escolha}
    <section class="blk"><h3>Programação</h3><p>${esc(a.programacao)}</p></section>
    <section class="blk"><h3>Paradas <span>${shuttle ? 'de shuttle' : fmtKm(P.km)}</span></h3><ol class="stops" style="--c:${cor}">${lis}</ol></section>
    <section class="blk"><h3>Pernoite</h3>${pernoite}</section>
    <section class="blk"><h3>Para saber</h3><p class="cc-water">${esc(a.notas)}</p></section>
    ${al.length ? `<section class="blk"><h3>Alertas do dia <span>conferido em ${fmtDia(alertas.conferido_em)}</span></h3><ul class="alerts">${al.map((x) => htmlAlerta(x)).join('')}</ul></section>` : ''}
    <p class="cc-note">${P.obs ? `${esc(P.obs)} ` : ''}Na planilha: ${nf(d.km_planilha)} km, ${fmtH(d.horas_planilha)}.</p>`;
}
$('#day').addEventListener('click', async (e) => {
  const act = e.target.closest('[data-act]')?.dataset.act;
  const n = sel?.tipo === 'dia' ? sel.n : null;
  if (act === 'voltar') return mostrarViagem();
  if (act === 'ant' && n > 1) return abrirDia(n - 1, { foco: 'ant' });
  if (act === 'prox' && n < dias.length) return abrirDia(n + 1, { foco: 'prox' });
  if (act === 'enquadrar' && n) { if (mqPhone.matches) setSheet('peek'); return depoisDaGaveta(() => enquadrarDia(n)); }
  if (act === 'compartilhar' && n) return compartilhar(n);
  const go = e.target.closest('[data-ponto]');
  if (go) {
    if (mqPhone.matches) setSheet('peek');
    depoisDaGaveta(() => mapa?.voar(llPonto(go.dataset.ponto), 12.5));
  }
});
$('#day').addEventListener('change', (e) => {
  const r = e.target.closest('input[name^="rota-"]');
  if (!r || !sel?.n) return;
  const n = sel.n;
  store.set(`rota.${n}`, r.value);
  renderViagem();
  renderDia(n);
  atualizarMapa();
  enquadrarDia(n);
  $(`#r${r.value === 'B' ? 'b' : 'a'}-${n}`)?.focus({ preventScroll: true });   // as setas continuam trocando a rota
  anunciar(`Dia ${n}: ${r.value === 'B' ? 'plano B' : 'rota principal'}, ${fmtKm(rotaAtiva(diaPorN.get(n)).properties.km)}`);
});

async function compartilhar(n) {
  const d = diaPorN.get(n), a = ativo(d), msg = $('#cc-share');
  const url = `${location.origin}${location.pathname}#dia=${n}`;
  const text = `Dia ${n} da viagem de motorhome: ${a.de} → ${a.para} (${fmtData(d.data, d.semana)})`;
  if (matchMedia('(pointer: coarse)').matches && navigator.share) {
    try { await navigator.share({ title: 'Costa Oeste de motorhome', text, url }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  try {
    await navigator.clipboard.writeText(`${text}\n${url}`);
    msg.textContent = 'Link copiado. Cole no WhatsApp, no e-mail…';
  } catch {
    msg.innerHTML = `Copie o link: <input class="cc-link" readonly value="${esc(url)}" aria-label="Link do dia ${n}">`;
    const inp = msg.querySelector('input'); inp.addEventListener('focus', () => inp.select());
  }
}

// ---------- painel: alertas ----------
function renderAlertas() {
  const grupos = [
    ['Pedem atenção', (a) => a.gravidade === 'alta' || a.gravidade === 'media'],
    ['Para saber', (a) => a.gravidade === 'baixa' || a.gravidade === 'desconhecido'],
    ['Resolvidos desde a planilha', (a) => a.gravidade === 'resolvido'],
  ];
  const ord = (x, y) => ORDEM_G[x.gravidade] - ORDEM_G[y.gravidade] || (x.dias?.[0] ?? 99) - (y.dias?.[0] ?? 99);
  $('#alertas').innerHTML = `
    <p class="hint">Situação conferida em ${fmtDia(alertas.conferido_em)}, nas páginas oficiais (NPS, Caltrans, UDOT, CAL FIRE) e em jornais locais. Muda rápido: confira de novo na véspera de cada trecho.</p>
    <p class="cc-water">${esc(alertas.resumo)}</p>
    ${grupos.map(([t, fn]) => {
      const l = alertas.itens.filter(fn).sort(ord);
      return l.length ? `<div class="blk"><h3>${t} <span>${l.length}</span></h3><ul class="alerts">${l.map((a) => htmlAlerta(a, { comDias: true })).join('')}</ul></div>` : '';
    }).join('')}`;
}
$('#alertas').addEventListener('click', (e) => {
  const b = e.target.closest('[data-dia]');
  if (b) abrirDia(+b.dataset.dia);
});

// ---------- painel: mapa (fundo, relevo, trechos, opcionais) ----------
function renderOpcionais() {
  $('#opc-list').innerHTML = roteiro.opcionais.map((o) => {
    const P = rotaPorId.get(o.rota).properties, on = sel?.tipo === 'opc' && sel.id === o.id;
    const al = (o.alertas ?? []).map((id) => alertas.itens.find((a) => a.id === id)).filter(Boolean);
    return `<button type="button" class="opc" data-opc="${o.id}" aria-pressed="${on}"><i>${o.id.replace(/^O/, '')}</i>
      <b>${esc(o.de)} → ${esc(o.para)}</b><small>${fmtKm(P.km)} · ~${fmtH(horasMotorhome(P.horas))} · a partir do dia ${o.dia}</small></button>
      ${on ? `<div class="blk" style="padding:4px 2px 6px"><p>${esc(o.programacao)} Pernoite: ${esc(o.pernoite)} (${esc(o.tipo)}).</p>
        <p class="hint">${esc(o.notas)}</p>${al.length ? `<ul class="alerts">${al.map((a) => htmlAlerta(a)).join('')}</ul>` : ''}</div>` : ''}`;
  }).join('');
}
$('#opc-list').addEventListener('click', (e) => {
  const b = e.target.closest('[data-opc]');
  if (!b) return;
  const id = b.dataset.opc;
  if (sel?.tipo === 'opc' && sel.id === id) mostrarViagem({ painel: false }); else abrirOpcional(id);
  $(`[data-opc="${id}"]`)?.focus({ preventScroll: true });
});
{
  const fundo = store.get('fundo') === 'satelite' ? 'satelite' : 'mapa';
  $(`#f-${fundo === 'satelite' ? 'sat' : 'mapa'}`).checked = true;
  $$('input[name="fundo"]').forEach((r) => r.addEventListener('change', async () => {
    if (!r.checked) return;
    const res = await mapa?.setFundo(r.value);
    if (res === 'falhou') {   // sem sinal e sem o estilo guardado: volta a escolha
      aviso('Sem sinal para trocar o fundo agora.');
      $(`#f-${mapa.st.fundo === 'satelite' ? 'sat' : 'mapa'}`).checked = true;
      return;
    }
    store.set('fundo', r.value);
  }));
  const caixa = (id, chave, padrao, fn) => {
    const el = $(id); el.checked = (store.get(chave) ?? padrao) === '1';
    el.addEventListener('change', () => { store.set(chave, el.checked ? '1' : '0'); fn(el.checked); });
  };
  caixa('#t-sombra', 'sombra', '1', (on) => mapa?.setSombra(on));
  caixa('#t-3d', '3d', '0', (on) => mapa?.setRelevo3D(on));
  caixa('#t-planob', 'planob', '0', (on) => { verB = on; atualizarMapa(); });
  caixa('#t-opc', 'opc', '0', (on) => { verOpc = on; atualizarMapa(); });
}

// ---------- painel: sobre (armazenamento) ----------
async function mostrarArmazenamento() {
  const r = await resumoArmazenamento();
  const sw = navigator.serviceWorker?.controller ? 'O app já está guardado neste aparelho e abre sem sinal.' : 'O app ainda não está guardado para abrir sem sinal (recarregue a página uma vez com internet).';
  const uso = r.usoMB != null ? ` Ocupa ${nf(r.usoMB, r.usoMB < 10 ? 1 : 0)} MB${r.blocos != null ? `, com ${nf(r.blocos)} pedaços de mapa já vistos` : ''}.` : '';
  const pers = r.persistente ? ' O navegador prometeu não apagar.' : ' O navegador pode apagar se faltar espaço.';
  $('#offline-state').textContent = sw + uso + pers;
}

// ---------- escolher dia / viagem toda / opcional ----------
let badgeT = 0;
function mostrarSelo(txt) {
  const b = $('#day-badge');
  b.textContent = txt; b.classList.remove('is-out');
  clearTimeout(badgeT); badgeT = setTimeout(() => b.classList.add('is-out'), 1300);
}
function caixaDe(pts) {
  let a = Infinity, b = Infinity, c = -Infinity, e = -Infinity;
  for (const [x, y] of pts) { if (x < a) a = x; if (y < b) b = y; if (x > c) c = x; if (y > e) e = y; }
  return [[a, b], [c, e]];
}
function caixaDia(n) {
  const d = diaPorN.get(n), f = rotaAtiva(d);
  return caixaDe([...f.geometry.coordinates, ...listaParadas(d).map((it) => llPonto(it.id))]);
}
const caixaViagem = () => caixaDe(dias.flatMap((d) => rotaAtiva(d).geometry.coordinates));
function enquadrarDia(n, opcoes = {}) { mapa?.enquadrar(caixaDia(n), { maxZoom: ehShuttle(diaPorN.get(n)) ? 12.8 : 12, ...opcoes }); }

/**
 * Abre a ficha de um dia e enquadra o trecho. foco: para onde o foco do teclado volta depois de redesenhar
 * ('titulo', 'prox', 'ant'); sem nada, volta ao título só se o foco estava na interface.
 */
function abrirDia(n, { animar = true, painel = true, foco } = {}) {
  if (!diaPorN.has(n)) return mostrarViagem({ animar });
  const devolver = foco ?? (focoNaInterface() ? 'titulo' : null);
  const mudou = !(sel?.tipo === 'dia' && sel.n === n);
  sel = { tipo: 'dia', n };
  renderDia(n);
  $('#trip').hidden = true; $('#day').hidden = false;
  if (mudou) paneBody.scrollTop = 0;
  if (painel) showPane('roteiro', { sheet: 'half' });
  renderOpcionais();
  atualizarMapa();
  try { history.replaceState(null, '', `#dia=${n}`); } catch { /* sem histórico */ }
  const A = ativo(diaPorN.get(n));
  if (mudou) anunciar(`Dia ${n}: ${A.de} → ${A.para}`);
  if (animar && mudou) mostrarSelo(`DIA ${n}`);
  if (devolver) {
    const bt = devolver !== 'titulo' && $(`#day [data-act="${devolver}"]`);
    (bt && !bt.disabled ? bt : $('#day h2'))?.focus({ preventScroll: true });
  }
  depoisDaGaveta(() => enquadrarDia(n, animar ? {} : { duracao: 0 }));
}
function mostrarViagem({ animar = true, painel = true } = {}) {
  const veio = sel?.tipo === 'dia' ? sel.n : null, devolver = focoNaInterface();
  sel = null;
  renderViagem();
  $('#trip').hidden = false; $('#day').hidden = true;
  if (painel) showPane('roteiro', { sheet: 'half' });
  renderOpcionais();
  atualizarMapa();
  try { history.replaceState(null, '', location.pathname + location.search); } catch { /* sem histórico */ }
  if (devolver && veio) $(`#trip .day[data-dia="${veio}"]`)?.focus();
  depoisDaGaveta(() => mapa?.enquadrar(caixaViagem(), { maxZoom: 9, duracao: animar ? 1100 : 0 }));
}
function abrirOpcional(id) {
  const o = opcPorId.get(id);
  if (!o) return;
  sel = { tipo: 'opc', id };
  $('#trip').hidden = false; $('#day').hidden = true;
  renderViagem(); renderOpcionais(); atualizarMapa();
  try { history.replaceState(null, '', location.pathname + location.search); } catch { /* sem histórico */ }
  anunciar(`Opcional: ${o.de} → ${o.para}`);
  const f = rotaPorId.get(o.rota);
  const pts = [...f.geometry.coordinates, ...(o.marcadores ?? []).map(llPonto)];
  if (mqPhone.matches) setSheet('peek');
  depoisDaGaveta(() => mapa?.enquadrar(caixaDe(pts), { maxZoom: 11 }));
}
function aoClicarRota(p) {
  if (p.tipo === 'opcional') { const o = opcPorRota.get(p.id); if (o) { showPane('mapa', { sheet: 'peek' }); abrirOpcional(o.id); } return; }
  abrirDia(p.dia);
}

// ---------- teclado, link, sinal, onde estou ----------
addEventListener('keydown', (e) => {
  // o mapa usa as setas para se mover: quando ele já tratou a tecla, o atalho não age
  if (e.defaultPrevented || e.target.closest?.('input, textarea, select') || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key.startsWith('Arrow') && e.target.closest?.('#map')) return;
  if (e.key === 'h' || e.key === 'H') setUIHidden(!document.body.classList.contains('ui-hidden'));
  else if (e.key === 'Escape' && sel) mostrarViagem();
  else if (e.key === 'ArrowLeft' && sel?.tipo === 'dia' && sel.n > 1) abrirDia(sel.n - 1);
  else if (e.key === 'ArrowRight' && sel?.tipo === 'dia' && sel.n < dias.length) abrirDia(sel.n + 1);
});
addEventListener('hashchange', () => {
  const m = location.hash.match(/dia=(\d+)/);
  if (!m) return;
  if (!diaPorN.has(+m[1])) mostrarViagem();
  else if (+m[1] !== sel?.n) abrirDia(+m[1]);
});
{
  const net = $('#net');
  const upd = () => {
    net.hidden = navigator.onLine;
    // a internet voltou: se o mapa ficou no outro tema por falta de sinal, tenta de novo
    if (navigator.onLine && mapa && mapa.escuroReal !== isDark()) aplicarTema();
  };
  addEventListener('online', upd); addEventListener('offline', upd); upd();
}
{
  const btn = $('#locate');
  let watch = null;
  const parar = () => { if (watch != null) navigator.geolocation.clearWatch(watch); watch = null; btn.setAttribute('aria-pressed', 'false'); mapa?.setPosicao(null); };
  btn.addEventListener('click', () => {
    if (watch != null) return parar();
    if (!navigator.geolocation) return aviso('Este navegador não informa a posição.');
    btn.setAttribute('aria-pressed', 'true');
    let primeira = true;
    watch = navigator.geolocation.watchPosition((p) => {
      const ll = [p.coords.longitude, p.coords.latitude];
      mapa?.setPosicao(ll);
      if (primeira) { primeira = false; mapa?.voar(ll, 11); }
    }, (err) => {
      aviso(err.code === 1 ? 'Sem permissão para ver a posição. Libere a localização para este site.' : 'Não deu para achar a posição agora.');
      parar();
    }, { enableHighAccuracy: true, maximumAge: 30000, timeout: 25000 });
  });
}
$('#compass').addEventListener('click', () => mapa?.norte());
$('#rail-logo').addEventListener('click', () => mostrarViagem());

// ---------- início ----------
renderViagem();
renderAlertas();
renderOpcionais();
if (mqPhone.matches) { setSheet('peek'); collapsed = false; }
// no celular não há tecla H: "só o mapa" guardado de outra vez não vale ao abrir
setUIHidden(!mqPhone.matches && store.get('uiHidden') === '1');
layout();

try {
  progresso(0.35, 'Abrindo o mapa…');
  const { Mapa, pontoNaLinha } = await modMapa;
  for (const f of rotas.features) f.properties.meio = pontoNaLinha(f.geometry.coordinates, 0.5);
  progresso(0.6, 'Desenhando os trechos…');
  mapa = await Mapa.criar($('#map'), {
    escuro: isDark(), fundo: $('#f-sat').checked ? 'satelite' : 'mapa', sombra: $('#t-sombra').checked, relevo3D: $('#t-3d').checked,
    rotas: fcRotas(), limites: caixaViagem(), aoClicarRota,
  });
  mapa.map.on('rotate', () => { $('#compass-rose').style.transform = `rotate(${-mapa.map.getBearing()}deg)`; });
  syncPadding(false);
  if (mapa.escuroReal !== isDark()) aviso('Sem sinal: o mapa abriu no outro tema (claro/escuro) até a internet voltar.');
  progresso(1, 'Pronto');
} catch (e) {
  console.error(e);
  const semWebGL = /webgl|gpu/i.test(String(e?.message ?? e)) || e?.name === 'GPUInitializationError';
  mapa = null;
  $('#map').innerHTML = `<p class="sheet map-off">${semWebGL
    ? 'Este aparelho não conseguiu abrir o mapa (precisa de WebGL 2). Tente outro navegador ou atualize o sistema. O roteiro, os alertas e o botão Navegar continuam funcionando.'
    : 'Não deu para abrir o mapa agora (sem sinal e sem o mapa guardado). O roteiro, os alertas e o botão Navegar continuam funcionando; recarregue quando houver internet.'}</p>`;
}
window.app = { mapa, abrirDia, mostrarViagem, abrirOpcional, showPane, setSheet, setCollapsed, usaB };
{
  const m = location.hash.match(/dia=(\d+)/);
  if (m && diaPorN.has(+m[1])) abrirDia(+m[1], { animar: false });
  else if (diaDeHoje) abrirDia(diaDeHoje, { animar: false });
  else mostrarViagem({ animar: false, painel: false });
}
fecharAbertura();
// arruma o cache de pedaços de mapa uma vez por abertura, quando o aparelho estiver folgado
setTimeout(() => (window.requestIdleCallback ?? setTimeout)(() => aparar()), 20000);
