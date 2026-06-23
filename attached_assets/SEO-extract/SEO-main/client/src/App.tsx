import { useState, useEffect } from "react";
import { Switch, Route } from "wouter";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import NotFound from "@/pages/not-found";
import Dashboard from "@/pages/Dashboard";
import ManageKeywords from "@/pages/ManageKeywords";
import ManageLocations from "@/pages/ManageLocations";
import Schedule from "@/pages/Schedule";
import CurrentRankings from "@/pages/CurrentRankings";
import CompetitorAnalysis from "@/pages/CompetitorAnalysis";
import CompetitorInsights from "@/pages/CompetitorInsightsFix";
import CompetitorInsightsDiagnostic from "@/pages/CompetitorInsightsDiagnostic";
import KeywordGroups from "@/pages/KeywordGroups";
import OnPageAPITest from "@/pages/OnPageAPITest";
import KeywordResearchAPITest from "@/pages/KeywordResearchAPITest";
import { ErrorBoundary } from "./lib/debugUtils";
import { AlertCircle, Wifi, WifiOff, RefreshCw } from "lucide-react";

function ErrorFallback() {
  return (
    <div className="flex items-center justify-center min-h-screen bg-neutral-100">
      <div className="bg-white p-6 rounded-lg shadow-md max-w-md w-full">
        <div className="flex items-center text-red-500 mb-4">
          <AlertCircle className="w-6 h-6 mr-2" />
          <h2 className="text-xl font-semibold">Something went wrong</h2>
        </div>
        <p className="text-neutral-600 mb-4">
          An error occurred while rendering this page. Try refreshing the browser.
        </p>
        <button 
          onClick={() => window.location.reload()}
          className="bg-primary text-white px-4 py-2 rounded hover:bg-primary/90 transition-colors"
        >
          Refresh page
        </button>
      </div>
    </div>
  );
}

// Connectivity notification banner
function ConnectionStatus() {
  const [isOnline, setIsOnline] = useState(true);
  const [showBanner, setShowBanner] = useState(false);
  
  useEffect(() => {
    // Improved connection status using fetch instead of console.log interception
    const checkConnection = async () => {
      try {
        const response = await fetch('/api/health', { 
          method: 'GET',
          signal: AbortSignal.timeout(5000) // 5 second timeout
        });
        if (response.ok) {
          setIsOnline(true);
          setShowBanner(false);
        } else {
          setIsOnline(false);
          setShowBanner(true);
        }
      } catch (error) {
        setIsOnline(false);
        setShowBanner(true);
      }
    };
    
    // Check immediately
    checkConnection();
    
    // Check every 30 seconds
    const interval = setInterval(checkConnection, 30000);
    
    // Fallback: Listen for vite server connection status from console logs (for dev mode)
    if (process.env.NODE_ENV === 'development') {
      const originalConsoleLog = console.log;
      console.log = function(...args) {
        if (typeof args[0] === 'string') {
          if (args[0].includes('server connection lost')) {
            setIsOnline(false);
            setShowBanner(true);
          } else if (args[0].includes('[vite] connected')) {
            setIsOnline(true);
            setTimeout(() => setShowBanner(false), 3000);
          }
        }
        originalConsoleLog.apply(console, args);
      };
      
      return () => {
        clearInterval(interval);
        console.log = originalConsoleLog;
      };
    }
    
    return () => {
      clearInterval(interval);
    };
  }, []);
  
  if (!showBanner) return null;
  
  return (
    <div 
      className={`fixed top-0 left-0 right-0 p-2 text-center text-white transition-all z-50 ${
        isOnline ? 'bg-green-600' : 'bg-orange-600'
      }`}
    >
      <div className="flex items-center justify-center space-x-2">
        {isOnline ? (
          <>
            <Wifi className="w-4 h-4" />
            <span>Development server reconnected</span>
          </>
        ) : (
          <>
            <WifiOff className="w-4 h-4" />
            <span>Development server connection lost. Reconnecting...</span>
            <RefreshCw className="w-4 h-4 animate-spin" />
          </>
        )}
      </div>
    </div>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/dashboard" component={Dashboard} />
      <Route path="/manage-keywords" component={ManageKeywords} />
      <Route path="/manage-locations" component={ManageLocations} />
      <Route path="/schedule" component={Schedule} />
      <Route path="/current-rankings" component={CurrentRankings} />
      <Route path="/competitor-analysis" component={CompetitorAnalysis} />
      <Route path="/competitor-insights" component={CompetitorInsights} />
      <Route path="/competitor-insights/:competitorId" component={CompetitorInsights} />
      <Route path="/competitor-insights-diagnostic" component={CompetitorInsightsDiagnostic} />
      <Route path="/keyword-groups" component={KeywordGroups} />
      <Route path="/onpage-api-test" component={OnPageAPITest} />
      <Route path="/keyword-research-api-test" component={KeywordResearchAPITest} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ErrorBoundary fallback={<ErrorFallback />}>
        <ConnectionStatus />
        <Router />
        <Toaster />
      </ErrorBoundary>
    </QueryClientProvider>
  );
}

export default App;
