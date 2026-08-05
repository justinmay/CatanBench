import Link from "next/link";

export default function HomePage() {
  return (
    <main className="grid min-h-screen place-items-center px-6 py-16">
      <div className="w-full max-w-xl rounded-3xl border border-foreground/10 bg-card/80 p-8 shadow-sm backdrop-blur sm:p-10">
        <span className="hex-mark" aria-hidden="true">
          <span>CB</span>
        </span>
        <p className="mt-8 font-mono text-xs tracking-[0.16em] text-muted-foreground uppercase">
          Landing page workspace
        </p>
        <h1 className="mt-3 font-heading text-4xl font-semibold tracking-[-0.045em] sm:text-5xl">
          CatanBench
        </h1>
        <p className="mt-4 max-w-md text-sm leading-6 text-muted-foreground">
          This homepage is ready for a new landing page. The game operations
          console now lives at its own route.
        </p>
        <Link
          href="/console"
          className="mt-8 inline-flex items-center rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
        >
          Open control room
          <span aria-hidden="true" className="ml-2">
            →
          </span>
        </Link>
      </div>
    </main>
  );
}
