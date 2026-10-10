import type { Metadata } from "next";
import { ApiKeyManager } from "../../../../components/api-keys/ApiKeyManager";
import "./keys.css";

export const metadata: Metadata = {
  title: "API Key Manager",
};

export default function ApiKeysPage() {
  return <ApiKeyManager />;
}