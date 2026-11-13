// The pages behind the Harbour Control sign in, and a booking that fails.
// The fixture in harbour-fixture.py makes the ids fixed: the first ids it makes are 1 to 4.
import type { Page } from "@playwright/test";

export type PageState = { name: string; path: string; prepare: (page: Page) => Promise<void> };

const HARBOUR = "http://localhost:8090";

async function signIn(page: Page) {
  await page.getByLabel("Email").fill("oncall@example.com");
  await page.getByLabel("Password").fill("correct horse");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForLoadState("networkidle");
}

export const states: PageState[] = [
  { name: "incidents", path: `${HARBOUR}/`, prepare: signIn },
  {
    name: "incident with no finding",
    path: `${HARBOUR}/incidents/inc-000000000001`,
    prepare: signIn,
  },
  {
    name: "incident with a finding",
    path: `${HARBOUR}/incidents/inc-000000000002`,
    prepare: signIn,
  },
  { name: "action to approve", path: `${HARBOUR}/actions/act-000000000004`, prepare: signIn },
  {
    name: "booking with a missing name",
    path: "/",
    prepare: async (page) => {
      await page.evaluate(() => {
        const name = document.querySelector<HTMLInputElement>("input[name=name]");
        if (name) name.required = false;
      });
      await page.getByLabel("Name").fill("");
      await page.getByRole("button", { name: "Book and pay" }).click();
      await page.getByRole("status").getByText("Enter your name.").waitFor();
    },
  },
];
