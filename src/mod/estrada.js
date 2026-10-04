// Modo na estrada: com o GPS ligado (botão "onde estou"), um cartão sobre o mapa mostra quanto já foi feito e quanto
// falta até o pernoite, a próxima parada, a chegada estimada, o pôr do sol e onde pegar água ou combustível à frente.
// Contrato dos módulos: src/mod/LEIAME.md.

const RAIO_KM = 15;        // mais longe que isso da rota do dia, o cartão some
const INTERVALO = 2000;    // o GPS manda muitas posições: no máximo uma conta a cada 2 s
const MARGEM_MIN = 24;     // celular: a margem de cima do mapa só muda se o cartão mudar mais que isso (px)
const RE_COMB = /combust|gasolin|diesel|\bpostos?\b|abastec|propano|\bgas\b|\bfuel/i;
const RE_AGUA = /água|agua|\bdump\b|despej|esgoto|potável|\bwater\b/i;
const SVG_GPS = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3"/><circle cx="12" cy="12" r="7"/></svg>';
const SVG_X = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';
const SVG_SETA = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';

const CSS = `
  #estrada-cartao { left: calc(var(--side-w) + 16px); bottom: calc(16px + env(safe-area-inset-bottom, 0px)); z-index: 4;
    width: min(340px, calc(100vw - var(--side-w) - 104px)); box-sizing: border-box; padding: 6px 6px 10px 12px; display: grid; gap: 7px; }
  .estrada-top { display: flex; align-items: center; gap: 2px; min-width: 0; }
  .estrada-top .eyebrow { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; line-height: 1.3; }
  .estrada-top .eyebrow .day-dot { width: 10px; height: 10px; border-radius: 3px; margin-right: 5px; }
  .estrada-ic { all: unset; cursor: pointer; flex: 0 0 auto; width: 34px; height: 34px; display: grid; place-items: center; border-radius: 8px; color: var(--ink-soft); }
  .estrada-ic:hover { color: var(--ink); background: color-mix(in srgb, var(--ink) 8%, transparent); }
  .estrada-ic:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
  .estrada-ic svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; transition: transform .2s; }
  .estrada-ic[aria-expanded="false"] svg { transform: rotate(180deg); }
  #estrada-corpo { display: grid; gap: 7px; padding-right: 6px; }
  .estrada-num { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
  .estrada-num div { display: grid; gap: 2px; min-width: 0; }
  .estrada-num b { font: 700 22px/1 var(--f-display); letter-spacing: .01em; white-space: nowrap; }
  .estrada-num span { font: 600 10.5px/1.2 var(--f-display); letter-spacing: .1em; text-transform: uppercase; color: var(--ink-soft); }
  .estrada-bar { position: relative; height: 8px; margin: 2px 0; border-radius: 4px; background: color-mix(in srgb, var(--ink) 11%, transparent); }
  .estrada-bar > span { position: absolute; left: 0; top: 0; bottom: 0; border-radius: 4px; background: var(--c); }
  .estrada-bar i { position: absolute; top: -3px; bottom: -3px; width: 2px; margin-left: -1px; border-radius: 1px; background: var(--ink-soft); }
  .estrada-bar i.is-ok { background: var(--c); opacity: .6; }
  .estrada-bar b { position: absolute; top: 50%; width: 14px; height: 14px; margin: -7px 0 0 -7px; box-sizing: border-box; border-radius: 50%; background: #2f8fe0; border: 3px solid #fff; box-shadow: 0 1px 4px rgba(0,0,0,.4); }
  .estrada-l { list-style: none; margin: 0; padding: 0; display: grid; gap: 3px; font-size: 13px; line-height: 1.35; }
  .estrada-l li { display: flex; align-items: baseline; gap: 8px; min-width: 0; }
  .estrada-l .k { flex: 0 0 auto; width: 74px; font: 600 10.5px/1.3 var(--f-display); letter-spacing: .1em; text-transform: uppercase; color: var(--ink-soft); }
  .estrada-l .v { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
  .estrada-l .v small { font-weight: 400; color: var(--ink-soft); }
  .estrada-l .d { flex: 0 0 auto; font: 12px var(--f-data); color: var(--contour); white-space: nowrap; }
  #estrada-cartao .cc-warn { margin-top: 6px; font-size: 12.5px; padding: 5px 8px; }
  .estrada-nota { margin: 5px 0 0; font-size: 11px; line-height: 1.35; color: var(--ink-soft); }
  #estrada-cartao.is-min .estrada-mais { display: none; }
  #estrada-cartao.is-coberto { visibility: hidden; }   /* gaveta alta por cima: nada de cartão cortado */
  .estrada-blk .btn { justify-self: start; min-height: 40px; }
  /* no computador (mouse), o botão "Começar o dia" não faz sentido */
  @media (min-width: 701px) and (pointer: fine) { .estrada-blk { display: none; } }
  /* no computador há espaço: nomes longos quebram em até 2 linhas (no celular, 1 linha; o nome inteiro fica no title) */
  @media (min-width: 701px) { .estrada-l .v { white-space: normal; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-clamp: 2; } }
  @media (max-width: 700px) {
    #estrada-cartao { left: 10px; right: 10px; width: auto; bottom: auto; top: calc(10px + env(safe-area-inset-top, 0px)); padding: 2px 2px 8px 10px; gap: 5px; }
    body:has(#net:not([hidden])) #estrada-cartao { top: calc(48px + env(safe-area-inset-top, 0px)); }
    #estrada-cartao.is-estreito { right: 66px; }   /* deixa a coluna da bússola livre */
    .estrada-ic { width: 40px; height: 40px; }
    .estrada-num b { font-size: 20px; }
    #estrada-corpo { gap: 5px; padding-right: 8px; }
    .estrada-nota { margin-top: 3px; }
    .estrada-sopc { display: none; }   /* no celular, a nota fica curta (mas diz que é estimativa e o fuso) */
  }
  @media (prefers-reduced-motion: reduce) { .estrada-ic svg { transition: none; } }
`;

let ctx, U, cartao;
let ultimo = null;          // última posição do GPS { ll, coords }
let proxConta = 0, timer = 0, relogio = 0;
let visivel = false;
let diaEscolhido = null;    // dia ligado no botão "Começar o dia" (vale até o GPS desligar ou a data virar)
let escolhidoEm = '';       // data do aparelho quando o dia foi escolhido
let margem = 0;             // margem de cima do mapa no celular (o cartão cobre o alto da tela)
let fechado = false;        // a pessoa fechou o cartão: volta quando o GPS religar ou no "Começar o dia"
let avisarFora = false;     // depois do "Começar o dia", avisa uma vez se a posição está longe da rota
let andado = null;          // { rota, km }: último ponto na rota (para laços e idas e voltas)
let fichaLigada = false;
let htmlTit = '', htmlCorpo = '';   // o que está desenhado (sem mudança, o cartão não é refeito)
let rotaMostrada = '';      // id da rota do cartão à mostra
const medidas = new Map();  // id da rota → km acumulado em cada vértice

export function iniciar(c) {
  ctx = c; U = c.util;
  const st = document.createElement('style');
  st.id = 'mod-estrada';
  st.textContent = CSS;
  document.head.append(st);

  cartao = document.createElement('section');
  cartao.id = 'estrada-cartao';
  cartao.className = 'sheet';
  cartao.hidden = true;
  cartao.setAttribute('aria-label', 'Na estrada');
  const min = U.store.get('estrada.min') === '1';
  cartao.classList.toggle('is-min', min);
  cartao.innerHTML = `<div class="estrada-top">
      <span class="eyebrow" id="estrada-tit"></span>
      <button type="button" class="estrada-ic" data-estrada="min" aria-expanded="${!min}" aria-controls="estrada-mais" aria-label="Detalhes da estrada" title="Mostrar mais ou menos">${SVG_SETA}</button>
      <button type="button" class="estrada-ic" data-estrada="fechar" aria-label="Fechar o cartão da estrada" title="Fechar">${SVG_X}</button>
    </div>
    <div id="estrada-corpo"></div>`;
  document.body.append(cartao);
  cartao.addEventListener('click', (e) => {
    const b = e.target.closest('[data-estrada]');
    if (!b) return;
    if (b.dataset.estrada === 'fechar') { fechado = true; esconder(); ctx.anunciar('Cartão da estrada fechado. Volta ao religar o GPS.'); return; }
    const on = !cartao.classList.toggle('is-min');
    b.setAttribute('aria-expanded', String(on));
    U.store.set('estrada.min', on ? '0' : '1');
    ajustar();
  });

  // a gaveta muda --map-bottom no <html> e a bússola anda até a nova altura: confere de novo se ela encosta no cartão
  new MutationObserver(ajustar).observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });
  U.$('#nav')?.addEventListener('transitionend', ajustar);
  U.$('#pane')?.addEventListener('transitionend', (e) => { if (e.target.id === 'pane') ajustar(); });   // gaveta alta/meia
  addEventListener('resize', ajustar);

  ctx.registrar({
    blocoDia: { lugar: 'depois-paradas', html: blocoDia },
    aoRenderDia: (n, el) => {
      if (!fichaLigada) {   // a ficha é refeita com innerHTML: um ouvinte só, por delegação
        fichaLigada = true;
        el.addEventListener('click', (e) => {
          const b = e.target.closest('[data-estrada-comecar]');
          if (b) comecar(+b.dataset.estradaComecar);
        });
      }
      if (ultimo) agendar();   // o dia aberto ou a rota (plano A/B) podem ter mudado
    },
    aoPosicao,
    aoSinal: () => requestAnimationFrame(ajustar),   // no celular, o aviso "Sem sinal" empurra o cartão para baixo
  });
}

// ---------- bloco na ficha do dia ----------
function blocoDia(d) {
  if (ctx.rotaAtiva(d).properties.tipo === 'shuttle') return '';
  return `<section class="blk estrada-blk"><h3>Na estrada</h3>
    <button type="button" class="btn btn--small" data-estrada-comecar="${d.n}">${SVG_GPS}Começar o dia (GPS)</button>
    <p class="hint">Liga o GPS e mostra sobre o mapa quanto falta até o pernoite, a próxima parada e a chegada estimada.</p></section>`;
}
function comecar(n) {
  diaEscolhido = n; escolhidoEm = isoHoje(); fechado = false; avisarFora = true; andado = null;
  if (ctx.diaAberto() !== n) ctx.abrirDia(n);
  if (ctx.celular()) ctx.setSheet('peek');   // o mapa aparece
  const loc = U.$('#locate'), jaLigado = loc?.getAttribute('aria-pressed') === 'true';
  if (loc && !jaLigado) loc.click();
  else if (ultimo) { proxConta = 0; agendar(); }
  // sem GPS no navegador o app já avisa; a permissão negada chega depois (o aviso do app vem por cima)
  if (loc?.getAttribute('aria-pressed') === 'true') {
    ctx.anunciar(`Dia ${n}: ${jaLigado ? 'GPS já ligado' : 'ligando o GPS'}. O cartão da estrada aparece quando você estiver na rota.`);
  }
}

// ---------- posição ----------
function aoPosicao(ll, coords) {
  if (!ll) {   // GPS desligado: tudo volta ao começo
    ultimo = null; diaEscolhido = null; escolhidoEm = ''; fechado = false; avisarFora = false; andado = null;
    clearTimeout(timer); timer = 0; proxConta = 0;   // ao religar, a primeira posição já conta
    esconder();
    return;
  }
  ultimo = { ll, coords };
  agendar();
}
/** no máximo uma conta a cada INTERVALO; a última posição recebida é a que vale */
function agendar() {
  if (timer) return;
  const espera = proxConta - performance.now();   // relógio que só anda para a frente (o do aparelho pode ser acertado)
  if (espera <= 0) contarSeguro();
  else timer = setTimeout(() => { timer = 0; contarSeguro(); }, espera);
}
/** nos relógios (setTimeout/setInterval) um erro não passa pelo try do app: o cartão some e o aviso fica no console */
function contarSeguro() {
  try { contar(); } catch (e) { console.warn('módulo estrada:', e); esconder(); }
}
/** data do aparelho em 'AAAA-MM-DD' */
function isoHoje() {
  const t = new Date();
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
}
/** dia da viagem de hoje pela data do aparelho (o ctx.diaDeHoje é da abertura: o app pode ficar aberto de um dia para o outro) */
function diaDeHoje() {
  const iso = isoHoje();
  return ctx.dias.find((d) => d.data === iso)?.n ?? null;
}
function diaAtual() {
  // o "Começar o dia" vale para aquele dia: com o GPS ligado de um dia para o outro, passa a valer o dia de hoje
  if (diaEscolhido && escolhidoEm !== isoHoje() && diaDeHoje()) { diaEscolhido = null; andado = null; }
  const n = diaEscolhido ?? diaDeHoje() ?? ctx.diaAberto();
  return n ? ctx.diaPorN.get(n) : null;
}

/** km acumulado em cada vértice da linha, na escala do total do OSRM (a linha guardada é simplificada) */
function acumulado(f) {
  let cum = medidas.get(f.properties.id);
  if (cum) return cum;
  const c = f.geometry.coordinates;
  cum = [0];
  for (let i = 1; i < c.length; i++) {
    const k = Math.cos(((c[i][1] + c[i - 1][1]) / 2) * Math.PI / 180);
    cum.push(cum[i - 1] + Math.hypot((c[i][0] - c[i - 1][0]) * k, c[i][1] - c[i - 1][1]) * 111.32);
  }
  const escala = cum.at(-1) ? f.properties.km / cum.at(-1) : 1;
  cum = cum.map((v) => v * escala);
  medidas.set(f.properties.id, cum);
  return cum;
}
/** o ponto projetado em cada segmento: [{ dist: km até a linha, km: km ao longo da rota, rumo: graus do norte }] */
function projecoes(f, lon, lat) {
  const c = f.geometry.coordinates, cum = acumulado(f), k = Math.cos(lat * Math.PI / 180), out = [];
  for (let i = 0; i < c.length - 1; i++) {
    const ax = (c[i][0] - lon) * k, ay = c[i][1] - lat, bx = (c[i + 1][0] - lon) * k, by = c[i + 1][1] - lat;
    const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
    const t = L ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L)) : 0;
    out.push({ dist: Math.hypot(ax + t * dx, ay + t * dy) * 111.32, km: cum[i] + t * (cum[i + 1] - cum[i]),
      rumo: (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360 });
  }
  return out;
}
const difRumo = (a, b) => { const x = Math.abs(a - b) % 360; return x > 180 ? 360 - x : x; };
/**
 * Onde o ponto está ao longo da rota. Nos laços e nas idas e voltas (Desert View, Badwater) a mesma estrada aparece
 * duas vezes: entre os trechos mais perto, vale o que vai no sentido em que o GPS anda (rumo) e o que fica à frente
 * do último ponto (sem histórico, o primeiro).
 */
function kmNaRota(proj, antes, rumo) {
  let dmin = Infinity;
  for (const p of proj) if (p.dist < dmin) dmin = p.dist;
  let cand = proj.filter((p) => p.dist <= dmin + 0.3);
  if (rumo != null) { const r = cand.filter((p) => difRumo(p.rumo, rumo) < 60); if (r.length) cand = r; }
  if (antes == null) return cand.reduce((a, b) => (b.km < a.km ? b : a)).km;
  const frente = cand.filter((p) => p.km >= antes - 0.5);
  return (frente.length ? frente : cand).reduce((a, b) => (Math.abs(b.km - antes) < Math.abs(a.km - antes) ? b : a)).km;
}
/** paradas do dia que ficam na rota, com o km de cada uma (somando os trechos do OSRM) */
function paradasNaRota(d) {
  let acc = 0;
  const out = [];
  for (const it of ctx.listaParadas(d)) {
    if (it.km != null) acc += it.km;
    if (it.papel !== 'inicio' && !it.fora) out.push({ id: it.id, km: acc });
  }
  return out;
}
/** próximo opcional prático de água ou combustível à frente (a até 5 km da rota) */
function praticoAFrente(d, f, feito) {
  let melhor = null;
  for (const o of ctx.opsDoDia(d.n)) {
    if (o.tipo !== 'pratico' || o.estado === 'fechado' || o.lat == null) continue;
    const txt = `${o.nome} ${o.resumo ?? ''}`;
    const comb = RE_COMB.test(txt), agua = RE_AGUA.test(txt);
    if (!comb && !agua) continue;
    let p = null;
    for (const q of projecoes(f, o.lon, o.lat)) if (q.km > feito + 0.2 && q.dist <= 5 && (!p || q.dist < p.dist)) p = q;
    if (p && (!melhor || p.km < melhor.km)) melhor = { o, km: p.km, fora: p.dist, tipo: comb && agua ? 'Abastecer' : comb ? 'Combustível' : 'Água' };
  }
  return melhor;
}
/** hora local (decimal) agora, num fuso em horas (ex.: −7) */
function horaLocal(utc) {
  const h = (Date.now() / 36e5 + utc) % 24;
  return h < 0 ? h + 24 : h;
}

function contar() {
  proxConta = performance.now() + INTERVALO;
  const d = diaAtual();
  if (!ultimo || !d || fechado) return esconder();
  const f = ctx.rotaAtiva(d), P = f.properties;
  if (P.tipo === 'shuttle') return esconder();   // dia de shuttle: o veículo fica parado
  const [lon, lat] = ultimo.ll;
  const dist = ctx.posNaRota(f.geometry.coordinates, lon, lat).km;
  if (dist > (visivel ? RAIO_KM + 2 : RAIO_KM)) {   // 2 km de folga para não piscar na borda
    if (avisarFora) {
      avisarFora = false;
      ctx.aviso(`Você está a ${U.fmtKm(dist)} da rota do dia ${d.n}. O cartão da estrada aparece a menos de ${RAIO_KM} km dela.`);
    }
    return esconder(visivel ? 'Fora da rota do dia: o cartão da estrada saiu.' : '');
  }
  avisarFora = false;
  const antes = andado?.rota === P.id ? andado.km : null;
  const { heading, speed } = ultimo.coords ?? {};
  const rumo = Number.isFinite(heading) && speed > 2 ? heading : null;   // parado, o rumo do GPS não vale
  const feito = Math.min(P.km, Math.max(0, kmNaRota(projecoes(f, lon, lat), antes, rumo)));
  andado = { rota: P.id, km: feito };
  const falta = Math.max(0, P.km - feito);

  // paradas: a próxima à frente (o destino fica de fora: ele já está em "faltam")
  const paradas = paradasNaRota(d);
  const prox = paradas.find((p) => p.km > feito + 0.4 && p.km < P.km - 0.4);
  const fimId = P.pontos.at(-1), fim = ctx.dados.pontos[fimId];
  const ehPernoite = fimId === ctx.ativo(d).pernoite.ponto;

  // chegada (motorhome: média da rota ÷ 1,25, a mesma conta do app) e pôr do sol, no fuso do fim do trecho
  const [u0, u1] = d.utc ?? [-7, -7];
  const vel = P.horas > 0 ? P.km / P.horas / U.MOTORHOME : 60;
  const agora = horaLocal(u1), chegada = agora + falta / vel;
  const { poe } = U.sol(fim.lat, fim.lon, d.data, u1);
  const op = praticoAFrente(d, f, feito);
  mostrar({ d, P, dist, feito, falta, paradas, prox, fimId, ehPernoite, agora, chegada, poe, difFuso: u1 - u0, op, acc: ultimo.coords?.accuracy });
}

// ---------- cartão ----------
/** hora do relógio (23h59,6 vira 0h00, não "24h00") */
const hora = (h) => { const m = Math.round(h * 60); return U.fmtHora((((m % 1440) + 1440) % 1440) / 60); };
function desenhar(r) {
  const { d, P, dist, feito, falta, paradas, prox, fimId, ehPernoite, agora, chegada, poe, difFuso, op, acc } = r;
  const { esc, fmtKm, fmtH, fmtHora, nf } = U;
  const cor = U.corDia(d.n), pc = (km) => `${Math.max(0, Math.min(100, (km / P.km) * 100)).toFixed(1)}%`;
  const chegando = falta < 0.3;
  const tit = `<span class="day-dot" style="--c:${cor}" aria-hidden="true"></span>Dia ${d.n} · ${dist > 1 ? `a ${fmtKm(dist)} da rota` : 'na estrada'}`;
  if (tit !== htmlTit) U.$('#estrada-tit', cartao).innerHTML = htmlTit = tit;

  const marcas = paradas.filter((p) => p.km < P.km - 0.4).map((p) => `<i class="${p.km <= feito ? 'is-ok' : ''}" style="left:${pc(p.km)}"></i>`).join('');
  const linhas = [];
  if (prox) linhas.push(['Próxima', ctx.nomePonto(prox.id), fmtKm(prox.km - feito)]);
  linhas.push([ehPernoite ? 'Pernoite' : 'Destino', ctx.nomePonto(fimId), '']);
  linhas.push(['Pôr do sol', fmtHora(poe), agora < poe ? `em ${fmtH(poe - agora)}` : 'já se pôs']);
  // o desvio vai junto do nome (no celular pode ficar cortado, mas o title e o leitor de tela têm tudo)
  if (op) linhas.push([op.tipo, op.o.nome, fmtKm(op.km - feito), op.fora > 0.5 ? `${fmtKm(op.fora)} fora da rota` : '']);

  let alerta = '';
  if (!chegando && d.prazo && chegada > d.prazo) alerta = `Chegada depois das ${d.prazo}h, o prazo da devolução.`;
  else if (!chegando && chegada > poe) {
    alerta = agora >= poe ? `O sol já se pôs: ${fmtKm(falta)} no escuro até o fim do trecho.`
      : `Chegada ~${fmtH(chegada - poe)} depois do pôr do sol: o fim do trecho fica no escuro.`;
  }
  const gps = acc ? ` GPS ±${acc >= 1000 ? fmtKm(acc / 1000) : `${nf(Math.round(acc))} m`}.` : '';
  // dias que mudam de fuso (6 e 8): as horas são as do destino, também no celular
  const fuso = difFuso ? `; horas no fuso do destino (${Math.abs(difFuso)} h a ${difFuso > 0 ? 'mais' : 'menos'} que na saída)` : '';
  const corpo = `
    <div class="estrada-num">
      <div><b>${fmtKm(feito)}</b><span>feitos</span></div>
      <div><b>${fmtKm(falta)}</b><span>faltam</span></div>
      <div><b>${chegando ? 'agora' : `~${hora(chegada)}`}</b><span>chegada${!chegando && Math.round(chegada * 60) >= 1440 ? ' amanhã' : ''}</span></div>
    </div>
    <div class="estrada-bar" style="--c:${cor}" role="img" aria-label="${Math.round((feito / P.km) * 100)}% do trecho feito">
      <span style="width:${pc(feito)}"></span>${marcas}<b style="left:${pc(feito)}"></b></div>
    <div class="estrada-mais" id="estrada-mais">
      <ul class="estrada-l">${linhas.map(([k, v, x, extra]) => `<li><span class="k">${k}</span><span class="v" title="${esc(extra ? `${v} (${extra})` : v)}">${esc(v)}${extra ? `<small> · ${esc(extra)}</small>` : ''}</span>${x ? `<span class="d">${x}</span>` : ''}</li>`).join('')}</ul>
      ${alerta ? `<p class="cc-warn">${alerta}</p>` : ''}
      <p class="estrada-nota">Estimativa<span class="estrada-sopc"> só de estrada,</span> sem as paradas<span class="estrada-sopc">: média da rota × ${nf(1 / U.MOTORHOME, 1)} (motorhome)</span>${fuso}.<span class="estrada-sopc">${gps}</span></p>
    </div>`;
  if (corpo !== htmlCorpo) U.$('#estrada-corpo', cartao).innerHTML = htmlCorpo = corpo;
}
/**
 * Celular: quando a gaveta sobe, a bússola sobe junto; se ela encosta no cartão, o cartão estreita para não cobri-la.
 * Com a gaveta alta por cima do cartão, ele some (sem ficar uma tira cortada) e volta quando ela desce.
 */
function ajustar() {
  if (!visivel) return;
  cartao.classList.remove('is-estreito', 'is-coberto');
  if (!ctx.celular()) return margemMapa(0);
  const base = cartao.getBoundingClientRect().bottom, nav = U.$('#nav'), lado = U.$('#side');
  if (nav?.offsetHeight && base > nav.getBoundingClientRect().top - 6) cartao.classList.add('is-estreito');
  if (lado?.offsetHeight && base > lado.getBoundingClientRect().top + 4) {
    if (cartao.contains(document.activeElement)) U.$('#locate')?.focus({ preventScroll: true });
    cartao.classList.add('is-coberto');
    return;   // escondido só enquanto a gaveta está alta: a margem fica (o mapa não pula duas vezes)
  }
  margemMapa(Math.round(cartao.getBoundingClientRect().bottom) + 8);
}
/**
 * Celular: o cartão cobre o alto do mapa; a margem de cima põe o centro da vista (onde o app mostra a posição e
 * enquadra o dia) na parte à mostra, entre o cartão e a gaveta. O app só mexe na margem de baixo.
 */
function margemMapa(px) {
  if (px === margem || (px && margem && Math.abs(px - margem) < MARGEM_MIN)) return;
  margem = px;
  ctx.mapa()?.setPadding?.({ top: px });
}
function mostrar(r) {
  desenhar(r);
  const outraRota = r.P.id !== rotaMostrada;   // o dia virou ou o plano A/B mudou: o leitor de tela fica sabendo
  rotaMostrada = r.P.id;
  if (visivel) {
    if (outraRota) ctx.anunciar(`Na estrada, dia ${r.d.n}: faltam ${U.fmtKm(r.falta)} até ${ctx.nomePonto(r.fimId)}.`);
    return ajustar();
  }
  visivel = true;
  cartao.hidden = false;
  ajustar();
  ctx.anunciar(`Na estrada, dia ${r.d.n}: faltam ${U.fmtKm(r.falta)} até ${ctx.nomePonto(r.fimId)}.`);
  clearInterval(relogio);
  relogio = setInterval(() => { proxConta = 0; agendar(); }, 60000);   // a chegada e o pôr do sol andam com o relógio
}
function esconder(motivo = '') {
  if (!visivel) return;
  visivel = false;
  if (cartao.contains(document.activeElement)) U.$('#locate')?.focus({ preventScroll: true });
  cartao.hidden = true;
  margemMapa(0);
  clearInterval(relogio); relogio = 0;
  if (motivo) ctx.anunciar(motivo);
}
