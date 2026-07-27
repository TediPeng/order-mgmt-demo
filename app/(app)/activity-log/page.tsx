import { redirect } from "next/navigation";

export default function LegacyActivityLogRedirect() {
  redirect("/audit-logs");
}
