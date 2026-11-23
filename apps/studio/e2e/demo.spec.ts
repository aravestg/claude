/**
 * Escenario obligatorio de demostración (sección 24) ejecutado en un navegador real con WebGL.
 * Evidencia observable de los criterios de aceptación.
 */
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.clear());
  await page.goto('/');
  await expect(page.locator('[data-testid=scene] canvas')).toBeVisible();
});

async function runToEnd(page: Page) {
  await page.getByTestId('run-simulation').click();
  await expect(page.getByTestId('sim-status')).toContainText('evento');
  const timeline = page.getByTestId('timeline');
  await timeline.fill((await timeline.getAttribute('max'))!);
}
const events = (page: Page) => page.getByRole('tab', { name: 'Eventos' }).click().then(() => page.getByTestId('event-list'));

test('A · comunicación exitosa, narración paso a paso y retroceso', async ({ page }) => {
  await runToEnd(page);
  await expect(page.getByTestId('sim-status')).toContainText('Éxito');
  const list = await events(page);
  for (const t of ['DNS_RESOLVED', 'RULE_EVALUATED', 'BACKEND_SELECTED', 'DATABASE_QUERY_COMPLETED', 'RESPONSE_RECEIVED']) await expect(list).toContainText(t);
  await page.getByRole('tab', { name: 'Paso' }).click();
  await page.getByTestId('timeline').fill('5');
  await page.getByTestId('step-back').click();
  await expect(page.getByTestId('sim-status')).toContainText('evento 5/');
  await page.getByTestId('step-forward').click();
  await expect(page.getByTestId('sim-status')).toContainText('evento 6/');
  await expect(page.getByTestId('event-inspector')).toContainText('Protocolo / puerto');
  await expect(page.getByTestId('event-inspector')).toContainText('Paso 6 /');
  await expect(page.locator('[data-component-label=user]')).toBeVisible();
  // el recorrido marca hitos alcanzados según los eventos
  await expect(page.getByRole('region', { name: 'Recorrido' })).toContainText('Resolver el nombre por DNS');
});

test('B · bloqueo en firewall → diagnóstico → corrección → re-simulación', async ({ page }) => {
  await page.getByTestId('scenario-select').selectOption('B-firewall-block');
  await page.getByRole('button', { name: 'Aplicar configuración' }).click();
  await expect(page.getByTestId('proposal-dialog')).toContainText('deny-https-maint');
  await page.getByTestId('approve-proposal').click();

  await runToEnd(page);
  await expect(page.getByTestId('sim-status')).toContainText('Falla');
  await expect(await events(page)).toContainText('ACCESS_DENIED');
  await expect(page.locator('[data-status-badge]').filter({ hasText: 'Denegado' })).toBeVisible();

  await page.getByRole('tab', { name: /Diagnóstico/ }).click();
  const rec = page.getByTestId('recommendation').first();
  await expect(rec).toContainText('bloquea HTTPS:443');
  await rec.getByRole('button', { name: 'Aceptar y previsualizar' }).click();
  await page.getByTestId('approve-proposal').click();

  await runToEnd(page);
  await expect(page.getByTestId('sim-status')).toContainText('Éxito');
  await expect(page.getByRole('region', { name: 'Comparación antes y después' })).toContainText('failure');
});

test('C · falla de base de datos con timeouts, reintentos y recomendaciones de resiliencia', async ({ page }) => {
  await page.getByTestId('scenario-select').selectOption('C-db-down');
  await runToEnd(page);
  await expect(page.getByTestId('sim-status')).toContainText('Falla');
  const list = await events(page);
  await expect(list).toContainText('RETRY_STARTED');
  await expect(list).toContainText('CONNECTION_TIMEOUT');
  await page.getByRole('tab', { name: /Diagnóstico/ }).click();
  await expect(page.getByTestId('recommendation')).toHaveCount(2);
  for (let i = 0; i < 2; i++) {
    await page.getByRole('button', { name: 'Aceptar y previsualizar' }).first().click();
    await page.getByTestId('approve-proposal').click();
  }
  await runToEnd(page);
  await expect(page.getByTestId('sim-status')).toContainText('Parcial');
  await expect(await events(page)).toContainText('FAILOVER_COMPLETED');
});

test('el modelo es persistente y la vista no altera la simulación', async ({ page }) => {
  await page.getByRole('button', { name: 'Planta' }).click();
  await runToEnd(page);
  const before = await (await events(page)).innerText();
  await page.getByRole('button', { name: 'Guardar' }).click();
  await page.reload();
  await expect(page.locator('[data-testid=scene] canvas')).toBeVisible();
  await runToEnd(page);
  expect(await (await events(page)).innerText()).toBe(before);
});

test('estilo ilustrado: el mensaje en vuelo proviene del evento y cambiar de estilo no altera la simulación', async ({ page }) => {
  await page.getByTestId('run-simulation').click();
  await expect(page.getByTestId('packet-caption').first()).toBeVisible();
  expect(((await page.getByTestId('packet-caption').first().textContent()) ?? '').length).toBeGreaterThan(0);
  await page.getByTestId('timeline').fill((await page.getByTestId('timeline').getAttribute('max'))!);
  const before = await (await events(page)).innerText();
  await page.getByTestId('style-toggle').click();
  await expect(page.getByTestId('style-toggle')).toContainText('Realista');
  await runToEnd(page);
  expect(await (await events(page)).innerText()).toBe(before);
});

test('árbol de escenarios y modo Diseñar', async ({ page }) => {
  await page.getByRole('button', { name: /Caída de una instancia/ }).click();
  await expect(page.getByTestId('lesson-title')).toContainText('Caída de una instancia');
  await page.getByTestId('mode-design').click();
  await expect(page.getByRole('tab', { name: 'Inspector' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Validación' })).toBeVisible();
});

test('importar un diagrama draw.io (AWS) → revisar → abrir en 3D → simular', async ({ page }) => {
  await page.getByTestId('open-import').click();
  await page.getByTestId('import-file').setInputFiles('../../packages/core-model/test/fixtures/aws-three-tier.drawio');
  const dialog = page.getByTestId('import-dialog');
  await expect(dialog).toContainText('Application Load Balancer');
  await expect(dialog).toContainText('alta · estilo');
  // corregir un tipo antes de importar
  await dialog.getByLabel('Tipo para Documentos').selectOption('data.nosql');
  await expect(dialog).toContainText('corregido');
  await page.getByTestId('import-confirm').click();
  await expect(dialog).toContainText('Supuestos registrados');
  await page.getByTestId('import-simulate').click();
  await expect(page.getByTestId('lesson-title')).toContainText('Flujo principal');
  const timeline = page.getByTestId('timeline');
  await expect(page.getByTestId('sim-status')).toContainText('evento');
  await timeline.fill((await timeline.getAttribute('max'))!);
  await expect(page.getByTestId('sim-status')).toContainText('Éxito');
  await expect(page.locator('[data-component-label]').filter({ hasText: 'Orders' }).first()).toBeVisible();
  // los escenarios generados aparecen en el árbol
  await expect(page.getByRole('button', { name: /Bloqueo en AWS WAF/ })).toBeVisible();
});

test('importar rechaza archivos no válidos sin romper la app', async ({ page }) => {
  await page.getByTestId('open-import').click();
  await page.getByTestId('import-file').setInputFiles({ name: 'malo.drawio', mimeType: 'application/xml', buffer: Buffer.from('<!DOCTYPE x [<!ENTITY a "b">]><mxfile/>') });
  await expect(page.getByTestId('import-dialog')).toContainText('DTD');
});
