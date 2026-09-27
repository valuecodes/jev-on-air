import { notFound } from "next/navigation";

import { RunView } from "../../../components/RunView";
import { isLedgerId } from "../../../lib/paths";

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!isLedgerId(id)) notFound();
  return <RunView key={id} id={id} />;
}
