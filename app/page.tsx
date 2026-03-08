import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";

export default async function Home() {
  const session = await getSession();
  const role = session?.user?.role;

  if (role === "admin") redirect("/admin");
  if (role === "field_logger") redirect("/logger");
  redirect("/dashboard");
}
