import { redirect } from "next/navigation";

export default function LegacyOrderImportRedirect() {
  redirect("/leads/import");
}
