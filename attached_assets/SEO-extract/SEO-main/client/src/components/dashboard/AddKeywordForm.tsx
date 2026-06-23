import { useState, useRef } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import * as z from "zod";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { LocationSelect } from "@/components/ui/location-select";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Upload, FileText, AlertCircle, Loader2, FileUp } from "lucide-react";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
import * as XLSX from 'xlsx';

const formSchema = z.object({
  keywords: z.string().min(1, "At least one keyword is required"),
  targetUrl: z.string().optional(),
  locationId: z.number().nullable(),
  group: z.string().optional(),
  trackDaily: z.boolean().default(true),
});

export default function AddKeywordForm() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [activeTab, setActiveTab] = useState("manual");
  
  // File upload state
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isFileUploading, setIsFileUploading] = useState(false);
  const [uploadedKeywords, setUploadedKeywords] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Query for keyword groups
  const { data: keywordGroups = [] } = useQuery<any[]>({
    queryKey: ["/api/keyword-groups"],
  });
  
  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      keywords: "",
      targetUrl: "",
      locationId: null,
      group: "No Group",
      trackDaily: true,
    },
  });

  const mutation = useMutation({
    mutationFn: async (values: z.infer<typeof formSchema>) => {
      setIsSubmitting(true);
      
      // Split keywords by newlines and filter out empty lines
      const keywordList = values.keywords
        .split("\n")
        .map(k => k.trim())
        .filter(k => k.length > 0);
      
      if (keywordList.length === 0) {
        throw new Error("No valid keywords provided");
      }

      if (keywordList.length > 100) {
        throw new Error("Maximum 100 keywords allowed at once");
      }
      
      // Use bulk endpoint to add multiple keywords
      return apiRequest("POST", "/api/keywords/bulk", {
        keywords: keywordList,
        targetUrl: values.targetUrl,
        locationId: values.locationId,
        group: values.group === "No Group" ? null : values.group,
        trackDaily: values.trackDaily,
      });
    },
    onSuccess: () => {
      toast({
        title: "Keywords Added",
        description: "Your keywords have been added successfully",
      });
      
      // Reset form
      form.reset({
        keywords: "",
        targetUrl: "",
        locationId: form.getValues("locationId"),
        group: form.getValues("group"),
        trackDaily: true,
      });
      
      // Reset uploaded keywords
      setUploadedKeywords([]);
      
      // Invalidate queries to refresh data
      queryClient.invalidateQueries({ queryKey: ["/api/keywords"] });
      queryClient.invalidateQueries({ queryKey: ["/api/keywords/rankings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
    },
    onError: (error) => {
      toast({
        title: "Error Adding Keywords",
        description: error instanceof Error ? error.message : "An unknown error occurred",
        variant: "destructive",
      });
    },
    onSettled: () => {
      setIsSubmitting(false);
    }
  });

  function onSubmit(values: z.infer<typeof formSchema>) {
    mutation.mutate(values);
  }

  // Function to handle file upload
  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsFileUploading(true);
    setUploadError(null);

    try {
      // Check file extension
      const fileExt = file.name.split('.').pop()?.toLowerCase();
      if (fileExt !== 'csv' && fileExt !== 'xlsx' && fileExt !== 'xls') {
        throw new Error('Please upload a CSV or Excel file.');
      }

      // Read the file using FileReader
      const reader = new FileReader();
      
      reader.onload = (e) => {
        try {
          const data = e.target?.result;
          let keywords: string[] = [];
          
          if (fileExt === 'csv') {
            // Process CSV
            const text = data as string;
            const lines = text.split('\n');
            keywords = lines
              .map(line => line.split(',')[0]?.trim()) // Take first column
              .filter(keyword => keyword && keyword.length > 0);
          } else {
            // Process Excel (xlsx/xls)
            const arrayBuffer = data as ArrayBuffer;
            const workbook = XLSX.read(arrayBuffer, { type: 'array' });
            
            // Get the first worksheet
            const firstSheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[firstSheetName];
            
            // Convert to JSON and extract keywords
            const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];
            
            // Extract first column as keywords
            keywords = jsonData
              .map(row => (row[0] || '').toString().trim())
              .filter(keyword => keyword && keyword.length > 0);
          }

          if (keywords.length === 0) {
            throw new Error('No keywords found in the file.');
          }

          if (keywords.length > 100) {
            // Truncate to 100 keywords and show warning
            const originalCount = keywords.length;
            keywords = keywords.slice(0, 100);
            
            toast({
              title: "Warning: Too Many Keywords",
              description: `File contains ${originalCount} keywords. Only the first 100 will be processed.`,
              variant: "destructive",
            });
          }

          // Update the form with the uploaded keywords
          form.setValue('keywords', keywords.join('\n'));
          setUploadedKeywords(keywords);
          
          toast({
            title: "File Processed",
            description: `${keywords.length} keywords extracted from file.`,
          });
        } catch (error) {
          setUploadError(error instanceof Error ? error.message : 'Error processing file');
          console.error('Error processing file data:', error);
        } finally {
          setIsFileUploading(false);
        }
      };

      reader.onerror = () => {
        setUploadError('Error reading file');
        setIsFileUploading(false);
      };

      // Read the file
      if (fileExt === 'csv') {
        reader.readAsText(file);
      } else {
        reader.readAsArrayBuffer(file);
      }
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : 'Error processing file');
      console.error('Error processing file:', error);
      setIsFileUploading(false);
    } finally {
      // Reset the file input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  return (
    <Card>
      <CardContent className="pt-6 px-6 pb-4">
        <h3 className="font-semibold mb-4">Add New Keywords</h3>
        
        <Tabs defaultValue="manual" className="w-full mb-4" onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-2 mb-4">
            <TabsTrigger value="manual">Manual Entry</TabsTrigger>
            <TabsTrigger value="upload" className="flex items-center justify-center gap-2">
              <FileUp size={14} />
              Upload Excel
            </TabsTrigger>
          </TabsList>
          
          <TabsContent value="manual">
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="keywords"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Keywords</FormLabel>
                      <FormControl>
                        <Textarea
                          placeholder="Add multiple keywords (one per line)
Example:
mobile app development
web development services
software development company"
                          className="min-h-[100px]"
                          {...field}
                        />
                      </FormControl>
                      <FormDescription>
                        Enter up to 100 keywords, one per line
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                
                <FormField
                  control={form.control}
                  name="targetUrl"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Target URL (optional)</FormLabel>
                      <FormControl>
                        <Input 
                          placeholder="tekrevol.com/services/web-development"
                          {...field}
                        />
                      </FormControl>
                      <FormDescription>
                        Leave empty to track entire domain
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                
                <FormField
                  control={form.control}
                  name="locationId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Location</FormLabel>
                      <FormControl>
                        <LocationSelect
                          value={field.value}
                          onChange={field.onChange}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                
                <FormField
                  control={form.control}
                  name="group"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Keyword Group</FormLabel>
                      <Select
                        onValueChange={field.onChange}
                        defaultValue={field.value}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select a group" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="No Group">No Group</SelectItem>
                          {keywordGroups.map((group: any) => (
                            <SelectItem key={group.id} value={group.id.toString()}>
                              {group.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                
                <FormField
                  control={form.control}
                  name="trackDaily"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md p-1">
                      <FormControl>
                        <Checkbox
                          checked={field.value}
                          onCheckedChange={field.onChange}
                        />
                      </FormControl>
                      <div className="space-y-1 leading-none">
                        <FormLabel>
                          Track daily (recommended)
                        </FormLabel>
                      </div>
                    </FormItem>
                  )}
                />
                
                <Button 
                  type="submit" 
                  className="w-full"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? (
                    <div className="flex items-center justify-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span>Adding Keywords...</span>
                    </div>
                  ) : (
                    "Add Keywords"
                  )}
                </Button>
              </form>
            </Form>
          </TabsContent>
          
          <TabsContent value="upload">
            <div className="space-y-4">
              <div className="grid md:grid-cols-2 gap-6">
                <div className="border-2 border-dashed border-gray-300 rounded-md p-6 text-center bg-slate-50">
                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleFileUpload}
                    className="hidden"
                    accept=".csv,.xlsx,.xls"
                  />
                  
                  <div className="flex flex-col items-center justify-center">
                    <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mb-4">
                      <Upload className="h-8 w-8 text-primary" />
                    </div>
                    <h3 className="text-xl font-medium text-gray-900 mb-2">Upload Keywords</h3>
                    <p className="text-sm text-gray-500 mb-6 max-w-xs mx-auto">
                      Upload a CSV or Excel file with keywords in the first column
                    </p>
                    
                    <Button 
                      type="button" 
                      variant="default" 
                      onClick={() => fileInputRef.current?.click()}
                      disabled={isFileUploading}
                      className="flex items-center gap-2 px-6"
                      size="lg"
                    >
                      {isFileUploading ? (
                        <>
                          <Loader2 className="h-5 w-5 animate-spin" />
                          Processing File...
                        </>
                      ) : (
                        <>
                          <FileUp className="h-5 w-5" />
                          Choose Excel or CSV
                        </>
                      )}
                    </Button>
                  </div>
                </div>
                
                <div className="border border-gray-200 rounded-md p-6 bg-white">
                  <h3 className="font-medium text-gray-900 mb-3 flex items-center">
                    <FileText className="h-5 w-5 mr-2 text-blue-500" />
                    File Format Guidelines
                  </h3>
                  
                  <div className="space-y-3 text-sm text-gray-600">
                    <p>Your Excel or CSV file should follow this format:</p>
                    
                    <div className="bg-gray-50 p-3 rounded border border-gray-200 font-mono text-xs overflow-x-auto">
                      <table className="w-full">
                        <thead>
                          <tr className="border-b border-gray-200">
                            <th className="text-left pb-2 font-medium">A (Keywords)</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr><td className="py-1">web development</td></tr>
                          <tr><td className="py-1">mobile app development</td></tr>
                          <tr><td className="py-1">software development company</td></tr>
                          <tr><td className="py-1">...</td></tr>
                        </tbody>
                      </table>
                    </div>
                    
                    <ul className="list-disc list-inside space-y-1">
                      <li>One keyword per row in the first column</li>
                      <li>Supports CSV, XLS, and XLSX file formats</li>
                      <li>Maximum 100 keywords per upload</li>
                      <li>First row can be a header (will be skipped if non-keyword)</li>
                    </ul>
                  </div>
                </div>
              </div>
              
              {uploadError && (
                <Alert variant="destructive" className="mb-4">
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>Error</AlertTitle>
                  <AlertDescription>{uploadError}</AlertDescription>
                </Alert>
              )}
              
              {uploadedKeywords.length > 0 && (
                <div className="bg-slate-50 p-6 rounded-md border border-slate-200">
                  <div className="flex items-center mb-4">
                    <div className="bg-green-100 p-2 rounded-full mr-3">
                      <FileText className="h-5 w-5 text-green-600" />
                    </div>
                    <div>
                      <h4 className="font-medium text-gray-900">
                        {uploadedKeywords.length} keywords extracted
                      </h4>
                      <p className="text-sm text-gray-500">Configure options below to add these keywords</p>
                    </div>
                  </div>
                  
                  <div className="mb-4 max-h-32 overflow-y-auto bg-white border border-slate-200 rounded p-2">
                    <div className="text-xs font-mono">
                      {uploadedKeywords.slice(0, 7).map((keyword, index) => (
                        <div key={index} className="py-1 px-2 truncate hover:bg-slate-50">
                          {keyword}
                        </div>
                      ))}
                      {uploadedKeywords.length > 7 && (
                        <div className="py-1 px-2 text-slate-500">
                          + {uploadedKeywords.length - 7} more keywords
                        </div>
                      )}
                    </div>
                  </div>
                  
                  <Form {...form}>
                    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                      <FormField
                        control={form.control}
                        name="targetUrl"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Target URL (optional)</FormLabel>
                            <FormControl>
                              <Input 
                                placeholder="tekrevol.com/services/web-development"
                                {...field}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      
                      <FormField
                        control={form.control}
                        name="locationId"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Location</FormLabel>
                            <FormControl>
                              <LocationSelect
                                value={field.value}
                                onChange={field.onChange}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      
                      <FormField
                        control={form.control}
                        name="group"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Keyword Group</FormLabel>
                            <Select
                              onValueChange={field.onChange}
                              defaultValue={field.value}
                            >
                              <FormControl>
                                <SelectTrigger>
                                  <SelectValue placeholder="Select a group" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                <SelectItem value="No Group">No Group</SelectItem>
                                {keywordGroups.map((group: any) => (
                                  <SelectItem key={group.id} value={group.id.toString()}>
                                    {group.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      
                      <FormField
                        control={form.control}
                        name="trackDaily"
                        render={({ field }) => (
                          <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md p-1">
                            <FormControl>
                              <Checkbox
                                checked={field.value}
                                onCheckedChange={field.onChange}
                              />
                            </FormControl>
                            <div className="space-y-1 leading-none">
                              <FormLabel>
                                Track daily (recommended)
                              </FormLabel>
                            </div>
                          </FormItem>
                        )}
                      />
                      
                      <Button 
                        type="submit" 
                        className="w-full mt-2"
                        size="lg"
                        disabled={isSubmitting}
                      >
                        {isSubmitting ? (
                          <div className="flex items-center justify-center gap-2">
                            <Loader2 className="h-5 w-5 animate-spin" />
                            <span>Adding {uploadedKeywords.length} Keywords...</span>
                          </div>
                        ) : (
                          <>
                            <FileUp className="h-5 w-5 mr-2" />
                            {`Import ${uploadedKeywords.length} Keywords`}
                          </>
                        )}
                      </Button>
                    </form>
                  </Form>
                </div>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}