// Módulo "preparar": checklist geral da viagem, reservas e "levar meus dados para outro celular".
// Dono do painel Preparar (#painel-preparar): desenha só nas próprias seções (ordem 1, 2 e 4; a 3 é de outro módulo).
// Marcações, situação das reservas e anotações ficam só no aparelho (localStorage); o repositório é público.

let ctx, U;
let lista = null, reservas = null, falhaLista = '', falhaRes = '';
// estado guardado no aparelho
let feitos = new Set(), meus = [], diario = {}, resSt = {}, resNota = {};
let filtro = 'todos', soFalta = false;
const abertas = new Set(), resAbertas = new Set();   // <details> abertos (só na memória)
let primeira = true;
let sujo = false;          // algo mudou: a ficha do dia aberta é refeita ao sair do painel
let ligadoDia = false;     // ouvinte da ficha do dia já posto
let catPorId = new Map(), itemPorId = new Map();

const PREFIXO = 'viagem-motorhome.';
const LAYOUT = new Set(['paneW', 'paneOpen', 'uiHidden', 'theme']);   // arrumação da tela e tema: são de cada aparelho, não viajam
const K = { feitos: 'check.feitos', meus: 'check.meus', diario: 'check.diario', soFalta: 'check.soFalta', filtro: 'check.quando', st: 'reservas.status', nota: 'reservas.notas' };
const PRIO_COR = { urgente: 'var(--g-alta)', alta: 'var(--g-media)', media: 'var(--hydro)', baixa: 'var(--ink-soft)', verificar: 'var(--contour)', opcional: 'var(--gold)' };
const ORDEM_PRIO = { urgente: 0, alta: 1, media: 2, baixa: 3, verificar: 4, opcional: 5 };
const ATALHO = { retirada: 'Checklist da retirada', mercado: 'Primeiro mercado', devolucao: 'Checklist da devolução', volta: 'Checklist da volta', diario: 'Rotina de hoje' };
const SVG = {
  seta: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9.5 6 6 6-6 6"/></svg>',
  x: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  copiar: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8"/></svg>',
  imprimir: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 9V3.5h10V9"/><rect x="3.5" y="9" width="17" height="8" rx="2"/><path d="M7 14h10v6.5H7z"/></svg>',
  baixar: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11m-4.5-4.5L12 15l4.5-4.5M5 19.5h14"/></svg>',
  abrir: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20V9m-4.5 4.5L12 9l4.5 4.5M5 4.5h14"/></svg>',
};

// ---------- datas (a de hoje é lida na hora: o app pode ficar aberto depois da meia-noite) ----------
const hoje = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const diaUTC = (s) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
const diasAte = (iso) => Math.round((diaUTC(iso) - diaUTC(hoje())) / 864e5);
const ddmm = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const diaDeHoje = () => ctx.dias.find((d) => d.data === hoje())?.n ?? null;

// ---------- estado no aparelho ----------
const ehObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
function lerJ(k, padrao, ok) { try { const v = JSON.parse(U.store.get(k) ?? 'null'); return ok(v) ? v : padrao; } catch { return padrao; } }
let descT = 0;
function gravar(k, v) {
  U.store.set(k, JSON.stringify(v));
  clearTimeout(descT); descT = setTimeout(atualizarDescDados, 300);   // "Neste aparelho: …" acompanha
}
function lerEstado() {
  feitos = new Set(lerJ(K.feitos, [], Array.isArray).filter((x) => typeof x === 'string'));
  meus = lerJ(K.meus, [], Array.isArray).filter((m) => ehObj(m) && typeof m.id === 'string' && typeof m.texto === 'string' && typeof m.cat === 'string');
  diario = lerJ(K.diario, {}, ehObj);
  resSt = lerJ(K.st, {}, ehObj);
  resNota = lerJ(K.nota, {}, ehObj);
  soFalta = U.store.get(K.soFalta) === '1';
  const f = U.store.get(K.filtro);
  filtro = f && lista?.quando?.[f] ? f : 'todos';
  if (lista) indexar();
}

// ---------- checklist: itens e contas ----------
function indexar() {
  catPorId = new Map(lista.categorias.map((c) => [c.id, c]));
  itemPorId = new Map(todosItens().map((i) => [i.id, i]));
}
/** itens da lista + os acrescentados no aparelho (cada um na sua categoria) */
function todosItens() {
  const proprios = meus.filter((m) => catPorId.has(m.cat)).map((m) => ({ ...m, quando: m.quando || quandoDe(m.cat), meu: true }));
  return [...lista.itens, ...proprios];
}
/** o "quando" mais comum de uma categoria (vale para os itens que a pessoa acrescenta) */
function quandoDe(cat) {
  const n = {};
  for (const i of lista.itens) if (i.cat === cat) n[i.quando] = (n[i.quando] ?? 0) + 1;
  return Object.entries(n).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'antes';
}
const diaria = (it) => !!catPorId.get(it.cat)?.diaria;
const feitosHoje = () => new Set(Array.isArray(diario[hoje()]) ? diario[hoje()] : []);
const estaFeito = (it, fh) => (diaria(it) ? fh.has(it.id) : feitos.has(it.id));
const doFiltro = (it) => filtro === 'todos' || it.quando === filtro;
const passa = (it, fh) => doFiltro(it) && !(soFalta && estaFeito(it, fh));
const contar = (itens, fh) => ({ n: itens.length, f: itens.filter((i) => estaFeito(i, fh)).length });
/** todas as contas da tela: geral (sem a rotina diária), por categoria (com o filtro) e o que falta por "quando" */
function numeros() {
  const fh = feitosHoje(), todos = todosItens();
  const geral = contar(todos.filter((i) => !diaria(i)), fh);
  const porCat = new Map(lista.categorias.map((c) => [c.id, contar(todos.filter((i) => i.cat === c.id && doFiltro(i)), fh)]));
  const falta = {};
  for (const q of Object.keys(lista.quando)) falta[q] = todos.filter((i) => i.quando === q && !estaFeito(i, fh)).length;
  const noFiltro = filtro === 'todos' ? null : contar(todos.filter(doFiltro), fh);
  return { fh, todos, geral, porCat, falta, noFiltro };
}

// ---------- seções do painel ----------
function secao(id, ordem) {
  let el = document.getElementById(id);
  if (!el) {
    el = document.createElement('section');
    el.id = id; el.style.order = ordem; el.className = `prep-sec${ordem > 1 ? ' prep-sec--sep' : ''}`;
    el.setAttribute('aria-labelledby', `${id}-h`);
    document.getElementById('painel-preparar')?.append(el);
  }
  return el;
}
function barra(f, n, rotulo, { fino = false, chave = '' } = {}) {
  const p = n ? Math.round((f / n) * 100) : 0;
  const aria = rotulo ? `role="progressbar" aria-valuemin="0" aria-valuemax="${n}" aria-valuenow="${f}" aria-valuetext="${f} de ${n}" aria-label="${U.esc(rotulo)}"` : 'aria-hidden="true"';
  return `<div class="prep-bar${fino ? ' prep-bar--fino' : ''}" ${aria}${chave ? ` data-prep-bar="${chave}"` : ''}><span style="width:${p}%"></span></div>`;
}
function renderTudo() { renderCheck(); renderReservas(); renderDados(); }

// ---------- checklist: desenho ----------
function htmlItem(it, fh) {
  const f = estaFeito(it, fh), id = U.esc(it.id);
  return `<li class="prep-it${f ? ' is-feito' : ''}" data-id="${id}">
    <label><input type="checkbox" data-prep-item="${id}"${f ? ' checked' : ''}${it.detalhe ? ` aria-describedby="prep-d-${id}"` : ''}><span>${U.esc(it.texto)}${it.meu ? ' <span class="tag">seu</span>' : ''}</span></label>
    ${it.meu ? `<button type="button" class="prep-del" data-prep-del="${id}" aria-label="Remover: ${U.esc(it.texto)}" title="Remover">${SVG.x}</button>` : ''}
    ${it.detalhe ? `<small id="prep-d-${id}">${U.esc(it.detalhe)}</small>` : ''}</li>`;
}
function textoResumo(N) {
  const falta = N.geral.n - N.geral.f;
  const base = falta ? `Faltam ${falta}.` : 'Tudo pronto!';
  const fil = N.noFiltro ? ` Em “${lista.quando[filtro]}”: ${N.noFiltro.f} de ${N.noFiltro.n}.` : '';
  return `${base}${fil} A rotina diária não entra na conta. As marcações ficam neste aparelho.`;
}
function renderCheck() {
  const el = secao('mod-preparar', 1);
  const cab = (dir = '') => `<div class="prep-h"><h3 id="mod-preparar-h">Checklist da viagem</h3>${dir}</div>`;
  if (!lista) { el.innerHTML = cab() + (falhaLista ? `<p class="cc-warn">${U.esc(falhaLista)}</p>` : '<p class="hint">Carregando a lista…</p>'); return; }
  // o que estava sendo digitado num campo de item novo não se perde
  const rascunho = {};
  el.querySelectorAll('form[data-prep-add] input').forEach((i) => { if (i.value) rascunho[i.form.dataset.prepAdd] = i.value; });
  const N = numeros();
  if (primeira) {   // na primeira vez, abre a primeira categoria que ainda tem o que fazer
    primeira = false;
    const c = lista.categorias.find((x) => !x.diaria && N.todos.some((i) => i.cat === x.id && !estaFeito(i, N.fh)));
    if (c) abertas.add(c.id);
  }
  const chips = [['todos', 'Tudo'], ...Object.entries(lista.quando)].map(([v, t]) => `<input type="radio" name="prep-q" id="prep-q-${v}" value="${v}"${filtro === v ? ' checked' : ''}><label for="prep-q-${v}">${U.esc(t)}${v === 'todos' ? '' : ` <i data-prep-q="${v}">${N.falta[v]}</i><span class="sr-only"> faltando</span>`}</label>`).join('');
  const cats = lista.categorias.map((c) => {
    const doTipo = N.todos.filter((i) => i.cat === c.id && doFiltro(i));
    if (filtro !== 'todos' && !doTipo.length) return '';   // com filtro, some a categoria sem item daquele tipo
    const vis = doTipo.filter((i) => passa(i, N.fh)), k = N.porCat.get(c.id), ok = k.n > 0 && k.f === k.n;
    const nota = c.nota ? `<p class="hint prep-cat-nota">${U.esc(c.nota)}${c.diaria ? ` Hoje: ${ddmm(hoje())}.` : ''}</p>` : '';
    return `<details class="prep-cat${ok ? ' is-ok' : ''}" id="prep-cat-${c.id}" data-cat="${c.id}"${abertas.has(c.id) ? ' open' : ''}>
      <summary><b>${U.esc(c.nome)}</b><span class="prep-n" data-prep-num="cat:${c.id}">${k.f} de ${k.n}${ok ? ' ✓' : ''}</span>${SVG.seta}${barra(k.f, k.n, '', { fino: true, chave: `cat:${c.id}` })}</summary>
      ${nota}
      ${vis.length ? `<ul class="prep-its">${vis.map((i) => htmlItem(i, N.fh)).join('')}</ul>` : `<p class="hint prep-vazio">${doTipo.length ? 'Tudo feito aqui.' : 'Nenhum item.'}</p>`}
      <form class="prep-add" data-prep-add="${c.id}">
        <label class="sr-only" for="prep-add-${c.id}">Acrescentar item em ${U.esc(c.nome)}</label>
        <input id="prep-add-${c.id}" type="text" maxlength="140" autocomplete="off" enterkeyhint="done" placeholder="Acrescentar item…" value="${U.esc(rascunho[c.id] ?? '')}">
        <button type="submit" class="btn btn--small">Acrescentar</button>
      </form></details>`;
  }).join('');
  const share = matchMedia('(pointer: coarse)').matches && navigator.share
    ? `<button type="button" class="btn btn--small" data-prep-act="compartilhar">${U.ICONE.compartilhar}Compartilhar</button>` : '';
  el.innerHTML = `${cab(`<p class="prep-num"><b data-prep-num="geral-f">${N.geral.f}</b> de <span data-prep-num="geral-n">${N.geral.n}</span></p>`)}
    ${barra(N.geral.f, N.geral.n, 'Itens feitos do checklist', { chave: 'geral' })}
    <p class="hint" data-prep-num="resumo">${U.esc(textoResumo(N))}</p>
    <div class="apt-modes prep-filtro" role="radiogroup" aria-label="Mostrar os itens de">${chips}</div>
    <label class="row prep-so" for="prep-so"><span>Mostrar só o que falta</span><input type="checkbox" id="prep-so"${soFalta ? ' checked' : ''}></label>
    <div class="prep-acts"><button type="button" class="btn btn--small" data-prep-act="copiar">${SVG.copiar}Copiar a lista</button>${share}
      <button type="button" class="btn btn--small" data-prep-act="imprimir">${SVG.imprimir}Imprimir</button></div>
    <div class="prep-st" id="prep-check-st" role="status" aria-live="polite"></div>
    <div class="prep-cats">${cats || '<p class="hint">Nenhum item neste filtro.</p>'}</div>
    <p class="cc-note">Feita em ${U.fmtDia(lista.conferido_em)} a partir da planilha e dos alertas. Copiar e Imprimir levam o que está na tela (com os filtros).</p>`;
}
/** depois de marcar um item: números, barras e etiquetas, sem redesenhar a lista (o foco fica onde está) */
function atualizarNumeros() {
  const el = document.getElementById('mod-preparar');
  if (!el || !lista) return;
  const N = numeros();
  const por = (sel, txt) => { const x = el.querySelector(sel); if (x) x.textContent = txt; };
  const bar = (chave, f, n) => {
    const b = el.querySelector(`[data-prep-bar="${chave}"]`);
    if (!b) return;
    b.firstElementChild.style.width = `${n ? Math.round((f / n) * 100) : 0}%`;
    if (b.getAttribute('role')) { b.setAttribute('aria-valuenow', f); b.setAttribute('aria-valuetext', `${f} de ${n}`); }
  };
  por('[data-prep-num="geral-f"]', N.geral.f); por('[data-prep-num="geral-n"]', N.geral.n);
  por('[data-prep-num="resumo"]', textoResumo(N));
  bar('geral', N.geral.f, N.geral.n);
  for (const [id, k] of N.porCat) {
    const ok = k.n > 0 && k.f === k.n;
    por(`[data-prep-num="cat:${id}"]`, `${k.f} de ${k.n}${ok ? ' ✓' : ''}`);
    bar(`cat:${id}`, k.f, k.n);
    document.getElementById(`prep-cat-${id}`)?.classList.toggle('is-ok', ok);
  }
  for (const [q, n] of Object.entries(N.falta)) por(`[data-prep-q="${q}"]`, n);
}
function marcar(id, on, li) {
  const it = itemPorId.get(id);
  if (!it) return;
  if (diaria(it)) {   // rotina diária: guardada por data; só os últimos 20 dias
    const s = feitosHoje();
    if (on) s.add(id); else s.delete(id);
    diario[hoje()] = [...s];
    const datas = Object.keys(diario).sort();
    while (datas.length > 20) delete diario[datas.shift()];
    gravar(K.diario, diario);
  } else {
    if (on) feitos.add(id); else feitos.delete(id);
    gravar(K.feitos, [...feitos]);
  }
  sujo = true;
  li?.classList.toggle('is-feito', on);
  atualizarNumeros();
  if (soFalta && on && li) {   // "só o que falta": o item feito sai da lista e o foco passa para o vizinho
    li.classList.add('is-saindo');
    setTimeout(() => {
      if (!li.isConnected || !li.classList.contains('is-feito')) { li.classList.remove('is-saindo'); return; }
      const tinhaFoco = li.contains(document.activeElement);
      const viz = li.nextElementSibling ?? li.previousElementSibling, ul = li.parentElement, det = li.closest('details');
      li.remove();
      if (!ul.children.length) ul.outerHTML = '<p class="hint prep-vazio">Tudo feito aqui.</p>';
      if (tinhaFoco) (viz?.querySelector('input') ?? det?.querySelector('summary'))?.focus({ preventScroll: true });
      ctx.anunciar(`Feito: ${it.texto}`);
    }, 450);
  }
}
function acrescentar(form) {
  const inp = form.querySelector('input'), texto = inp.value.trim().replace(/\s+/g, ' ');
  const cat = form.dataset.prepAdd;
  if (!texto || !catPorId.has(cat)) { inp.focus(); return; }
  meus.push({ id: `meu-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, cat, texto, quando: quandoDe(cat) });
  gravar(K.meus, meus);
  inp.value = '';
  indexar(); abertas.add(cat); renderCheck();
  document.getElementById(`prep-add-${cat}`)?.focus({ preventScroll: true });
  avisoCat(cat, `Acrescentado: ${texto}`);
  ctx.anunciar(`Acrescentado: ${texto}`);   // a região de status acabou de ser refeita: o anúncio do app garante a leitura
}
let desfazer = null;   // último item próprio removido (para "Desfazer")
function remover(id) {
  const i = meus.findIndex((m) => m.id === id);
  if (i < 0) return;
  const [m] = meus.splice(i, 1);
  desfazer = { m, i, feito: feitos.has(id) };
  feitos.delete(id);
  gravar(K.meus, meus); gravar(K.feitos, [...feitos]);
  indexar(); renderCheck();
  document.getElementById(`prep-add-${m.cat}`)?.focus({ preventScroll: true });
  avisoCat(m.cat, `Removido: ${m.texto}`, '<button type="button" class="lnk" data-prep-act="desfazer">Desfazer</button>');
  ctx.anunciar(`Removido: ${m.texto}. O botão Desfazer fica logo acima do campo de item novo.`);
}
function desfazerRemocao() {
  if (!desfazer) return;
  const { m, i, feito } = desfazer;
  desfazer = null;
  meus.splice(Math.min(i, meus.length), 0, m);
  if (feito) feitos.add(m.id);
  gravar(K.meus, meus); gravar(K.feitos, [...feitos]);
  indexar(); renderCheck();
  document.querySelector(`[data-prep-item="${CSS.escape(m.id)}"]`)?.focus({ preventScroll: true });
  avisoCat(m.cat, `De volta: ${m.texto}`);
  ctx.anunciar(`De volta: ${m.texto}`);
}
/** mensagem dentro da categoria, logo acima do campo de item novo (onde a pessoa está) */
function avisoCat(cat, txt, extra = '') {
  const form = document.querySelector(`#prep-cat-${cat} form`);
  if (!form) return;
  const p = document.createElement('p');
  p.className = 'prep-st prep-st--cat';
  p.innerHTML = `<span>${U.esc(txt)}</span>${extra}`;
  form.before(p);
}
/** mensagem curta numa região de status de uma seção (com um botão opcional) */
function status(id, txt, extra = '') {
  const el = document.getElementById(id);
  if (el) el.innerHTML = `<span>${U.esc(txt)}</span>${extra}`;
}

// ---------- checklist: copiar e imprimir (levam o que está na tela) ----------
function itensNaTela(N) {
  return lista.categorias.map((c) => ({ c, k: N.porCat.get(c.id), its: N.todos.filter((i) => i.cat === c.id && passa(i, N.fh)) })).filter((x) => x.its.length);
}
function textoLista() {
  const N = numeros(), filtros = [filtro !== 'todos' ? lista.quando[filtro] : '', soFalta ? 'só o que falta' : ''].filter(Boolean).join(', ');
  const l = [`*Checklist da viagem: Costa Oeste de motorhome*`, `${N.geral.f} de ${N.geral.n} feitos${filtros ? ` (${filtros})` : ''}`];
  for (const { c, k, its } of itensNaTela(N)) {
    l.push('', `*${c.nome}* (${k.f}/${k.n})${c.diaria ? ` · hoje, ${ddmm(hoje())}` : ''}`);
    for (const i of its) l.push(`${estaFeito(i, N.fh) ? '☑' : '☐'} ${i.texto}`);
  }
  return l.join('\n');
}
async function copiarTexto(txt, idStatus, ok) {
  try { await navigator.clipboard.writeText(txt); status(idStatus, ok); return true; } catch {
    // sem área de transferência (http, permissão): mostra o texto já selecionado para copiar à mão
    const el = document.getElementById(idStatus);
    if (el) {
      el.innerHTML = '<span>Copie o texto abaixo:</span><textarea class="prep-campo" rows="5" readonly aria-label="Texto para copiar"></textarea>';
      const ta = el.querySelector('textarea'); ta.value = txt; ta.focus(); ta.select();
    }
    return false;
  }
}
async function compartilharLista() {
  try { await navigator.share({ title: 'Checklist da viagem', text: textoLista() }); } catch (e) { if (e.name !== 'AbortError') copiarTexto(textoLista(), 'prep-check-st', 'Lista copiada: cole no WhatsApp.'); }
}
function montarImpressao() {
  if (!lista) return;
  let box = document.getElementById('prep-print');
  if (!box) { box = document.createElement('div'); box.id = 'prep-print'; box.setAttribute('aria-hidden', 'true'); document.body.append(box); }
  const N = numeros(), filtros = [filtro !== 'todos' ? lista.quando[filtro] : '', soFalta ? 'só o que falta' : ''].filter(Boolean).join(', ');
  const d = new Date();
  box.innerHTML = `<h1>Checklist da viagem</h1>
    <p class="sub">Costa Oeste de motorhome · 19/10 a 01/11/2026 · ${N.geral.f} de ${N.geral.n} feitos${filtros ? ` · ${U.esc(filtros)}` : ''} · impresso em ${d.toLocaleDateString('pt-BR')}</p>
    <div class="cols">${itensNaTela(N).map(({ c, k, its }) => `<h2>${U.esc(c.nome)} <small>${k.f}/${k.n}</small></h2><ul>${its.map((i) => {
      const f = estaFeito(i, N.fh);
      return `<li class="${f ? 'ok' : ''}">${f ? '☑' : '☐'} ${U.esc(i.texto)}${i.detalhe ? `<small>${U.esc(i.detalhe)}</small>` : ''}</li>`;
    }).join('')}</ul>`).join('')}</div>`;
  document.documentElement.classList.add('prep-imprimindo');
}
function imprimir() { montarImpressao(); window.print(); }

// ---------- reservas ----------
const stDe = (id) => (resSt[id] === 'feito' || resSt[id] === 'nao' ? resSt[id] : 'pendente');
/** reserva do plano B de um dia que está no plano A (ou o contrário): não conta nos totais */
const foraDeUso = (r) => !!r.plano && (r.plano === 'B') !== ctx.usaB(r.dia);
/** reserva de um opcional (ex.: Antelope Canyon): só pesa depois de feita ou, se tiver o id do opcional, quando ele tem a estrela "quero fazer" */
const opcionalEmJogo = (r) => stDe(r.id) === 'feito' || (typeof r.opcional === 'string' && ctx.quero().has(r.opcional));
const opcionalParado = (r) => !!r.opcional && !opcionalEmJogo(r);
/** entra na conta das reservas (e no aviso de prazo) */
const conta = (r) => !foraDeUso(r) && !opcionalParado(r);
function prazoDe(r) {
  if (!r.prazo) return r.prazo_txt ? { d: Infinity, txt: r.prazo_txt, nivel: 'ok' } : null;   // sem data: só o texto
  const d = diasAte(r.prazo), quando = r.prazo_txt ? `${r.prazo_txt}, até ${ddmm(r.prazo)}` : `até ${ddmm(r.prazo)}`;
  const txt = d < 0 ? `prazo passou (era até ${ddmm(r.prazo)})` : d === 0 ? 'prazo: hoje' : d === 1 ? 'prazo: amanhã' : `${quando}${d <= 7 ? ` · ${d} dias` : ''}`;
  return { d, txt, nivel: d < 0 ? 'atraso' : d <= 7 ? 'perto' : 'ok' };
}
const ordemRes = () => [...reservas.itens].sort((a, b) => ORDEM_PRIO[a.prioridade] - ORDEM_PRIO[b.prioridade] || (a.prazo ?? '9').localeCompare(b.prazo ?? '9'));
function htmlReserva(r) {
  const st = stDe(r.id), P = prazoDe(r), id = U.esc(r.id);
  const nota = typeof resNota[r.id] === 'string' ? resNota[r.id] : '';
  const dias = r.dia ? (r.noites > 1 ? `Dias ${r.dia}–${r.dia + r.noites - 1}` : `Dia ${r.dia}`) : '';
  const onde = r.onde?.url ? `<a href="${U.esc(r.onde.url)}" target="_blank" rel="noopener">${U.esc(r.onde.texto)}</a>` : U.esc(r.onde?.texto ?? '');
  const tagSt = st === 'feito' ? '<span class="tag" style="--c:var(--g-ok)">Feito ✓</span>' : st === 'nao' ? '<span class="tag">Não precisa</span>'
    : P ? `<span class="tag prep-prazo" data-nivel="${conta(r) ? P.nivel : 'ok'}">${U.esc(P.txt)}</span>` : '';
  const opc = (v, t) => `<input type="radio" name="prep-rs-${id}" id="prep-rs-${id}-${v}" value="${v}" data-prep-res="${id}"${st === v ? ' checked' : ''}><label for="prep-rs-${id}-${v}">${t}</label>`;
  const plano = r.plano === 'B' ? `<span class="tag tag--alt">Só no plano B${foraDeUso(r) ? ' (dia na rota principal)' : ''}</span>`
    : r.plano === 'A' ? `<span class="tag">Só na rota principal${foraDeUso(r) ? ' (dia no plano B)' : ''}</span>` : '';
  return `<li class="prep-r" id="prep-r-${id}" data-st="${st}"${conta(r) ? '' : ' data-fora'} style="--c:${PRIO_COR[r.prioridade] ?? 'var(--ink-soft)'}">
    <div class="prep-r-top"><span class="tag">${U.esc(reservas.prioridades?.[r.prioridade] ?? r.prioridade)}</span>${plano}${tagSt}</div>
    <b class="prep-r-t">${U.esc(r.item)}</b>
    <p class="prep-r-meta">${dias ? `<button type="button" class="lnk" data-prep-dia="${r.dia}">${dias}</button>` : ''}${r.custo_est ? `<span>~US$ ${U.nf(r.custo_est)}</span>` : ''}<span>${onde}</span></p>
    <p class="prep-r-anot" data-prep-anot="${id}"${nota ? '' : ' hidden'}><span class="sr-only">Sua anotação: </span>${U.esc(nota)}</p>
    <div class="seg2 seg2--3" role="radiogroup" aria-label="Situação: ${U.esc(r.item)}">${opc('pendente', 'Pendente')}${opc('feito', 'Feito')}${opc('nao', 'Não precisa')}</div>
    <details class="prep-r-mais" data-res="${id}"${resAbertas.has(r.id) ? ' open' : ''}><summary>Notas e anotação<span class="sr-only">: ${U.esc(r.item)}</span></summary>
      <div class="prep-r-corpo"><p>${U.esc(r.notas ?? '')}</p>
        <label class="prep-r-lab" for="prep-rn-${id}">Sua anotação <small>(fica só neste aparelho)</small></label>
        <textarea class="prep-campo" id="prep-rn-${id}" data-prep-nota="${id}" rows="2" maxlength="500" placeholder="Nº da reserva, horário, valor…">${U.esc(nota)}</textarea></div>
    </details></li>`;
}
function resumoReservas() {
  const ativas = reservas.itens.filter(conta);
  const pend = ativas.filter((r) => stDe(r.id) === 'pendente');
  const urg = pend.filter((r) => { const p = prazoDe(r); return p && p.d <= 7; });
  const custo = pend.reduce((s, r) => s + (r.custo_est || 0), 0);
  return { n: ativas.length, f: ativas.length - pend.length, urg, custo };
}
function htmlTopoReservas() {
  const R = resumoReservas();
  const nomes = R.urg.slice(0, 4).map((r) => U.esc(r.item.replace(/[:(,].*$/, '').trim())).join(' · ') + (R.urg.length > 4 ? ` e mais ${R.urg.length - 4}` : '');
  const urg = R.urg.length ? `<p class="cc-warn cc-warn--ov"><b>${R.urg.length === 1 ? '1 pendente com prazo passado ou nesta semana' : `${R.urg.length} pendentes com prazo passado ou nesta semana`}:</b> ${nomes}. Marque o que já foi feito.</p>` : '';
  return `<div class="prep-h"><h3 id="mod-preparar-reservas-h">Reservas</h3><p class="prep-num"><b>${R.f}</b> de ${R.n} resolvidas</p></div>
    ${barra(R.f, R.n, 'Reservas resolvidas')}
    ${urg}
    <p class="hint">Hoje é ${ddmm(hoje())}.${R.custo ? ` Ainda pendente: ~US$ ${U.nf(R.custo)} (estimativas públicas, não valores pagos).` : ''} A situação e as anotações ficam <b>só neste aparelho</b>: o app é público e não guarda números de reserva. Para passar ao outro celular, use “Levar meus dados”, abaixo.</p>`;
}
function renderReservas() {
  const el = secao('mod-preparar-reservas', 2);
  if (!reservas) {
    el.innerHTML = `<div class="prep-h"><h3 id="mod-preparar-reservas-h">Reservas</h3></div>${falhaRes ? `<p class="cc-warn">${U.esc(falhaRes)}</p>` : '<p class="hint">Carregando…</p>'}`;
    return;
  }
  el.innerHTML = `<div class="prep-res-topo">${htmlTopoReservas()}</div>
    <ul class="prep-res">${ordemRes().map(htmlReserva).join('')}</ul>
    <p class="cc-note">Lista da aba Reservas da planilha, atualizada em ${U.fmtDia(reservas.conferido_em)}. Plano B só entra na conta quando o dia estiver no plano B; opcional, só depois de marcado como feito.</p>`;
}
function mudarSituacao(id, v) {
  if (v === 'pendente') delete resSt[id]; else resSt[id] = v;
  gravar(K.st, resSt);
  sujo = true;
  const r = reservas.itens.find((x) => x.id === id), li = document.getElementById(`prep-r-${id}`);
  if (!r || !li) return;
  li.outerHTML = htmlReserva(r);
  document.querySelector('#mod-preparar-reservas .prep-res-topo').innerHTML = htmlTopoReservas();
  document.getElementById(`prep-rs-${id}-${v}`)?.focus({ preventScroll: true });
}
let notaT = 0;
function guardarNota(ta) {
  const id = ta.dataset.prepNota, v = ta.value.trim() ? ta.value : '';
  if (v) resNota[id] = v; else delete resNota[id];
  gravar(K.nota, resNota);
  const p = document.querySelector(`[data-prep-anot="${CSS.escape(id)}"]`);
  if (p) { p.hidden = !v; p.innerHTML = `<span class="sr-only">Sua anotação: </span>${U.esc(v)}`; }
}

// ---------- levar meus dados para outro celular ----------
// nome de cada dado no aviso (singular, plural)
const NOMES = [
  [/^check\.feitos$/, 'item do checklist marcado', 'itens do checklist marcados'],
  [/^check\.meus$/, 'item próprio no checklist', 'itens próprios no checklist'],
  [/^check\.diario$/, 'marcação da rotina diária', 'marcações da rotina diária'],
  [/^reservas\.status$/, 'reserva com situação marcada', 'reservas com situação marcada'],
  [/^reservas\.notas$/, 'anotação de reserva', 'anotações de reserva'],
  [/^quero$/, 'opcional marcado (quero fazer)', 'opcionais marcados (quero fazer)'],
  [/^rota\.\d+$/, 'escolha de rota (plano A ou B)', 'escolhas de rota (plano A ou B)'],
  [/^gastos\.lista$/, 'gasto anotado', 'gastos anotados'],
  [/^gastos\./, 'ajuste dos gastos', 'ajustes dos gastos'],
  [/^diario\./, 'anotação do diário', 'anotações do diário'],
  [/^(fundo|sombra|3d|planob|opc|check\.soFalta|check\.quando|estrada\.min)$/, 'preferência', 'preferências'],
];
function nomeDe(k) {
  for (const [re, s, p] of NOMES) if (re.test(k)) return [s, p];
  const m = k.match(/^([a-zA-Z]+)[.]/), q = m ? m[1] : k;
  return [`item de “${q}”`, `itens de “${q}”`];
}
const comNome = ([s, p], q) => `${q} ${q === 1 ? s : p}`;
/** guardado que é só cópia do que veio da rede (previsão do tempo etc.): não viaja */
const ehCache = (k) => k === 'clima.prev' || /(^|\.)cache(\.|$)/.test(k);
function parse(s) { try { return { ok: true, v: JSON.parse(s) }; } catch { return { ok: false, v: s }; } }
/** quantos "itens" um valor tem (lista: elementos; objeto: soma dos valores; o resto: 1) */
function tamanho(v) {
  if (Array.isArray(v)) return v.length;
  if (ehObj(v)) return Object.values(v).reduce((s, x) => s + tamanho(x), 0);
  return 1;
}
const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function chavesDoAparelho() {
  const out = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k?.startsWith(PREFIXO)) continue;
      const c = k.slice(PREFIXO.length);
      if (!LAYOUT.has(c) && !ehCache(c)) out[c] = localStorage.getItem(k);
    }
  } catch { /* sem armazenamento */ }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}
function pacote() { return { app: 'viagem-motorhome', tipo: 'dados do aparelho', versao: 1, exportado_em: new Date().toISOString(), chaves: chavesDoAparelho() }; }
/** "12 itens do checklist marcados · 3 reservas…" */
function descrever(chaves) {
  const g = new Map();   // plural → { nome, q }
  for (const [k, v] of Object.entries(chaves)) {
    const nome = nomeDe(k), p = parse(v), x = g.get(nome[1]) ?? { nome, q: 0 };
    x.q += p.ok ? tamanho(p.v) : 1;
    g.set(nome[1], x);
  }
  return [...g.values()].filter((x) => x.q > 0).map((x) => comNome(x.nome, x.q));   // lista vazia guardada não conta
}
function textoDesc() {
  const desc = descrever(chavesDoAparelho());
  return desc.length ? `Neste aparelho: ${desc.join(' · ')}.` : 'Ainda não há nada guardado neste aparelho.';
}
/** só a frase "Neste aparelho: …" (sem refazer a seção: o texto colado e o foco ficam) */
function atualizarDescDados() {
  const p = document.querySelector('#mod-preparar-dados [data-prep-desc]');
  if (p) p.textContent = textoDesc();
}
function renderDados() {
  const el = secao('mod-preparar-dados', 4);
  // o texto colado e a escolha "ficar com o que veio" sobrevivem ao redesenho (o painel é refeito a cada abertura)
  const colado = document.getElementById('prep-colar')?.value ?? '', pref = !!document.getElementById('prep-pref')?.checked;
  const share = navigator.share ? `<button type="button" class="btn btn--small" data-prep-act="dados-compartilhar">${U.ICONE.compartilhar}Compartilhar</button>` : '';
  el.innerHTML = `<div class="prep-h"><h3 id="mod-preparar-dados-h">Levar meus dados para outro celular</h3></div>
    <p class="prep-txt">Marcações, reservas, anotações, gastos e escolhas ficam só neste aparelho. Para os dois celulares ficarem iguais, mande os dados deste e junte no outro (e depois o contrário). Nada é apagado: o que vier se soma ao que já existe.</p>
    <p class="hint" data-prep-desc>${U.esc(textoDesc())}</p>
    <h4 class="prep-h4">Mandar deste aparelho</h4>
    <div class="prep-acts"><button type="button" class="btn btn--small" data-prep-act="dados-baixar">${SVG.baixar}Baixar arquivo</button>${share}
      <button type="button" class="btn btn--small" data-prep-act="dados-copiar">${SVG.copiar}Copiar o texto</button></div>
    <p class="hint">Leva as anotações das reservas (inclusive os números): mande só para quem viaja com você.</p>
    <h4 class="prep-h4">Juntar o que veio do outro</h4>
    <div class="prep-acts"><input type="file" class="sr-only prep-file" id="prep-arq" accept=".json,.txt,application/json,text/plain"><label for="prep-arq" class="btn btn--small">${SVG.abrir}Abrir arquivo</label></div>
    <label class="prep-r-lab" for="prep-colar">ou cole o texto recebido</label>
    <textarea class="prep-campo" id="prep-colar" rows="3" spellcheck="false" autocomplete="off" placeholder="Cole aqui o texto que veio do outro celular"></textarea>
    <label class="row prep-so" for="prep-pref"><span>Se os dois tiverem algo diferente, ficar com o que veio</span><input type="checkbox" id="prep-pref"></label>
    <div class="prep-acts"><button type="button" class="btn btn--small btn--main" data-prep-act="dados-juntar">Juntar</button></div>
    <div class="prep-st" id="prep-dados-st" role="status" aria-live="polite"></div>`;
  el.querySelector('#prep-colar').value = colado;
  el.querySelector('#prep-pref').checked = pref;
}
const textoPacote = () => JSON.stringify(pacote());
function baixarDados() {
  const blob = new Blob([JSON.stringify(pacote(), null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = `viagem-motorhome-dados-${hoje()}.json`;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  status('prep-dados-st', 'Arquivo baixado. No outro celular: Preparar › Abrir arquivo.');
}
const msgPacote = () => `Dados do app da viagem (${ddmm(hoje())}). No outro celular: Preparar › Levar meus dados › cole este texto e toque em Juntar.\n${textoPacote()}`;
async function compartilharDados() {
  try { await navigator.share({ title: 'Dados do app da viagem', text: msgPacote() }); status('prep-dados-st', 'Enviado. No outro celular, cole o texto e toque em Juntar.'); } catch (e) { if (e.name !== 'AbortError') copiarTexto(msgPacote(), 'prep-dados-st', 'Texto copiado: mande para o outro celular.'); }
}
/** acha o pacote num texto (pode vir com a mensagem do WhatsApp em volta) */
function lerPacote(txt) {
  let s = String(txt ?? '').trim();
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0 || b <= a) throw new Error('Não achei os dados nesse texto.');
  s = s.slice(a, b + 1);
  let o;
  try { o = JSON.parse(s); } catch {
    try { o = JSON.parse(s.replace(/[“”]/g, '"')); } catch { throw new Error('O texto está incompleto ou foi alterado. Copie de novo, inteiro.'); }   // aspas "curvas" de alguns teclados
  }
  if (!ehObj(o) || o.app !== 'viagem-motorhome' || !ehObj(o.chaves)) throw new Error('Esse texto não é do app da viagem.');
  return o;
}
/** junta dois valores: listas viram a união, objetos se somam por chave; num conflito, fica o daqui (ou o que veio) */
function juntarValor(a, b, preferir, conta) {
  if (a === undefined) { conta.novos += tamanho(b); return b; }
  if (igual(a, b)) return a;
  if (Array.isArray(a) && Array.isArray(b)) {
    const chave = (x) => (ehObj(x) && x.id != null ? `id:${x.id}` : JSON.stringify(x));
    const out = [...a], pos = new Map(a.map((x, i) => [chave(x), i]));
    for (const x of b) {
      const c = chave(x);
      if (!pos.has(c)) { pos.set(c, out.length); out.push(x); conta.novos++; }
      else if (!igual(out[pos.get(c)], x)) { if (preferir) { out[pos.get(c)] = x; conta.trocados++; } else conta.mantidos++; }
    }
    return out;
  }
  if (ehObj(a) && ehObj(b)) {
    const out = { ...a };
    for (const [k, v] of Object.entries(b)) out[k] = juntarValor(a[k], v, preferir, conta);
    return out;
  }
  if (preferir) { conta.trocados++; return b; }
  conta.mantidos++;
  return a;
}
function importar(o, preferir) {
  const rel = new Map();   // nome → { novos, trocados, mantidos }
  const mudou = new Set();   // chaves gravadas
  let falhas = 0;
  for (const [k, v] of Object.entries(o.chaves)) {
    if (typeof v !== 'string' || LAYOUT.has(k) || ehCache(k) || !/^[\w.:-]{1,80}$/.test(k)) continue;
    const atual = U.store.get(k);
    if (atual === v) continue;
    const conta = { novos: 0, trocados: 0, mantidos: 0 };
    let final;
    if (atual === null) { final = v; const p = parse(v); conta.novos = p.ok ? tamanho(p.v) : 1; }
    else {
      const A = parse(atual), B = parse(v);
      if (A.ok && B.ok && A.v && B.v && typeof A.v === 'object' && typeof B.v === 'object') final = JSON.stringify(juntarValor(A.v, B.v, preferir, conta));
      else if (preferir) { final = v; conta.trocados = 1; } else conta.mantidos = 1;
    }
    if (final !== undefined && final !== atual) { U.store.set(k, final); if (U.store.get(k) !== final) falhas++; else mudou.add(k); }
    const nome = nomeDe(k), t = rel.get(nome[1]) ?? { nome, novos: 0, trocados: 0, mantidos: 0 };
    t.novos += conta.novos; t.trocados += conta.trocados; t.mantidos += conta.mantidos;
    rel.set(nome[1], t);
  }
  return { rel, falhas, mudou };
}
function juntar(txt, origem) {
  let o;
  try { o = lerPacote(txt); } catch (e) { status('prep-dados-st', e.message); return; }
  const preferir = document.getElementById('prep-pref')?.checked;
  const { rel, falhas, mudou } = importar(o, preferir);
  const entrou = [...rel.values()].filter((t) => t.novos || t.trocados).map((t) => comNome(t.nome, t.novos + t.trocados));
  const mantidos = [...rel.values()].reduce((s, t) => s + t.mantidos, 0);
  const quando = o.exportado_em ? ` (de ${new Date(o.exportado_em).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })})` : '';
  // o checklist e as reservas mudam na hora; o resto do app lê o aparelho ao abrir
  const campo = document.getElementById('prep-colar');
  if (campo && origem === 'colar' && !mantidos) campo.value = '';   // já foi juntado: o campo volta vazio (com diferenças, fica para juntar de novo trocando)
  lerEstado(); renderCheck(); renderReservas(); renderDados();
  ctx.atualizarViagem(); ctx.atualizarDia(); sujo = false;
  const partes = [entrou.length ? `Juntado${quando}. Entrou: ${entrou.join(' · ')}.` : mantidos ? `Nada mudou${quando}.` : `Nada novo${quando}: este aparelho já tinha tudo isso.`];
  if (mantidos) partes.push(`${mantidos} ${mantidos === 1 ? 'diferença ficou' : 'diferenças ficaram'} como estava${mantidos === 1 ? '' : 'm'} aqui. Para trocar, marque “ficar com o que veio” e junte de novo.`);
  if (falhas) partes.push('Parte não coube no armazenamento do aparelho.');
  // o app guarda as estrelas na memória ao abrir: sem recarregar, marcar uma estrela regravaria a lista antiga por cima da que veio
  const rec = mudou.has('quero') ? 'Recarregue antes de mexer nas estrelas dos opcionais: só assim as que vieram aparecem (e não se perdem).'
    : 'Para as rotas e os outros painéis mostrarem tudo, recarregue.';
  const fora = [...mudou].some((k) => !/^(check|reservas)\./.test(k));   // o checklist e as reservas já mudaram na tela
  status('prep-dados-st', partes.join(' '), fora ? `<span>${rec}</span><button type="button" class="btn btn--small" data-prep-act="recarregar">Recarregar agora</button>` : '');
  // a seção foi redesenhada (a região de status é nova): o foco volta ao botão usado e o aviso vai pelo anúncio do app
  document.querySelector(origem === 'arquivo' ? '#prep-arq' : '[data-prep-act="dados-juntar"]')?.focus({ preventScroll: true });
  document.getElementById('prep-dados-st')?.scrollIntoView({ block: 'nearest' });   // o checklist acima pode ter mudado de altura
  ctx.anunciar(partes[0]);
}

// ---------- ficha do dia: reservas do dia e atalhos do checklist ----------
function htmlDia(d) {
  if (!lista && !reservas) return '';
  const n = d.n, linhas = [], cks = [];
  for (const r of reservas ? ordemRes() : []) {
    if (!r.dia || n < r.dia || n > r.dia + (r.noites || 1) - 1 || foraDeUso(r)) continue;
    const st = stDe(r.id), P = prazoDe(r);
    const tag = st === 'feito' ? '<span class="tag" style="--c:var(--g-ok)">Feito ✓</span>' : st === 'nao' ? '<span class="tag">Não precisa</span>'
      : opcionalParado(r) ? '<span class="tag" style="--c:var(--gold)">Opcional</span>'
      : P && P.d <= 7 ? `<span class="tag" style="--c:var(--g-alta)">Pendente · ${P.d < 0 ? 'prazo passou' : P.d === 0 ? 'prazo hoje' : P.d === 1 ? 'prazo amanhã' : `prazo em ${P.d} dias`}</span>`   // a pressa vai no texto, não só na cor
      : '<span class="tag" style="--c:var(--g-media)">Pendente</span>';
    linhas.push(`<li>${tag}<button type="button" class="lnk" data-preparar-ir="r:${U.esc(r.id)}">${U.esc(r.item)}</button></li>`);
  }
  if (lista) {
    const fh = feitosHoje();
    const atalho = (id) => {
      if (!catPorId.has(id)) return;
      const k = contar(todosItens().filter((i) => i.cat === id), fh);
      cks.push(`<button type="button" class="btn btn--small" data-preparar-ir="c:${id}">${ATALHO[id]} · ${k.f}/${k.n}</button>`);
    };
    if (n === 1) { atalho('retirada'); atalho('mercado'); }
    if (n === ctx.dias.length) { atalho('devolucao'); atalho('volta'); }
    if (n === diaDeHoje()) atalho('diario');
  }
  if (!linhas.length && !cks.length) return '';
  return `<section class="blk prep-dia"><h3>Preparar <span>${linhas.length ? 'reservas' : ''}${linhas.length && cks.length ? ' e ' : ''}${cks.length ? 'checklist' : ''}</span></h3>
    ${linhas.length ? `<ul class="prep-dia-res">${linhas.join('')}</ul>` : ''}
    ${cks.length ? `<div class="prep-dia-cks">${cks.join('')}</div>` : ''}</section>`;
}
/** abre o painel Preparar numa categoria ("c:id") ou numa reserva ("r:id") */
function irPara(alvo) {
  const tipo = alvo.slice(0, 1), id = alvo.slice(2);
  ctx.showPane('preparar', { sheet: 'full' });   // redesenha as seções (aoMostrarPainel)
  let el, foco;
  if (tipo === 'c') {
    if (filtro !== 'todos' && !todosItens().some((i) => i.cat === id && i.quando === filtro)) { filtro = 'todos'; U.store.set(K.filtro, filtro); }
    abertas.add(id); renderCheck();
    el = document.getElementById(`prep-cat-${id}`); foco = el?.querySelector('summary');
  } else {
    el = document.getElementById(`prep-r-${id}`); foco = el?.querySelector('input:checked');
  }
  if (!el) return;
  const ir = () => {
    el.scrollIntoView({ block: 'start', behavior: U.reduzMovimento() ? 'auto' : 'smooth' });
    foco?.focus({ preventScroll: true });
    el.classList.remove('prep-flash'); void el.offsetWidth; el.classList.add('prep-flash');
  };
  if (ctx.celular()) setTimeout(ir, 320); else requestAnimationFrame(ir);   // no celular, espera a gaveta abrir
}

// ---------- eventos (delegados, postos uma vez em cada seção) ----------
function ligar() {
  const ch = document.getElementById('mod-preparar'), rs = document.getElementById('mod-preparar-reservas'), da = document.getElementById('mod-preparar-dados');
  ch.addEventListener('change', (e) => {
    const t = e.target;
    if (t.matches('[data-prep-item]')) return marcar(t.dataset.prepItem, t.checked, t.closest('li'));
    if (t.name === 'prep-q') { filtro = t.value; U.store.set(K.filtro, filtro); renderCheck(); document.getElementById(`prep-q-${filtro}`)?.focus({ preventScroll: true }); return; }
    if (t.id === 'prep-so') { soFalta = t.checked; U.store.set(K.soFalta, soFalta ? '1' : '0'); renderCheck(); document.getElementById('prep-so')?.focus({ preventScroll: true }); }
  });
  ch.addEventListener('submit', (e) => { const f = e.target.closest('form[data-prep-add]'); if (f) { e.preventDefault(); acrescentar(f); } });
  ch.addEventListener('toggle', (e) => { const d = e.target; if (d.matches?.('details[data-cat]')) { if (d.open) abertas.add(d.dataset.cat); else abertas.delete(d.dataset.cat); } }, true);
  ch.addEventListener('click', (e) => {
    const del = e.target.closest('[data-prep-del]');
    if (del) return remover(del.dataset.prepDel);
    const act = e.target.closest('[data-prep-act]')?.dataset.prepAct;
    if (act === 'copiar') copiarTexto(textoLista(), 'prep-check-st', 'Lista copiada: cole no WhatsApp.');
    else if (act === 'compartilhar') compartilharLista();
    else if (act === 'imprimir') imprimir();
    else if (act === 'desfazer') desfazerRemocao();
  });
  rs.addEventListener('change', (e) => {
    const t = e.target;
    if (t.matches('[data-prep-res]')) return mudarSituacao(t.dataset.prepRes, t.value);
    if (t.matches('[data-prep-nota]')) { clearTimeout(notaT); guardarNota(t); }
  });
  rs.addEventListener('input', (e) => {
    const t = e.target;
    if (t.matches('[data-prep-nota]')) { clearTimeout(notaT); notaT = setTimeout(() => guardarNota(t), 400); }
  });
  rs.addEventListener('toggle', (e) => { const d = e.target; if (d.matches?.('details[data-res]')) { if (d.open) resAbertas.add(d.dataset.res); else resAbertas.delete(d.dataset.res); } }, true);
  rs.addEventListener('click', (e) => { const b = e.target.closest('[data-prep-dia]'); if (b) ctx.abrirDia(+b.dataset.prepDia); });
  da.addEventListener('click', (e) => {
    const act = e.target.closest('[data-prep-act]')?.dataset.prepAct;
    if (act === 'dados-baixar') baixarDados();
    else if (act === 'dados-compartilhar') compartilharDados();
    else if (act === 'dados-copiar') copiarTexto(msgPacote(), 'prep-dados-st', 'Texto copiado: mande para o outro celular (WhatsApp, e-mail…).');
    else if (act === 'dados-juntar') {
      const v = document.getElementById('prep-colar').value;
      if (!v.trim()) { status('prep-dados-st', 'Cole o texto que veio do outro celular (ou use Abrir arquivo).'); document.getElementById('prep-colar').focus(); return; }
      juntar(v, 'colar');
    } else if (act === 'recarregar') location.reload();
  });
  da.addEventListener('change', async (e) => {
    const inp = e.target;
    if (inp.id !== 'prep-arq' || !inp.files?.[0]) return;
    const f = inp.files[0];
    if (f.size > 5e6) { status('prep-dados-st', 'Arquivo grande demais para ser do app.'); inp.value = ''; return; }
    try { juntar(await f.text(), 'arquivo'); } catch { status('prep-dados-st', 'Não deu para ler esse arquivo.'); }
    inp.value = '';
  });
}

// ---------- estilo ----------
function estilo() {
  if (document.getElementById('mod-preparar-css')) return;
  const s = document.createElement('style');
  s.id = 'mod-preparar-css';
  s.textContent = `
  #painel-preparar > .prep-sec { display: grid; gap: 10px; min-width: 0; align-content: start; }
  .prep-sec--sep { padding-top: 14px; border-top: 1px solid var(--panel-line); }
  .prep-h { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
  .prep-h h3 { margin: 0; font: 700 19px/1.1 var(--f-display); letter-spacing: .04em; text-transform: uppercase; }
  .prep-num { margin: 0; font: 12.5px/1 var(--f-data); color: var(--ink-soft); white-space: nowrap; }
  .prep-num b { font: 700 22px/1 var(--f-display); color: var(--ink); }
  .prep-h4 { margin: 4px 0 -2px; font: 600 11px/1.3 var(--f-display); letter-spacing: .14em; text-transform: uppercase; color: var(--ink-soft); }
  .prep-txt { margin: 0; font-size: 14px; line-height: 1.5; }
  .prep-bar { height: 8px; border-radius: 4px; background: color-mix(in srgb, var(--ink) 9%, transparent); overflow: hidden; }
  .prep-bar > span { display: block; height: 100%; border-radius: 4px; background: var(--g-ok); transition: width .3s ease; }
  .prep-bar--fino { height: 4px; }
  .prep-filtro label i { font: 500 10.5px/1 var(--f-data); font-style: normal; padding: 2px 5px; border-radius: 999px; background: color-mix(in srgb, currentColor 14%, transparent); }
  .prep-so { min-height: 36px; }
  .prep-so input { accent-color: var(--accent); width: 18px; height: 18px; flex: 0 0 auto; }
  .prep-so input:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .prep-acts { display: flex; flex-wrap: wrap; gap: 6px; }
  .prep-st { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; font-size: 13px; line-height: 1.45; color: var(--accent); }
  .prep-st:empty { display: none; }
  .prep-st > span { flex: 1 1 14em; min-width: 0; overflow-wrap: anywhere; }
  .prep-st--cat { margin: 0; padding: 4px 14px 0; }
  .prep-campo { display: block; width: 100%; box-sizing: border-box; min-height: 40px; padding: 8px 10px; border: 1px solid var(--panel-line); border-radius: 8px; background: var(--panel); color: var(--ink); font: 14px/1.4 var(--f-body); }
  textarea.prep-campo { resize: vertical; font: 13px/1.4 var(--f-data); }
  .prep-campo:focus-visible { outline: 2px solid var(--accent); outline-offset: 0; border-color: var(--accent); }
  .prep-file:focus-visible + label { outline: 2px solid var(--accent); outline-offset: 1px; }
  .prep-cats { display: grid; gap: 6px; }
  .prep-cat { min-width: 0; background: var(--tile); border: 1px solid color-mix(in srgb, var(--panel-line) 70%, transparent); border-radius: var(--r); scroll-margin: 12px; }
  .prep-cat > summary { list-style: none; cursor: pointer; display: grid; grid-template-columns: 1fr auto 16px; align-items: center; gap: 7px 10px; padding: 11px 12px; border-radius: var(--r); }
  .prep-cat > summary::-webkit-details-marker { display: none; }
  .prep-cat > summary:hover b { color: var(--accent); }
  .prep-cat > summary:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
  .prep-cat > summary b { min-width: 0; font: 700 15px/1.15 var(--f-display); letter-spacing: .03em; text-transform: uppercase; }
  .prep-cat > summary .prep-n { font: 12px/1 var(--f-data); color: var(--ink-soft); white-space: nowrap; }
  .prep-cat > summary svg { width: 16px; height: 16px; fill: none; stroke: var(--ink-soft); stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; transition: transform .2s; }
  .prep-cat[open] > summary svg { transform: rotate(90deg); }
  .prep-cat > summary .prep-bar { grid-column: 1 / -1; }
  .prep-cat.is-ok > summary .prep-n { color: var(--g-ok); font-weight: 500; }
  .prep-cat-nota { padding: 0 12px 6px; }
  .prep-its { list-style: none; margin: 0; padding: 0 8px 2px; }
  .prep-it { display: grid; grid-template-columns: 1fr auto; align-items: start; border-top: 1px solid color-mix(in srgb, var(--panel-line) 55%, transparent); transition: opacity .35s; }
  .prep-it > label { display: flex; align-items: flex-start; gap: 10px; min-width: 0; padding: 9px 4px; cursor: pointer; font-size: 14.5px; line-height: 1.35; }
  .prep-it > label > span { min-width: 0; overflow-wrap: anywhere; }
  .prep-it input { flex: 0 0 auto; width: 20px; height: 20px; margin: 0; accent-color: var(--g-ok); }
  .prep-it input:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .prep-it > small { grid-column: 1; display: block; margin-top: -5px; padding: 0 4px 9px 34px; font-size: 12.5px; line-height: 1.4; color: var(--ink-soft); }
  .prep-it.is-feito > label > span { color: var(--ink-soft); text-decoration: line-through; text-decoration-color: color-mix(in srgb, var(--ink-soft) 70%, transparent); }
  .prep-it.is-saindo { opacity: 0; }
  .prep-it .tag { margin-left: 4px; vertical-align: 1px; }
  .prep-del { all: unset; grid-row: 1; grid-column: 2; cursor: pointer; width: 40px; height: 40px; display: grid; place-items: center; border-radius: 8px; color: var(--ink-soft); }
  .prep-del:hover { color: var(--g-alta); background: color-mix(in srgb, var(--g-alta) 10%, transparent); }
  .prep-del:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
  .prep-del svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 2.2; stroke-linecap: round; }
  .prep-vazio { padding: 2px 14px 8px; }
  .prep-add { display: flex; gap: 6px; padding: 6px 10px 10px; }
  .prep-add input { flex: 1; min-width: 0; box-sizing: border-box; min-height: 38px; padding: 7px 10px; border: 1px solid var(--panel-line); border-radius: 8px; background: var(--panel); color: var(--ink); font: 14px/1.3 var(--f-body); }
  .prep-add input:focus-visible { outline: 2px solid var(--accent); outline-offset: 0; border-color: var(--accent); }
  .prep-flash { animation: prep-flash 1.4s ease-out; }
  @keyframes prep-flash { 0%, 30% { box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 55%, transparent); } 100% { box-shadow: 0 0 0 0 transparent; } }
  .prep-res { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
  .prep-r { display: grid; gap: 7px; min-width: 0; padding: 10px 12px; border-radius: 0 var(--r) var(--r) 0; background: var(--tile); border-left: 3px solid var(--c); scroll-margin: 12px; }
  .prep-r[data-st="feito"] { border-left-color: var(--g-ok); background: color-mix(in srgb, var(--g-ok) 7%, var(--tile)); }
  .prep-r[data-st="nao"] { border-left-color: var(--panel-line); }
  .prep-r[data-st="nao"] .prep-r-t { color: var(--ink-soft); text-decoration: line-through; }
  .prep-r[data-fora][data-st="pendente"] { border-left-style: dashed; }
  .prep-r-top { display: flex; flex-wrap: wrap; gap: 4px; }
  .prep-r-top .tag { white-space: normal; }
  .prep-r-t { font: 700 16px/1.2 var(--f-display); letter-spacing: .02em; overflow-wrap: anywhere; }
  .prep-r-meta { margin: 0; display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 12px; font: 12px/1.5 var(--f-data); color: var(--ink-soft); }
  .prep-r-meta .lnk { font: 600 12.5px/1.5 var(--f-body); }
  .prep-r-anot { margin: 0; font: 13px/1.4 var(--f-data); color: var(--contour); white-space: pre-wrap; overflow-wrap: anywhere; }
  .prep-prazo[data-nivel="atraso"] { --c: var(--g-alta); }
  .prep-prazo[data-nivel="perto"] { --c: var(--g-media); }
  .prep-prazo[data-nivel="ok"] { --c: var(--ink-soft); }
  .prep-r .seg2 label { padding: 9px 4px; }
  .prep-r-mais summary { cursor: pointer; width: max-content; font: 600 11.5px/1 var(--f-display); letter-spacing: .1em; text-transform: uppercase; color: var(--accent); padding: 6px 0; }
  .prep-r-mais summary:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 3px; }
  .prep-r-corpo { display: grid; gap: 6px; padding-top: 4px; }
  .prep-r-corpo p { margin: 0; font-size: 13.5px; line-height: 1.45; }
  .prep-r-lab { font: 600 11px/1.3 var(--f-display); letter-spacing: .1em; text-transform: uppercase; color: var(--ink-soft); }
  .prep-r-lab small { font: 11.5px var(--f-body); letter-spacing: 0; text-transform: none; }
  .prep-dia-res { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
  .prep-dia-res li { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; font-size: 14px; }
  .prep-dia-cks { display: flex; flex-wrap: wrap; gap: 6px; }
  @media (max-width: 700px) {
    .prep-filtro label { padding: 11px 12px; }
    .prep-cat > summary { padding: 13px 12px; }
    .prep-it > label { padding: 11px 4px; }
    .prep-so { min-height: 40px; }
    .prep-r .seg2 label { padding: 14px 4px; }
    .prep-r-mais summary { padding: 11px 0; }
    .prep-dia-res .lnk, .prep-r-meta .lnk { padding: 7px 0; }
  }
  @media (prefers-reduced-motion: reduce) { .prep-bar > span, .prep-it, .prep-cat > summary svg { transition: none; } .prep-flash { animation: none; } }
  /* impressão: só a lista (montada em #prep-print no fim do body) */
  #prep-print { display: none; }
  @media print {
    html.prep-imprimindo, html.prep-imprimindo body { height: auto !important; overflow: visible !important; background: #fff !important; }
    html.prep-imprimindo body > :not(#prep-print) { display: none !important; }
    html.prep-imprimindo #prep-print { display: block !important; color: #000; font: 10.5pt/1.35 var(--f-body); }
    #prep-print h1 { margin: 0; font: 700 20pt/1.1 var(--f-display); letter-spacing: .02em; text-transform: uppercase; }
    #prep-print .sub { margin: 1mm 0 5mm; font-size: 9.5pt; color: #444; }
    #prep-print .cols { columns: 2; column-gap: 9mm; }
    #prep-print h2 { margin: 0 0 1.5mm; padding-top: 2mm; font: 700 11.5pt/1.2 var(--f-display); letter-spacing: .04em; text-transform: uppercase; border-bottom: .5pt solid #888; break-after: avoid; }
    #prep-print h2 small { font: 9pt var(--f-data); color: #555; }
    #prep-print ul { list-style: none; margin: 0 0 4mm; padding: 0; }
    #prep-print li { break-inside: avoid; padding: .6mm 0 .6mm 5.5mm; text-indent: -5.5mm; }
    #prep-print li small { display: block; text-indent: 0; font-size: 8.5pt; color: #555; }
    #prep-print li.ok { color: #666; }
    @page { margin: 12mm; }
  }`;
  document.head.append(s);
}

// ---------- início ----------
async function carregar() {
  const ler = async (u) => { const r = await fetch(u); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); };
  const [a, b] = await Promise.allSettled([ler('data/checklist.json'), ler('data/reservas.json')]);
  if (a.status === 'fulfilled' && Array.isArray(a.value?.itens)) lista = a.value; else falhaLista = 'Não deu para ler a lista agora (sem sinal?). Ela aparece quando o app for aberto com internet uma vez.';
  if (b.status === 'fulfilled' && Array.isArray(b.value?.itens)) reservas = b.value; else falhaRes = 'Não deu para ler as reservas agora (sem sinal?).';
  lerEstado();
  renderCheck(); renderReservas();
  ctx.atualizarDia();   // a ficha aberta ganha o bloco do dia
}
export function iniciar(c) {
  ctx = c; U = c.util;
  if (!document.getElementById('painel-preparar')) return;
  estilo();
  lerEstado();
  renderTudo();
  ligar();
  ctx.registrar({
    blocoDia: { lugar: 'depois-opcionais', html: htmlDia },
    aoRenderDia: (n, el) => {
      if (ligadoDia) return;
      ligadoDia = true;   // #day é o mesmo elemento sempre (só o conteúdo muda): um ouvinte basta
      el.addEventListener('click', (e) => { const b = e.target.closest('[data-preparar-ir]'); if (b) irPara(b.dataset.prepararIr); });
    },
    aoMostrarPainel: (nome) => {
      if (nome === 'preparar') { lerEstado(); renderTudo(); }   // relê o aparelho (outro módulo ou aba pode ter mudado)
      else if (sujo) { sujo = false; ctx.atualizarDia(); }
    },
  });
  // Ctrl+P com o painel Preparar aberto também imprime só a lista
  addEventListener('beforeprint', () => {
    if (!document.documentElement.classList.contains('prep-imprimindo') && document.querySelector('.pane.is-on[data-pane="preparar"]')) montarImpressao();
  });
  addEventListener('afterprint', () => document.documentElement.classList.remove('prep-imprimindo'));
  // outra aba do app mudou os dados: acompanha
  addEventListener('storage', (e) => {
    if (e.key?.startsWith(PREFIXO + 'check.') || e.key?.startsWith(PREFIXO + 'reservas.')) { lerEstado(); renderCheck(); renderReservas(); }
    if (e.key?.startsWith(PREFIXO)) atualizarDescDados();
  });
  carregar();   // em segundo plano: não segura a abertura do app
}
