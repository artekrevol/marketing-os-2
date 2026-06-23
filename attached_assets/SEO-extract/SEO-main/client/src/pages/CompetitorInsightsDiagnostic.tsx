import React, { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import axios from "axios";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { showApiError } from "@/lib/apiDebugger";
import { ArrowLeft } from "lucide-react";

interface CompetitorInsight {
  competitorId: number;
  domain?: string;
  url: string;
  title: string;
  description: string;
  canonical: string | null;
  metaKeywords: string | null;
  robotsTxt: string;
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
  images: Array<{
    url: string;
    alt: string | null;
  }>;
  taskId?: string | null;
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

interface DiagnosticData {
  competitor: Competitor;
  relatedKeyword: {
    id: number;
    keyword: string;
    targetUrl: string | null;
  };
  insight: CompetitorInsight | null;
}

function HeaderList({ headers, title }: { headers: string[]; title: string }) {
  if (!headers || headers.length === 0) return <p>No {title} headers found</p>;
  
  return (
    <div className="space-y-2">
      <h3 className="text-md font-medium">{title}</h3>
      <ul className="list-disc pl-5 space-y-1">
        {headers.map((header, index) => (
          <li key={index} className="text-sm">{header}</li>
        ))}
      </ul>
    </div>
  );
}

export default function CompetitorInsightsDiagnostic() {
  const [competitorId, setCompetitorId] = useState<string>("");
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [location, navigate] = useLocation();
  
  // Extract competitorId from URL search params if available
  useEffect(() => {
    // Get competitorId from URL query parameter
    const searchParams = new URLSearchParams(window.location.search);
    const idFromUrl = searchParams.get('id');
    
    if (idFromUrl) {
      setCompetitorId(idFromUrl);
      setCurrentId(idFromUrl);
    }
  }, []);
  
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['/api/diagnostic/competitor', currentId],
    queryFn: async () => {
      if (!currentId) return null;
      const res = await axios.get(`/api/diagnostic/competitor/${currentId}`);
      return res.data as DiagnosticData;
    },
    enabled: !!currentId,
  });
  
  const handleFetch = () => {
    if (!competitorId) return;
    setCurrentId(competitorId);
    
    // Update URL with the new ID for better sharing
    const url = new URL(window.location.href);
    url.searchParams.set('id', competitorId);
    window.history.pushState({}, '', url.toString());
  };
  
  const handleAnalyze = async () => {
    if (!currentId) return;
    
    try {
      await axios.post(`/api/diagnostic/competitor/${currentId}/analyze`);
      refetch();
    } catch (error) {
      showApiError(error, "Failed to analyze competitor");
    }
  };
  
  const handleGoBack = () => {
    navigate('/competitor-analysis');
  };
  
  return (
    <div className="container mx-auto py-6 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold">Competitor Insights Diagnostic</h1>
          <p className="text-muted-foreground">
            View raw competitor data for analysis and debugging
          </p>
        </div>
        <Button 
          variant="outline" 
          size="sm"
          onClick={handleGoBack}
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Competitor Analysis
        </Button>
      </div>
      
      <div className="flex items-end gap-4">
        <div className="flex-1">
          <Label htmlFor="competitorId">Competitor ID</Label>
          <Input 
            id="competitorId"
            value={competitorId}
            onChange={(e) => setCompetitorId(e.target.value)}
            placeholder="Enter competitor ID"
          />
        </div>
        <Button onClick={handleFetch} disabled={!competitorId}>
          Fetch Data
        </Button>
      </div>
      
      {isLoading && <div>Loading...</div>}
      
      {data && (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Competitor Data</CardTitle>
              <CardDescription>
                Basic information about the competitor
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm font-medium">ID</p>
                    <p className="text-sm">{data.competitor.id}</p>
                  </div>
                  <div>
                    <p className="text-sm font-medium">Domain</p>
                    <p className="text-sm">{data.competitor.domain}</p>
                  </div>
                  <div>
                    <p className="text-sm font-medium">URL</p>
                    <p className="text-sm break-all">
                      <a href={data.competitor.url} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">
                        {data.competitor.url}
                      </a>
                    </p>
                  </div>
                  <div>
                    <p className="text-sm font-medium">Position</p>
                    <p className="text-sm">{data.competitor.position}</p>
                  </div>
                  <div>
                    <p className="text-sm font-medium">Title</p>
                    <p className="text-sm">{data.competitor.title}</p>
                  </div>
                  <div>
                    <p className="text-sm font-medium">Date</p>
                    <p className="text-sm">{new Date(data.competitor.date).toLocaleString()}</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader>
              <CardTitle>Related Keyword</CardTitle>
              <CardDescription>
                The keyword this competitor was found for
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm font-medium">Keyword</p>
                    <p className="text-sm">{data.relatedKeyword.keyword}</p>
                  </div>
                  <div>
                    <p className="text-sm font-medium">Target URL</p>
                    <p className="text-sm break-all">
                      {data.relatedKeyword.targetUrl ? (
                        <a href={data.relatedKeyword.targetUrl} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">
                          {data.relatedKeyword.targetUrl}
                        </a>
                      ) : "None"}
                    </p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
          
          {data.insight ? (
            <Tabs defaultValue="meta" className="w-full">
              <TabsList className="grid grid-cols-5 w-full">
                <TabsTrigger value="meta">Meta Data</TabsTrigger>
                <TabsTrigger value="headers">Headers</TabsTrigger>
                <TabsTrigger value="keywords">Keyword Density</TabsTrigger>
                <TabsTrigger value="images">Images</TabsTrigger>
                <TabsTrigger value="raw">Raw Data</TabsTrigger>
              </TabsList>
              
              <TabsContent value="meta" className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle>Meta Information</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      <div>
                        <h3 className="text-md font-medium">Title</h3>
                        <p className="text-sm">{data.insight.title}</p>
                      </div>
                      <Separator />
                      <div>
                        <h3 className="text-md font-medium">Description</h3>
                        <p className="text-sm">{data.insight.description}</p>
                      </div>
                      <Separator />
                      <div>
                        <h3 className="text-md font-medium">Canonical URL</h3>
                        <p className="text-sm break-all">
                          {data.insight.canonical ? (
                            <a href={data.insight.canonical} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">
                              {data.insight.canonical}
                            </a>
                          ) : "None"}
                        </p>
                      </div>
                      <Separator />
                      <div>
                        <h3 className="text-md font-medium">Meta Keywords</h3>
                        <p className="text-sm">{data.insight.metaKeywords || "None"}</p>
                      </div>
                      <Separator />
                      <div>
                        <h3 className="text-md font-medium">Robots.txt</h3>
                        <pre className="bg-secondary p-2 rounded text-xs whitespace-pre-wrap">
                          {data.insight.robotsTxt || "None"}
                        </pre>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>
              
              <TabsContent value="headers" className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle>Header Tags</CardTitle>
                    <CardDescription>
                      All header tags found on the page
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-6">
                      <HeaderList headers={data.insight.h1} title="H1" />
                      <Separator />
                      <HeaderList headers={data.insight.h2} title="H2" />
                      <Separator />
                      <HeaderList headers={data.insight.h3} title="H3" />
                      <Separator />
                      <HeaderList headers={data.insight.h4} title="H4" />
                      <Separator />
                      <HeaderList headers={data.insight.h5} title="H5" />
                      <Separator />
                      <HeaderList headers={data.insight.h6} title="H6" />
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>
              
              <TabsContent value="keywords" className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle>Keyword Density</CardTitle>
                    <CardDescription>
                      Important keywords and their frequency on the page
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      <div className="grid grid-cols-3 font-medium text-sm">
                        <div>Keyword</div>
                        <div>Count</div>
                        <div>Density</div>
                      </div>
                      <Separator />
                      <ScrollArea className="h-[400px]">
                        <div className="space-y-2">
                          {data.insight.keywordDensity.map((item, index) => (
                            <div key={index} className="grid grid-cols-3 text-sm">
                              <div>{item.keyword}</div>
                              <div>{item.count}</div>
                              <div>{(item.density * 100).toFixed(2)}%</div>
                            </div>
                          ))}
                        </div>
                      </ScrollArea>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>
              
              <TabsContent value="images" className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle>Images</CardTitle>
                    <CardDescription>
                      Images found on the page with their alt text
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {data.insight.images && data.insight.images.length > 0 ? (
                      <div className="space-y-4">
                        {data.insight.images.map((image, index) => (
                          <div key={index} className="border rounded p-4 space-y-2">
                            <p className="text-sm break-all">
                              <span className="font-medium">URL: </span>
                              <a href={image.url} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">
                                {image.url}
                              </a>
                            </p>
                            <p className="text-sm">
                              <span className="font-medium">Alt Text: </span>
                              {image.alt || "None"}
                            </p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p>No images found</p>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>
              
              <TabsContent value="raw" className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle>Raw JSON Data</CardTitle>
                    <CardDescription>
                      Complete raw response from the API
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ScrollArea className="h-[500px]">
                      <pre className="bg-secondary p-4 rounded text-xs whitespace-pre-wrap">
                        {JSON.stringify(data.insight, null, 2)}
                      </pre>
                    </ScrollArea>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle>No Insights Available</CardTitle>
                <CardDescription>
                  This competitor doesn't have any insights data yet
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button onClick={handleAnalyze}>Analyze Competitor</Button>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}