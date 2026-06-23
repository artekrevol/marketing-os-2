import { useState } from "react";
import { Bell, Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

interface TopBarProps {
  title: string;
  onMobileMenuToggle: () => void;
}

export default function TopBar({ title, onMobileMenuToggle }: TopBarProps) {
  return (
    <header className="bg-white border-b border-neutral-200 py-3 px-4 flex items-center justify-between">
      <div className="flex items-center">
        <Button 
          variant="ghost" 
          size="icon" 
          className="mr-4 md:hidden" 
          onClick={onMobileMenuToggle}
        >
          <Menu className="h-5 w-5" />
        </Button>
        <h2 className="text-lg font-semibold">{title}</h2>
      </div>
      
      <div className="flex items-center">
        <Button variant="ghost" size="icon" className="mr-2">
          <Bell className="h-5 w-5" />
        </Button>
        
        <div className="relative ml-2">
          <Button variant="ghost" className="flex items-center space-x-2 h-8">
            <Avatar className="h-8 w-8">
              <AvatarFallback className="bg-primary text-white">JD</AvatarFallback>
            </Avatar>
            <span className="hidden md:inline text-sm font-medium">John Doe</span>
          </Button>
        </div>
      </div>
    </header>
  );
}
