import type { Metadata } from "next";
import { AtlasApp } from "@/components/atlas-app";

export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

export default function Home() {
  return <AtlasApp />;
}
