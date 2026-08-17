import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider } from "@/lib/useAuth";
import AppShell from "@/components/AppShell";
import Auth from "@/pages/Auth";
import QualityGateQueue from "@/pages/QualityGateQueue";
import QualityGateReview from "@/pages/QualityGateReview";
import Recovery from "@/pages/Recovery";
import SeoDashboard from "@/pages/seo/Dashboard";
import SeoKeywords from "@/pages/seo/Keywords";
import SeoLocations from "@/pages/seo/Locations";
import SeoKeywordLists from "@/pages/seo/KeywordLists";
import SeoRankings from "@/pages/seo/Rankings";
import SeoCompetitors from "@/pages/seo/Competitors";
import SeoCompetitorInsights from "@/pages/seo/CompetitorInsights";
import SeoSchedule from "@/pages/seo/Schedule";
import SeoDiscoveryInbox from "@/pages/seo/DiscoveryInbox";
import SeoCompetitorCuration from "@/pages/seo/CompetitorCuration";
import SeoSiteHealth from "@/pages/seo/SiteHealth";
import SeoBacklinks from "@/pages/seo/Backlinks";
import SeoContentGap from "@/pages/seo/ContentGap";
import SeoSearchPerformance from "@/pages/seo/SearchPerformance";
import GoogleIntegrations from "@/pages/admin/GoogleIntegrations";
import NotFound from "@/pages/not-found";

const queryClient = new QueryClient();

const base = import.meta.env.BASE_URL.replace(/\/$/, "");

function Routed() {
  return (
    <Switch>
      <Route path="/auth" component={Auth} />
      <Route path="/quality-gate" component={QualityGateQueue} />
      <Route path="/quality-gate/:id">
        {(params) => <QualityGateReview id={params.id} />}
      </Route>
      <Route path="/recovery" component={Recovery} />
      <Route path="/seo" component={SeoDashboard} />
      <Route path="/seo/keywords" component={SeoKeywords} />
      <Route path="/seo/locations" component={SeoLocations} />
      <Route path="/seo/keyword-lists" component={SeoKeywordLists} />
      <Route path="/seo/rankings" component={SeoRankings} />
      <Route path="/seo/competitors" component={SeoCompetitors} />
      <Route path="/seo/insights" component={SeoCompetitorInsights} />
      <Route path="/seo/schedules" component={SeoSchedule} />
      <Route path="/seo/discovery-inbox" component={SeoDiscoveryInbox} />
      <Route path="/seo/competitor-curation" component={SeoCompetitorCuration} />
      <Route path="/seo/site-health" component={SeoSiteHealth} />
      <Route path="/seo/backlinks" component={SeoBacklinks} />
      <Route path="/seo/content-gap" component={SeoContentGap} />
      <Route path="/seo/search-performance" component={SeoSearchPerformance} />
      <Route path="/seo/integrations" component={GoogleIntegrations} />
      <Route path="/">{() => <Redirect to="/quality-gate" />}</Route>
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <WouterRouter base={base}>
        <AuthProvider>
          <AppShell>
            <Routed />
          </AppShell>
        </AuthProvider>
        <Toaster richColors position="top-right" />
      </WouterRouter>
    </QueryClientProvider>
  );
}

export default App;
