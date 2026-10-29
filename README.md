# OpenCode Model Pricing Plugin (`opencode-model-pricing`)

Plugin para o **OpenCode v2** que adiciona exibição detalhada dos custos de **Input**, **Output** e **Cache** (leitura/escrita) por milhão de tokens na seleção de modelos, com sincronização diária e interface dividida (Split-View) no OpenCode CLI (TUI).

---

## 🎯 Objetivos

1. **Transparência de Custos**: Exibir em tempo real quanto custa cada modelo em tokens de entrada, saída e cache antes de selecioná-lo.
2. **Interface Intuitiva no CLI**: Substituir a seleção padrão de modelos por uma janela modal ampla dividida em duas colunas:
   - **Esquerda**: Lista de modelos navegável com indicador de foco e provedor.
   - **Direita (Área Secundária)**: Card detalhado com os valores em USD por 1M tokens, janela de contexto máxima e limites de geração.
3. **Economia de Rede (Cache Diário)**: Buscar a tabela de preços apenas uma vez por dia (no primeiro acesso do dia ao OpenCode), persistindo os dados em storage local.
4. **Atualização Sob Demanda**: Disponibilizar um comando slash rápido para forçar a atualização imediata dos preços quando novos modelos forem lançados.

---

## 🚀 Recursos

- **Comando Único `/models`**: Substitui o comando nativo `model.list` sem duplicidades no menu slash.
- **Área Secundária de Precificação**:
  - `Input (Entrada)` por 1M tokens
  - `Output (Saída)` por 1M tokens
  - `Cache Read (Leitura de Cache)` por 1M tokens
  - `Cache Write (Escrita de Cache)` por 1M tokens
  - `Context Window` e `Max Output`
- **Sincronização Híbrida**: Integra custos nativos do OpenCode e matriz pública do `models.dev` (abrangendo OpenAI, Anthropic, Google Gemini, OpenRouter, DeepSeek, Qwen, etc.).
- **Comando `/update-model-prices`**: Força o download da matriz de preços atualizada a qualquer momento.
- **Teclas de Atalho no Modal**:
  - `↑` / `↓` ou `k` / `j`: Navega entre os modelos.
  - `PageUp` / `PageDown`: Pula blocos de modelos.
  - `Enter`: Seleciona o modelo para a sessão ativa e fecha a janela.
  - `Ctrl + F`: Alterna o modelo em foco como **Favorito (★)** (fixando-o no topo da lista).
  - `Ctrl + R`: Força a atualização da tabela de preços em tempo real diretamente da janela.
  - `Esc`: Fecha a janela modal sem alterar o modelo.

---

## 📦 Como Instalar

### 1. Clonar ou copiar o diretório do plugin

Coloque a pasta `opencode-model-pricing` dentro do diretório de plugins do OpenCode (por padrão `~/.config/opencode/plugins/`):

```bash
# Exemplo no Windows (PowerShell)
cd $env:USERPROFILE\.config\opencode\plugins\
# ou no Linux/macOS
cd ~/.config/opencode/plugins/
```

### 2. Registrar no arquivo de configuração

Abra o arquivo de configuração global `opencode.jsonc` (localizado em `~/.config/opencode/opencode.jsonc`) e adicione o caminho do plugin no array `"plugins"`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    "./plugins/opencode-model-pricing"
  ]
}
```

> **Dica**: O OpenCode v2 monitora alterações em arquivos de configuração e plugins automaticamente. Se o terminal já estiver aberto, digite `/reload` para aplicar as alterações imediatamente.

---

## 💻 Uso e Comandos

| Comando | Descrição |
|---|---|
| `/models` | Abre a janela modal ampla com a lista de modelos à esquerda e os valores de input, output e cache na área secundária à direita. |
| `/update-model-prices` | Força a sincronização imediata dos valores de preços via rede, atualizando o storage local. |

---

## 📁 Estrutura do Projeto

```text
opencode-model-pricing/
├── package.json        # Manifesto do plugin (exports para servidor, tui e rpc)
├── tsconfig.json       # Configurações TypeScript e JSX para OpenTUI/SolidJS
├── README.md           # Documentação e guia de uso
└── src/
    ├── rpc.ts          # Contrato RPC com Standard Schema para comunicação entre processos
    ├── pricing.ts      # Busca em models.dev, normalização e formatação monetária (USD)
    ├── index.ts        # Servidor OpenCode: verificação diária, storage e comando slash
    └── tui.tsx         # Interface TUI (CLI): Modal interativo xlarge com split-view e keymaps
```

---

## 📄 Licença MIT

MIT License

Copyright (c) 2026 OpenCode Model Pricing Plugin Contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
