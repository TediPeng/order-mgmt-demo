"use server";

import { revalidatePath } from "next/cache";
import { writeDb, nowIso } from "@/lib/db";
import { setThemeCookie } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import { getRequestInfo } from "@/lib/request-info";
import { requireUser } from "./guards";
import type { ThemePreference } from "@/lib/types";

const VALID: ThemePreference[] = ["light", "dark", "system"];

/** Saves the theme against the account and mirrors it into the cookie the root
 * layout reads. The account row is what makes the choice follow the user to a
 * different device; the cookie is only what lets the first paint be correct. */
export async function setThemeAction(theme: string) {
  const { user, db } = await requireUser();
  if (!VALID.includes(theme as ThemePreference)) return;

  const profile = db.profiles.find((p) => p.id === user.id);
  if (profile && profile.theme_preference !== theme) {
    const before = profile.theme_preference;
    profile.theme_preference = theme as ThemePreference;
    const info = await getRequestInfo();
    logActivity(db, user.id, "THEME_CHANGED", "user", user.id, { from: before, to: theme }, {
      module: "settings",
      previous_value: { theme_preference: before },
      updated_value: { theme_preference: theme },
      ...info,
    });
    await writeDb(db);
  }

  await setThemeCookie(theme);
  revalidatePath("/", "layout");
  void nowIso;
}
