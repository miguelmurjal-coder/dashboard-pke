# Log Tarefas V2

O assistente local observa apenas a aplicacao e janela em primeiro plano. Nao
regista teclas, conteudo das paginas nem tabs em segundo plano. Para ao fim de
3 minutos sem interacao e ignora passagens inferiores a 30 segundos.

## Arranque

No Terminal, dentro da pasta oficial do Dashboard:

```bash
python3 scripts/pke-task-capture.py --owner "Miguel"
```

Para o iniciar automaticamente sempre que entras no Mac:

```bash
python3 scripts/install-task-capture.py --owner "Miguel"
```

O instalador copia apenas o assistente para
`~/Library/Application Support/PKE Task Log/`. Isto e necessario porque o
macOS nao permite que um processo de fundo execute diretamente a partir da
iCloud Drive. O projeto e o codigo oficial continuam na pasta da iCloud.

O ficheiro privado e atualizado em `~/Downloads/pke-task-drafts.json`. No MCP,
abre `Ferramentas > Log Tarefas`, carrega em **Importar atividade**, revê a
timeline e usa **Confirmar e partilhar**. Ate esse momento nada e enviado para
o Google Sheets nem fica visivel ao colega.

Na primeira execucao o macOS pode pedir autorizacao para o Terminal controlar
System Events, Chrome ou Safari. Essa autorizacao serve apenas para ler o nome
da janela/tab ativa.

Se o Google Calendar estiver sincronizado com a aplicacao Calendar do macOS,
o assistente usa o titulo do evento para identificar reunioes confirmadas por
Meet, Zoom ou Teams. Eventos que ficaram apenas no calendario nao contam como
tempo trabalhado.

## Regras iniciais

- YouTube e Murjal98 contam como pausa apenas quando estao em primeiro plano.
- Audio ou video em segundo plano nao altera a tarefa ativa.
- Mudancas com menos de 30 segundos sao descartadas.
- Apos 3 minutos sem rato/teclado, o bloco e terminado.
- Regresso a mesma tarefa em menos de 3 minutos junta os segmentos.
- A classificacao e uma sugestao e pode ser corrigida antes da partilha.
