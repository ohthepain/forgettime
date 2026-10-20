import { expect, test } from '@playwright/test';

test('painted outcomes, bar navigation, attack selection and Spectrum', async ({ page }) => {
  await page.goto('/');
  const detail = page.locator('.waveform-detail');
  for (const outcome of ['Correct', 'Missing', 'Extra']) {
    const pill = detail.getByRole('img', { name: new RegExp(`^${outcome} detection`) });
    await expect(pill).toBeVisible();
    // The original invalid HTML-in-SVG regression has no rendered box in Chromium.
    const box = await pill.boundingBox();
    expect(box?.width).toBeGreaterThan(15);
    expect(box?.height).toBeGreaterThan(10);
  }
  // Pixel comparisons catch missing paint, clipping, stacking and unreadable pills.
  await expect(detail).toHaveScreenshot('outcomes.png');
  await detail.getByRole('button', { name: 'Select desired attack 0.250000 seconds', exact: true }).click();
  await expect(page.getByLabel('Selected attack')).toHaveText('Selected frame 2000');
  await expect(page.getByTestId('annotation-marker-play')).toBeVisible();
  await expect(detail).toHaveScreenshot('selected.png');

  await page.locator('.waveform-overview-container').getByRole('button', { name: 'Edit training bar 2' }).click();
  await expect(page.getByLabel('Selected bar')).toHaveText('Bar 2');
  await expect(detail.getByRole('img', { name: 'Correct detection at 2.250000 seconds' })).toBeVisible();
  await expect(detail).toHaveScreenshot('bar-two.png');
  await page.getByRole('button', { name: 'Spectrum', exact: true }).click();
  await expect(page.getByTestId('mel-spectrogram')).toBeVisible();
  await expect(detail).toHaveScreenshot('spectrum.png');
  await detail.getByRole('button', { name: 'Select desired attack 2.250000 seconds', exact: true }).click();
  await expect(page.getByLabel('Selected attack')).toHaveText('Selected frame 18000');
  await page.getByRole('button', { name: 'Waveform', exact: true }).click();
  await expect(page.getByTestId('mel-spectrogram')).toHaveCount(0);
  await page.locator('.waveform-overview-container').getByRole('button', { name: 'Edit training bar 1' }).click();
  await expect(page.getByLabel('Selected bar')).toHaveText('Bar 1');
});
