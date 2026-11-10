import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { FoodQueryProvider } from "@/components/food/query-provider";
import { AppShell } from "@/components/shell/app-shell";
import { SESSION_COOKIE } from "@/lib/server/upstream";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  if (!(await cookies()).get(SESSION_COOKIE)) redirect("/sign-in");
  return (
    <FoodQueryProvider>
      <AppShell>{children}</AppShell>
    </FoodQueryProvider>
  );
}
