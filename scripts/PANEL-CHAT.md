# Chat e presença no Control Panel

O chat aparece num botão recolhido, com o contador online, no ecrã de entrada
e depois do login. Cada pessoa escolhe um nome e envia mensagens até 280
caracteres. Os nomes são identificadores escolhidos, sem verificação de identidade.
As mensagens são renderizadas como texto, incluindo qualquer HTML recebido.

## Atualizar o Apps Script sem substituir código existente

1. No MESMO projeto que já tem `Code.gs` e `PanelAlert.gs`, clicar em **+ →
   Script** e criar `PanelChat.gs`.
2. Copiar o conteúdo de `panel-chat-apps-script-extension.gs` para esse novo
   ficheiro (apagar apenas o `myFunction` inicial). Não alterar `PanelAlert.gs`.
3. No `doGet(e)` existente de `Code.gs`, dentro do `try`, depois da validação
   do token, acrescentar apenas:

   ```javascript
   if (p.action === 'chatRead' || p.action === 'chatSend') {
     return taskLogJsonp_(callback, sharedPanelChat_(p));
   }
   ```

   Preservar os blocos `alertRead`/`alertSend`, tarefas, To-do's e todas as
   outras funções. Não criar um segundo `doGet` nem substituir o ficheiro todo.
4. Guardar. **Deploy → Manage deployments → selecionar a implementação
   existente → lápis → New version → Deploy**. Manter o URL e as permissões.
5. Abrir o dashboard em dois browsers/dispositivos. O contador deve mostrar
   dois online. Abrir mais uma tab no mesmo browser não deve aumentar o total.
   Enviar uma mensagem num browser e confirmar a receção no outro em até
   cerca de 15 segundos. Fechar um browser e confirmar a redução do contador
   após cerca de 90 segundos, mais o próximo ciclo de atualização.

A alteração no Git/Neocities não atualiza o Apps Script. Sem o novo deployment,
o chat mostra ligação indisponível e impede envios; o alerta continua a usar
as suas ações e o seu estado anteriores.

## Como funciona

Cada página envia um heartbeat e consulta mensagens a cada 15 segundos. O
contador agrupa as tabs pelo ID aleatório guardado no armazenamento local do
browser. Não identifica pessoas: browsers, perfis, incógnito e dispositivos
diferentes contam separadamente. Sem armazenamento local, cada página conta
separadamente. O ID não é enviado aos outros participantes. Páginas que não
respondem por 90 segundos deixam de contar; browsers podem suspender tabs em
segundo plano, pelo que o contador é aproximado.

O servidor guarda mensagens até 24 horas, no máximo 30, reduzindo o número
quando necessário para respeitar o limite de 8 KB em UTF-8. É um histórico
curto, sem arquivo permanente. Há um intervalo de 2 segundos por browser entre
envios. Um reenvio com o mesmo ID não duplica mensagens ainda no histórico.
O nome fica guardado localmente nesse browser. O chat usa propriedades com
prefixos próprios, preservando as propriedades existentes de alertas e tarefas.

O chat está disponível antes do login e o token atual consta do HTML público:
não é um canal privado. Não partilhar informação confidencial. O polling usa
quota do Apps Script; esta solução destina-se a uma equipa pequena.

## Testes

```bash
node scripts/test-panel-chat.cjs
node scripts/test-panel-alert.cjs
node scripts/test-task-log.cjs
PYTHONDONTWRITEBYTECODE=1 python3 scripts/test-task-capture.py
```
