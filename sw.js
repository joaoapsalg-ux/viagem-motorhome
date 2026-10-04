// Service worker: guarda o "casco" do app (páginas, código, dados, MapLibre e fontes) para abrir sem sinal.
// Os blocos do mapa não passam por aqui: ficam no protocolo tc:// (src/tilecache.js).
// A publicação (GitHub Actions) troca __VERSAO__ pelo commit. Cada versão nova baixa o casco inteiro; se faltar um
// arquivo, a instalação falha e a versão anterior (completa) continua valendo.
const VERSAO = 'casco-__VERSAO__';
const DEV = VERSAO.includes('__');   // no computador (serve.ps1) o nome não é trocado: aí vale a rede primeiro
const LIBS = 'libs-v1';              // MapLibre (versão fixa no endereço) e fontes: não muda a cada publicação
const ML = 'https://cdn.jsdelivr.net/npm/maplibre-gl@6.11.2/dist/';
const FONTES = 'https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700&family=Barlow:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap';
const CASCO = [
  './', './index.html', './manifest.webmanifest', './icons/icon.svg', './icons/icon-192.png', './icons/icon-180.png',
  './src/app.js', './src/mapa.js', './src/tilecache.js', './src/util.js',
  './data/roteiro.json', './data/rotas.geojson', './data/pontos.json', './data/alertas.json', './data/opcionais.json',
];
const LIBS_ARQ = [`${ML}maplibre-gl.mjs`, `${ML}maplibre-gl-shared.mjs`, `${ML}maplibre-gl-worker.mjs`, `${ML}maplibre-gl.css`];
// de fora, só estes servidores passam pelo service worker (o resto, como os blocos do mapa, vai direto)
const DE_FORA = new Set(['cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com']);
const pedido = (u) => new Request(u, { mode: 'cors', credentials: 'omit', cache: 'reload' });

self.addEventListener('install', (e) => e.waitUntil((async () => {
  // casco: tudo ou nada (addAll falha se qualquer arquivo falhar)
  await (await caches.open(VERSAO)).addAll(CASCO.map(pedido));
  // MapLibre: só o que ainda não está guardado; também tudo ou nada
  const libs = await caches.open(LIBS);
  for (const u of LIBS_ARQ) {
    if (await libs.match(u)) continue;
    const r = await fetch(pedido(u));
    if (!r.ok) throw new Error(`${u}: HTTP ${r.status}`);
    await libs.put(u, r);
  }
  // fontes: o CSS do Google e os arquivos .woff2 que ele cita (sem elas o app funciona, com a letra do sistema)
  try {
    if (!(await libs.match(FONTES))) {
      const css = await fetch(pedido(FONTES));
      if (css.ok) {
        const txt = await css.clone().text();
        await libs.put(FONTES, css);
        const woff = [...txt.matchAll(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+\.woff2)\)/g)].map((m) => m[1]);
        await Promise.all(woff.map(async (u) => { const r = await fetch(pedido(u)); if (r.ok) await libs.put(u, r); }));
      }
    }
  } catch { /* fica para o uso normal */ }
  await self.skipWaiting();
})()));

self.addEventListener('activate', (e) => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k.startsWith('casco-') && k !== VERSAO) await caches.delete(k);
  await self.clients.claim();
})()));

/**
 * Guardado primeiro, sem ir à rede (abre na hora mesmo com sinal fraco e não gasta dados em roaming). Não precisa
 * conferir a rede: cada publicação traz um sw.js novo, que baixa o casco inteiro; a MapLibre e as fontes têm
 * endereço com versão.
 */
async function guardadoPrimeiro(req, nomeCache, chave = req) {
  const hit = await caches.match(chave, { ignoreSearch: req.mode === 'navigate', ignoreVary: true });
  if (hit) return hit;
  const r = await fetch(req);
  if (r.ok && r.type !== 'opaque') (await caches.open(nomeCache)).put(chave, r.clone());
  return r;
}
/** rede primeiro, com prazo curto; sem rede, o guardado (só no computador, para ver as mudanças na hora) */
async function redePrimeiro(req, chave = req) {
  try {
    const r = await Promise.race([fetch(req), new Promise((_, nao) => setTimeout(() => nao(new Error('prazo')), 3000))]);
    if (r.ok) (await caches.open(VERSAO)).put(chave, r.clone());
    return r;
  } catch {
    const hit = await caches.match(chave, { ignoreSearch: true, ignoreVary: true });
    if (hit) return hit;
    throw new Error('sem rede e sem cópia');
  }
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    const chave = req.mode === 'navigate' ? './index.html' : req;
    e.respondWith(DEV ? redePrimeiro(req, chave) : guardadoPrimeiro(req, VERSAO, chave));
  } else if (DE_FORA.has(url.hostname)) {
    e.respondWith(guardadoPrimeiro(req, LIBS));
  }
});
