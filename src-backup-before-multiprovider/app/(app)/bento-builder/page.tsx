import type { Metadata } from "next";
import { BentoWorkspace } from "../../../components/bento/BentoWorkspace";

export const metadata: Metadata = {
  title: "Bento Builder",
};

export default function BentoBuilderPage() {
  return <BentoWorkspace />;
}