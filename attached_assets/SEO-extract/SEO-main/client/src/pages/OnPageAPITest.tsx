import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  AlertCircle, 
  CheckCircle2, 
  Loader2, 
  ExternalLink,
  Code,
  FileText,
  Tag,
  BarChart3,
  Image as ImageIcon,
  Globe
} from "lucide-react";
import TopBar from "@/components/dashboard/TopBar";
import SideNav from "@/components/dashboard/SideNav";
import { useToast } from "@/hooks/use-toast";

export default function OnPageAPITest() {
  const { toast } = useToast();
  const [testUrl, setTestUrl] = useState("https://www.tekrevol.com");
  const [taskId, setTaskId] = useState<string | null>(null);
  const [testStatus, setTestStatus] = useState<"idle" | "processing" | "completed" | "error">("idle");

  // Test mutation
  const testMutation = useMutation({
    mutationFn: async (url: string) => {
      const response = await fetch("/api/test/onpage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });

      // Read response as text first (can only read body once)
      const responseText = await response.text();

      if (!response.ok) {
        let errorMessage = "Failed to test OnPage API";
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
      if (data.taskId && data.status === "processing") {
        setTaskId(data.taskId);
        setTestStatus("processing");
        toast({
          title: "Task created",
          description: "Waiting for task to complete. This may take 5-15 minutes.",
        });
        // Start polling for results
        setTimeout(() => {
          checkTaskStatus(data.taskId);
        }, 30000); // Check after 30 seconds
      } else if (data.success) {
        setTestStatus("completed");
        toast({
          title: "Test completed",
          description: "OnPage API data retrieved successfully!",
        });
      }
    },
    onError: (error: Error) => {
      setTestStatus("error");
      toast({
        title: "Test failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Check task status
  const checkTaskStatus = async (taskIdToCheck: string) => {
    try {
      const response = await fetch(`/api/test/onpage?taskId=${taskIdToCheck}`);
      const responseText = await response.text();
      
      if (response.ok) {
        try {
          const data = JSON.parse(responseText);
          if (data.success) {
            setTestStatus("completed");
            // Refetch the query to get the data
            window.location.reload();
          } else if (data.status === "processing") {
            // Still processing, check again in 30 seconds
            setTimeout(() => checkTaskStatus(taskIdToCheck), 30000);
          }
        } catch (e) {
          console.error("Error parsing task status response:", e);
        }
      }
    } catch (error) {
      console.error("Error checking task status:", error);
    }
  };

  // Poll for test results when task is processing
  const { data: testData, isLoading, error } = useQuery({
    queryKey: ["/api/test/onpage", taskId],
    queryFn: async () => {
      if (!taskId) return null;
      const response = await fetch(`/api/test/onpage?taskId=${taskId}`);
      
      // Read response as text first (can only read body once)
      const responseText = await response.text();

      if (!response.ok) {
        let errorMessage = "Failed to fetch test results";
        try {
          const error = JSON.parse(responseText);
          errorMessage = error.message || errorMessage;
        } catch (e) {
          errorMessage = responseText || `HTTP ${response.status}: ${response.statusText}`;
        }
        throw new Error(errorMessage);
      }

      // Try to parse as JSON
      let data;
      try {
        data = JSON.parse(responseText);
      } catch (e) {
        const contentType = response.headers.get("content-type");
        throw new Error(`Expected JSON but got: ${contentType}. Response: ${responseText.substring(0, 200)}`);
      }
      if (data.success) {
        setTestStatus("completed");
      }
      return data;
    },
    enabled: !!taskId && testStatus === "processing",
    refetchInterval: (query) => {
      // Stop polling if task is completed
      if (query.state.data?.success) {
        return false;
      }
      // Poll every 30 seconds while processing
      return 30000;
    },
    retry: false,
  });

  const handleTest = () => {
    if (!testUrl.trim()) {
      toast({
        title: "URL required",
        description: "Please enter a URL to test",
        variant: "destructive",
      });
      return;
    }
    setTestStatus("processing");
    testMutation.mutate(testUrl);
  };

  const pageData = testData?.processedData || testData?.rawApiResponse?.tasks?.[0]?.result?.[0]?.items?.[0];
  const meta = pageData?.meta;
  const pageContent = pageData?.page_content;

  return (
    <div className="flex h-screen bg-background">
      <SideNav />
      <div className="flex-1 flex flex-col overflow-hidden">
        <TopBar title="OnPage API Test" onMobileMenuToggle={() => {}} />
        <main className="flex-1 overflow-y-auto p-4 md:p-6">
          <div className="max-w-7xl mx-auto space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Test OnPage API</CardTitle>
                <CardDescription>
                  Test a single OnPage API call to see all available data. This helps you understand what data is available before running full crawls.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="test-url">URL to Test</Label>
                  <div className="flex gap-2">
                    <Input
                      id="test-url"
                      value={testUrl}
                      onChange={(e) => setTestUrl(e.target.value)}
                      placeholder="https://example.com"
                      disabled={testStatus === "processing"}
                    />
                    <Button
                      onClick={handleTest}
                      disabled={testStatus === "processing" || !testUrl.trim()}
                    >
                      {testStatus === "processing" ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Processing...
                        </>
                      ) : (
                        "Test API"
                      )}
                    </Button>
                  </div>
                </div>

                {testStatus === "processing" && (
                  <Alert>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <AlertTitle>Task Processing</AlertTitle>
                    <AlertDescription>
                      The OnPage API task is being processed. This typically takes 5-15 minutes.
                      {taskId && (
                        <div className="mt-2">
                          <strong>Task ID:</strong> <code className="text-xs">{taskId}</code>
                        </div>
                      )}
                    </AlertDescription>
                  </Alert>
                )}

                {error && (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>Error</AlertTitle>
                    <AlertDescription>{error.message}</AlertDescription>
                  </Alert>
                )}

                {isLoading && (
                  <div className="space-y-4">
                    <Skeleton className="h-32 w-full" />
                    <Skeleton className="h-64 w-full" />
                  </div>
                )}

                {testData && testData.success && pageData && (
                  <div className="space-y-6">
                    <Alert>
                      <CheckCircle2 className="h-4 w-4" />
                      <AlertTitle>Test Completed Successfully!</AlertTitle>
                      <AlertDescription>
                        All data from the OnPage API is displayed below.
                      </AlertDescription>
                    </Alert>

                    <Tabs defaultValue="overview" className="w-full">
                      <TabsList className="grid w-full grid-cols-6">
                        <TabsTrigger value="overview">Overview</TabsTrigger>
                        <TabsTrigger value="meta">Meta Tags</TabsTrigger>
                        <TabsTrigger value="headings">Headings</TabsTrigger>
                        <TabsTrigger value="density">Keyword Density</TabsTrigger>
                        <TabsTrigger value="images">Images</TabsTrigger>
                        <TabsTrigger value="raw">Raw Data</TabsTrigger>
                      </TabsList>

                      {/* Overview Tab */}
                      <TabsContent value="overview" className="space-y-4">
                        <Card>
                          <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                              <Globe className="h-5 w-5" />
                              Page Information
                            </CardTitle>
                          </CardHeader>
                          <CardContent className="space-y-3">
                            <div>
                              <Label className="text-sm font-medium text-muted-foreground">URL</Label>
                              <div className="flex items-center gap-2 mt-1">
                                <a
                                  href={testUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-blue-600 hover:underline flex items-center gap-1"
                                >
                                  {testUrl}
                                  <ExternalLink className="h-3 w-3" />
                                </a>
                              </div>
                            </div>
                            {meta?.title && (
                              <div>
                                <Label className="text-sm font-medium text-muted-foreground">Title</Label>
                                <p className="mt-1">{meta.title}</p>
                              </div>
                            )}
                            {meta?.description && (
                              <div>
                                <Label className="text-sm font-medium text-muted-foreground">Description</Label>
                                <p className="mt-1 text-sm">{meta.description}</p>
                              </div>
                            )}
                            {meta?.canonical && (
                              <div>
                                <Label className="text-sm font-medium text-muted-foreground">Canonical URL</Label>
                                <p className="mt-1 text-sm font-mono">{meta.canonical}</p>
                              </div>
                            )}
                          </CardContent>
                        </Card>

                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                          <Card>
                            <CardHeader className="pb-3">
                              <CardTitle className="text-sm font-medium">H1 Tags</CardTitle>
                            </CardHeader>
                            <CardContent>
                              <div className="text-2xl font-bold">
                                {pageContent?.h1?.length || 0}
                              </div>
                            </CardContent>
                          </Card>
                          <Card>
                            <CardHeader className="pb-3">
                              <CardTitle className="text-sm font-medium">H2 Tags</CardTitle>
                            </CardHeader>
                            <CardContent>
                              <div className="text-2xl font-bold">
                                {pageContent?.h2?.length || 0}
                              </div>
                            </CardContent>
                          </Card>
                          <Card>
                            <CardHeader className="pb-3">
                              <CardTitle className="text-sm font-medium">Keywords</CardTitle>
                            </CardHeader>
                            <CardContent>
                              <div className="text-2xl font-bold">
                                {pageContent?.content?.density
                                  ? Object.keys(pageContent.content.density).length
                                  : 0}
                              </div>
                            </CardContent>
                          </Card>
                        </div>
                      </TabsContent>

                      {/* Meta Tags Tab */}
                      <TabsContent value="meta" className="space-y-4">
                        <Card>
                          <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                              <Tag className="h-5 w-5" />
                              Meta Tags
                            </CardTitle>
                          </CardHeader>
                          <CardContent className="space-y-4">
                            {meta?.title && (
                              <div>
                                <Label className="text-sm font-medium">Title</Label>
                                <p className="mt-1 p-2 bg-muted rounded">{meta.title}</p>
                              </div>
                            )}
                            {meta?.description && (
                              <div>
                                <Label className="text-sm font-medium">Description</Label>
                                <p className="mt-1 p-2 bg-muted rounded text-sm">{meta.description}</p>
                              </div>
                            )}
                            {meta?.canonical && (
                              <div>
                                <Label className="text-sm font-medium">Canonical</Label>
                                <p className="mt-1 p-2 bg-muted rounded font-mono text-sm">{meta.canonical}</p>
                              </div>
                            )}
                            {meta?.meta_keywords && (
                              <div>
                                <Label className="text-sm font-medium">Meta Keywords</Label>
                                <p className="mt-1 p-2 bg-muted rounded text-sm">{meta.meta_keywords}</p>
                              </div>
                            )}
                            {meta?.robots_txt && (
                              <div>
                                <Label className="text-sm font-medium">Robots.txt</Label>
                                <pre className="mt-1 p-2 bg-muted rounded text-xs overflow-x-auto">
                                  {meta.robots_txt}
                                </pre>
                              </div>
                            )}
                            {meta?.charset && (
                              <div>
                                <Label className="text-sm font-medium">Charset</Label>
                                <p className="mt-1 p-2 bg-muted rounded">{meta.charset}</p>
                              </div>
                            )}
                          </CardContent>
                        </Card>
                      </TabsContent>

                      {/* Headings Tab */}
                      <TabsContent value="headings" className="space-y-4">
                        <Card>
                          <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                              <FileText className="h-5 w-5" />
                              Page Headings
                            </CardTitle>
                          </CardHeader>
                          <CardContent className="space-y-6">
                            {pageContent?.h1 && pageContent.h1.length > 0 && (
                              <div>
                                <Label className="text-sm font-medium flex items-center gap-2">
                                  H1 Tags <Badge variant="secondary">{pageContent.h1.length}</Badge>
                                </Label>
                                <ul className="mt-2 space-y-1">
                                  {pageContent.h1.map((h1: string, idx: number) => (
                                    <li key={idx} className="p-2 bg-muted rounded text-sm">
                                      {h1}
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}
                            {pageContent?.h2 && pageContent.h2.length > 0 && (
                              <div>
                                <Label className="text-sm font-medium flex items-center gap-2">
                                  H2 Tags <Badge variant="secondary">{pageContent.h2.length}</Badge>
                                </Label>
                                <ul className="mt-2 space-y-1">
                                  {pageContent.h2.map((h2: string, idx: number) => (
                                    <li key={idx} className="p-2 bg-muted rounded text-sm">
                                      {h2}
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}
                            {pageContent?.h3 && pageContent.h3.length > 0 && (
                              <div>
                                <Label className="text-sm font-medium flex items-center gap-2">
                                  H3 Tags <Badge variant="secondary">{pageContent.h3.length}</Badge>
                                </Label>
                                <ul className="mt-2 space-y-1 max-h-64 overflow-y-auto">
                                  {pageContent.h3.map((h3: string, idx: number) => (
                                    <li key={idx} className="p-2 bg-muted rounded text-sm">
                                      {h3}
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}
                            {(!pageContent?.h1?.length && !pageContent?.h2?.length && !pageContent?.h3?.length) && (
                              <p className="text-muted-foreground text-sm">No headings found</p>
                            )}
                          </CardContent>
                        </Card>
                      </TabsContent>

                      {/* Keyword Density Tab */}
                      <TabsContent value="density" className="space-y-4">
                        <Card>
                          <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                              <BarChart3 className="h-5 w-5" />
                              Keyword Density
                            </CardTitle>
                            <CardDescription>
                              Keywords found on the page with their frequency and density percentages
                            </CardDescription>
                          </CardHeader>
                          <CardContent>
                            {pageContent?.content?.density ? (
                              <div className="space-y-2">
                                {Object.entries(pageContent.content.density)
                                  .sort((a, b) => (b[1] as any).density - (a[1] as any).density)
                                  .slice(0, 50)
                                  .map(([keyword, data]: [string, any]) => (
                                    <div
                                      key={keyword}
                                      className="flex items-center justify-between p-3 bg-muted rounded"
                                    >
                                      <div className="flex-1">
                                        <div className="font-medium">{keyword}</div>
                                        <div className="text-sm text-muted-foreground">
                                          {data.count} occurrences
                                        </div>
                                      </div>
                                      <Badge variant="outline" className="ml-4">
                                        {(data.density * 100).toFixed(2)}%
                                      </Badge>
                                    </div>
                                  ))}
                                {Object.keys(pageContent.content.density).length > 50 && (
                                  <p className="text-sm text-muted-foreground mt-4">
                                    Showing top 50 of {Object.keys(pageContent.content.density).length} keywords
                                  </p>
                                )}
                              </div>
                            ) : (
                              <p className="text-muted-foreground text-sm">No keyword density data available</p>
                            )}
                          </CardContent>
                        </Card>
                      </TabsContent>

                      {/* Images Tab */}
                      <TabsContent value="images" className="space-y-4">
                        <Card>
                          <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                              <ImageIcon className="h-5 w-5" />
                              Images
                            </CardTitle>
                          </CardHeader>
                          <CardContent>
                            {pageContent?.images && pageContent.images.length > 0 ? (
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {pageContent.images.slice(0, 20).map((img: any, idx: number) => (
                                  <div key={idx} className="border rounded p-3 space-y-2">
                                    <img
                                      src={img.url}
                                      alt={img.alt || "Image"}
                                      className="w-full h-32 object-cover rounded"
                                      onError={(e) => {
                                        (e.target as HTMLImageElement).style.display = "none";
                                      }}
                                    />
                                    <div className="text-xs space-y-1">
                                      <div className="font-mono truncate">{img.url}</div>
                                      {img.alt && <div className="text-muted-foreground">Alt: {img.alt}</div>}
                                    </div>
                                  </div>
                                ))}
                                {pageContent.images.length > 20 && (
                                  <p className="text-sm text-muted-foreground col-span-2">
                                    Showing 20 of {pageContent.images.length} images
                                  </p>
                                )}
                              </div>
                            ) : (
                              <p className="text-muted-foreground text-sm">No images found</p>
                            )}
                          </CardContent>
                        </Card>
                      </TabsContent>

                      {/* Raw Data Tab */}
                      <TabsContent value="raw" className="space-y-4">
                        <Card>
                          <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                              <Code className="h-5 w-5" />
                              Raw API Response
                            </CardTitle>
                            <CardDescription>
                              Complete JSON response from the OnPage API
                            </CardDescription>
                          </CardHeader>
                          <CardContent>
                            <pre className="p-4 bg-muted rounded text-xs overflow-auto max-h-[600px]">
                              {JSON.stringify(testData.rawApiResponse || testData, null, 2)}
                            </pre>
                          </CardContent>
                        </Card>
                      </TabsContent>
                    </Tabs>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </main>
      </div>
    </div>
  );
}

