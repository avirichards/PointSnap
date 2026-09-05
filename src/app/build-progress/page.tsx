import { notFound } from "next/navigation";
import { BuildProgressView } from "@/components/build-progress-view";
export const dynamic = "force-dynamic";
export const metadata = {
  title: "Live work — PointSnap",
  robots: { index: false, follow: false },
};
export default function Page() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <BuildProgressView />;
}
