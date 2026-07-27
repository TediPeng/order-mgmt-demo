import { redirect } from "next/navigation";

export default function LegacyNewOrderRedirect() {
  redirect("/leads/new");
}
