// Tudo o que o mapa baixa (blocos do mapa, relevo, satélite, estilo, letras e ícones) passa pelo protocolo próprio
// tc://, que guarda na Cache API do navegador. Sem sinal, o que já foi visto continua aparecendo. O que nunca foi
// visto dá erro, e aí o MapLibre mostra o bloco do zoom de cima ampliado, em vez de deixar a área em branco.
// (O service worker cuida só do "casco" do app; os blocos ficam aqui para funcionar igual em todo navegador.)

export const CACHE_BLOCOS = 'mapa-blocos-v1';   // blocos vistos com sinal; aparado em MAX_BLOCOS
export const CACHE_BASE = 'mapa-base-v1';       // estilo, letras e ícones do mapa (poucos e pequenos)
const MAX_BLOCOS = 5000;

/** .../{z}/{x}/{y}(.ext): bloco de mapa; o resto (estilo, letras, ícones) é "base" */
const ehBloco = (u) => /\/\d+\/\d+\/\d+(\.\w+)?$/.test(u.pathname);
const temCache = typeof caches !== 'undefined';

function comPrazo(signal, ms) {
  if (typeof AbortSignal.timeout !== 'function') return signal;
  const t = AbortSignal.timeout(ms);
  if (!signal) return t;
  return typeof AbortSignal.any === 'function' ? AbortSignal.any([signal, t]) : signal;
}

let novos = 0;
async function guardar(nome, chave, resp) {
  try {
    const c = await caches.open(nome);
    await c.put(chave, resp);
    if (nome === CACHE_BLOCOS && ++novos % 200 === 0) aparar();
  } catch { /* cota cheia ou pedido cancelado: segue sem guardar */ }
}

/** apaga os blocos usados há mais tempo quando passam de MAX_BLOCOS (a ordem do cache é a do último put) */
export async function aparar(max = MAX_BLOCOS) {
  try {
    const c = await caches.open(CACHE_BLOCOS), ks = await c.keys();
    for (const k of ks.slice(0, Math.max(0, ks.length - max))) await c.delete(k);
  } catch { /* sem Cache API */ }
}

// um bloco achado no cache volta para o fim da fila (uma vez por abertura), para o aparar apagar os menos usados.
// Só os deste cache: os do pacote do mapa ('mapa-pacote-v1') não são copiados para cá (ocupariam o espaço duas vezes)
const tocados = new Set();
async function tocar(chave) {
  if (tocados.has(chave)) return;
  tocados.add(chave);
  try {
    const c = await caches.open(CACHE_BLOCOS), r = await c.match(chave, { ignoreVary: true });
    if (r) await c.put(chave, r);
  } catch { /* tanto faz */ }
}

const baseAtualizada = new Set();   // estilo/letras/ícones já conferidos na rede nesta abertura

/**
 * "Conectado sem internet" (Wi-Fi de camping, sinal sem dados): o navegador diz que está online, mas todo pedido
 * falha. Depois de algumas falhas de rede seguidas, `rede.semInternet` liga e o evento 'mudou' avisa o app; o
 * primeiro pedido que der certo desliga. Enquanto ligado, uma sondagem leve (só cabeçalho) a cada 30 s confere a volta.
 */
export const rede = Object.assign(new EventTarget(), { semInternet: false });
const FALHAS_SEM_INTERNET = 4;
let falhasSeguidas = 0, sonda = 0, sondando = false;
/** a internet responde? (só o cabeçalho de um arquivo pequeno do mapa base; sem CORS, basta chegar resposta) */
const sondar = () => fetch(`https://tiles.openfreemap.org/styles/liberty?sonda=${Date.now()}`,
  { method: 'HEAD', mode: 'no-cors', cache: 'no-store', signal: comPrazo(null, 10000) }).then(() => true, () => false);
function mudar(sem) {
  if (sem === rede.semInternet) return;
  rede.semInternet = sem;
  clearInterval(sonda);
  if (sem) {
    sonda = setInterval(() => {
      if (navigator.onLine && document.visibilityState === 'visible') sondar().then((ok) => { if (ok) marcarRede(true); });
    }, 30000);
  }
  rede.dispatchEvent(new Event('mudou'));
}
function marcarRede(ok) {
  if (ok) { falhasSeguidas = 0; mudar(false); return; }
  if (rede.semInternet || ++falhasSeguidas < FALHAS_SEM_INTERNET || sondando) return;
  // falhas seguidas podem ser de um servidor só (ex.: o USGS fora do ar): confirma com a sondagem antes de avisar
  sondando = true;
  sondar().then((ok) => { sondando = false; if (ok) falhasSeguidas = 0; else mudar(true); });
}
addEventListener('online', () => marcarRede(true));

/**
 * Busca um recurso do mapa. Primeiro o guardado (abre na hora, mesmo com sinal fraco); sem cópia, a rede.
 * Estilo, letras e ícones mudam de vez em quando: com cópia guardada, são atualizados em segundo plano.
 */
export async function buscar(url, signal) {
  const u = new URL(url); u.search = ''; u.hash = '';
  const chave = u.href, bloco = ehBloco(u);
  let hit;
  try { hit = temCache ? await caches.match(chave, { ignoreVary: true }) : undefined; } catch { /* sem Cache API */ }
  if (hit) {
    if (bloco) tocar(chave);
    else if (navigator.onLine && !rede.semInternet && !baseAtualizada.has(chave)) {
      baseAtualizada.add(chave);
      fetch(chave, { mode: 'cors', credentials: 'omit', signal: comPrazo(null, 15000) })
        .then((r) => { if (r.ok) guardar(CACHE_BASE, chave, r); }).catch(() => {});
    }
    return hit;
  }
  let r;
  try {
    r = await fetch(chave, { mode: 'cors', credentials: 'omit', signal: comPrazo(signal, 15000) });
  } catch (e) {
    if (!signal?.aborted) marcarRede(false);   // cancelado pelo mapa (zoom) não conta; falha ou prazo estourado conta
    throw e;
  }
  marcarRede(true);   // até um 404 mostra que a internet funciona
  if (!r.ok) throw Object.assign(new Error(`HTTP ${r.status} ${chave}`), { status: r.status });
  if (temCache) guardar(bloco ? CACHE_BLOCOS : CACHE_BASE, chave, r.clone());
  return r;
}

/** registra o protocolo tc:// no MapLibre (roda na thread principal) */
export function registrarProtocolo(ml) {
  ml.addProtocol('tc', async (params, abortController) => {
    const r = await buscar('https://' + params.url.slice('tc://'.length), abortController?.signal);
    if (params.type === 'json') return { data: await r.json() };
    if (params.type === 'string') return { data: await r.text() };
    return { data: await r.arrayBuffer() };
  });
}

/** quanto está guardado e se o navegador prometeu não apagar */
export async function resumoArmazenamento() {
  const s = navigator.storage;
  let persistente = false, usoMB = null, blocos = null;
  try { persistente = (await s?.persisted?.()) ?? false; } catch { /* sem StorageManager */ }
  try { const e = await s?.estimate?.(); if (e) usoMB = e.usage / 2 ** 20; } catch { /* idem */ }
  try { if (temCache) blocos = (await (await caches.open(CACHE_BLOCOS)).keys()).length; } catch { /* sem Cache API */ }
  return { persistente, usoMB, blocos };
}

/** pede ao navegador para não apagar o que foi guardado (Chrome decide sozinho; Safari, no app da Tela de Início) */
export async function pedirPersistencia() {
  try { return (await navigator.storage?.persist?.()) ?? false; } catch { return false; }
}
