// O mapa (MapLibre): mapa base da OpenFreeMap, relevo da Mapterhorn, satélite do USGS, as linhas da viagem e os
// marcadores (pernoites, número dos dias, paradas do dia escolhido). Quem decide o que mostrar é o app.js; aqui só
// se desenha.
import * as mlMod from 'https://cdn.jsdelivr.net/npm/maplibre-gl@6.11.2/dist/maplibre-gl.mjs';
import { registrarProtocolo, buscar } from './tilecache.js';
import { reduzMovimento } from './util.js';

const ml = mlMod.Map ? mlMod : mlMod.default;
registrarProtocolo(ml);

const OFM = 'https://tiles.openfreemap.org';
const tc = (u) => u.replace(/^https:\/\//, 'tc://');
const ATRIB_OFM = '<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> ' +
  '<a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">© OpenMapTiles</a> ' +
  '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap</a>';
const DEM = {
  type: 'raster-dem', tiles: ['tc://tiles.mapterhorn.com/{z}/{x}/{y}.webp'], tileSize: 512, encoding: 'terrarium', maxzoom: 12,
  attribution: '<a href="https://mapterhorn.com/attribution" target="_blank" rel="noopener">© Mapterhorn</a>',
};
const SAT = {
  type: 'raster', tileSize: 256, maxzoom: 16,
  tiles: ['tc://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}'],
  attribution: 'Satélite: <a href="https://www.usgs.gov/programs/national-geospatial-program/national-map" target="_blank" rel="noopener">USGS The National Map</a> (USDA NAIP)',
};
const EXAGERO = 1.4;

// propriedades booleanas das linhas (o app sempre manda; to-boolean evita erro se faltar)
const SEL = ['to-boolean', ['get', 'sel']], APAG = ['to-boolean', ['get', 'apagada']];
// largura das linhas pelo zoom; o trecho escolhido ('sel') é mais grosso
const largura = (a, b) => ['interpolate', ['linear'], ['zoom'],
  4, ['case', SEL, b, a], 8, ['case', SEL, b * 1.5, a * 1.5],
  12, ['case', SEL, b * 2.3, a * 2.3], 16, ['case', SEL, b * 3.2, a * 3.2]];

function hillshade(escuro) {
  return escuro
    ? { 'hillshade-method': 'igor', 'hillshade-exaggeration': 0.55, 'hillshade-shadow-color': 'rgba(0,0,0,0.65)', 'hillshade-highlight-color': 'rgba(255,255,255,0.07)' }
    : { 'hillshade-method': 'igor', 'hillshade-exaggeration': 0.45, 'hillshade-shadow-color': 'rgba(70,50,30,0.5)', 'hillshade-highlight-color': 'rgba(255,255,255,0.3)' };
}
function ceu(escuro) {
  const s = escuro
    ? { 'sky-color': '#0d1a2b', 'horizon-color': '#24313a', 'fog-color': '#1a2228' }
    : { 'sky-color': '#8fbfe8', 'horizon-color': '#efe6d2', 'fog-color': '#efe6d2' };
  return { ...s, 'sky-horizon-blend': 0.5, 'horizon-fog-blend': 0.6, 'fog-ground-blend': 0.25,
    'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 8, 1, 11, 0] };
}

/** ponto a uma fração do comprimento de uma linha [[lon,lat],...] */
export function pontoNaLinha(coords, frac = 0.5) {
  const d = [0];
  for (let i = 1; i < coords.length; i++) {
    const [x1, y1] = coords[i - 1], [x2, y2] = coords[i];
    const k = Math.cos(((y1 + y2) / 2) * Math.PI / 180);
    d.push(d[i - 1] + Math.hypot((x2 - x1) * k, y2 - y1));
  }
  const alvo = d.at(-1) * frac;
  let i = d.findIndex((v) => v >= alvo);
  if (i <= 0) return coords[0];
  const t = (alvo - d[i - 1]) / (d[i] - d[i - 1] || 1);
  return [coords[i - 1][0] + (coords[i][0] - coords[i - 1][0]) * t, coords[i - 1][1] + (coords[i][1] - coords[i - 1][1]) * t];
}
/** caixa [[oeste, sul], [leste, norte]] de uma lista de [lon, lat] */
export function caixa(pts) {
  let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
  for (const [x, y] of pts) { if (x < a) a = x; if (y < b) b = y; if (x > c) c = x; if (y > d) d = y; }
  return [[a, b], [c, d]];
}
const LADOS = ['top', 'right', 'bottom', 'left'];
const padIgual = (a, b) => LADOS.every((k) => Math.round(a?.[k] ?? 0) === Math.round(b?.[k] ?? 0));
const limita = (v, a, b) => Math.max(a, Math.min(b, v));

export class Mapa {
  /** @param {HTMLElement} el */
  static async criar(el, opcoes) {
    const m = new Mapa(el, opcoes);
    await m.#iniciar();
    return m;
  }

  constructor(el, { escuro, fundo, sombra, relevo3D, rotas, limites, aoClicarRota }) {
    this.el = el;
    this.st = { escuro, fundo, sombra, relevo3D };
    this.escuroReal = escuro;   // o estilo em uso (sem sinal, pode ser o do outro tema)
    this.rotas = rotas;
    this.limites = limites;
    this.aoClicarRota = aoClicarRota;
    this.grupos = { pernoites: [], dias: [], paradas: [], eu: [] };
    this.base = new Map();   // estilos da OpenFreeMap já baixados
    this.pad = { top: 0, right: 0, bottom: 0, left: 0 };
    this.geracao = 0;
  }

  async #estiloBase(nome) {
    if (!this.base.has(nome)) this.base.set(nome, await (await buscar(`${OFM}/styles/${nome}`)).json());
    return structuredClone(this.base.get(nome));
  }

  /**
   * Estilo completo: base da OpenFreeMap + relevo + satélite + camadas da viagem.
   * Sem sinal e sem cópia guardada do tema pedido, usa o do outro tema; devolve { estilo, escuro } (o tema que saiu).
   */
  async #estilo(st = this.st) {
    let nome = st.escuro ? 'dark' : 'liberty', s;
    try { s = await this.#estiloBase(nome); } catch (e) {
      nome = st.escuro ? 'liberty' : 'dark';
      s = await this.#estiloBase(nome);   // se este também falhar, o erro sobe
    }
    const escuro = nome === 'dark';
    delete s.sources.ne2_shaded;   // relevo antigo de 340 KB por bloco; o hillshade substitui
    s.layers = s.layers.filter((l) => l.source !== 'ne2_shaded');
    s.sources.openmaptiles = { type: 'vector', tiles: [tc(`${OFM}/planet/latest/{z}/{x}/{y}.pbf`)], minzoom: 0, maxzoom: 14, attribution: ATRIB_OFM };
    s.glyphs = tc(s.glyphs);
    s.sprite = typeof s.sprite === 'string' ? tc(s.sprite) : s.sprite.map((x) => ({ ...x, url: tc(x.url) }));
    s.sources['dem-relevo'] = { ...DEM };
    s.sources['dem-terreno'] = { ...DEM };
    s.sources.satelite = { ...SAT };
    s.sources.rotas = { type: 'geojson', data: this.rotas };
    const sat = st.fundo === 'satelite';
    // satélite e sombra do relevo: por cima do chão (terra, água) e por baixo das estradas
    let i = s.layers.findIndex((l) => /^(aeroway|tunnel_|road_|highway_|railway|bridge_|building)/.test(l.id));
    if (i < 0) i = s.layers.length;
    s.layers.splice(i, 0,
      { id: 'satelite', type: 'raster', source: 'satelite', layout: { visibility: sat ? 'visible' : 'none' }, paint: { 'raster-fade-duration': 150 } },
      { id: 'sombra', type: 'hillshade', source: 'dem-relevo', layout: { visibility: st.sombra && !sat ? 'visible' : 'none' }, paint: hillshade(escuro) });
    // linhas da viagem: por cima das estradas, por baixo dos nomes das cidades
    let j = s.layers.findIndex((l) => /^(label_|place_)/.test(l.id));
    if (j < 0) j = s.layers.length;
    s.layers.splice(j, 0, ...this.#camadasViagem(escuro, st.fundo));
    if (st.relevo3D) s.terrain = { source: 'dem-terreno', exaggeration: EXAGERO };
    s.sky = ceu(escuro);
    return { estilo: s, escuro };
  }

  #camadasViagem(escuro, fundo) {
    const contorno = fundo === 'satelite' ? '#ffffff' : escuro ? '#0b100e' : '#ffffff';
    const opc = escuro || fundo === 'satelite' ? '#e7ae7f' : '#8c4f2a';
    const apagada = (v, sel = 1) => ['case', SEL, sel, APAG, v, 1];
    return [
      { id: 'r-opc', type: 'line', source: 'rotas', filter: ['==', ['get', 'estado'], 'opcional'],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': opc, 'line-width': largura(2.4, 3.4), 'line-dasharray': [0.1, 2], 'line-opacity': apagada(0.5) } },
      { id: 'r-alt-contorno', type: 'line', source: 'rotas', filter: ['==', ['get', 'estado'], 'alternativa'],
        layout: { 'line-join': 'round' },
        paint: { 'line-color': contorno, 'line-width': largura(3.6, 5.6), 'line-opacity': ['case', SEL, 0.75, 0.35] } },
      { id: 'r-alt', type: 'line', source: 'rotas', filter: ['==', ['get', 'estado'], 'alternativa'],
        layout: { 'line-join': 'round' },
        paint: { 'line-color': ['get', 'cor'], 'line-width': largura(1.8, 3), 'line-dasharray': [2, 1.6], 'line-opacity': ['case', SEL, 1, APAG, 0.35, 0.7] } },
      { id: 'r-contorno', type: 'line', source: 'rotas', filter: ['match', ['get', 'estado'], ['ativa', 'shuttle'], true, false],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': contorno, 'line-width': largura(4.4, 7.6), 'line-opacity': apagada(0.3, 0.95) } },
      { id: 'r-ativa', type: 'line', source: 'rotas', filter: ['==', ['get', 'estado'], 'ativa'],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': ['get', 'cor'], 'line-width': largura(2.4, 4.4), 'line-opacity': apagada(0.4) } },
      { id: 'r-shuttle', type: 'line', source: 'rotas', filter: ['==', ['get', 'estado'], 'shuttle'],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': ['get', 'cor'], 'line-width': largura(2.4, 4.4), 'line-dasharray': [1.1, 1.3], 'line-opacity': apagada(0.4) } },
      { id: 'r-setas', type: 'symbol', source: 'rotas',
        filter: ['all', SEL, ['match', ['get', 'estado'], ['ativa', 'shuttle'], true, false]],
        layout: { 'symbol-placement': 'line', 'symbol-spacing': 110, 'text-field': '›', 'text-font': ['Noto Sans Bold'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 5, 15, 12, 24], 'text-keep-upright': false, 'text-allow-overlap': true,
          'text-ignore-placement': true, 'text-rotation-alignment': 'map', 'text-offset': [0, -0.08] },
        paint: { 'text-color': '#ffffff', 'text-halo-color': ['get', 'cor'], 'text-halo-width': 0.6 } },
      { id: 'r-toque', type: 'line', source: 'rotas', filter: ['!=', ['get', 'estado'], 'oculta'],
        paint: { 'line-color': '#000', 'line-opacity': 0, 'line-width': ['interpolate', ['linear'], ['zoom'], 4, 14, 12, 24] } },
    ];
  }

  async #iniciar() {
    const { estilo, escuro } = await this.#estilo();
    this.escuroReal = escuro;
    this.map = new ml.Map({
      container: this.el, style: estilo, bounds: this.limites, fitBoundsOptions: { padding: 40 },
      maxPitch: 75, attributionControl: { compact: true }, dragRotate: true, pitchWithRotate: true,
      cancelPendingTileRequestsWhileZooming: true, fadeDuration: 200,
      locale: {
        'Map.Title': 'Mapa da viagem', 'AttributionControl.ToggleAttribution': 'Mostrar ou esconder os créditos do mapa',
        'AttributionControl.MapFeedback': 'Sugerir correção no mapa',
      },
    });
    this.map.touchZoomRotate.enableRotation?.();
    // o estilo escuro da OpenFreeMap pede ícones que não estão no sprite: um ícone vazio evita o aviso
    this.map.setMissingStyleImageResolver?.((id) => {
      if (!this.map.hasImage(id)) this.map.addImage(id, { width: 1, height: 1, data: new Uint8Array(4) });
    });
    await new Promise((ok, falha) => {
      const t = setTimeout(() => falha(new Error('O mapa demorou demais para abrir.')), 45000);
      this.map.once('load', () => { clearTimeout(t); ok(); });
    });
    // créditos começam recolhidos (o botão ⓘ abre)
    this.el.querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show');
    // sem sinal, cada pedaço de mapa não guardado dá erro (esperado): só registra os outros
    this.map.on('error', (ev) => { if (navigator.onLine && ev?.error?.status !== 404) console.warn('mapa:', ev?.error?.message ?? ev); });
    // toque/clique nas linhas
    this.map.on('click', 'r-toque', (e) => {
      const f = e.features?.[0];
      if (f) this.aoClicarRota?.(f.properties);
    });
    this.map.on('mouseenter', 'r-toque', () => { this.map.getCanvas().style.cursor = 'pointer'; });
    this.map.on('mouseleave', 'r-toque', () => { this.map.getCanvas().style.cursor = ''; this.#dica(null); });
    this.map.on('mousemove', 'r-toque', (e) => this.#dica(e));
    // rótulos: esconde/encolhe os que se encostam (a cada quadro em que o mapa mexe)
    let pedido = 0;
    const arrumar = () => { if (!pedido) pedido = requestAnimationFrame(() => { pedido = 0; this.#arrumar(); }); };
    this.map.on('move', arrumar);
    this.map.on('resize', arrumar);
    this.arrumar = arrumar;
    // se a margem mudou enquanto a câmera andava, acerta quando ela para
    this.map.on('moveend', () => {
      if (!this.map.isMoving() && !padIgual(this.pad, this.map.getPadding())) {
        this.map.easeTo({ padding: this.pad, duration: reduzMovimento() ? 0 : 200 });
      }
    });
    new ResizeObserver(() => this.map.resize()).observe(this.el);
    // com sinal, guarda também o estilo do outro tema (um arquivo pequeno), para trocar de tema sem sinal depois
    // (e as letras básicas dos rótulos dos dois estilos, ~80 KB cada)
    setTimeout(() => {
      this.#estiloBase(this.escuroReal ? 'liberty' : 'dark').catch(() => {});
      for (const fonte of ['Noto Sans Regular', 'Noto Sans Bold', 'Noto Sans Italic']) buscar(`${OFM}/fonts/${encodeURIComponent(fonte)}/0-255.pbf`).catch(() => {});
    }, 8000);
  }

  // ---------- dica com o dia (mouse) ----------
  #dica(e) {
    if (!this.tip) {
      this.tip = document.createElement('div');
      this.tip.className = 'sheet';
      Object.assign(this.tip.style, { left: '0', top: '0', zIndex: 5, padding: '4px 8px', pointerEvents: 'none', font: '12px/1.4 var(--f-data)', borderRadius: '6px', whiteSpace: 'nowrap' });
      document.body.append(this.tip);
    }
    const p = e?.features?.[0]?.properties;
    if (!e || !p?.rotulo || e.originalEvent?.pointerType === 'touch' || matchMedia('(pointer: coarse)').matches) { this.tip.hidden = true; return; }
    this.tip.hidden = false;
    this.tip.textContent = p.rotulo;
    this.tip.style.transform = `translate(${e.originalEvent.clientX + 14}px, ${e.originalEvent.clientY + 14}px)`;
  }

  // ---------- dados ----------
  setRotas(fc) {
    this.rotas = fc;
    this.map.getSource('rotas')?.setData(fc);
  }

  // ---------- marcadores ----------
  /**
   * Atualiza um grupo de marcadores. Cada item: { chave, lngLat, html, cls, style, titulo, prioridade, zoomNome,
   * essencial (nunca some), fixo (fora da arrumação), anchor, offset, aoClicar }. Itens com a mesma chave são
   * reaproveitados (só mudam classe e texto), em vez de recriados.
   */
  setMarcadores(grupo, itens) {
    const antigos = new Map(this.grupos[grupo].map((m) => [m.it.chave, m]));
    const medir = [];
    const aplicar = (m) => {
      const { b, it } = m;
      b.className = `mk ${it.cls ?? ''}`;
      if (it.style) b.setAttribute('style', it.style); else b.removeAttribute('style');
      b.innerHTML = it.html;
      if (it.titulo) { b.title = it.titulo; b.setAttribute('aria-label', it.titulo); }
      m.estado = 'full';
      m.marker.setOffset(it.offset ?? [-13, 0]);
      medir.push(m);
    };
    const novos = itens.map((it) => {
      let m = it.chave != null ? antigos.get(it.chave) : null;
      if (m) {
        antigos.delete(it.chave);
        const mudou = m.it.html !== it.html || m.it.cls !== it.cls || m.it.style !== it.style;
        m.it = it;
        m.marker.setLngLat(it.lngLat);
        if (mudou) aplicar(m);
        else if (it.titulo) { m.b.title = it.titulo; m.b.setAttribute('aria-label', it.titulo); }
        return m;
      }
      const caixa = document.createElement('div');   // o MapLibre posiciona a caixa; a pílula fica dentro
      const b = document.createElement('button');
      b.type = 'button';
      caixa.append(b);
      m = { b, it, marker: new ml.Marker({ element: caixa, anchor: it.anchor ?? 'left', offset: it.offset ?? [-13, 0] }).setLngLat(it.lngLat).addTo(this.map) };
      b.addEventListener('click', (ev) => { ev.stopPropagation(); m.it.aoClicar?.(); });
      aplicar(m);
      return m;
    });
    for (const m of antigos.values()) m.marker.remove();
    this.grupos[grupo] = novos;
    // medidas em lote (com e sem o nome), para arrumar sem medir a cada quadro
    for (const m of medir) m.full = [m.b.offsetWidth, m.b.offsetHeight];
    for (const m of medir) m.b.classList.add('is-compact');
    for (const m of medir) m.compact = [m.b.offsetWidth, m.b.offsetHeight];
    for (const m of medir) m.b.classList.remove('is-compact');
    this.arrumar?.();
  }

  /**
   * Arruma os rótulos para não se encostarem. 1ª passada: os pontos (compactos), por prioridade; os essenciais
   * (paradas e pernoite do dia escolhido) nunca somem. 2ª passada: abre os nomes onde couberem, à direita do ponto
   * ou, se não der, à esquerda.
   */
  #arrumar() {
    const z = this.map.getZoom();
    const W = this.map.getContainer().clientWidth, H = this.map.getContainer().clientHeight;
    const ms = Object.values(this.grupos).flat().sort((a, b) => (b.it.prioridade ?? 0) - (a.it.prioridade ?? 0));
    const ret = (m, [w, h], lado) => {
      const p = m.p;
      const x = (m.it.anchor ?? 'left') === 'center' ? p.x - w / 2 : lado === 'esq' ? p.x + 13 - w : p.x - 13;
      return { x: x - 2, y: p.y - h / 2 - 2, w: w + 4, h: h + 4, m };
    };
    const postos = [];
    const bate = (r, exceto) => postos.some((q) => q.m !== exceto && r.x < q.x + q.w && q.x < r.x + r.w && r.y < q.y + q.h && q.y < r.y + r.h);
    const dentro = (r) => r.x >= 0 && r.y >= 0 && r.x + r.w <= W && r.y + r.h <= H;
    for (const m of ms) {
      m.p = this.map.project(m.it.lngLat);
      const r = ret(m, m.compact, 'dir');
      m.fora = r.x > W || r.y > H || r.x + r.w < 0 || r.y + r.h < 0;
      if (m.it.fixo || m.it.essencial || m.fora || !bate(r)) { m.prox = 'compact'; m.rc = r; postos.push(r); } else m.prox = 'hidden';
    }
    for (const m of ms) {
      if (m.prox !== 'compact' || m.fora || m.it.fixo) continue;
      if (m.full[0] <= m.compact[0] + 2) { m.prox = 'full'; continue; }   // não tem nome para abrir
      if (m.it.zoomNome != null && z < m.it.zoomNome) continue;
      for (const lado of (m.it.anchor === 'center' ? ['centro'] : ['dir', 'esq'])) {
        const r = ret(m, m.full, lado);
        if (dentro(r) && !bate(r, m)) {
          postos.splice(postos.indexOf(m.rc), 1, r);
          m.rc = r; m.prox = lado === 'esq' ? 'esq' : 'full';
          break;
        }
      }
    }
    for (const m of ms) {
      if (m.it.fixo) continue;
      const e = m.prox;
      if (e !== m.estado) {
        m.b.classList.toggle('is-compact', e === 'compact');
        m.b.classList.toggle('is-hidden', e === 'hidden');
        m.b.classList.toggle('is-flip', e === 'esq');
        if ((e === 'esq') !== (m.estado === 'esq')) m.marker.setOffset(e === 'esq' ? [-(m.full[0] - 13), 0] : (m.it.offset ?? [-13, 0]));
        m.estado = e;
      }
      const tab = e === 'hidden' || m.fora ? -1 : 0;   // escondido ou fora da tela: fora do Tab
      if (m.b.tabIndex !== tab) m.b.tabIndex = tab;
    }
  }

  // ---------- câmera ----------
  /** margem da parte do mapa coberta pelo painel/gaveta; não interrompe a câmera em movimento */
  setPadding(pad, animar = true) {
    this.pad = { ...this.pad, ...pad };
    if (padIgual(this.pad, this.map.getPadding()) || this.map.isMoving()) return;   // o 'moveend' acerta depois
    if (animar && !reduzMovimento()) this.map.easeTo({ padding: this.pad, duration: 280 });
    else this.map.setPadding(this.pad);
  }
  /** aplica a margem atual na hora (antes de calcular uma câmera nova) */
  #firmarMargem() {
    this.map.resize();   // o contêiner pode ter acabado de mudar (painel abrindo)
    if (!padIgual(this.pad, this.map.getPadding())) this.map.setPadding(this.pad);
  }
  /** mostra uma caixa [[o, s], [l, n]] inteira na parte do mapa que está à mostra */
  enquadrar(bbox, { maxZoom = 12.5, duracao = 1100 } = {}) {
    this.#firmarMargem();
    const el = this.map.getContainer();
    const w = el.clientWidth - this.pad.left - this.pad.right, h = el.clientHeight - this.pad.top - this.pad.bottom;
    // margens proporcionais ao espaço à mostra; à direita mais, porque os nomes saem para a direita do ponto e os
    // botões (bússola, localização) ficam desse lado
    const padding = { top: limita(h * 0.08, 16, 64), bottom: limita(h * 0.07, 14, 56), left: limita(w * 0.06, 14, 56), right: limita(w * 0.2, 56, 170) };
    const cam = this.map.cameraForBounds(bbox, { padding, maxZoom, bearing: 0 });
    if (!cam) return;
    // em 3D a câmera inclinada vê mais longe em cima: afasta um pouco para o trecho caber
    const p3 = this.st.relevo3D;
    this.map.easeTo({ ...cam, zoom: p3 ? cam.zoom - 0.5 : cam.zoom, pitch: p3 ? 50 : 0, bearing: 0, padding: this.pad,
      duration: reduzMovimento() ? 0 : duracao, essential: true });
  }
  voar(lngLat, zoom = 12.5) {
    this.#firmarMargem();
    this.map.flyTo({ center: lngLat, zoom: Math.max(zoom, this.map.getZoom()), pitch: this.st.relevo3D ? 55 : this.map.getPitch(),
      padding: this.pad, duration: reduzMovimento() ? 0 : 1200, essential: true });
  }
  norte() {
    this.map.easeTo({ bearing: 0, pitch: this.st.relevo3D ? this.map.getPitch() : 0, padding: this.pad, duration: reduzMovimento() ? 0 : 500 });
  }

  // ---------- aparência ----------
  /** troca tema/fundo. Devolve 'ok', 'outro-tema' (sem sinal: ficou o estilo do outro tema) ou 'falhou' (nada muda) */
  async #trocarEstilo(mudanca) {
    const g = ++this.geracao;
    try { await this.#estilo({ ...this.st, ...mudanca }); } catch { return g === this.geracao ? 'falhou' : 'ok'; }
    if (g !== this.geracao) return 'ok';   // um pedido mais novo assume
    // monta de novo com o estado de agora (sombra/3D podem ter mudado durante a espera; o estilo base já está guardado)
    Object.assign(this.st, mudanca);
    const { estilo, escuro } = await this.#estilo();
    this.escuroReal = escuro;
    this.map.setStyle(estilo);
    return escuro === !!this.st.escuro ? 'ok' : 'outro-tema';
  }
  async setTema(escuro) {
    if (escuro === this.st.escuro && escuro === this.escuroReal) return 'ok';
    return this.#trocarEstilo({ escuro });
  }
  async setFundo(fundo) {
    if (fundo === this.st.fundo) return 'ok';
    return this.#trocarEstilo({ fundo });   // o contorno das linhas muda (branco sobre o satélite)
  }
  setSombra(on) {
    this.st.sombra = on;
    if (this.map.getLayer('sombra')) this.map.setLayoutProperty('sombra', 'visibility', on && this.st.fundo !== 'satelite' ? 'visible' : 'none');
  }
  setRelevo3D(on) {
    this.st.relevo3D = on;
    this.map.setTerrain(on ? { source: 'dem-terreno', exaggeration: EXAGERO } : null);
    this.map.easeTo({ pitch: on ? 55 : 0, padding: this.pad, duration: reduzMovimento() ? 0 : 900 });
  }

  // ---------- onde estou ----------
  setPosicao(lngLat) {
    this.setMarcadores('eu', lngLat ? [{ chave: 'eu', lngLat, html: '<span class="me-dot"></span>', cls: 'mk--me', anchor: 'center',
      offset: [0, 0], titulo: 'Você está aqui', prioridade: 1000, fixo: true }] : []);
  }
}
