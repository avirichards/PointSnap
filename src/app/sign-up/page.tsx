import { Suspense } from "react";
import { AccountForm } from "@/components/auth/account-form";
export const metadata = { title: "Create account" };
export default function SignUpPage() {
  return (
    <Suspense>
      <AccountForm signup />
    </Suspense>
  );
}
