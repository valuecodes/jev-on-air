export const Home = () => {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-12 px-6 py-10">
      <header className="flex flex-col gap-4">
        <span className="inline-flex w-fit items-center rounded-md bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-700">
          Agentic starter
        </span>
        <div className="space-y-3">
          <h1 className="text-3xl font-semibold sm:text-4xl">
            Ship AI-driven workflows faster with a focused monorepo starter.
          </h1>
          <p className="max-w-2xl text-sm text-zinc-600 sm:text-base">
            Build agents, tools, and UI in one place with shared configs and a
            clean baseline for experiments.
          </p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row">
          <button
            type="button"
            className="inline-flex h-11 items-center justify-center rounded-md bg-zinc-900 px-6 text-sm font-medium text-white transition-colors hover:bg-zinc-800"
          >
            Explore the stack
          </button>
          <button
            type="button"
            className="inline-flex h-11 items-center justify-center rounded-md border border-zinc-300 px-6 text-sm font-medium text-zinc-900 transition-colors hover:bg-zinc-50"
          >
            View sample agents
          </button>
        </div>
      </header>

      <section className="grid gap-4 sm:grid-cols-3">
        {[
          {
            title: "Agent ready",
            body: "Start with a repo tailored for tool calling, workflows, and quick iterations.",
          },
          {
            title: "Shared tooling",
            body: "Unified lint, typecheck, and formatting keep every workspace aligned.",
          },
          {
            title: "Type-aware linting",
            body: "oxlint runs the whole repo in one pass, with types resolved by tsgolint.",
          },
        ].map((card) => (
          <article
            key={card.title}
            className="rounded-xl border border-zinc-200 p-5"
          >
            <h2 className="font-semibold">{card.title}</h2>
            <p className="mt-2 text-sm text-zinc-600">{card.body}</p>
          </article>
        ))}
      </section>

      <section className="rounded-2xl border border-zinc-200 bg-zinc-50/60 p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-2">
            <h2 className="text-xl font-semibold">Build with agents in mind</h2>
            <p className="text-sm text-zinc-600">
              Start with sensible defaults for automation, evaluation, and
              polished UX.
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <button
              type="button"
              className="inline-flex h-10 items-center justify-center rounded-md bg-zinc-900 px-4 text-sm font-medium text-white transition-colors hover:bg-zinc-800"
            >
              Run the playground
            </button>
            <button
              type="button"
              className="inline-flex h-10 items-center justify-center rounded-md border border-zinc-300 px-4 text-sm font-medium text-zinc-900 transition-colors hover:bg-zinc-50"
            >
              Read the docs
            </button>
          </div>
        </div>
      </section>
    </main>
  );
};
