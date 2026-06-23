import { useState } from "react";
import TopBar from "@/components/dashboard/TopBar";
import SideNav from "@/components/dashboard/SideNav";
import KeywordGroupsComponent from "@/components/dashboard/KeywordGroups";

export default function KeywordGroupsPage() {
  const [isMobileNavOpen, setMobileNavOpen] = useState(false);
  
  return (
    <div className="flex min-h-screen bg-muted/40">
      <SideNav isMobileNavOpen={isMobileNavOpen} />
      
      <div className="flex-1">
        <TopBar 
          title="Keyword Groups" 
          onMobileMenuToggle={() => setMobileNavOpen(!isMobileNavOpen)} 
        />
        
        <main className="px-4 py-4 md:px-8 mb-20">
          <KeywordGroupsComponent />
        </main>
      </div>
    </div>
  );
}