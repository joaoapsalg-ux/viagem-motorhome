// Diário da viagem: notas e fotos de cada dia, guardadas só neste aparelho (IndexedDB), e um .html para guardar uma cópia.
// Ficha do dia: bloco "Diário do dia" (lugar 'fim'). Painel Preparar: seção "Diário" (order 5).
let ctx = null, U = null;

const LADO = 1600;   // lado maior da foto guardada (px)
const MINI = 320;    // lado menor da miniatura (px)

const IC = {
  camera: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h3l1.6-2.5h6.8L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z"/><circle cx="12" cy="13" r="3.5"/></svg>',
  baixar: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11M7 10.5l5 5 5-5M5 20h14"/></svg>',
  x: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
};

// ---------- banco (IndexedDB) ----------
// notas { n, texto, em } · fotos { id, n, ordem, em, legenda, w, h, mw, mh, tam, tamMini, mini } · grandes { id, buf }
// (as imagens vão como ArrayBuffer: o Safari antigo falhava ao guardar Blob)
const BANCO = 'viagem-motorhome-diario';
let db = null, abrindo = null;
/** a conexão aberta (uma só, mesmo com várias gravações pedindo ao mesmo tempo) */
function conexao() {
  if (db) return Promise.resolve(db);
  return (abrindo ??= abrirBanco().then((b) => { db = b; return b; }).finally(() => { abrindo = null; }));
}
function abrirBanco() {
  return new Promise((ok, falha) => {
    if (!self.indexedDB) { falha(new Error('sem IndexedDB')); return; }
    const r = indexedDB.open(BANCO, 1);
    r.onupgradeneeded = () => {
      const b = r.result;
      if (!b.objectStoreNames.contains('notas')) b.createObjectStore('notas', { keyPath: 'n' });
      if (!b.objectStoreNames.contains('fotos')) b.createObjectStore('fotos', { keyPath: 'id' }).createIndex('n', 'n');
      if (!b.objectStoreNames.contains('grandes')) b.createObjectStore('grandes', { keyPath: 'id' });
    };
    r.onsuccess = () => {
      const b = r.result;
      b.onversionchange = () => { b.close(); if (db === b) db = null; };
      b.onclose = () => { if (db === b) db = null; };
      ok(b);
    };
    r.onerror = () => falha(r.error);
  });
}
const req = (r) => new Promise((ok, falha) => { r.onsuccess = () => ok(r.result); r.onerror = () => falha(r.error); });
const fimTx = (tx) => new Promise((ok, falha) => {
  tx.oncomplete = () => ok();
  tx.onerror = () => falha(tx.error);
  tx.onabort = () => falha(tx.error ?? new Error('gravação cancelada'));
});
/** roda fn(db); se a conexão caiu (o iPhone derruba quando o app fica em segundo plano), abre de novo e tenta outra vez */
async function noBanco(fn) {
  const b = await conexao();
  try { return await fn(b); } catch (e) {
    if (!['InvalidStateError', 'UnknownError', 'TransactionInactiveError'].includes(e?.name)) throw e;
    try { b.close(); } catch { /* já fechada */ }
    if (db === b) db = null;
    return fn(await conexao());
  }
}
async function lerGrande(id) {
  const r = await noBanco((b) => req(b.transaction('grandes').objectStore('grandes').get(id)));
  return r?.buf ?? null;
}

// ---------- o que está no banco, em memória ----------
let estado = 'abrindo';   // 'abrindo' | 'pronto' | 'erro'
let pronto = null;        // Promise da carga
const notas = new Map();  // n → { n, texto, em }
const fotos = new Map();  // n → [foto], na ordem
const porId = new Map();  // id → foto
const urls = new Map();   // id → endereço blob: da miniatura
const proc = new Map();   // n → andamento ("Reduzindo a foto 2 de 5…")
const stDia = new Map();  // n → "Salvo"
const lista = (n) => { if (!fotos.has(n)) fotos.set(n, []); return fotos.get(n); };
const ordenar = (l) => l.sort((a, b) => a.ordem - b.ordem || a.em - b.em);
const temNota = (n) => !!notas.get(n)?.texto?.trim();
const nFotos = (n) => fotos.get(n)?.length ?? 0;
const temAlgo = (n) => temNota(n) || nFotos(n) > 0;
const novoId = () => self.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
const plural = (k, um, varios) => `${k} ${k === 1 ? um : varios}`;
function urlMini(f) {
  let u = urls.get(f.id);
  if (!u) { u = URL.createObjectURL(new Blob([f.mini], { type: 'image/jpeg' })); urls.set(f.id, u); }
  return u;
}
async function carregar() {
  try {
    const tx = (await conexao()).transaction(['notas', 'fotos']);
    const [ns, fs] = await Promise.all([req(tx.objectStore('notas').getAll()), req(tx.objectStore('fotos').getAll())]);
    for (const x of ns) notas.set(x.n, x);
    for (const f of fs) { lista(f.n).push(f); porId.set(f.id, f); }
    for (const l of fotos.values()) ordenar(l);
    estado = 'pronto';
  } catch (e) {
    console.warn('diário:', e);
    estado = 'erro';
  }
  const n = ctx.diaAberto();
  if (n) encher(n);
  if (ctx.dias.some((d) => temAlgo(d.n))) ctx.atualizarViagem();   // etiquetas "Diário" na lista dos dias
  renderPainel();
}
const TXT_ERRO = 'Este navegador não deixou guardar o diário (janela anônima ou armazenamento bloqueado). Abra o app normal, pelo ícone da Tela de Início ou pelo navegador.';

// ---------- gravar (com espera curta enquanto digita) ----------
const timers = new Map();   // chave → { t, fn }
function agendar(chave, fn, ms = 700) {
  clearTimeout(timers.get(chave)?.t);
  timers.set(chave, { fn, t: setTimeout(() => { timers.delete(chave); fn(); }, ms) });
}
function cancelar(chave) { clearTimeout(timers.get(chave)?.t); timers.delete(chave); }
/** grava já o que estava esperando (ao sair do campo, trocar de app ou fechar) */
function gravarPendentes() { for (const [k, { t, fn }] of [...timers]) { clearTimeout(t); timers.delete(k); fn(); } }

function setSt(n, txt, ms = 0) {
  stDia.set(n, txt);
  const el = document.getElementById(`diario-st-${n}`);
  if (el) el.textContent = txt;
  if (ms) setTimeout(() => { if (stDia.get(n) !== txt) return; stDia.delete(n); const e2 = document.getElementById(`diario-st-${n}`); if (e2) e2.textContent = ''; }, ms);
}
async function salvarNota(n) {
  const x = notas.get(n);
  try {
    await noBanco((b) => {
      const tx = b.transaction('notas', 'readwrite');
      if (x?.texto?.trim()) tx.objectStore('notas').put(x); else tx.objectStore('notas').delete(n);
      return fimTx(tx);
    });
    setSt(n, '✓ Salvo', 2500);
  } catch (e) {
    console.warn('diário (nota):', e);
    setSt(n, e?.name === 'QuotaExceededError' ? 'Sem espaço: não salvou' : 'Não salvou');
  }
}
async function salvarFoto(f) {
  if (!porId.has(f.id)) return;   // apagada enquanto esperava
  try {
    await noBanco((b) => { const tx = b.transaction('fotos', 'readwrite'); tx.objectStore('fotos').put(f); return fimTx(tx); });
    setSt(f.n, '✓ Salvo', 2500);
  } catch (e) { console.warn('diário (legenda):', e); setSt(f.n, 'Não salvou'); }
}
/** a lista dos dias (etiqueta) e o painel mudam quando um dia passa a ter (ou deixa de ter) algo */
function mudouResumo() { agendar('resumo', () => { ctx.atualizarViagem(); renderPainel(); }, 400); }
function aoDigitarNota(n, texto) {
  const antes = temAlgo(n);
  notas.set(n, { n, texto, em: Date.now() });
  agendar(`t${n}`, () => salvarNota(n));
  if (antes !== temAlgo(n)) mudouResumo();
}
function aoDigitarLegenda(id, texto, campo) {
  const f = porId.get(id);
  if (!f) return;
  f.legenda = texto;
  agendar(`l${id}`, () => salvarFoto(f));
  const bt = campo.closest('.diario-ft')?.querySelector('[data-diario-ver]');
  if (bt) bt.setAttribute('aria-label', rotuloVer(f));
}
let pediuPersistir = false;
/** pede ao navegador para não apagar o que foi guardado (uma vez, quando entram fotos) */
function pedirPersistencia() {
  if (pediuPersistir || !navigator.storage?.persist) return;
  pediuPersistir = true;
  navigator.storage.persisted().then((p) => (p ? null : navigator.storage.persist())).catch(() => {});
}

// ---------- fotos: reduzir antes de guardar ----------
// no iPhone/iPad (todos os navegadores lá são WebKit) a <img> é o caminho seguro para a foto sair em pé
const WEBKIT = /iPhone|iPad|iPod/.test(navigator.userAgent) || (/AppleWebKit/.test(navigator.userAgent) && !/Chrome|Chromium|Android|Edg/.test(navigator.userAgent));
async function decodificar(arquivo) {
  if (self.createImageBitmap && !WEBKIT) {
    try {
      const b = await createImageBitmap(arquivo, { imageOrientation: 'from-image' });
      return { fonte: b, w: b.width, h: b.height, soltar: () => b.close?.() };
    } catch { /* tenta pela <img> (que também respeita a orientação da câmera) */ }
  }
  const url = URL.createObjectURL(arquivo);
  const img = new Image();
  img.src = url;
  try { await img.decode(); } catch (e) { URL.revokeObjectURL(url); throw e; }
  return { fonte: img, w: img.naturalWidth, h: img.naturalHeight, soltar: () => URL.revokeObjectURL(url) };
}
function tela(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
const MAX_PX = 16e6;   // o iPhone não desenha canvas acima de ~16,7 milhões de pixels
/** reduz pela metade até chegar perto do tamanho final (o canvas reduz melhor assim) e desenha em W×H */
function desenhar(fonte, w, h, W, H) {
  let src = fonte, sw = w, sh = h, velha = null;
  while (sw >= W * 2 && sh >= H * 2) {
    const k = Math.min(0.5, Math.sqrt(MAX_PX / (sw * sh)));   // panorama enorme: o primeiro passo reduz mais
    const c = tela(Math.max(W, Math.round(sw * k)), Math.max(H, Math.round(sh * k))), g = c.getContext('2d');
    g.imageSmoothingQuality = 'high';
    g.drawImage(src, 0, 0, c.width, c.height);
    if (velha) { velha.width = 0; velha.height = 0; }   // solta a memória (o iPhone tem pouca para canvas)
    velha = c; src = c; sw = c.width; sh = c.height;
  }
  const c = tela(W, H), g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);   // PNG transparente vira fundo branco no JPEG
  g.imageSmoothingQuality = 'high';
  g.drawImage(src, 0, 0, W, H);
  if (velha) { velha.width = 0; velha.height = 0; }
  return c;
}
const jpeg = (c, q) => new Promise((ok, falha) => c.toBlob((b) => (b ? ok(b) : falha(new Error('não deu para gerar o JPEG'))), 'image/jpeg', q));
/** foto da câmera → JPEG de até 1600 px (0,8) e miniatura de ~320 px */
async function reduzir(arquivo) {
  const { fonte, w, h, soltar } = await decodificar(arquivo);
  try {
    if (!w || !h) throw new Error('imagem vazia');
    const k = Math.min(1, LADO / Math.max(w, h));
    const G = { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
    const km = Math.min(1, MINI / Math.min(w, h), (MINI * 2) / Math.max(w, h));
    const M = { w: Math.max(1, Math.round(w * km)), h: Math.max(1, Math.round(h * km)) };
    const cg = desenhar(fonte, w, h, G.w, G.h);
    const grande = await jpeg(cg, 0.8);
    const cm = desenhar(cg, G.w, G.h, M.w, M.h);   // a miniatura sai da grande (mais rápido)
    const mini = await jpeg(cm, 0.75);
    cg.width = cg.height = cm.width = cm.height = 0;
    return { grande, mini, G, M };
  } finally { soltar(); }
}
let fila = Promise.resolve();   // uma foto de cada vez (memória do celular)
/** reduz e guarda as fotos escolhidas no diário do dia n */
export function adicionarFotos(n, arquivos) {
  const fs = [...arquivos].filter((f) => /^image\//.test(f.type) || /\.(jpe?g|png|webp|gif|heic|heif|avif|bmp)$/i.test(f.name ?? ''));
  if (!fs.length) { ctx.aviso('Nenhuma imagem entre os arquivos escolhidos.'); return fila; }
  fila = fila.then(() => processar(n, fs)).catch((e) => console.warn('diário (fotos):', e));
  return fila;
}
function setProc(n, txt) {
  if (txt) proc.set(n, txt); else proc.delete(n);
  const el = document.getElementById(`diario-fdica-${n}`);
  if (el) el.textContent = textoDica(n);
}
async function processar(n, fs) {
  await pronto;
  if (estado !== 'pronto') { ctx.aviso(TXT_ERRO); return; }
  let ok = 0, falhas = 0, semEspaco = false;
  for (let i = 0; i < fs.length; i++) {
    setProc(n, fs.length > 1 ? `Reduzindo a foto ${i + 1} de ${fs.length}…` : 'Reduzindo a foto…');
    try {
      const r = await reduzir(fs[i]);
      const [mini, grande] = await Promise.all([r.mini.arrayBuffer(), r.grande.arrayBuffer()]);
      const agora = Date.now();
      const f = { id: novoId(), n, ordem: fs[i].lastModified || agora, em: agora + i, legenda: '',
        w: r.G.w, h: r.G.h, mw: r.M.w, mh: r.M.h, tam: grande.byteLength, tamMini: mini.byteLength, mini };
      await noBanco((b) => {
        const tx = b.transaction(['fotos', 'grandes'], 'readwrite');
        tx.objectStore('fotos').put(f);
        tx.objectStore('grandes').put({ id: f.id, buf: grande });
        return fimTx(tx);
      });
      lista(n).push(f); ordenar(lista(n));
      porId.set(f.id, f);
      ok++;
      redesenharGrade(n);
    } catch (e) {
      console.warn('diário (foto):', e);
      if (e?.name === 'QuotaExceededError') { semEspaco = true; break; }
      falhas++;
    }
  }
  setProc(n, '');
  const partes = [];
  if (ok) partes.push(`${plural(ok, 'foto guardada', 'fotos guardadas')} no diário do dia ${n}`);
  if (falhas) partes.push(`${plural(falhas, 'arquivo', 'arquivos')} não deu para ler (formato que o navegador não abre?)`);
  if (semEspaco) partes.push('o aparelho ficou sem espaço: libere espaço e tente de novo');
  if (partes.length) { const t = partes.join('; '); ctx.aviso(t[0].toUpperCase() + t.slice(1) + '.'); }
  if (ok) { pedirPersistencia(); mudouResumo(); }
}

// ---------- apagar (dois toques) ----------
let confirmando = null;   // { id, t }
function posFoto(f) { return lista(f.n).indexOf(f) + 1; }
function rotuloVer(f) { return `Ampliar a foto ${posFoto(f)} de ${nFotos(f.n)}${f.legenda?.trim() ? `: ${f.legenda.trim()}` : ''}`; }
function botaoApagar(id) {
  const b = document.querySelector(`[data-diario-del="${id}"]`), f = porId.get(id);
  if (!b || !f) return;
  const conf = confirmando?.id === id;
  b.classList.toggle('is-conf', conf);
  b.innerHTML = conf ? 'Apagar?' : IC.x;
  b.setAttribute('aria-label', conf ? `Confirmar: apagar a foto ${posFoto(f)}` : `Apagar a foto ${posFoto(f)}`);
}
function cliqueApagar(id) {
  if (confirmando?.id === id) { clearTimeout(confirmando.t); confirmando = null; apagarFoto(id); return; }
  if (confirmando) { const velho = confirmando.id; clearTimeout(confirmando.t); confirmando = null; botaoApagar(velho); }
  confirmando = { id, t: setTimeout(() => { confirmando = null; botaoApagar(id); }, 4000) };
  botaoApagar(id);
  ctx.anunciar('Toque de novo para apagar a foto.');
}
async function apagarFoto(id) {
  const f = porId.get(id);
  if (!f) return;
  cancelar(`l${id}`);   // a legenda esperando para gravar não pode ressuscitar a foto
  try {
    await noBanco((b) => {
      const tx = b.transaction(['fotos', 'grandes'], 'readwrite');
      tx.objectStore('fotos').delete(id);
      tx.objectStore('grandes').delete(id);
      return fimTx(tx);
    });
  } catch (e) { console.warn('diário (apagar):', e); ctx.aviso('Não deu para apagar a foto agora.'); return; }
  const l = lista(f.n), i = l.indexOf(f);
  if (i >= 0) l.splice(i, 1);
  porId.delete(id);
  const u = urls.get(id);
  if (u) { URL.revokeObjectURL(u); urls.delete(id); }
  if (foco?.chave === `l${id}`) foco = null;
  redesenharGrade(f.n);
  const vizinha = l[i] ?? l[i - 1];   // o foco vai para a foto ao lado (ou para "Pôr fotos")
  (vizinha ? document.querySelector(`[data-diario-del="${vizinha.id}"]`) : document.querySelector(`[data-diario-por="${f.n}"]`))?.focus({ preventScroll: true });
  ctx.anunciar('Foto apagada.');
  mudouResumo();
}

// ---------- foco: volta para o campo depois que a ficha é redesenhada ----------
let foco = null;   // { chave, ini, fim }
function lembrar(el) { if (el?.dataset?.diarioFoco) foco = { chave: el.dataset.diarioFoco, ini: el.selectionStart, fim: el.selectionEnd }; }
function restaurarFoco() {
  if (!foco) return;
  const a = document.activeElement;
  if (a && a !== document.body && a.isConnected) return;   // a pessoa já está em outro lugar
  const el = document.querySelector(`[data-diario-foco="${foco.chave}"]`);
  if (!el) { foco = null; return; }
  el.focus({ preventScroll: true });
  try { el.setSelectionRange(foco.ini, foco.fim); } catch { /* sem seleção */ }
}

// ---------- ficha do dia ----------
function textoDica(n) {
  if (proc.has(n)) return proc.get(n);
  const k = nFotos(n);
  return k ? `${plural(k, 'foto', 'fotos')}. Toque numa para ampliar.` : 'As fotos são reduzidas (1.600 px) antes de guardar.';
}
function htmlFoto(f, i, total) {
  const conf = confirmando?.id === f.id;
  return `<li class="diario-ft">
    <button type="button" class="diario-mini" data-diario-ver="${f.id}" aria-label="${U.esc(`Ampliar a foto ${i + 1} de ${total}${f.legenda?.trim() ? `: ${f.legenda.trim()}` : ''}`)}"><img src="${urlMini(f)}" alt="" width="${f.mw}" height="${f.mh}" decoding="async"></button>
    <button type="button" class="diario-del${conf ? ' is-conf' : ''}" data-diario-del="${f.id}" aria-label="${conf ? 'Confirmar: apagar' : 'Apagar'} a foto ${i + 1}">${conf ? 'Apagar?' : IC.x}</button>
    <input type="text" class="diario-leg" data-diario-leg="${f.id}" data-diario-foco="l${f.id}" value="${U.esc(f.legenda ?? '')}" maxlength="140" placeholder="Legenda" aria-label="Legenda da foto ${i + 1}" enterkeyhint="done" autocomplete="off">
  </li>`;
}
const htmlFotos = (n) => (fotos.get(n) ?? []).map((f, i, l) => htmlFoto(f, i, l.length)).join('');
function htmlDentro(n) {
  const h = `<h3 id="diario-h-${n}">Diário do dia <span>só neste aparelho</span></h3>`;
  if (estado === 'erro') return `${h}<p class="cc-warn">${U.esc(TXT_ERRO)}</p>`;
  if (estado !== 'pronto') return `${h}<p class="hint">Abrindo o diário…</p>`;
  return `${h}
    <label class="sr-only" for="diario-txt-${n}">Notas do dia ${n}</label>
    <textarea id="diario-txt-${n}" class="diario-txt" data-diario-txt="${n}" data-diario-foco="t${n}" rows="4" maxlength="20000" placeholder="Como foi o dia? O que viram, onde comeram, o que não pode esquecer…">${U.esc(notas.get(n)?.texto ?? '')}</textarea>
    <div class="diario-acts">
      <button type="button" class="btn btn--small" data-diario-por="${n}" aria-describedby="diario-fdica-${n}">${IC.camera}Pôr fotos</button>
      <span class="diario-st" id="diario-st-${n}">${U.esc(stDia.get(n) ?? '')}</span>
    </div>
    <p class="hint" id="diario-fdica-${n}">${U.esc(textoDica(n))}</p>
    <ul class="diario-grade" id="diario-grade-${n}" aria-label="Fotos do dia ${n}">${htmlFotos(n)}</ul>`;
}
const htmlBloco = (d) => `<section class="blk diario" id="diario-${d.n}" aria-labelledby="diario-h-${d.n}">${htmlDentro(d.n)}</section>`;
function encher(n) {
  const s = document.getElementById(`diario-${n}`);
  if (!s) return;
  s.innerHTML = htmlDentro(n);
  restaurarFoco();
}
function redesenharGrade(n) {
  const ul = document.getElementById(`diario-grade-${n}`);
  if (ul) { ul.innerHTML = htmlFotos(n); restaurarFoco(); }
  const dica = document.getElementById(`diario-fdica-${n}`);
  if (dica) dica.textContent = textoDica(n);
}

// escolher fotos: um campo só, fora da ficha (a ficha pode ser redesenhada enquanto o seletor está aberto)
let arq = null, alvo = null;
function escolherFotos(n) {
  if (estado !== 'pronto') { ctx.aviso(estado === 'erro' ? TXT_ERRO : 'O diário ainda está abrindo.'); return; }
  alvo = n;
  arq.value = '';
  arq.click();
}

// ---------- ver a foto grande ----------
let visor = null, ver = null, urlGrande = null, seqVer = 0;
function montarVisor() {
  visor = document.createElement('dialog');
  visor.id = 'diario-ver'; visor.className = 'diario-ver';
  visor.setAttribute('aria-labelledby', 'diario-ver-t');
  visor.innerHTML = `
    <div class="diario-ver-top"><p id="diario-ver-t"></p>
      <button type="button" class="diario-ver-b" data-v="fechar" aria-label="Fechar a foto">${IC.x}</button></div>
    <figure class="diario-ver-fig"><img alt=""><figcaption></figcaption></figure>
    <button type="button" class="diario-ver-b diario-ver-ant" data-v="ant" aria-label="Foto anterior">${U.ICONE.voltar}</button>
    <button type="button" class="diario-ver-b diario-ver-prox" data-v="prox" aria-label="Foto seguinte">${U.ICONE.seguir}</button>`;
  document.body.append(visor);
  visor.querySelector('img').draggable = false;   // arrastar com o mouse troca a foto, não puxa a imagem
  let x0 = null, arrastou = false;
  const fig = visor.querySelector('figure');
  fig.addEventListener('pointerdown', (e) => { x0 = e.clientX; arrastou = false; });
  fig.addEventListener('pointerup', (e) => {
    if (x0 == null) return;
    const dx = e.clientX - x0; x0 = null;
    if (Math.abs(dx) > 50) { arrastou = true; andar(dx < 0 ? 1 : -1); }   // deslizar o dedo troca a foto
  });
  visor.addEventListener('click', (e) => {
    const v = e.target.closest('[data-v]')?.dataset.v;
    if (v === 'fechar') fecharVisor();
    else if (v === 'ant') andar(-1);
    else if (v === 'prox') andar(1);
    else if (!arrastou && (e.target === visor || e.target === fig)) fecharVisor();   // toque fora da foto fecha
    arrastou = false;
  });
  // as teclas ficam no visor (senão as setas trocariam o dia e o Esc fecharia a ficha)
  visor.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') { e.preventDefault(); andar(-1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); andar(1); }
    else if (e.key === 'Escape') { e.preventDefault(); fecharVisor(); }
    e.stopPropagation();
  });
  visor.addEventListener('cancel', (e) => { e.preventDefault(); fecharVisor(); });
  visor.addEventListener('close', () => aoFecharVisor());
}
function abrirVisor(id) {
  const f = porId.get(id);
  if (!f) return;
  ver = { n: f.n, id };
  mostrarFoto();
  if (!visor.open) { if (typeof visor.showModal === 'function') visor.showModal(); else visor.setAttribute('open', ''); }
  visor.querySelector('[data-v="fechar"]').focus({ preventScroll: true });
}
function andar(passo) {
  if (!ver) return;
  const l = fotos.get(ver.n) ?? [], i = l.findIndex((f) => f.id === ver.id);
  if (l.length < 2 || i < 0) return;
  ver.id = l[(i + passo + l.length) % l.length].id;
  mostrarFoto();
  ctx.anunciar(visor.querySelector('#diario-ver-t').textContent);
}
async function mostrarFoto() {
  const l = fotos.get(ver.n) ?? [], i = l.findIndex((f) => f.id === ver.id);
  if (i < 0) { fecharVisor(); return; }
  const f = l[i], img = visor.querySelector('img');
  visor.querySelector('#diario-ver-t').textContent = `Dia ${ver.n} · foto ${i + 1} de ${l.length}`;
  visor.querySelector('figcaption').textContent = f.legenda?.trim() ?? '';
  visor.querySelectorAll('.diario-ver-ant, .diario-ver-prox').forEach((b) => { b.hidden = l.length < 2; });
  img.width = f.w; img.height = f.h;
  img.alt = f.legenda?.trim() || `Foto ${i + 1} do dia ${ver.n}`;
  img.src = urlMini(f);   // a miniatura aparece na hora; a grande vem do banco
  const pedido = ++seqVer;
  try {
    const buf = await lerGrande(f.id);
    if (pedido !== seqVer || !buf) return;
    if (urlGrande) URL.revokeObjectURL(urlGrande);
    urlGrande = URL.createObjectURL(new Blob([buf], { type: 'image/jpeg' }));
    img.src = urlGrande;
  } catch (e) { console.warn('diário (ver):', e); }
}
function fecharVisor() {
  if (visor.open) { if (typeof visor.close === 'function') visor.close(); else { visor.removeAttribute('open'); aoFecharVisor(); } }
}
function aoFecharVisor() {
  seqVer++;
  if (urlGrande) { URL.revokeObjectURL(urlGrande); urlGrande = null; }
  const id = ver?.id;
  ver = null;
  if (id) document.querySelector(`[data-diario-ver="${id}"]`)?.focus({ preventScroll: true });
}

// ---------- painel Preparar ----------
let msgPainel = '';
let arquivoPronto = null;   // File montado que o iPhone não deixou compartilhar sem um toque novo
const mb =(b) => (b >= 1e9 ? `${U.nf(b / 1e9, 1)} GB` : b >= 1e6 ? `${U.nf(b / 1e6, b < 1e7 ? 1 : 0)} MB` : `${U.nf(Math.max(1, Math.round(b / 1e3)))} KB`);
function bytesDiario() {
  let b = 0;
  for (const f of porId.values()) b += (f.tam || 0) + (f.tamMini || 0);
  for (const x of notas.values()) if (x.texto?.trim()) b += x.texto.length * 2;   // nota só com espaços não fica guardada
  return b;
}
function textoDiario() {
  const k = porId.size, b = bytesDiario();
  return b ? `O diário ocupa ~${mb(b)}${k ? ` (${plural(k, 'foto', 'fotos')})` : ''}.` : 'O diário ainda está vazio.';
}
async function textoEspaco() {
  let t = textoDiario();
  try {
    const e = await navigator.storage?.estimate?.();
    if (e?.usage != null) t += ` O app todo, com os mapas guardados, usa ${mb(e.usage)}${e.quota ? ` dos ~${mb(e.quota)} que o navegador libera` : ''}.`;
  } catch { /* sem estimativa */ }
  try { if (await navigator.storage?.persisted?.()) t += ' O navegador prometeu não apagar.'; } catch { /* sem informação */ }
  return t;
}
function htmlPainel() {
  const h = '<div class="diario-ph"><h3 id="mod-diario-h">Diário</h3>';
  if (estado === 'erro') return `${h}</div><p class="cc-warn">${U.esc(TXT_ERRO)}</p>`;
  if (estado !== 'pronto') return `${h}</div><p class="hint">Abrindo o diário…</p>`;
  const ds = ctx.dias.filter((d) => temAlgo(d.n));
  const itens = ds.map((d) => {
    const a = ctx.ativo(d), k = nFotos(d.n);
    const o = [temNota(d.n) ? 'com notas' : 'sem notas', k ? plural(k, 'foto', 'fotos') : 'sem fotos'].join(' · ');
    return `<li><button type="button" class="day" data-diario-abrir="${d.n}" style="--c:${U.corDia(d.n)}">
      <i>${d.n}</i><b>${U.esc(a.de)} → ${U.esc(a.para)}</b><span class="tags"></span>
      <small>${U.fmtData(d.data, d.semana)} · ${o}</small></button></li>`;
  }).join('');
  return `${h}<p class="diario-num"><b>${ds.length}</b> de ${ctx.dias.length} dias</p></div>
    <p class="diario-p">Notas e fotos de cada dia, escritas no fim da ficha do dia (Roteiro › dia › Diário do dia).</p>
    ${ds.length ? `<ol class="days" aria-label="Dias com diário">${itens}</ol>` : '<p class="hint">Ainda nada escrito. Abra um dia no Roteiro e use o "Diário do dia".</p>'}
    <p class="diario-esp" data-diario-esp>${U.esc(textoDiario())}</p>
    <button type="button" class="btn btn--main" data-diario-baixar aria-describedby="diario-baixar-dica"${ds.length ? '' : ' disabled'}>${IC.baixar}Baixar o diário</button>
    <p class="hint" id="diario-baixar-dica">Um arquivo .html só, com as notas e as fotos de cada dia, que abre em qualquer navegador (e dá para imprimir).</p>
    <p class="diario-msg" role="status">${U.esc(msgPainel)}</p>
    ${arquivoPronto ? `<button type="button" class="btn" data-diario-compartilhar>${U.ICONE.compartilhar}Compartilhar o arquivo pronto</button>` : ''}
    <p class="cc-warn"><b>Fica só neste aparelho.</b> Não vai para a internet nem entra no "Levar meus dados para outro celular", e some se apagar os dados do site ou desinstalar o app. Baixe o diário de vez em quando e guarde a cópia (Drive, e-mail, computador).</p>`;
}
function renderPainel() {
  const pai = document.getElementById('painel-preparar');
  if (!pai || !ctx) return;
  let sec = document.getElementById('mod-diario');
  if (!sec) {   // criada uma vez; o painel é uma grade e a posição vem do order
    sec = document.createElement('section');
    sec.id = 'mod-diario'; sec.style.order = '5';
    sec.setAttribute('aria-labelledby', 'mod-diario-h');
    pai.append(sec);
    sec.addEventListener('click', (e) => {
      if (e.target.closest('[data-diario-baixar]')) { baixarDiario(); return; }
      if (e.target.closest('[data-diario-compartilhar]')) { compartilharPronto(); return; }
      const ab = e.target.closest('[data-diario-abrir]');
      if (ab) irParaDiario(+ab.dataset.diarioAbrir);
    });
  }
  // o foco volta para o mesmo botão depois de redesenhar
  const a = document.activeElement, k = sec.contains(a) ? (a.dataset.diarioAbrir ? [`[data-diario-abrir="${a.dataset.diarioAbrir}"]`]
    : a.hasAttribute('data-diario-baixar') ? ['[data-diario-baixar]'] : a.hasAttribute('data-diario-compartilhar') ? ['[data-diario-compartilhar]', '[data-diario-baixar]'] : null) : null;
  sec.innerHTML = htmlPainel();
  if (k) k.map((s) => sec.querySelector(s)).find((b) => b && !b.disabled)?.focus({ preventScroll: true });
  if (estado === 'pronto') textoEspaco().then((t) => { const el = sec.querySelector('[data-diario-esp]'); if (el) el.textContent = t; });
}
function setMsg(t) {
  msgPainel = t;
  const el = document.querySelector('#mod-diario .diario-msg');
  if (el) el.textContent = t;
}
function irParaDiario(n) {
  ctx.abrirDia(n);
  if (ctx.celular()) ctx.setSheet('full');
  requestAnimationFrame(() => {
    const s = document.getElementById(`diario-${n}`);
    s?.scrollIntoView({ block: 'start', behavior: U.reduzMovimento() ? 'auto' : 'smooth' });
    if (!ctx.celular()) s?.querySelector('textarea')?.focus({ preventScroll: true });   // no celular, sem abrir o teclado
  });
}

// ---------- baixar o diário (.html com tudo dentro) ----------
const dataURL = (blob) => new Promise((ok, falha) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = () => falha(r.error); r.readAsDataURL(blob); });
function dataLonga(iso) {
  const t = new Date(`${iso}T12:00:00`).toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  return t[0].toUpperCase() + t.slice(1);
}
const paragrafos = (t) => t.trim().split(/\n\s*\n/).map((p) => `<p>${U.esc(p.trim()).replace(/\n/g, '<br>')}</p>`).join('');
function hojeLocal() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
// estilo do arquivo baixado: as mesmas cores do app, claro e escuro, e bom para imprimir
const CSS_ARQ = `
:root { --bg: #f5f6f1; --tile: #eceee7; --ink: #1d2621; --soft: #56625a; --line: #d3d8ce; --contour: #7a4a26; --accent: #1e5d86; color-scheme: light dark; }
@media (prefers-color-scheme: dark) { :root { --bg: #161d1a; --tile: #1c2420; --ink: #e2e7df; --soft: #9aa69e; --line: #2b3530; --contour: #d39a6a; --accent: #6db3df; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 17px/1.6 'Barlow', 'Segoe UI', system-ui, -apple-system, sans-serif; }
main { max-width: 860px; margin: 0 auto; padding: 0 20px 48px; }
h1, h2, .num, .eyebrow, .sum a { font-family: 'Barlow Condensed', 'Arial Narrow', 'Roboto Condensed', system-ui, sans-serif; }
.capa { position: relative; overflow: hidden; padding: 56px 20px 40px; text-align: center; border-bottom: 1px solid var(--line); }
.capa svg { position: absolute; inset: 0; width: 100%; height: 100%; stroke: var(--contour); opacity: .35; }
.capa > * { position: relative; }
.eyebrow { margin: 0; font-weight: 600; font-size: 13px; letter-spacing: .16em; text-transform: uppercase; color: var(--soft); }
h1 { margin: 8px 0 6px; font-size: clamp(40px, 9vw, 68px); line-height: .95; font-weight: 700; text-transform: uppercase; letter-spacing: .02em; }
.capa .sub { margin: 0; font-size: 16px; color: var(--soft); }
.sum { margin: 28px 0 8px; }
.sum ol { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 8px; }
.sum a { display: inline-flex; align-items: center; gap: 8px; padding: 6px 12px 6px 6px; border-radius: 999px; background: var(--tile); color: var(--ink); text-decoration: none; font-weight: 600; font-size: 15px; letter-spacing: .03em; }
.sum a i { width: 26px; height: 26px; border-radius: 50%; display: grid; place-items: center; font-style: normal; color: #fff; background: color-mix(in srgb, var(--c) 70%, #000); }
.dia { margin-top: 40px; padding-top: 28px; border-top: 1px solid var(--line); }
.dia > header { display: grid; grid-template-columns: 56px 1fr; gap: 0 16px; align-items: center; margin-bottom: 14px; }
.num { grid-row: span 3; width: 56px; height: 56px; border-radius: 14px; display: grid; place-items: center; font-size: 28px; font-weight: 700; color: #fff; background: color-mix(in srgb, var(--c) 70%, #000); }
.data { margin: 0; font-size: 14px; color: var(--soft); }
h2 { margin: 0; font-size: 30px; line-height: 1.05; font-weight: 700; text-transform: uppercase; letter-spacing: .02em; }
h2 span { color: var(--soft); font-weight: 600; }
.meta { margin: 2px 0 0; font-size: 14px; color: var(--contour); }
.nota { font-size: 18px; }
.nota p { margin: 0 0 12px; }
.fotos { columns: 2 300px; column-gap: 14px; margin-top: 16px; }
figure { break-inside: avoid; margin: 0 0 14px; }
figure img { display: block; width: 100%; height: auto; border-radius: 10px; background: var(--tile); cursor: zoom-in; }
figcaption { margin-top: 5px; font-size: 14.5px; color: var(--soft); }
footer { margin-top: 48px; padding-top: 16px; border-top: 1px solid var(--line); font-size: 13px; color: var(--soft); }
.zoom { position: fixed; inset: 0; z-index: 9; padding: 12px; background: rgba(8, 11, 10, .94); cursor: zoom-out; }
.zoom img { display: block; width: 100%; height: 100%; object-fit: contain; }
@media print { body { background: #fff; color: #000; font-size: 12pt; } .capa svg, .sum { display: none; } .dia { break-before: page; border: 0; } .fotos { columns: 2; } figure img { cursor: auto; } }`;
// toque numa foto do arquivo baixado: abre grande (Esc ou toque fecha)
const JS_ARQ = `document.addEventListener('click',function(e){var z=document.querySelector('.zoom');if(z){z.remove();return;}var i=e.target.closest('figure img');if(!i)return;var d=document.createElement('div');d.className='zoom';d.innerHTML='<img alt="">';d.firstChild.src=i.src;d.firstChild.alt=i.alt;document.body.appendChild(d);});document.addEventListener('keydown',function(e){if(e.key==='Escape'){var z=document.querySelector('.zoom');if(z)z.remove();}});`;
const TOPO = '<svg viewBox="0 0 800 300" preserveAspectRatio="xMidYMid slice" aria-hidden="true" fill="none" stroke-width="1.2"><path d="M-20 230c90-40 160-10 250-50s120-130 230-120 150 90 250 70 70-40 110-40"/><path d="M-20 260c100-36 170-4 260-44s130-136 226-126 140 100 244 82 70-36 110-36"/><path d="M-20 200c80-44 150-18 240-56s110-120 236-112 160 76 256 58 60-44 108-44"/><path d="M-20 290c110-30 180 4 270-36s140-140 220-130 130 110 240 94 70-30 110-30"/><path d="M330 120c20-30 70-44 110-36s56 40 30 60-80 26-110 14-44-14-30-38z"/><path d="M362 116c10-16 36-24 58-20s30 22 16 32-42 14-58 8-24-8-16-20z"/></svg>';
/** monta o .html do diário (Blob); aoAndar(k, total) a cada foto */
export async function gerarHTML(aoAndar) {
  await pronto;
  if (estado !== 'pronto') throw new Error('diário indisponível');
  gravarPendentes();
  const { esc, corDia, fmtKm, fmtDia } = U, R = ctx.dados.roteiro;
  const ds = ctx.dias.filter((d) => temAlgo(d.n));
  const total = ds.reduce((s, d) => s + nFotos(d.n), 0);
  const agora = new Date();
  const partes = [`<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Diário · ${esc(R.titulo ?? 'Viagem de motorhome')}</title><style>${CSS_ARQ}</style></head><body>
<header class="capa">${TOPO}<p class="eyebrow">Diário da viagem</p><h1>${esc(R.titulo ?? 'Viagem de motorhome')}</h1>
<p class="sub">${esc(R.periodo ?? '')} · ${plural(ds.length, 'dia', 'dias')} · ${plural(total, 'foto', 'fotos')}</p></header><main>
<nav class="sum" aria-label="Dias"><ol>${ds.map((d) => `<li><a href="#dia-${d.n}" style="--c:${corDia(d.n)}"><i>${d.n}</i>${esc(ctx.ativo(d).para)}</a></li>`).join('')}</ol></nav>`];
  let k = 0;
  for (const d of ds) {
    const a = ctx.ativo(d), P = ctx.rotaAtiva(d)?.properties ?? {}, nota = notas.get(d.n)?.texto?.trim() ?? '';
    const meta = [P.tipo === 'shuttle' ? 'de shuttle' : P.km ? fmtKm(P.km) : '', a.pernoite?.nome ? `pernoite: ${a.pernoite.nome}` : ''].filter(Boolean).join(' · ');
    partes.push(`<section class="dia" id="dia-${d.n}" style="--c:${corDia(d.n)}"><header><span class="num">${d.n}</span>
<p class="data">Dia ${d.n} · ${esc(dataLonga(d.data))}</p><h2>${esc(a.de)} <span>→</span> ${esc(a.para)}</h2>${meta ? `<p class="meta">${esc(meta)}</p>` : ''}</header>`);
    if (nota) partes.push(`<div class="nota">${paragrafos(nota)}</div>`);
    const fs = fotos.get(d.n) ?? [];
    if (fs.length) {
      partes.push('<div class="fotos">');
      for (const f of fs) {
        aoAndar?.(++k, total);
        const buf = (await lerGrande(f.id)) ?? f.mini;   // sem a grande (não deveria acontecer), vai a miniatura
        const src = await dataURL(new Blob([buf], { type: 'image/jpeg' }));
        const leg = f.legenda?.trim() ?? '';
        partes.push(`<figure><img src="`, src, `" width="${f.w}" height="${f.h}" alt="${esc(leg || `Foto do dia ${d.n}`)}" loading="lazy">${leg ? `<figcaption>${esc(leg)}</figcaption>` : ''}</figure>`);
      }
      partes.push('</div>');
    }
    partes.push('</section>');
  }
  const hora = `${agora.getHours()}h${String(agora.getMinutes()).padStart(2, '0')}`;
  partes.push(`<footer>Feito no app da viagem em ${fmtDia(hojeLocal())}, ${hora}. As fotos foram reduzidas para até ${U.nf(LADO)} px.</footer></main><script>${JS_ARQ}</script></body></html>`);
  return new Blob(partes, { type: 'text/html;charset=utf-8' });
}
async function entregar(blob, nome) {
  // no app da Tela de Início do iPhone o download não funciona bem: lá vai pelo "Compartilhar"
  if (navigator.standalone && navigator.canShare) {
    const f = new File([blob], nome, { type: 'text/html' });
    try {
      if (navigator.canShare({ files: [f] })) { await navigator.share({ files: [f], title: 'Diário da viagem' }); return 'compartilhado'; }
    } catch (e) {
      if (e?.name === 'AbortError') throw e;
      // montar demorou e o toque "venceu": o iPhone pede um toque novo para compartilhar
      if (e?.name === 'NotAllowedError') { arquivoPronto = f; return 'esperando'; }
    }
  }
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = nome; a.hidden = true;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);   // o celular pode demorar a ler o arquivo
  return 'baixado';
}
let baixando = false;
async function baixarDiario() {
  if (baixando || estado !== 'pronto') return;
  const ds = ctx.dias.filter((d) => temAlgo(d.n));
  if (!ds.length) { setMsg('Ainda não há nada no diário para baixar.'); return; }
  baixando = true;
  arquivoPronto = null;
  setMsg('Montando o arquivo…');
  try {
    const blob = await gerarHTML((k, tot) => setMsg(`Montando o arquivo… foto ${k} de ${tot}`));
    const nome = `diario-motorhome-${hojeLocal()}.html`;
    const como = await entregar(blob, nome);
    const k = ds.reduce((s, d) => s + nFotos(d.n), 0);
    const resumo = `${nome} (${mb(blob.size)}, ${plural(ds.length, 'dia', 'dias')}, ${plural(k, 'foto', 'fotos')})`;
    if (como === 'esperando') { msgPainel = `Arquivo pronto: ${resumo}. Toque em "Compartilhar o arquivo pronto" e escolha Salvar em Arquivos.`; renderPainel(); ctx.anunciar(msgPainel); }
    else setMsg(`${como === 'compartilhado' ? 'Pronto' : 'Baixado'}: ${resumo}. Guarde onde não se perca.`);
  } catch (e) {
    if (e?.name === 'AbortError') setMsg('');
    else { console.warn('diário (baixar):', e); setMsg('Não deu para montar o arquivo (pouca memória?). Tente de novo com o app recém-aberto.'); }
  } finally { baixando = false; }
}
/** segundo toque no iPhone: compartilha o arquivo que já ficou pronto */
async function compartilharPronto() {
  const f = arquivoPronto;
  if (!f) return;
  try {
    await navigator.share({ files: [f], title: 'Diário da viagem' });
    arquivoPronto = null;
    msgPainel = `Pronto: ${f.name}. Guarde onde não se perca.`;
  } catch (e) {
    if (e?.name === 'AbortError') return;
    console.warn('diário (compartilhar):', e);
    arquivoPronto = null;
    msgPainel = 'Não deu para compartilhar. Tente "Baixar o diário" de novo.';
  }
  renderPainel();
}

// ---------- estilo ----------
const CSS = `
  .diario .diario-txt { display: block; width: 100%; box-sizing: border-box; min-height: 7.2em; max-height: 60vh; padding: 9px 11px; border: 1px solid var(--panel-line); border-radius: 8px; background: var(--panel); color: var(--ink); font: 15px/1.5 var(--f-body); resize: vertical; field-sizing: content; }
  .diario .diario-txt::placeholder, .diario-leg::placeholder { color: var(--ink-soft); opacity: .8; }
  .diario .diario-txt:focus-visible, .diario-leg:focus-visible { outline: 2px solid var(--accent); outline-offset: 0; border-color: var(--accent); }
  .diario-acts { display: flex; align-items: center; flex-wrap: wrap; gap: 6px 10px; }
  .diario-st { margin-left: auto; font: 11.5px/1 var(--f-data); color: var(--ink-soft); }
  .diario-grade { list-style: none; margin: 2px 0 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(104px, 1fr)); gap: 10px 8px; }
  .diario-grade:empty { display: none; }
  .diario-ft { position: relative; display: grid; gap: 4px; min-width: 0; }
  .diario-mini { all: unset; cursor: zoom-in; display: block; aspect-ratio: 1; border-radius: 8px; overflow: hidden; background: color-mix(in srgb, var(--ink) 8%, var(--tile)); }
  .diario-mini img { display: block; width: 100%; height: 100%; object-fit: cover; transition: transform .2s; }
  .diario-mini:hover img { transform: scale(1.04); }
  .diario-mini:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .diario-del { all: unset; cursor: pointer; position: absolute; top: 4px; right: 4px; min-width: 32px; height: 32px; box-sizing: border-box; display: grid; place-items: center; border-radius: 999px; background: rgba(15, 21, 19, .62); color: #fff; font: 600 11.5px/1 var(--f-display); letter-spacing: .06em; text-transform: uppercase; }
  .diario-del svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 2.2; stroke-linecap: round; }
  .diario-del:hover { background: rgba(15, 21, 19, .85); }
  .diario-del:focus-visible { outline: 2px solid #fff; box-shadow: 0 0 0 4px var(--accent); }
  .diario-del.is-conf { padding: 0 10px; background: #b3184f; }
  .diario-leg { width: 100%; box-sizing: border-box; min-height: 32px; padding: 5px 7px; border: 1px solid color-mix(in srgb, var(--panel-line) 85%, transparent); border-radius: 6px; background: var(--panel); color: var(--ink); font: 12.5px/1.3 var(--f-body); }
  /* visor: sempre escuro, a foto no centro */
  .diario-ver { position: fixed; inset: 0; width: 100vw; height: 100vh; height: 100dvh; max-width: none; max-height: none; margin: 0; padding: 0; border: 0; background: rgba(8, 11, 10, .97); color: #f2f4ef; overflow: hidden; }
  .diario-ver[open] { display: grid; grid-template-rows: auto minmax(0, 1fr); }
  .diario-ver::backdrop { background: rgba(8, 11, 10, .6); }
  .diario-ver-top { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: calc(10px + env(safe-area-inset-top, 0px)) 12px 6px 16px; }
  .diario-ver-top p { margin: 0; font: 600 13px/1.2 var(--f-display); letter-spacing: .12em; text-transform: uppercase; }
  .diario-ver-fig { margin: 0; min-height: 0; display: grid; grid-template-rows: minmax(0, 1fr) auto; gap: 8px; padding: 0 64px calc(16px + env(safe-area-inset-bottom, 0px)); touch-action: pan-y pinch-zoom; }
  .diario-ver-fig img { width: 100%; height: 100%; min-height: 0; object-fit: contain; }
  .diario-ver-fig figcaption { text-align: center; font: 15px/1.4 var(--f-body); }
  .diario-ver-fig figcaption:empty { display: none; }
  .diario-ver-b { all: unset; cursor: pointer; width: 44px; height: 44px; display: grid; place-items: center; border-radius: 50%; background: rgba(255, 255, 255, .14); color: #fff; }
  .diario-ver-b:hover { background: rgba(255, 255, 255, .26); }
  .diario-ver-b:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
  .diario-ver-b svg { width: 22px; height: 22px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
  .diario-ver-ant, .diario-ver-prox { position: absolute; top: 50%; margin-top: -22px; }
  .diario-ver-ant { left: 10px; }
  .diario-ver-prox { right: 10px; }
  /* seção do painel Preparar: título grande e linha em cima, como as vizinhas */
  #mod-diario { position: relative; display: grid; gap: 10px; min-width: 0; align-content: start; padding-top: 14px; border-top: 1px solid var(--panel-line); }
  #mod-diario p { margin: 0; }
  .diario-ph { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
  .diario-ph h3 { margin: 0; font: 700 19px/1.1 var(--f-display); letter-spacing: .04em; text-transform: uppercase; }
  .diario-num { font: 12.5px/1 var(--f-data); color: var(--ink-soft); white-space: nowrap; }
  .diario-num b { font: 700 22px/1 var(--f-display); color: var(--ink); }
  .diario-p { font-size: 14px; line-height: 1.45; }
  .diario-esp { font: 12.5px/1.45 var(--f-data); color: var(--ink-soft); }
  #mod-diario .btn--main { min-height: 44px; font-size: 14px; }
  #mod-diario .btn--main svg { width: 17px; height: 17px; }
  #mod-diario .diario-msg { font-size: 13px; line-height: 1.45; padding: 6px 10px; border-left: 3px solid var(--g-ok); border-radius: 0 6px 6px 0; background: color-mix(in srgb, var(--g-ok) 10%, transparent); }
  /* vazio: some da tela mas continua para o leitor de tela */
  #mod-diario .diario-msg:empty { position: absolute; width: 1px; height: 1px; padding: 0; border: 0; overflow: hidden; clip: rect(0 0 0 0); }
  @media (max-width: 700px) {
    .diario .diario-txt, .diario-leg { font-size: 16px; }   /* menos de 16 px faz o iPhone dar zoom */
    .diario-leg { min-height: 40px; }
    .diario-del { min-width: 40px; height: 40px; }
    /* setas embaixo (perto do polegar), numa faixa só delas: a legenda fica acima */
    .diario-ver-fig { padding: 0 8px calc(70px + env(safe-area-inset-bottom, 0px)); }
    .diario-ver:has(.diario-ver-prox[hidden]) .diario-ver-fig { padding-bottom: calc(12px + env(safe-area-inset-bottom, 0px)); }
    .diario-ver-ant, .diario-ver-prox { top: auto; bottom: calc(14px + env(safe-area-inset-bottom, 0px)); margin-top: 0; }
  }
  @media (prefers-reduced-motion: reduce) { .diario-mini img { transition: none; } }`;

// ---------- início ----------
export function iniciar(c) {
  if (ctx) return;   // já iniciado
  ctx = c; U = c.util;
  if (!document.getElementById('mod-diario-css')) {
    const st = document.createElement('style');
    st.id = 'mod-diario-css'; st.textContent = CSS;
    document.head.append(st);
  }
  arq = document.createElement('input');
  arq.type = 'file'; arq.accept = 'image/*'; arq.multiple = true;
  arq.id = 'diario-arq'; arq.className = 'sr-only'; arq.tabIndex = -1;
  arq.setAttribute('aria-hidden', 'true');
  arq.addEventListener('change', () => { const fs = [...(arq.files ?? [])]; arq.value = ''; if (fs.length && alvo) adicionarFotos(alvo, fs); });
  document.body.append(arq);
  montarVisor();

  // a ficha do dia é redesenhada a cada mudança: ouvintes por delegação
  const dia = document.getElementById('day');
  dia?.addEventListener('click', (e) => {
    const por = e.target.closest('[data-diario-por]');
    if (por) { escolherFotos(+por.dataset.diarioPor); return; }
    const v = e.target.closest('[data-diario-ver]');
    if (v) { abrirVisor(v.dataset.diarioVer); return; }
    const del = e.target.closest('[data-diario-del]');
    if (del) cliqueApagar(del.dataset.diarioDel);
  });
  dia?.addEventListener('input', (e) => {
    const t = e.target.closest('[data-diario-txt]');
    if (t) { aoDigitarNota(+t.dataset.diarioTxt, t.value); return; }
    const l = e.target.closest('[data-diario-leg]');
    if (l) aoDigitarLegenda(l.dataset.diarioLeg, l.value, l);
  });
  dia?.addEventListener('keydown', (e) => {   // Enter na legenda: pronto (fecha o teclado)
    if (e.key === 'Enter' && e.target.matches?.('[data-diario-leg]')) { e.preventDefault(); e.target.blur(); }
  });
  // lembra onde estava o cursor (para voltar a ele se a ficha for redesenhada)
  for (const ev of ['focusin', 'input', 'keyup', 'pointerup']) document.addEventListener(ev, (e) => { if (e.target?.dataset?.diarioFoco) lembrar(e.target); });
  document.addEventListener('selectionchange', () => { const a = document.activeElement; if (a?.dataset?.diarioFoco) lembrar(a); });
  document.addEventListener('focusout', (e) => {
    const el = e.target;
    if (!el?.dataset?.diarioFoco) return;
    gravarPendentes();
    // saiu de verdade (o campo continua na página)? esquece; se foi a ficha redesenhada, o foco volta
    queueMicrotask(() => { if (el.isConnected && foco?.chave === el.dataset.diarioFoco) foco = null; });
  });
  addEventListener('pagehide', gravarPendentes);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') gravarPendentes(); });

  pronto = carregar();
  ctx.registrar({
    blocoDia: { lugar: 'fim', html: htmlBloco },
    tagDia: (d) => (estado === 'pronto' && temAlgo(d.n) ? '<span class="tag" style="--c:var(--contour)">Diário</span>' : ''),
    aoRenderDia: () => restaurarFoco(),
    aoMostrarPainel: (nome) => { if (nome === 'preparar') renderPainel(); },
  });
  renderPainel();
}
