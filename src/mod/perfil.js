// Perfil de altitude do trecho de cada dia (data/perfis.json, feito pelo tools/build_perfil.ps1): bloco "Altitude do
// trecho" na ficha do dia, com o gráfico da rota em uso (plano A ou B) e as paradas, quanto sobe e desce, os pontos mais
// alto e mais baixo e as rampas fortes para o motorhome. Passar o dedo ou o mouse no gráfico (ou as setas, com o foco
// nele) mostra a altitude e o km e põe um marcador no mapa naquele ponto.

const JANELA = 3;       // km: rampa média medida em janelas de ~3 km
const FORTE = 6;        // %: acima disso, aviso para o motorhome
const ESPERA_TOQUE = 6000;   // ms: depois de soltar o dedo, o marcador fica um pouco e some
const RAD = Math.PI / 180, KM_GRAU = 6371.0088 * RAD;

let ctx, U;
let perfis = null;      // data/perfis.json (null enquanto não carregou ou se falhou)
const geo = new Map();  // rota → { c, cum, L, pts }: distâncias ao longo da linha (para ligar km ↔ mapa)
const cursorKm = new Map();   // rota → último km do cursor (o teclado continua dali)
let pendente = null, quadro = 0, tToque = 0;

// ---------- formatos ----------
/** altitude → "3.031 m" / "−84 m" (— se faltar o número) */
const metros = (e) => (Number.isFinite(e) ? `${e < 0 ? '−' : ''}${U.nf(Math.abs(Math.round(e)))} m` : '—');
const pes = (e) => `${U.nf(Math.round(e / 0.3048))} ft`;
/** km → "442", "2,2" (uma casa só abaixo de 10 km e quando não é redondo: "7" em vez de "7,0") */
const fkm = (km) => U.nf(km, km < 10 && Math.abs(km - Math.round(km)) >= 0.05 ? 1 : 0);
/** rampa em % → "6,4%" (sem sinal; quem chama diz se sobe ou desce) */
const pct = (g) => `${U.nf(Math.abs(g), 1)}%`;

// ---------- geometria da rota ----------
/** distâncias acumuladas da linha (o mesmo cálculo do build: plano local por segmento) e posição dos pontos dela */
function geom(id) {
  let g = geo.get(id);
  if (g) return g;
  const c = ctx.rotaPorId.get(id).geometry.coordinates, cum = new Float64Array(c.length);
  for (let i = 1; i < c.length; i++) {
    const dx = (c[i][0] - c[i - 1][0]) * Math.cos(((c[i][1] + c[i - 1][1]) / 2) * RAD) * KM_GRAU, dy = (c[i][1] - c[i - 1][1]) * KM_GRAU;
    cum[i] = cum[i - 1] + Math.hypot(dx, dy);
  }
  g = { c, cum, L: cum[c.length - 1] || 1 };
  geo.set(id, g);
  return g;
}
/** km do perfil → [lon, lat] na linha */
function llNoKm(id, km, total) {
  const { c, cum, L } = geom(id), s = (km / total) * L;
  let a = 0, b = c.length - 1;
  if (s <= 0) return c[0];
  if (s >= cum[b]) return c[b];
  while (b - a > 1) { const m = (a + b) >> 1; if (cum[m] <= s) a = m; else b = m; }
  const t = cum[b] > cum[a] ? (s - cum[a]) / (cum[b] - cum[a]) : 0;
  return [c[a][0] + t * (c[b][0] - c[a][0]), c[a][1] + t * (c[b][1] - c[a][1])];
}
/**
 * km do perfil onde a linha passa mais perto do ponto, procurando a partir do vértice 'desde' (para ida e volta pela
 * mesma estrada, as paradas seguem a ordem do caminho). longe = distância do ponto até a linha (km).
 */
function kmDoPonto(id, lon, lat, desde, total) {
  const { c, cum, L } = geom(id);
  const i0 = Math.max(0, Math.min(Math.floor(desde), c.length - 2));
  const r = ctx.posNaRota(c.slice(i0), lon, lat);
  const o = i0 + r.ordem, i = Math.min(Math.floor(o), c.length - 2), t = o - i;
  return { km: ((cum[i] + t * (cum[i + 1] - cum[i])) / L) * total, longe: r.km, ordem: o };
}
/** pontos da rota (paradas, passagens) com o km de cada um, na ordem do caminho: dão nome ao ponto mais alto etc. */
function pontosDaRota(id, total) {
  const g = geom(id);
  if (g.pts) return g.pts;
  let desde = 0;
  g.pts = [];
  for (const pid of ctx.rotaPorId.get(id).properties.pontos ?? []) {
    const P = ctx.dados.pontos[pid];
    if (!P) continue;
    const r = kmDoPonto(id, P.lon, P.lat, desde, total);
    if (r.longe > 1.5) continue;
    desde = r.ordem;
    g.pts.push({ id: pid, km: r.km });
  }
  return g.pts;
}
/** nome do ponto da rota mais perto do km (até 'raio' km), ou '' */
function ondeFica(id, km, total, raio = 4) {
  let melhor = null;
  for (const p of pontosDaRota(id, total)) if (Math.abs(p.km - km) <= raio && (!melhor || Math.abs(p.km - km) < Math.abs(melhor.km - km))) melhor = p;
  return melhor ? curto(ctx.nomePonto(melhor.id)) : '';
}
/** "Tioga Pass (entrada leste de Yosemite)" → "Tioga Pass"; "Kingman — centro…" → "Kingman" */
const curto = (nome) => nome.replace(/\s*[(—–].*$/, '').trim();

// ---------- perfil ----------
/** perfil de uma rota, ou null se faltar ou vier torto (d e z do mesmo tamanho, 2 amostras ou mais) */
function perfilDe(id) {
  const p = perfis?.[id];
  if (!p || !Array.isArray(p.d) || !Array.isArray(p.z) || p.d.length < 2 || p.d.length !== p.z.length) return null;
  if (!Array.isArray(p.max) || !Array.isArray(p.min)) {   // arquivo antigo/incompleto: acha aqui
    let a = 0, b = 0;
    p.z.forEach((z, i) => { if (z > p.z[a]) a = i; if (z < p.z[b]) b = i; });
    p.max = [p.d[a], p.z[a]]; p.min = [p.d[b], p.z[b]];
  }
  return p;
}
/** distância entre as amostras, para a nota: ~1 km; 250 m nos trechos curtos (e onde a estrada é a mesma de um deles) */
function passoTexto(p) {
  let curtos = 0;
  for (let i = 1; i < p.d.length; i++) if (p.d[i] - p.d[i - 1] < 0.5) curtos++;
  const f = curtos / (p.d.length - 1);
  return f > 0.8 ? '~250 m' : f < 0.2 ? '~1 km' : '250 m a 1 km';
}
/** altitude no km (reta entre as amostras) */
function zEm(p, km) {
  const { d, z } = p;
  let a = 0, b = d.length - 1;
  if (km <= d[0]) return z[0];
  if (km >= d[b]) return z[b];
  while (b - a > 1) { const m = (a + b) >> 1; if (d[m] <= km) a = m; else b = m; }
  return z[a] + ((z[b] - z[a]) * (km - d[a])) / (d[b] - d[a]);
}
/**
 * Rampas médias em janelas de ~3 km: a maior subida, a maior descida e os trechos (juntos) acima de FORTE %.
 * Rampa da janela = inclinação da reta que melhor passa pelas amostras dela (uma amostra ruim na ponta pesa menos;
 * o tools/build_perfil.ps1 mostra a mesma conta, feita no perfil suavizado, para conferir). g em %, positivo subindo.
 */
function rampas(p) {
  const { d, z } = p, n = d.length, fim = d[n - 1];
  const r = { sobe: null, desce: null, trechos: [] };
  if (fim < JANELA * 1.5) return r;
  for (let i = 0; i < n && d[i] + JANELA <= fim + 1e-9; i++) {
    let m = 0, sx = 0, sz = 0;
    for (let k = i; k < n && d[k] <= d[i] + JANELA + 1e-9; k++) { sx += d[k]; sz += z[k]; m++; }
    if (m < 3) continue;
    const mx = sx / m, mz = sz / m;
    let sxx = 0, sxz = 0;
    for (let k = i; k < i + m; k++) { sxx += (d[k] - mx) ** 2; sxz += (d[k] - mx) * (z[k] - mz); }
    const a = d[i], b = d[i + m - 1], g = sxz / sxx / 10;   // m por km → %
    if (!r.sobe || g > r.sobe.g) r.sobe = { g, a, b };
    if (!r.desce || g < r.desce.g) r.desce = { g, a, b };
    if (Math.abs(g) < FORTE) continue;
    const s = Math.sign(g), u = r.trechos[r.trechos.length - 1];
    // junta com o trecho anterior se a folga entre eles for curta (até ~3 km: a mesma serra)
    if (u && u.s === s && a <= u.b + 3.5) { u.b = Math.max(u.b, b); if (Math.abs(g) > Math.abs(u.g)) u.g = g; }
    else r.trechos.push({ s, a, b, g });
  }
  return r;
}
/** escala vertical: limites com folga e marcas "redondas" */
function escala(p) {
  let lo = Math.min(...p.z), hi = Math.max(...p.z);
  if (hi - lo < 200) { const m = (hi + lo) / 2; lo = m - 100; hi = m + 100; }   // trecho plano: não exagera
  const span = hi - lo;
  const passo = [10, 20, 25, 50, 100, 200, 250, 500, 1000].find((s) => span / s <= 4.5) ?? 1000, un = passo / 5;
  lo = Math.floor((lo - span * 0.04) / un) * un;
  hi = Math.ceil((hi + span * 0.16) / un) * un;   // folga em cima para o rótulo do ponto mais alto
  const marcas = [];
  for (let v = Math.ceil(lo / passo) * passo; v < hi - passo * 0.2; v += passo) marcas.push(v);
  return { lo, hi, marcas, mar: Math.min(...p.z) < 0 };   // mar: o trecho desce abaixo do nível do mar
}

// ---------- bloco da ficha ----------
function htmlGrafico(d, rota, p, E, rp, marcos) {
  const total = p.d[p.d.length - 1];
  const X = (km) => (km / total) * 1000, Y = (z) => ((E.hi - z) / (E.hi - E.lo)) * 100;
  const xp = (km) => `${((km / total) * 100).toFixed(2)}%`, yp = (z) => `${Y(z).toFixed(2)}%`;
  const linha = p.d.map((km, i) => `${i ? 'L' : 'M'}${X(km).toFixed(1)} ${Y(p.z[i]).toFixed(2)}`).join('');
  // trechos fortes: o pedaço da linha entre a e b
  const pedaco = (a, b) => {
    const pts = [[a, zEm(p, a)], ...p.d.map((km, i) => [km, p.z[i]]).filter(([km]) => km > a && km < b), [b, zEm(p, b)]];
    return pts.map(([km, z], i) => `${i ? 'L' : 'M'}${X(km).toFixed(1)} ${Y(z).toFixed(2)}`).join('');
  };
  // com um contorno da cor do painel: o trecho se destaca mesmo quando a cor do dia é parecida (dia 13 × descida)
  const fortes = rp.trechos.map((t) => { const c = pedaco(t.a, t.b); return `<path class="perfil-borda" d="${c}"/><path class="perfil-${t.s < 0 ? 'desce' : 'sobe'}" d="${c}"/>`; }).join('');
  // linhas de altitude (rótulos na coluna da esquerda); abaixo do nível do mar (Death Valley), o zero fica tracejado
  const marcas = E.mar && !E.marcas.includes(0) ? [...E.marcas, 0] : E.marcas;
  const grade = marcas.map((v) => `<path class="perfil-grade${E.mar && v === 0 ? ' is-mar' : ''}" d="M0 ${Y(v).toFixed(2)}H1000"/>`).join('');
  const rotY = marcas.map((v) => `<span style="top:${yp(v)}">${metros(v)}</span>`).join('');
  // marcas do eixo x (a última vira o total da rota)
  const px = [1, 2, 5, 10, 20, 25, 50, 100, 200].find((s) => total / s <= 6) ?? 200;
  const rotX = [];
  for (let k = 0; k < total * 0.8; k += px) rotX.push(`<span style="left:${xp(k)}"${k === 0 ? ' class="is-ini"' : ''}>${U.nf(k)}</span>`);
  rotX.push(`<span style="left:100%" class="is-fim">${fkm(total)} km</span>`);
  // paradas do dia e o ponto mais alto
  const mks = marcos.map((m) => `<span class="perfil-mk${m.cls}" style="left:${xp(m.km)};top:${yp(zEm(p, m.km))}" title="${U.esc(m.nome)}" aria-hidden="true">${m.num}</span>`).join('');
  const [kmMax, zMax] = p.max, fx = kmMax / total;
  const alto = `<span class="perfil-alto${fx < 0.1 ? ' is-ini' : fx > 0.9 ? ' is-fim' : ''}" style="left:${xp(kmMax)};top:${yp(zMax)}" aria-hidden="true">${metros(zMax)}</span>`;
  const txt0 = `km 0: ${metros(p.z[0])}`;
  return `<div class="perfil-graf" data-perfil-graf="${U.esc(rota)}" data-perfil-lo="${E.lo}" data-perfil-hi="${E.hi}" tabindex="0" role="slider"
      aria-label="Perfil de altitude do dia ${d.n}. As setas percorrem o trecho." aria-valuemin="0" aria-valuemax="${Math.round(total)}" aria-valuenow="0" aria-valuetext="${txt0}">
    <div class="perfil-y" aria-hidden="true">${rotY}</div>
    <div class="perfil-plot">
      <svg viewBox="0 0 1000 100" preserveAspectRatio="none" aria-hidden="true" focusable="false">
        ${grade}<path class="perfil-area" d="${linha}L1000 100L0 100Z"/><path class="perfil-linha" d="${linha}"/>${fortes}
      </svg>
      ${mks}${alto}
      <div class="perfil-cur" hidden><i></i></div>
      <div class="perfil-tip" hidden aria-hidden="true"></div>
    </div>
    <div class="perfil-x" aria-hidden="true">${rotX.join('')}</div>
  </div>`;
}

/** paradas do dia na rota em uso, com o km de cada uma (as fora da rota não entram) */
function marcosDoDia(d, rota, total) {
  const P = ctx.rotaPorId.get(rota).properties;
  let desde = 0, i = 0;
  const out = [];
  for (const it of ctx.listaParadas(d)) {
    if (it.papel === 'parada') i++;
    const pt = ctx.dados.pontos[it.id];
    if (it.fora || !pt) continue;
    let km;
    if (it.papel === 'inicio') km = 0;
    else if (it.papel === 'pernoite' && P.pontos[P.pontos.length - 1] === it.id) km = total;
    else {
      const r = kmDoPonto(rota, pt.lon, pt.lat, desde, total);
      if (r.longe > 1.5) continue;
      km = r.km; desde = r.ordem;
    }
    out.push({ km, nome: ctx.nomePonto(it.id), num: it.papel === 'inicio' ? '▶' : it.papel === 'pernoite' ? '★' : i,
      cls: it.papel === 'inicio' ? ' is-ini' : it.papel === 'pernoite' ? ' is-stay' : '' });
  }
  return out;
}

const num = (rot, val, extra = '') => `<div><dt>${rot}</dt><dd>${val}${extra ? `<small>${U.esc(extra)}</small>` : ''}</dd></div>`;

function htmlBloco(d) {
  const a = ctx.ativo(d), rota = a.rota, p = perfilDe(rota);
  if (!p) return '';
  const total = p.d[p.d.length - 1], shuttle = ctx.rotaPorId.get(rota).properties.tipo === 'shuttle';
  const E = escala(p), rp = rampas(p), marcos = marcosDoDia(d, rota, total);
  const [kmMax, zMax] = p.max, [kmMin, zMin] = p.min;
  const ondeMax = ondeFica(rota, kmMax, total, 2), ondeMin = ondeFica(rota, kmMin, total, 2);
  const numeros = `<dl class="perfil-num">
      ${num('Sobe', metros(p.sobe))}${num('Desce', metros(p.desce))}
      ${num('Mais alto', metros(zMax), ondeMax || `km ${fkm(kmMax)}`)}${num('Mais baixo', metros(zMin), ondeMin || `km ${fkm(kmMin)}`)}</dl>`;
  // maior subida e maior descida (em ~3 km), com o lugar
  const lugar = (t) => { const o = ondeFica(rota, (t.a + t.b) / 2, total, 8); return `km ${fkm(t.a)}–${fkm(t.b)}${o ? ` · perto de ${U.esc(o)}` : ''}`; };
  const itens = [];
  if (rp.sobe && rp.sobe.g >= 2) itens.push(`<li><b>Maior subida</b> ${pct(rp.sobe.g)} <small>${lugar(rp.sobe)}</small></li>`);
  if (rp.desce && rp.desce.g <= -2) itens.push(`<li><b>Maior descida</b> ${pct(rp.desce.g)} <small>${lugar(rp.desce)}</small></li>`);
  const lista = itens.length ? `<ul class="perfil-rampas" aria-label="Rampas médias em ~${JANELA} km">${itens.join('')}</ul>`
    : `<p class="hint">Sem rampa longa: nada passa de 2% em ~${JANELA} km.</p>`;
  // avisos para o motorhome (no shuttle quem dirige é o motorista do parque)
  const trechos = (s) => rp.trechos.filter((t) => t.s === s);
  const onde = (l) => l.map((t) => { const o = ondeFica(rota, (t.a + t.b) / 2, total, (t.b - t.a) / 2 + 3); return `km ${fkm(t.a)}–${fkm(t.b)}${o ? ` (${U.esc(o)})` : ''}`; }).join(', ');
  const des = trechos(-1), sub = trechos(1);
  let avisos = '';
  if (shuttle) avisos = '<p class="hint">Dia de shuttle: quem enfrenta as rampas é o ônibus do parque.</p>';
  else {
    if (des.length) avisos += `<p class="cc-warn"><b>Descida longa e forte (até ${pct(Math.min(...des.map((t) => t.g)))} em ~${JANELA} km): use marcha baixa/freio-motor</b> e freie só em toques curtos, para o freio não esquentar. ${des.length > 1 ? `${des.length} trechos` : 'Trecho'}: ${onde(des)}.</p>`;
    if (sub.length) avisos += `<p class="cc-warn"><b>Subida forte (até ${pct(Math.max(...sub.map((t) => t.g)))} em ~${JANELA} km):</b> o motor esquenta; use marcha baixa e fique de olho na temperatura (se ela subir, desligue o ar-condicionado). ${sub.length > 1 ? `${sub.length} trechos` : 'Trecho'}: ${onde(sub)}.</p>`;
  }
  const legs = [];
  if (!shuttle && des.length) legs.push('<span><i class="is-desce"></i>descida forte</span>');
  if (!shuttle && sub.length) legs.push('<span><i class="is-sobe"></i>subida forte</span>');
  if (legs.length) legs.push(`<span>(≥ ${FORTE}% em ~${JANELA} km)</span>`);
  if (E.mar) legs.push('<span><i class="is-mar"></i>nível do mar</span>');
  const leg = legs.length ? `<p class="perfil-leg" aria-hidden="true">${legs.join('')}</p>` : '';
  // a outra rota do dia (plano A × B), para comparar
  let outra = '';
  if (d.planoB && !d.planoB.acompanha) {
    const r2 = a.b ? d.rota : d.planoB.rota, p2 = perfilDe(r2);
    if (p2) outra = `<p class="hint">${a.b ? 'Pela rota principal' : 'Pelo plano B'}: sobe ${metros(p2.sobe)}, desce ${metros(p2.desce)}, ponto mais alto ${metros(p2.max[1])}.</p>`;
  }
  const info = perfis._info ?? {};
  return `<section class="blk perfil" id="perfil-${d.n}" style="--c:${U.corDia(d.n)}">
    <h3>Altitude do trecho <span>${a.b ? 'plano B · ' : ''}estimativa</span></h3>
    ${numeros}
    ${htmlGrafico(d, rota, p, E, shuttle ? { ...rp, trechos: [] } : rp, marcos)}
    ${leg}${lista}${avisos}${outra}
    <p class="cc-note">Nas placas dos EUA a altitude vem em pés: ${metros(zMax)} ≈ ${pes(zMax)}. Altitudes do modelo de relevo Copernicus (90 m) a cada ${passoTexto(p)}, pela Open-Meteo${info.gerado_em ? ` (${U.fmtDia(info.gerado_em)})` : ''}: túneis e pontes podem sair um pouco errados. Rampa = média em ~${JANELA} km; dentro dela há pedaços mais íngremes.</p>
  </section>`;
}

// ---------- cursor no gráfico + marcador no mapa ----------
function partes(graf) {
  const rota = graf.dataset.perfilGraf, p = perfilDe(rota);
  return p && { rota, p, total: p.d[p.d.length - 1], lo: +graf.dataset.perfilLo, hi: +graf.dataset.perfilHi,
    plot: graf.querySelector('.perfil-plot'), cur: graf.querySelector('.perfil-cur'), tip: graf.querySelector('.perfil-tip') };
}
function mostrar(graf, km) {
  const g = partes(graf);
  if (!g) return;
  km = Math.max(0, Math.min(g.total, km));
  const z = zEm(g.p, km), fx = km / g.total;
  // rampa local (±1 km) para o texto
  const r = (zEm(g.p, Math.min(g.total, km + 1)) - zEm(g.p, Math.max(0, km - 1))) / ((Math.min(g.total, km + 1) - Math.max(0, km - 1)) * 10 || 1);
  const rampa = Math.abs(r) >= 2 ? ` · ${r > 0 ? '↗' : '↘'} ${pct(r)}` : '';
  const perto = ondeFica(g.rota, km, g.total, 1.5);   // parada ou passagem a até ~1,5 km
  const fy = (g.hi - z) / (g.hi - g.lo);
  graf.classList.add('is-cur');   // esconde o rótulo fixo do ponto mais alto (a dica já diz a altitude)
  g.cur.hidden = false; g.tip.hidden = false;
  g.cur.style.left = `${(fx * 100).toFixed(2)}%`;
  g.cur.firstElementChild.style.top = `${(fy * 100).toFixed(2)}%`;
  g.tip.textContent = `${metros(z)} · km ${fkm(km)}${rampa}${perto ? `\n${perto}` : ''}`;
  // a dica fica dentro do gráfico e não cobre o ponto: acima dele ou, perto do topo, abaixo
  const W = g.plot.clientWidth, H = g.plot.clientHeight, w = g.tip.offsetWidth, h = g.tip.offsetHeight, x = fx * W, y = fy * H;
  g.tip.style.left = `${Math.max(0, Math.min(W - w, x - w / 2)).toFixed(1)}px`;
  g.tip.style.top = `${(y - h - 10 >= 0 ? y - h - 10 : Math.min(H - h, y + 10)).toFixed(1)}px`;
  graf.setAttribute('aria-valuenow', String(Math.round(km)));
  graf.setAttribute('aria-valuetext', `km ${fkm(km)}: ${metros(z)}${r >= 2 ? `, subindo ${pct(r)}` : r <= -2 ? `, descendo ${pct(r)}` : ''}${perto ? `, perto de ${perto}` : ''}`);
  cursorKm.set(g.rota, km);
  marcador({ chave: 'perfil', lngLat: llNoKm(g.rota, km, g.total), cls: 'mk--perfil', style: graf.closest('.perfil')?.getAttribute('style') ?? '',
    html: `<span class="g" aria-hidden="true"></span><span class="nm">${metros(z)}</span>`, titulo: `Perfil: km ${fkm(km)}, ${metros(z)}`,
    prioridade: -1, fixo: true });
}
function esconder(graf) {
  const g = graf && partes(graf);
  if (g) { g.cur.hidden = true; g.tip.hidden = true; graf.classList.remove('is-cur'); }
  marcador(null);
}
/** um pedido ao mapa por quadro (o dedo gera muitos eventos) */
function marcador(item) {
  pendente = item;
  if (quadro) return;
  quadro = requestAnimationFrame(() => {
    quadro = 0;
    const m = ctx.mapa();
    if (!m) return;
    m.setMarcadores('perfil', pendente ? [pendente] : []);
    // só mostra (o gráfico já diz tudo ao leitor de tela): fora do Tab
    const b = document.querySelector('#map .mk--perfil');
    if (b) { b.tabIndex = -1; b.setAttribute('aria-hidden', 'true'); }
  });
}
const kmDoEvento = (graf, e) => {
  const g = partes(graf);
  if (!g) return 0;
  const r = g.plot.getBoundingClientRect();
  return (Math.max(0, Math.min(1, (e.clientX - r.left) / r.width))) * g.total;
};
/** liga o gráfico recém-desenhado: mouse, dedo e teclado */
function ligar(graf) {
  const plot = graf.querySelector('.perfil-plot');
  // o cursor veio do teclado? (aí perder o foco tira o marcador; o do dedo fica uns segundos, mesmo tocando no mapa)
  let teclado = false;
  plot.addEventListener('pointerdown', (e) => {
    clearTimeout(tToque);
    teclado = false;
    if (e.pointerType !== 'mouse') try { plot.setPointerCapture(e.pointerId); } catch { /* ponteiro já solto */ }
    mostrar(graf, kmDoEvento(graf, e));
  });
  plot.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse' && !e.buttons && !plot.hasPointerCapture?.(e.pointerId)) return;
    mostrar(graf, kmDoEvento(graf, e));
  });
  plot.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') esconder(graf); });
  // dedo: o marcador fica alguns segundos depois de soltar (para dar tempo de olhar o mapa)
  plot.addEventListener('pointerup', (e) => {
    if (e.pointerType === 'mouse') return;
    clearTimeout(tToque); tToque = setTimeout(() => esconder(graf), ESPERA_TOQUE);
  });
  plot.addEventListener('pointercancel', () => esconder(graf));   // o painel começou a rolar
  graf.addEventListener('focus', () => {
    if (!graf.matches(':focus-visible')) return;
    teclado = true; clearTimeout(tToque);
    mostrar(graf, cursorKm.get(graf.dataset.perfilGraf) ?? 0);
  });
  graf.addEventListener('blur', () => { if (teclado) esconder(graf); teclado = false; });
  graf.addEventListener('keydown', (e) => {
    const g = partes(graf);
    if (!g || e.altKey || e.ctrlKey || e.metaKey) return;
    const passo = Math.max(0.25, g.total / 100), atual = cursorKm.get(g.rota) ?? 0;
    const novo = { ArrowRight: atual + passo, ArrowUp: atual + passo, ArrowLeft: atual - passo, ArrowDown: atual - passo,
      PageUp: atual + passo * 10, PageDown: atual - passo * 10, Home: 0, End: g.total }[e.key];
    if (novo == null) return;
    e.preventDefault();   // as setas também trocam de dia no app: aqui elas andam no gráfico
    teclado = true; clearTimeout(tToque);
    mostrar(graf, (e.shiftKey && e.key.startsWith('Arrow') ? atual + (novo - atual) * 10 : novo));
  });
}

// ---------- estilo ----------
const CSS = `
  .perfil { container-type: inline-size; }
  .perfil-num { margin: 0; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px; }
  @container (max-width: 340px) { .perfil-num { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
  .perfil-num div { display: grid; gap: 3px; align-content: start; padding: 7px 6px 8px; border-radius: 8px; background: var(--tile); text-align: center; min-width: 0; }
  .perfil-num dt { font: 600 10px/1.1 var(--f-display); letter-spacing: .1em; text-transform: uppercase; color: var(--ink-soft); }
  .perfil-num dd { margin: 0; font: 700 19px/1 var(--f-display); }
  .perfil-num dd small { display: block; margin-top: 3px; font: 500 10.5px/1.25 var(--f-body); color: var(--ink-soft); overflow-wrap: anywhere; }
  .perfil-graf { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 3px 11px; padding-top: 2px; border-radius: 8px; outline: none; }
  .perfil-graf:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
  .perfil-y { position: relative; min-width: 3.6em; font: 10px/1 var(--f-data); color: var(--ink-soft); }
  .perfil-y span { position: absolute; right: 0; transform: translateY(-50%); white-space: nowrap; }
  .perfil-graf .perfil-x { grid-column: 2; }
  .perfil-plot { position: relative; height: 140px; touch-action: pan-y; cursor: crosshair; user-select: none; -webkit-user-select: none; -webkit-tap-highlight-color: transparent; }
  .perfil-plot svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
  .perfil-plot path { vector-effect: non-scaling-stroke; }
  .perfil-area { fill: color-mix(in srgb, var(--c) 22%, transparent); }
  .perfil-linha { fill: none; stroke: color-mix(in srgb, var(--c) 80%, var(--ink)); stroke-width: 2; stroke-linejoin: round; }
  .perfil-grade { fill: none; stroke: var(--panel-line); stroke-width: 1; }
  .perfil-grade.is-mar { stroke: var(--hydro); stroke-dasharray: 5 4; }
  .perfil-borda, .perfil-desce, .perfil-sobe { fill: none; stroke-width: 4; stroke-linecap: round; stroke-linejoin: round; }
  .perfil-borda { stroke: var(--panel); stroke-width: 8; }
  .perfil-desce { stroke: var(--g-alta); }
  .perfil-sobe { stroke: var(--g-media); }
  .perfil-x { position: relative; height: 13px; font: 10px/1 var(--f-data); color: var(--ink-soft); }
  .perfil-x span { position: absolute; top: 1px; transform: translateX(-50%); white-space: nowrap; }
  .perfil-x .is-ini { transform: none; }
  .perfil-x .is-fim { transform: translateX(-100%); color: var(--ink); }
  .perfil-mk { position: absolute; z-index: 1; width: 18px; height: 18px; margin: -9px 0 0 -9px; box-sizing: border-box; border-radius: 50%; display: grid; place-items: center;
    font: 600 9.5px/1 var(--f-data); background: var(--panel); color: color-mix(in srgb, var(--c) 55%, var(--ink)); border: 2px solid var(--c); pointer-events: none; }
  .perfil-mk.is-ini { background: color-mix(in srgb, var(--c) 70%, #000); border-color: color-mix(in srgb, var(--c) 70%, #000); color: #fff; font-size: 8px; }
  .perfil-mk.is-stay { background: var(--gold); border-color: var(--gold); color: #1d1608; }
  .perfil-alto { position: absolute; z-index: 1; transform: translate(-50%, calc(-100% - 11px)); padding: 2px 4px; border-radius: 4px; font: 600 10.5px/1 var(--f-data); color: var(--ink); background: var(--label-bg); white-space: nowrap; pointer-events: none; }
  .perfil-alto.is-ini { transform: translate(-6px, calc(-100% - 11px)); }
  .perfil-alto.is-fim { transform: translate(calc(-100% + 6px), calc(-100% - 11px)); }
  .perfil-graf.is-cur .perfil-alto { visibility: hidden; }
  .perfil-cur { position: absolute; z-index: 2; top: 0; bottom: 0; width: 0; border-left: 1px solid var(--ink); pointer-events: none; }
  .perfil-cur i { position: absolute; left: -7px; width: 13px; height: 13px; margin-top: -7px; box-sizing: border-box; border-radius: 50%; background: var(--c); border: 2px solid var(--panel); box-shadow: 0 0 0 1px var(--ink); }
  .perfil-tip { position: absolute; z-index: 3; top: 0; left: 0; padding: 4px 7px; border-radius: 6px; font: 600 11.5px/1.3 var(--f-data); background: var(--ink); color: var(--panel); white-space: pre; pointer-events: none; box-shadow: 0 1px 4px rgba(0,0,0,.25); }
  .perfil p.cc-note { font-size: 11.5px; }
  .perfil p.perfil-leg { margin: 0; display: flex; flex-wrap: wrap; gap: 2px 12px; font: 11px/1.3 var(--f-data); color: var(--ink-soft); }
  .perfil-leg span { display: inline-flex; align-items: center; gap: 5px; }
  .perfil-leg i { display: inline-block; width: 16px; height: 0; border-top: 4px solid; border-radius: 2px; }
  .perfil-leg i.is-desce { border-color: var(--g-alta); }
  .perfil-leg i.is-sobe { border-color: var(--g-media); }
  .perfil-leg i.is-mar { border-top: 1px dashed var(--hydro); }
  .perfil .perfil-rampas { list-style: none; margin: 0; padding: 0; display: grid; gap: 3px; font-size: 13.5px; line-height: 1.4; }
  .perfil-rampas b { font: 600 11px/1.3 var(--f-display); letter-spacing: .1em; text-transform: uppercase; color: var(--ink-soft); margin-right: 4px; }
  .perfil-rampas small { font: 11.5px/1.3 var(--f-data); color: var(--ink-soft); }
  .mk--perfil { pointer-events: none; }
  .mk--perfil .g { width: 18px; min-width: 18px; height: 18px; padding: 0; border-radius: 50%; background: var(--c, var(--accent)); border: 3px solid #fff; box-shadow: 0 0 0 1px rgba(0,0,0,.45); }
  .mk--perfil .nm { font-family: var(--f-data); font-weight: 500; font-size: 11.5px; }
  @media (max-width: 700px) { .perfil-plot { height: 120px; } }
`;

// ---------- início ----------
async function carregar() {
  try {
    const r = await fetch('data/perfis.json');
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    perfis = await r.json();
  } catch (e) { console.warn('perfil:', e.message ?? e); return; }
  ctx.atualizarDia();
}

export function iniciar(c) {
  ctx = c; U = c.util;
  if (!document.getElementById('mod-perfil')) {
    const st = document.createElement('style');
    st.id = 'mod-perfil'; st.textContent = CSS;
    document.head.append(st);
  }
  ctx.registrar({
    blocoDia: { lugar: 'depois-paradas', html: htmlBloco },
    aoRenderDia: (n, el) => {
      clearTimeout(tToque);
      marcador(null);   // a ficha foi redesenhada: o cursor antigo sumiu junto
      const graf = el.querySelector('[data-perfil-graf]');
      if (graf) ligar(graf);
    },
    aoRenderViagem: () => { clearTimeout(tToque); marcador(null); },
    // outro painel: tira o marcador e o cursor (para não voltar com o cursor no gráfico e nada no mapa)
    aoMostrarPainel: () => { clearTimeout(tToque); esconder(document.querySelector('#day [data-perfil-graf]')); },
  });
  carregar();   // em segundo plano: a ficha ganha o bloco quando o arquivo chegar
}
