"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { writeDb, uuid, nowIso, queueDelete } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { getRequestInfo } from "@/lib/request-info";
import { verifyPassword } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireUserLite, requireAdministrator } from "./guards";
import { countLinkedRecords, totalLinked } from "@/lib/account-deletion";
import type { AccountDeletion, DeletionHandling } from "@/lib/types";

const PATH = "/users";

function fail(userId: string, message: string): never {
  redirect(`${PATH}/${userId}/delete?error=${encodeURIComponent(message)}`);
}

/**
 * Permanently deletes an account (Administrator only), through the six-step
 * safety flow in Section 9.
 *
 * Business transaction records are NEVER destroyed. When anything references the
 * account, the profile row survives as an anonymized tombstone (`is_deleted`,
 * PII cleared) so every order, call log and audit entry keeps a valid foreign
 * key and renders as "Deleted User". A genuinely unreferenced account is removed
 * outright. Either way the deletion itself is recorded in `account_deletions`.
 */
export async function permanentlyDeleteAccountAction(userId: string, formData: FormData) {
  const { user, db } = await requireUserLite();
  requireAdministrator(user, PATH);

  const target = db.profiles.find((p) => p.id === userId);
  if (!target) redirect(`${PATH}?error=${encodeURIComponent("That account no longer exists.")}`);
  if (target!.is_deleted) fail(userId, "That account has already been deleted.");
  if (userId === user.id) fail(userId, "You cannot delete your own account.");

  // Step 3: the typed confirmation.
  if (String(formData.get("confirm_text") || "").trim() !== "DELETE") {
    fail(userId, 'Type DELETE exactly to confirm.');
  }

  // Step 5: the reason.
  const reason = String(formData.get("reason") || "").trim();
  if (reason.length < 5) fail(userId, "Give a reason for this deletion (at least 5 characters).");

  // Step 6: the final tick.
  if (formData.get("final_confirm") !== "on") fail(userId, "Tick the final confirmation to proceed.");

  // Step 4: re-authenticate the Administrator. The password is compared against
  // the stored hash and never stored, logged, or echoed back.
  const password = String(formData.get("admin_password") || "");
  if (!password) fail(userId, "Enter your password to confirm this deletion.");
  const self = db.profiles.find((p) => p.id === user.id)!;
  if (!verifyPassword(password, self.password_hash)) {
    fail(userId, "That password is incorrect.");
  }

  const counts = await countLinkedRecords(db, userId);
  const linked = totalLinked(counts);

  // The explicit override: with linked records, an Administrator must choose
  // anonymization deliberately rather than have it happen silently.
  const handling = String(formData.get("handling") || "") as DeletionHandling;
  if (linked > 0 && handling !== "anonymized") {
    fail(
      userId,
      "This account has linked records. Choose “Anonymize and keep records” to proceed — business transactions are never deleted."
    );
  }

  const snapshot = {
    username: target!.username,
    full_name: target!.full_name,
    email: target!.email,
    role: target!.role,
    call_name: target!.call_name,
    contact_number: target!.contact_number,
  };

  const now = nowIso();
  const method: DeletionHandling = linked > 0 ? "anonymized" : "hard_deleted";

  if (method === "anonymized") {
    // Tombstone: keep the row (and therefore every FK pointing at it), strip the
    // personal data, and make the account unusable.
    target!.is_deleted = true;
    target!.deleted_at = now;
    target!.is_active = false;
    target!.full_name = "Deleted User";
    target!.email = `deleted+${target!.id}@invalid.local`;
    target!.username = `deleted_${target!.id.slice(0, 8)}`;
    target!.call_name = null;
    target!.contact_number = null;
    target!.avatar_url = null;
    target!.team_lead_id = null;
    // A random unusable hash — no one can authenticate as a deleted account.
    target!.password_hash = `deleted:${uuid()}`;
    target!.must_change_password = false;
  } else {
    const idx = db.profiles.findIndex((p) => p.id === userId);
    db.profiles.splice(idx, 1);
    queueDelete(db, "profiles", userId);
  }

  const record: AccountDeletion = {
    id: uuid(),
    deleted_profile_id: userId,
    deleted_username: snapshot.username,
    deleted_full_name: snapshot.full_name,
    deleted_email: snapshot.email,
    deleted_role: snapshot.role,
    deleted_by: user.id,
    reason,
    handling_method: method,
    linked_record_counts: counts as unknown as Record<string, number>,
    deleted_at: now,
  };

  const info = await getRequestInfo();
  logActivity(
    db,
    user.id,
    "ACCOUNT_PERMANENTLY_DELETED",
    "user",
    userId,
    { username: snapshot.username, handling_method: method, reason },
    {
      module: "users",
      previous_value: snapshot,
      updated_value: { handling_method: method, linked_record_counts: counts },
      ...info,
    }
  );

  await writeDb(db);

  const { error } = await supabaseAdmin.from("account_deletions").insert(record);
  if (error) {
    redirect(`${PATH}?error=${encodeURIComponent(`Account deleted, but the deletion audit failed: ${error.message}`)}`);
  }

  revalidatePath(PATH);
  redirect(`${PATH}?deleted_account=${encodeURIComponent(snapshot.username)}&handling=${method}`);
}
