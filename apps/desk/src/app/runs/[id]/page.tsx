import { notFound } from "next/navigation";

import { RunView } from "~/components/run-view";
import { isLedgerId } from "~/lib/paths";

const Page = async ({ params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  if (!isLedgerId(id)) {
    notFound();
  }
  return <RunView key={id} id={id} />;
};

export default Page;
