import Link from "next/link";
import { readDbLite } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { formatDateTime } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { markAllNotificationsReadAction, markNotificationReadAction } from "@/lib/actions/notifications";

export default async function NotificationsPage() {
  const user = (await getCurrentUser())!;
  const db = await readDbLite();
  const notifications = db.notifications
    .filter((n) => n.recipient_id === user.id)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const unreadCount = notifications.filter((n) => !n.is_read).length;

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-page-title text-slate-900">Notifications</h1>
        {unreadCount > 0 && (
          <form action={markAllNotificationsReadAction}>
            <Button type="submit" variant="outline" size="sm">
              Mark all read ({unreadCount})
            </Button>
          </form>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All notifications</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <ul className="divide-y divide-slate-100">
            {notifications.map((n) => {
              const boundMarkRead = async () => {
                "use server";
                await markNotificationReadAction(n.id);
              };
              const body = (
                <>
                  <p className="text-sm font-medium text-slate-800">{n.title}</p>
                  {n.body && <p className="mt-0.5 text-sm text-slate-500">{n.body}</p>}
                  <p className="mt-1 text-xs text-slate-400">{formatDateTime(n.created_at)}</p>
                </>
              );
              return (
                <li key={n.id} className={`px-5 py-4 ${!n.is_read ? "bg-[var(--brand-primary-10)]" : ""}`}>
                  <div className="flex items-start justify-between gap-3">
                    {n.link ? (
                      <Link href={n.link} className="flex-1">
                        {body}
                      </Link>
                    ) : (
                      <div className="flex-1">{body}</div>
                    )}
                    {!n.is_read && (
                      <form action={boundMarkRead}>
                        <button type="submit" className="text-xs font-medium text-[var(--brand-primary)] hover:underline">
                          Mark read
                        </button>
                      </form>
                    )}
                  </div>
                </li>
              );
            })}
            {notifications.length === 0 && (
              <li className="px-5 py-10 text-center text-sm text-slate-400">No notifications yet.</li>
            )}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
