import type { Metadata } from "next";
import { MetadataWorkspace } from "../../../components/metadata/MetadataWorkspace";
import "./metadata.css";
import "../../../components/metadata/result-rows.css";

export const metadata: Metadata = {
  title: "Metadata Generator",
};

export default function MetadataPage() {
  return <MetadataWorkspace />;
}