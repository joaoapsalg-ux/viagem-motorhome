# Módulos do app da viagem

Cada recurso extra é um módulo em `src/mod/<nome>.js`, carregado pelo `src/app.js` (lista `MODULOS`). Um módulo com
erro não derruba o app: o carregador só registra o aviso no console.

```js
// src/mod/exemplo.js
export function iniciar(ctx) {          // pode ser async, mas não segure a abertura: busca de rede vai em segundo plano
  const { $, esc, store } = ctx.util;
  ctx.registrar({
    blocoDia: { lugar: 'depois-tempo', html: (d) => `<section class="blk" id="exemplo-${d.n}">…</section>` },
    tagDia: (d) => '',                  // etiqueta extra na lista dos dias (ex.: '<span class="tag">−2°/14°</span>')
    botaoDia: (d) => '',                // botão extra na barra de ações da ficha (ao lado de Navegar/No mapa/Compartilhar):
                                        // '<button type="button" class="btn btn--small" data-<nome>-...>…</button>'
    aoRenderDia: (n, el) => {},         // depois que a ficha do dia n foi desenhada em el (#day)
    aoRenderViagem: (el) => {},         // depois que a lista dos dias foi desenhada em el (#trip)
    aoMostrarPainel: (nome) => {},      // 'roteiro' | 'mapa' | 'preparar' | 'gastos' | 'alertas' | 'sobre'
    aoPosicao: (lngLat, coords) => {},  // GPS ligado no botão "onde estou" (lngLat null quando desliga)
    aoSinal: (online) => {},            // a internet caiu/voltou
    aoMapa: (mapa) => {},               // o mapa ficou pronto (pode não acontecer: aparelho sem WebGL)
  });
}
```

## Onde cada módulo aparece

| lugar | como |
|---|---|
| ficha do dia (`#day`) | `blocoDia` com `lugar`: `'depois-paradas'`, `'depois-tempo'`, `'depois-opcionais'` ou `'fim'` (aceita lista de blocos) |
| lista dos dias (`#trip`) | `tagDia(d)` devolve HTML de etiqueta(s) `.tag` |
| painel Preparar | `#painel-preparar` (div `.dsheet`, grade com espaço entre blocos) — desenhe no `aoMostrarPainel('preparar')` e na carga |
| painel Gastos | `#painel-gastos` |
| Sobre › Sem sinal | `#sobre-extra` |
| mapa | `ctx.mapa()?.setMarcadores('<grupo próprio>', itens)` (itens: `{ chave, lngLat, html, cls, style, titulo, prioridade, zoomNome, essencial, fixo, anchor, offset, aoClicar }`, ver `src/mapa.js`); `ctx.mapa()?.map` é o MapLibre |

## O que o `ctx` oferece

- Dados: `ctx.dados.{roteiro, rotas, pontos, alertas, opcionais, fotos}`, `ctx.dias`, `ctx.diaPorN`, `ctx.rotaPorId`, `ctx.opPorId`.
- Fotos e descrições: `ctx.foto('p:<id do ponto>')` ou `ctx.foto('o:<id do opcional>')` → `{ titulo, texto, foto (URL ~960 px),
  mini (URL ~500 px), largura, altura, credito, licenca, pagina, alt }` ou `null` (fotos do Wikimedia Commons, carregadas
  da rede: sempre mostre o `credito`; sem sinal, a foto pode não carregar — use um fundo neutro e o texto).
- Notas curtas dos pontos: `ctx.dados.roteiro.notasPontos[id]`.
- Para testes: `window.app.ctx` é o próprio ctx (dá para injetar dados de exemplo em `ctx.dados.fotos.itens`).
- Consultas: `ativo(d)` (rota/paradas/pernoite/de/para/notas em uso, plano A ou B), `rotaAtiva(d)` (Feature GeoJSON),
  `inicioDe(d)` (id do ponto de saída), `listaParadas(d)`, `tempoDoDia(d)`, `usaB(n)`, `opsDoDia(n)`,
  `posNaRota(coords, lon, lat)` → `{ km, ordem }`, `llPonto(id)` → `[lon, lat]`, `nomePonto(id)`, `horasMotorhome(h)`,
  `quero()` (Set dos opcionais marcados), `diaAberto()` (n ou null), `diaDeHoje` (n ou null), `HOJE` ('AAAA-MM-DD').
- Ações: `abrirDia(n)`, `mostrarViagem()`, `showPane(nome, { sheet })`, `setSheet('peek'|'half'|'full')`,
  `setCollapsed(true|false)` (recolhe/abre o painel; no celular fica só a barra), `recolhido()`, `aviso(texto)`
  (balão por 5 s, lido por leitor de tela), `anunciar(texto)` (só leitor de tela), `atualizarDia()` (refaz a ficha
  aberta mantendo a rolagem), `atualizarViagem()`, `mapa()` (pode ser null), `celular()` (tela ≤ 700 px),
  `online()` (há internet de verdade: `navigator.onLine` e o mapa não está falhando seguido, como num Wi-Fi sem
  internet — use no lugar de `navigator.onLine`; o gancho `aoSinal` recebe o mesmo valor).
- Margem do mapa: `ctx.mapa().setPadding({ top, bottom, … })` (o app refaz a dele ao mexer no painel; quem muda a
  margem deve conferir e reaplicar a sua).
- Utilidades (`ctx.util`): `$`, `$$`, `store` (localStorage com prefixo `viagem-motorhome.`; use chaves com o nome do
  módulo, ex. `gastos.lista`), `nf`, `fmtKm`, `fmtH`, `fmtData`, `fmtDia`, `esc`, `isDark`, `reduzMovimento`,
  `corDia(n)`, `ICONE`, `TIPO_OPC`, `sol(lat, lon, iso, utc)`, `fmtHora`, `MOTORHOME`.
- Cada dia (`ctx.dias[i]`): `n`, `data` ('2026-10-19'), `semana`, `de`, `para`, `estado`, `fuso`, `utc` ([início, fim]),
  `rota`, `paradas`, `pernoite { ponto, nome, tipo, … }`, `programacao`, `notas`, `planoB?`, `usarB?`.

## Regras

- **Só crie/edite os seus arquivos**: `src/mod/<nome>.js`, `data/<nome>*.json`, `tools/build_<nome>*.ps1`. Não mexa em
  `index.html`, `src/app.js`, `src/mapa.js`, `sw.js` nem nos módulos dos outros. Se precisar de um gancho que não
  existe, diga na resposta final (o integrador acrescenta).
- **CSS**: o módulo injeta o próprio `<style id="mod-<nome>">` no `iniciar`, usando os tokens (`--panel`, `--panel-line`,
  `--tile`, `--ink`, `--ink-soft`, `--accent`, `--gold`, `--contour`, `--g-alta`, `--g-media`, `--g-ok`, `--r`,
  `--f-display`, `--f-body`, `--f-data`) e as classes que já existem: `.blk` + `h3` (bloco da ficha), `.group`/`.group-h`,
  `.btn`, `.btn--small`, `.btn--main`, `.seg2`, `.apt-modes`, `.row`, `.tag`, `.cc-warn`, `.cc-water`, `.cc-note`,
  `.hint`, `.stats3`, `.sr-only`. Prefixe classes novas com o nome do módulo. Funcione nos temas claro e escuro e no
  celular (≤ 700 px, alvos de toque ≥ 40 px).
- **Textos em português do Brasil**, curtos. Estimativas ditas como estimativas.
- **Dados pessoais só no aparelho** (localStorage/IndexedDB): o repositório é público — nada de valores pagos, números
  de reserva/voo ou nomes.
- **Rede**: chamadas em tempo de execução só a serviços sem chave e com CORS; sem sinal, o módulo funciona com o que
  guardou (Cache API `mod-<nome>-v1` ou localStorage) e diz a data do dado.
- **Acessibilidade**: `<button>`/`<label>` de verdade, nomes acessíveis, foco visível, nada só por cor.
- **Teste** no Chrome sem janela: `powershell -NoProfile -ExecutionPolicy Bypass -File tools/dev/navegador.ps1 -Porta
  <sua porta> -Passos passos.json` (servidor já em http://localhost:8001; `window.app.ext` mostra o que foi registrado).
- O integrador acrescenta ao `sw.js` (casco offline) os arquivos que o módulo criar: liste-os na resposta final.
