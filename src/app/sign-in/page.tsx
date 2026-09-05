import { Suspense } from "react";
import { AccountForm } from "@/components/auth/account-form";
export const metadata = { title: "Sign in" };
export default function SignInPage() {
  return (
    <Suspense>
      <AccountForm />
    </Suspense>
  );
}
