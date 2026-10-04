# Viagem de motorhome — guia para o Claude Code

"Super app" da viagem de motorhome de um casal pela Costa Oeste dos EUA, de 19/10 a 01/11/2026 (13 dias, ~3.600 km):
LAX → Joshua Tree → Kingman → Grand Canyon (2) → Page → Zion (2) → Death Valley → Yosemite (2) → Half Moon Bay →
Morro Bay → LAX. Dono: João Salgado. Toda a interface e a conversa são em **português do Brasil**.
Etapa 1 (04/10/2026): mapa interativo com o trecho de cada dia. Próxima ideia do João: mapear os **opcionais de cada dia**
(passeios, trilhas, mirantes que dá para fazer em cada parada).

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
- `window.app` expõe `{ mapa, abrirDia, mostrarViagem, abrirOpcional, showPane, setSheet, setCollapsed, usaB }`
  (`app.mapa.map` é o mapa MapLibre).

**Site:** https://joaoapsalg-ux.github.io/viagem-motorhome/ — repositório público
https://github.com/joaoapsalg-ux/viagem-motorhome. Cada push na `main` publica sozinho (`.github/workflows/pages.yml`).
Git e GitHub CLI: `C:\Program Files\Git\cmd\git.exe` e `C:\Program Files\GitHub CLI\gh.exe`; commits com o e-mail
noreply do GitHub. Por ser público: **nada de números de voo, de reserva, valores pagos ou dados pessoais** no repositório.

## Estrutura

```
index.html        HTML completo + CSS (tokens claro/escuro do Andrelândia; Barlow / Barlow Condensed / IBM Plex Mono).
                  Barra (#rail: Roteiro · Mapa · Alertas · Sobre) + painel (#pane, largura ajustável, recolhível);
                  ≥701 px o painel empurra o mapa (no tablet, no máximo 45% da tela); ≤700 gaveta (meia/alta/baixa),
                  com a bússola embaixo à direita acima da gaveta
src/app.js        dados, estado (dia escolhido, plano A/B por dia), lista dos dias, ficha do dia, alertas, opcionais,
                  gaveta/painel (padding do mapa = parte coberta), tema, link #dia=N, "onde estou", sem sinal
src/mapa.js       MapLibre GL JS 6.11.2 (ESM do jsDelivr): estilo OpenFreeMap (liberty/dark) + sombra do relevo
                  (Mapterhorn, terrarium 512) + satélite USGS + camadas da viagem (r-ativa, r-alt, r-shuttle, r-opc,
                  r-setas, r-toque); marcadores HTML reaproveitados por chave (pernoites, número do dia, paradas);
                  arrumação em 2 passadas (pontos primeiro; paradas do dia nunca somem; nomes abrem à direita ou à
                  esquerda); margem do painel/gaveta aplicada antes de cada enquadramento (setPadding não interrompe
                  câmera); sem sinal usa o estilo do outro tema se o pedido não estiver guardado
src/tilecache.js  protocolo tc:// → Cache API (guardado primeiro; estilo/letras/ícones atualizados em segundo plano;
                  bloco usado volta ao fim da fila e o aparar, 1×/abertura, apaga os menos usados acima de 5.000)
src/util.js       store (localStorage 'viagem-motorhome.'), formatos pt-BR, cores dos dias, ícones SVG
sw.js             service worker: casco do app num cache por versão (instalação tudo ou nada; __VERSAO__ trocado no
                  deploy) e MapLibre + fontes do Google num cache fixo (libs-v1); em produção, guardado primeiro
data/roteiro.json dias (de/para, fuso, rota, paradas, pernoite, notas, planoB {rota, quando, paradas, pernoite?,
                  de/para?, acompanha?}, usarB = motivo para começar no plano B), fim, opcionais, notasPontos
data/rotas.geojson 20 linhas (d01–d13, planos B d06b/d09b/d12b/d13b, opcionais o1–o3), com km, horas (carro), trechos
data/pontos.json  65 pontos { nome, lat, lon }
data/alertas.json situação de estradas/parques conferida na web em 04/10/2026 (itens com gravidade, dias, fontes)
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
- Offline: os OpenFreeMap Terms proíbem baixar em massa sem permissão — por isso **não há** botão "baixar o mapa da
  viagem"; fica guardado o que foi visto. Alternativas estudadas: pedir permissão à OpenFreeMap; pacote do USGS
  (domínio público, exportação permitida); .pmtiles próprio extraído da Protomaps no Actions.
- Alertas são um retrato de 04/10/2026; o app diz a data e manda conferir na véspera.

## Preferências do João

- Responder em português, curto. Quando ele pergunta "como melhorar", oferecer uma lista numerada e deixar ele escolher.
- Pedir permissão antes de baixar qualquer arquivo (dizer nome, origem e tamanho).
- Testar antes de entregar e dizer o que não foi testado (ex.: GPU real, celular de verdade).
