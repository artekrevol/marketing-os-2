import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider } from "@/lib/useAuth";
import AppShell from "@/components/AppShell";
import Auth from "@/pages/Auth";
import QualityGateQueue from "@/pages/QualityGateQueue";
import QualityGateReview from "@/pages/QualityGateReview";
import Recovery from "@/pages/Recovery";
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
