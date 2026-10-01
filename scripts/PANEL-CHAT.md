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


## Nickname guardado e nomes online

O campo **O teu nickname**, no ecrã de entrada, usa o mesmo nome do chat.
Fica guardado em `localStorage` e volta a aparecer após recarregar ou reabrir o
browser, até ser alterado ou os dados do site serem apagados. Não é uma conta
nem substitui a password. Alterações ao nickname sincronizam-se entre tabs do
mesmo browser. Perfis e dispositivos diferentes têm armazenamento independente.

O contador mostra, por exemplo, **3 Users Online — Verónica, smudge44, Tiago**.
Quem ainda não escolheu um nome aparece como **Sem nickname**. O nome escolhido
passa a aparecer nas novas mensagens; as mensagens antigas mantêm o nome usado
na altura do envio. Os nomes, tal como as mensagens, são renderizados como texto.

Se já instalaste `PanelChat.gs`, atualiza SOMENTE esse ficheiro com o conteúdo
atual de `panel-chat-apps-script-extension.gs` e publica uma nova versão da
implementação existente. Não alteres `Code.gs` nem `PanelAlert.gs`; o bloco de
encaminhamento `chatRead`/`chatSend` continua igual. A atualização conserva o
histórico e as restantes Script Properties. Com a versão anterior do backend,
o chat funciona e mostra apenas o total, até a lista de nomes estar disponível.

## Alertas no telefone

Com a página aberta e ativa, tocar em **Ativar som neste browser** permite
ouvir os alertas. A vibração depende do dispositivo e do browser; não há suporte
uniforme no iPhone. Com o browser suspenso, a página fechada ou o ecrã bloqueado,
o polling e o áudio não garantem a entrega.

Para receber nesses casos é necessária uma integração de push, ainda não
implementada: Web Push com service worker e servidor de envio, ou um serviço
com aplicação móvel de notificações. No iPhone, Web Push requer iOS/iPadOS 16.4+
e uma web app adicionada ao ecrã principal, com permissão de notificações.
A escolha depende do telefone e de se é necessário receber em segundo plano.

## Recuperação de ligação

A página mantém filas independentes para leituras de chat, leituras de alertas e
envios. Um envio começa sem esperar por leituras lentas; os envios entre si
continuam em sequência. Cada pedido pode aguardar até 25 segundos.
Uma falha transitória após uma leitura recente mostra **A restabelecer ligação**;
as mensagens anteriores são conservadas, mas o total anterior é identificado
como **Última leitura**, em vez de apresentado como presença atual.

Após três falhas seguidas ou 90 segundos sem sucesso, o serviço fica indisponível.
Erros explícitos de configuração devolvidos pelo servidor ficam indisponíveis
imediatamente. A reconexão é automática, com um intervalo maior entre tentativas
quando há falhas. A mensagem de erro devolvida passa a aparecer no ecrã para
permitir diagnosticar o problema; estas medidas não garantem disponibilidade do
Apps Script nem demonstram a causa das falhas no serviço publicado.

Esta atualização exige apenas publicar o HTML; não requer alterar o Apps Script.
Teste adicional: `node scripts/test-panel-connection.cjs`.


## Otimização de ligação e envio

A ligação inicial do chat começa imediatamente. Com o chat aberto, a consulta
é feita a cada 5 segundos após a resposta; recolhido, a cada 15 segundos. A
consulta de alertas mantém o intervalo de 4 segundos após a resposta. Tempos
reais incluem a latência do Apps Script e browsers suspensos podem atrasar tudo.
Não há uma promessa de entrega instantânea.

O HTML otimizado é compatível com os deployments anteriores. Para aplicar a
redução de trabalho no servidor, substituir SOMENTE os ficheiros `PanelAlert.gs`
e `PanelChat.gs` pelos ficheiros `panel-alert-apps-script-extension.gs` e
`panel-chat-apps-script-extension.gs`, respetivamente. Manter `Code.gs` e o seu
`doGet`, que não precisam de novas ações. Guardar e atualizar a implementação
existente para **New version → Deploy**.

A leitura de alertas passa a consultar uma cópia consistente das Script
Properties sem aguardar pelo lock de gravação. Os envios mantêm o lock para
não perder eventos concorrentes. As consultas de chat atualizam a presença,
mas deixam de regravar o histórico de mensagens; as gravações de mensagens
continuam protegidas pelo lock. Estes ficheiros mantêm as chaves e os dados
existentes. A aplicação da otimização no servidor exige este deployment manual.
