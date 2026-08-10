"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { logActivityStandalone } from "@/lib/activity";
import { getRequestInfo } from "@/lib/request-info";
import { requireUserLite, requireAdministrator } from "./guards";
import { deleteUpdateLog, getUpdateLog, insertUpdateLog, parseLines, updateUpdateLog } from "@/lib/update-logs";

const PATH = "/settings/update-logs";

function readForm(formData: FormData) {
  return {
    version: String(formData.get("version") || "").trim(),
    release_date: String(formData.get("release_date") || "").trim(),
    title: String(formData.get("title") || "").trim(),
    new_features: parseLines(formData.get("new_features")),
    fixes: parseLines(formData.get("fixes")),
    improvements: parseLines(formData.get("improvements")),
    known_issues: parseLines(formData.get("known_issues")),
    is_published: formData.get("is_published") === "on",
  };
}

function fail(message: string): never {
  redirect(`${PATH}?error=${encodeURIComponent(message)}`);
}

export async function createUpdateLogAction(formData: FormData) {
  const { user } = await requireUserLite();
  requireAdministrator(user, PATH);

  const fields = readForm(formData);
  if (!fields.version) fail("Version is required.");
  if (!fields.release_date) fail("Release date is required.");
  if (!fields.title) fail("Update title is required.");

  const created = await insertUpdateLog({ ...fields, created_by: user.id });
  const info = await getRequestInfo();
  await logActivityStandalone(
    user.id,
    "UPDATE_LOG_CREATED",
    "update_log",
    created.id,
    { version: created.version, is_published: created.is_published },
    { module: "settings", updated_value: created, ...info }
  );
  revalidatePath(PATH);
  revalidatePath("/login");
  redirect(`${PATH}?created=1`);
}

export async function updateUpdateLogAction(id: string, formData: FormData) {
  const { user } = await requireUserLite();
  requireAdministrator(user, PATH);

  const before = await getUpdateLog(id);
  if (!before) fail("That release entry no longer exists.");

  const fields = readForm(formData);
  if (!fields.version) fail("Version is required.");
  if (!fields.release_date) fail("Release date is required.");
  if (!fields.title) fail("Update title is required.");

  await updateUpdateLog(id, fields);
  const info = await getRequestInfo();
  await logActivityStandalone(
    user.id,
    "UPDATE_LOG_UPDATED",
    "update_log",
    id,
    { version: fields.version },
    { module: "settings", previous_value: before, updated_value: fields, ...info }
  );
  revalidatePath(PATH);
  revalidatePath("/login");
  redirect(`${PATH}?updated=1`);
}

/** Publishing is what makes an entry visible on the login page, so it is logged
 * separately from an ordinary content edit. */
export async function setUpdateLogPublishedAction(id: string, publish: boolean) {
  const { user } = await requireUserLite();
  requireAdministrator(user, PATH);

  const before = await getUpdateLog(id);
  if (!before) fail("That release entry no longer exists.");

  await updateUpdateLog(id, { is_published: publish });
  const info = await getRequestInfo();
  await logActivityStandalone(
    user.id,
    publish ? "UPDATE_LOG_PUBLISHED" : "UPDATE_LOG_UNPUBLISHED",
    "update_log",
    id,
    { version: before!.version },
    {
      module: "settings",
      previous_value: { is_published: before!.is_published },
      updated_value: { is_published: publish },
      ...info,
    }
  );
  revalidatePath(PATH);
  revalidatePath("/login");
  redirect(`${PATH}?${publish ? "published" : "unpublished"}=1`);
}

export async function deleteUpdateLogAction(id: string) {
  const { user } = await requireUserLite();
  requireAdministrator(user, PATH);

  const before = await getUpdateLog(id);
  if (!before) fail("That release entry no longer exists.");

  await deleteUpdateLog(id);
  const info = await getRequestInfo();
  await logActivityStandalone(
    user.id,
    "UPDATE_LOG_DELETED",
    "update_log",
    id,
    { version: before!.version },
    { module: "settings", previous_value: before, ...info }
  );
  revalidatePath(PATH);
  revalidatePath("/login");
  redirect(`${PATH}?deleted=1`);
}
