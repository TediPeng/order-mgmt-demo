"use server";

import { revalidatePath } from "next/cache";
import { writeDb, markNotificationDirty } from "@/lib/db";
import { requireUserLite } from "./guards";

export async function markNotificationReadAction(notificationId: string) {
  "use server";
  const { user, db } = await requireUserLite();
  const n = db.notifications.find((x) => x.id === notificationId && x.recipient_id === user.id);
  if (n) {
    n.is_read = true;
    markNotificationDirty(db, n.id);
    await writeDb(db);
  }
  revalidatePath("/", "layout");
}

export async function markAllNotificationsReadAction() {
  "use server";
  const { user, db } = await requireUserLite();
  db.notifications.forEach((n) => {
    // Only the ones this actually changes. Marking every row of a twenty
    // thousand row backlog dirty would rewrite the whole thing again, which
    // is the cost this tracking exists to avoid.
    if (n.recipient_id === user.id && !n.is_read) {
      n.is_read = true;
      markNotificationDirty(db, n.id);
    }
  });
  await writeDb(db);
  revalidatePath("/", "layout");
}
