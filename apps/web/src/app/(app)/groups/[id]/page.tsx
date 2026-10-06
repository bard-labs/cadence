import type { Metadata } from "next";

import { GroupDetailView } from "./group-detail-view";

export const metadata: Metadata = { title: "Group" };

export default async function GroupPage({ params }: PageProps<"/groups/[id]">) {
  const { id } = await params;
  return <GroupDetailView id={id} />;
}
