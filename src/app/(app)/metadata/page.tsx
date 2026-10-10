import type { Metadata } from "next";
import { MetadataWorkspace } from "../../../components/metadata/MetadataWorkspace";
import "./metadata.css";

export const metadata: Metadata = {
  title: "Metadata Generator",
};

export default function MetadataPage() {
  return <MetadataWorkspace />;
}