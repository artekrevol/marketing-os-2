import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { KeyRound, MapPin, Users, CalendarClock } from "lucide-react";
import { seo } from "@/lib/api";
import { SeoShell, withBrand, StateBox } from "./_shell";

function DashboardInner({ brandId }: { brandId: string }) {
  const statsQ = useQuery({
    queryKey: ["seo", "dashboard", brandId],
    queryFn: () => seo.dashboardStats(brandId),
    staleTime: 30_000,
  });

  const s = statsQ.data;

  return (
    <SeoShell
      title="SEO Dashboard"
      subtitle="Keyword tracking, rankings, and competitor intelligence"
    >
      {statsQ.isLoading ? (
        <StateBox>Loading stats…</StateBox>
      ) : statsQ.isError ? (
        <StateBox>Failed to load stats: {(statsQ.error as Error).message}</StateBox>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            icon={<KeyRound className="h-4 w-4" />}
            label="Tracked keywords"
            value={s?.keyword_count ?? 0}
            href="/seo/keywords"
          />
          <StatCard
            icon={<MapPin className="h-4 w-4" />}
            label="Locations"
            value={s?.location_count ?? 0}
            href="/seo/locations"
          />
          <StatCard
            icon={<Users className="h-4 w-4" />}
            label="Competitor domains"
            value={s?.competitor_count ?? 0}
            href="/seo/competitors"
          />
          <StatCard
            icon={<CalendarClock className="h-4 w-4" />}
            label="Active schedules"
            value={s?.active_schedule_count ?? 0}
            href="/seo/schedules"
          />
        </div>
      )}

      <div className="mt-6">
        <StateBox>
          Last completed crawl:{" "}
          <span className="font-medium text-ink">
            {s?.last_crawl_at ? new Date(s.last_crawl_at).toLocaleString() : "never"}
          </span>
          . Trigger a fresh crawl from the{" "}
          <Link href="/seo/rankings" className="text-accent underline">
            Rankings
          </Link>{" "}
          page.
        </StateBox>
      </div>
    </SeoShell>
  );
}

function StatCard({
  icon,
  label,
  value,
  href,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="block border border-rule rounded-md bg-background p-5 hover:border-accent transition-colors"
    >
      <div className="flex items-center gap-2 text-ink-muted text-xs uppercase tracking-wide">
        {icon}
        {label}
      </div>
      <div className="font-serif text-3xl mt-2 tracking-tight">{value}</div>
    </Link>
  );
}

export default withBrand("SEO Dashboard", undefined, (brandId) => (
  <DashboardInner brandId={brandId} />
));
