"use server";

import { redirect } from "next/navigation";
import { writeDb } from "@/lib/db";
import { uploadFile, deleteFile } from "@/lib/storage";
import { logActivity } from "@/lib/activity";
import { getRequestInfo } from "@/lib/request-info";
import { requireUserLite } from "./guards";

const PATH = "/settings/password";
const TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
const MAX_BYTES = 5 * 1024 * 1024;

/** Uploads the signed-in user's own profile picture.
 *
 * Scoped to `user.id` from the session rather than any submitted id, so this
 * cannot be pointed at another account. The old file is removed after the new
 * one is stored, so a failed upload never leaves the user with no picture. */
export async function uploadAvatarAction(formData: FormData) {
  const { user, db } = await requireUserLite();

  const file = formData.get("avatar") as File | null;
  if (!file || file.size === 0) {
    redirect(`${PATH}?error=${encodeURIComponent("Choose an image to upload.")}`);
  }
  if (!TYPES.includes(file!.type)) {
    redirect(`${PATH}?error=${encodeURIComponent("Profile pictures must be JPG, PNG or WEBP.")}`);
  }
  if (file!.size > MAX_BYTES) {
    redirect(`${PATH}?error=${encodeURIComponent("Profile pictures must be 5 MB or smaller.")}`);
  }

  const profile = db.profiles.find((p) => p.id === user.id);
  if (!profile) redirect(`${PATH}?error=${encodeURIComponent("Account not found.")}`);

  const previous = profile!.avatar_url;
  const buffer = Buffer.from(await file!.arrayBuffer());
  const ext = file!.type === "image/png" ? "png" : file!.type === "image/webp" ? "webp" : "jpg";
  const storagePath = `avatars/${user.id}/${Date.now()}.${ext}`;
  await uploadFile(storagePath, buffer);

  profile!.avatar_url = `/api/avatars/${user.id}?v=${Date.now()}`;

  const info = await getRequestInfo();
  logActivity(db, user.id, "PROFILE_PICTURE_UPDATED", "user", user.id, { size_bytes: file!.size, type: file!.type }, {
    module: "users",
    previous_value: { avatar_url: previous },
    updated_value: { avatar_url: profile!.avatar_url },
    ...info,
  });
  await writeDb(db);

  // Only once the new picture is safely stored and recorded.
  if (previous) {
    const oldPath = avatarStoragePath(previous);
    if (oldPath && oldPath !== storagePath) await deleteFile(oldPath).catch(() => undefined);
  }

  redirect(`${PATH}?avatar=1`);
}

export async function removeAvatarAction() {
  const { user, db } = await requireUserLite();
  const profile = db.profiles.find((p) => p.id === user.id);
  if (!profile || !profile.avatar_url) redirect(PATH);

  const previous = profile!.avatar_url;
  profile!.avatar_url = null;

  const info = await getRequestInfo();
  logActivity(db, user.id, "PROFILE_PICTURE_REMOVED", "user", user.id, {}, {
    module: "users",
    previous_value: { avatar_url: previous },
    updated_value: { avatar_url: null },
    ...info,
  });
  await writeDb(db);
  redirect(`${PATH}?avatar_removed=1`);
}

/** Legacy rows stored a storage path directly; current rows store the serving
 * route. Only the former can be deleted from storage by path. */
function avatarStoragePath(value: string): string | null {
  return value.startsWith("avatars/") ? value : null;
}
