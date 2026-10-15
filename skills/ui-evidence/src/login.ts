// Shared env-var sign-in for the parity driver and the plain script runner.
// Credentials come only from environment variables (host-guard's
// readCredentials); this module holds the schema and the form driver.
import type { Page } from "playwright";
import { z } from "zod";

const ENV_NAME = /^[A-Z][A-Z0-9_]*$/;

/** Env var names + CSS selectors only; never a literal credential. Strict: a misspelt key fails the parse. */
export const LoginSchema = z
  .object({
    emailEnv: z.string().regex(ENV_NAME),
    passwordEnv: z.string().regex(ENV_NAME),
    emailSelector: z.string().min(1),
    passwordSelector: z.string().min(1),
    /** Clicked after the email (two-step forms) — optional. */
    nextSelector: z.string().optional(),
    submitSelector: z.string().min(1),
    /** Sign-in is done once the URL path no longer contains this. */
    loginPath: z.string().default("/login"),
  })
  .strict();
export type Login = z.infer<typeof LoginSchema>;

/** The script runner's login: a one-step email + password form is the default, so env var names alone are enough for one. */
export const ScriptLoginSchema = z
  .object({
    emailEnv: z.string().regex(ENV_NAME),
    passwordEnv: z.string().regex(ENV_NAME),
    emailSelector: z.string().min(1).default('input[type="email"]'),
    passwordSelector: z.string().min(1).default('input[type="password"]'),
    /** Clicked after the email (two-step forms) — optional. */
    nextSelector: z.string().optional(),
    submitSelector: z.string().min(1).default('button[type="submit"]'),
    loginPath: z.string().default("/login"),
  })
  .strict();

export async function signIn(page: Page, login: Login, host: string, secrets: { email: string; password: string }): Promise<void> {
  await page.goto(host, { waitUntil: "load", timeout: 120_000 });
  await page.locator(login.emailSelector).waitFor({ state: "visible", timeout: 120_000 });
  await page.locator(login.emailSelector).fill(secrets.email);
  if (login.nextSelector !== undefined) await page.locator(login.nextSelector).click();
  await page.locator(login.passwordSelector).waitFor({ state: "visible", timeout: 60_000 });
  await page.locator(login.passwordSelector).fill(secrets.password);
  await page.locator(login.submitSelector).click({ force: true });
  await page.waitForURL((u) => !u.pathname.includes(login.loginPath), { timeout: 60_000 });
}
