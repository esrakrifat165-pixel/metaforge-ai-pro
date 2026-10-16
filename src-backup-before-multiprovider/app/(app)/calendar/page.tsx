import type { Metadata } from "next";
import { CalendarWorkspace } from "../../../components/calendar/CalendarWorkspace";

export const metadata: Metadata = {
  title: "Global Event Calendar",
};

export default function CalendarPage() {
  return <CalendarWorkspace />;
}