# Estrutura

Este app e modularizado por responsabilidade:

- `main.js`: orquestra estado, eventos e renderizacao das telas.
- `domain/`: regras de negocio de conferencia, diferenca e status.
- `state/`: persistencia local, backup e restore.
- `import/`: reservado para leitura e parsing de relatorios PDF.
- `ui/`: reservado para componentes compartilhados.
- `views/`: reservado para telas separadas quando a UI for quebrada em modulos.
- `styles/`: CSS da aplicacao.

O projeto continua funcionando como site estatico, mas tambem esta pronto para rodar com Vite.
