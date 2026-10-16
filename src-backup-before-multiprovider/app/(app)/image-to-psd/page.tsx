import type { Metadata } from "next";
import { PsdWorkspace } from "../../../components/psd/PsdWorkspace";

export const metadata: Metadata = {
  title: "Image-to-PSD",
};

export default function ImageToPsdPage() {
  return <PsdWorkspace />;
}