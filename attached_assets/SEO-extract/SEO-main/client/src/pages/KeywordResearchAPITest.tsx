import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  AlertCircle, 
  CheckCircle2, 
  Loader2, 
  Code,
  Search,
  Globe,
  TrendingUp,
  BarChart3
} from "lucide-react";
import TopBar from "@/components/dashboard/TopBar";
import SideNav from "@/components/dashboard/SideNav";
import { useToast } from "@/hooks/use-toast";

type TestType = "suggestions" | "site-keywords" | "related" | "difficulty";

export default function KeywordResearchAPITest() {
  const { toast } = useToast();
  const [testType, setTestType] = useState<TestType>("suggestions");
  const [keyword, setKeyword] = useState("seo tools");
  const [target, setTarget] = useState("tekrevol.com");
  const [keywords, setKeywords] = useState("seo tools, keyword research");
  const [locationCode, setLocationCode] = useState("2840");
  const [languageCode, setLanguageCode] = useState("en");

  // Test mutation
  const testMutation = useMutation({
    mutationFn: async (params: any) => {
      const endpoint = `/api/test/keyword-research/${testType}`;
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
      });

      // Read response as text first (can only read body once)
      const responseText = await response.text();

      if (!response.ok) {
        let errorMessage = "Failed to test Keyword Research API";
        try {
          const error = JSON.parse(responseText);
          errorMessage = error.message || errorMessage;
        } catch (e) {
          errorMessage = responseText || `HTTP ${response.status}: ${response.statusText}`;
        }
        throw new Error(errorMessage);
      }

      // Try to parse as JSON
      try {
        return JSON.parse(responseText);
      } catch (e) {
        const contentType = response.headers.get("content-type");
        throw new Error(`Expected JSON but got: ${contentType}. Response: ${responseText.substring(0, 200)}`);
      }
    },
    onSuccess: (data) => {
      toast({
        title: "Test completed",
        description: "Keyword Research API data retrieved successfully!",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Test failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleTest = () => {
    const params: any = {
      locationCode: parseInt(locationCode) || 2840,
      languageCode: languageCode || "en",
    };

    if (testType === "suggestions" || testType === "related") {
      params.keyword = keyword;
    } else if (testType === "site-keywords") {
      params.target = target;
    } else if (testType === "difficulty") {
      params.keywords = keywords.split(",").map(k => k.trim()).filter(k => k);
    }

    testMutation.mutate(params);
  };

  const renderDataDisplay = () => {
    if (!testMutation.data) return null;

    const data = testMutation.data.processedData;
    const rawData = testMutation.data.rawApiResponse;

    if (!data) {
      return (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>No processed data</AlertTitle>
          <AlertDescription>
            The API returned a response but no processed data was found. Check the raw response tab.
          </AlertDescription>
        </Alert>
      );
    }

    return (
      <Tabs defaultValue="overview" className="w-full">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="keywords">Keywords</TabsTrigger>
          <TabsTrigger value="metrics">Metrics</TabsTrigger>
          <TabsTrigger value="raw">Raw Data</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>API Response Summary</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-muted-foreground">Status</Label>
                  <p className="font-semibold">
                    {testMutation.data.success ? (
                      <Badge variant="default" className="bg-green-500">
                        <CheckCircle2 className="h-3 w-3 mr-1" />
                        Success
                      </Badge>
                    ) : (
                      <Badge variant="destructive">Failed</Badge>
                    )}
                  </p>
                </div>
                {data.items_count !== undefined && (
                  <div>
                    <Label className="text-muted-foreground">Items Count</Label>
                    <p className="font-semibold">{data.items_count}</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="keywords" className="space-y-4">
          {data.items && Array.isArray(data.items) && data.items.length > 0 ? (
            <div className="space-y-2">
              <h3 className="font-semibold">Keywords ({data.items.length})</h3>
              <div className="grid gap-2">
                {data.items.slice(0, 20).map((item: any, index: number) => (
                  <Card key={index}>
                    <CardContent className="pt-4">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <p className="font-semibold">{item.keyword || item.key || "N/A"}</p>
                          {item.search_volume && (
                            <p className="text-sm text-muted-foreground">
                              Search Volume: {item.search_volume.toLocaleString()}
                            </p>
                          )}
                          {item.keyword_difficulty !== undefined && (
                            <p className="text-sm text-muted-foreground">
                              Difficulty: {item.keyword_difficulty}/100
                            </p>
                          )}
                          {item.cpc && (
                            <p className="text-sm text-muted-foreground">
                              CPC: ${item.cpc}
                            </p>
                          )}
                        </div>
                        {item.serp_info && (
                          <Badge variant="outline">
                            SERP Info Available
                          </Badge>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
              {data.items.length > 20 && (
                <p className="text-sm text-muted-foreground">
                  Showing first 20 of {data.items.length} keywords
                </p>
              )}
            </div>
          ) : (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>No keywords found</AlertTitle>
              <AlertDescription>
                The API response doesn't contain keyword items. Check the raw data tab.
              </AlertDescription>
            </Alert>
          )}
        </TabsContent>

        <TabsContent value="metrics" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Keyword Metrics</CardTitle>
            </CardHeader>
            <CardContent>
              {data.items && Array.isArray(data.items) ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <Label className="text-muted-foreground">Total Keywords</Label>
                      <p className="text-2xl font-bold">{data.items.length}</p>
                    </div>
                    {data.items.some((item: any) => item.search_volume) && (
                      <div>
                        <Label className="text-muted-foreground">Avg Search Volume</Label>
                        <p className="text-2xl font-bold">
                          {Math.round(
                            data.items
                              .filter((item: any) => item.search_volume)
                              .reduce((sum: number, item: any) => sum + (item.search_volume || 0), 0) /
                            data.items.filter((item: any) => item.search_volume).length
                          ).toLocaleString()}
                        </p>
                      </div>
                    )}
                    {data.items.some((item: any) => item.keyword_difficulty !== undefined) && (
                      <div>
                        <Label className="text-muted-foreground">Avg Difficulty</Label>
                        <p className="text-2xl font-bold">
                          {Math.round(
                            data.items
                              .filter((item: any) => item.keyword_difficulty !== undefined)
                              .reduce((sum: number, item: any) => sum + (item.keyword_difficulty || 0), 0) /
                            data.items.filter((item: any) => item.keyword_difficulty !== undefined).length
                          )}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <p className="text-muted-foreground">No metrics available</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="raw" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Raw API Response</CardTitle>
              <CardDescription>
                Complete JSON response from the Keyword Research API
              </CardDescription>
            </CardHeader>
            <CardContent>
              <pre className="bg-muted p-4 rounded-lg overflow-auto text-xs max-h-[600px]">
                {JSON.stringify(rawData, null, 2)}
              </pre>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    );
  };

  return (
    <div className="flex h-screen bg-background">
      <SideNav />
      <div className="flex-1 flex flex-col overflow-hidden">
        <TopBar />
        <main className="flex-1 overflow-y-auto p-6">
          <div className="max-w-7xl mx-auto space-y-6">
            <div>
              <h1 className="text-3xl font-bold tracking-tight">Keyword Research API Test</h1>
              <p className="text-muted-foreground mt-2">
                Test a single Keyword Research API call to see all available data. This helps you understand what data is available before running full research.
              </p>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Test Configuration</CardTitle>
                <CardDescription>
                  Choose a test type and enter the required parameters
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label>Test Type</Label>
                  <div className="grid grid-cols-4 gap-2 mt-2">
                    <Button
                      variant={testType === "suggestions" ? "default" : "outline"}
                      onClick={() => setTestType("suggestions")}
                      className="justify-start"
                    >
                      <Search className="h-4 w-4 mr-2" />
                      Suggestions
                    </Button>
                    <Button
                      variant={testType === "site-keywords" ? "default" : "outline"}
                      onClick={() => setTestType("site-keywords")}
                      className="justify-start"
                    >
                      <Globe className="h-4 w-4 mr-2" />
                      Site Keywords
                    </Button>
                    <Button
                      variant={testType === "related" ? "default" : "outline"}
                      onClick={() => setTestType("related")}
                      className="justify-start"
                    >
                      <TrendingUp className="h-4 w-4 mr-2" />
                      Related
                    </Button>
                    <Button
                      variant={testType === "difficulty" ? "default" : "outline"}
                      onClick={() => setTestType("difficulty")}
                      className="justify-start"
                    >
                      <BarChart3 className="h-4 w-4 mr-2" />
                      Difficulty
                    </Button>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  {(testType === "suggestions" || testType === "related") && (
                    <div>
                      <Label htmlFor="keyword">Keyword</Label>
                      <Input
                        id="keyword"
                        value={keyword}
                        onChange={(e) => setKeyword(e.target.value)}
                        placeholder="e.g., seo tools"
                      />
                    </div>
                  )}

                  {testType === "site-keywords" && (
                    <div>
                      <Label htmlFor="target">Target Domain</Label>
                      <Input
                        id="target"
                        value={target}
                        onChange={(e) => setTarget(e.target.value)}
                        placeholder="e.g., tekrevol.com"
                      />
                    </div>
                  )}

                  {testType === "difficulty" && (
                    <div>
                      <Label htmlFor="keywords">Keywords (comma-separated)</Label>
                      <Input
                        id="keywords"
                        value={keywords}
                        onChange={(e) => setKeywords(e.target.value)}
                        placeholder="e.g., seo tools, keyword research"
                      />
                    </div>
                  )}

                  <div>
                    <Label htmlFor="locationCode">Location Code</Label>
                    <Input
                      id="locationCode"
                      value={locationCode}
                      onChange={(e) => setLocationCode(e.target.value)}
                      placeholder="2840 (United States)"
                    />
                  </div>

                  <div>
                    <Label htmlFor="languageCode">Language Code</Label>
                    <Input
                      id="languageCode"
                      value={languageCode}
                      onChange={(e) => setLanguageCode(e.target.value)}
                      placeholder="en"
                    />
                  </div>
                </div>

                <Button
                  onClick={handleTest}
                  disabled={testMutation.isPending}
                  className="w-full"
                >
                  {testMutation.isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Testing API...
                    </>
                  ) : (
                    <>
                      <Code className="mr-2 h-4 w-4" />
                      Test API
                    </>
                  )}
                </Button>
              </CardContent>
            </Card>

            {testMutation.isError && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Test failed</AlertTitle>
                <AlertDescription>
                  {testMutation.error?.message || "An unknown error occurred"}
                </AlertDescription>
              </Alert>
            )}

            {testMutation.isSuccess && renderDataDisplay()}
          </div>
        </main>
      </div>
    </div>
  );
}

