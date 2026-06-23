import React, { useState, useEffect } from 'react';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import {
  Loader2, RefreshCw, AlertCircle, AlertTriangle,
  CheckCircle2, Ban, ListFilter, Search, X,
  MapPin
} from 'lucide-react';
import { apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Progress } from '@/components/ui/progress';
import { LocationSelect } from '@/components/ui/location-select';

// Interface for Keyword data
interface Keyword {
  id: number;
  keyword: string;
  targetUrl: string | null;
  group: string | null;
  locationId: number;
  trackDaily: boolean;
}

// Interface for Location data
interface Location {
  id: number;
  name: string;
  code: string;
}
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";

export const RunCrawlerButton = () => {
  // State
  const [isRunning, setIsRunning] = useState(false);
  const [activeBatchId, setActiveBatchId] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [failureMessage, setFailureMessage] = useState<string | null>(null);
  const [isResetDialogOpen, setIsResetDialogOpen] = useState(false);
  const [isStuck, setIsStuck] = useState(false);
  const [isKeywordSelectorOpen, setIsKeywordSelectorOpen] = useState(false);
  const [keywordFilter, setKeywordFilter] = useState("");
  const [groupFilter, setGroupFilter] = useState<string | null>(null);
  const [locationFilter, setLocationFilter] = useState<number | null>(null);
  const [selectedKeywordIds, setSelectedKeywordIds] = useState<number[]>([]);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Fetch keywords
  const { data: keywordsData } = useQuery({
    queryKey: ['/api/keywords'],
    queryFn: async () => {
      const response = await apiRequest('GET', '/api/keywords');
      return response.json();
    }
  });

  // Format date strings
  const formatDate = (dateString?: string) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleString();
  };

  // Query status with dynamic refetch interval
  const { data: statusData, refetch: refetchStatus } = useQuery({
    queryKey: ['/api/crawl/status'],
    queryFn: async () => {
      const response = await apiRequest('GET', '/api/crawl/status');
      return response.json();
    },
    refetchInterval: isRunning ? 5000 : 15000, // Poll more frequently during active crawls
    // Don't refetch on window focus if we're not running a crawl to reduce API calls
    refetchOnWindowFocus: isRunning,
    // Cache the last status to prevent unnecessary API calls
    staleTime: isRunning ? 3000 : 10000
  });

  // Get result details
  const { refetch: refetchResults } = useQuery({
    queryKey: ['/api/crawl/results', activeBatchId],
    queryFn: async () => {
      if (!activeBatchId) return null;
      const response = await apiRequest('GET', `/api/crawl/results/${activeBatchId}`);
      return response.json();
    },
    enabled: false
  });

  // Progress calculation
  const progressPercentage = statusData?.stats?.total > 0
    ? Math.round(((statusData.stats.completed + statusData.stats.failed) / statusData.stats.total) * 100)
    : 0;

  // Button state
  let buttonText = 'Update Rankings Now';
  let buttonDisabled = false;

  if (isRunning && statusData) {
    buttonText = `Running API Crawler... ${progressPercentage}%`;
    buttonDisabled = true;
  } else if (statusData?.status === 'failed') {
    buttonText = 'Restart API Crawler';
    buttonDisabled = false;
  }

  // Status effect
  useEffect(() => {
    if (!statusData) return;

    if (statusData.status === 'running') {
      setIsRunning(true);
      setActiveBatchId(statusData.batchId);
      setFailureMessage(null);

      // We used to set isStuck here but our Google crawler no longer gets stuck
      // With our improved implementation
    }
    else if (statusData.status === 'failed') {
      setIsRunning(false);
      setIsStuck(false);
      setActiveBatchId(statusData.batchId);

      const message = statusData.message || 'The crawler encountered an error. You can restart it now.';
      setFailureMessage(message);

      // Invalidate queries
      queryClient.invalidateQueries({ queryKey: ['/api/keywords/rankings'] });
      queryClient.invalidateQueries({ queryKey: ['/api/dashboard/stats'] });
      queryClient.invalidateQueries({ queryKey: ['/api/rankings/history'] });
    }
    else if (statusData.status === 'completed' && activeBatchId === statusData.batchId) {
      if (statusData.stats && (statusData.stats.completed + statusData.stats.failed === statusData.stats.total)) {
        setIsRunning(false);
        setIsStuck(false);
        setFailureMessage(null);

        refetchResults();

        // Invalidate queries
        queryClient.invalidateQueries({ queryKey: ['/api/keywords/rankings'] });
        queryClient.invalidateQueries({ queryKey: ['/api/dashboard/stats'] });
        queryClient.invalidateQueries({ queryKey: ['/api/rankings/history'] });

        const failureRate = statusData.stats?.total > 0
          ? Math.round(((statusData.stats?.failed || 0) / statusData.stats.total) * 100)
          : 0;

        toast({
          title: 'Google Search API Results Complete',
          description: `Processed ${statusData.stats?.completed || 0} keywords successfully with ${statusData.stats?.failed || 0} failures.`,
          variant: failureRate > 50 ? 'destructive' : 'default',
        });

        setTimeout(() => setActiveBatchId(null), 5000);
      }
    }
  }, [statusData, activeBatchId, progressPercentage, queryClient, toast, refetchResults]);

  // Run crawler mutation
  const runCrawlMutation = useMutation({
    mutationFn: async () => {
      setErrorMessage(null);
      setFailureMessage(null);

      // Use selected keywords if any
      const payload = selectedKeywordIds.length > 0
        ? { keywordIds: selectedKeywordIds }
        : {};

      const response = await apiRequest('POST', '/api/crawl', payload);
      return response.json();
    },
    onMutate: () => {
      setIsRunning(true);
      const keywordCountMsg = selectedKeywordIds.length > 0
        ? `for ${selectedKeywordIds.length} selected keyword${selectedKeywordIds.length > 1 ? 's' : ''}`
        : 'for all keywords';

      toast({
        title: 'API Crawler Started',
        description: `The Google Search API crawler has been started ${keywordCountMsg}.`,
        variant: 'default',
      });
    },
    onSuccess: async () => {
      const status = await refetchStatus();
      if (status.data) {
        setActiveBatchId(status.data.batchId);
      }
      // Clear selection after successful run
      setSelectedKeywordIds([]);
    },
    onError: (error: any) => {
      console.error('Error running crawler:', error);
      const errorMsg = error?.message || 'There was an error starting the crawler. The API key may be invalid or missing.';
      setErrorMessage(errorMsg);
      toast({
        title: 'API Crawler Error',
        description: errorMsg,
        variant: 'destructive',
      });
      setIsRunning(false);
    },
  });

  // Reset mutation
  const resetCrawlMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest('POST', '/api/crawl/reset', {});
      return response.json();
    },
    onMutate: () => {
      toast({
        title: 'Resetting Crawler',
        description: 'The stuck crawler run is being cancelled and reset...',
        variant: 'default',
      });
    },
    onSuccess: async () => {
      setIsStuck(false);
      setIsResetDialogOpen(false);
      await refetchStatus();
      toast({
        title: 'Crawler Reset Complete',
        description: 'The crawler has been reset. You can start a new run.',
        variant: 'default',
      });
      queryClient.invalidateQueries({ queryKey: ['/api/keywords/rankings'] });
      queryClient.invalidateQueries({ queryKey: ['/api/dashboard/stats'] });
      queryClient.invalidateQueries({ queryKey: ['/api/rankings/history'] });
    },
    onError: (error: any) => {
      console.error('Error resetting crawler:', error);
      const errorMsg = error?.message || 'There was an error resetting the crawler.';
      toast({
        title: 'Reset Error',
        description: errorMsg,
        variant: 'destructive',
      });
    },
  });

  // Fetch locations
  const { data: locationsData } = useQuery({
    queryKey: ['/api/locations'],
    queryFn: async () => {
      const response = await apiRequest('GET', '/api/locations');
      return response.json();
    }
  });

  // Get unique groups from keywords
  const groups: string[] = [];
  if (keywordsData) {
    const uniqueGroups = new Set<string>();
    keywordsData.forEach((k: Keyword) => {
      if (k.group && k.group.trim() !== '') {
        uniqueGroups.add(k.group);
      }
    });
    groups.push(...Array.from(uniqueGroups).sort());
  }

  // Filter keywords based on search input, group, and location
  const filteredKeywords = keywordsData?.filter((keyword: Keyword) => {
    const matchesSearch = keyword.keyword.toLowerCase().includes(keywordFilter.toLowerCase());
    const matchesGroup = groupFilter ? keyword.group === groupFilter : true;
    const matchesLocation = locationFilter ? keyword.locationId === locationFilter : true;
    return matchesSearch && matchesGroup && matchesLocation;
  }) || [];

  // Get selected keywords info for display
  const selectedKeywords = keywordsData?.filter((keyword: Keyword) =>
    selectedKeywordIds.includes(keyword.id)
  ) || [];

  // Toggle keyword selection
  const toggleKeywordSelection = (keywordId: number) => {
    setSelectedKeywordIds(prev =>
      prev.includes(keywordId)
        ? prev.filter(id => id !== keywordId)
        : [...prev, keywordId]
    );
  };

  // Toggle all filtered keywords selection
  const toggleAllKeywords = () => {
    if (filteredKeywords.length === 0) return;

    // Check if all filtered keywords are already selected
    const allFilteredIds = filteredKeywords.map((kw: Keyword) => kw.id);
    const allSelected = allFilteredIds.every((id: number) => selectedKeywordIds.includes(id));

    if (allSelected) {
      // Deselect all filtered keywords
      setSelectedKeywordIds(prev =>
        prev.filter(id => !allFilteredIds.includes(id))
      );
    } else {
      // Select all filtered keywords
      setSelectedKeywordIds(prev => {
        const newSelection = [...prev];
        allFilteredIds.forEach((id: number) => {
          if (!newSelection.includes(id)) {
            newSelection.push(id);
          }
        });
        return newSelection;
      });
    }
  };

  // Handlers
  const handleRunCrawler = () => {
    if (!isRunning) {
      // If no keywords selected, open keyword selector
      if (selectedKeywordIds.length === 0) {
        setIsKeywordSelectorOpen(true);
      } else {
        runCrawlMutation.mutate();
      }
    }
  };

  const handleResetCrawler = () => {
    setIsResetDialogOpen(true);
  };

  const handleRunWithSelectedKeywords = () => {
    setIsKeywordSelectorOpen(false);
    if (selectedKeywordIds.length > 0) {
      runCrawlMutation.mutate();
    }
  };

  return (
    <div className="space-y-4">
      {/* Keyword Selection Dialog */}
      <Dialog
        open={isKeywordSelectorOpen}
        onOpenChange={setIsKeywordSelectorOpen}
      >
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Select Keywords To Crawl</DialogTitle>
            <DialogDescription>
              Select just 1-2 keywords to test the API rate limits.
              Running all keywords at once can trigger Google API rate limits.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 my-4">
            <div className="flex items-center space-x-2">
              <Search className="h-4 w-4 text-gray-400" />
              <Input
                placeholder="Filter keywords..."
                value={keywordFilter}
                onChange={(e) => setKeywordFilter(e.target.value)}
                className="flex-1"
              />
            </div>

            {/* Location filter */}
            <div className="flex items-center space-x-2">
              <MapPin className="h-4 w-4 text-gray-400" />
              <div className="flex-1">
                <LocationSelect
                  value={locationFilter}
                  onChange={setLocationFilter}
                  placeholder="Filter by location"
                  includeAllOption={true}
                />
              </div>
            </div>

            {/* Group filters */}
            {groups.length > 0 && (
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => setGroupFilter(null)}
                  className={`text-xs px-2 py-1 rounded-full ${groupFilter === null
                    ? 'bg-blue-100 text-blue-700'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                >
                  All Groups
                </button>
                {groups.map((group: string) => (
                  <button
                    key={group}
                    onClick={() => setGroupFilter(group)}
                    className={`text-xs px-2 py-1 rounded-full ${groupFilter === group
                      ? 'bg-blue-100 text-blue-700'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      }`}
                  >
                    {group}
                  </button>
                ))}
              </div>
            )}

            {filteredKeywords.length > 0 && (
              <div className="flex justify-end mb-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={toggleAllKeywords}
                  className="text-xs h-8 px-3"
                >
                  {filteredKeywords && filteredKeywords.length > 0 &&
                    filteredKeywords.every((kw: Keyword) => selectedKeywordIds.includes(kw.id))
                    ? "Deselect All"
                    : "Select All"}
                </Button>
              </div>
            )}

            <ScrollArea className="h-72 rounded-md border p-4">
              <div className="space-y-4">
                {filteredKeywords.length === 0 ? (
                  <p className="text-sm text-gray-500 text-center py-8">No keywords found</p>
                ) : (
                  filteredKeywords.map((keyword: Keyword) => (
                    <div
                      key={keyword.id}
                      className="flex items-center space-x-2 hover:bg-gray-50 p-2 rounded"
                    >
                      <Checkbox
                        id={`keyword-${keyword.id}`}
                        checked={selectedKeywordIds.includes(keyword.id)}
                        onCheckedChange={() => toggleKeywordSelection(keyword.id)}
                      />
                      <Label
                        htmlFor={`keyword-${keyword.id}`}
                        className="flex flex-1 flex-col cursor-pointer text-sm"
                      >
                        <span>{keyword.keyword}</span>
                        <div className="flex items-center mt-1">
                          {locationsData?.find((l: Location) => l.id === keyword.locationId) && (
                            <span className="text-xs text-gray-500 flex items-center">
                              <MapPin className="h-3 w-3 mr-1 text-gray-400" />
                              {locationsData.find((l: Location) => l.id === keyword.locationId)?.name}
                            </span>
                          )}
                          {keyword.group && (
                            <span className="text-xs bg-gray-100 text-gray-600 rounded-full px-2 py-0.5 ml-2">
                              {keyword.group}
                            </span>
                          )}
                        </div>
                      </Label>
                    </div>
                  ))
                )}
              </div>
            </ScrollArea>

            <div className="flex justify-between items-center">
              <p className="text-sm text-gray-500">
                Selected: {selectedKeywordIds.length} of {keywordsData?.length || 0} keywords
              </p>

              {selectedKeywordIds.length > 2 && (
                <Alert variant="destructive" className="py-1 px-2 text-xs">
                  <AlertTriangle className="h-3 w-3 mr-1" />
                  Running more than 1-2 keywords can hit rate limits
                </Alert>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsKeywordSelectorOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleRunWithSelectedKeywords}
              disabled={selectedKeywordIds.length === 0}
              className="gap-2"
            >
              <RefreshCw className="h-4 w-4" />
              Run Crawler
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {errorMessage && (
        <Alert variant="destructive" className="mb-4">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>API Error</AlertTitle>
          <AlertDescription>
            {errorMessage}
          </AlertDescription>
        </Alert>
      )}

      {failureMessage && (
        <Alert variant="destructive" className="mb-4 border-yellow-500 bg-yellow-50">
          <AlertTriangle className="h-4 w-4 text-yellow-600" />
          <AlertTitle className="text-yellow-800">Crawler Failed</AlertTitle>
          <AlertDescription className="text-yellow-700">
            {failureMessage}
            <div className="mt-2">
              <p>Batch ID: {statusData?.batchId}</p>
              <p>Start time: {formatDate(statusData?.startTime)}</p>
              <p>End time: {formatDate(statusData?.endTime)}</p>
              <p>Results: {statusData?.stats?.completed || 0} completed, {statusData?.stats?.failed || 0} failed</p>
            </div>
          </AlertDescription>
        </Alert>
      )}

      {statusData?.status === 'completed' && (
        <Alert variant="default" className="mb-4 border-green-500 bg-green-50">
          <CheckCircle2 className="h-4 w-4 text-green-600" />
          <AlertTitle className="text-green-800">Crawler Completed</AlertTitle>
          <AlertDescription className="text-green-700">
            <p>The crawler successfully completed with {statusData.stats?.completed || 0} successful keyword checks.</p>
            <div className="mt-2">
              <p>Batch ID: {statusData.batchId}</p>
              <p>Start time: {formatDate(statusData.startTime)}</p>
              <p>End time: {formatDate(statusData.endTime)}</p>
              <p>Results: {statusData.stats?.completed || 0} completed, {statusData.stats?.failed || 0} failed</p>
            </div>
          </AlertDescription>
        </Alert>
      )}

      {/* Reset Dialog */}
      <AlertDialog open={isResetDialogOpen} onOpenChange={setIsResetDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset Stuck Crawler Run?</AlertDialogTitle>
            <AlertDialogDescription>
              This will cancel the current crawler run that appears to be stuck. Any completed keyword rankings will be
              saved, but the batch will be marked as failed. You can start a new batch after the reset completes.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => resetCrawlMutation.mutate()}
              className="bg-red-500 hover:bg-red-600">
              Reset Crawler
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div className="flex gap-2">
        <Button
          variant="default"
          onClick={handleRunCrawler}
          disabled={buttonDisabled}
          className="flex-1 gap-2 bg-gradient-to-r from-blue-500 to-purple-500 text-white hover:from-blue-600 hover:to-purple-600"
        >
          {isRunning ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              {buttonText}
            </>
          ) : (
            <>
              <RefreshCw className="h-4 w-4" />
              {buttonText}
              {selectedKeywordIds.length > 0 && (
                <span className="ml-2 bg-white text-purple-600 text-xs rounded-full px-2 py-0.5 font-medium">
                  {selectedKeywordIds.length} selected
                </span>
              )}
            </>
          )}
        </Button>

        {/* Cancel/Reset button for stuck crawls */}
        {isRunning && statusData && (
          <Button
            variant="destructive"
            onClick={() => setIsResetDialogOpen(true)}
            className="gap-2"
          >
            <Ban className="h-4 w-4" />
            Cancel
          </Button>
        )}
      </div>

      {/* Selected Keywords Pills */}
      {!isRunning && selectedKeywordIds.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-2">
          {selectedKeywords.slice(0, 5).map((keyword: Keyword) => {
            const location = locationsData?.find((l: Location) => l.id === keyword.locationId);
            return (
              <div
                key={keyword.id}
                className="bg-gray-100 text-sm rounded-full px-3 py-1 flex items-center gap-1"
              >
                <span className="text-gray-700">
                  {keyword.keyword}
                  {location && (
                    <span className="text-xs text-gray-500 ml-1">
                      ({location.name})
                    </span>
                  )}
                </span>
                <button
                  onClick={() => toggleKeywordSelection(keyword.id)}
                  className="text-gray-500 hover:text-gray-700 focus:outline-none"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            );
          })}
          {selectedKeywords.length > 5 && (
            <div className="bg-gray-100 text-gray-700 text-sm rounded-full px-3 py-1">
              +{selectedKeywords.length - 5} more
            </div>
          )}
        </div>
      )}

      {isRunning && (
        <div className="mt-4 space-y-2">
          {statusData ? (
            <>
              <div className="flex items-center justify-between text-sm text-gray-700">
                <span>Processing keywords: {(statusData.stats?.completed || 0) + (statusData.stats?.failed || 0)} of {statusData.stats?.total || 0}</span>
                <span>{progressPercentage}%</span>
              </div>
              <Progress value={progressPercentage} className="h-2" />
              <div className="text-sm text-gray-500">
                <p>Status: <span className="font-medium">{(statusData.status || 'unknown').charAt(0).toUpperCase() + (statusData.status || 'unknown').slice(1)}</span></p>
                <p className="text-xs text-blue-600 mt-1">Fetching rankings and competitor insights (H tags, density)...</p>
                <div className="mt-1 flex justify-between text-xs text-gray-500">
                  <p>Completed: {statusData.stats?.completed || 0}</p>
                  <p>Running: {statusData.stats?.running || 0}</p>
                  <p>Pending: {statusData.stats?.pending || 0}</p>
                  <p>Failed: {statusData.stats?.failed || 0}</p>
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center justify-between text-sm text-gray-700">
                <span>Initializing crawler...</span>
                <span>0%</span>
              </div>
              <Progress value={0} className="h-2" />
              <p className="text-xs text-gray-500">Starting crawl job...</p>
            </>
          )}
        </div>
      )}
    </div>
  );
};