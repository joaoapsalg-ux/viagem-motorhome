// Agenda: leva a viagem para a agenda do celular num arquivo .ics (RFC 5545), feito no navegador.
// Um evento de dia inteiro por dia, lembretes às 19h da véspera dos dias com estrada a conferir, a devolução do
// motorhome e o voo de volta. Os horários vão no fuso de cada lugar (TZID + VTIMEZONE).

const APP_URL = 'https://joaoapsalg-ux.github.io/viagem-motorhome/';
const DOMINIO = 'viagem-motorhome.joaoapsalg-ux.github.io';   // fim dos UID: o mesmo evento tem sempre o mesmo código
const PRODID = '-//joaoapsalg-ux//Viagem de motorhome//PT-BR';
const ARQUIVO = 'viagem-motorhome.ics';
const LA = 'America/Los_Angeles';

// regras dos fusos (as atuais dos EUA, desde 2007); só entram no arquivo os que forem usados
const FUSOS = {
  'America/Los_Angeles': comVerao('-0800', '-0700', 'PST', 'PDT'),
  'America/Denver': comVerao('-0700', '-0600', 'MST', 'MDT'),
  // Arizona: sem horário de verão
  'America/Phoenix': ['BEGIN:STANDARD', 'TZOFFSETFROM:-0700', 'TZOFFSETTO:-0700', 'TZNAME:MST', 'DTSTART:19700101T000000', 'END:STANDARD'],
};
function comVerao(inverno, verao, nomeI, nomeV) {
  return ['BEGIN:DAYLIGHT', `TZOFFSETFROM:${inverno}`, `TZOFFSETTO:${verao}`, `TZNAME:${nomeV}`, 'DTSTART:19700308T020000',
    'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU', 'END:DAYLIGHT',
    'BEGIN:STANDARD', `TZOFFSETFROM:${verao}`, `TZOFFSETTO:${inverno}`, `TZNAME:${nomeI}`, 'DTSTART:19701101T020000',
    'RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU', 'END:STANDARD'];
}
/** fuso de um lugar pelo estado (o último, quando o dia cruza a divisa: "NV/CA" termina na Califórnia) */
function fusoDe(estado) {
  const uf = String(estado ?? '').split('/').at(-1).trim();
  return uf === 'AZ' ? 'America/Phoenix' : uf === 'UT' ? 'America/Denver' : LA;
}

// o que conferir às 19h da véspera (o plano B vem do roteiro)
const CONFERIR = {
  6: {
    resumo: 'Conferir a SR-9 e o túnel de Zion', curto: 'SR-9',
    texto: 'Amanhã a rota principal entra em Zion pela SR-9 e pelo túnel Zion–Mount Carmel. O túnel só aceita veículos de até 2,39 m de largura (com espelhos), 3,45 m de altura e 10,9 m de comprimento.',
    onde: ['NPS Zion: https://www.nps.gov/zion/planyourvisit/conditions.htm', 'UDOT: https://zionarea.udot.utah.gov/road-information/'],
    aberta: 'Aberta e o veículo cabe no túnel → rota principal (pelo túnel e pelo Canyon Overlook).',
  },
  9: {
    resumo: 'Conferir a Tioga Road (Yosemite)', curto: 'Tioga Road',
    texto: 'Amanhã a rota principal sobe a Tioga Road (CA-120), que fecha com a primeira neve forte. Decida antes de sair de Death Valley.',
    onde: ['Telefone do NPS Yosemite (estradas): +1 209-372-0200', 'https://www.nps.gov/yose/planyourvisit/conditions.htm'],
    aberta: 'Aberta → rota principal, descendo a Tioga Road antes de escurecer (~18h).',
  },
  12: {
    resumo: 'Conferir a Hwy 1 em Big Sur', curto: 'Hwy 1',
    texto: 'Amanhã a rota principal desce a costa pela Hwy 1 em Big Sur, que pode fechar com chuva forte (lama da área queimada).',
    onde: ['Caltrans QuickMap: https://quickmap.dot.ca.gov/', 'Telefone da Caltrans: +1 800-427-7623'],
    aberta: 'Aberta → rota principal por Big Sur.',
  },
};
// devolução do motorhome no dia com prazo: saída cedo (no plano B, de Santa Bárbara, às 8h) e alarme 30 min antes
const DEVOLUCAO = { inicio: 6, inicioB: 8, alarmeMin: 30 };
const VOO_ALARME = 6;   // alarme às 6h no dia do voo
const SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

const ICONE_AGENDA = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4M12 12.5v5M9.5 15h5"/></svg>';

let ctx = null;

// ---------- datas ----------
const ymd = (iso) => iso.replaceAll('-', '');
/** "2026-10-31" + k dias */
function somaDias(iso, k) {
  const t = new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10) + k));
  return t.toISOString().slice(0, 10);
}
const semanaDe = (iso) => SEMANA[new Date(`${iso}T12:00:00Z`).getUTCDay()];
const dois = (v) => String(v).padStart(2, '0');
/** instante em UTC no formato do iCalendar (20261004T151233Z) */
const carimbo = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
/** minutos → duração do iCalendar (-PT4H10M, PT0S…) */
function duracao(min) {
  const m = Math.abs(Math.round(min)), h = Math.floor(m / 60), r = m % 60;
  const corpo = m ? `${h ? `${h}H` : ''}${r ? `${r}M` : ''}` : '0S';
  return `${min < 0 ? '-' : ''}PT${corpo}`;
}
/** 6 → "6h"; 10, 10 → "10h10" */
const hm = (h, m = 0) => `${h}h${m ? dois(m) : ''}`;

// ---------- texto do iCalendar ----------
/** escapa um valor TEXT: \ ; , e quebras de linha */
const txt = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r\n|\r|\n/g, '\\n');
/** valor de parâmetro (entre aspas; não pode ter aspas nem quebras) */
const param = (s) => `"${String(s ?? '').replace(/["\r\n]/g, '')}"`;
/** bytes de um trecho em UTF-8 */
function octetos(s) {
  let n = 0;
  for (const ch of s) { const c = ch.codePointAt(0); n += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4; }
  return n;
}
/** dobra a linha em 75 octetos (a continuação começa com espaço); não corta letra nem sequência de escape */
function dobrar(linha) {
  const partes = [];
  let atual = '', n = 0;
  for (const p of linha.match(/\\.|[\s\S]/gu) ?? []) {
    const b = octetos(p);
    if (n + b > 75) { partes.push(atual); atual = ' '; n = 1; }
    atual += p; n += b;
  }
  partes.push(atual);
  return partes.join('\r\n');
}
/** DTSTART/DTEND: dia inteiro (VALUE=DATE) ou hora local com TZID */
function quando(prop, q) {
  return q.hora == null ? `${prop};VALUE=DATE:${ymd(q.data)}` : `${prop};TZID=${q.tz}:${ymd(q.data)}T${dois(q.hora)}${dois(q.min ?? 0)}00`;
}

/** monta o arquivo .ics com uma lista de eventos */
export function montarICS(eventos, { nome } = {}) {
  const agora = carimbo(new Date());
  const fusos = [...new Set(eventos.flatMap((e) => [e.inicio.tz, e.fim?.tz]).filter(Boolean))];
  const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', `PRODID:${PRODID}`, 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
  if (nome) L.push(`X-WR-CALNAME:${txt(nome)}`);
  for (const tz of fusos) L.push('BEGIN:VTIMEZONE', `TZID:${tz}`, ...FUSOS[tz], 'END:VTIMEZONE');
  for (const e of eventos) {
    L.push('BEGIN:VEVENT', `UID:${e.uid}`, `DTSTAMP:${agora}`, quando('DTSTART', e.inicio));
    if (e.fim) L.push(quando('DTEND', e.fim));
    L.push(`SUMMARY:${txt(e.resumo)}`);
    if (e.desc) L.push(`DESCRIPTION:${txt(e.desc)}`);
    if (e.local) {
      L.push(`LOCATION:${txt(e.local.nome)}`);
      if (e.local.lat != null) {   // ponto conhecido: alfinete no mapa da agenda (GEO; o iPhone usa o X-APPLE)
        const la = e.local.lat.toFixed(5), lo = e.local.lon.toFixed(5);
        L.push(`GEO:${la};${lo}`, `X-APPLE-STRUCTURED-LOCATION;VALUE=URI;X-APPLE-RADIUS=200;X-TITLE=${param(e.local.nome)}:geo:${la},${lo}`);
      }
    }
    if (e.url) L.push(`URL:${e.url}`);
    L.push(`TRANSP:${e.inicio.hora == null ? 'TRANSPARENT' : 'OPAQUE'}`);   // o dia inteiro não ocupa a agenda
    if (e.alarme) L.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${txt(e.alarme.texto)}`, `TRIGGER:${e.alarme.gatilho}`, 'END:VALARM');
    L.push('END:VEVENT');
  }
  L.push('END:VCALENDAR');
  return `${L.map(dobrar).join('\r\n')}\r\n`;
}

// ---------- eventos da viagem ----------
const linkDia = (n) => `${APP_URL}#dia=${n}`;
/** lugar de um ponto do roteiro; sem alfinete quando o ponto é aproximado (locadora, hotel a escolher…) */
function lugar(id, nome) {
  const p = ctx.dados.pontos[id], nota = ctx.dados.roteiro.notasPontos?.[id] ?? '';
  if (!p || /aproximad|a escolher|a confirmar/i.test(nota)) return { nome: nome ?? p?.nome ?? id };
  return { nome: nome ?? p.nome, lat: p.lat, lon: p.lon };
}
/** opcionais marcados ("quero fazer") do dia, na ordem do caminho */
function marcados(d) {
  const q = ctx.quero(), coords = ctx.rotaAtiva(d).geometry.coordinates;
  return ctx.opsDoDia(d.n).filter((o) => o.dia === d.n && q.has(o.id))
    .map((o) => ({ o, ordem: ctx.posNaRota(coords, o.lon, o.lat).ordem }))
    .sort((a, b) => a.ordem - b.ordem).map((x) => x.o);
}
function descricaoDia(d) {
  const { fmtData, fmtKm, fmtH, fmtHora, TIPO_OPC } = ctx.util;
  const a = ctx.ativo(d), P = ctx.rotaAtiva(d).properties, pn = a.pernoite;
  const L = [`Dia ${d.n} de ${ctx.dias.length} · ${fmtData(d.data, d.semana)} · ${d.estado}`];
  if (a.b) L.push(`Rota: plano B (${a.b.titulo}).`);
  L.push(a.programacao);
  const paradas = ctx.listaParadas(d).filter((it) => it.papel === 'parada').map((it) => ctx.nomePonto(it.id));
  if (paradas.length) L.push(`Paradas: ${paradas.join(' · ')}.`);
  L.push(P.tipo === 'shuttle' ? 'Estrada: o dia é de shuttle; o motorhome fica no camping.'
    : `Estrada: ${fmtKm(P.km)}, ~${fmtH(ctx.horasMotorhome(P.horas))} de motorhome (estimativa: carro + 25%).`);
  try {
    const T = ctx.tempoDoDia(d);
    L.push(T.mudaFuso ? `Sol: nasce ${fmtHora(T.nasce)} (${T.ini.nome}) · põe ${fmtHora(T.poe)} (${T.fim.nome}), hora local.`
      : `Sol: nasce ${fmtHora(T.nasce)} · põe ${fmtHora(T.poe)} (hora local).`);
  } catch { /* sem a conta do sol, segue sem ela */ }
  const ops = marcados(d);
  if (ops.length) {
    L.push(`Quero fazer:\n${ops.map((o) => {
      const det = [TIPO_OPC[o.tipo]?.nome, o.duracao_h ? `~${fmtH(o.duracao_h)}` : ''].filter(Boolean).join(', ');
      return `• ${o.nome}${det ? ` (${det})` : ''}`;
    }).join('\n')}`);
  }
  L.push(`Pernoite: ${pn.nome} (${pn.tipo}${pn.reserva ? `, reserva: ${pn.reserva}` : ''}).${pn.notas ? ` ${pn.notas}` : ''}`);
  if (!a.b && d.planoB) L.push(`Plano B (${d.planoB.titulo}): ${d.planoB.quando}`);
  if (a.notas) L.push(`Para saber: ${a.notas}`);
  L.push(`Fuso: ${d.fuso}.`);
  L.push(`No app: ${linkDia(d.n)}`);
  return L.join('\n\n');
}
function eventoDia(d) {
  const a = ctx.ativo(d);
  return {
    uid: `dia-${d.n}-${ymd(d.data)}@${DOMINIO}`, resumo: `Dia ${d.n}: ${a.de} → ${a.para}`, desc: descricaoDia(d),
    local: lugar(a.pernoite.ponto, a.pernoite.nome), url: linkDia(d.n),
    inicio: { data: d.data }, fim: { data: somaDias(d.data, 1) },
  };
}
/** lembrete às 19h da véspera, no fuso de onde o casal dorme na véspera */
function eventoConferir(d) {
  const c = CONFERIR[d.n], ant = ctx.diaPorN.get(d.n - 1);
  if (!c || !ant) return null;
  const tz = fusoDe(ant.estado), vespera = somaDias(d.data, -1), pb = d.planoB;
  const L = [c.texto];
  const conf = ctx.util.fmtDia(ctx.dados.alertas?.conferido_em);
  if (d.usarB) L.push(`${conf ? `Em ${conf}: ` : ''}${d.usarB}`);
  L.push(`Onde ver:\n${c.onde.map((x) => `• ${x}`).join('\n')}`, c.aberta);
  if (pb) L.push(`Fechada → plano B (${pb.titulo}): ${pb.programacao}`);
  L.push(`No app, agora: ${ctx.usaB(d.n) ? 'plano B' : 'rota principal'}. Para trocar: ${linkDia(d.n)}`);
  return {
    uid: `conferir-dia-${d.n}-${ymd(d.data)}@${DOMINIO}`, resumo: `${c.resumo} (amanhã, dia ${d.n})`, desc: L.join('\n\n'), url: linkDia(d.n),
    inicio: { data: vespera, hora: 19, tz }, fim: { data: vespera, hora: 19, min: 15, tz },
    alarme: { gatilho: 'PT0S', texto: `${c.resumo} para amanhã` },
  };
}
/** devolução do motorhome no dia com prazo: da saída (6h; 8h no plano B) ao prazo, alarme 30 min antes */
function eventoDevolucao(d) {
  if (!d.prazo) return null;
  const a = ctx.ativo(d), ini = ctx.usaB(d.n) ? DEVOLUCAO.inicioB : DEVOLUCAO.inicio, tz = fusoDe(d.estado);
  return {
    uid: `devolucao-${ymd(d.data)}@${DOMINIO}`, resumo: `Devolver o motorhome (até ${d.prazo}h)`,
    // a programação do plano A já fala do tanque; a do B, não
    desc: [a.programacao, /tanque/i.test(a.programacao ?? '') ? '' : 'Devolva já abastecido e com os tanques esvaziados.', a.notas, `No app: ${linkDia(d.n)}`].filter(Boolean).join('\n\n'),
    local: lugar('locadora', 'Locadora do motorhome (Los Angeles)'), url: linkDia(d.n),
    inicio: { data: d.data, hora: ini, tz }, fim: { data: d.data, hora: d.prazo, tz },
    alarme: { gatilho: duracao(-DEVOLUCAO.alarmeMin), texto: `Hora de sair: devolver o motorhome até ${d.prazo}h` },
  };
}
/** voo de volta (sem número do voo: o repositório é público) */
function eventoVoo() {
  const fim = ctx.dados.roteiro.fim;
  if (!fim?.data) return null;
  const m = String(fim.texto ?? '').match(/(\d{1,2})h(\d{2})/);
  const h = m ? +m[1] : 10, mi = m ? +m[2] : 10;
  return {
    uid: `voo-volta-${ymd(fim.data)}@${DOMINIO}`, resumo: `Voo de volta, LAX, ${hm(h, mi)}`,
    desc: [fim.texto, 'Voo internacional: chegue ao aeroporto com folga (umas 3 h antes).', 'O número do voo e a reserva não estão no app: acrescente aqui, se quiser.'].filter(Boolean).join('\n\n'),
    local: lugar('lax', 'Aeroporto LAX (Los Angeles)'),
    inicio: { data: fim.data, hora: h, min: mi, tz: LA },
    alarme: { gatilho: duracao(VOO_ALARME * 60 - (h * 60 + mi)), texto: `Voo de volta hoje às ${hm(h, mi)} (LAX)` },
  };
}
/** eventos de um dia: lembrete da véspera, o dia, a devolução e (no último dia) o voo de volta */
function eventosDoDia(n) {
  const d = ctx.diaPorN.get(n);
  if (!d) return [];
  const ultimo = n === ctx.dias.at(-1).n;
  return [eventoConferir(d), eventoDia(d), eventoDevolucao(d), ultimo ? eventoVoo() : null].filter(Boolean);
}
/** texto do .ics da viagem toda (ou só dos dias pedidos) */
export function gerarICS(ns = ctx.dias.map((d) => d.n)) {
  return montarICS(ns.flatMap(eventosDoDia), { nome: ctx.dados.roteiro.titulo ?? 'Viagem de motorhome' });
}

// ---------- baixar ----------
function baixar(texto, nome) {
  const url = URL.createObjectURL(new Blob([texto], { type: 'text/calendar;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url; a.download = nome; a.hidden = true;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);   // o celular pode demorar a ler o arquivo
}
const contar = (texto) => (texto.match(/^BEGIN:VEVENT\r$/gm) ?? []).length;

// ---------- painel Preparar ----------
function htmlResumo() {
  const { fmtData, esc } = ctx.util, dias = ctx.dias, q = ctx.quero();
  const comB = dias.filter((d) => ctx.usaB(d.n)).map((d) => d.n);
  const nq = dias.reduce((s, d) => s + ctx.opsDoDia(d.n).filter((o) => o.dia === d.n && q.has(o.id)).length, 0);
  const lemb = Object.keys(CONFERIR).map(Number).filter((n) => ctx.diaPorN.has(n) && n > 1).map((n) => {
    const v = somaDias(ctx.diaPorN.get(n).data, -1);
    return `${fmtData(v, semanaDe(v))} (${esc(CONFERIR[n].curto)})`;
  });
  const dev = dias.find((d) => d.prazo), voo = eventoVoo();
  const itens = [
    `<b>${dias.length} dias</b> como eventos de dia inteiro, na rota escolhida${comB.length ? ` (plano B ${comB.length > 1 ? 'nos dias' : 'no dia'} ${comB.join(', ')})` : ''}`,
    nq ? `<b>★ ${nq}</b> opciona${nq > 1 ? 'is marcados' : 'l marcado'}, na descrição de cada dia` : '<b>Opcionais:</b> nenhum marcado ainda (marque com a estrela na ficha do dia)',
    lemb.length ? `<b>${lemb.length} lembretes às 19h</b> da véspera: ${lemb.join(', ')}` : '',
    dev ? `<b>Devolução:</b> ${fmtData(dev.data, dev.semana)}, ${hm(ctx.usaB(dev.n) ? DEVOLUCAO.inicioB : DEVOLUCAO.inicio)}–${dev.prazo}h, com alarme` : '',
    voo ? `<b>Voo de volta:</b> ${fmtData(voo.inicio.data, semanaDe(voo.inicio.data))}, ${hm(voo.inicio.hora, voo.inicio.min)} (LAX), alarme às ${VOO_ALARME}h` : '',
  ].filter(Boolean);
  return `<ul class="agenda-lista">${itens.map((t) => `<li>${t}</li>`).join('')}</ul>`;
}
function renderPreparar() {
  const pai = document.getElementById('painel-preparar');
  if (!pai) return;
  let sec = document.getElementById('mod-agenda');
  if (!sec) {   // criado uma vez; o painel é uma grade e a posição vem do order
    sec = document.createElement('section');
    sec.id = 'mod-agenda'; sec.className = 'agenda-sec'; sec.style.order = '3';
    sec.setAttribute('aria-labelledby', 'agenda-h');
    pai.append(sec);
    sec.addEventListener('click', (e) => { if (e.target.closest('[data-agenda-tudo]')) baixarViagem(); });
  }
  const st = sec.querySelector('.agenda-st')?.textContent ?? '';
  sec.innerHTML = `
    <h3 id="agenda-h">Agenda do celular</h3>
    <p class="agenda-txt">Põe a viagem na agenda: cada dia com programação, paradas, estrada, pernoite e o link do app.</p>
    ${htmlResumo()}
    <button type="button" class="btn btn--main" data-agenda-tudo aria-describedby="agenda-como">${ICONE_AGENDA}Pôr a viagem na agenda</button>
    <p class="hint" id="agenda-como">No iPhone, abra o arquivo baixado (fica em Arquivos › Downloads) e toque em Adicionar todos. No Android, abra o arquivo e escolha a agenda; se nenhuma abrir, importe no Google Agenda pelo computador.</p>
    <p class="agenda-st" role="status">${ctx.util.esc(st)}</p>
    <p class="cc-note">Vai o que está escolhido agora (rota de cada dia e opcionais marcados). Mudou algo? Baixe de novo e, se a agenda repetir eventos, apague os antigos. O Google Agenda não traz os alarmes do arquivo. No app da Tela de Início do iPhone, se nada acontecer, baixe pelo Safari. Sem número de voo nem de reserva.</p>`;
}
function baixarViagem() {
  const texto = gerarICS();
  baixar(texto, ARQUIVO);
  const st = document.querySelector('#mod-agenda .agenda-st');
  if (st) st.textContent = `Baixado: ${ARQUIVO} (${contar(texto)} eventos). Abra o arquivo para pôr na agenda.`;
}

// ---------- ficha do dia ----------
function htmlDia(d) {
  const c = CONFERIR[d.n], voo = d.n === ctx.dias.at(-1).n && !!ctx.dados.roteiro.fim?.data;
  const junto = [d.prazo ? 'a devolução do motorhome' : '', voo ? 'o voo de volta' : ''].filter(Boolean).join(' e ');
  const extra = c && d.n > 1 ? `com o lembrete das 19h da véspera para ${c.resumo.replace(/^Conferir/, 'conferir')}`
    : junto ? `com ${junto}` : 'evento de dia inteiro, com a programação';
  return `<div class="agenda-dia">
    <button type="button" class="btn btn--small" data-agenda-dia="${d.n}" aria-describedby="agenda-dica-${d.n}">${ICONE_AGENDA}Pôr este dia na agenda</button>
    <span class="hint" id="agenda-dica-${d.n}">${ctx.util.esc(extra[0].toUpperCase() + extra.slice(1))}.</span></div>`;
}

// seção com a mesma cara das vizinhas do painel Preparar: título grande e linha em cima
const CSS = `
  #mod-agenda { position: relative; display: grid; gap: 10px; min-width: 0; align-content: start; padding-top: 14px; border-top: 1px solid var(--panel-line); }
  #mod-agenda h3 { margin: 0; font: 700 19px/1.1 var(--f-display); letter-spacing: .04em; text-transform: uppercase; }
  #mod-agenda p { margin: 0; }
  #mod-agenda .agenda-txt { font-size: 14px; line-height: 1.45; }
  #mod-agenda .agenda-lista { margin: 0; padding: 0; list-style: none; display: grid; gap: 5px; font-size: 13px; line-height: 1.4; }
  #mod-agenda .agenda-lista li { position: relative; padding-left: 16px; }
  #mod-agenda .agenda-lista li::before { content: ''; position: absolute; left: 3px; top: .5em; width: 6px; height: 6px; border-radius: 2px; background: var(--accent); }
  #mod-agenda .agenda-lista b { font-weight: 600; }
  #mod-agenda .btn--main { min-height: 44px; font-size: 14px; }
  #mod-agenda .agenda-st { font-size: 13px; padding: 6px 10px; border-left: 3px solid var(--g-ok); border-radius: 0 6px 6px 0; background: color-mix(in srgb, var(--g-ok) 10%, transparent); }
  /* vazio: some da tela mas continua para o leitor de tela (assim o aviso de "Baixado" é lido) */
  #mod-agenda .agenda-st:empty { position: absolute; width: 1px; height: 1px; padding: 0; border: 0; overflow: hidden; clip: rect(0 0 0 0); }
  .agenda-dia { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; padding-top: 10px; border-top: 1px solid var(--panel-line); }
  .agenda-dia .hint { flex: 1 1 180px; }
  @media (max-width: 700px) { .agenda-dia .btn { min-height: 40px; } }`;

export function iniciar(c) {
  ctx = c;
  if (!document.getElementById('mod-agenda-css')) {
    const st = document.createElement('style');
    st.id = 'mod-agenda-css'; st.textContent = CSS;
    document.head.append(st);
  }
  renderPreparar();
  // a ficha do dia é redesenhada a cada mudança: um ouvinte só, por delegação
  document.getElementById('day')?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-agenda-dia]');
    if (!b) return;
    const n = +b.dataset.agendaDia, texto = gerarICS([n]);
    baixar(texto, `viagem-motorhome-dia-${n}.ics`);
    ctx.aviso(`Dia ${n} baixado (${contar(texto)} evento${contar(texto) > 1 ? 's' : ''}). Abra o arquivo para pôr na agenda.`);
  });
  ctx.registrar({
    blocoDia: { lugar: 'fim', html: htmlDia },
    aoMostrarPainel: (nome) => { if (nome === 'preparar') renderPreparar(); },
  });
}
