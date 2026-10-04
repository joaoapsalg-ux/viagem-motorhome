// App da viagem: painel (roteiro, mapa, alertas, sobre), escolha do dia e da rota, e o que o mapa deve mostrar.
import { $, $$, store, nf, fmtKm, fmtH, MOTORHOME, fmtData, fmtDia, esc, isDark, reduzMovimento, hojeISO, diasEntre, corDia, ICONE, TIPO_OPC, sol, fmtHora } from './util.js';
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
let roteiro, rotas, pontos, alertas, opcionais, fotos;
try {
  progresso(0.1, 'Lendo o roteiro…');
  [roteiro, rotas, pontos, alertas, opcionais, fotos] = await Promise.all([...['data/roteiro.json', 'data/rotas.geojson', 'data/pontos.json', 'data/alertas.json'].map(lerJSON),
    lerJSON('data/opcionais.json').catch(() => ({ itens: [] })),   // sem os opcionais, o resto funciona
    lerJSON('data/fotos.json').catch(() => ({ itens: {} }))]);      // fotos e descrições: 'p:<ponto>' e 'o:<opcional>'
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
let filtroOp = 'todos';   // filtro dos opcionais do dia: 'todos', 'quero' ou um tipo
/** opcionais que o casal marcou como "quero fazer" (guardado no aparelho) */
const quero = new Set((() => { try { return JSON.parse(store.get('quero') ?? '[]'); } catch { return []; } })());
function setQuero(id, on) { if (on) quero.add(id); else quero.delete(id); store.set('quero', JSON.stringify([...quero])); }

// ---------- módulos (src/mod/*.js; contrato em src/mod/LEIAME.md) ----------
/** registro do que os módulos acrescentam: blocos na ficha do dia, etiquetas na lista dos dias e ganchos */
const ext = {
  blocos: [], tagsDia: [], botoesDia: [], ganchos: {},
  registrar(e) {
    if (e.blocoDia) [].concat(e.blocoDia).forEach((b) => this.blocos.push(b));
    if (e.tagDia) this.tagsDia.push(e.tagDia);
    if (e.botaoDia) this.botoesDia.push(e.botaoDia);
    for (const k of ['aoRenderDia', 'aoRenderViagem', 'aoMostrarPainel', 'aoPosicao', 'aoSinal', 'aoMapa']) if (e[k]) (this.ganchos[k] ??= []).push(e[k]);
  },
  /** html dos blocos de um lugar da ficha: 'depois-paradas', 'depois-tempo', 'depois-opcionais' ou 'fim' */
  html(lugar, d) {
    return this.blocos.filter((b) => b.lugar === lugar).map((b) => { try { return b.html(d) ?? ''; } catch (err) { console.warn('módulo (bloco):', err); return ''; } }).join('');
  },
  botoes(d) { return this.botoesDia.map((fn) => { try { return fn(d) ?? ''; } catch (err) { console.warn('módulo (botão):', err); return ''; } }).join(''); },
  tags(d) { return this.tagsDia.map((fn) => { try { return fn(d) ?? ''; } catch (err) { console.warn('módulo (etiqueta):', err); return ''; } }).join(''); },
  chamar(nome, ...args) { for (const fn of this.ganchos[nome] ?? []) { try { fn(...args); } catch (err) { console.warn(`módulo (${nome}):`, err); } } },
};
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

// ---------- opcionais do dia (trilhas, mirantes, passeios…) ----------
const opPorId = new Map(opcionais.itens.map((o) => [o.id, o]));
/** opcionais de um dia (os das etapas O1–O3 ficam nas etapas) */
const opsDoDia = (n) => opcionais.itens.filter((o) => !o.etapa && (o.dia === n || o.tambem?.includes(n)));
const opsDaEtapa = (id) => opcionais.itens.filter((o) => o.etapa === id);
/** distância (km) de um ponto até uma linha e a posição ao longo dela (para pôr os opcionais na ordem do caminho) */
function posNaRota(coords, lon, lat) {
  const k = Math.cos(lat * Math.PI / 180);
  let melhor = Infinity, ordem = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    const ax = (coords[i][0] - lon) * k, ay = coords[i][1] - lat, bx = (coords[i + 1][0] - lon) * k, by = coords[i + 1][1] - lat;
    const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
    const t = L ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L)) : 0;
    const px = ax + t * dx, py = ay + t * dy, dd = px * px + py * py;
    if (dd < melhor) { melhor = dd; ordem = i + t; }
  }
  return { km: Math.sqrt(melhor) * 111.32, ordem };
}
const ORDEM_P = { imperdivel: 0, vale: 1, extra: 2 };
/** opcionais do dia na ordem em que aparecem no caminho */
function opsOrdenados(d) {
  const coords = rotaAtiva(d).geometry.coordinates;
  return opsDoDia(d.n).map((o) => ({ o, ...posNaRota(coords, o.lon, o.lat) }))
    .sort((a, b) => a.ordem - b.ordem || ORDEM_P[a.o.prioridade] - ORDEM_P[b.o.prioridade]);
}
/**
 * Tempo do dia: horas de luz (do nascer no começo ao pôr do sol no fim, cada um no seu fuso), estrada de motorhome e
 * opcionais marcados. Tudo em horas "de relógio corrido" (o fuso pode mudar no meio do dia).
 */
function tempoDoDia(d) {
  const a = ativo(d), P = rotaPorId.get(a.rota).properties;
  const ini = pontos[inicioDe(d)], fim = pontos[a.pernoite.ponto];
  const [u0, u1] = d.utc ?? [-7, -7];
  const nasce = sol(ini.lat, ini.lon, d.data, u0).nasce, poe = sol(fim.lat, fim.lon, d.data, u1).poe;
  const comeco = Math.max(nasce, d.livre_desde ?? 0);
  const luz = (poe - u1) - (comeco - u0);
  const estrada = P.tipo === 'shuttle' ? 0 : horasMotorhome(P.horas);
  const marcados = opsDoDia(d.n).filter((o) => quero.has(o.id) && o.dia === d.n);
  const opc = marcados.reduce((s, o) => s + (o.duracao_h || 0), 0);
  return { nasce, poe, comeco, luz, estrada, opc, n: marcados.length, ini, fim, mudaFuso: u0 !== u1 };
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
      aoClicar: () => verPonto(it.id),
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
  // opcionais: os do dia escolhido (respeitando o filtro) ou os da etapa; na viagem toda, só os marcados
  const lista = selDia ? opsDoDia(selDia.n).filter(passaFiltro)
    : sel?.tipo === 'opc' ? opsDaEtapa(sel.id)
      : opcionais.itens.filter((o) => quero.has(o.id));
  const ops = lista.map((o) => {
    const q = quero.has(o.id), t = TIPO_OPC[o.tipo] ?? TIPO_OPC.atracao;
    return {
      chave: `x:${o.id}`, lngLat: [o.lon, o.lat], cls: `mk--op${q ? ' is-quero' : ''}${o.estado === 'fechado' ? ' is-off' : ''}`, style: `--t:${t.cor}`,
      html: `<span class="g">${t.icone}</span><span class="nm">${esc(o.nome)}</span>`,
      titulo: `${t.nome}: ${o.nome}${q ? ' (quero fazer)' : ''}`,
      prioridade: q ? 60 : o.prioridade === 'imperdivel' ? 45 : o.prioridade === 'vale' ? 35 : 25,
      zoomNome: sel ? (q || o.prioridade === 'imperdivel' ? 8 : 10) : 99,
      aoClicar: () => verOp(o.id),
    };
  });
  return { pern, rotulosDias, paradas, ops };
}

function atualizarMapa() {
  if (!mapa) return;
  mapa.setRotas(fcRotas());
  const m = marcadores();
  mapa.setMarcadores('pernoites', m.pern);
  mapa.setMarcadores('dias', m.rotulosDias);
  mapa.setMarcadores('paradas', m.paradas);
  mapa.setMarcadores('opcionais', m.ops);
}
/** só os marcadores dos opcionais (ao marcar "quero fazer" ou trocar o filtro, sem refazer as linhas) */
function atualizarOps() { if (mapa) mapa.setMarcadores('opcionais', marcadores().ops); }
const passaFiltro = (o) => filtroOp === 'todos' || (filtroOp === 'quero' ? quero.has(o.id) : o.tipo === filtroOp);

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
  ext.chamar('aoMostrarPainel', name);
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
  $('meta[name="theme-color"]')?.setAttribute('content', isDark() ? '#0f1513' : '#e9ece4');
}
{
  const t = ['light', 'dark', 'auto'].includes(store.get('theme')) ? store.get('theme') : 'light';   // claro por padrão
  $(`#th-${t}`).checked = true;
  $$('input[name="theme"]').forEach((r) => r.addEventListener('change', () => { if (r.checked) setTheme(r.value); }));
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', aplicarTema);
  $('#sv-mapa').className = `sv ${isDark() ? 'sv--dark' : 'sv--map'}`;
  $('meta[name="theme-color"]')?.setAttribute('content', isDark() ? '#0f1513' : '#e9ece4');
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
    const nq = opsDoDia(d.n).filter((o) => o.dia === d.n && quero.has(o.id)).length;
    if (nq) tags.push(`<span class="tag tag--today">★ ${nq}</span>`);
    if (al.length) tags.push(`<span class="tag" style="--c:${COR_G[gravMax(al)]}">${al.length} alerta${al.length > 1 ? 's' : ''}</span>`);
    const tempo = P.tipo === 'shuttle' ? 'de shuttle' : `~${fmtH(horasMotorhome(P.horas))}`;
    return `<li><button type="button" class="day${d.n === diaDeHoje ? ' is-today' : ''}" data-dia="${d.n}" style="--c:${corDia(d.n)}">
      <i>${d.n}</i><b>${esc(A.de)} → ${esc(A.para)}</b><span class="tags">${tags.join('')}${ext.tags(d)}</span>
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
  ext.chamar('aoRenderViagem', $('#trip'));
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

/** foto e descrição (data/fotos.json): 'p:<ponto>' ou 'o:<opcional>' */
const ctxFoto = (chave) => fotos.itens?.[chave] ?? null;
const fotoPonto = (id) => { const f = ctxFoto('p:' + id); return f && (f.foto || f.texto) ? f : null; };
/** foto do Wikimedia Commons com crédito (carrega só quando aparece; sem sinal, fica o fundo neutro) */
function htmlFoto(f, cls = '') {
  return `<figure class="ft ${cls}"><img loading="lazy" decoding="async" src="${esc(f.mini || f.foto)}"${f.mini && f.foto ? ` srcset="${esc(f.mini)} 500w, ${esc(f.foto)} 960w" sizes="(max-width: 700px) 92vw, 380px"` : ''} alt="${esc(f.alt || f.titulo || '')}" onerror="this.closest('figure').classList.add('is-sem')">
    ${f.credito ? `<figcaption>${f.pagina ? `<a href="${esc(f.pagina)}" target="_blank" rel="noopener">${esc(f.credito)}</a>` : esc(f.credito)}</figcaption>` : ''}</figure>`;
}
/** detalhe de uma parada da lista: foto, descrição e botões (fechado até tocar no nome) */
function htmlPontoMais(id, papel) {
  const f = fotoPonto(id);
  if (!f) return '';
  const p = pontos[id];
  return `<div class="st-mais" id="st-${id}-${papel}" hidden>${f.foto ? htmlFoto(f) : ''}${f.texto ? `<p>${esc(f.texto)}</p>` : ''}
    <div class="op-acts"><button type="button" class="btn btn--small" data-ponto-mapa="${id}">${ICONE.enquadrar}No mapa</button>
      <a class="btn btn--small" href="https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lon}&travelmode=driving" target="_blank" rel="noopener">${ICONE.navegar}Ir até lá</a></div></div>`;
}
/** abre o detalhe de uma parada do dia aberto (vindo do marcador no mapa) */
function verPonto(id) {
  const bt = $(`#day .stops [data-ponto="${CSS.escape(id)}"][aria-expanded]`);
  if (!bt) { mapa?.voar(llPonto(id), 12.5); return; }
  if (mqPhone.matches) setSheet('half');
  if (bt.getAttribute('aria-expanded') !== 'true') bt.click();
  requestAnimationFrame(() => bt.closest('li')?.scrollIntoView({ block: 'center', behavior: reduzMovimento() ? 'auto' : 'smooth' }));
  if (!mqPhone.matches) mapa?.voar(llPonto(id), 12.5);
}
/** um opcional (cartão com "quero fazer", detalhes e botões) */
function htmlOp(o, { dia } = {}) {
  const t = TIPO_OPC[o.tipo] ?? TIPO_OPC.atracao, q = quero.has(o.id);
  const meta = [t.nome, o.duracao_h ? `~${fmtH(o.duracao_h)}` : '',
    o.distancia_km ? `${nf(o.distancia_km, o.distancia_km < 10 ? 1 : 0)} km${o.desnivel_m ? `, +${nf(o.desnivel_m)} m` : ''}` : '',
    o.dificuldade ? { facil: 'fácil', moderada: 'moderada', dificil: 'difícil' }[o.dificuldade] : ''].filter(Boolean).join(' · ');
  const det = [['Como chegar', o.acesso], ['Melhor hora', o.melhor_hora], ['Custo', o.custo], ['Reserva', o.reserva], ['Motorhome', o.motorhome], ['Dica', o.dica]]
    .filter(([, v]) => v).map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('');
  const outroDia = dia && o.dia !== dia ? `<span class="tag" style="--c:var(--ink-soft)">melhor no dia ${o.dia}</span>` : '';
  const prio = o.prioridade === 'imperdivel' ? '<span class="tag tag--today">Imperdível</span>' : '';
  const est = o.estado === 'fechado' ? 'fechado' : o.estado === 'restricao' ? 'restrição' : o.estado === 'nao_confirmado' ? 'sem confirmação' : '';
  let fonte = ''; try { fonte = o.fonte ? new URL(o.fonte).hostname.replace(/^www\./, '') : ''; } catch { /* sem link */ }
  return `<li class="op${q ? ' is-quero' : ''}${o.estado === 'fechado' ? ' is-off' : ''}" id="op-${esc(o.id)}" style="--t:${t.cor}">
    <div class="op-top">
      <i class="op-ic" aria-hidden="true">${t.icone}</i>
      <div class="op-tt"><b>${esc(o.nome)}</b><small>${esc(meta)}</small></div>
      <button type="button" class="op-q" data-quero="${esc(o.id)}" aria-pressed="${q}" aria-label="Quero fazer: ${esc(o.nome)}" title="Quero fazer">${ICONE.estrela}</button>
    </div>
    ${prio || outroDia || est ? `<div class="op-tags">${prio}${outroDia}${est ? `<span class="tag" style="--c:var(--g-${o.estado === 'fechado' ? 'alta' : 'media'})">${est}</span>` : ''}</div>` : ''}
    <p class="op-res">${esc(o.resumo)}</p>
    ${o.situacao ? `<p class="op-st" data-e="${esc(o.estado)}">${esc(o.situacao)}</p>` : ''}
    <details class="op-mais"><summary>Detalhes</summary>${ctxFoto('o:' + o.id)?.foto ? htmlFoto(ctxFoto('o:' + o.id), 'op-ft') : ''}<dl>${det}</dl>
      <div class="op-acts"><button type="button" class="btn btn--small" data-op-mapa="${esc(o.id)}">${ICONE.enquadrar}No mapa</button>
        <a class="btn btn--small" href="https://www.google.com/maps/dir/?api=1&destination=${o.lat},${o.lon}&travelmode=driving" target="_blank" rel="noopener">${ICONE.navegar}Ir até lá</a>
        ${o.fonte ? `<a class="btn btn--small" href="${esc(o.fonte)}" target="_blank" rel="noopener">${esc(fonte || 'Fonte')}</a>` : ''}</div>
    </details></li>`;
}
/** quanto o dia comporta: estrada + opcionais marcados × horas de luz */
function htmlTempo(d) {
  const T = tempoDoDia(d);
  if (d.prazo) {
    return `<section class="blk"><h3>Tempo do dia <span>${ICONE.sol}nasce ${fmtHora(T.nasce)}</span></h3>
      <p class="cc-warn">Devolução até ${d.prazo}h: com ~${fmtH(T.estrada)} de estrada, saia até ~${fmtHora(d.prazo - T.estrada - 0.5)}, ainda no escuro. Os opcionais deste dia são para depois da devolução, sem o veículo.</p></section>`;
  }
  const total = T.estrada + T.opc, sobra = T.luz - total, escala = Math.max(T.luz, total);
  const pc = (h) => `${Math.max(0, (h / escala) * 100).toFixed(1)}%`;
  const luzTxt = T.mudaFuso ? `nasce ${fmtHora(T.nasce)} (${esc(T.ini.nome)}) · põe ${fmtHora(T.poe)} (${esc(T.fim.nome)})` : `${fmtHora(T.nasce)}–${fmtHora(T.poe)}`;
  const partes = [T.estrada ? `~${fmtH(T.estrada)} de estrada` : 'sem estrada (shuttle)', T.n ? `${fmtH(T.opc)} de ${T.n === 1 ? '1 opcional marcado' : `${T.n} opcionais marcados`}` : 'nenhum opcional marcado'];
  const fim = sobra >= 0.75 ? `Sobram ~${fmtH(sobra)} para comer, descansar e imprevistos.`
    : sobra >= 0 ? 'Fica apertado: quase sem folga para comer e para imprevistos.'
      : `Passa ~${fmtH(-sobra)} do tempo de luz: tire algo, saia mais cedo ou dirija no escuro.`;
  return `<section class="blk"><h3>Tempo do dia <span>${ICONE.sol}${luzTxt}</span></h3>
    <div class="tbar${sobra < 0 ? ' is-over' : ''}" role="img" aria-label="${esc(partes.join(' + '))}, de ${fmtH(T.luz)} de luz">
      <span class="tb-est" style="width:${pc(T.estrada)};--c:${corDia(d.n)}"></span><span class="tb-opc" style="width:${pc(T.opc)}"></span>
      <i class="tb-luz" style="left:${pc(T.luz)}"></i></div>
    <p class="hint">${partes.join(' + ')}${T.n || T.estrada ? ` = ${fmtH(total)}` : ''}, de ${fmtH(T.luz)} de luz${d.livre_desde ? ` (a partir das ${d.livre_desde}h, depois da retirada)` : ''}. ${fim}</p>
    </section>`;
}
/** lista dos opcionais do dia, com filtro por tipo */
function htmlOpsDoDia(d) {
  const lista = opsOrdenados(d);
  if (!lista.length) return '';
  const tipos = [...new Set(lista.map((x) => x.o.tipo))].sort((a, b) => Object.keys(TIPO_OPC).indexOf(a) - Object.keys(TIPO_OPC).indexOf(b));
  if (filtroOp !== 'todos' && filtroOp !== 'quero' && !tipos.includes(filtroOp)) filtroOp = 'todos';
  const nq = lista.filter((x) => quero.has(x.o.id)).length;
  const chip = (v, txt) => `<input type="radio" name="fop-${d.n}" id="fop-${d.n}-${v}" value="${v}"${filtroOp === v ? ' checked' : ''}><label for="fop-${d.n}-${v}">${txt}</label>`;
  const vis = lista.filter((x) => passaFiltro(x.o));
  return `<section class="blk" id="ops-dia"><h3>Opcionais do dia <span>${lista.length}${nq ? ` · ${nq} marcado${nq > 1 ? 's' : ''}` : ''}</span></h3>
    <div class="apt-modes" role="radiogroup" aria-label="Filtrar os opcionais">${chip('todos', 'Todos')}${chip('quero', `${ICONE.estrela}Marcados`)}${tipos.map((t) => chip(t, TIPO_OPC[t].plural)).join('')}</div>
    <p class="hint">Na ordem do caminho. Toque na estrela para marcar o que quer fazer: o tempo do dia e o mapa mostram os marcados.</p>
    ${vis.length ? `<ul class="ops">${vis.map((x) => htmlOp(x.o, { dia: d.n })).join('')}</ul>` : '<p class="hint">Nenhum opcional neste filtro.</p>'}
    <p class="cc-note">Pesquisados em ${fmtDia(opcionais.conferido_em)} nas páginas oficiais; horários, taxas e fechamentos mudam: confira antes de ir.</p></section>`;
}
/** abre o dia do opcional e mostra o cartão dele */
function verOp(id) {
  const o = opPorId.get(id);
  if (!o) return;
  if (o.etapa) { showPane('mapa', { sheet: 'half' }); if (!(sel?.tipo === 'opc' && sel.id === o.etapa)) abrirOpcional(o.etapa); }
  else {
    const n = sel?.tipo === 'dia' && (o.dia === sel.n || o.tambem?.includes(sel.n)) ? sel.n : o.dia;
    if (!passaFiltro(o)) filtroOp = 'todos';
    if (!(sel?.tipo === 'dia' && sel.n === n)) abrirDia(n, { foco: null }); else { renderDia(n); showPane('roteiro', { sheet: 'half' }); }
  }
  requestAnimationFrame(() => {
    const el = document.getElementById(`op-${id}`);
    if (!el) return;
    el.scrollIntoView({ block: 'center', behavior: reduzMovimento() ? 'auto' : 'smooth' });
    el.classList.remove('is-flash'); void el.offsetWidth; el.classList.add('is-flash');
  });
}
function marcarQuero(id, on) {
  setQuero(id, on);
  $$(`[data-quero="${CSS.escape(id)}"]`).forEach((b) => { b.setAttribute('aria-pressed', String(on)); b.closest('.op')?.classList.toggle('is-quero', on); });
  if (sel?.tipo === 'dia') {   // o tempo do dia e a contagem mudam
    const tempo = $('#day .tbar')?.closest('.blk'), d = diaPorN.get(sel.n);
    if (tempo) tempo.outerHTML = htmlTempo(d);
    const h3 = $('#ops-dia h3 span'), lista = opsDoDia(d.n), nq = lista.filter((o) => quero.has(o.id)).length;
    if (h3) h3.textContent = `${lista.length}${nq ? ` · ${nq} marcado${nq > 1 ? 's' : ''}` : ''}`;
  }
  atualizarOps();
  anunciar(on ? `Marcado: ${opPorId.get(id)?.nome}` : `Desmarcado: ${opPorId.get(id)?.nome}`);
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
      <button type="button" class="go" data-ponto="${it.id}"${fotoPonto(it.id) ? ` aria-expanded="false" aria-controls="st-${it.id}-${it.papel}"` : ''}><b>${esc(nome)}</b><small>${esc(sub)}${it.papel !== 'parada' && nota ? ` · ${esc(nota)}` : ''}</small></button>
      <span class="leg">${leg}</span>${htmlPontoMais(it.id, it.papel)}</li>`;
  }).join('');
  const pn = a.pernoite;
  const preco = pn.preco ? `US$ ${pn.preco}/noite` : '';
  const fp = fotoPonto(pn.ponto);
  const pernoite = `<div class="stay-card">${fp?.foto ? htmlFoto(fp, 'stay-ft') : ''}<i>${pn.tipo === 'Hotel' ? ICONE.cama : ICONE.lua}</i>
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
      <button type="button" class="btn btn--small" data-act="compartilhar">${ICONE.compartilhar}Compartilhar</button>${ext.botoes(d)}</div>
    ${dicaNav}
    <p class="cc-share" id="cc-share" role="status"></p>
    ${escolha}
    <section class="blk"><h3>Programação</h3><p>${esc(a.programacao)}</p></section>
    <section class="blk"><h3>Paradas <span>${shuttle ? 'de shuttle' : fmtKm(P.km)}</span></h3><ol class="stops" style="--c:${cor}">${lis}</ol></section>
    ${ext.html('depois-paradas', d)}
    ${htmlTempo(d)}
    ${ext.html('depois-tempo', d)}
    ${htmlOpsDoDia(d)}
    ${ext.html('depois-opcionais', d)}
    <section class="blk"><h3>Pernoite</h3>${pernoite}</section>
    <section class="blk"><h3>Para saber</h3><p class="cc-water">${esc(a.notas)}</p></section>
    ${al.length ? `<section class="blk"><h3>Alertas do dia <span>conferido em ${fmtDia(alertas.conferido_em)}</span></h3><ul class="alerts">${al.map((x) => htmlAlerta(x)).join('')}</ul></section>` : ''}
    ${ext.html('fim', d)}
    <p class="cc-note">${P.obs ? `${esc(P.obs)} ` : ''}Na planilha: ${nf(d.km_planilha)} km, ${fmtH(d.horas_planilha)}.</p>`;
  ext.chamar('aoRenderDia', n, $('#day'));
}
/** estrela "quero fazer" e "No mapa" dos cartões de opcional; devolve true se tratou o clique */
function cliqueOp(e) {
  const qb = e.target.closest('[data-quero]');
  if (qb) { marcarQuero(qb.dataset.quero, qb.getAttribute('aria-pressed') !== 'true'); return true; }
  const om = e.target.closest('[data-op-mapa]');
  if (om) {
    const o = opPorId.get(om.dataset.opMapa);
    if (o) { if (mqPhone.matches) setSheet('peek'); depoisDaGaveta(() => mapa?.voar([o.lon, o.lat], 13)); }
    return true;
  }
  return false;
}$('#day').addEventListener('click', async (e) => {
  const act = e.target.closest('[data-act]')?.dataset.act;
  const n = sel?.tipo === 'dia' ? sel.n : null;
  if (act === 'voltar') return mostrarViagem();
  if (act === 'ant' && n > 1) return abrirDia(n - 1, { foco: 'ant' });
  if (act === 'prox' && n < dias.length) return abrirDia(n + 1, { foco: 'prox' });
  if (act === 'enquadrar' && n) { if (mqPhone.matches) setSheet('peek'); return depoisDaGaveta(() => enquadrarDia(n)); }
  if (act === 'compartilhar' && n) return compartilhar(n);
  if (cliqueOp(e)) return;
  const pm = e.target.closest('[data-ponto-mapa]');
  if (pm) {
    if (mqPhone.matches) setSheet('peek');
    return depoisDaGaveta(() => mapa?.voar(llPonto(pm.dataset.pontoMapa), 12.5));
  }
  const go = e.target.closest('[data-ponto]');
  if (go?.hasAttribute('aria-expanded')) {   // tem foto/descrição: abre e fecha o detalhe
    const aberto = go.getAttribute('aria-expanded') === 'true', alvo = document.getElementById(go.getAttribute('aria-controls'));
    go.setAttribute('aria-expanded', String(!aberto)); if (alvo) alvo.hidden = aberto;
    return;
  }
  if (go) {
    if (mqPhone.matches) setSheet('peek');
    depoisDaGaveta(() => mapa?.voar(llPonto(go.dataset.ponto), 12.5));
  }
});
$('#day').addEventListener('change', (e) => {
  const fo = e.target.closest('input[name^="fop-"]');
  if (fo && sel?.n) {   // filtro dos opcionais: refaz só a lista e os marcadores
    filtroOp = fo.value;
    $('#ops-dia').outerHTML = htmlOpsDoDia(diaPorN.get(sel.n));
    $(`#fop-${sel.n}-${fo.value}`)?.focus({ preventScroll: true });
    atualizarOps();
    return;
  }
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
        <p class="hint">${esc(o.notas)}</p>${al.length ? `<ul class="alerts">${al.map((a) => htmlAlerta(a)).join('')}</ul>` : ''}
        ${opsDaEtapa(o.id).length ? `<ul class="ops">${opsDaEtapa(o.id).map((x) => htmlOp(x)).join('')}</ul>` : ''}</div>` : ''}`;
  }).join('');
}
$('#opc-list').addEventListener('click', (e) => {
  if (cliqueOp(e)) return;
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
    mapa?.setSemSinal(!navigator.onLine);
    ext?.chamar('aoSinal', navigator.onLine);
    // a internet voltou: se o mapa ficou no outro tema por falta de sinal, tenta de novo
    if (navigator.onLine && mapa && mapa.escuroReal !== isDark()) aplicarTema();
  };
  addEventListener('online', upd); addEventListener('offline', upd); upd();
}
{
  const btn = $('#locate');
  let watch = null;
  const parar = () => { if (watch != null) navigator.geolocation.clearWatch(watch); watch = null; btn.setAttribute('aria-pressed', 'false'); mapa?.setPosicao(null); ext.chamar('aoPosicao', null); };
  btn.addEventListener('click', () => {
    if (watch != null) return parar();
    if (!navigator.geolocation) return aviso('Este navegador não informa a posição.');
    btn.setAttribute('aria-pressed', 'true');
    let primeira = true;
    watch = navigator.geolocation.watchPosition((p) => {
      const ll = [p.coords.longitude, p.coords.latitude];
      mapa?.setPosicao(ll);
      ext.chamar('aoPosicao', ll, p.coords);
      if (primeira) { primeira = false; mapa?.voar(ll, 11); }
    }, (err) => {
      aviso(err.code === 1 ? 'Sem permissão para ver a posição. Libere a localização para este site.' : 'Não deu para achar a posição agora.');
      parar();
    }, { enableHighAccuracy: true, maximumAge: 30000, timeout: 25000 });
  });
}
$('#compass').addEventListener('click', () => mapa?.norte());
$('#rail-logo').addEventListener('click', () => mostrarViagem());

// ---------- carga dos módulos ----------
const MODULOS = ['clima', 'preparar', 'gastos', 'estrada', 'agenda'];   // os que ainda estão em construção entram quando ficarem prontos
/** o que os módulos podem usar do app (ver src/mod/LEIAME.md) */
const ctx = {
  dados: { roteiro, rotas, pontos, alertas, opcionais, fotos }, dias, diaPorN, rotaPorId, opPorId,
  /** foto e descrição de um ponto ('p:mather') ou opcional ('o:<id>'): { titulo, texto, foto, mini, credito, licenca, pagina, alt } */
  foto: (chave) => fotos.itens?.[chave] ?? null,
  ativo, rotaAtiva, inicioDe, listaParadas, tempoDoDia, usaB, opsDoDia, posNaRota, llPonto, nomePonto, horasMotorhome,
  quero: () => new Set(quero), diaAberto: () => (sel?.tipo === 'dia' ? sel.n : null), diaDeHoje, HOJE,
  abrirDia, mostrarViagem, showPane, setSheet, setCollapsed, aviso, anunciar,
  /** o painel está recolhido? (no celular: só a barra embaixo) */
  recolhido: () => collapsed,
  /** refaz a ficha do dia aberto mantendo a rolagem (para quando um módulo recebe dados novos) */
  atualizarDia: () => { if (sel?.tipo === 'dia') { const y = paneBody.scrollTop; renderDia(sel.n); paneBody.scrollTop = y; } },
  atualizarViagem: () => renderViagem(),
  mapa: () => mapa, celular: () => mqPhone.matches,
  util: { $, $$, store, nf, fmtKm, fmtH, fmtData, fmtDia, esc, isDark, reduzMovimento, corDia, ICONE, TIPO_OPC, sol, fmtHora, MOTORHOME },
  registrar: (e) => ext.registrar(e),
};
const modulosProntos = Promise.all(MODULOS.map((m) => import(`./mod/${m}.js`)
  .then((mod) => mod.iniciar?.(ctx))
  .catch((e) => console.warn(`módulo ${m}:`, e))))
  .then(() => { renderViagem(); ctx.atualizarDia(); if (mapa) ext.chamar('aoMapa', mapa); });
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
    rotas: fcRotas(), limites: caixaViagem(), aoClicarRota, semSinal: !navigator.onLine,
  });
  ext.chamar('aoMapa', mapa);
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
window.app = { mapa, abrirDia, mostrarViagem, abrirOpcional, showPane, setSheet, setCollapsed, usaB, ext, ctx };
// os módulos entram antes da primeira ficha (no máximo 4 s de espera; um módulo com erro não trava o app)
await Promise.race([modulosProntos, new Promise((ok) => setTimeout(ok, 4000))]);
{
  const m = location.hash.match(/dia=(\d+)/);
  if (m && diaPorN.has(+m[1])) abrirDia(+m[1], { animar: false });
  else if (diaDeHoje) abrirDia(diaDeHoje, { animar: false });
  else mostrarViagem({ animar: false, painel: false });
}
fecharAbertura();
// arruma o cache de pedaços de mapa uma vez por abertura, quando o aparelho estiver folgado
setTimeout(() => (window.requestIdleCallback ?? setTimeout)(() => aparar()), 20000);
