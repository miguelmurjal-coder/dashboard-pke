# dashboard-pke
Dashboard PKE MKT

## Comparar audiencias MailerLite Classic

A API Classic nao disponibiliza os destinatarios/atividade por campanha. Para comparar duas newsletters:

1. Exportar o CSV de subscriber activity da newsletter antiga para `exports/mailerlite-manual/nl-multichoice-1.csv`.
2. Exportar o CSV de subscriber activity da newsletter recente para `exports/mailerlite-manual/nl-luz-painel-fap-28-07-26.csv`.
3. Correr:

```bash
node scripts/compare-mailerlite-exported-csvs.mjs
```

Os resultados ficam em `exports/mailerlite-manual/result/`.
