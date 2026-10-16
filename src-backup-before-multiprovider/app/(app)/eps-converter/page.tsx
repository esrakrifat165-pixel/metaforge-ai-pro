import type { Metadata } from "next";
import { ConverterWorkspace } from "../../../components/converter/ConverterWorkspace";

export const metadata: Metadata = {
  title: "AI/EPS-to-JPG Converter",
};

export default function ConverterPage() {
  return <ConverterWorkspace />;
}