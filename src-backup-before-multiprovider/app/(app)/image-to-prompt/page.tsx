import type { Metadata } from "next";
import { ImageToPromptWorkspace } from "../../../components/image-to-prompt/ImageToPromptWorkspace";
import "../metadata/metadata.css";
import "../../../components/metadata/result-rows.css";

export const metadata: Metadata = {
  title: "Image-to-Prompt",
};

export default function ImageToPromptPage() {
  return <ImageToPromptWorkspace />;
}