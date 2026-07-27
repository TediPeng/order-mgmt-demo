"use server";

import { revalidatePath } from "next/cache";
import { writeDb } from "@/lib/db";
import { requireUser } from "./guards";

export async function markNotificationReadAction(notificationId: string) {
  "use server";
  const { user, db } = await requireUser();
  const n = db.notifications.find((x) => x.id === notificationId && x.recipient_id === user.id);
  if (n) {
    n.is_read = true;
    writeDb(db);
  }
  revalidatePath("/", "layout");
}

export async function markAllNotificationsReadAction() {
  "use server";
  const { user, db } = await requireUser();
  db.notifications.forEach((n) => {
    if (n.recipient_id === user.id) n.is_read = true;
  });
  writeDb(db);
  revalidatePath("/", "layout");
}
