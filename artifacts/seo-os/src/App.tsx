import { ClerkProvider } from "@clerk/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Switch, Route, Router as WouterRouter, Redirect, useLocation } from "wouter";
import { Toaster } from "@/components/ui/sonner";
import AppShell from "@/components/AppShell";
import Auth from "@/pages/Auth";
import QualityGateQueue from "@/pages/QualityGateQueue";
import QualityGateReview from "@/pages/QualityGateReview";
import Recovery from "@/pages/Recovery";
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
      <Route path="/recovery" component={Recovery} />
      <Route path="/">{() => <Redirect to="/quality-gate" />}</Route>
      <Route component={NotFound} />
    </Switch>
  );
}

function ClerkWithWouter({ children }: { children: React.ReactNode }) {
  const [, navigate] = useLocation();
  return (
    <ClerkProvider
      publishableKey={import.meta.env.VITE_CLERK_PUBLISHABLE_KEY}
      routerPush={(to) => navigate(to)}
      routerReplace={(to) => navigate(to)}
    >
      {children}
    </ClerkProvider>
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
        <ClerkWithWouter>
          <AppShell>
            <Routed />
          </AppShell>
        </ClerkWithWouter>
        <Toaster richColors position="top-right" />
      </WouterRouter>
    </QueryClientProvider>
  );
}

export default App;
