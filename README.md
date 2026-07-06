# Conferencia Estoque 4.0

Sistema web para conferencia diaria ou semanal de estoque a partir de relatorios PDF.

## Funcionalidades

- Importacao de PDF com extracao de ID, produto, reservados, quantidade e bobinas.
- Conferencia com QTD fisica editavel e diferenca em tempo real.
- Comparacao com relatorio anterior do mesmo estoque.
- Status de itens alinhados, faltando, sobrando e pendentes.
- Marcacao de itens adicionados, removidos e alterados para recontagem.
- Historico por estoque e por produto.
- Backup e restauracao dos dados em JSON.

## Desenvolvimento

```bash
npm install
npm run dev
```

## Testes

```bash
npm test
```

## Build

```bash
npm run build
```

O app e estatico e pode ser publicado na Vercel.
