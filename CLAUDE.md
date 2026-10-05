# Viagem de motorhome — guia para o Claude Code

"Super app" da viagem de motorhome de um casal pela Costa Oeste dos EUA, de 19/10 a 01/11/2026 (13 dias, ~3.600 km):
LAX → Joshua Tree → Kingman → Grand Canyon (2) → Page → Zion (2) → Death Valley → Yosemite (2) → Half Moon Bay →
Morro Bay → LAX. Dono: João Salgado. Toda a interface e a conversa são em **português do Brasil**.
Feito em 04/10/2026: mapa interativo com o trecho de cada dia, os 145 opcionais de cada dia, fotos e descrição dos
pontos, demonstração animada de cada dia e módulos extras (clima, checklist/reservas, gastos, modo na estrada, agenda .ics,
perfil de altitude, diário, mapa topográfico para usar sem sinal).

Origem dos dados: a planilha `C:\Users\JoaoS\OneDrive\Área de Trabalho\Viagem Motorhome Costa Oeste EUA - out-nov 2026.xlsx`
(abas Painel, Roteiro, Veiculos, Orcamento, Reservas, Riscos, Campings, Checklist; versão de 07/09/2026), feita numa
conversa no chat do claude.ai (que o Claude Code não acessa). O app é irmão do "Andrelândia Rural"
(`C:\Users\JoaoS\Downloads\andrelandia-projeto`): mesma cara (cores, fontes, barra + painel, gaveta no celular).

## Rodar e conferir

```
powershell -NoProfile -ExecutionPolicy Bypass -File tools/serve.ps1        # http://localhost:8001 (sem Python/Node na máquina)
powershell -NoProfile -ExecutionPolicy Bypass -File tools/dev/navegador.ps1 -Saida shot.png [-Celular] [-Escuro] [-Js "..."] [-Passos passos.json]
```
- `navegador.ps1` abre um Chrome sem janela (CDP pelo WebSocket, SwiftShader), roda JS na página e tira prints;
  `-ManterPerfil -SemRede` testa o uso sem sinal de verdade (proxy morto: cai a rede da página, do service worker e do
  localhost; rodar antes uma vez com rede no mesmo `-Porta`). `-Porta` diferente permite rodar vários ao mesmo tempo.
- O service worker em produção serve tudo do guardado; no computador (`__VERSAO__` sem trocar) vale a rede primeiro.
  Para testar o modo de produção: copiar o app para outra pasta, trocar `__VERSAO__` no sw.js e servir em outra porta.
- O painel do navegador do app (Browser pane) fica escondido em segundo plano: aí `requestAnimationFrame` para e o mapa
  não termina de carregar. Use o `navegador.ps1` para conferir. O `preview_start` desta sessão lia o `launch.json` da
  pasta antiga (Andrelândia); o `serve.ps1` foi rodado em segundo plano.
- `window.app` expõe `{ mapa, abrirDia, mostrarViagem, abrirOpcional, showPane, setSheet, setCollapsed, usaB, ext, ctx }`
  (`app.mapa.map` é o mapa MapLibre; `app.ext` mostra o que os módulos registraram; `app.ctx` é o ctx dos módulos).
- Trabalho grande foi feito com workflows multiagente (construção → revisão cética; teste → confirmação); os agentes só
  editam os arquivos do próprio módulo e o integrador (a sessão principal) mexe em app.js, mapa.js, sw.js e index.html.

**Site:** https://joaoapsalg-ux.github.io/viagem-motorhome/ — repositório público
https://github.com/joaoapsalg-ux/viagem-motorhome. Cada push na `main` publica sozinho (`.github/workflows/pages.yml`).
Git e GitHub CLI: `C:\Program Files\Git\cmd\git.exe` e `C:\Program Files\GitHub CLI\gh.exe`; commits com o e-mail
noreply do GitHub. Por ser público: **nada de números de voo, de reserva, valores pagos ou dados pessoais** no repositório.

## Estrutura

```
index.html        HTML completo + CSS (tokens claro/escuro do Andrelândia; Barlow / Barlow Condensed / IBM Plex Mono).
                  Barra (#rail: Roteiro · Mapa · Preparar · Gastos · Alertas · Sobre) + painel (#pane, largura
                  ajustável, recolhível);
                  ≥701 px o painel empurra o mapa (no tablet, no máximo 45% da tela); ≤700 gaveta (meia/alta/baixa),
                  com a bússola embaixo à direita acima da gaveta
src/app.js        dados, estado (dia escolhido, plano A/B por dia), lista dos dias, ficha do dia, alertas, opcionais,
                  gaveta/painel (padding do mapa = parte coberta), tema, link #dia=N, "onde estou", sem sinal
src/mapa.js       MapLibre GL JS 6.11.2 (ESM do jsDelivr): estilo OpenFreeMap (liberty/dark) + sombra do relevo
                  (Mapterhorn, terrarium 512) + satélite USGS + camadas da viagem (r-ativa, r-alt, r-shuttle, r-opc,
                  r-setas, r-toque); marcadores HTML reaproveitados por chave (pernoites, número do dia, paradas);
                  arrumação em 2 passadas (pontos primeiro; paradas do dia nunca somem; nomes abrem à direita ou à
                  esquerda); margem do painel/gaveta aplicada antes de cada enquadramento (setPadding não interrompe
                  câmera); sem sinal usa o estilo do outro tema se o pedido não estiver guardado; sem sinal o 'load'
                  é "cutucado" (triggerRepaint), senão às vezes não chegava; camada 'topo' (USGS Topo) só aparece sem
                  sinal e quando falta no cache algum bloco do mapa normal da vista (#conferirTopo, senão nomes dobram)
src/tilecache.js  protocolo tc:// → Cache API (guardado primeiro; estilo/letras/ícones atualizados em segundo plano;
                  bloco usado volta ao fim da fila e o aparar, 1×/abertura, apaga os menos usados acima de 5.000;
                  caches.match acha também os blocos do pacote 'mapa-pacote-v1', que não são copiados para cá)
src/mod/*.js      módulos (contrato em src/mod/LEIAME.md; lista MODULOS no app.js; arquivos no CASCO do sw.js):
                  clima (previsão Open-Meteo 16 dias + normal da época em data/clima.json), preparar (checklist,
                  reservas, "Levar meus dados" — exporta o localStorage sem '.cache' no nome; data/checklist.json,
                  data/reservas.json), gastos, estrada (cartão com GPS: km feitos, próxima parada, posto, sol), agenda
                  (.ics), perfil (altitude do trecho; data/perfis.json de tools/build_perfil.ps1), diario (notas e
                  fotos no IndexedDB, "Baixar o diário" em .html), pacote (baixa o USGS Topo ao longo da viagem para
                  'mapa-pacote-v1'), demo (demonstração animada de cada dia e "A viagem em 2 minutos")
data/fotos.json   foto (Wikimedia Commons, hotlink 960/500 px, crédito e licença) e descrição de cada ponto ('p:<id>');
                  sem foto: locadora, hotel_lax, mt_carmel, new_priest
src/util.js       store (localStorage 'viagem-motorhome.'), formatos pt-BR, cores dos dias, ícones SVG
sw.js             service worker: casco do app num cache por versão (instalação tudo ou nada; __VERSAO__ trocado no
                  deploy) e MapLibre + fontes do Google num cache fixo (libs-v1); em produção, guardado primeiro
data/roteiro.json dias (de/para, fuso, rota, paradas, pernoite, notas, planoB {rota, quando, paradas, pernoite?,
                  de/para?, acompanha?}, usarB = motivo para começar no plano B, navegar_sem = paradas que ficam fora
                  do link do Google Maps porque estão no caminho), fim, opcionais, notasPontos
data/rotas.geojson 20 linhas (d01–d13, planos B d06b/d09b/d12b/d13b, opcionais o1–o3), com km, horas (carro), trechos
data/pontos.json  68 pontos { nome, lat, lon }
data/alertas.json situação de estradas/parques conferida na web em 04/10/2026 (itens com gravidade, dias, fontes)
data/opcionais.json opcionais de cada dia (trilha, mirante, passeio, atracao, comida, pratico): coordenadas, duração,
                  acesso, custo, reserva, motorhome, estado em out/2026; 'etapa' = O1–O3. O app mostra na ficha do dia
                  (na ordem do caminho, filtro por tipo, estrela "quero fazer" guardada no aparelho) e no mapa
tools/build_rotas.ps1 + rotas_entrada.json   pontos (conferidos no Nominatim) e rotas (OSRM; routing.openstreetmap.de
                  para o shuttle de Zion); passagens "~id" forçam o caminho (ex.: New Priest Grade); cache em tools/cache
tools/make_icons.ps1  ícones PNG (System.Drawing)
```

## Decisões

- Tempos: OSRM é tempo de carro; o app mostra também "motorhome" = carro × 1,25 (estimativa, dito na tela).
- Planos B: dia 6 começa no desvio por Hurricane (SR-9/túnel de Zion fechada por queda de rochas desde 30/09/2026);
  dia 9 (Tioga fechada → Bakersfield + Hwy 41, 762 km); dia 12 (Hwy 1 fechar → US-101, dorme em Santa Bárbara) e o
  dia 13 acompanha o 12. A escolha de cada um fica guardada no aparelho (`rota.N`).
- A locadora (ponto `locadora`, saída do d01 e chegada do d13/d13b) está no aeroporto como aproximação: trocar as
  coordenadas em tools/rotas_entrada.json quando souber o endereço e rodar o build_rotas.ps1. O pernoite do dia 13 é
  `hotel_lax` (separado). O d11 passa pelo ponto `new_priest` (New Priest Grade), que também vai no link do Google Maps.
- Offline: os OpenFreeMap Terms proíbem baixar em massa sem permissão — o mapa normal só guarda o que foi visto. Para
  usar sem sinal há o pacote do USGS Topo (domínio público, exportação permitida; módulo pacote, no Sobre): Básico
  ~1.500–2.100 blocos, Completo ~6.600–9.400. Outras alternativas estudadas: pedir permissão à OpenFreeMap; .pmtiles
  próprio extraído da Protomaps no Actions.
- Antelope Canyon é opcional (decisão do João): prioridade 'vale' nos opcionais e "Opcional" nas reservas.
- Alertas são um retrato de 04/10/2026; o app diz a data e manda conferir na véspera.
- Tema claro por padrão (o João pediu); "Automático" e "Escuro" ficam guardados se escolhidos.
- "Tempo do dia": horas de luz (nascer no começo, pôr no fim, cada um no seu fuso: `utc` [início, fim] no roteiro;
  dia 1 começa às 14h, `livre_desde`; dia 13 tem `prazo` de devolução) × estrada de motorhome + opcionais marcados.

## Preferências do João

- Responder em português, curto. Quando ele pergunta "como melhorar", oferecer uma lista numerada e deixar ele escolher.
- Pedir permissão antes de baixar qualquer arquivo (dizer nome, origem e tamanho).
- Testar antes de entregar e dizer o que não foi testado (ex.: GPU real, celular de verdade).

## Pendências

- Downloads já feitos com autorização do João (04/10): perfil de altitude (Open-Meteo elevation → data/perfis.json),
  normal da época (archive-api Open-Meteo → data/clima.json) e teste do pacote (blocos do USGS Topo só no Chrome de
  teste; passou do combinado de ~300 — não baixar mais sem pedir).
- Para o João decidir: os dias 13 e 12b passam pela SR-154 (San Marcos Pass, ~660 m, rampas de ~8%); a US-101 por
  Gaviota é mais suave para motorhome.
- Ganchos sugeridos pelos módulos (não obrigatórios): `ctx.enquadrarDia(n)`, `ctx.margemMapa()` (estrada e demo usam
  `ctx.mapa().setPadding`), `ctx.ligarGPS()`/`gpsLigado()` (estrada clica no #locate), previsão do clima no ctx (a demo
  mostra só a normal), aviso aos módulos depois do "Juntar". O diário não vai no "Levar meus dados" (só no .html).
- Fotos dos opcionais ('o:<id>') ainda não pesquisadas (só a do Antelope, 'o:page_antelope_canyon'); as dos 4
  pontos sem foto também não. 'p:lax' tem foto, mas nenhum lugar do app a mostra (o fim da viagem usa locadora/hotel_lax).
- parks.ca.gov recusa conexão do Brasil (links oficiais dos opcionais da costa; nos EUA devem abrir).
- Agendada para 17/10 9h a nova pesquisa dos alertas (tarefa "viagem-motorhome-alertas").