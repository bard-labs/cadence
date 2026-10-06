import type { Metadata } from "next";

import { GroupsView } from "./groups-view";

export const metadata: Metadata = { title: "Groups" };

export default function GroupsPage() {
  return <GroupsView />;
}
