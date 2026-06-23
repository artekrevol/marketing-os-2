import React, { useState, useEffect, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SelectGroup, SelectLabel } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import TopBar from "@/components/dashboard/TopBar";
import SideNav from "@/components/dashboard/SideNav";
import { VirtualDataTable } from "@/components/ui/virtual-table";
import { cachedFetch } from "@/lib/cacheUtils";
import { useDebounce } from "@/hooks/use-debounce";
import { useToast } from "@/hooks/use-toast";
import { format, subDays } from 'date-fns';
import { ColumnDef } from "@tanstack/react-table";
import { ArrowUpDown, Filter, Download, Calendar as CalendarIcon, FolderTree, Folder } from 'lucide-react';

// Define the type for our current ranking data
interface CurrentRanking {
  keywordId: number;
  keyword: string;
  targetUrl: string | null;
  group: string | null;
  groupId?: number; // Added for export functionality
  locationName: string;
  locationCode: string | null;
  locationId?: number; // Added for export functionality
  position: number | string;
  positionChange: number | null;
  url: string | null;
  lastChecked: string | null;
  resultType: string;
  title: string | null;
  domain: string | null;
}

// Interface for keyword groups from the API
interface KeywordGroup {
  id: number;
  name: string;
  description: string | null;
  parentId: number | null;
  createdAt: string;
  updatedAt: string;
}

export default function CurrentRankings() {
  const [filterText, setFilterText] = useState("");
  const [debouncedFilterText, setDebouncedFilterText] = useState(""); 
  const [locationFilter, setLocationFilter] = useState<string>("all");
  const [groupFilter, setGroupFilter] = useState<string>("all");
  const [positionFilter, setPositionFilter] = useState<string>("all");
  const [activeTab, setActiveTab] = useState<string>("organic");
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [dateFrom, setDateFrom] = useState<Date | undefined>(subDays(new Date(), 30));
  const [dateTo, setDateTo] = useState<Date | undefined>(new Date());
  const [filterTekrevol, setFilterTekrevol] = useState(true);
  const [sortConfig, setSortConfig] = useState<{
    column: string | null;
    direction: 'asc' | 'desc';
  }>({ column: null, direction: 'asc' });
  const [currentPage, setCurrentPage] = useState(0);
  const { toast } = useToast();

  // Debounce filter text to avoid excessive filtering
  const debouncedFilter = useDebounce(filterText, 300);
  
  // Update debounced filter when it changes
  useEffect(() => {
    setDebouncedFilterText(debouncedFilter);
  }, [debouncedFilter]);

  // Custom query function to fetch rankings by result type with caching
  const fetchRankingsByResultType = useCallback(async () => {
    try {
      // Use cached fetch for better performance
      return await cachedFetch<CurrentRanking[]>(
        `/api/current-rankings?resultType=${activeTab}`,
        undefined,
        { ttl: 60000 } // Cache for 1 minute
      );
    } catch (error) {
      console.error('Error fetching rankings:', error);
      toast({
        title: 'Error',
        description: 'Failed to fetch rankings data',
        variant: 'destructive',
      });
      throw error;
    }
  }, [activeTab, toast]);

  // Fetch current rankings for selected result type
  const { data: rankings, error, isLoading } = useQuery<CurrentRanking[]>({
    queryKey: [`/api/current-rankings`, activeTab],
    queryFn: fetchRankingsByResultType,
    staleTime: 30000, // Consider data fresh for 30 seconds
    refetchOnWindowFocus: false // Don't refetch when window gains focus
  });
  
  // Fetch keyword groups for hierarchical filtering
  const { data: keywordGroups = [] } = useQuery<KeywordGroup[]>({
    queryKey: ["keywordGroups"],
    queryFn: async () => {
      const response = await fetch("/api/keyword-groups");
      if (!response.ok) throw new Error("Failed to fetch keyword groups");
      return response.json();
    },
    staleTime: 60000, // Consider data fresh for 1 minute
  });

  // Extract unique locations and groups for filters
  const locations: string[] = rankings && Array.isArray(rankings)
    ? Array.from(new Set(rankings.map((r) => r.locationName)))
    : [];

  const groups: string[] = rankings && Array.isArray(rankings)
    ? Array.from(new Set(rankings.filter((r) => r.group).map((r) => r.group as string)))
    : [];
    
  // Helper functions for group hierarchy
  const getRootGroups = () => {
    return keywordGroups.filter((group) => group.parentId === null);
  };

  const getSubgroups = (parentId: number) => {
    return keywordGroups.filter((group) => group.parentId === parentId);
  };

  // Function to sort rankings
  const sortedRankings = (data: CurrentRanking[]) => {
    if (sortConfig.column === null) return data;
    
    return [...data].sort((a, b) => {
      // Handle different column types
      if (sortConfig.column === 'position') {
        const posA = typeof a.position === 'string' ? 999 : a.position as number;
        const posB = typeof b.position === 'string' ? 999 : b.position as number;
        
        return sortConfig.direction === 'asc' 
          ? posA - posB 
          : posB - posA;
      }
      
      if (sortConfig.column === 'lastChecked') {
        const dateA = a.lastChecked ? new Date(a.lastChecked).getTime() : 0;
        const dateB = b.lastChecked ? new Date(b.lastChecked).getTime() : 0;
        
        return sortConfig.direction === 'asc' 
          ? dateA - dateB 
          : dateB - dateA;
      }
      
      // Default string comparison for other columns
      const valueA = a[sortConfig.column as keyof CurrentRanking] || '';
      const valueB = b[sortConfig.column as keyof CurrentRanking] || '';
      
      if (typeof valueA === 'string' && typeof valueB === 'string') {
        return sortConfig.direction === 'asc' 
          ? valueA.localeCompare(valueB)
          : valueB.localeCompare(valueA);
      }
      
      return 0;
    });
  };

  // Toggle sort on a column
  const handleSort = (column: string) => {
    setSortConfig(prevConfig => ({
      column,
      direction: prevConfig.column === column && prevConfig.direction === 'asc' ? 'desc' : 'asc',
    }));
  };

  // Export the current filtered results using the API
  const exportResults = (format: 'csv' | 'json' | 'excel' = 'csv') => {
    if (!filteredRankings.length) return;
    
    // Construct URL with query parameters
    const params = new URLSearchParams();
    params.append('format', format);
    params.append('resultType', activeTab);
    
    // Add filters if applied
    if (debouncedFilterText) {
      params.append('keyword', debouncedFilterText);
    }
    
    if (locationFilter !== 'all') {
      // Find the locationId for the selected location name
      const locationId = rankings?.find(r => r.locationName === locationFilter)?.locationId;
      if (locationId) {
        params.append('locationId', locationId.toString());
      }
    }
    
    if (groupFilter !== 'all') {
      // First check if this is a hierarchical group
      const selectedGroup = keywordGroups.find(g => g.name === groupFilter);
      if (selectedGroup) {
        params.append('groupId', selectedGroup.id.toString());
      } else {
        // Legacy fallback - use legacy group name
        params.append('group', groupFilter);
      }
    }
    
    // Create the export URL
    const exportUrl = `/api/export/rankings?${params.toString()}`;
    
    // Trigger download
    window.location.href = exportUrl;
  };

  // Filter the rankings based on user input
  const filteredRankings = rankings && Array.isArray(rankings)
    ? sortedRankings(rankings.filter((ranking) => {
        // Apply text filter to keyword using debounced value for better performance
        const textMatch = debouncedFilterText === "" || 
          ranking.keyword.toLowerCase().includes(debouncedFilterText.toLowerCase());
        
        // Apply location filter
        const locationMatch = locationFilter === "all" || 
          ranking.locationName === locationFilter;
        
        // Apply group filter
        let groupMatch = groupFilter === "all";
        
        if (!groupMatch) {
          // Check if a keyword group with this name exists
          const selectedGroup = keywordGroups.find(g => g.name === groupFilter);
          
          if (selectedGroup) {
            // Check if this keyword belongs to this group or any of its subgroups
            if (ranking.groupId === selectedGroup.id) {
              groupMatch = true;
            } else {
              // Check if it belongs to a subgroup
              const subgroups = getSubgroups(selectedGroup.id);
              const subgroupIds = subgroups.map(sg => sg.id);
              // Need to type-check and ensure we have a number for comparison
              if (ranking.groupId !== undefined) {
                groupMatch = subgroupIds.includes(ranking.groupId);
              }
            }
          } else {
            // Legacy fallback for backward compatibility
            groupMatch = ranking.group === groupFilter;
          }
        }
        
        // Apply position filter
        let positionMatch = true;
        if (positionFilter !== "all") {
          const position = typeof ranking.position === 'string' ? 999 : Number(ranking.position);
          
          switch (positionFilter) {
            case "top10":
              positionMatch = position <= 10;
              break;
            case "top30":
              positionMatch = position <= 30;
              break;
            case "top100":
              positionMatch = position <= 100;
              break;
            case "notRanked":
              positionMatch = position === 999 || position === 0 || position === -1;
              break;
          }
        }
        
        // Apply date filter
        let dateMatch = true;
        if (dateFrom || dateTo) {
          const rankingDate = ranking.lastChecked ? new Date(ranking.lastChecked) : null;
          
          if (rankingDate) {
            if (dateFrom && dateTo) {
              dateMatch = rankingDate >= dateFrom && rankingDate <= dateTo;
            } else if (dateFrom) {
              dateMatch = rankingDate >= dateFrom;
            } else if (dateTo) {
              dateMatch = rankingDate <= dateTo;
            }
          }
        }
        
        // Tekrevol domain filter
        let domainMatch = true;
        if (filterTekrevol) {
          // Only include rankings for Tekrevol domain or when "Not Ranked"
          const domain = ranking.domain?.toLowerCase() || '';
          domainMatch = domain.includes('tekrevol') || 
                       (typeof ranking.position === 'string' || 
                        ranking.position === 999 || 
                        ranking.position === 0 ||
                        ranking.position === -1);
        }
        
        return textMatch && locationMatch && groupMatch && positionMatch && dateMatch && domainMatch;
      }))
    : [];

  // Format position display
  const formatPosition = (position: number | string) => {
    // Handle "Not ranked" cases - all values that indicate no ranking
    if (position === 999 || position === 0 || position === "Not ranked" || position === -1) {
      return <Badge variant="outline" className="text-gray-500">Not Ranked</Badge>;
    }
    
    const pos = Number(position);
    if (pos <= 10) return <Badge className="bg-green-500">#{pos}</Badge>;
    if (pos <= 20) return <Badge className="bg-yellow-500">#{pos}</Badge>;
    return <Badge className="bg-red-500">#{pos}</Badge>;
  };
  
  // Format position change with improved handling of edge cases
  const formatPositionChange = (change: number | null, position: number | string) => {
    // For position -1, show appropriate change indicator
    if (position === -1) {
      // If position is -1 (not ranked) and change is less than 0, 
      // it means the keyword fell out of rankings
      if (change && change < 0) {
        return <span className="text-red-500 flex items-center">↓ Lost</span>;
      }
      // If position is -1 and change is 0, it's consistently not ranked
      else if (change === 0) {
        return <span className="text-muted-foreground">-</span>;
      }
    }
    
    // For first time rankings (position > 0 but no previous data)
    if (position !== -1 && (change === null || change === 0) && typeof position === 'number' && position > 0) {
      return <span className="text-blue-500 flex items-center">↑ New</span>;
    }
    
    // Standard cases
    if (change === null || change === 0) {
      return <span className="text-muted-foreground">-</span>;
    }
    if (change > 0) {
      return <span className="text-green-500 flex items-center">↑ {change}</span>;
    }
    return <span className="text-red-500 flex items-center">↓ {Math.abs(change)}</span>;
  };

  // Define columns for the data table
  const columns: ColumnDef<CurrentRanking>[] = [
    {
      accessorKey: "keyword",
      header: ({ column }) => (
        <Button
          variant="ghost"
          onClick={() => handleSort("keyword")}
          className="p-0 hover:bg-transparent"
        >
          <span>Keyword</span>
          <ArrowUpDown className="ml-2 h-4 w-4" />
        </Button>
      ),
      cell: ({ row }) => <span className="font-medium">{row.original.keyword}</span>
    },
    {
      accessorKey: "targetUrl",
      header: "Target URL",
      cell: ({ row }) => (
        <span className="text-muted-foreground truncate max-w-[200px]">
          {row.original.targetUrl || "-"}
        </span>
      )
    },
    {
      accessorKey: "locationName",
      header: ({ column }) => (
        <Button
          variant="ghost"
          onClick={() => handleSort("locationName")}
          className="p-0 hover:bg-transparent"
        >
          <span>Location</span>
          <ArrowUpDown className="ml-2 h-4 w-4" />
        </Button>
      ),
      cell: ({ row }) => <span>{row.original.locationName}</span>
    },
    {
      accessorKey: "group",
      header: ({ column }) => (
        <Button
          variant="ghost"
          onClick={() => handleSort("group")}
          className="p-0 hover:bg-transparent"
        >
          <span>Group</span>
          <ArrowUpDown className="ml-2 h-4 w-4" />
        </Button>
      ),
      cell: ({ row }) => {
        // If we have a groupId, use the hierarchical group name
        if (row.original.groupId) {
          const group = keywordGroups.find(g => g.id === row.original.groupId);
          if (group) {
            // If this is a subgroup, show parent > child format
            if (group.parentId) {
              const parentGroup = keywordGroups.find(g => g.id === group.parentId);
              if (parentGroup) {
                return (
                  <div className="flex items-center">
                    <FolderTree className="h-3 w-3 mr-1 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground mr-1">{parentGroup.name} &gt;</span>
                    <span>{group.name}</span>
                  </div>
                );
              }
            }
            // Otherwise just show the group name
            return (
              <div className="flex items-center">
                <FolderTree className="h-4 w-4 mr-2 text-primary" />
                <span>{group.name}</span>
              </div>
            );
          }
        }
        
        // Fallback to legacy group name or dash if none
        return <span>{row.original.group || "-"}</span>;
      }
    },
    {
      id: "position",
      header: ({ column }) => (
        <Button
          variant="ghost"
          onClick={() => handleSort("position")}
          className="p-0 hover:bg-transparent"
        >
          <span>Position</span>
          <ArrowUpDown className="ml-2 h-4 w-4" />
        </Button>
      ),
      cell: ({ row }) => (
        <span className="text-center">
          {formatPosition(row.original.position)}
        </span>
      )
    },
    {
      id: "positionChange",
      header: "Change",
      cell: ({ row }) => (
        <span className="text-center">
          {formatPositionChange(row.original.positionChange, row.original.position)}
        </span>
      )
    },
    {
      id: "title",
      header: "Page Title",
      cell: ({ row }) => (
        <span className="truncate max-w-[200px] inline-block">
          {row.original.title || "-"}
        </span>
      )
    },
    {
      id: "domain",
      header: ({ column }) => (
        <Button
          variant="ghost"
          onClick={() => handleSort("domain")}
          className="p-0 hover:bg-transparent"
        >
          <span>Domain</span>
          <ArrowUpDown className="ml-2 h-4 w-4" />
        </Button>
      ),
      cell: ({ row }) => (
        <span className="truncate max-w-[150px] inline-block">
          {row.original.domain || "-"}
        </span>
      )
    },
    {
      id: "url",
      header: "Ranking URL",
      cell: ({ row }) => (
        row.original.url 
          ? <a href={`https://${row.original.url}`} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline truncate max-w-[200px] inline-block">
              {row.original.url}
            </a>
          : <span>-</span>
      )
    },
    {
      id: "lastChecked",
      header: ({ column }) => (
        <Button
          variant="ghost"
          onClick={() => handleSort("lastChecked")}
          className="p-0 hover:bg-transparent"
        >
          <span>Last Checked</span>
          <ArrowUpDown className="ml-2 h-4 w-4" />
        </Button>
      ),
      cell: ({ row }) => {
        try {
          return (
            <span>
              {row.original.lastChecked ? 
                format(new Date(row.original.lastChecked), 'MMM d, yyyy HH:mm') : 
                "Never"}
            </span>
          );
        } catch (error) {
          console.error("Date formatting error:", error);
          return <span>Invalid date</span>;
        }
      }
    }
  ];

  // Handle page change
  const handlePageChange = (newPage: number) => {
    setCurrentPage(newPage);
    // Scroll to top of table for better user experience
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="flex h-screen">
      <SideNav />
      
      <div className="flex-1 flex flex-col">
        <TopBar title="Current Rankings" onMobileMenuToggle={() => {}} />
        
        <main className="flex-1 p-6 overflow-y-auto">
          <div className="max-w-7xl mx-auto">
            <Card className="mb-8">
              <CardHeader>
                <CardTitle>Rankings Filter</CardTitle>
                <CardDescription>
                  Filter the current keyword rankings by various criteria
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex flex-col gap-4">
                  {/* Basic filters */}
                  <div className="flex flex-col md:flex-row gap-4">
                    <div className="flex-1">
                      <Input
                        placeholder="Filter by keyword..."
                        value={filterText}
                        onChange={(e) => setFilterText(e.target.value)}
                        className="w-full"
                      />
                    </div>
                    
                    <div className="w-full md:w-48">
                      <Select
                        value={locationFilter}
                        onValueChange={(value) => setLocationFilter(value)}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Location" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All Locations</SelectItem>
                          {locations.map((location) => (
                            <SelectItem key={location} value={location}>
                              {location}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    
                    <div className="w-full md:w-48">
                      <Select
                        value={groupFilter}
                        onValueChange={(value) => setGroupFilter(value)}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Group" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All Groups</SelectItem>
                          
                          {/* Hierarchical groups */}
                          {getRootGroups().length > 0 && (
                            <SelectGroup>
                              <SelectLabel>Main Groups</SelectLabel>
                              {getRootGroups().map((group) => (
                                <SelectItem 
                                  key={`group-${group.id}`} 
                                  value={group.name}
                                >
                                  <div className="flex items-center">
                                    <FolderTree className="h-4 w-4 mr-2 text-primary" />
                                    {group.name}
                                  </div>
                                </SelectItem>
                              ))}
                            </SelectGroup>
                          )}
                          
                          {/* Add subgroups for each main group */}
                          {getRootGroups().map((rootGroup) => {
                            const subgroups = getSubgroups(rootGroup.id);
                            if (subgroups.length === 0) return null;
                            
                            return (
                              <SelectGroup key={`subgroups-${rootGroup.id}`}>
                                <SelectLabel>{rootGroup.name} Subgroups</SelectLabel>
                                {subgroups.map((subgroup) => (
                                  <SelectItem 
                                    key={`subgroup-${subgroup.id}`} 
                                    value={subgroup.name}
                                  >
                                    <div className="flex items-center pl-4">
                                      <Folder className="h-4 w-4 mr-2 text-muted-foreground" />
                                      {subgroup.name}
                                    </div>
                                  </SelectItem>
                                ))}
                              </SelectGroup>
                            );
                          })}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="w-full md:w-48">
                      <Select
                        value={positionFilter}
                        onValueChange={(value) => setPositionFilter(value)}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Position" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All Positions</SelectItem>
                          <SelectItem value="top10">Top 10</SelectItem>
                          <SelectItem value="top30">Top 30</SelectItem>
                          <SelectItem value="top100">Top 100</SelectItem>
                          <SelectItem value="notRanked">Not Ranked</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  
                  {/* Filter and Advanced Options */}
                  <div className="flex flex-col md:flex-row items-center justify-between gap-4">
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
                        className="gap-2"
                      >
                        <Filter className="h-4 w-4" />
                        {showAdvancedFilters ? "Hide Advanced" : "Show Advanced Filters"}
                      </Button>
                      
                      <div className="flex items-center space-x-2">
                        <Checkbox
                          id="filterTekrevol"
                          checked={filterTekrevol}
                          onCheckedChange={(checked) => 
                            setFilterTekrevol(checked === true)
                          }
                        />
                        <Label htmlFor="filterTekrevol">Show only Tekrevol domains</Label>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <Button 
                        variant="outline" 
                        size="sm"
                        onClick={() => exportResults('csv')}
                        disabled={filteredRankings.length === 0}
                        className="whitespace-nowrap"
                      >
                        <Download className="h-4 w-4 mr-2" />
                        Export
                      </Button>
                      
                      <Select
                        onValueChange={(value) => exportResults(value as 'csv' | 'json' | 'excel')}
                        disabled={filteredRankings.length === 0}
                      >
                        <SelectTrigger className="h-9 w-[120px]">
                          <SelectValue placeholder="Format" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="csv">CSV Format</SelectItem>
                          <SelectItem value="excel">Excel Format</SelectItem>
                          <SelectItem value="json">JSON Format</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  {/* Advanced filters */}
                  {showAdvancedFilters && (
                    <div className="mt-4 p-4 border rounded-md bg-muted/20">
                      <h3 className="text-sm font-medium mb-4">Advanced Filtering Options</h3>
                      <div className="flex flex-col md:flex-row gap-6">
                        <div className="flex flex-col gap-2">
                          <Label htmlFor="dateFrom" className="text-xs">From Date</Label>
                          <Popover>
                            <PopoverTrigger asChild>
                              <Button
                                id="dateFrom"
                                variant="outline"
                                size="sm"
                                className="w-[240px] justify-start text-left font-normal"
                              >
                                <CalendarIcon className="mr-2 h-4 w-4" />
                                {dateFrom ? format(dateFrom, "PPP") : "Select date"}
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-0" align="start">
                              <Calendar
                                mode="single"
                                selected={dateFrom}
                                onSelect={setDateFrom}
                                initialFocus
                              />
                            </PopoverContent>
                          </Popover>
                        </div>

                        <div className="flex flex-col gap-2">
                          <Label htmlFor="dateTo" className="text-xs">To Date</Label>
                          <Popover>
                            <PopoverTrigger asChild>
                              <Button
                                id="dateTo"
                                variant="outline"
                                size="sm"
                                className="w-[240px] justify-start text-left font-normal"
                              >
                                <CalendarIcon className="mr-2 h-4 w-4" />
                                {dateTo ? format(dateTo, "PPP") : "Select date"}
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-0" align="start">
                              <Calendar
                                mode="single"
                                selected={dateTo}
                                onSelect={setDateTo}
                                initialFocus
                              />
                            </PopoverContent>
                          </Popover>
                        </div>

                        <div className="flex flex-col gap-2 md:mt-6">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setDateFrom(undefined);
                              setDateTo(undefined);
                              setPositionFilter("all");
                              setFilterTekrevol(true);
                            }}
                          >
                            Reset Filters
                          </Button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Current Rankings</CardTitle>
                <CardDescription>
                  Current rankings for all your tracked keywords by result type
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Tabs
                  defaultValue="organic"
                  value={activeTab}
                  onValueChange={setActiveTab}
                  className="w-full"
                >
                  <TabsList className="grid grid-cols-3 mb-8">
                    <TabsTrigger value="organic">Main Organic Results</TabsTrigger>
                    <TabsTrigger value="other_organic">Other Organic Results</TabsTrigger>
                    <TabsTrigger value="local_pack">Local Pack (GMB)</TabsTrigger>
                  </TabsList>
                  
                  <TabsContent value="organic" className="mt-0">
                    <div className="text-sm text-muted-foreground mb-4">
                      Main organic search results from the standard listings section
                    </div>
                    {isLoading ? (
                      <div className="flex justify-center items-center h-64">
                        <div className="text-lg">Loading rankings data...</div>
                      </div>
                    ) : error ? (
                      <div className="text-red-500">Error loading rankings data</div>
                    ) : (
                      <VirtualDataTable 
                        data={filteredRankings}
                        columns={columns}
                        searchColumn="keyword"
                        searchPlaceholder="Search keywords..."
                        showPagination={true}
                        initialPageSize={25}
                        initialPageIndex={currentPage}
                        onPageChange={handlePageChange}
                        rowsPerPageOptions={[10, 25, 50, 100]}
                      />
                    )}
                  </TabsContent>
                  
                  <TabsContent value="other_organic" className="mt-0">
                    <div className="text-sm text-muted-foreground mb-4">
                      Additional organic search results that appear in other sections like featured snippets
                    </div>
                    {isLoading ? (
                      <div className="flex justify-center items-center h-64">
                        <div className="text-lg">Loading rankings data...</div>
                      </div>
                    ) : error ? (
                      <div className="text-red-500">Error loading rankings data</div>
                    ) : (
                      <VirtualDataTable 
                        data={filteredRankings}
                        columns={columns}
                        searchColumn="keyword"
                        searchPlaceholder="Search keywords..."
                        showPagination={true}
                        initialPageSize={25}
                        initialPageIndex={currentPage}
                        onPageChange={handlePageChange}
                        rowsPerPageOptions={[10, 25, 50, 100]}
                      />
                    )}
                  </TabsContent>
                  
                  <TabsContent value="local_pack" className="mt-0">
                    <div className="text-sm text-muted-foreground mb-4">
                      Local pack results from Google My Business listings (map results)
                    </div>
                    {isLoading ? (
                      <div className="flex justify-center items-center h-64">
                        <div className="text-lg">Loading rankings data...</div>
                      </div>
                    ) : error ? (
                      <div className="text-red-500">Error loading rankings data</div>
                    ) : (
                      <VirtualDataTable 
                        data={filteredRankings}
                        columns={columns}
                        searchColumn="keyword"
                        searchPlaceholder="Search keywords..."
                        showPagination={true}
                        initialPageSize={25}
                        initialPageIndex={currentPage}
                        onPageChange={handlePageChange}
                        rowsPerPageOptions={[10, 25, 50, 100]}
                      />
                    )}
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>
          </div>
        </main>
      </div>
    </div>
  );
}