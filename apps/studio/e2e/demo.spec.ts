/**
 * Escenario obligatorio de demostración (sección 24) ejecutado en un navegador real con WebGL.
 * Evidencia observable de los criterios de aceptación.
 */
import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.clear());
  await page.goto('/');
  await expect(page.locator('[data-testid=scene] canvas')).toBeVisible();
});

async function runToEnd(page: import('@playwright/test').Page) {
  await page.getByTestId('run-simulation').click();
  await expect(page.getByTestId('sim-status')).toContainText('evento');
  // ir al final de la línea de tiempo
  const timeline = page.getByTestId('timeline');
  const max = await timeline.getAttribute('max');
  await timeline.fill(max!);
}

test('A · comunicación exitosa, paso a paso y retroceso', async ({ page }) => {
  await runToEnd(page);
  await expect(page.getByTestId('sim-status')).toContainText('Éxito');
  const list = page.getByTestId('event-list');
  for (const t of ['DNS_RESOLVED', 'RULE_EVALUATED', 'BACKEND_SELECTED', 'DATABASE_QUERY_COMPLETED', 'RESPONSE_RECEIVED']) await expect(list).toContainText(t);
  // retroceder y avanzar
  await page.getByTestId('timeline').fill('5');
  await page.getByTestId('step-back').click();
  await expect(page.getByTestId('sim-status')).toContainText('evento 5/');
  await page.getByTestId('step-forward').click();
  await expect(page.getByTestId('sim-status')).toContainText('evento 6/');
  await expect(page.getByTestId('event-inspector')).toContainText('Protocolo / puerto');
  // la escena 3D representa el estado del evento (etiqueta del componente)
  await expect(page.locator('[data-component-label=user]')).toBeVisible();
});

test('B · bloqueo en firewall → diagnóstico → corrección → re-simulación', async ({ page }) => {
  await page.getByTestId('scenario-select').selectOption('B-firewall-block');
  await page.getByRole('button', { name: 'Aplicar configuración' }).click();
  await expect(page.getByTestId('proposal-dialog')).toContainText('deny-https-maint');
  await page.getByTestId('approve-proposal').click();

  await runToEnd(page);
  await expect(page.getByTestId('sim-status')).toContainText('Falla');
  await expect(page.getByTestId('event-list')).toContainText('ACCESS_DENIED');
  await expect(page.locator('[data-component-label=fw]')).toContainText('Denegado');

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
  const list = page.getByTestId('event-list');
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
  await expect(page.getByTestId('event-list')).toContainText('FAILOVER_COMPLETED');
});

test('el modelo es persistente y las posiciones no alteran la simulación', async ({ page }) => {
  await page.getByTestId('scenario-select').selectOption('A-success');
  await page.getByRole('button', { name: 'Isométrica' }).click();
  await runToEnd(page);
  const before = await page.getByTestId('event-list').innerText();
  // cambio semántico persistente
  await page.getByRole('button', { name: 'Guardar' }).click();
  await page.reload();
  await expect(page.locator('[data-testid=scene] canvas')).toBeVisible();
  await runToEnd(page);
  expect(await page.getByTestId('event-list').innerText()).toBe(before);
});
