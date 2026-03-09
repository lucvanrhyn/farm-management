import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { FarmSelectPage } from "@/components/ui/FarmSelectPage";

export default async function Home() {
  const session = await getSession();

  // Authenticated users go straight to the hub
  if (session?.user) {
    redirect("/home");
  }

  return <FarmSelectPage />;
}
