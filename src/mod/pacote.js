// Mapa da viagem para usar sem sinal: baixa o topográfico do USGS (domínio público; a exportação de blocos é
// permitida) num corredor de 4 km para cada lado das estradas da viagem e em volta dos pernoites e paradas, e guarda
// no cache próprio 'mapa-pacote-v1' (o aparar do tilecache.js não mexe nele). O tilecache.js acha esses blocos
// (caches.match procura em todos os caches) e o mapa mostra a camada 'topo' quando não há sinal.
// A OpenFreeMap fica de fora: os termos dela proíbem baixar em massa. Contrato dos módulos: src/mod/LEIAME.md.

const CACHE = 'mapa-pacote-v1';
// o mesmo endereço de TOPO_URL (src/mapa.js); trocado pelo de lá assim que o mapa carregar
let TOPO = 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}';
const R_CORREDOR = 4000;   // m para cada lado da estrada
const R_PONTO = 3000;      // m em volta de pernoites e paradas
const KB_BLOCO = 24;       // tamanho médio de um bloco (estimativa, até medir os baixados)
const PARALELO = 4;        // blocos baixando ao mesmo tempo
const TENTATIVAS = 3;      // a primeira e mais 2
const FALHAS_SEGUIDAS = 12; // tantos blocos seguidos sem resposta: a conexão caiu (mesmo sem o aviso de "offline")
const LIMITE_USGS = 100000;
const PACOTES = {
  basico: { nome: 'Básico', corredor: [3, 12], pontos: [3, 12],
    texto: 'Estradas, cidades e relevo ao longo do caminho (até o zoom 12).' },
  completo: { nome: 'Completo', corredor: [3, 13], pontos: [3, 15],
    texto: 'O básico, mais perto no caminho (zoom 13) e com ruas e trilhas em volta dos pernoites e paradas (até o zoom 15).' },
};
const temCache = typeof caches !== 'undefined';

let ctx, U;
let sec = null;            // a seção no Sobre › Sem sinal
let meta = lerMeta();      // o que foi guardado: { n, bytes, data, porZoom: { z: [n, bytes] }, sem: [404], interrompido, tipo, planosB, opc }
let guardados = null;      // Set das URLs já no cache (lido uma vez; atualizado a cada bloco)
let job = null;            // download em andamento
let pausaSinal = null;     // escolha do download parado porque a internet caiu (volta sozinho)
const planos = new Map();  // contas já feitas (chave: pacote + linhas)

// ---------- conta dos blocos (Web Mercator, XYZ) ----------
const PI = Math.PI, CIRC = 2 * PI * 6378137, M_GRAU = CIRC / 360;
const fx = (lon, n) => ((lon + 180) / 360) * n;
const fy = (lat, n) => { const s = Math.sin((lat * PI) / 180); return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * PI)) * n; };

/** marca os blocos do zoom z que tocam o círculo de raio r (m) em volta de [lon, lat] (chave = x·2^z + y) */
function marcarCirculo(set, z, lon, lat, r) {
  const n = 2 ** z, cx = fx(lon, n), cy = fy(lat, n);
  const rt = (r * n) / (CIRC * Math.cos((lat * PI) / 180));   // raio em blocos (no Mercator, igual em x e y)
  for (let x = Math.floor(cx - rt); x <= Math.floor(cx + rt); x++) {
    const dx = Math.max(x - cx, 0, cx - x - 1);
    for (let y = Math.max(0, Math.floor(cy - rt)); y <= Math.min(n - 1, Math.floor(cy + rt)); y++) {
      const dy = Math.max(y - cy, 0, cy - y - 1);
      if (dx * dx + dy * dy <= rt * rt) set.add(((x % n) + n) % n * n + y);
    }
  }
}
/** corredor: círculos ao longo da linha, em passos menores que 1/3 do bloco e que metade do raio */
function marcarLinha(set, z, coords, r) {
  const n = 2 ** z;
  marcarCirculo(set, z, coords[0][0], coords[0][1], r);
  for (let i = 1; i < coords.length; i++) {
    const [lon0, lat0] = coords[i - 1], [lon, lat] = coords[i];
    const k = Math.cos((((lat0 + lat) / 2) * PI) / 180);
    const len = Math.hypot((lon - lon0) * k * M_GRAU, (lat - lat0) * M_GRAU);
    const passo = Math.min(r / 2, (CIRC * k) / n / 3);
    const partes = Math.max(1, Math.ceil(len / passo));
    for (let j = 1; j <= partes; j++) { const t = j / partes; marcarCirculo(set, z, lon0 + (lon - lon0) * t, lat0 + (lat - lat0) * t, r); }
  }
}
const linhasDe = (g) => (g.type === 'MultiLineString' ? g.coordinates : [g.coordinates]);

/** rotas que entram no pacote: as em uso de cada dia (+ planos B e etapas opcionais, se escolhidos) */
function rotasDoPacote(planosB, opc) {
  const ids = [];
  const incluir = (id) => { if (id && !ids.includes(id) && ctx.rotaPorId.has(id)) ids.push(id); };
  for (const d of ctx.dias) incluir(ctx.rotaAtiva(d).properties.id);
  if (planosB) for (const d of ctx.dias) if (d.planoB) { incluir(d.rota); incluir(d.planoB.rota); }
  if (opc) for (const o of ctx.dados.roteiro.opcionais ?? []) incluir(o.rota);
  return ids;
}
/** pernoites e paradas (saída, paradas e pernoite de cada dia) */
function pontosDoPacote(planosB, opc) {
  const ids = new Set();
  for (const d of ctx.dias) {
    for (const it of ctx.listaParadas(d)) ids.add(it.id);
    if (planosB && d.planoB) [...d.paradas, d.pernoite?.ponto, ...(d.planoB.paradas ?? []), d.planoB.pernoite?.ponto].forEach((id) => id && ids.add(id));
  }
  if (opc) {
    for (const o of ctx.dados.roteiro.opcionais ?? []) {
      [...(ctx.rotaPorId.get(o.rota)?.properties.pontos ?? []), ...(o.marcadores ?? [])].forEach((id) => ids.add(id));
    }
  }
  return [...ids].filter((id) => ctx.dados.pontos[id]).map((id) => ctx.llPonto(id));
}
const urlBloco = (z, x, y) => TOPO.replace('{z}', z).replace('{x}', x).replace('{y}', y);

/**
 * Blocos de um pacote: { itens: [{ u, z }] (zoom de baixo primeiro, na ordem do caminho), porZoom: [[z, n]], total, bytes }.
 * zMax: só para testes (baixar um pedaço pequeno).
 */
export function calcular({ tipo = 'basico', planosB = false, opc = false, zMax = 99 } = {}) {
  const P = PACOTES[tipo] ?? PACOTES.basico;
  const rotas = rotasDoPacote(planosB, opc);
  const chave = `${tipo}|${planosB}|${opc}|${zMax}|${rotas.join(',')}|${TOPO}`;
  if (planos.has(chave)) return planos.get(chave);
  const linhas = rotas.flatMap((id) => linhasDe(ctx.rotaPorId.get(id).geometry));
  const pts = pontosDoPacote(planosB, opc);
  const itens = [], porZoom = [];
  const z1 = Math.min(zMax, Math.max(P.corredor[1], P.pontos[1]));
  for (let z = Math.min(P.corredor[0], P.pontos[0]); z <= z1; z++) {
    const set = new Set();
    if (z >= P.corredor[0] && z <= P.corredor[1]) for (const c of linhas) marcarLinha(set, z, c, R_CORREDOR);
    if (z >= P.pontos[0] && z <= P.pontos[1]) for (const [lon, lat] of pts) marcarCirculo(set, z, lon, lat, R_PONTO);
    const n = 2 ** z;
    for (const k of set) itens.push({ u: urlBloco(z, Math.floor(k / n), k % n), z });
    porZoom.push([z, set.size]);
  }
  const plano = { tipo, planosB, opc, rotas, itens, porZoom, total: itens.length };
  plano.bytes = peso(plano);
  planos.set(chave, plano);
  // cada conta guarda milhares de endereços: ficam só as 4 últimas (as 2 da tela e as de troca de opção)
  if (planos.size > 4) planos.delete(planos.keys().next().value);
  return plano;
}
/** tamanho estimado do pacote inteiro (a média por zoom melhora a cada download) */
const peso = (plano) => plano.porZoom.reduce((s, [z, q]) => s + q * media(z), 0);
/** tamanho médio de um bloco do zoom z: o medido nos já baixados (com 20 ou mais) ou a estimativa */
function media(z) {
  const [n, b] = meta.porZoom?.[z] ?? [0, 0];
  return n >= 20 ? b / n : KB_BLOCO * 1024;
}
/** quantos blocos do plano faltam guardar e quanto pesam (estimado) */
function faltam(plano) {
  if (!guardados) return { n: plano.total, bytes: peso(plano) };
  let n = 0, bytes = 0;
  for (const it of plano.itens) if (!temBloco(it.u)) { n++; bytes += media(it.z); }
  return { n, bytes };
}
/** já guardado, ou o USGS respondeu que o bloco não existe (404: não adianta pedir de novo) */
const temBloco = (u) => guardados?.has(u) || semBloco.has(u);
const semBloco = new Set(meta.sem ?? []);

// ---------- guardado no aparelho ----------
function lerMeta() {
  try { return { porZoom: {}, ...JSON.parse(localStorage.getItem('viagem-motorhome.pacote.meta') ?? '{}') }; } catch { return { porZoom: {} }; }
}
function salvarMeta() { U?.store.set('pacote.meta', JSON.stringify(meta)); }
async function lerGuardados(denovo = false) {
  if (guardados && !denovo) return guardados;
  const s = new Set();
  try { if (temCache && await caches.has(CACHE)) for (const r of await (await caches.open(CACHE)).keys()) s.add(r.url); } catch { /* sem Cache API */ }
  if (guardados && job) for (const u of guardados) s.add(u);   // o download em andamento continua contando
  guardados = s;
  // o navegador apagou parte (falta de espaço) ou a anotação se perdeu: o tamanho acompanha a contagem real
  if (s.size !== (meta.n ?? 0)) {
    const porBloco = meta.n && meta.bytes ? meta.bytes / meta.n : KB_BLOCO * 1024;
    meta.bytes = Math.round(porBloco * s.size); meta.n = s.size; salvarMeta();
  }
  return s;
}
async function espaco() {
  const r = { livre: null, persistente: false };
  try { const e = await navigator.storage?.estimate?.(); if (e?.quota) r.livre = Math.max(0, e.quota - e.usage); } catch { /* sem StorageManager */ }
  try { r.persistente = (await navigator.storage?.persisted?.()) ?? false; } catch { /* idem */ }
  return r;
}

// ---------- download ----------
/** sinal que cai com a pausa ou depois de ms (feito à mão: o AbortSignal.any não existe no Safari antigo) */
function comPrazo(signal, ms) {
  const c = new AbortController();
  const parar = () => c.abort();
  const t = setTimeout(parar, ms);
  signal.addEventListener('abort', parar, { once: true });
  return { signal: c.signal, fim: () => { clearTimeout(t); signal.removeEventListener('abort', parar); } };
}
const esperar = (ms, signal) => new Promise((ok) => {
  const t = setTimeout(ok, ms);
  signal.addEventListener('abort', () => { clearTimeout(t); ok(); }, { once: true });
});
/** um bloco, com 2 novas tentativas; 404 = não existe (ignorado). Devolve { bytes } | { n404 } | { erro } | 'parou' */
async function baixarBloco(url, signal, cache) {
  for (let t = 1; t <= TENTATIVAS; t++) {
    const p = comPrazo(signal, 20000);
    try {
      const r = await fetch(url, { mode: 'cors', credentials: 'omit', cache: 'no-store', signal: p.signal });
      if (r.status === 404) return { n404: true };
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const b = await r.blob();
      if (!b.size || (b.type && !b.type.startsWith('image/'))) throw new Error('resposta sem imagem');
      await cache.put(url, new Response(b, { headers: { 'Content-Type': b.type || 'image/png' } }));
      return { bytes: b.size };
    } catch (e) {
      if (e?.name === 'QuotaExceededError') throw e;
      if (signal.aborted) return 'parou';
      if (t === TENTATIVAS) return { erro: e };
    } finally { p.fim(); }
    await esperar(t === 1 ? 1500 : 5000, signal);
    if (signal.aborted) return 'parou';
  }
  return 'parou';
}
// a tela acesa enquanto baixa (o celular pausa o app quando a tela apaga)
let trava = null;
async function travarTela(on) {
  try {
    if (on && !trava && navigator.wakeLock && document.visibilityState === 'visible') {
      trava = await navigator.wakeLock.request('screen');
      trava.addEventListener('release', () => { trava = null; });
    } else if (!on && trava) { await trava.release(); trava = null; }
  } catch { /* sem permissão: segue sem */ }
}

/**
 * Baixa o que falta do pacote escolhido (pula os já guardados). Devolve um resumo
 * { guardados, novos, n404, falhas, MB, motivo } quando termina ou para.
 */
export async function baixar(opcoes = escolha()) {
  if (job || apagando || !temCache) return null;
  if (!navigator.onLine) { status('Sem internet agora. Baixe quando estiver no Wi-Fi.', 'erro'); return null; }
  const plano = calcular(opcoes);
  if (plano.total > LIMITE_USGS) { status(`Pacote grande demais (${U.nf(plano.total)} blocos; o USGS permite até ${U.nf(LIMITE_USGS)}).`, 'erro'); return null; }
  pausaSinal = null;
  navigator.storage?.persist?.().then(() => desenharEspaco()).catch(() => {});   // pede para o navegador não apagar
  await lerGuardados(true);   // de novo: o navegador pode ter apagado algo
  if (job) return null;       // dois toques seguidos: vale o primeiro
  const fila = plano.itens.filter((it) => !temBloco(it.u));
  const j = job = { ctrl: new AbortController(), opcoes, fila, i: 0, plano, total: plano.total, ja: plano.total - fila.length,
    novos: 0, n404: 0, falhas: 0, seguidas: 0, bytes: 0, t0: performance.now(), motivo: null };
  Object.assign(meta, { tipo: plano.tipo, planosB: plano.planosB, opc: plano.opc, interrompido: true });
  salvarMeta();
  travarTela(true);
  status('');
  desenhar();
  ctx.anunciar(`Baixando o mapa: ${U.nf(fila.length)} blocos.`);
  try {
    const cache = await caches.open(CACHE);
    // cada trabalhador trata o próprio erro: o download só termina quando os 4 pararam
    await Promise.all(Array.from({ length: PARALELO }, () => trabalhador(j, cache).catch((e) => falhou(j, e))));
  } catch (e) { falhou(j, e); }
  job = null;
  travarTela(false);
  const parou = j.ctrl.signal.aborted;
  meta.n = guardados.size;
  if (j.novos) meta.data = hojeLocal();
  meta.interrompido = parou || j.falhas > 0;
  meta.sem = [...semBloco].slice(-2000);
  salvarMeta();
  desenharEspaco();
  // a internet caiu e já voltou enquanto os pedidos terminavam: segue sozinho
  if (j.motivo === 'sinal') setTimeout(() => { if (navigator.onLine && pausaSinal && !job) { const e = pausaSinal; pausaSinal = null; baixar(e); } }, 1500);
  const mb = fmtMB(meta.bytes);
  if (j.motivo === 'espaco') status(`Acabou o espaço no aparelho: ${U.nf(meta.n)} blocos guardados (${mb}). Libere espaço${j.plano.tipo === 'completo' ? ' ou escolha o pacote Básico' : ''}.`, 'erro');
  else if (j.motivo === 'sinal') status('A internet caiu: o download continua sozinho quando ela voltar.', 'erro');
  else if (j.motivo === 'rede') status(`A conexão parou de responder: ${U.nf(meta.n)} blocos guardados (${mb}). Toque em Continuar quando o sinal melhorar.`, 'erro');
  else if (j.motivo === 'erro') status('O download parou por um erro. Toque em Continuar para tentar de novo.', 'erro');
  else if (parou) status(`Pausado: ${U.nf(meta.n)} blocos guardados (${mb}). Toque em Continuar quando quiser.`);
  else if (j.falhas) status(`Faltaram ${U.nf(j.falhas)} blocos (falha na rede). Toque em Continuar para tentar de novo.`, 'erro');
  else { status(`Pronto: ${U.nf(meta.n)} blocos guardados (${mb}). Sem sinal, o topográfico aparece no mapa.`); ctx.aviso('Mapa da viagem guardado para usar sem sinal.'); }
  desenharSemPerderFoco();
  return { guardados: meta.n, novos: j.novos, n404: j.n404, falhas: j.falhas, MB: +(meta.bytes / 2 ** 20).toFixed(2), motivo: j.motivo ?? (parou ? 'pausa' : null) };
}
async function trabalhador(j, cache) {
  while (!j.ctrl.signal.aborted && j.i < j.fila.length) {
    const it = j.fila[j.i++];
    const r = await baixarBloco(it.u, j.ctrl.signal, cache);
    if (r === 'parou') break;
    if (r.erro) {
      j.falhas++;
      // muitos seguidos sem resposta (Wi-Fi sem internet, sinal fraco): para em vez de passar a fila inteira falhando
      if (++j.seguidas >= FALHAS_SEGUIDAS && !j.ctrl.signal.aborted) { j.motivo ??= 'rede'; j.ctrl.abort(); }
    } else if (r.n404) { j.n404++; j.seguidas = 0; semBloco.add(it.u); }
    else {
      guardados.add(it.u);
      j.novos++; j.seguidas = 0; j.bytes += r.bytes; meta.bytes = (meta.bytes ?? 0) + r.bytes;
      const pz = (meta.porZoom[it.z] ??= [0, 0]); pz[0]++; pz[1] += r.bytes;
    }
    agendar();
  }
}
/** erro que para tudo (espaço cheio ou outro): os outros trabalhadores param no próximo bloco */
function falhou(j, e) {
  j.motivo ??= e?.name === 'QuotaExceededError' ? 'espaco' : 'erro';
  j.ctrl.abort();
  console.warn('pacote:', e);
}
/** pausa (o que já foi guardado fica; Continuar pula os guardados) */
export function pausar(motivo = null) {
  if (!job) return;
  job.motivo = motivo;
  job.ctrl.abort();
}
let apagando = false;
async function apagar() {
  if (job || apagando) return;
  apagando = true;
  pausaSinal = null;   // um download parado pela queda do sinal não volta sozinho depois de apagar
  try { await caches.delete(CACHE); } catch { /* sem Cache API */ }
  guardados = new Set();
  semBloco.clear();
  meta = { porZoom: meta.porZoom };   // a média medida dos blocos continua valendo para as estimativas
  salvarMeta();
  apagando = false;
  status('Pacote apagado.');
  desenharSemPerderFoco(); desenharEspaco();
}

// ---------- tela ----------
const hojeLocal = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
function fmtMB(b) {
  const mb = (b ?? 0) / 2 ** 20;
  return mb >= 1000 ? `${U.nf(mb / 1024, mb < 10240 ? 1 : 0)} GB` : `${U.nf(mb, mb < 10 ? 1 : 0)} MB`;
}
const ddmm = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : '');
function escolha() {
  const t = U.store.get('pacote.tipo');
  return { tipo: t === 'completo' ? 'completo' : 'basico', planosB: U.store.get('pacote.b') === '1', opc: U.store.get('pacote.opc') === '1' };
}
const lista = (ns) => (ns.length > 1 ? `${ns.slice(0, -1).join(', ')} e ${ns.at(-1)}` : ns.join(''));

function criar() {
  const pai = document.getElementById('sobre-extra');
  if (!pai) return null;
  const el = document.getElementById('mod-pacote') ?? document.createElement('section');
  el.id = 'mod-pacote'; el.style.order = '1';
  el.setAttribute('aria-labelledby', 'pacote-h');
  const e = escolha(), esc = U.esc;
  const diasB = ctx.dias.filter((d) => d.planoB).map((d) => d.n);
  const etapas = (ctx.dados.roteiro.opcionais ?? []).map((o) => o.para.replace(/\s*\(.*\)$/, ''));
  const op = (k) => `<input type="radio" name="pacote-tipo" id="pacote-${k}" value="${k}"${e.tipo === k ? ' checked' : ''}>
    <label for="pacote-${k}"><b>${PACOTES[k].nome}</b><span>${PACOTES[k].texto}</span><em id="pacote-num-${k}">…</em></label>`;
  el.innerHTML = `
    <h3 id="pacote-h">Guardar o mapa da viagem</h3>
    <p class="pacote-txt">Baixa o mapa topográfico do USGS ao longo de toda a viagem: 4 km para cada lado da estrada e 3 km em volta dos pernoites e paradas. Sem sinal, ele aparece onde o mapa normal não foi guardado.</p>
    <fieldset class="pacote-ops"><legend class="sr-only">Tamanho do pacote</legend>${op('basico')}${op('completo')}</fieldset>
    <div class="pacote-cx">
      ${diasB.length ? `<label class="row" for="pacote-b"><span>Incluir os planos B (dia${diasB.length > 1 ? 's' : ''} ${lista(diasB)})</span><input type="checkbox" id="pacote-b"${e.planosB ? ' checked' : ''}></label>` : ''}
      ${etapas.length ? `<label class="row" for="pacote-opc"><span>Incluir as etapas opcionais (${esc(lista(etapas))})</span><input type="checkbox" id="pacote-opc"${e.opc ? ' checked' : ''}></label>` : ''}
    </div>
    <p class="cc-warn" id="pacote-wifi" hidden></p>
    <div class="pacote-prog" id="pacote-prog" hidden>
      <div class="pacote-bar" role="progressbar" aria-label="Download do mapa" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><span></span></div>
      <p class="pacote-num" id="pacote-prog-txt"></p>
    </div>
    <div class="pacote-acts">
      <button type="button" class="btn btn--main" id="pacote-ir">Baixar o mapa</button>
      <button type="button" class="btn btn--small" id="pacote-apagar" hidden>${APAGAR}</button>
    </div>
    <p class="pacote-st" id="pacote-st" role="status" tabindex="-1"></p>
    <p class="pacote-guard" id="pacote-guard"></p>
    <p class="hint" id="pacote-espaco"></p>
    <label class="row" for="pacote-sempre"><span>Mostrar o topográfico também com sinal (ajuda com sinal fraco; o mapa fica mais carregado)</span><input type="checkbox" id="pacote-sempre"${U.store.get('pacote.sempre') === '1' ? ' checked' : ''}></label>
    <p class="cc-note">Topográfico: USGS The National Map (domínio público). O mapa normal (OpenFreeMap) não pode ser baixado em massa pelos termos de uso: dele fica guardado só o que você já viu. Tamanhos estimados.</p>`;
  pai.append(el);
  el.addEventListener('change', (ev) => {
    const t = ev.target;
    if (t.name === 'pacote-tipo') U.store.set('pacote.tipo', t.value);
    else if (t.id === 'pacote-b') U.store.set('pacote.b', t.checked ? '1' : '0');
    else if (t.id === 'pacote-opc') U.store.set('pacote.opc', t.checked ? '1' : '0');
    else if (t.id === 'pacote-sempre') { U.store.set('pacote.sempre', t.checked ? '1' : '0'); aplicarTopo(); return; }
    else return;
    desenhar();
  });
  el.addEventListener('click', (ev) => {
    const b = ev.target.closest('button');
    if (!b) return;
    if (b.id === 'pacote-ir') {
      if (job) { pausar(); return; }
      if (!navigator.onLine) { status('Sem internet agora. Baixe quando estiver no Wi-Fi.', 'erro'); return; }
      baixar();
    } else if (b.id === 'pacote-apagar') {
      const volta = () => { delete b.dataset.confirmar; b.textContent = APAGAR; };
      clearTimeout(apagarT);
      if (b.dataset.confirmar) { volta(); apagar(); return; }
      b.dataset.confirmar = '1'; b.textContent = 'Apagar mesmo? Toque de novo';
      ctx.anunciar('Toque de novo para apagar o pacote.');
      apagarT = setTimeout(volta, 5000);
    }
  });
  return el;
}
let apagarT = 0;
const APAGAR = 'Apagar o pacote';

/** redesenha; se o botão focado sumiu ou foi desligado (fim do download, pacote apagado), o foco vai para a mensagem */
function desenharSemPerderFoco() {
  const a = document.activeElement, dentro = !!sec?.contains(a);
  desenhar();
  if (!dentro) return;
  const b = document.activeElement;   // o Chrome pode já ter tirado o foco do botão escondido
  if ((b === a && !a.disabled && !a.closest('[hidden]')) || (b !== a && b !== document.body)) return;
  sec.querySelector('#pacote-st')?.focus({ preventScroll: true });
}

/** mensagem do resultado (lida pelo leitor de tela) */
function status(txt, tipo = 'ok') {
  const st = sec?.querySelector('#pacote-st');
  if (!st) return;
  st.dataset.tipo = tipo;
  st.textContent = txt;
}

let pedido = 0, ultimoMeta = 0;
/** durante o download, a tela é atualizada no máximo 4 vezes por segundo */
function agendar() {
  if (pedido) return;
  pedido = setTimeout(() => {
    pedido = 0;
    desenharProgresso();
    if (performance.now() - ultimoMeta > 2000) { ultimoMeta = performance.now(); meta.n = guardados.size; salvarMeta(); }
  }, 250);
}
function desenharProgresso() {
  if (!sec || !job) return;
  const j = job, feitos = j.ja + j.novos + j.n404 + j.falhas, pc = j.total ? (feitos / j.total) * 100 : 100;
  const bar = sec.querySelector('.pacote-bar');
  bar.firstElementChild.style.width = `${pc.toFixed(1)}%`;
  bar.setAttribute('aria-valuenow', String(Math.round(pc)));
  const seg = (performance.now() - j.t0) / 1000, feitosAgora = j.novos + j.n404 + j.falhas;
  const resta = feitosAgora >= 12 ? ((j.fila.length - feitosAgora) * seg) / feitosAgora : null;
  const eta = resta == null ? '' : resta < 90 ? ' · falta menos de 2 min' : ` · falta ~${U.nf(Math.round(resta / 60))} min`;
  const txt = `${U.nf(feitos)} de ${U.nf(j.total)} blocos · ${fmtMB(meta.bytes)}${eta}${j.falhas ? ` · ${U.nf(j.falhas)} com falha` : ''}`;
  sec.querySelector('#pacote-prog-txt').textContent = txt;
  bar.setAttribute('aria-valuetext', `${Math.round(pc)}%: ${txt}`);
}
async function desenharEspaco() {
  const el = sec?.querySelector('#pacote-espaco');
  if (!el) return;
  const r = await espaco();
  el.textContent = [r.livre != null ? `Espaço livre para o app: ~${fmtMB(r.livre)} (estimativa do navegador).` : '',
    r.persistente ? 'O navegador prometeu não apagar o que foi guardado.' : 'O navegador pode apagar o que foi guardado se faltar espaço; no iPhone, use o app pela Tela de Início.'].filter(Boolean).join(' ');
}

/** a seção está na tela (o painel Sobre aberto)? */
const visivel = () => !!sec?.isConnected && sec.getClientRects().length > 0;

/** redesenha números, botões e situação (sem refazer a seção: o foco fica onde está) */
function desenhar() {
  sec ??= criar();
  if (!sec) return;
  if (!temCache) {
    sec.querySelector('#pacote-ir').disabled = true;
    status('Este navegador não deixa guardar o mapa (precisa de https ou do app instalado).', 'erro');
    return;
  }
  const e = escolha();
  for (const k of Object.keys(PACOTES)) {
    const p = calcular({ ...e, tipo: k }), f = faltam(p);
    const parte = guardados && f.n < p.total ? (f.n ? ` · faltam ${U.nf(f.n)}` : ' · guardado') : '';
    sec.querySelector(`#pacote-num-${k}`).textContent = `${U.nf(p.total)} blocos · ~${fmtMB(peso(p))}${parte}`;
  }
  const p = calcular(e), f = faltam(p);
  const ir = sec.querySelector('#pacote-ir'), prog = sec.querySelector('#pacote-prog');
  prog.hidden = !job;
  const online = navigator.onLine;
  sec.querySelectorAll('.pacote-ops input, .pacote-cx input').forEach((i) => { i.disabled = !!job; });
  if (job) { ir.textContent = 'Pausar'; ir.disabled = false; ir.classList.remove('btn--main'); desenharProgresso(); }
  else {
    ir.classList.add('btn--main');
    ir.disabled = !f.n || !online || apagando;
    ir.textContent = !f.n ? 'Tudo guardado'
      : f.n < p.total ? `${meta.interrompido ? 'Continuar' : 'Baixar o que falta'} · ~${fmtMB(f.bytes)}`
      : `Baixar o mapa · ~${fmtMB(f.bytes)}`;
  }
  const wifi = sec.querySelector('#pacote-wifi');
  wifi.textContent = !job && !f.n ? ''
    : !online ? 'Sem internet agora: dá para baixar quando o sinal voltar (de preferência no Wi-Fi).'
    : `Use Wi-Fi: são ~${fmtMB(f.bytes)}. Deixe o app aberto e a tela acesa; dá para pausar e continuar depois.`;
  wifi.hidden = !wifi.textContent;
  const n = guardados ? guardados.size : meta.n ?? 0;
  const guard = sec.querySelector('#pacote-guard');
  guard.innerHTML = n ? `<b>Guardado neste aparelho:</b> ${U.nf(n)} blocos (${fmtMB(meta.bytes)})${meta.data ? `, em ${U.esc(ddmm(meta.data))}` : ''}.${!job && meta.interrompido && f.n ? ' O download parou no meio: toque em Continuar.' : ''}` : '';
  guard.hidden = !n || !!job;   // durante o download, vale a linha do progresso
  const ap = sec.querySelector('#pacote-apagar');
  ap.hidden = !n || !!job;
}

/** o topográfico por baixo também com sinal (opção para sinal fraco) */
function aplicarTopo() {
  const m = ctx.mapa();
  if (!m) return;
  m.setSemSinal(!navigator.onLine || U.store.get('pacote.sempre') === '1');
}

export function iniciar(c) {
  ctx = c; U = c.util;
  if (!document.getElementById('mod-pacote-css')) {
    const st = document.createElement('style');
    st.id = 'mod-pacote-css';   // o id "mod-pacote" fica para a seção do Sobre
    st.textContent = CSS;
    document.head.append(st);
  }
  // o endereço do topográfico vem do mapa (o mesmo que o tilecache vai procurar)
  import('../mapa.js').then((m) => { if (m.TOPO_URL && m.TOPO_URL !== TOPO) { TOPO = m.TOPO_URL; planos.clear(); if (visivel()) desenhar(); } }).catch(() => {});
  // a conta dos blocos (~0,2 s no computador) só é feita quando o Sobre aparece: não segura a abertura do app
  sec = criar();
  // os blocos já guardados (lê o cache): fica para quando o aparelho estiver folgado
  const depois = window.requestIdleCallback ?? ((fn) => setTimeout(fn, 1500));
  depois(() => lerGuardados().then(() => { if (visivel()) desenhar(); }), { timeout: 8000 });
  document.addEventListener('visibilitychange', () => { if (job && document.visibilityState === 'visible') travarTela(true); });
  ctx.registrar({
    aoMostrarPainel: (nome) => {
      if (nome !== 'sobre') return;
      if (!job) lerGuardados(true).then(desenhar);
      desenhar(); desenharEspaco();
    },
    aoSinal: (online) => {
      if (!online && job) { pausaSinal = job.opcoes; pausar('sinal'); }
      else if (online && pausaSinal && !job) { const e = pausaSinal; pausaSinal = null; baixar(e); }
      aplicarTopo();
      if (job || visivel()) desenhar();
    },
    aoMapa: () => aplicarTopo(),
  });
}

const CSS = `
  #mod-pacote { position: relative; display: grid; gap: 10px; min-width: 0; padding-top: 12px; border-top: 1px solid var(--panel-line); }
  #mod-pacote h3 { margin: 0; font: 700 17px/1.1 var(--f-display); letter-spacing: .04em; text-transform: uppercase; }
  #mod-pacote p { margin: 0; }
  .pacote-txt { font-size: 14px; line-height: 1.45; }
  .pacote-ops { position: relative; margin: 0; padding: 0; border: 0; display: grid; gap: 6px; min-width: 0; }
  .pacote-ops input { position: absolute; opacity: 0; pointer-events: none; }
  .pacote-ops label { cursor: pointer; display: grid; grid-template-columns: 18px 1fr; gap: 3px 10px; align-items: start; padding: 10px 12px 10px 10px; border-radius: 9px;
    border: 1px solid var(--panel-line); background: var(--panel); transition: border-color .15s, background .15s; }
  .pacote-ops label::before { content: ''; grid-row: 1 / span 3; width: 16px; height: 16px; margin-top: 1px; box-sizing: border-box; border-radius: 50%; border: 2px solid var(--ink-soft); background: var(--panel); }
  .pacote-ops label:hover { border-color: var(--accent); }
  .pacote-ops input:checked + label { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent) inset; background: color-mix(in srgb, var(--accent) 8%, var(--panel)); }
  .pacote-ops input:checked + label::before { border-color: var(--accent); background: radial-gradient(circle, var(--accent) 0 3.5px, var(--panel) 4px); }
  .pacote-ops input:focus-visible + label { outline: 2px solid var(--accent); outline-offset: 2px; }
  .pacote-ops input:disabled + label { cursor: default; opacity: .6; }
  .pacote-ops b { font: 700 15px/1.1 var(--f-display); letter-spacing: .05em; text-transform: uppercase; }
  .pacote-ops span { font-size: 13px; line-height: 1.35; color: var(--ink-soft); }
  .pacote-ops em { font: 500 12px/1.3 var(--f-data); font-style: normal; color: var(--contour); }
  .pacote-cx { display: grid; gap: 4px; }
  #mod-pacote .row { min-height: 40px; font-size: 13.5px; line-height: 1.35; text-align: left; }
  #mod-pacote .row input[type=checkbox] { accent-color: var(--accent); width: 18px; height: 18px; flex: 0 0 auto; }
  #mod-pacote .row input:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .pacote-prog { display: grid; gap: 5px; }
  .pacote-bar { height: 10px; border-radius: 5px; background: color-mix(in srgb, var(--ink) 11%, transparent); overflow: hidden; }
  .pacote-bar span { display: block; height: 100%; width: 0; border-radius: 5px; background: var(--accent); transition: width .25s linear; }
  .pacote-num { font: 12.5px/1.4 var(--f-data); color: var(--ink-soft); }
  .pacote-acts { display: flex; flex-wrap: wrap; gap: 8px; }
  #mod-pacote .pacote-acts .btn { min-height: 44px; }
  #mod-pacote #pacote-ir { flex: 1 1 200px; font-size: 13.5px; }
  #mod-pacote #pacote-apagar { flex: 0 1 auto; }
  #pacote-apagar[data-confirmar] { border-color: var(--g-alta); color: var(--g-alta); }
  .pacote-st { font-size: 13px; line-height: 1.4; padding: 6px 10px; border-left: 3px solid var(--g-ok); border-radius: 0 6px 6px 0; background: color-mix(in srgb, var(--g-ok) 10%, transparent); }
  .pacote-st[data-tipo="erro"] { border-left-color: var(--g-media); background: color-mix(in srgb, var(--g-media) 10%, transparent); }
  /* vazio: some da tela mas continua para o leitor de tela */
  .pacote-st:empty { position: absolute; width: 1px; height: 1px; padding: 0; border: 0; overflow: hidden; clip: rect(0 0 0 0); }
  .pacote-guard { font-size: 13.5px; line-height: 1.45; }
  .pacote-guard b { font-weight: 600; }
  @media (prefers-reduced-motion: reduce) { .pacote-bar span { transition: none; } }
`;
