import { notFound } from "next/navigation";
import { ProductPreview } from "@/components/preview/product-preview";
export const dynamic = "force-dynamic";
export default function DesignPreviewPage() {
  if (process.env.POINTSNAP_UI_PREVIEW !== "1") notFound();
  return <ProductPreview />;
}
