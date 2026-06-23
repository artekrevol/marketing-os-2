import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams, useLocation } from "wouter";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Loader2, ExternalLink, ArrowLeft, RefreshCw } from "lucide-react";

interface CompetitorInsight {
  id: number;
  competitorId: number;
  url: string;
  title: string;
  description: string;
  canonical: string | null;
  metaKeywords: string | null;
  h1: string[];
  h2: string[];
  h3: string[];
  h4: string[];
  h5: string[];
  h6: string[];
  keywordDensity: Array<{
    keyword: string;
    count: number;
    density: number;
  }>;
  robotsTxt: string;
  images: Array<{
    url: string;
    alt: string | null;
  }>;
  createdAt: string;
  updatedAt: string;
}

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

export default function CompetitorInsights() {
  const params = useParams();
  const [, navigate] = useLocation();
  const competitorIdFromURL = params.competitorId ? parseInt(params.competitorId) : null;
  const keywordIdFromURL = params.keywordId ? parseInt(params.keywordId) : null;
  
  const [selectedKeywordId, setSelectedKeywordId] = useState<number | null>(keywordIdFromURL);
  const [selectedCompetitor, setSelectedCompetitor] = useState<number | null>(competitorIdFromURL);
  const [analysisInProgress, setAnalysisInProgress] = useState<boolean>(false);
  const [progressValue, setProgressValue] = useState<number>(0);
  
  console.log("CompetitorInsights page loaded with URL param:", competitorIdFromURL);
  
  // Fetch the specific competitor by ID when loading directly from URL
  const { data: specificCompetitor, isLoading: loadingSpecificCompetitor } = useQuery({
    queryKey: ['/api/competitors', competitorIdFromURL],
    queryFn: async () => {
      if (!competitorIdFromURL) return null;
      try {
        // Fetch all competitors since we don't have a direct endpoint for a single competitor
        const response = await fetch('/api/competitors', {
          method: 'GET',
          headers: {
            'Accept': 'application/json',
          }
        });
        
        if (!response.ok) {
          throw new Error(`HTTP error! Status: ${response.status}`);
        }
        
        const allCompetitors = await response.json() as Competitor[];
        // Find the specific competitor
        const competitor = allCompetitors.find(c => c.id === competitorIdFromURL) || null;
        console.log("Found specific competitor:", competitor);
        return competitor;
      } catch (error) {
        console.error("Error fetching specific competitor:", error);
        return null;
      }
    },
    enabled: !!competitorIdFromURL
  });
  
  // Set the keyword ID when we find the specific competitor
  useEffect(() => {
    if (specificCompetitor) {
      console.log("Setting keyword ID from specific competitor:", specificCompetitor.keywordId);
      setSelectedKeywordId(specificCompetitor.keywordId);
      
      // Ensure we're keeping the selected competitor ID set
      setSelectedCompetitor(competitorIdFromURL);
    } else if (competitorIdFromURL) {
      // If we couldn't find the specific competitor but have an ID from URL,
      // just use that ID directly as we have the insight data
      console.log("Using competitor ID directly from URL:", competitorIdFromURL);
      setSelectedCompetitor(competitorIdFromURL);
    }
  }, [competitorIdFromURL, specificCompetitor]);

  // Fetch keywords
  const { data: keywords, isLoading: loadingKeywords } = useQuery({
    queryKey: ['/api/keywords'],
    queryFn: async () => {
      try {
        const response = await fetch('/api/keywords', {
          method: 'GET',
          headers: {
            'Accept': 'application/json',
          }
        });
        
        if (!response.ok) {
          throw new Error(`HTTP error! Status: ${response.status}`);
        }
        
        const data = await response.json();
        return data as Keyword[];
      } catch (error) {
        console.error("Error fetching keywords:", error);
        return [];
      }
    }
  });

  // Fetch competitors for the selected keyword
  const { data: competitorsForKeyword, isLoading: loadingCompetitors } = useQuery({
    queryKey: ['/api/competitors', selectedKeywordId],
    queryFn: async () => {
      if (!selectedKeywordId) return [];
      try {
        const response = await fetch('/api/competitors', {
          method: 'GET',
          headers: {
            'Accept': 'application/json',
          }
        });
        
        if (!response.ok) {
          throw new Error(`HTTP error! Status: ${response.status}`);
        }
        
        const allCompetitors = await response.json() as Competitor[];
        // Filter competitors for the selected keyword
        return allCompetitors.filter(competitor => competitor.keywordId === selectedKeywordId);
      } catch (error) {
        console.error("Error fetching competitors:", error);
        return [];
      }
    },
    enabled: !!selectedKeywordId
  });

  // Fetch competitor insights when a competitor is selected
  const { data: insight, isLoading: loadingInsight, refetch: refetchInsight } = useQuery({
    queryKey: ['/api/competitor-insights', selectedCompetitor],
    queryFn: async () => {
      if (!selectedCompetitor) return null;
      console.log("Fetching insights for competitor ID:", selectedCompetitor);
      try {
        const response = await fetch(`/api/competitor-insights/${selectedCompetitor}`, {
          method: 'GET',
          headers: {
            'Accept': 'application/json',
          }
        });
        
        if (!response.ok) {
          console.error(`Error response from insights API: ${response.status}`);
          throw new Error(`HTTP error! Status: ${response.status}`);
        }
        
        const data = await response.json();
        console.log("Received competitor insights data:", data);
        return data as CompetitorInsight;
      } catch (error) {
        console.error("Error fetching competitor insights:", error);
        return null;
      }
    },
    enabled: !!selectedCompetitor
  });

  // Start analysis for a competitor
  const analyzeCompetitor = async (competitorId: number) => {
    // Reset progress and set analysis in progress
    setProgressValue(0);
    setAnalysisInProgress(true);
    
    try {
      // Start the API call to analyze
      const response = await fetch('/api/competitor-insights/analyze', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ competitorId })
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! Status: ${response.status}`);
      }
      
      // Add a small delay before refetching to allow the backend to process
      setTimeout(() => {
        refetchInsight();
      }, 500);
      
    } catch (error) {
      console.error("Error analyzing competitor:", error);
    } finally {
      setAnalysisInProgress(false);
    }
  };

  // Get the selected keyword text from the keywords data
  const selectedKeywordText = keywords?.find(k => k.id === selectedKeywordId)?.keyword || '';
  const selectedKeyword = selectedKeywordText.toLowerCase(); // Use the keyword text for comparisons

  // Reset selected competitor when keyword changes
  const handleKeywordChange = (keywordId: string) => {
    setSelectedKeywordId(Number(keywordId));
    setSelectedCompetitor(null);
  };
  
  // Effect to animate the progress bar
  useEffect(() => {
    let interval: NodeJS.Timeout;
    
    if (insight?.description === 'Analysis in progress...') {
      setProgressValue(0); // Reset progress when analysis starts
      
      // Gradually increase progress to simulate task completion
      interval = setInterval(() => {
        setProgressValue((prev) => {
          if (prev >= 95) {
            clearInterval(interval);
            return prev;
          }
          
          // Simulate different stages of progress with varying speeds
          if (prev < 30) return prev + 0.5;
          if (prev < 60) return prev + 0.3;
          if (prev < 85) return prev + 0.1;
          return prev + 0.05;
        });
      }, 150);
    } else if (progressValue > 0) {
      // Reset progress when analysis is complete
      setProgressValue(0);
    }
    
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [insight?.description, progressValue]);

  // Show a loading state when initializing with a competitor from the URL
  if (competitorIdFromURL && loadingSpecificCompetitor) {
    return (
      <div className="container mx-auto py-6">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-3xl font-bold">Competitor Insights</h1>
          <Button 
            variant="outline" 
            size="sm"
            onClick={() => navigate('/competitor-analysis')}
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Competitor Analysis
          </Button>
        </div>
        <div className="flex flex-col items-center justify-center py-12">
          <Loader2 className="h-12 w-12 animate-spin text-muted-foreground mb-4" />
          <p className="text-center text-muted-foreground">
            Loading competitor insights...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-6">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold">Competitor Insights</h1>
        {competitorIdFromURL && (
          <Button 
            variant="outline" 
            size="sm"
            onClick={() => navigate('/competitor-analysis')}
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Competitor Analysis
          </Button>
        )}
      </div>
      
      {/* Only show keyword selector when not coming from direct competitor link */}
      {!competitorIdFromURL && (
        <div className="mb-6">
          <Card>
            <CardHeader>
              <CardTitle>Select Keyword</CardTitle>
              <CardDescription>
                Choose a keyword to view its competitors and analyze their content
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loadingKeywords ? (
                <div className="flex items-center space-x-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Loading keywords...</span>
                </div>
              ) : (
                <Select onValueChange={handleKeywordChange} value={selectedKeywordId?.toString()}>
                  <SelectTrigger className="w-full md:w-1/2">
                    <SelectValue placeholder="Select a keyword" />
                  </SelectTrigger>
                  <SelectContent>
                    {keywords && keywords.length > 0 ? (
                      keywords.map((keyword) => (
                        <SelectItem key={keyword.id} value={keyword.id.toString()}>
                          {keyword.keyword}
                        </SelectItem>
                      ))
                    ) : (
                      <SelectItem value="none" disabled>No keywords available</SelectItem>
                    )}
                  </SelectContent>
                </Select>
              )}
            </CardContent>
          </Card>
        </div>
      )}
      
      {/* Display when a keyword is selected or when directly accessing via competitor ID */}
      {(selectedKeywordId || competitorIdFromURL) && (
        <div className={`grid grid-cols-1 ${!competitorIdFromURL ? 'md:grid-cols-3' : 'md:grid-cols-1'} gap-6`}>
          {/* Competitor List for the selected keyword - only show when not using direct link */}
          {!competitorIdFromURL && (
            <Card className="col-span-1">
              <CardHeader>
                <CardTitle>Competitors for "{selectedKeywordText}"</CardTitle>
                <CardDescription>
                  Select a competitor to view insights
                </CardDescription>
              </CardHeader>
              <CardContent>
                {loadingCompetitors ? (
                  <div className="flex justify-center py-8">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                  </div>
                ) : (
                  <div className="space-y-2 max-h-[70vh] overflow-y-auto pr-2">
                    {competitorsForKeyword && competitorsForKeyword.length === 0 ? (
                      <div className="text-center text-muted-foreground py-4">
                        <p>No competitors found for this keyword.</p>
                        <p className="text-sm mt-2">Run a crawl to discover competitors.</p>
                      </div>
                    ) : (
                      competitorsForKeyword?.map((competitor) => (
                        <div
                          key={competitor.id}
                          className={`p-3 rounded-md cursor-pointer hover:bg-accent transition-colors ${
                            selectedCompetitor === competitor.id ? "bg-accent" : ""
                          }`}
                          onClick={() => setSelectedCompetitor(competitor.id)}
                        >
                          <div className="flex justify-between items-start">
                            <div>
                              <h3 className="font-medium">{competitor.domain}</h3>
                              <p className="text-sm text-muted-foreground truncate">
                                {competitor.title}
                              </p>
                            </div>
                            <span className="rounded-full px-2 py-1 text-xs bg-primary text-primary-foreground">
                              #{competitor.position}
                            </span>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Competitor Details */}
          <Card className={`col-span-1 ${!competitorIdFromURL ? 'md:col-span-2' : 'md:col-span-1'}`}>
            <CardHeader>
              <CardTitle>
                {selectedCompetitor ? (
                  // First try to find from the filtered list, then fall back to the specific competitor
                  competitorsForKeyword?.find(c => c.id === selectedCompetitor)?.domain || 
                  specificCompetitor?.domain ||
                  "Competitor Details"
                ) : (
                  "Competitor Details"
                )}
              </CardTitle>
              <CardDescription>
                {selectedCompetitor ? (
                  <div className="flex items-center justify-between">
                    {selectedKeywordText ? (
                      <span>Keyword: "{selectedKeywordText}"</span>
                    ) : (
                      <span>Direct competitor analysis</span>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={analysisInProgress}
                      onClick={() => selectedCompetitor && analyzeCompetitor(selectedCompetitor)}
                    >
                      {analysisInProgress ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Analyzing...
                        </>
                      ) : (
                        <>
                          <RefreshCw className="mr-2 h-4 w-4" />
                          Refresh Analysis
                        </>
                      )}
                    </Button>
                  </div>
                ) : (
                  "Select a competitor to view details"
                )}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!selectedCompetitor ? (
                <div className="flex flex-col items-center justify-center py-12">
                  <p className="text-center text-muted-foreground">
                    Select a competitor from the list to view their insights
                  </p>
                </div>
              ) : loadingInsight ? (
                <div className="flex justify-center py-12">
                  <Loader2 className="h-12 w-12 animate-spin text-muted-foreground" />
                </div>
              ) : !insight ? (
                <div className="flex flex-col items-center justify-center py-12 space-y-4">
                  <p className="text-center text-muted-foreground">
                    No insights available for this competitor yet.
                  </p>
                  <Button 
                    onClick={() => analyzeCompetitor(selectedCompetitor)}
                    disabled={analysisInProgress}
                  >
                    {analysisInProgress ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Analyzing...
                      </>
                    ) : (
                      <>
                        <RefreshCw className="mr-2 h-4 w-4" />
                        Analyze Now
                      </>
                    )}
                  </Button>
                </div>
              ) : insight.description === 'Analysis in progress...' ? (
                <div className="flex flex-col items-center justify-center py-12 space-y-4">
                  <div className="flex items-center space-x-4">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                    <div>
                      <h3 className="font-medium">Analysis in progress</h3>
                      <p className="text-sm text-muted-foreground">DataForSEO is analyzing this competitor's content</p>
                    </div>
                  </div>
                  
                  {/* Progress bar with estimated time */}
                  <div className="w-full max-w-md space-y-2 mt-2">
                    <div className="flex justify-between text-sm">
                      <span>Est. completion time</span>
                      <span>~5-10 minutes</span>
                    </div>
                    <Progress 
                      value={progressValue} 
                      className="h-2 w-full" 
                    />
                    <p className="text-sm text-muted-foreground text-center">
                      {progressValue < 30 
                        ? "Crawling page content..." 
                        : progressValue < 60 
                          ? "Analyzing page structure and headings..." 
                          : progressValue < 85 
                            ? "Processing keyword density..." 
                            : "Finalizing insights report..."}
                    </p>
                  </div>
                  
                  <div className="bg-muted p-4 rounded-md max-w-md text-sm mt-4">
                    <p className="mb-2">The OnPage API analysis is currently running in the background. This process typically takes 5-10 minutes to complete.</p>
                    <p>The results will appear automatically when ready. You can check back later or continue browsing other competitors.</p>
                  </div>
                  <Button 
                    variant="outline"
                    onClick={() => {
                      setProgressValue(0); // Reset progress
                      setTimeout(() => {
                        refetchInsight();
                      }, 300);
                    }}
                    className="mt-4"
                  >
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Check Status
                  </Button>
                </div>
              ) : (
                <Tabs defaultValue="overview" className="w-full">
                  <TabsList className="mb-4">
                    <TabsTrigger value="overview">Overview</TabsTrigger>
                    <TabsTrigger value="keywords">Keywords</TabsTrigger>
                    <TabsTrigger value="headings">Headings</TabsTrigger>
                    <TabsTrigger value="images">Images</TabsTrigger>
                  </TabsList>
                  
                  <TabsContent value="overview">
                    <div className="space-y-6">
                      <div>
                        <h3 className="text-lg font-medium mb-2">Page Details</h3>
                        <div className="bg-muted p-4 rounded-md">
                          <div className="grid grid-cols-1 md:grid-cols-6 gap-4">
                            <div className="col-span-1 md:col-span-6">
                              <h4 className="text-sm font-medium text-muted-foreground">URL</h4>
                              <a 
                                href={insight.url} 
                                target="_blank" 
                                rel="noopener noreferrer"
                                className="text-blue-500 hover:underline flex items-center"
                              >
                                {insight.url}
                                <ExternalLink className="ml-1 h-3 w-3" />
                              </a>
                            </div>
                            <div className="col-span-1 md:col-span-6">
                              <h4 className="text-sm font-medium text-muted-foreground">Title</h4>
                              <p>{insight.title}</p>
                            </div>
                            <div className="col-span-1 md:col-span-6">
                              <h4 className="text-sm font-medium text-muted-foreground">Meta Description</h4>
                              <p>{insight.description}</p>
                            </div>
                            {insight.canonical && (
                              <div className="col-span-1 md:col-span-6">
                                <h4 className="text-sm font-medium text-muted-foreground">Canonical URL</h4>
                                <p>{insight.canonical}</p>
                              </div>
                            )}
                            {insight.metaKeywords && (
                              <div className="col-span-1 md:col-span-6">
                                <h4 className="text-sm font-medium text-muted-foreground">Meta Keywords</h4>
                                <p>{insight.metaKeywords}</p>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                      
                      <div>
                        <h3 className="text-lg font-medium mb-2">
                          {selectedKeywordText 
                            ? `Top Keywords & Relevance to "${selectedKeywordText}"`
                            : "Top Keywords by Density"}
                        </h3>
                        <div className="bg-muted p-4 rounded-md">
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            {insight.keywordDensity.slice(0, 9).map((kw, idx) => {
                              // Check if this keyword contains or is related to the selected keyword
                              const isRelated = selectedKeyword ? (
                                kw.keyword.toLowerCase().includes(selectedKeyword.toLowerCase()) || 
                                selectedKeyword.toLowerCase().includes(kw.keyword.toLowerCase())
                              ) : false;
                              
                              return (
                                <div key={idx} className={`flex justify-between ${isRelated ? 'bg-primary/10 p-1 rounded' : ''}`}>
                                  <span className={`font-medium ${isRelated ? 'text-primary' : ''}`}>{kw.keyword}</span>
                                  <span className="text-muted-foreground">{(kw.density * 100).toFixed(1)}%</span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                      
                      <div>
                        <h3 className="text-lg font-medium mb-2">Heading Structure</h3>
                        <div className="bg-muted p-4 rounded-md">
                          <div className="space-y-2">
                            {insight.h1.length > 0 && (
                              <div>
                                <h4 className="text-sm font-medium text-muted-foreground">H1 ({insight.h1.length})</h4>
                                {insight.h1.map((heading, idx) => (
                                  <p key={idx} className="text-sm font-bold my-1">{heading}</p>
                                ))}
                              </div>
                            )}
                            {insight.h2.length > 0 && (
                              <div>
                                <h4 className="text-sm font-medium text-muted-foreground">H2 ({insight.h2.length})</h4>
                                {insight.h2.map((heading, idx) => (
                                  <p key={idx} className="text-sm font-semibold my-1">{heading}</p>
                                ))}
                              </div>
                            )}
                            {insight.h3.length > 0 && (
                              <div>
                                <h4 className="text-sm font-medium text-muted-foreground">H3 ({insight.h3.length})</h4>
                                {insight.h3.map((heading, idx) => (
                                  <p key={idx} className="text-sm my-1">{heading}</p>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </TabsContent>
                  
                  <TabsContent value="keywords">
                    <div className="space-y-4">
                      <h3 className="text-lg font-medium">Keyword Density</h3>
                      <div className="border rounded-md">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Keyword</TableHead>
                              <TableHead className="text-right">Count</TableHead>
                              <TableHead className="text-right">Density</TableHead>
                              <TableHead>Relevance</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {insight.keywordDensity.slice(0, 30).map((kw, idx) => {
                              // Check if this keyword contains or is related to the selected keyword
                              const isRelated = selectedKeyword ? (
                                kw.keyword.toLowerCase().includes(selectedKeyword.toLowerCase()) || 
                                selectedKeyword.toLowerCase().includes(kw.keyword.toLowerCase())
                              ) : false;
                              
                              return (
                                <TableRow key={idx} className={isRelated ? 'bg-primary/10' : ''}>
                                  <TableCell className={`font-medium ${isRelated ? 'text-primary' : ''}`}>
                                    {kw.keyword}
                                  </TableCell>
                                  <TableCell className="text-right">{kw.count}</TableCell>
                                  <TableCell className="text-right">{(kw.density * 100).toFixed(2)}%</TableCell>
                                  <TableCell>
                                    {isRelated && (
                                      <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-primary text-primary-foreground">
                                        {selectedKeywordText ? `Relevant to "${selectedKeywordText}"` : "Top keyword"}
                                      </span>
                                    )}
                                  </TableCell>
                                </TableRow>
                              );
                            })}
                          </TableBody>
                        </Table>
                      </div>
                    </div>
                  </TabsContent>
                  
                  <TabsContent value="headings">
                    <div className="space-y-4">
                      <h3 className="text-lg font-medium">Heading Structure</h3>
                      <div className="space-y-6">
                        {/* H1 Headings */}
                        {insight.h1.length > 0 && (
                          <div>
                            <h4 className="text-md font-medium mb-2">H1 Headings ({insight.h1.length})</h4>
                            <div className="border rounded-md p-4 bg-muted/50">
                              <ul className="space-y-2">
                                {insight.h1.map((heading, idx) => {
                                  const containsKeyword = selectedKeyword ? 
                                    heading.toLowerCase().includes(selectedKeyword.toLowerCase()) : false;
                                  return (
                                    <li key={idx} className={`text-lg font-bold ${containsKeyword ? 'text-primary bg-primary/10 px-2 py-1 rounded' : ''}`}>
                                      {heading}
                                    </li>
                                  );
                                })}
                              </ul>
                            </div>
                          </div>
                        )}
                        
                        {/* H2 Headings */}
                        {insight.h2.length > 0 && (
                          <div>
                            <h4 className="text-md font-medium mb-2">H2 Headings ({insight.h2.length})</h4>
                            <div className="border rounded-md p-4 bg-muted/50">
                              <ul className="space-y-2">
                                {insight.h2.map((heading, idx) => {
                                  const containsKeyword = selectedKeyword ? 
                                    heading.toLowerCase().includes(selectedKeyword.toLowerCase()) : false;
                                  return (
                                    <li key={idx} className={`text-md font-semibold ${containsKeyword ? 'text-primary bg-primary/10 px-2 py-1 rounded' : ''}`}>
                                      {heading}
                                    </li>
                                  );
                                })}
                              </ul>
                            </div>
                          </div>
                        )}
                        
                        {/* H3 Headings */}
                        {insight.h3.length > 0 && (
                          <div>
                            <h4 className="text-md font-medium mb-2">H3 Headings ({insight.h3.length})</h4>
                            <div className="border rounded-md p-4 bg-muted/50">
                              <ul className="space-y-2">
                                {insight.h3.map((heading, idx) => {
                                  const containsKeyword = selectedKeyword ? 
                                    heading.toLowerCase().includes(selectedKeyword.toLowerCase()) : false;
                                  return (
                                    <li key={idx} className={`text-sm font-medium ${containsKeyword ? 'text-primary bg-primary/10 px-2 py-1 rounded' : ''}`}>
                                      {heading}
                                    </li>
                                  );
                                })}
                              </ul>
                            </div>
                          </div>
                        )}
                        
                        {/* H4+ Headings */}
                        {(insight.h4.length > 0 || insight.h5.length > 0 || insight.h6.length > 0) && (
                          <div>
                            <h4 className="text-md font-medium mb-2">Other Headings</h4>
                            <div className="border rounded-md p-4 bg-muted/50">
                              {insight.h4.length > 0 && (
                                <div className="mb-4">
                                  <h5 className="text-sm font-medium text-muted-foreground mb-2">H4 ({insight.h4.length})</h5>
                                  <ul className="space-y-1">
                                    {insight.h4.map((heading, idx) => {
                                      const containsKeyword = selectedKeyword ? 
                                        heading.toLowerCase().includes(selectedKeyword.toLowerCase()) : false;
                                      return (
                                        <li key={idx} className={`text-xs ${containsKeyword ? 'text-primary bg-primary/10 px-1 py-0.5 rounded' : ''}`}>
                                          {heading}
                                        </li>
                                      );
                                    })}
                                  </ul>
                                </div>
                              )}
                              
                              {insight.h5.length > 0 && (
                                <div className="mb-4">
                                  <h5 className="text-sm font-medium text-muted-foreground mb-2">H5 ({insight.h5.length})</h5>
                                  <ul className="space-y-1">
                                    {insight.h5.map((heading, idx) => {
                                      const containsKeyword = selectedKeyword ? 
                                        heading.toLowerCase().includes(selectedKeyword.toLowerCase()) : false;
                                      return (
                                        <li key={idx} className={`text-xs ${containsKeyword ? 'text-primary bg-primary/10 px-1 py-0.5 rounded' : ''}`}>
                                          {heading}
                                        </li>
                                      );
                                    })}
                                  </ul>
                                </div>
                              )}
                              
                              {insight.h6.length > 0 && (
                                <div>
                                  <h5 className="text-sm font-medium text-muted-foreground mb-2">H6 ({insight.h6.length})</h5>
                                  <ul className="space-y-1">
                                    {insight.h6.map((heading, idx) => {
                                      const containsKeyword = selectedKeyword ? 
                                        heading.toLowerCase().includes(selectedKeyword.toLowerCase()) : false;
                                      return (
                                        <li key={idx} className={`text-xs ${containsKeyword ? 'text-primary bg-primary/10 px-1 py-0.5 rounded' : ''}`}>
                                          {heading}
                                        </li>
                                      );
                                    })}
                                  </ul>
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </TabsContent>
                  
                  <TabsContent value="images">
                    <div className="space-y-4">
                      <div className="flex justify-between items-center">
                        <h3 className="text-lg font-medium">Images ({insight.images.length})</h3>
                      </div>
                      
                      {insight.images.length === 0 ? (
                        <p className="text-muted-foreground py-6 text-center">No images found on the page</p>
                      ) : (
                        <div className="border rounded-md">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>#</TableHead>
                                <TableHead>URL</TableHead>
                                <TableHead>Alt Text</TableHead>
                                <TableHead>Keyword</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {insight.images.slice(0, 30).map((img, idx) => {
                                const altContainsKeyword = selectedKeywordText && img.alt ? 
                                  img.alt.toLowerCase().includes(selectedKeywordText.toLowerCase()) : false;
                                
                                return (
                                  <TableRow key={idx} className={altContainsKeyword ? 'bg-primary/10' : ''}>
                                    <TableCell>{idx + 1}</TableCell>
                                    <TableCell>
                                      <a 
                                        href={img.url} 
                                        target="_blank" 
                                        rel="noopener noreferrer"
                                        className="text-blue-500 hover:underline flex items-center"
                                      >
                                        {img.url.length > 40 ? `${img.url.slice(0, 40)}...` : img.url}
                                        <ExternalLink className="ml-1 h-3 w-3" />
                                      </a>
                                    </TableCell>
                                    <TableCell className={altContainsKeyword ? 'text-primary font-medium' : ''}>
                                      {img.alt || <span className="text-muted-foreground italic">No alt text</span>}
                                    </TableCell>
                                    <TableCell>
                                      {altContainsKeyword && (
                                        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-primary text-primary-foreground">
                                          {selectedKeywordText ? `Contains "${selectedKeywordText}"` : "Optimized alt text"}
                                        </span>
                                      )}
                                    </TableCell>
                                  </TableRow>
                                );
                              })}
                              {insight.images.length > 30 && (
                                <TableRow>
                                  <TableCell colSpan={4} className="text-center text-muted-foreground">
                                    ...and {insight.images.length - 30} more images
                                  </TableCell>
                                </TableRow>
                              )}
                            </TableBody>
                          </Table>
                        </div>
                      )}
                    </div>
                  </TabsContent>
                </Tabs>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}