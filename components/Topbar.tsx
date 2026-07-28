import { LogOut } from "lucide-react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { logoutAction } from "@/lib/actions/auth";
import { Avatar } from "@/components/ui/Avatar";
import { NotificationBell } from "./NotificationBell";
import type { AppNotification, Profile } from "@/lib/types";

export function Topbar({
  user,
  roleName,
  notifications,
}: {
  user: Profile;
  roleName: string;
  notifications: AppNotification[];
}) {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-6">
      <div />
      <div className="flex items-center gap-3">
        <ThemeToggle current={user.theme_preference || "light"} />
        <NotificationBell notifications={notifications} />
        <div className="text-right">
          <p className="text-sm font-medium text-slate-800">{user.full_name}</p>
          <p className="text-xs text-slate-400">{roleName}</p>
        </div>
        <Avatar name={user.full_name} src={user.avatar_url} size="md" />
        <form action={logoutAction}>
          <button
            type="submit"
            className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm text-slate-500 hover:bg-slate-100 hover:text-slate-800"
          >
            <LogOut className="h-4 w-4" />
            Logout
          </button>
        </form>
      </div>
    </header>
  );
}
