import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { Toaster } from "@/components/ui/sonner";
import AppShell from "@/components/AppShell";
import Auth from "@/pages/Auth";
import QualityGateQueue from "@/pages/QualityGateQueue";
import QualityGateReview from "@/pages/QualityGateReview";
import NotFound from "@/pages/not-found";

const queryClient = new QueryClient();

function Routed() {
  return (
    <Switch>
      <Route path="/auth" component={Auth} />
      <Route path="/quality-gate" component={QualityGateQueue} />
      <Route path="/quality-gate/:id">
        {(params) => <QualityGateReview id={params.id} />}
      </Route>
      <Route path="/">{() => <Redirect to="/quality-gate" />}</Route>
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  // Wouter base path matches Vite's BASE_URL (without trailing slash) so
  // that <Link to="/quality-gate"> renders as /seo-os/quality-gate in
  // both dev and prod, matching the reverse-proxy mount.
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  return (
    <QueryClientProvider client={queryClient}>
      <WouterRouter base={base}>
        <AppShell>
          <Routed />
        </AppShell>
        <Toaster richColors position="top-right" />
      </WouterRouter>
    </QueryClientProvider>
  );
}

export default App;
