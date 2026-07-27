import { redirect } from "next/navigation";

export default function LegacyPermissionsRedirect() {
  redirect("/settings/roles");
}
