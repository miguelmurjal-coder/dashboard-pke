# Alerta partilhado do Control Panel

O botão central envia um alerta para o Web App Apps Script existente. Todas as
páginas abertas consultam os novos eventos a cada 4 segundos, incluindo depois
do login. Não há sincronização limitada a tabs do mesmo computador. Cada evento
é deduplicado e expira ao fim de 60 segundos; quem abre a página não recebe
alertas anteriores. Há um intervalo mínimo global de 3 segundos entre envios.

## Ativar no site publicado

1. No projeto Apps Script do endpoint `TASK_LOG_WRITE_ENDPOINT`, acrescentar a
   função `sharedPanelAlert_` de `MKT-PKE-2026-COMPLETO.gs`.
2. No `doGet(e)` existente, depois da validação do token e antes das outras
   ações, acrescentar o bloco que encaminha `alertRead` e `alertSend` para
   `taskLogJsonp_(callback, sharedPanelAlert_(p))`. Preservar as outras ações e
   extensões existentes, incluindo To-do's.
3. Atualizar o deployment existente: **Deploy > Manage deployments > Edit >
   New version > Deploy**. Manter o mesmo URL e acesso que o Web App já utiliza.
4. Publicar o `index.html` atualizado pelo processo habitual do dashboard.
5. Abrir a página em dois browsers/dispositivos, ativar o som em ambos e
   carregar em **Chamar** num deles. Ambos devem mostrar o aviso e tocar o som.
   Confirmar também a receção num browser depois de entrar no painel.

A configuração e o deployment do Apps Script não são aplicados por editar o
ficheiro `.gs` no Git. Até o endpoint aceitar as novas ações, o botão fica
indisponível e o ecrã indica que não existe ligação ao alerta partilhado.

## Limites dos browsers

Cada pessoa deve clicar em **Ativar som neste browser** antes de poder ouvir
alertas remotos. O botão **Chamar** também ativa o som local. O browser pode
suspender áudio ou abrandar polling em tabs em segundo plano e em dispositivos
bloqueados; a entrega não é instantânea nem garantida com a página suspensa.

O aviso aparece visualmente e no título da tab. A página treme brevemente;
a janela do sistema não pode ser movida pelo site. `navigator.vibrate` é usado
quando disponível, respeitando a preferência por movimento reduzido. Não é
suportado por todos os browsers/dispositivos. Não são pedidas permissões para
notificações do sistema.

O alerta usa o token existente, já incluído no HTML público, pelo que não
constitui uma funcionalidade de acesso restrito. Não envia passwords, nomes
nem dados pessoais; guarda apenas ID, sequência e instante dos eventos nas
Script Properties do Apps Script. O polling consome a quota do Web App e deve
ser revisto se o número de páginas abertas crescer muito.

## Verificação local

```bash
node scripts/test-panel-alert.cjs
node scripts/test-task-log.cjs
PYTHONDONTWRITEBYTECODE=1 python3 scripts/test-task-capture.py
```

O primeiro teste valida estado partilhado, leitura inicial sem repetição,
deduplicação, intervalo mínimo, expiração, lock e encaminhamento autenticado.
