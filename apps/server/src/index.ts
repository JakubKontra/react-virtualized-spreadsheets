import { createDemoServer } from './server';
const app = await createDemoServer();
const port = Number(process.env.SHEET_PORT ?? 4317);
app.server.on('error', (error) => {
  console.error(error.message);
  void app.close().then(() => process.exit(1));
});
app.server.listen(port, '127.0.0.1', () =>
  console.log(`Spreadsheet API: http://127.0.0.1:${port}/api`),
);
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, () => {
    void app.close().then(() => process.exit(0));
  });
