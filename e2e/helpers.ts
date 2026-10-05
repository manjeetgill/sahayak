import { expect, type Page } from '@playwright/test';
import pg from 'pg';

export const DB = () =>
  new pg.Client({
    connectionString:
      process.env.ADMIN_DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:55450/sahayak',
  });
export async function login(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('demo1234');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/(doctor|console)$/);
}
export async function simSend(page: Page, text: string) {
  await page.getByLabel('Message').fill(text);
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByTestId('chat')).toContainText(text.slice(0, 20));
}
