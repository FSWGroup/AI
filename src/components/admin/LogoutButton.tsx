"use client";

import { useRouter } from "next/navigation";
import { api } from "@/lib/client/api";

export function LogoutButton() {
  const router = useRouter();
  return (
    <button
      className="mt-2 text-xs font-semibold text-navy-500 underline hover:text-navy-800"
      onClick={() =>
        void api("/api/admin/auth/logout", { body: {} }).then(() => {
          router.push("/admin/login");
          router.refresh();
        })
      }
    >
      Sign out
    </button>
  );
}
