import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { getQueryFn, apiRequest } from "@/lib/queryClient";
import { useLocation } from "wouter";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertCircle,
  ExternalLink,
  RefreshCw,
  Search,
  Ban,
  CheckCircle2,
  XCircle,
  Trash2,
  BarChart2,
  Database
} from "lucide-react";
import TopBar from "@/components/dashboard/TopBar";
import SideNav from "@/components/dashboard/SideNav";
import { LocationSelect } from "@/components/ui/location-select";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface Competitor {
  id: number;
  keywordId: number;
  domain: string;
  url: string;
  title: string;
  position: number;
  batchId: number;
  date: string;
}

interface Keyword {
  id: number;
  keyword: string;
  targetUrl: string | null;
  group: string | null;
  locationId: number | null;
  trackDaily: boolean;
}

interface BlacklistedCompetitor {
  id: number;
  domain: string;
  createdAt: string;
  reason: string | null;
  keywordId: number | null;
}

/**
 * Highlights the matched part of a string
 * @param text The text to highlight in
 * @param query The search query to highlight
 * @returns JSX with the highlighted matches
 */
function highlightMatch(text: string, query: string) {
  if (!query.trim()) return text;

  const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
  const parts = text.split(regex);

  return (
    <>
      {parts.map((part, i) =>
        regex.test(part) ? <span key={i} className="bg-yellow-200 dark:bg-yellow-800">{part}</span> : part
      )}
    </>
  );
}

export default function CompetitorAnalysis() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedKeywordId, setSelectedKeywordId] = useState<number | null>(null);
  const [selectedLocationId, setSelectedLocationId] = useState<number | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
  const [, navigate] = useLocation();

  // Sorting state
  const [sortField, setSortField] = useState<string>("position");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");

  // State for blacklist dialog
  const [isBlacklistDialogOpen, setIsBlacklistDialogOpen] = useState(false);
  const [blacklistReason, setBlacklistReason] = useState("");
  const [currentBlacklistDomain, setCurrentBlacklistDomain] = useState("");

  // State for manage blacklist dialog
  const [isManageBlacklistDialogOpen, setIsManageBlacklistDialogOpen] = useState(false);

  // Fetch keywords
  const { data: keywordsData = [], isLoading: isLoadingKeywords } = useQuery({
    queryKey: ["/api/keywords"],
    queryFn: getQueryFn({ on401: "returnNull" }),
  });

  // Type assertion for keywords
  const keywords = keywordsData as Keyword[];

  // Function to check if a domain/URL is our own (matches the keyword's targetUrl or contains tekrevol.com)
  const isOurPage = (competitor: Competitor, keyword?: Keyword) => {
    // First check - is this our domain (tekrevol.com)?
    if (competitor.domain.includes('tekrevol.com') || competitor.url.includes('tekrevol.com')) {
      return true;
    }

    // Second check - does it match the keyword's targetUrl?
    if (!keyword || !keyword.targetUrl) return false;

    // Check if the URL matches exactly
    if (competitor.url === keyword.targetUrl) return true;

    // Check if the URL matches without http(s):// and trailing slash
    const normalizeUrl = (url: string) => {
      return url.replace(/^https?:\/\//, '').replace(/\/$/, '');
    };

    return normalizeUrl(competitor.url) === normalizeUrl(keyword.targetUrl);
  };

  // Fetch locations
  const { data: locations = [], isLoading: isLoadingLocations } = useQuery({
    queryKey: ["/api/locations"],
    queryFn: getQueryFn({ on401: "returnNull" }),
  });

  // Fetch current rankings to get our page's position
  const { data: currentRankingsData = [], isLoading: isLoadingRankings } = useQuery({
    queryKey: ["/api/current-rankings"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  // Fetch competitors for selected keyword
  const {
    data: competitorsData = [],
    isLoading: isLoadingCompetitors,
    error: competitorsError,
    refetch: refetchCompetitors
  } = useQuery({
    queryKey: ["/api/competitors", selectedKeywordId],
    queryFn: async () => {
      if (!selectedKeywordId) {
        console.log("No keyword selected, returning empty array");
        return [];
      }
      console.log(`Fetching competitors for keyword ${selectedKeywordId}`);
      try {
        const response = await fetch(`/api/competitors?keywordId=${selectedKeywordId}`);
        console.log(`API response status: ${response.status}`);
        if (!response.ok) {
          const errorText = await response.text();
          console.error("Failed to fetch competitors:", response.status, errorText);
          throw new Error(`Failed to fetch competitors: ${response.status} ${errorText}`);
        }
        const data = await response.json();
        console.log(`Received ${data.length} competitors from API:`, data);

        // Convert the response into the proper Competitor format
        const formattedData = data.map((item: any) => ({
          id: Number(item.id),
          keywordId: Number(item.keywordId),
          domain: String(item.domain || ''),
          url: String(item.url || ''),
          title: String(item.title || ''),
          position: Number(item.position || 0),
          batchId: item.batchId ? Number(item.batchId) : null,
          date: String(item.date || new Date().toISOString())
        }));

        console.log(`Formatted ${formattedData.length} competitors`);

        // If we have a targetUrl for this keyword but our domain isn't in the results,
        // add a virtual entry for our domain to compare against competitors
        const selectedKeyword = keywords.find(k => k.id === selectedKeywordId);
        if (selectedKeyword?.targetUrl &&
          !formattedData.some((item: { url: string; domain: string }) =>
            item.url.includes('tekrevol.com') ||
            item.domain.includes('tekrevol.com')
          )) {
          // Extract the domain from the targetUrl
          const domain = selectedKeyword.targetUrl
            .replace(/^https?:\/\//, '')
            .split('/')[0];

          // Try to find our actual position from current rankings
          const ourRanking = (currentRankingsData as any[]).find((r) =>
            r.keywordId === selectedKeywordId &&
            (r.domain?.includes('tekrevol.com') || r.targetUrl?.includes('tekrevol.com'))
          );

          // Add our page to the competitors list
          formattedData.push({
            id: -1, // Use negative ID to indicate it's a virtual entry
            keywordId: selectedKeywordId,
            domain: domain.includes('tekrevol.com') ? domain : 'tekrevol.com',
            url: selectedKeyword.targetUrl,
            title: `${selectedKeyword.keyword} - Tekrevol`,
            position: ourRanking?.position || 999, // Use actual position if available
            batchId: formattedData[0]?.batchId || 0,
            date: formattedData[0]?.date || new Date().toISOString()
          });
          console.log(`Added virtual entry for our domain`);
        }

        return formattedData;
      } catch (error) {
        console.error("Error in competitors query:", error);
        throw error;
      }
    },
    enabled: !!selectedKeywordId,
    retry: 1,
  });




  // Fetch competitor insights from database using the optimized endpoint
  // Load in parallel with competitors (not waiting for competitors to finish)
  const { data: insightsData = {}, isLoading: isLoadingInsights } = useQuery({
    queryKey: ["/api/competitor-insights/by-keyword", selectedKeywordId],
    queryFn: async () => {
      if (!selectedKeywordId) {
        console.log("[Frontend] No keyword selected, returning empty object");
        return {};
      }

      const startTime = Date.now();
      console.log(`[Frontend] Fetching insights for keyword ${selectedKeywordId} using optimized bulk endpoint`);

      try {
        const response = await fetch(`/api/competitor-insights/by-keyword/${selectedKeywordId}`);

        if (!response.ok) {
          console.error(`[Frontend] Failed to fetch insights: ${response.status} ${response.statusText}`);
          const errorText = await response.text().catch(() => '');
          console.error(`[Frontend] Error response:`, errorText);
          return {};
        }

        const data = await response.json();
        const elapsed = Date.now() - startTime;
        console.log(`[Frontend] Received insights for ${Object.keys(data).length} competitors (bulk query, ${elapsed}ms)`);
        
        // Log details for debugging
        if (Object.keys(data).length > 0) {
          const firstInsight = Object.values(data)[0] as any;
          const hasH1 = Array.isArray(firstInsight?.h1) && firstInsight.h1.length > 0;
          const hasH2 = Array.isArray(firstInsight?.h2) && firstInsight.h2.length > 0;
          const hasDensity = Array.isArray(firstInsight?.keywordDensity) && firstInsight.keywordDensity.length > 0;
          console.log(`[Frontend] Sample insight (competitor ${firstInsight?.competitorId}): H1=${hasH1}, H2=${hasH2}, Density=${hasDensity}`);
        } else {
          console.warn(`[Frontend] No insights found in response for keyword ${selectedKeywordId}`);
        }

        return data;
      } catch (error) {
        const elapsed = Date.now() - startTime;
        console.error(`[Frontend] Error fetching insights (${elapsed}ms):`, error);
        return {};
      }
    },
    enabled: !!selectedKeywordId, // Load in parallel - don't wait for competitors
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
  });


  // Crawl a specific keyword mutation
  const crawlMutation = useMutation({
    mutationFn: async (keywordId: number) => {
      return apiRequest("POST", "/api/crawl", { keywordIds: [keywordId] });
    },
    onSuccess: () => {
      toast({
        title: "Crawler started",
        description: "Refreshing competitor data for the selected keyword",
      });
      // Wait a bit for the crawl to complete, then refetch
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ["/api/competitors", selectedKeywordId] });
      }, 5000);
    },
    onError: (error) => {
      toast({
        title: "Crawler error",
        description: `Could not refresh data: ${error}`,
        variant: "destructive",
      });
    }
  });

  // Fetch blacklisted competitors
  const {
    data: blacklistedCompetitorsData = [],
    isLoading: isLoadingBlacklist,
    refetch: refetchBlacklist
  } = useQuery({
    queryKey: ["/api/blacklisted-competitors", selectedKeywordId],
    queryFn: async () => {
      // If no keyword is selected, fetch all blacklisted competitors
      const url = selectedKeywordId
        ? `/api/blacklisted-competitors?keywordId=${selectedKeywordId}`
        : '/api/blacklisted-competitors';

      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to fetch blacklisted competitors: ${response.statusText}`);
      }
      const data = await response.json();

      return data as BlacklistedCompetitor[];
    },
    enabled: true // Always load blacklisted competitors
  });

  // Blacklist competitor mutation
  const blacklistMutation = useMutation({
    mutationFn: async ({ domain, keywordId, reason }: { domain: string, keywordId?: number, reason?: string }) => {
      return apiRequest("POST", "/api/blacklisted-competitors", {
        domain,
        keywordId: keywordId || null,
        reason: reason || null
      });
    },
    onSuccess: () => {
      toast({
        title: "Competitor blacklisted",
        description: "The competitor has been added to the blacklist"
      });

      // Close the dialog
      setIsBlacklistDialogOpen(false);
      setBlacklistReason("");
      setCurrentBlacklistDomain("");

      // Refetch data
      queryClient.invalidateQueries({ queryKey: ["/api/blacklisted-competitors"] });
      queryClient.invalidateQueries({ queryKey: ["/api/competitors"] });

      // Refresh competitors list
      if (selectedKeywordId) {
        refetchCompetitors();
      }
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: `Failed to blacklist competitor: ${error}`,
        variant: "destructive"
      });
    }
  });

  // Remove from blacklist mutation
  const removeFromBlacklistMutation = useMutation({
    mutationFn: async (id: number) => {
      return apiRequest("DELETE", `/api/blacklisted-competitors/${id}`);
    },
    onSuccess: () => {
      toast({
        title: "Competitor removed from blacklist",
        description: "The competitor has been removed from the blacklist"
      });

      // Refetch data
      queryClient.invalidateQueries({ queryKey: ["/api/blacklisted-competitors"] });
      queryClient.invalidateQueries({ queryKey: ["/api/competitors"] });

      // Refresh competitors list
      if (selectedKeywordId) {
        refetchCompetitors();
      }
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: `Failed to remove competitor from blacklist: ${error}`,
        variant: "destructive"
      });
    }
  });

  // Handle blacklist competitor
  const handleOpenBlacklistDialog = (domain: string) => {
    setCurrentBlacklistDomain(domain);
    setBlacklistReason("");
    setIsBlacklistDialogOpen(true);
  };

  // Handle submit blacklist
  const handleSubmitBlacklist = () => {
    if (!currentBlacklistDomain) return;

    blacklistMutation.mutate({
      domain: currentBlacklistDomain,
      keywordId: selectedKeywordId || undefined,
      reason: blacklistReason || undefined
    });
  };

  // Handle remove from blacklist
  const handleRemoveFromBlacklist = (id: number) => {
    removeFromBlacklistMutation.mutate(id);
  };

  // Type assertion for competitors and blacklisted competitors
  const competitors = competitorsData as Competitor[];
  const blacklistedCompetitors = blacklistedCompetitorsData as BlacklistedCompetitor[];

  // Filter keywords by location first
  const locationFilteredKeywords = keywords.filter((keyword) =>
    !selectedLocationId || keyword.locationId === selectedLocationId
  );

  // Then apply the search term filter separately
  const searchFilteredKeywords = locationFilteredKeywords.filter((keyword) =>
    searchTerm.trim() === "" ||
    keyword.keyword.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Reset selected keyword when location changes
  useEffect(() => {
    setSelectedKeywordId(null);
  }, [selectedLocationId]);

  // Reset selected keyword when search term changes significantly
  useEffect(() => {
    // Only reset if the search term would filter out the currently selected keyword
    if (selectedKeywordId && searchTerm.trim() !== "") {
      const currentKeyword = keywords.find(k => k.id === selectedKeywordId);
      if (currentKeyword && !currentKeyword.keyword.toLowerCase().includes(searchTerm.toLowerCase())) {
        setSelectedKeywordId(null);
      }
    }
  }, [searchTerm, keywords, selectedKeywordId]);

  // Format date for display
  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  // Get selected keyword name
  const selectedKeyword = keywords.find(
    (k) => k.id === selectedKeywordId
  );

  // Handle refresh competitors data with improved feedback
  const handleRefreshCompetitors = () => {
    if (selectedKeywordId) {
      // First start the refresh animation immediately
      const refreshButton = document.querySelector('.refresh-icon') as HTMLElement;
      if (refreshButton) {
        refreshButton.classList.add('animate-spin');
      }

      // Then trigger the crawl mutation
      crawlMutation.mutate(selectedKeywordId);

      // Show toast with more detailed message
      toast({
        title: "Refreshing competitor data",
        description: "Fetching latest ranking data for this keyword",
      });
    }
  };

  // Handle sort change
  const handleSort = (field: string) => {
    // If clicking the same field, toggle direction
    if (field === sortField) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      // If clicking a new field, set it as the sort field and default to ascending
      setSortField(field);
      setSortDirection("asc");
    }
  };

  // Apply sorting to competitors data
  const sortedCompetitors = [...competitors].sort((a, b) => {
    // Helper for numeric sort
    const numericSort = (aVal: number, bVal: number) => {
      return sortDirection === "asc" ? aVal - bVal : bVal - aVal;
    };

    // Helper for string sort
    const stringSort = (aVal: string, bVal: string) => {
      return sortDirection === "asc"
        ? aVal.localeCompare(bVal)
        : bVal.localeCompare(aVal);
    };

    // Helper for getting keyword density value
    const getKeywordDensity = (competitor: Competitor) => {
      const insight = insightsData[competitor.id];
      if (!insight?.keywordDensity || !selectedKeyword) return 0;

      const densityItem = insight.keywordDensity.find(
        (d: { keyword: string, density: number }) =>
          d.keyword.toLowerCase().includes(selectedKeyword.keyword.toLowerCase())
      );

      return densityItem?.density || 0;
    };

    // Apply sort based on field
    switch (sortField) {
      case "position":
        return numericSort(a.position, b.position);
      case "domain":
        return stringSort(a.domain, b.domain);
      case "url":
        return stringSort(a.url, b.url);
      case "title":
        return stringSort(a.title, b.title);
      case "keywordDensity":
        return numericSort(getKeywordDensity(a), getKeywordDensity(b));
      default:
        return numericSort(a.position, b.position);
    }
  });

  return (
    <div className="flex h-screen bg-background">
      <SideNav />

      <div className="flex-1 flex flex-col overflow-hidden">
        <TopBar
          title="Competitor Analysis"
          onMobileMenuToggle={() => setIsMobileNavOpen(!isMobileNavOpen)}
        />

        <main className="flex-1 overflow-y-auto p-4 md:p-6">
          <div className="grid gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Competitor Rankings</CardTitle>
                <CardDescription>
                  View competitor rankings for your keywords
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid gap-4 mb-6">
                  <div className="flex flex-col md:flex-row gap-4">
                    <div className="flex-1">
                      <div className="text-sm font-medium mb-2">Filter by Location:</div>
                      <LocationSelect
                        value={selectedLocationId}
                        onChange={setSelectedLocationId}
                        placeholder="All Locations"
                        includeAllOption={true}
                      />
                    </div>
                    <div className="flex-1">
                      <div className="text-sm font-medium mb-2">Search Keywords:</div>
                      <div className="flex gap-2">
                        <div className="relative flex-1">
                          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                          <Input
                            type="search"
                            placeholder="Search keywords..."
                            className="pl-8"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            onKeyDown={(e) => {
                              // If user presses Enter, update the search term immediately
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                const inputValue = e.currentTarget.value;
                                setSearchTerm(inputValue);

                                // If there's only one keyword matching the search, select it automatically
                                if (searchFilteredKeywords.length === 1) {
                                  setSelectedKeywordId(searchFilteredKeywords[0].id);
                                }
                              }
                            }}
                          />
                        </div>
                        <Button
                          type="button"
                          variant="secondary"
                          className="mt-0"
                          onClick={() => {
                            console.log("Search button clicked. Current search term:", searchTerm);
                            console.log("Current keywords:", locationFilteredKeywords.length);

                            // We don't need to filter here as the filtered keywords are already available in searchFilteredKeywords
                            console.log("Filtered keywords:", searchFilteredKeywords.length);

                            // If there's only one keyword matching the search, select it automatically
                            if (searchFilteredKeywords.length === 1) {
                              console.log("Auto-selecting the only match:", searchFilteredKeywords[0].keyword);
                              setSelectedKeywordId(searchFilteredKeywords[0].id);
                            } else if (searchFilteredKeywords.length > 0 && searchTerm.trim() !== "") {
                              // Find an exact match if possible
                              const exactMatch = searchFilteredKeywords.find(
                                k => k.keyword.toLowerCase() === searchTerm.toLowerCase()
                              );

                              if (exactMatch) {
                                console.log("Selecting exact match:", exactMatch.keyword);
                                setSelectedKeywordId(exactMatch.id);
                              }

                              // If we're searching for a specific keyword that appears in the list, scroll to it
                              const keywordList = document.querySelector('.select-content');
                              if (keywordList) {
                                keywordList.scrollTop = 0; // Reset scroll position
                              }
                            }
                          }}
                        >
                          <Search className="h-4 w-4 mr-1" />
                          <span>Search</span>
                        </Button>
                      </div>
                    </div>
                  </div>

                  <div>
                    <div className="text-sm font-medium mb-2">Select a Keyword:</div>
                    <Select
                      value={selectedKeywordId?.toString() || ""}
                      onValueChange={(value) => setSelectedKeywordId(Number(value))}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select a keyword to view competitors" />
                      </SelectTrigger>
                      <SelectContent>
                        {searchFilteredKeywords.length === 0 ? (
                          <div className="py-6 text-center">
                            <p className="text-sm text-muted-foreground">No keywords found matching "{searchTerm}"</p>
                          </div>
                        ) : (
                          searchFilteredKeywords.map((keyword) => (
                            <SelectItem key={keyword.id} value={keyword.id.toString()}>
                              {/* Highlight the matched part of the keyword */}
                              {searchTerm.trim() !== "" ? (
                                <span>
                                  {highlightMatch(keyword.keyword, searchTerm)}
                                </span>
                              ) : (
                                keyword.keyword
                              )}
                              {keyword.group && (
                                <Badge variant="outline" className="ml-2">
                                  {keyword.group}
                                </Badge>
                              )}
                            </SelectItem>
                          ))
                        )}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {selectedKeywordId ? (
                  <>
                    <div className="flex justify-between items-center mb-4">
                      <h3 className="text-lg font-medium">
                        Top Competitors for: <span className="font-bold">{selectedKeyword?.keyword}</span>
                      </h3>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setIsManageBlacklistDialogOpen(true)}
                        >
                          <Ban className="h-4 w-4 mr-2" />
                          Manage Blacklist
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={handleRefreshCompetitors}
                          disabled={crawlMutation.isPending || isLoadingCompetitors}
                        >
                          <RefreshCw className={`refresh-icon h-4 w-4 mr-2 ${crawlMutation.isPending ? 'animate-spin' : ''}`} />
                          {crawlMutation.isPending ? 'Refreshing...' : 'Refresh Data'}
                        </Button>
                      </div>
                    </div>

                    {competitorsError ? (
                      <Alert variant="destructive" className="mb-6">
                        <AlertCircle className="h-4 w-4" />
                        <AlertTitle>Error</AlertTitle>
                        <AlertDescription>
                          Failed to load competitor data. Try refreshing the data.
                        </AlertDescription>
                      </Alert>
                    ) : null}


                    {isLoadingCompetitors || isLoadingInsights ? (
                      <div className="space-y-3">
                        <Skeleton className="h-8 w-full mb-4" />
                        <Skeleton className="h-8 w-full" />
                        <Skeleton className="h-8 w-full" />
                        <Skeleton className="h-8 w-full" />
                        <Skeleton className="h-8 w-full" />
                      </div>
                    ) : sortedCompetitors.length === 0 ? (
                      <div className="text-center py-8">
                        <p className="text-muted-foreground mb-4">
                          No competitor data available for this keyword.
                        </p>
                        <Button
                          onClick={handleRefreshCompetitors}
                          disabled={crawlMutation.isPending}
                        >
                          <RefreshCw className={`refresh-icon h-4 w-4 mr-2 ${crawlMutation.isPending ? 'animate-spin' : ''}`} />
                          Collect Competitor Data
                        </Button>
                      </div>
                    ) : (
                      <>
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead
                                className="w-12 cursor-pointer hover:bg-muted/50"
                                onClick={() => handleSort("position")}
                              >
                                <div className="flex items-center">
                                  Position
                                  {sortField === "position" && (
                                    <span className="ml-1">
                                      {sortDirection === "asc" ? "↑" : "↓"}
                                    </span>
                                  )}
                                </div>
                              </TableHead>
                              <TableHead
                                className="w-32 cursor-pointer hover:bg-muted/50"
                                onClick={() => handleSort("domain")}
                              >
                                <div className="flex items-center">
                                  Domain
                                  {sortField === "domain" && (
                                    <span className="ml-1">
                                      {sortDirection === "asc" ? "↑" : "↓"}
                                    </span>
                                  )}
                                </div>
                              </TableHead>
                              <TableHead
                                className="w-44 cursor-pointer hover:bg-muted/50"
                                onClick={() => handleSort("url")}
                              >
                                <div className="flex items-center">
                                  URL
                                  {sortField === "url" && (
                                    <span className="ml-1">
                                      {sortDirection === "asc" ? "↑" : "↓"}
                                    </span>
                                  )}
                                </div>
                              </TableHead>
                              <TableHead
                                className="cursor-pointer hover:bg-muted/50"
                                onClick={() => handleSort("title")}
                              >
                                <div className="flex items-center">
                                  Title
                                  {sortField === "title" && (
                                    <span className="ml-1">
                                      {sortDirection === "asc" ? "↑" : "↓"}
                                    </span>
                                  )}
                                </div>
                              </TableHead>
                              <TableHead className="hidden md:table-cell">H1</TableHead>
                              <TableHead className="hidden md:table-cell">H2</TableHead>
                              <TableHead className="hidden md:table-cell">H3</TableHead>
                              <TableHead className="hidden lg:table-cell">Keyword Density</TableHead>
                              <TableHead className="text-right w-24">Actions</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {sortedCompetitors.map((competitor) => {
                              // Get competitor insights if available
                              const insight = insightsData[competitor.id];
                              
                              // Debug logging for first few competitors
                              if (sortedCompetitors.indexOf(competitor) < 3) {
                                console.log(`[Frontend] Competitor ${competitor.id} (${competitor.domain}):`, {
                                  hasInsight: !!insight,
                                  hasH1: Array.isArray(insight?.h1) && insight.h1.length > 0,
                                  hasH2: Array.isArray(insight?.h2) && insight.h2.length > 0,
                                  hasDensity: Array.isArray(insight?.keywordDensity) && insight.keywordDensity.length > 0
                                });
                              }

                              // Find keyword density for the current keyword if available
                              const keywordDensity = insight?.keywordDensity?.find(
                                (density: { keyword: string, count: number, density: number }) =>
                                  selectedKeyword && density.keyword.toLowerCase().includes(selectedKeyword.keyword.toLowerCase())
                              );

                              return (
                                <TableRow
                                  key={competitor.id}
                                  className={`group ${isOurPage(competitor, selectedKeyword) ? 'bg-primary/10 border-l-4 border-primary' : ''}`}
                                >
                                  {/* Position */}
                                  <TableCell className="font-medium">
                                    {competitor.position === 999 ? (
                                      <span className="text-muted-foreground">Not ranked</span>
                                    ) : (
                                      competitor.position
                                    )}
                                    {/* Removed "Your page" badge as requested */}
                                  </TableCell>

                                  {/* Domain */}
                                  <TableCell>
                                    <div className="flex items-center gap-2">
                                      <span className={`font-medium ${isOurPage(competitor, selectedKeyword) ? 'text-primary font-bold' : ''}`}>
                                        {competitor.domain}
                                      </span>
                                      {blacklistedCompetitors.some(b => b.domain === competitor.domain) && (
                                        <TooltipProvider>
                                          <Tooltip>
                                            <TooltipTrigger asChild>
                                              <span>
                                                <Ban className="h-4 w-4 text-destructive" />
                                              </span>
                                            </TooltipTrigger>
                                            <TooltipContent>
                                              <p>This competitor is blacklisted</p>
                                            </TooltipContent>
                                          </Tooltip>
                                        </TooltipProvider>
                                      )}
                                      {isOurPage(competitor, selectedKeyword) && (
                                        <TooltipProvider>
                                          <Tooltip>
                                            <TooltipTrigger asChild>
                                              <span>
                                                <CheckCircle2 className="h-4 w-4 text-primary" />
                                              </span>
                                            </TooltipTrigger>
                                            <TooltipContent>
                                              <p>This is your website</p>
                                            </TooltipContent>
                                          </Tooltip>
                                        </TooltipProvider>
                                      )}
                                    </div>
                                  </TableCell>

                                  {/* URL */}
                                  <TableCell>
                                    <div className="text-xs truncate max-w-xs">
                                      <a
                                        href={competitor.url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-blue-600 hover:underline"
                                      >
                                        {competitor.url}
                                      </a>
                                    </div>
                                  </TableCell>

                                  {/* Title */}
                                  <TableCell>
                                    <div className="text-sm truncate max-w-md">
                                      {competitor.title}
                                    </div>
                                  </TableCell>

                                  {/* H1 */}
                                  <TableCell className="hidden md:table-cell">
                                    {insight && insight.h1 && insight.h1.length > 0 ? (
                                      <div className="text-xs truncate max-w-xs" title={insight.h1[0]}>
                                        {insight.h1[0]?.length > 100
                                          ? insight.h1[0].substring(0, 100) + "..."
                                          : insight.h1[0]}
                                      </div>
                                    ) : (
                                      <span className="text-xs text-muted-foreground">—</span>
                                    )}
                                  </TableCell>

                                  {/* H2 */}
                                  <TableCell className="hidden md:table-cell">
                                    {insight && insight.h2 && insight.h2.length > 0 ? (
                                      <div className="text-xs truncate max-w-xs" title={insight.h2[0]}>
                                        {insight.h2[0]?.length > 100
                                          ? insight.h2[0].substring(0, 100) + "..."
                                          : insight.h2[0]}
                                      </div>
                                    ) : (
                                      <span className="text-xs text-muted-foreground">—</span>
                                    )}
                                  </TableCell>

                                  {/* H3 */}
                                  <TableCell className="hidden md:table-cell">
                                    {insight && insight.h3 && insight.h3.length > 0 ? (
                                      <div className="text-xs truncate max-w-xs" title={insight.h3[0]}>
                                        {insight.h3[0]?.length > 100
                                          ? insight.h3[0].substring(0, 100) + "..."
                                          : insight.h3[0]}
                                      </div>
                                    ) : (
                                      <span className="text-xs text-muted-foreground">—</span>
                                    )}
                                  </TableCell>

                                  {/* Keyword Density */}
                                  <TableCell className="hidden lg:table-cell">
                                    {keywordDensity ? (
                                      <div className="text-xs">
                                        <span className="font-medium mr-1">
                                          {(keywordDensity.density * 100).toFixed(2)}%
                                        </span>
                                        <span className="text-muted-foreground">
                                          ({keywordDensity.count} occurrences)
                                        </span>
                                      </div>
                                    ) : (
                                      <span className="text-xs text-muted-foreground">—</span>
                                    )}
                                  </TableCell>

                                  {/* Actions */}
                                  <TableCell className="text-right">
                                    <div className="flex items-center justify-end gap-2">
                                      <TooltipProvider>
                                        <Tooltip>
                                          <TooltipTrigger asChild>
                                            {blacklistedCompetitors.some(b => b.domain === competitor.domain) ? (
                                              <Button
                                                variant="ghost"
                                                size="icon"
                                                onClick={() => {
                                                  const blacklisted = blacklistedCompetitors.find(b => b.domain === competitor.domain);
                                                  if (blacklisted) {
                                                    handleRemoveFromBlacklist(blacklisted.id);
                                                  }
                                                }}
                                              >
                                                <XCircle className="h-4 w-4 text-destructive hover:text-destructive/80" />
                                              </Button>
                                            ) : (
                                              <Button
                                                variant="ghost"
                                                size="icon"
                                                onClick={() => handleOpenBlacklistDialog(competitor.domain)}
                                              >
                                                <Ban className="h-4 w-4 text-muted-foreground hover:text-destructive" />
                                              </Button>
                                            )}
                                          </TooltipTrigger>
                                          <TooltipContent>
                                            {blacklistedCompetitors.some(b => b.domain === competitor.domain) ?
                                              <p>Remove from blacklist</p> :
                                              <p>Blacklist competitor</p>
                                            }
                                          </TooltipContent>
                                        </Tooltip>
                                      </TooltipProvider>

                                      <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => navigate(`/competitor-insights-diagnostic?id=${competitor.id}`)}
                                      >
                                        <BarChart2 className="h-4 w-4 mr-1" />
                                        View
                                      </Button>
                                    </div>
                                  </TableCell>
                                </TableRow>
                              );
                            })}
                          </TableBody>
                        </Table>
                        <div className="mt-4 text-sm text-muted-foreground flex justify-between items-center">
                          <span>Last updated: {formatDate(sortedCompetitors[0]?.date || new Date().toISOString())}</span>
                          <div className="flex items-center gap-2">
                            <span>Sorting by: {sortField} ({sortDirection})</span>
                            <Badge variant="outline">Batch #{sortedCompetitors[0]?.batchId || '—'}</Badge>
                          </div>
                        </div>
                      </>
                    )}
                  </>
                ) : (
                  <div className="text-center py-8">
                    <p className="text-muted-foreground">
                      Select a keyword to view competitor rankings
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </main>
      </div>

      {/* Blacklist Dialog */}
      <Dialog open={isBlacklistDialogOpen} onOpenChange={setIsBlacklistDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Blacklist Competitor</DialogTitle>
            <DialogDescription>
              Add this competitor to your blacklist to exclude it from future results.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="flex flex-col gap-2">
              <div className="font-medium">Domain</div>
              <div className="flex items-center gap-2 bg-muted p-2 rounded-md">
                <span className="font-mono">{currentBlacklistDomain}</span>
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <div className="font-medium">Scope</div>
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-primary" />
                  {selectedKeywordId ? (
                    <span>This competitor will be blacklisted for the keyword: <b>{selectedKeyword?.keyword}</b></span>
                  ) : (
                    <span>This competitor will be blacklisted for all keywords</span>
                  )}
                </div>
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <div className="font-medium">Reason (Optional)</div>
              <Input
                placeholder="Why are you blacklisting this competitor?"
                value={blacklistReason}
                onChange={(e) => setBlacklistReason(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setIsBlacklistDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleSubmitBlacklist}
              disabled={blacklistMutation.isPending}
            >
              {blacklistMutation.isPending ? 'Adding to blacklist...' : 'Add to Blacklist'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Manage Blacklist Dialog */}
      <Dialog open={isManageBlacklistDialogOpen} onOpenChange={setIsManageBlacklistDialogOpen}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>Manage Blacklisted Competitors</DialogTitle>
            <DialogDescription>
              View and manage competitors that have been blacklisted from your results.
            </DialogDescription>
          </DialogHeader>
          <Tabs defaultValue="all">
            <TabsList className="mb-4">
              <TabsTrigger value="all">All Competitors</TabsTrigger>
              {selectedKeywordId && (
                <TabsTrigger value="keyword">For This Keyword</TabsTrigger>
              )}
            </TabsList>

            <TabsContent value="all">
              {isLoadingBlacklist ? (
                <div className="space-y-3">
                  <Skeleton className="h-8 w-full" />
                  <Skeleton className="h-8 w-full" />
                  <Skeleton className="h-8 w-full" />
                </div>
              ) : blacklistedCompetitors.length === 0 ? (
                <div className="text-center py-6 text-muted-foreground">
                  No blacklisted competitors found.
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Domain</TableHead>
                      <TableHead>Reason</TableHead>
                      <TableHead>Keyword</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {blacklistedCompetitors.map((comp) => (
                      <TableRow key={comp.id}>
                        <TableCell className="font-medium">{comp.domain}</TableCell>
                        <TableCell>{comp.reason || '—'}</TableCell>
                        <TableCell>
                          {comp.keywordId ?
                            keywords.find(k => k.id === comp.keywordId)?.keyword || 'Unknown keyword'
                            : 'All keywords'}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleRemoveFromBlacklist(comp.id)}
                            disabled={removeFromBlacklistMutation.isPending}
                          >
                            <Trash2 className="h-4 w-4 text-muted-foreground hover:text-destructive" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </TabsContent>

            {selectedKeywordId && (
              <TabsContent value="keyword">
                {isLoadingBlacklist ? (
                  <div className="space-y-3">
                    <Skeleton className="h-8 w-full" />
                    <Skeleton className="h-8 w-full" />
                  </div>
                ) : blacklistedCompetitors.filter(c => c.keywordId === selectedKeywordId || c.keywordId === null).length === 0 ? (
                  <div className="text-center py-6 text-muted-foreground">
                    No blacklisted competitors for this keyword.
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Domain</TableHead>
                        <TableHead>Reason</TableHead>
                        <TableHead>Scope</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {blacklistedCompetitors
                        .filter(c => c.keywordId === selectedKeywordId || c.keywordId === null)
                        .map((comp) => (
                          <TableRow key={comp.id}>
                            <TableCell className="font-medium">{comp.domain}</TableCell>
                            <TableCell>{comp.reason || '—'}</TableCell>
                            <TableCell>
                              {comp.keywordId ? 'This keyword only' : 'All keywords'}
                            </TableCell>
                            <TableCell className="text-right">
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => handleRemoveFromBlacklist(comp.id)}
                                disabled={removeFromBlacklistMutation.isPending}
                              >
                                <Trash2 className="h-4 w-4 text-muted-foreground hover:text-destructive" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                    </TableBody>
                  </Table>
                )}
              </TabsContent>
            )}
          </Tabs>
        </DialogContent>
      </Dialog>
    </div>
  );
}