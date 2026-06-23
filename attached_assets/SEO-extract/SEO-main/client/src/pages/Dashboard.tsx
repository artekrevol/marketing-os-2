import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import GridLayout from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import { Skeleton } from "@/components/ui/skeleton";
import SideNav from "@/components/dashboard/SideNav";
import TopBar from "@/components/dashboard/TopBar";
import StatsCard from "@/components/dashboard/StatsCard";
import RankChangesTable from "@/components/dashboard/RankChangesTable";
import { RunCrawlerButton } from "@/components/dashboard/RunCrawlerButton";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useIsMobile } from "@/hooks/use-mobile";

interface DashboardStats {
  keywordCount: number;
  locationCount: number;
  averagePosition: number;
  topTenCount: number;
}

interface DashboardLayout {
  id: number;
  userId: number;
  name: string;
  layouts: any; // Layout configuration
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

// Widget types for the dashboard
const WIDGET_TYPES = {
  STATS: 'stats',
  TABLE: 'table'
};

// Default layout configuration - removed chart and form as requested
const DEFAULT_LAYOUTS = [
  { i: WIDGET_TYPES.STATS, x: 0, y: 0, w: 12, h: 4, static: false },
  { i: WIDGET_TYPES.TABLE, x: 0, y: 4, w: 12, h: 16, static: false }
];

export default function Dashboard() {
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const { toast } = useToast();
  const isMobile = useIsMobile();
  
  // Grid layout state
  const [layouts, setLayouts] = useState(DEFAULT_LAYOUTS);
  const [isEditing, setIsEditing] = useState(false);
  const [savedLayouts, setSavedLayouts] = useState<DashboardLayout[]>([]);
  const [activeLayoutId, setActiveLayoutId] = useState<number | null>(null);
  const [layoutName, setLayoutName] = useState("Default Layout");
  
  // Fetch dashboard stats
  const { data: stats, isLoading } = useQuery<DashboardStats>({
    queryKey: ["/api/dashboard/stats"],
  });
  
  // Fetch saved dashboard layouts
  const { data: layoutsData } = useQuery<DashboardLayout[]>({
    queryKey: ["/api/dashboard/layouts"],
  });
  
  // Fetch active layout
  const { data: activeLayout } = useQuery<DashboardLayout>({
    queryKey: ["/api/dashboard/layouts/active"],
  });
  
  // Load layouts when data is fetched
  useEffect(() => {
    if (layoutsData) {
      setSavedLayouts(layoutsData);
    }
    
    if (activeLayout && activeLayout.layouts) {
      try {
        // If the layout has a valid configuration, use it
        if (Array.isArray(activeLayout.layouts)) {
          setLayouts(activeLayout.layouts);
          setActiveLayoutId(activeLayout.id);
          setLayoutName(activeLayout.name);
        }
      } catch (e) {
        console.error("Error loading saved layout:", e);
        // Fallback to default layout if there's an error
        setLayouts(DEFAULT_LAYOUTS);
      }
    }
  }, [layoutsData, activeLayout]);
  
  // Save the current layout configuration
  const saveLayout = async () => {
    try {
      // Default to user ID 1 for now
      const userId = 1;
      
      const layoutData = {
        userId,
        name: layoutName,
        layouts: layouts,
        isActive: true
      };
      
      // If we're updating an existing layout
      if (activeLayoutId && activeLayoutId > 0) {
        const response = await fetch(`/api/dashboard/layouts/${activeLayoutId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(layoutData)
        });
        
        if (!response.ok) throw new Error('Failed to update layout');
        
        toast({
          title: "Layout updated",
          description: `Layout "${layoutName}" has been updated.`,
          variant: "default",
        });
      } else {
        // Create a new layout
        const response = await fetch('/api/dashboard/layouts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(layoutData)
        });
        
        if (!response.ok) throw new Error('Failed to save layout');
        
        const newLayout = await response.json();
        setActiveLayoutId(newLayout.id);
        
        toast({
          title: "Layout saved",
          description: `Layout "${layoutName}" has been saved.`,
          variant: "default",
        });
      }
      
      // Exit edit mode
      setIsEditing(false);
      
      // Refresh layouts
      window.location.reload();
    } catch (error) {
      console.error('Error saving layout:', error);
      toast({
        title: "Error",
        description: "Failed to save layout. Please try again.",
        variant: "destructive",
      });
    }
  };
  
  // Handle layout changes
  const handleLayoutChange = (newLayout: any) => {
    setLayouts(newLayout);
  };
  
  // Toggle edit mode
  const toggleEditMode = () => {
    setIsEditing(!isEditing);
    // If canceling edit mode, revert to saved layout
    if (isEditing && activeLayout && activeLayout.layouts) {
      setLayouts(activeLayout.layouts);
    }
  };
  
  // Stats placeholders during loading
  const statsCards = isLoading || !stats ? (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      {[1, 2, 3, 4].map((_, i) => (
        <Skeleton key={i} className="h-28" />
      ))}
    </div>
  ) : (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      <StatsCard
        title="Tracked Keywords"
        value={stats.keywordCount}
        icon="post_add"
        trend={{ 
          value: `${Math.floor(stats.keywordCount / 10)} added this month`, 
          direction: "neutral" 
        }}
      />
      
      <StatsCard
        title="Average Position"
        value={stats.averagePosition}
        icon="trending_up"
        iconClassName="text-success"
        trend={{ 
          value: "2.1 from last week", 
          direction: "up" 
        }}
      />
      
      <StatsCard
        title="Top 10 Rankings"
        value={stats.topTenCount}
        icon="star"
        iconClassName="text-accent"
        trend={{ 
          value: "5 from last week", 
          direction: "up" 
        }}
      />
      
      <StatsCard
        title="Tracked Locations"
        value={stats.locationCount}
        icon="location_on"
        iconClassName="text-secondary"
        trend={{ 
          value: `${stats.locationCount} locations active`, 
          direction: "neutral" 
        }}
      />
    </div>
  );

  const toggleMobileMenu = () => {
    setShowMobileMenu(!showMobileMenu);
  };

  return (
    <div className="bg-neutral-100 text-neutral-700 flex h-screen overflow-hidden">
      {/* Sidebar */}
      <SideNav />
      
      {/* Mobile Menu Overlay */}
      {showMobileMenu && (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-40 md:hidden" onClick={toggleMobileMenu}>
          <div className="h-full w-64 bg-white" onClick={e => e.stopPropagation()}>
            <SideNav />
          </div>
        </div>
      )}
      
      {/* Main Content */}
      <main className="flex-grow overflow-hidden flex flex-col h-screen">
        <TopBar title="Dashboard Overview" onMobileMenuToggle={toggleMobileMenu} />
        
        {/* Layout Controls */}
        <div className="border-b border-border bg-card px-4 py-2 flex justify-between items-center">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">Layout:</span>
            {isEditing ? (
              <input
                type="text"
                value={layoutName}
                onChange={(e) => setLayoutName(e.target.value)}
                className="border rounded px-2 py-1 text-sm"
                placeholder="Layout name"
              />
            ) : (
              <span className="text-sm">{layoutName}</span>
            )}
          </div>
          <div className="flex gap-2">
            {isEditing ? (
              <>
                <Button size="sm" variant="outline" onClick={toggleEditMode}>
                  Cancel
                </Button>
                <Button size="sm" variant="default" onClick={saveLayout}>
                  Save Layout
                </Button>
              </>
            ) : (
              <Button size="sm" variant="outline" onClick={toggleEditMode}>
                {activeLayoutId ? "Edit Layout" : "Create Layout"}
              </Button>
            )}
          </div>
        </div>
        
        {/* Content Container */}
        <div className="flex-grow overflow-y-auto p-4 md:p-6">
          {/* For mobile devices, use the standard layout */}
          {isMobile ? (
            <>
              {/* Stats Cards Row */}
              <div className="mb-6">{statsCards}</div>
              
              {/* Run Crawler Button */}
              <div className="flex justify-end mb-4">
                <RunCrawlerButton />
              </div>
              
              {/* Keyword Table */}
              <div className="grid grid-cols-1 gap-6">
                <div>
                  <RankChangesTable />
                </div>
              </div>
            </>
          ) : (
            /* Grid Layout for desktop/tablet */
            <div className={isEditing ? "grid-edit-mode" : ""}>
              <GridLayout
                className="layout"
                layout={layouts}
                cols={12}
                rowHeight={30}
                width={1200}
                margin={[16, 16]}
                isDraggable={isEditing}
                isResizable={isEditing}
                onLayoutChange={handleLayoutChange}
              >
                {/* Stats Widget */}
                <div key={WIDGET_TYPES.STATS} className="widget widget-stats bg-white rounded-lg shadow-sm p-4 overflow-hidden">
                  <div className="widget-header flex justify-between items-center mb-2">
                    <h3 className="text-lg font-semibold">Key Stats</h3>
                    {isEditing && <span className="text-xs text-muted-foreground">Drag to move</span>}
                  </div>
                  <div className="widget-content">
                    {statsCards}
                  </div>
                </div>
                
                {/* Table Widget */}
                <div key={WIDGET_TYPES.TABLE} className="widget widget-table bg-white rounded-lg shadow-sm p-4 overflow-hidden">
                  <div className="widget-header flex justify-between items-center mb-2">
                    <h3 className="text-lg font-semibold">Rank Changes</h3>
                    {isEditing && <span className="text-xs text-muted-foreground">Drag to move</span>}
                  </div>
                  <div className="flex justify-end mb-4">
                    <RunCrawlerButton />
                  </div>
                  <div className="widget-content overflow-auto">
                    <RankChangesTable />
                  </div>
                </div>
              </GridLayout>
              
              {/* Editing overlay/instructions */}
              {isEditing && (
                <div className="fixed bottom-4 left-1/2 transform -translate-x-1/2 bg-secondary text-secondary-foreground rounded-full px-4 py-2 shadow-lg">
                  <p className="text-sm">Drag widgets to reposition. Resize from corners and edges.</p>
                </div>
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}