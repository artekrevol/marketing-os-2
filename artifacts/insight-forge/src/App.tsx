import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/lib/useAuth";
import AppShell from "./components/AppShell";
import Hub from "./pages/Hub.tsx";
import Index from "./pages/Index.tsx";
import NewProject from "./pages/NewProject.tsx";
import ProjectLayout from "./pages/ProjectLayout.tsx";
import ResearchDashboard from "./pages/ResearchDashboard.tsx";
import BriefProposal from "./pages/BriefProposal.tsx";
import OutlineEditor from "./pages/OutlineEditor.tsx";
import DraftingInterface from "./pages/DraftingInterface.tsx";
import DraftReview from "./pages/DraftReview.tsx";
import AdminDashboard from "./pages/AdminDashboard.tsx";
import AdminUsers from "./pages/AdminUsers.tsx";
import AdminBrands from "./pages/AdminBrands.tsx";
import AdminActivity from "./pages/AdminActivity.tsx";
import AdminUsage from "./pages/AdminUsage.tsx";
import AdminSystem from "./pages/AdminSystem.tsx";
import Auth from "./pages/Auth.tsx";
import NotFound from "./pages/NotFound.tsx";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <AuthProvider>
          <Routes>
            <Route path="/" element={<Hub />} />
            <Route path="/auth" element={<Auth />} />

            <Route element={<AppShell />}>
              <Route path="/projects" element={<Index />} />
              <Route path="/new" element={<NewProject />} />
              <Route path="/admin" element={<AdminDashboard />} />
              <Route path="/admin/dashboard" element={<AdminDashboard />} />
              <Route path="/admin/users" element={<AdminUsers />} />
              <Route path="/admin/brands" element={<AdminBrands />} />
              <Route path="/admin/activity" element={<AdminActivity />} />
              <Route path="/admin/usage" element={<AdminUsage />} />
              <Route path="/admin/system" element={<AdminSystem />} />
              <Route path="/project/:id" element={<ProjectLayout />}>
                <Route index element={<Navigate to="brief" replace />} />
                <Route path="brief" element={<BriefProposal />} />
                <Route path="research" element={<ResearchDashboard />} />
                <Route path="outline" element={<OutlineEditor />} />
                <Route path="draft" element={<DraftingInterface />} />
                <Route path="review" element={<DraftReview />} />
              </Route>
              <Route path="*" element={<NotFound />} />
            </Route>
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
