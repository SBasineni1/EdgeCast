function Block({ className }: { className: string }) {
  return (
    <div className={`animate-pulse rounded-lg bg-panel-2 motion-reduce:animate-none ${className}`} />
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-hairline bg-panel p-4">{children}</div>
  );
}

/** Placeholder main column shown while the first live fetch is in flight. */
export function DashboardSkeleton() {
  return (
    <div className="flex flex-col gap-6" data-testid="dashboard-skeleton" aria-hidden="true">
      <div className="flex items-baseline justify-between gap-3">
        <Block className="h-7 w-36" />
        <Block className="h-4 w-44" />
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <Card key={i}>
            <Block className="mb-3 h-3 w-24" />
            <Block className="h-9 w-28" />
          </Card>
        ))}
      </div>
      <Card>
        <div className="flex items-center justify-between pb-4">
          <Block className="h-3 w-40" />
          <Block className="h-3 w-28" />
        </div>
        <Block className="h-48 w-full" />
      </Card>
      <p className="text-center text-xs text-text-3">
        Fetching live markets and model runs for 20 cities — a cold start can take a little
        while…
      </p>
    </div>
  );
}

/** Placeholder city rail shown alongside the dashboard skeleton. */
export function RailSkeleton() {
  return (
    <aside
      className="sticky top-0 hidden h-screen w-72 shrink-0 flex-col gap-3 overflow-hidden border-l border-hairline px-5 py-7 xl:flex"
      data-testid="rail-skeleton"
      aria-hidden="true"
    >
      <Block className="mb-2 h-3 w-14" />
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <Card key={i}>
          <div className="flex items-center justify-between">
            <div>
              <Block className="mb-2 h-4 w-20" />
              <Block className="h-3 w-24" />
            </div>
            <Block className="h-6 w-14" />
          </div>
        </Card>
      ))}
    </aside>
  );
}
