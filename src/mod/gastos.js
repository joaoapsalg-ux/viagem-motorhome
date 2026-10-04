// Gastos da viagem: lançar rápido (valor, moeda, categoria, dia, forma), resumo com câmbio e orçamento, bloco na ficha
// do dia, CSV e texto para compartilhar. Tudo fica só no aparelho (localStorage 'gastos.*'): o repositório é público,
// então nada de valores no código nem em data/.

const IC = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
// categorias (ordem fixa: é a ordem do formulário e do orçamento)
const CATS = [
  { id: 'combustivel', nome: 'Combustível', chip: 'Combustível', curto: 'Combustível', ic: IC('<path d="M4.5 20.5V5A1.5 1.5 0 0 1 6 3.5h6.5A1.5 1.5 0 0 1 14 5v15.5M3 20.5h12.5M7 8h5"/><path d="M14 9.5h1.5a1.5 1.5 0 0 1 1.5 1.5v4.5a1.5 1.5 0 0 0 3 0V8l-2.5-2.5"/>') },
  { id: 'camping', nome: 'Camping/hospedagem', chip: 'Camping / hospedagem', curto: 'Camping', ic: IC('<path d="M2.5 20h19M4.5 20 12 5.5 19.5 20M9.5 20l2.5-5.5 2.5 5.5M10 4l2 1.5L14 4"/>') },
  { id: 'mercado', nome: 'Mercado', chip: 'Mercado', curto: 'Mercado', ic: IC('<path d="M2.5 4h2.6l2.4 11.5h10.8L20.5 7H6.2"/><circle cx="9" cy="19.5" r="1.4"/><circle cx="17" cy="19.5" r="1.4"/>') },
  { id: 'restaurante', nome: 'Restaurante', chip: 'Restaurante', curto: 'Restaurante', ic: IC('<path d="M7 3v18M4.5 3v5a2.5 2.5 0 0 0 5 0V3M17 21V3c-2.2 0-3.5 2.5-3.5 6s1.3 4 3.5 4"/>') },
  { id: 'ingressos', nome: 'Ingressos/passeios', chip: 'Ingressos / passeios', curto: 'Ingressos', ic: IC('<path d="M3 7h18v3a2 2 0 0 0 0 4v3H3v-3a2 2 0 0 0 0-4Z"/><path d="M15 7v2.2M15 11v2M15 14.8V17"/>') },
  { id: 'pedagio', nome: 'Pedágio/estacionamento', chip: 'Pedágio / estac.', curto: 'Pedágio/estac.', ic: IC('<rect x="4" y="3.5" width="16" height="17" rx="3"/><path d="M10 16.5v-9h3a2.7 2.7 0 0 1 0 5.4h-3"/>') },
  { id: 'compras', nome: 'Compras', chip: 'Compras', curto: 'Compras', ic: IC('<path d="M5 8h14l-1 12.5H6Z"/><path d="M9 10.5V7a3 3 0 0 1 6 0v3.5"/>') },
  { id: 'outros', nome: 'Outros', chip: 'Outros', curto: 'Outros', ic: IC('<circle cx="6" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="18" cy="12" r="1.4"/>') },
];
const IC_MAIS = IC('<path d="M12 5v14M5 12h14"/>');
const IC_EDITAR = IC('<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16Z"/><path d="m13.5 6.5 4 4"/>');
const IC_APAGAR = IC('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>');
const IC_BAIXAR = IC('<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>');
const SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const CAMBIO_PADRAO = 5.10, EXTRA_PADRAO = 5;

const ESTILO = `
#mod-gastos { display: grid; gap: 14px; min-width: 0; }
.gastos-form { gap: 12px; }
.gastos-form.is-edit { border-color: var(--gold); box-shadow: 0 0 0 1px var(--gold) inset; }
.gastos-campo { display: grid; gap: 5px; min-width: 0; align-content: start; }
.gastos-rot { font: 600 11px/1.1 var(--f-display); letter-spacing: .12em; text-transform: uppercase; color: var(--ink-soft); margin: 0; }
.gastos-rot small { font: inherit; letter-spacing: .06em; text-transform: none; opacity: .85; }
.gastos-campo input, .gastos-campo select, .gastos-orc-l input { font: 16px/1.2 var(--f-body); color: var(--ink); background: var(--panel); border: 1px solid var(--panel-line); border-radius: 8px; padding: 9px 10px; min-height: 44px; box-sizing: border-box; width: 100%; min-width: 0; }
.gastos-campo input:focus-visible, .gastos-campo select:focus-visible, .gastos-orc-l input:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
#mod-gastos [aria-invalid="true"], .gastos-vbox:has([aria-invalid="true"]) { border-color: var(--g-alta); }
.gastos-valor { display: grid; grid-template-columns: minmax(0, 1fr) 112px; gap: 10px; align-items: end; }
.gastos-vbox { display: flex; align-items: center; gap: 8px; padding: 0 12px; min-height: 54px; border: 1px solid var(--panel-line); border-radius: 10px; background: var(--panel); box-sizing: border-box; cursor: text; }
.gastos-vbox:focus-within { border-color: var(--accent); box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 30%, transparent); }
.gastos-sim { font: 600 18px/1 var(--f-display); color: var(--ink-soft); }
.gastos-campo .gastos-vbox input { all: unset; flex: 1; min-width: 0; width: 100%; font: 500 26px/1.2 var(--f-data); color: var(--ink); padding: 8px 0; }
.gastos-vbox input::placeholder { color: color-mix(in srgb, var(--ink-soft) 65%, transparent); }
.gastos-form .seg2 label, .gastos-orc .seg2 label, .gastos-resumo .seg2 label { padding: 13px 4px; }
.gastos-form .gastos-moeda label { padding: 19px 4px; font-size: 14px; }
.gastos-fs { border: 0; margin: 0; padding: 0; min-width: 0; }
#mod-gastos .seg2 { position: relative; }   /* os rádios escondidos ficam dentro (o foco do teclado rola até eles) */
.gastos-fs > legend { padding: 0; margin: 0 0 6px; }
.gastos-chips { position: relative; display: grid; grid-template-columns: repeat(auto-fill, minmax(74px, 1fr)); gap: 6px; }
.gastos-chips input { position: absolute; opacity: 0; pointer-events: none; }
.gastos-chips label { cursor: pointer; display: grid; justify-items: center; align-content: center; gap: 4px; min-height: 60px; padding: 6px 3px; border-radius: 9px; border: 1px solid var(--panel-line); background: var(--panel); font: 600 12px/1.12 var(--f-body); text-align: center; color: var(--ink-soft); transition: border-color .15s, color .15s, background .15s; }
.gastos-chips label:hover { color: var(--ink); border-color: var(--accent); }
.gastos-chips svg, .gastos-ic svg, .gastos-ib svg, .gastos-blk .btn svg, #mod-gastos .btn svg { fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
.gastos-chips svg { width: 22px; height: 22px; }
.gastos-chips input:checked + label { color: var(--ink); border-color: var(--accent); background: color-mix(in srgb, var(--accent) 13%, var(--panel)); box-shadow: 0 0 0 1px var(--accent) inset; }
.gastos-chips input:checked + label svg { color: var(--accent); stroke-width: 2.1; }
.gastos-chips input:focus-visible + label { outline: 2px solid var(--accent); outline-offset: 1px; }
.gastos-fs.is-erro .gastos-chips label { border-color: var(--g-alta); }
.gastos-linha { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.gastos-form .btns .btn { min-height: 48px; font-size: 14.5px; }
.gastos-form .btns .btn--main { flex: 2; }
#gastos-erro:empty { display: none; }

.gastos-resumo { gap: 10px; }
.gastos-cab { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.gastos-cab .seg2 { width: 132px; flex: 0 0 auto; }
.gastos-tot { display: flex; flex-wrap: wrap; gap: 6px; }
.gastos-tot > div { flex: 1 1 118px; display: grid; gap: 3px; align-content: start; padding: 10px 8px; border-radius: var(--r); background: var(--panel); text-align: center; min-width: 0; }
.gastos-tot b { font: 700 21px/1.05 var(--f-display); letter-spacing: .02em; overflow-wrap: anywhere; }
.gastos-tot span { font-size: 11.5px; color: var(--ink-soft); line-height: 1.25; }
.gastos-sub { margin: 4px 0 0; font: 600 11px/1.3 var(--f-display); letter-spacing: .14em; text-transform: uppercase; color: var(--ink-soft); }
.gastos-orct { display: grid; gap: 5px; padding: 9px 10px; border-radius: var(--r); background: var(--panel); }
.gastos-orct p { margin: 0; font-size: 13.5px; display: flex; flex-wrap: wrap; justify-content: space-between; gap: 2px 10px; }
.gastos-orct p span { font: 12.5px var(--f-data); color: var(--ink-soft); }
.gastos-cl { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
.gastos-cr { display: grid; grid-template-columns: 30px minmax(0, 1fr); gap: 4px 10px; align-items: center; }
.gastos-cr > .gastos-ic { grid-row: 1 / span 3; align-self: start; }
.gastos-ct { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; font-size: 13.5px; line-height: 1.25; min-width: 0; }
.gastos-ct b { font-weight: 600; }
.gastos-ct span { font: 12.5px var(--f-data); white-space: nowrap; }
.gastos-tr { position: relative; display: flex; height: 8px; border-radius: 4px; background: color-mix(in srgb, var(--ink) 9%, transparent); }
.gastos-tr span { display: block; height: 100%; border-radius: 4px; box-sizing: border-box; }
.gastos-tr .f { background: var(--accent); }
.gastos-tr .x { background: var(--g-alta); border-left: 2px solid var(--tile); border-radius: 0 4px 4px 0; }
.gastos-tr .f:not(:last-child) { border-radius: 4px 0 0 4px; }
.gastos-tr i { position: absolute; top: -3px; bottom: -3px; width: 2px; margin-left: -1px; border-radius: 1px; background: var(--ink); }
.gastos-orct .gastos-tr .x { border-left-color: var(--panel); }
.gastos-cn { font-size: 12px; color: var(--ink-soft); line-height: 1.3; }
.gastos-cn.is-over, .gastos-orct .is-over { color: var(--g-alta); }
.gastos-cn b, .gastos-orct b { font-weight: 600; }
.gastos-dg { display: grid; gap: 2px; }
.gastos-da { position: relative; display: grid; grid-auto-flow: column; grid-auto-columns: minmax(0, 1fr); gap: 2px; height: 76px; border-bottom: 1px solid var(--panel-line); }
.gastos-dcol { all: unset; cursor: pointer; position: relative; display: flex; align-items: flex-end; justify-content: center; min-width: 0; border-radius: 4px 4px 0 0; }
.gastos-dcol:hover, .gastos-dcol[aria-pressed="true"] { background: color-mix(in srgb, var(--ink) 7%, transparent); }
.gastos-dcol:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.gastos-dcol span { display: block; width: 72%; max-width: 20px; border-radius: 4px 4px 0 0; background: var(--c); }
.gastos-dmed { position: absolute; left: 0; right: 0; height: 0; border-top: 2px dashed color-mix(in srgb, var(--ink) 55%, transparent); pointer-events: none; }
.gastos-dn { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(0, 1fr); gap: 2px; font: 10.5px/1.2 var(--f-data); color: var(--ink-soft); text-align: center; }
.gastos-dn .is-hoje { color: var(--ink); font-weight: 600; text-decoration: underline; text-decoration-color: var(--gold); text-decoration-thickness: 2px; }
.gastos-dcap { min-height: 2.6em; }

.gastos-lanc { gap: 8px; }
.gastos-dia-g { display: grid; gap: 2px; }
.gastos-dia-h { margin: 4px 0 0; display: flex; justify-content: space-between; align-items: baseline; gap: 8px; padding-bottom: 3px; border-bottom: 1px solid var(--panel-line); font: 600 11px/1.3 var(--f-display); letter-spacing: .1em; text-transform: uppercase; color: var(--ink-soft); }
.gastos-dia-h b { font: 500 12.5px var(--f-data); letter-spacing: 0; text-transform: none; color: var(--ink); white-space: nowrap; }
.gastos-itens { list-style: none; margin: 0; padding: 0; display: grid; }
.gastos-item { display: grid; grid-template-columns: 30px minmax(0, 1fr) auto 40px 40px; gap: 4px 8px; align-items: center; padding: 3px 0; border-radius: 8px; }
.gastos-item.is-edit { background: color-mix(in srgb, var(--gold) 14%, transparent); }
.gastos-item.is-flash { animation: gastos-flash 1.4s ease-out; }
@keyframes gastos-flash { 0%, 30% { background: color-mix(in srgb, var(--accent) 22%, transparent); } 100% { background: transparent; } }
.gastos-ic { width: 30px; height: 30px; border-radius: 8px; display: grid; place-items: center; font-style: normal; background: color-mix(in srgb, var(--accent) 13%, transparent); color: var(--accent); flex: 0 0 auto; }
.gastos-ic svg { width: 18px; height: 18px; }
.gastos-it { display: grid; gap: 1px; min-width: 0; }
.gastos-it b { font: 600 14px/1.25 var(--f-body); overflow-wrap: anywhere; }
.gastos-it small { font: 12px/1.3 var(--f-body); color: var(--ink-soft); overflow-wrap: anywhere; }
.gastos-iv small { font: 11.5px/1.3 var(--f-data); color: var(--ink-soft); white-space: nowrap; }
.gastos-iv { display: grid; justify-items: end; gap: 1px; }
.gastos-iv b { font: 500 14px/1.2 var(--f-data); white-space: nowrap; }
.gastos-ib { all: unset; cursor: pointer; width: 40px; height: 40px; display: grid; place-items: center; border-radius: 8px; color: var(--ink-soft); }
.gastos-ib:hover { color: var(--accent); background: color-mix(in srgb, var(--accent) 10%, transparent); }
.gastos-ib[data-gastos-apagar]:hover { color: var(--g-alta); background: color-mix(in srgb, var(--g-alta) 10%, transparent); }
.gastos-ib:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
.gastos-ib svg { width: 18px; height: 18px; }

.gastos-efet { margin: 0; font: 500 13px/1.4 var(--f-data); color: var(--ink); }
.gastos-orc > summary { cursor: pointer; list-style: none; display: flex; align-items: center; gap: 6px; min-height: 40px; font: 600 11px/1 var(--f-display); letter-spacing: .14em; text-transform: uppercase; color: var(--ink-soft); }
.gastos-orc > summary::-webkit-details-marker { display: none; }
.gastos-orc > summary::after { margin-left: auto; content: '+'; font: 600 18px/1 var(--f-display); color: var(--accent); }
.gastos-orc[open] > summary::after { content: '−'; }
.gastos-orc > summary:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; border-radius: 4px; }
.gastos-orc > summary small { font: inherit; letter-spacing: .06em; text-transform: none; }
.gastos-orc-c { display: grid; gap: 10px; margin-top: 8px; }
.gastos-orc-cats { display: grid; gap: 6px; }
.gastos-orc-l { display: grid; grid-template-columns: 30px minmax(0, 1fr) 118px; gap: 10px; align-items: center; font-size: 14px; }
.gastos-msg { margin: 0; font-size: 12.5px; color: var(--accent); }
.gastos-msg:empty { display: none; }
.gastos-msg textarea { display: block; width: 100%; box-sizing: border-box; min-height: 140px; margin-top: 6px; font: 12px/1.4 var(--f-data); color: var(--ink); background: var(--panel); border: 1px solid var(--panel-line); border-radius: 6px; padding: 6px; }

.gastos-barra { position: sticky; bottom: 10px; z-index: 2; display: flex; align-items: center; gap: 10px; padding: 6px 6px 6px 14px; border-radius: 10px; background: var(--ink); color: var(--panel); box-shadow: var(--shadow); }
.gastos-barra p { margin: 0; flex: 1; min-width: 0; font-size: 13.5px; line-height: 1.35; }
.gastos-barra button { all: unset; cursor: pointer; flex: 0 0 auto; min-height: 40px; padding: 0 12px; border-radius: 8px; border: 1px solid color-mix(in srgb, var(--panel) 45%, transparent); font: 600 13px/40px var(--f-display); letter-spacing: .08em; text-transform: uppercase; }
.gastos-barra button:hover { background: color-mix(in srgb, var(--panel) 14%, transparent); }
.gastos-barra button:focus-visible { outline: 2px solid var(--gold); outline-offset: 2px; }

.gastos-blk-tot { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 10px; }
.gastos-blk-tot b { font: 700 22px/1.1 var(--f-display); letter-spacing: .02em; }
.gastos-blk-tot span { font: 12.5px var(--f-data); color: var(--ink-soft); }
.gastos-blk .btn { justify-self: start; min-height: 40px; }
.gastos-blk .btn svg { width: 15px; height: 15px; stroke-width: 2.2; }
.gastos-blk-mais summary { cursor: pointer; font: 600 11.5px/1 var(--f-display); letter-spacing: .1em; text-transform: uppercase; color: var(--accent); padding: 14px 0; min-height: 40px; box-sizing: border-box; }
.gastos-blk-mais summary:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 3px; }
.gastos-blk-mais ul { list-style: none; margin: 6px 0 0; padding: 0; display: grid; gap: 4px; }
.gastos-blk-mais li { display: grid; grid-template-columns: 26px minmax(0, 1fr) auto; gap: 8px; align-items: center; font-size: 13.5px; }
.gastos-blk-mais li b { font: 500 13px var(--f-data); white-space: nowrap; }
.gastos-blk-mais .gastos-ic { width: 26px; height: 26px; border-radius: 7px; }
.gastos-blk-mais .gastos-ic svg { width: 16px; height: 16px; }

@media (max-width: 700px) {
  .gastos-orc-l { grid-template-columns: 30px minmax(0, 1fr) 108px; }
}
@media (max-width: 360px) {
  .gastos-linha { grid-template-columns: minmax(0, 1fr); }
}
@media (prefers-reduced-motion: reduce) {
  .gastos-item.is-flash { animation: none; }
}
`;

export function iniciar(ctx) {
  const { $, store, nf, fmtData, fmtDia, esc, ICONE, corDia, reduzMovimento } = ctx.util;
  const N = ctx.dias.length, VOLTA = N + 1, FIM = ctx.dados.roteiro.fim.data;
  const CAT = Object.fromEntries(CATS.map((c) => [c.id, c]));

  if (!document.getElementById('mod-gastos-css')) {
    const st = document.createElement('style');
    st.id = 'mod-gastos-css';   // o id "mod-gastos" fica para a seção do painel
    st.textContent = ESTILO;
    document.head.append(st);
  }

  // ---------- guardado no aparelho ----------
  const ler = (k, padrao) => { try { return JSON.parse(store.get(k) ?? 'null') ?? padrao; } catch { return padrao; } };
  // o store engole o erro (armazenamento cheio ou bloqueado): confere o que ficou e avisa uma vez
  let falhou = false;
  const gravar = (k, v) => {
    const s = JSON.stringify(v);
    store.set(k, s);
    const ok = store.get(k) === s;
    if (!ok && !falhou) ctx.aviso('Não deu para guardar os gastos neste aparelho (armazenamento cheio ou bloqueado). Baixe o CSV para não perder.');
    falhou = !ok;
  };
  const novoId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const r2 = (v) => Math.round(v * 100) / 100;
  const valido = (g) => g && typeof g === 'object' && Number.isFinite(g.valor) && g.valor > 0 && !!CAT[g.cat] && Number.isInteger(g.dia) && g.dia >= 0 && g.dia <= VOLTA;
  function lerLista() {
    const a = ler('gastos.lista', []);
    if (!Array.isArray(a)) return [];
    return a.filter(valido).map((g) => ({
      id: String(g.id ?? novoId()), valor: g.valor, moeda: g.moeda === 'BRL' ? 'BRL' : 'USD', cat: g.cat, dia: g.dia,
      desc: String(g.desc ?? '').slice(0, 80), forma: g.forma === 'dinheiro' ? 'dinheiro' : 'cartao', em: Number(g.em) || Date.now(),
    }));
  }
  function lerCambio() {
    const c = ler('gastos.cambio', {});
    return {
      comercial: Number.isFinite(c?.comercial) && c.comercial > 0 && c.comercial < 100 ? c.comercial : CAMBIO_PADRAO,
      extra: Number.isFinite(c?.extra) && c.extra >= 0 && c.extra < 50 ? c.extra : EXTRA_PADRAO,
    };
  }
  function lerOrc() {
    const o = ler('gastos.orcamento', {}), cat = {};
    for (const c of CATS) if (Number.isFinite(o?.cat?.[c.id]) && o.cat[c.id] > 0) cat[c.id] = o.cat[c.id];
    return { moeda: o?.moeda === 'BRL' ? 'BRL' : 'USD', total: Number.isFinite(o?.total) && o.total > 0 ? o.total : null, cat };
  }
  let lista = lerLista();
  let cambio = lerCambio();
  let orc = lerOrc();
  let ver = store.get('gastos.ver') === 'BRL' ? 'BRL' : 'USD';   // moeda do resumo
  const salvarLista = () => gravar('gastos.lista', lista);

  // ---------- números ----------
  /** "1.234,56", "1234.56", "45,9", "US$ 12" → número (null se não der) */
  function lerNumero(s) {
    let t = String(s ?? '').replace(/US\$|R\$|\s|\u00a0/gi, '');
    if (!t) return null;
    const v = t.lastIndexOf(','), p = t.lastIndexOf('.');
    if (v >= 0 && p >= 0) t = v > p ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');
    else if (v >= 0) t = t.replace(/,(?=.*,)/g, '').replace(',', '.');
    else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');   // "1.234" = mil duzentos e trinta e quatro
    t = t.replace(/\.$/, '');   // "5," no meio da digitação vale 5
    if (!/^-?\d*\.?\d+$/.test(t)) return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  }
  const efetivo = () => cambio.comercial * (1 + cambio.extra / 100);
  // gasto em US$ vira R$ pelo câmbio efetivo (com IOF e spread); gasto em R$ vira US$ pelo comercial
  const emUSD = (g) => (g.moeda === 'USD' ? g.valor : g.valor / cambio.comercial);
  const emBRL = (g) => (g.moeda === 'BRL' ? g.valor : g.valor * efetivo());
  const naVista = (g) => (ver === 'USD' ? emUSD(g) : emBRL(g));
  const orcNaVista = (v) => (orc.moeda === ver ? v : ver === 'BRL' ? v * efetivo() : v / efetivo());
  const soma = (gs, f) => gs.reduce((s, g) => s + f(g), 0);
  const din = (v, m = ver) => `${m === 'BRL' ? 'R$' : 'US$'}\u00a0${nf(v, 2)}`;   // sem quebra entre o símbolo e o número
  const fmtNum = (v, d = 2) => (v == null ? '' : nf(v, d));
  const plural = (k, um, varios) => (k === 1 ? `1 ${um}` : `${k} ${varios}`);
  // texto escapado que pode quebrar depois da barra ("Pedágio/estacionamento" não quebra no meio da palavra)
  const quebra = (s) => esc(s).replace(/\//g, '/<wbr>');

  // ---------- dias ----------
  // hoje calculado na hora (o ctx.HOJE é da abertura; o app pode ficar aberto depois da meia-noite)
  const hoje = () => { const d = new Date(), p = (x) => String(x).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
  const diaHoje = () => { const h = hoje(); return ctx.dias.find((d) => d.data === h)?.n ?? null; };
  const dataDoDia = (n) => (n === 0 ? null : n === VOLTA ? FIM : ctx.diaPorN.get(n)?.data);
  function semanaDe(iso) { const [y, m, d] = iso.split('-').map(Number); return SEMANA[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]; }
  /** "Antes da viagem", "Dia 3 · qua 21/10 · Grand Canyon", "Volta · dom 01/11" */
  function rotuloDia(n, curto = false) {
    if (n === 0) return 'Antes da viagem';
    const iso = dataDoDia(n);
    if (n === VOLTA) return `Volta · ${fmtData(iso, semanaDe(iso))}`;
    const d = ctx.diaPorN.get(n), base = `Dia ${n} · ${fmtData(iso, d.semana)}`;
    return curto ? base : `${base} · ${ctx.ativo(d).para}`;
  }
  /** dia padrão do formulário: hoje (na viagem), senão o dia aberto no app, senão "antes da viagem" */
  function diaPadrao() {
    const dh = diaHoje();
    if (dh) return dh;
    if (hoje() === FIM) return VOLTA;
    return ctx.diaAberto() ?? 0;
  }
  /** média por dia de viagem (dias 1 a N, sem "antes" e "volta") */
  function media() {
    const daViagem = lista.filter((g) => g.dia >= 1 && g.dia <= N);
    if (!daViagem.length) return null;
    const comGasto = daViagem.map((g) => g.dia);
    let k, viagem = true;
    const dh = diaHoje();
    if (hoje() > ctx.dias[N - 1].data) k = N;
    else if (dh) k = Math.max(dh, ...comGasto);
    else { k = new Set(comGasto).size; viagem = false; }
    return { v: soma(daViagem, naVista) / k, k, viagem };
  }
  const rotuloMedia = (m) => (m.viagem ? `média por dia (dias 1 a ${m.k})` : `média dos ${plural(m.k, 'dia', 'dias')} com gastos`);

  // ---------- bloco na ficha do dia ----------
  let blocoAberto = false;   // "ver os lançamentos" aberto (sobrevive ao redesenho do bloco)
  function htmlBloco(d) {
    const gs = lista.filter((g) => g.dia === d.n).sort((a, b) => a.em - b.em);
    const itens = gs.map((g) => `<li><i class="gastos-ic" aria-hidden="true">${CAT[g.cat].ic}</i><span>${quebra(g.desc || CAT[g.cat].nome)}</span><b>${din(g.valor, g.moeda)}</b></li>`).join('');
    return `<section class="blk gastos-blk" id="gastos-blk"><h3>Gastos do dia <span>${gs.length ? plural(gs.length, 'lançamento', 'lançamentos') : ''}</span></h3>
      <p class="gastos-blk-tot"><b>${din(soma(gs, emUSD), 'USD')}</b><span>${gs.length ? `≈ ${din(soma(gs, emBRL), 'BRL')} com IOF e spread` : 'nada lançado neste dia'}</span></p>
      ${gs.length ? `<details class="gastos-blk-mais"${blocoAberto ? ' open' : ''}><summary>Ver ${gs.length === 1 ? 'o lançamento' : `os ${gs.length} lançamentos`}</summary><ul>${itens}</ul></details>` : ''}
      <button type="button" class="btn btn--small" data-gastos-lancar="${d.n}">${IC_MAIS}Lançar gasto neste dia</button></section>`;
  }
  function atualizarBloco() {
    const el = document.getElementById('gastos-blk'), n = ctx.diaAberto();
    if (el && n) el.outerHTML = htmlBloco(ctx.diaPorN.get(n));
  }
  const fichas = new WeakSet();   // #day com o ouvinte já posto (a ficha é redesenhada, o contêiner fica)
  function cliqueFicha(e) {
    const b = e.target.closest('[data-gastos-lancar]');
    if (b) lancarNoDia(+b.dataset.gastosLancar);
  }
  function toggleFicha(e) { if (e.target.matches?.('.gastos-blk-mais')) blocoAberto = e.target.open; }

  // ---------- painel ----------
  const painel = document.getElementById('painel-gastos');
  let sec = null, editando = null, diaPedido = null;
  const q = (s) => sec.querySelector(s);

  function htmlPainel() {
    const chips = CATS.map((c) => `<input type="radio" name="gastos-cat" id="gastos-c-${c.id}" value="${c.id}"><label for="gastos-c-${c.id}" title="${c.nome}">${c.ic}<span aria-hidden="true">${c.chip}</span><span class="sr-only">${c.nome}</span></label>`).join('');
    const orcCats = CATS.map((c) => `<label class="gastos-orc-l" for="gastos-o-${c.id}"><i class="gastos-ic" aria-hidden="true">${c.ic}</i><span>${c.nome}</span><input id="gastos-o-${c.id}" data-gastos-orc="${c.id}" type="text" inputmode="decimal" autocomplete="off" placeholder="—"></label>`).join('');
    const seg = (nome, l, [a, ta], [b, tb], extra = '') => `<div class="seg2${extra}" role="radiogroup" aria-labelledby="${l}">
        <input type="radio" name="${nome}" id="${nome}-${a}" value="${a}"><label for="${nome}-${a}">${ta}</label>
        <input type="radio" name="${nome}" id="${nome}-${b}" value="${b}"><label for="${nome}-${b}">${tb}</label></div>`;
    return `
    <form class="group gastos-form" id="gastos-form" novalidate aria-labelledby="gastos-form-h">
      <h3 class="group-h" id="gastos-form-h">Lançar gasto</h3>
      <div class="gastos-valor">
        <label class="gastos-campo" for="gastos-valor"><span class="gastos-rot">Valor</span>
          <span class="gastos-vbox"><span class="gastos-sim" id="gastos-sim" aria-hidden="true">US$</span><input id="gastos-valor" type="text" inputmode="decimal" autocomplete="off" enterkeyhint="done" placeholder="0,00" aria-describedby="gastos-erro"></span></label>
        <div class="gastos-campo"><span class="gastos-rot" id="gastos-moeda-l">Moeda</span>${seg('gastos-moeda', 'gastos-moeda-l', ['USD', 'US$'], ['BRL', 'R$'], ' gastos-moeda')}</div>
      </div>
      <fieldset class="gastos-fs" id="gastos-fs-cat"><legend class="gastos-rot">Categoria</legend><div class="gastos-chips">${chips}</div></fieldset>
      <label class="gastos-campo" for="gastos-desc"><span class="gastos-rot">Descrição <small>(opcional)</small></span><input id="gastos-desc" type="text" maxlength="80" autocomplete="off" enterkeyhint="done" placeholder="ex.: diesel em Kingman"></label>
      <div class="gastos-linha">
        <label class="gastos-campo" for="gastos-dia"><span class="gastos-rot">Dia</span><select id="gastos-dia"></select></label>
        <div class="gastos-campo"><span class="gastos-rot" id="gastos-forma-l">Forma</span>${seg('gastos-forma', 'gastos-forma-l', ['cartao', 'Cartão'], ['dinheiro', 'Dinheiro'])}</div>
      </div>
      <p class="cc-warn" id="gastos-erro" role="alert"></p>
      <div class="btns"><button type="submit" class="btn btn--main" id="gastos-ok">${IC_MAIS}Lançar</button><button type="button" class="btn" id="gastos-cancelar" hidden>Cancelar</button></div>
    </form>
    <div class="group gastos-resumo">
      <div class="gastos-cab"><h3 class="group-h" id="gastos-resumo-h">Resumo</h3><span class="sr-only" id="gastos-ver-l">Mostrar o resumo em</span>${seg('gastos-ver', 'gastos-ver-l', ['USD', 'Em US$'], ['BRL', 'Em R$'])}</div>
      <div id="gastos-totais"></div>
      <div id="gastos-por-cat"></div>
      <div id="gastos-por-dia"></div>
    </div>
    <div class="group gastos-lanc">
      <h3 class="group-h" id="gastos-lanc-h">Lançamentos <span id="gastos-n"></span></h3>
      <div id="gastos-lista"></div>
    </div>
    <fieldset class="group">
      <legend>Câmbio</legend>
      <div class="gastos-linha">
        <label class="gastos-campo" for="gastos-cambio"><span class="gastos-rot">Comercial (R$ por US$)</span><input id="gastos-cambio" type="text" inputmode="decimal" autocomplete="off"></label>
        <label class="gastos-campo" for="gastos-extra"><span class="gastos-rot">IOF + spread (%)</span><input id="gastos-extra" type="text" inputmode="decimal" autocomplete="off"></label>
      </div>
      <p class="gastos-efet" id="gastos-efet" aria-live="polite"></p>
      <p class="hint">O câmbio comercial é o do jornal. No cartão (e na compra de dólar em espécie) entram o IOF, de 3,5%, e o spread do banco: +5% é uma estimativa. Quando a fatura chegar, ajuste para bater com ela. Gastos lançados em R$ viram US$ pelo câmbio comercial.</p>
    </fieldset>
    <details class="group gastos-orc" id="gastos-orc">
      <summary>Orçamento <small>(opcional)</small></summary>
      <div class="gastos-orc-c">
        <div class="gastos-linha">
          <label class="gastos-campo" for="gastos-orc-total"><span class="gastos-rot">Total da viagem</span><input id="gastos-orc-total" type="text" inputmode="decimal" autocomplete="off" placeholder="sem orçamento"></label>
          <div class="gastos-campo"><span class="gastos-rot" id="gastos-om-l">Moeda do orçamento</span>${seg('gastos-om', 'gastos-om-l', ['USD', 'US$'], ['BRL', 'R$'])}</div>
        </div>
        <p class="gastos-rot">Por categoria</p>
        <div class="gastos-orc-cats">${orcCats}</div>
        <p class="hint">Deixe em branco o que não quiser acompanhar. O resumo mostra quanto falta ou quanto passou. Fica só neste aparelho.</p>
      </div>
    </details>
    <div class="group">
      <h3 class="group-h" id="gastos-exp-h">Exportar</h3>
      <div class="btns"><button type="button" class="btn" id="gastos-csv">${IC_BAIXAR}Baixar CSV</button><button type="button" class="btn" id="gastos-texto">${ICONE.compartilhar}Compartilhar resumo</button></div>
      <p class="gastos-msg" id="gastos-msg" role="status"></p>
      <p class="hint">O CSV usa ponto e vírgula e vírgula decimal: abre direto no Excel em português.</p>
    </div>
    <p class="cc-note">Os gastos ficam só neste aparelho e não vão para a internet; cada celular tem a sua lista. Baixe o CSV de vez em quando para ter uma cópia. Os valores convertidos são estimativas pelo câmbio acima.</p>
    <div class="gastos-barra" id="gastos-barra" hidden><p id="gastos-barra-txt"></p><button type="button" id="gastos-desfazer">Desfazer</button></div>`;
  }

  // ---------- resumo ----------
  /** barra horizontal: parte dentro do orçamento, parte que passou e o traço do orçamento */
  function trilho(v, meta, escala) {
    const pc = (x) => `${Math.max(0, Math.min(100, (x / escala) * 100)).toFixed(1)}%`;
    const dentro = meta > 0 ? Math.min(v, meta) : v, fora = meta > 0 ? Math.max(0, v - meta) : 0;
    return `<div class="gastos-tr" aria-hidden="true"><span class="f" style="width:${pc(dentro)}"></span>${fora > 0 ? `<span class="x" style="width:${pc(fora)}"></span>` : ''}${meta > 0 ? `<i style="left:${pc(meta)}"></i>` : ''}</div>`;
  }
  const textoMeta = (v, meta) => (v <= meta ? `faltam ${din(meta - v)}` : `<b>passou ${din(v - meta)}</b>`);
  function htmlTotais() {
    if (!lista.length) return '<p class="hint">Nenhum gasto lançado ainda. Digite o valor, toque na categoria e em Lançar.</p>';
    const m = media();
    const cartao = soma(lista.filter((g) => g.forma === 'cartao'), naVista), dinheiro = soma(lista.filter((g) => g.forma === 'dinheiro'), naVista);
    let h = `<div class="gastos-tot">
        <div><b>${din(soma(lista, emUSD), 'USD')}</b><span>total em dólar</span></div>
        <div><b>${din(soma(lista, emBRL), 'BRL')}</b><span>total em real, com IOF e spread (estimado)</span></div>
        ${m ? `<div><b>${din(m.v)}</b><span>${rotuloMedia(m)}</span></div>` : ''}
      </div>
      <p class="hint">${plural(lista.length, 'lançamento', 'lançamentos')} · no cartão ${din(cartao)} · em dinheiro ${din(dinheiro)}</p>`;
    if (orc.total) {
      const meta = orcNaVista(orc.total), t = soma(lista, naVista);
      h += `<div class="gastos-orct"><p><b>Orçamento da viagem</b><span>${din(t)} de ${din(meta)} · ${nf((t / meta) * 100, 0)}%</span></p>
        ${trilho(t, meta, Math.max(t, meta))}
        <p class="${t > meta ? 'is-over' : ''}">${textoMeta(t, meta)}${orc.moeda !== ver ? ` <span>(orçamento em ${orc.moeda === 'BRL' ? 'R$' : 'US$'}, convertido)</span>` : ''}</p></div>`;
    }
    return h;
  }
  function htmlCats() {
    const tot = soma(lista, naVista);
    const linhas = CATS.map((c) => ({ c, v: soma(lista.filter((g) => g.cat === c.id), naVista), meta: orc.cat[c.id] ? orcNaVista(orc.cat[c.id]) : 0 }))
      .filter((x) => x.v > 0 || x.meta > 0).sort((a, b) => b.v - a.v || b.meta - a.meta);
    if (!linhas.length) return '';
    const escala = Math.max(...linhas.map((x) => Math.max(x.v, x.meta)));
    return `<h4 class="gastos-sub">Por categoria</h4><ul class="gastos-cl">${linhas.map((x) => `<li class="gastos-cr">
        <i class="gastos-ic" aria-hidden="true">${x.c.ic}</i>
        <div class="gastos-ct"><b>${x.c.nome}</b><span>${din(x.v)}${tot ? ` · ${nf((x.v / tot) * 100, 0)}%` : ''}</span></div>
        ${trilho(x.v, x.meta, escala)}
        ${x.meta ? `<small class="gastos-cn${x.v > x.meta ? ' is-over' : ''}">orçamento ${din(x.meta)} · ${textoMeta(x.v, x.meta)}</small>` : ''}</li>`).join('')}</ul>`;
  }
  let colunas = [];   // valores das barras por dia (para a legenda ao tocar)
  function htmlDias() {
    if (!lista.length) return '';
    colunas = [];
    for (let n = 0; n <= VOLTA; n++) {
      const gs = lista.filter((g) => g.dia === n);
      if ((n === 0 || n === VOLTA) && !gs.length) continue;
      colunas.push({ n, v: soma(gs, naVista), k: gs.length });
    }
    const max = Math.max(...colunas.map((c) => c.v)) || 1, m = media(), dh = diaHoje();
    const rot = (c) => (c.n === 0 ? 'A' : c.n === VOLTA ? 'V' : String(c.n));
    const barras = colunas.map((c) => `<button type="button" class="gastos-dcol" data-gastos-dcol="${c.n}" aria-pressed="false" aria-label="${esc(rotuloDia(c.n, true))}: ${din(c.v)}" title="${esc(rotuloDia(c.n, true))}: ${din(c.v)}">${c.v > 0 ? `<span style="height:${Math.max(3, (c.v / max) * 100).toFixed(1)}%;--c:${c.n === 0 || c.n === VOLTA ? 'var(--ink-soft)' : corDia(c.n)}"></span>` : ''}</button>`).join('');
    const maior = colunas.reduce((a, b) => (b.v > a.v ? b : a));
    return `<h4 class="gastos-sub">Por dia</h4>
      <div class="gastos-dg">
        <div class="gastos-da" role="group" aria-label="Gastos por dia">${barras}${m ? `<i class="gastos-dmed" style="bottom:${((m.v / max) * 100).toFixed(1)}%" aria-hidden="true"></i>` : ''}</div>
        <div class="gastos-dn" aria-hidden="true">${colunas.map((c) => `<span${c.n === dh ? ' class="is-hoje"' : ''}>${rot(c)}</span>`).join('')}</div>
      </div>
      <p class="hint gastos-dcap" id="gastos-dcap" aria-live="polite">${legendaPadrao(maior, m)}</p>`;
  }
  const legendaPadrao = (maior, m) => `Maior: ${esc(rotuloDia(maior.n, true))}, ${din(maior.v)}.${m ? ' Tracejado: média por dia.' : ''} Toque numa barra para ver o valor.`;
  function legendaDia(n) {
    const c = colunas.find((x) => x.n === n), cap = q('#gastos-dcap');
    if (!c || !cap) return;
    cap.textContent = `${rotuloDia(n)}: ${din(c.v)} em ${plural(c.k, 'lançamento', 'lançamentos')}.`;
    sec.querySelectorAll('[data-gastos-dcol]').forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.gastosDcol === n)));
  }

  // ---------- lista dos lançamentos ----------
  function htmlItem(g) {
    const c = CAT[g.cat], titulo = g.desc || c.nome;
    const outro = g.moeda === 'USD' ? din(emBRL(g), 'BRL') : din(emUSD(g), 'USD');
    const nome = esc(`${titulo}, ${din(g.valor, g.moeda)}`);
    return `<li class="gastos-item${editando === g.id ? ' is-edit' : ''}" id="gastos-i-${esc(g.id)}">
      <i class="gastos-ic" aria-hidden="true">${c.ic}</i>
      <div class="gastos-it"><b>${quebra(titulo)}</b><small>${g.desc ? `${c.curto} · ` : ''}${g.forma === 'dinheiro' ? 'dinheiro' : 'cartão'}</small></div>
      <div class="gastos-iv"><b>${din(g.valor, g.moeda)}</b><small>≈ ${outro}</small></div>
      <button type="button" class="gastos-ib" data-gastos-editar="${esc(g.id)}" aria-label="Editar: ${nome}" title="Editar">${IC_EDITAR}</button>
      <button type="button" class="gastos-ib" data-gastos-apagar="${esc(g.id)}" aria-label="Apagar: ${nome}" title="Apagar">${IC_APAGAR}</button></li>`;
  }
  function htmlLista() {
    if (!lista.length) return '<p class="hint">Os gastos lançados aparecem aqui, separados por dia, com botões para editar e apagar.</p>';
    const ds = [...new Set(lista.map((g) => g.dia))].sort((a, b) => b - a);   // o dia mais recente em cima
    return ds.map((n) => {
      const gs = lista.filter((g) => g.dia === n).sort((a, b) => b.em - a.em);
      return `<div class="gastos-dia-g"><h4 class="gastos-dia-h"><span>${esc(rotuloDia(n))}</span><b>${din(soma(gs, naVista))}</b></h4>
        <ul class="gastos-itens">${gs.map(htmlItem).join('')}</ul></div>`;
    }).join('');
  }

  /** redesenha o que depende da lista, do câmbio e do orçamento (o formulário e os campos ficam) */
  function desenhar() {
    if (sec) {
      q('#gastos-totais').innerHTML = htmlTotais();
      q('#gastos-por-cat').innerHTML = htmlCats();
      q('#gastos-por-dia').innerHTML = htmlDias();
      q('#gastos-lista').innerHTML = htmlLista();
      q('#gastos-n').textContent = lista.length ? String(lista.length) : '';
      q('#gastos-efet').textContent = `Câmbio efetivo: R$ ${nf(efetivo(), 2)} por US$ (${nf(cambio.comercial, 2)} + ${nf(cambio.extra, cambio.extra % 1 ? 1 : 0)}%).`;
    }
    atualizarBloco();
  }

  // ---------- formulário ----------
  function opcoesDia() {
    const sel = q('#gastos-dia'), atual = sel.value, dh = diaHoje(), H = hoje();
    const ops = [0, ...ctx.dias.map((d) => d.n), VOLTA].map((n) => {
      const ehHoje = (n === dh) || (n === VOLTA && H === FIM);
      return `<option value="${n}">${esc(rotuloDia(n))}${ehHoje ? ' (hoje)' : ''}</option>`;
    });
    sel.innerHTML = ops.join('');
    if (atual !== '') sel.value = atual;
  }
  const marcar = (nome, valor) => { const r = q(`input[name="${nome}"][value="${valor}"]`); if (r) r.checked = true; };
  const escolhido = (nome) => q(`input[name="${nome}"]:checked`)?.value;
  function mostrarMoeda() { q('#gastos-sim').textContent = escolhido('gastos-moeda') === 'BRL' ? 'R$' : 'US$'; }
  function limparErro() {
    q('#gastos-erro').textContent = '';
    q('#gastos-valor').removeAttribute('aria-invalid');
    q('#gastos-fs-cat').classList.remove('is-erro');
  }
  function erro(msg, el) {
    const p = q('#gastos-erro');
    p.textContent = msg;
    if (el.matches('input[type="text"]')) el.setAttribute('aria-invalid', 'true'); else q('#gastos-fs-cat').classList.add('is-erro');
    el.focus();
  }
  /** volta o formulário para "lançar" (valor, descrição e categoria em branco; moeda, forma e dia ficam) */
  function limparForm() {
    editando = null;
    q('#gastos-valor').value = ''; q('#gastos-desc').value = '';
    sec.querySelectorAll('input[name="gastos-cat"]').forEach((r) => { r.checked = false; });
    q('#gastos-form').classList.remove('is-edit');
    q('#gastos-form-h').textContent = 'Lançar gasto';
    q('#gastos-ok').innerHTML = `${IC_MAIS}Lançar`;
    q('#gastos-cancelar').hidden = true;
    limparErro();
  }
  function editar(id) {
    const g = lista.find((x) => x.id === id);
    if (!g) return;
    limparForm();
    editando = id;
    q('#gastos-valor').value = nf(g.valor, 2);
    marcar('gastos-moeda', g.moeda); mostrarMoeda();
    marcar('gastos-cat', g.cat);
    q('#gastos-desc').value = g.desc;
    q('#gastos-dia').value = String(g.dia);
    marcar('gastos-forma', g.forma);
    q('#gastos-form').classList.add('is-edit');
    q('#gastos-form-h').textContent = 'Editar gasto';
    q('#gastos-ok').textContent = 'Salvar';
    q('#gastos-cancelar').hidden = false;
    sec.querySelectorAll('.gastos-item.is-edit').forEach((li) => li.classList.remove('is-edit'));
    document.getElementById(`gastos-i-${id}`)?.classList.add('is-edit');
    if (ctx.celular()) ctx.setSheet('full');
    q('#gastos-form').scrollIntoView({ block: 'start', behavior: reduzMovimento() ? 'auto' : 'smooth' });
    q('#gastos-valor').focus({ preventScroll: true });
    ctx.anunciar(`Editando: ${g.desc || CAT[g.cat].nome}`);
  }
  function enviar(e) {
    e.preventDefault();
    limparErro();
    const v = lerNumero(q('#gastos-valor').value);
    if (v == null || v <= 0 || v >= 1e6) return erro('Digite o valor (ex.: 45,90).', q('#gastos-valor'));
    const cat = escolhido('gastos-cat');
    if (!cat) return erro('Escolha a categoria.', q('input[name="gastos-cat"]'));
    const dados = {
      valor: r2(v), moeda: escolhido('gastos-moeda') === 'BRL' ? 'BRL' : 'USD', cat, dia: +q('#gastos-dia').value || 0,
      desc: q('#gastos-desc').value.trim().slice(0, 80), forma: escolhido('gastos-forma') === 'dinheiro' ? 'dinheiro' : 'cartao',
    };
    const resumo = `${din(dados.valor, dados.moeda)} · ${CAT[cat].nome} · ${rotuloDia(dados.dia, true)}`;
    if (editando) {
      const i = lista.findIndex((x) => x.id === editando);
      if (i < 0) { limparForm(); return; }
      const antes = lista[i], id = antes.id;
      lista[i] = { ...antes, ...dados };
      salvarLista(); limparForm(); desenhar();
      oferecerDesfazer(`Alterado: ${resumo}.`, () => { const j = lista.findIndex((x) => x.id === id); if (j >= 0) lista[j] = antes; }, { volta: id });
      const li = document.getElementById(`gastos-i-${id}`);
      if (li) {
        li.scrollIntoView({ block: 'center', behavior: reduzMovimento() ? 'auto' : 'smooth' });
        li.classList.add('is-flash');
        li.querySelector('[data-gastos-editar]')?.focus({ preventScroll: true });
      }
      return;
    }
    const g = { id: novoId(), ...dados, em: Date.now() };
    lista.push(g);
    salvarLista(); limparForm(); desenhar();
    oferecerDesfazer(`Lançado: ${resumo}.`, () => { lista = lista.filter((x) => x.id !== g.id); });
    // no celular, fecha o teclado para mostrar o aviso; no computador, já fica pronto para o próximo
    if (ctx.celular()) document.activeElement?.blur?.(); else q('#gastos-valor').focus({ preventScroll: true });
  }
  function apagar(id) {
    const i = lista.findIndex((x) => x.id === id);
    if (i < 0) return;
    const g = lista[i];
    if (editando === id) limparForm();
    lista.splice(i, 1);
    salvarLista(); desenhar();
    oferecerDesfazer(`Apagado: ${g.desc || CAT[g.cat].nome}, ${din(g.valor, g.moeda)}.`, () => { lista.splice(Math.min(i, lista.length), 0, g); }, { focar: true, volta: g.id });
  }

  // ---------- desfazer (barra presa embaixo do painel) ----------
  let desfazer = null, desfazerT = 0;
  function fecharBarra() {
    if (sec.querySelector('#gastos-barra').contains(document.activeElement)) { desfazerT = setTimeout(fecharBarra, 4000); return; }
    q('#gastos-barra').hidden = true; desfazer = null;
  }
  function oferecerDesfazer(txt, fn, { focar = false, volta = null } = {}) {
    desfazer = { fn, volta };
    q('#gastos-barra-txt').textContent = txt;
    q('#gastos-desfazer').hidden = false;
    q('#gastos-barra').hidden = false;
    ctx.anunciar(`${txt} Para desfazer, use o botão Desfazer.`);
    clearTimeout(desfazerT); desfazerT = setTimeout(fecharBarra, 10000);
    if (focar) q('#gastos-desfazer').focus({ preventScroll: true });
  }
  function aplicarDesfazer() {
    if (!desfazer) return;
    const { fn, volta } = desfazer;
    desfazer = null;
    fn(); salvarLista();
    if (editando && !lista.some((x) => x.id === editando)) limparForm();
    desenhar();
    q('#gastos-barra-txt').textContent = 'Desfeito.';
    q('#gastos-desfazer').hidden = true;
    ctx.anunciar('Desfeito.');
    clearTimeout(desfazerT); desfazerT = setTimeout(fecharBarra, 2500);
    // o foco (que estava no Desfazer, agora escondido) vai para o gasto que voltou; sem ele, para o valor
    const alvo = volta && document.querySelector(`#gastos-i-${CSS.escape(volta)} [data-gastos-editar]`);
    if (alvo) { alvo.closest('li').scrollIntoView({ block: 'center', behavior: reduzMovimento() ? 'auto' : 'smooth' }); alvo.focus({ preventScroll: true }); }
    else if (ctx.celular()) document.activeElement?.blur?.();
    else q('#gastos-valor').focus({ preventScroll: true });
  }

  // ---------- câmbio e orçamento ----------
  // aria-invalid precisa do valor "true" (vazio vale como "false" para o leitor de tela e não casa com o CSS)
  const invalido = (el, sim) => { if (sim) el.setAttribute('aria-invalid', 'true'); else el.removeAttribute('aria-invalid'); };
  function lerCampoCambio() {
    const c = lerNumero(q('#gastos-cambio').value), x = q('#gastos-extra').value.trim() === '' ? 0 : lerNumero(q('#gastos-extra').value);
    const okC = c != null && c > 0 && c < 100, okX = x != null && x >= 0 && x < 50;
    invalido(q('#gastos-cambio'), !okC);
    invalido(q('#gastos-extra'), !okX);
    if (okC) cambio.comercial = c;
    if (okX) cambio.extra = x;
    if (okC || okX) { gravar('gastos.cambio', cambio); desenhar(); }
  }
  function lerCampoOrc(el) {
    const vazio = el.value.trim() === '', v = vazio ? null : lerNumero(el.value), ok = vazio || (v != null && v > 0 && v < 1e7);
    invalido(el, !ok);
    if (!ok) return;
    if (el.id === 'gastos-orc-total') orc.total = v; else if (v) orc.cat[el.dataset.gastosOrc] = v; else delete orc.cat[el.dataset.gastosOrc];
    gravar('gastos.orcamento', orc);
    desenhar();
  }
  function preencherCampos() {
    q('#gastos-cambio').value = fmtNum(cambio.comercial, 2);
    q('#gastos-extra').value = fmtNum(cambio.extra, cambio.extra % 1 ? 1 : 0);
    q('#gastos-orc-total').value = fmtNum(orc.total, orc.total % 1 ? 2 : 0);
    for (const c of CATS) { const v = orc.cat[c.id]; q(`#gastos-o-${c.id}`).value = v ? fmtNum(v, v % 1 ? 2 : 0) : ''; }
    sec.querySelectorAll('#gastos-cambio, #gastos-extra, #gastos-orc input[type="text"]').forEach((el) => el.removeAttribute('aria-invalid'));
    marcar('gastos-om', orc.moeda);
    marcar('gastos-ver', ver);
    if (orc.total || Object.keys(orc.cat).length) q('#gastos-orc').open = true;
  }

  // ---------- exportar ----------
  function dataHora(t) {
    const d = new Date(t), p = (x) => String(x).padStart(2, '0');
    return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }
  function csv() {
    const cel = (s) => { let t = String(s); if (/^[=+\-@]/.test(t)) t = `'${t}`; return /[;"\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
    // mesmo arredondamento da tela (nf), sem separador de milhar
    const num = (v, d = 2) => v.toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d, useGrouping: false });
    const cab = ['Dia', 'Data', 'Categoria', 'Descrição', 'Forma', 'Moeda', 'Valor', 'Em US$', 'Em R$', 'Câmbio (R$/US$)', 'Lançado em'];
    const ord = [...lista].sort((a, b) => a.dia - b.dia || a.em - b.em);
    const linhas = ord.map((g) => [
      g.dia === 0 ? 'Antes' : g.dia === VOLTA ? 'Volta' : String(g.dia), dataDoDia(g.dia) ? fmtDia(dataDoDia(g.dia)) : '',
      CAT[g.cat].nome, g.desc, g.forma === 'dinheiro' ? 'Dinheiro' : 'Cartão', g.moeda === 'BRL' ? 'R$' : 'US$',
      num(g.valor), num(emUSD(g)), num(emBRL(g)), num(g.moeda === 'USD' ? efetivo() : cambio.comercial, 4), dataHora(g.em),
    ].map(cel).join(';'));
    return [cab.join(';'), ...linhas].join('\r\n');
  }
  async function baixarCSV() {
    const msg = q('#gastos-msg');
    if (!lista.length) { msg.textContent = 'Ainda não há gastos para exportar.'; return; }
    const nome = `gastos-motorhome-${hoje()}.csv`, texto = `\uFEFF${csv()}`;   // BOM: o Excel reconhece o UTF-8
    // no app da Tela de Início do iPhone o download não funciona bem: lá vai pelo "Compartilhar"
    if (navigator.standalone && navigator.canShare) {
      try {
        const f = new File([texto], nome, { type: 'text/csv' });
        if (navigator.canShare({ files: [f] })) { await navigator.share({ files: [f], title: 'Gastos da viagem' }); msg.textContent = ''; return; }
      } catch (e) { if (e.name === 'AbortError') return; }
    }
    const url = URL.createObjectURL(new Blob([texto], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url; a.download = nome; a.hidden = true;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    msg.textContent = `CSV salvo: ${nome} (${plural(lista.length, 'lançamento', 'lançamentos')}).`;
  }
  function textoResumo() {
    const L = [`Gastos da viagem de motorhome (até ${fmtDia(hoje())})`];
    if (!lista.length) return [...L, 'Nenhum gasto lançado.'].join('\n');
    const m = media(), tot = soma(lista, naVista);
    L.push(`Total: ${din(soma(lista, emUSD), 'USD')} ≈ ${din(soma(lista, emBRL), 'BRL')}`);
    L.push(`Câmbio: R$ ${nf(cambio.comercial, 2)} + ${nf(cambio.extra, cambio.extra % 1 ? 1 : 0)}% (IOF e spread) = R$ ${nf(efetivo(), 2)} por US$`);
    if (m) L.push(`${rotuloMedia(m).replace(/^m/, 'M')}: ${din(m.v)}`);
    if (orc.total) { const meta = orcNaVista(orc.total); L.push(`Orçamento: ${din(meta)} · ${tot <= meta ? `faltam ${din(meta - tot)}` : `passou ${din(tot - meta)}`}`); }
    L.push('', 'Por categoria:');
    CATS.map((c) => ({ c, v: soma(lista.filter((g) => g.cat === c.id), naVista) })).filter((x) => x.v > 0).sort((a, b) => b.v - a.v)
      .forEach((x) => L.push(`- ${x.c.nome}: ${din(x.v)} (${nf((x.v / tot) * 100, 0)}%)`));
    L.push('', 'Por dia:');
    [...new Set(lista.map((g) => g.dia))].sort((a, b) => a - b)
      .forEach((n) => L.push(`- ${rotuloDia(n, true)}: ${din(soma(lista.filter((g) => g.dia === n), naVista))}`));
    return L.join('\n');
  }
  async function compartilharTexto() {
    const msg = q('#gastos-msg'), txt = textoResumo();
    if (matchMedia('(pointer: coarse)').matches && navigator.share) {
      try { await navigator.share({ title: 'Gastos da viagem', text: txt }); msg.textContent = ''; return; } catch (e) { if (e.name === 'AbortError') return; }
    }
    try {
      await navigator.clipboard.writeText(txt);
      msg.textContent = 'Resumo copiado. Cole no WhatsApp, no e-mail…';
    } catch {
      msg.innerHTML = `Copie o resumo:<textarea readonly aria-label="Resumo dos gastos">${esc(txt)}</textarea>`;
      const ta = msg.querySelector('textarea'); ta.focus(); ta.select();
    }
  }

  // ---------- abrir o painel com um dia escolhido (botão da ficha) ----------
  function lancarNoDia(n) {
    if (!sec) return;
    if (editando) limparForm();
    diaPedido = n;
    ctx.showPane('gastos', { sheet: 'full' });   // chama o aoMostrarPainel, que escolhe o dia pedido
    q('#gastos-valor').focus({ preventScroll: true });   // ainda dentro do toque: no celular abre o teclado
    ctx.anunciar(`Lançar gasto no dia ${n}`);
  }

  // ---------- montagem do painel ----------
  if (painel) {
    sec = document.getElementById('mod-gastos') ?? document.createElement('section');
    sec.id = 'mod-gastos'; sec.style.order = '1';
    sec.innerHTML = htmlPainel();
    if (!sec.parentNode) painel.append(sec);
    opcoesDia();
    q('#gastos-dia').value = String(diaPadrao());
    marcar('gastos-moeda', 'USD');
    marcar('gastos-forma', store.get('gastos.forma') === 'dinheiro' ? 'dinheiro' : 'cartao');
    preencherCampos();
    desenhar();

    q('#gastos-form').addEventListener('submit', enviar);
    sec.addEventListener('click', (e) => {
      const t = e.target;
      let b;
      if ((b = t.closest('[data-gastos-editar]'))) return editar(b.dataset.gastosEditar);
      if ((b = t.closest('[data-gastos-apagar]'))) return apagar(b.dataset.gastosApagar);
      if ((b = t.closest('[data-gastos-dcol]'))) return legendaDia(+b.dataset.gastosDcol);
      if (t.closest('#gastos-cancelar')) return cancelarEdicao();
      if (t.closest('#gastos-desfazer')) return aplicarDesfazer();
      if (t.closest('#gastos-csv')) return baixarCSV();
      if (t.closest('#gastos-texto')) return compartilharTexto();
      if (t.closest('.gastos-vbox')) q('#gastos-valor').focus();
    });
    sec.addEventListener('change', (e) => {
      const t = e.target;
      if (t.name === 'gastos-moeda') mostrarMoeda();
      else if (t.name === 'gastos-cat') limparErro();
      else if (t.name === 'gastos-forma') store.set('gastos.forma', t.value);
      else if (t.name === 'gastos-ver') { ver = t.value === 'BRL' ? 'BRL' : 'USD'; store.set('gastos.ver', ver); desenhar(); }
      else if (t.name === 'gastos-om') { orc.moeda = t.value === 'BRL' ? 'BRL' : 'USD'; gravar('gastos.orcamento', orc); desenhar(); }
    });
    sec.addEventListener('input', (e) => {
      const t = e.target;
      if (t.id === 'gastos-valor') { if (t.hasAttribute('aria-invalid')) limparErro(); }
      else if (t.id === 'gastos-cambio' || t.id === 'gastos-extra') lerCampoCambio();
      else if (t.id === 'gastos-orc-total' || t.dataset.gastosOrc) lerCampoOrc(t);
    });
    // ao sair do campo, o número volta escrito do jeito certo ("5.2" → "5,20")
    sec.addEventListener('focusout', (e) => {
      if (['gastos-cambio', 'gastos-extra', 'gastos-orc-total'].includes(e.target.id) || e.target.dataset?.gastosOrc) preencherCampos();
    });
    // a legenda do gráfico por dia acompanha o mouse e o foco
    sec.addEventListener('mouseover', (e) => { const b = e.target.closest?.('[data-gastos-dcol]'); if (b) legendaDia(+b.dataset.gastosDcol); });
    sec.addEventListener('focusin', (e) => { const b = e.target.closest?.('[data-gastos-dcol]'); if (b) legendaDia(+b.dataset.gastosDcol); });
    // setas e Esc são atalhos do app (trocar o dia, voltar à viagem) e tirariam a pessoa do painel no meio de um
    // lançamento: aqui dentro, Esc cancela a edição e as setas andam entre as barras do gráfico por dia
    sec.addEventListener('keydown', (e) => {
      if (!['ArrowLeft', 'ArrowRight', 'Escape'].includes(e.key)) return;
      e.stopPropagation();
      if (e.key === 'Escape') { if (editando) cancelarEdicao(); return; }
      const b = e.target.closest?.('[data-gastos-dcol]');
      const v = b && (e.key === 'ArrowLeft' ? b.previousElementSibling : b.nextElementSibling);
      if (v?.matches('[data-gastos-dcol]')) { e.preventDefault(); v.focus(); }
    });
  }
  /** sai da edição sem salvar e devolve o foco ao gasto que estava sendo editado */
  function cancelarEdicao() {
    const id = editando;
    limparForm(); desenhar();
    document.querySelector(`#gastos-i-${CSS.escape(id ?? '')} [data-gastos-editar]`)?.focus();
    ctx.anunciar('Edição cancelada.');
  }

  // outra aba do navegador mudou os gastos: relê tudo
  addEventListener('storage', (e) => {
    if (e.key != null && !e.key.startsWith('viagem-motorhome.gastos.')) return;   // null = a outra aba limpou tudo
    lista = lerLista(); cambio = lerCambio(); orc = lerOrc(); ver = store.get('gastos.ver') === 'BRL' ? 'BRL' : 'USD';
    if (editando && !lista.some((x) => x.id === editando)) limparForm();
    if (sec && !sec.contains(document.activeElement)) preencherCampos();
    desenhar();
  });

  ctx.registrar({
    blocoDia: { lugar: 'fim', html: (d) => htmlBloco(d) },
    aoRenderDia: (n, el) => {
      if (fichas.has(el)) return;
      fichas.add(el);
      el.addEventListener('click', cliqueFicha);
      el.addEventListener('toggle', toggleFicha, true);   // 'toggle' não sobe: escuta na captura
    },
    aoMostrarPainel: (nome) => {
      if (nome !== 'gastos' || !sec) return;
      opcoesDia();
      // o dia segue o dia aberto (ou hoje), menos no meio de um lançamento: aí fica o que a pessoa escolheu
      const meio = editando || q('#gastos-valor').value.trim() !== '';
      if (diaPedido != null || !meio) q('#gastos-dia').value = String(diaPedido ?? diaPadrao());
      diaPedido = null;
      desenhar();
    },
  });
}
