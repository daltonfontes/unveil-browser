# Contribuindo com o Unveil

Obrigado pelo interesse. O Unveil tem duas promessas: ser leve e não rastrear ninguém. Vale ler isto antes de mandar uma mudança.

## Reportando bugs

Abra uma issue contando:
- o que você fez;
- o que esperava;
- o que aconteceu;
- sua versão do Windows e a do Unveil (está em `chrome://version`).

Para qualquer coisa visual, um print ajuda muito. Se for uma falha, diga em qual página ou ação ela aconteceu.

## Preparando o ambiente

Você precisa de Node 22.18 ou mais novo. Para mudanças nativas, também de um checkout do Chromium; a lista completa está no [README.md](README.md#compilar).

```powershell
npm ci
npm run typecheck
npm test
```

## Dois tipos de mudança

**Mudanças na shell** (qualquer coisa em `chromium/shell/`) não exigem compilar o Chromium. É aqui que acontece a maior parte do trabalho:

```powershell
npm run shell:watch          # ou: npm run shell:build
chromium\scripts\run.ps1     # reabre o build de desenvolvimento com a shell nova
npm run test:e2e             # a shell num Chromium real
```

**Mudanças nativas** (qualquer coisa que o próprio Chromium precise fazer) são patches sobre o checkout do Chromium, guardados em `chromium/patches/` como diffs unificados simples.

### Escrevendo um patch

1. Rode `chromium\scripts\apply.ps1` para o checkout ficar com todos os patches atuais.
2. Edite o checkout em `$CHROMIUM_SRC` (veja o `chromium/scripts/env.ps1`).
3. Transforme sua edição em patch, numerado depois do último:
   - se a mudança é independente, crie um arquivo novo com `git diff > chromium\patches\00NN-nome-curto.patch`, só com a sua edição;
   - se complementa um patch que já existe, gere de novo o diff daquele patch para os arquivos que ele cobre.
4. Rode `chromium\scripts\apply.ps1` de novo, sozinho. Ele desfaz tudo e aplica todos os patches em ordem, provando que o conjunto ainda aplica sem conflito.
5. Rode `npm run check-patches`, que faz a mesma checagem contra a tag do Chromium, como na CI.
6. Compile com `chromium\scripts\build.ps1` e teste.

Mantenha cada patch pequeno e sobre um assunto só. Nas edições dentro dos arquivos do Chromium, deixe comentários `// Unveil:` explicando o porquê. Sempre que der, coloque código novo em arquivos novos, para que atualizar o Chromium doa menos.

## Privacidade

Nenhuma mudança pode fazer o Unveil enviar algo sobre a pessoa sem ela pedir: nada de telemetria, contadores de uso ou checagens de fundo em servidores nossos ou de terceiros.

Se um recurso precisa de rede, ele só acessa a rede quando a pessoa usa aquele recurso, e o pull request diz para onde vai cada requisição.

## Estilo

- Siga o código ao redor: nomes, estrutura, formatação. O TypeScript é estrito e o `npm run typecheck` precisa passar.
- Comentários explicam o porquê, não o quê.
- Nada de dependência nova sem motivo. A shell é empacotada pelo esbuild numa extensão MV3 e deve continuar pequena.
- Se mudar algo visível, confira nos temas claro e escuro, em português e em inglês, e anexe um print ao pull request.

## Commits

Faça commits pequenos e focados, uma ideia por commit:

```
feat(chromium): o instalador traz a shell e o initial_preferences
fix(shell): a nova guia volta a focar a caixa de comandos
docs: README explica como atualizar o Chromium
```

Use `feat`, `fix`, `docs`, `refactor` e `chore`, com escopo (`chromium`, `shell`) quando ajudar.
