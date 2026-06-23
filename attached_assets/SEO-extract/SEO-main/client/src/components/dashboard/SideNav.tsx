import React from "react";
import { Link, useLocation } from "wouter";
import { BarChart3, Compass, Globe, Hash, List, LineChart, Settings, FolderTree, SearchCode, TestTube, Lightbulb } from "lucide-react";
import { cn } from "@/lib/utils";

interface SideNavProps {
  isMobileNavOpen?: boolean;
}

const SideNav: React.FC<SideNavProps> = ({ isMobileNavOpen }) => {
  const [location] = useLocation();
  
  const navigationItems = [
    {
      title: "Dashboard",
      href: "/dashboard",
      icon: BarChart3,
      active: location === "/dashboard"
    },
    {
      title: "Current Rankings",
      href: "/current-rankings",
      icon: LineChart,
      active: location === "/current-rankings"
    },
    {
      title: "Competitor Analysis",
      href: "/competitor-analysis",
      icon: List,
      active: location === "/competitor-analysis"
    },
    {
      title: "Competitor Insights",
      href: "/competitor-insights",
      icon: SearchCode,
      active: location === "/competitor-insights"
    },
    {
      title: "OnPage API Test",
      href: "/onpage-api-test",
      icon: TestTube,
      active: location === "/onpage-api-test"
    },
    {
      title: "Keyword Research API Test",
      href: "/keyword-research-api-test",
      icon: Lightbulb,
      active: location === "/keyword-research-api-test"
    },
    {
      title: "Keyword Groups",
      href: "/keyword-groups",
      icon: FolderTree,
      active: location === "/keyword-groups"
    },
    {
      title: "Manage Keywords",
      href: "/manage-keywords",
      icon: Hash,
      active: location === "/manage-keywords"
    },
    {
      title: "Manage Locations",
      href: "/manage-locations",
      icon: Globe,
      active: location === "/manage-locations"
    },
    {
      title: "Schedule",
      href: "/schedule",
      icon: Compass,
      active: location === "/schedule"
    }
  ];

  return (
    <nav className={cn(
      "flex-col h-full w-64 border-r bg-card px-3 py-6",
      isMobileNavOpen ? "block absolute z-50 h-screen w-64" : "hidden md:flex"
    )}>
      <div className="mb-8 px-4">
        <h2 className="text-2xl font-bold text-foreground">
          Tekrevol <span className="text-primary">SEO</span>
        </h2>
        <p className="text-sm text-muted-foreground">
          Keyword Rank Tracker
        </p>
      </div>
      <div className="space-y-1">
        {navigationItems.map((item) => (
          <Link 
            key={item.href} 
            href={item.href}
            className={cn(
              "flex items-center gap-3 rounded-lg px-4 py-2.5 text-sm font-medium transition-all hover:text-foreground",
              item.active
                ? "bg-muted font-semibold text-foreground"
                : "text-muted-foreground hover:bg-muted/50"
            )}
          >
            <item.icon className="h-4 w-4" />
            {item.title}
          </Link>
        ))}
      </div>
    </nav>
  );
};

export default SideNav;