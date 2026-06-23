import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import SideNav from "@/components/dashboard/SideNav";
import TopBar from "@/components/dashboard/TopBar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { RunCrawlerButton } from "@/components/dashboard/RunCrawlerButton";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import * as z from "zod";
import { AlertCircle, CheckCircle2, Clock } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

// Schema for schedule form
const scheduleFormSchema = z.object({
  frequency: z.string(),
  isActive: z.boolean().default(true),
});

export default function Schedule() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  // Fetch schedule data
  const { data: schedule, isLoading } = useQuery({
    queryKey: ["/api/schedule"],
  });

  // Setup form for schedule
  const form = useForm<z.infer<typeof scheduleFormSchema>>({
    resolver: zodResolver(scheduleFormSchema),
    defaultValues: {
      frequency: "daily",
      isActive: true,
    },
  });

  // Set form values when data is loaded
  useState(() => {
    if (schedule && !isLoading) {
      let frequency = "daily";
      
      if (schedule.cronExpression) {
        // Convert cron expression to frequency
        if (schedule.cronExpression === "0 4 * * *") frequency = "daily";
        else if (schedule.cronExpression === "0 4 * * 1") frequency = "weekly";
        else if (schedule.cronExpression === "0 4 1 * *") frequency = "monthly";
        else frequency = "custom";
      }
      
      form.reset({
        frequency,
        isActive: schedule.isActive,
      });
    }
  }, [schedule, isLoading, form]);

  // Update mutation
  const updateScheduleMutation = useMutation({
    mutationFn: async (data: z.infer<typeof scheduleFormSchema>) => {
      // Convert frequency to cron expression
      let cronExpression = "0 4 * * *"; // default: daily at 4am
      
      if (data.frequency === "weekly") {
        cronExpression = "0 4 * * 1"; // Monday at 4am
      } else if (data.frequency === "monthly") {
        cronExpression = "0 4 1 * *"; // 1st of month at 4am
      }
      
      // If we have an existing schedule, update it, otherwise create a new one
      if (schedule && schedule.id) {
        return apiRequest("PUT", `/api/schedule/${schedule.id}`, {
          cronExpression,
          isActive: data.isActive,
        });
      } else {
        return apiRequest("POST", "/api/schedule", {
          cronExpression,
          isActive: data.isActive,
        });
      }
    },
    onSuccess: () => {
      toast({
        title: "Schedule Updated",
        description: "The crawler schedule has been updated successfully",
      });
      
      // Refresh data
      queryClient.invalidateQueries({ queryKey: ["/api/schedule"] });
    },
    onError: (error) => {
      toast({
        title: "Error Updating Schedule",
        description: error instanceof Error ? error.message : "An unknown error occurred",
        variant: "destructive",
      });
    },
    onSettled: () => {
      setIsSubmitting(false);
    }
  });

  // Submit form
  const onSubmit = (values: z.infer<typeof scheduleFormSchema>) => {
    setIsSubmitting(true);
    updateScheduleMutation.mutate(values);
  };

  // Toggle mobile menu
  const toggleMobileMenu = () => {
    setShowMobileMenu(!showMobileMenu);
  };

  // Format the date for display
  const formatScheduleDate = (dateString?: string) => {
    if (!dateString) return "Not scheduled";
    
    const date = new Date(dateString);
    return date.toLocaleString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
  };

  // Status label based on active state
  const scheduleStatusContent = () => {
    if (!schedule) return null;
    
    if (schedule.isActive) {
      return (
        <Alert className="border-success bg-success/10">
          <CheckCircle2 className="h-4 w-4 text-success" />
          <AlertTitle className="text-success font-medium">Active</AlertTitle>
          <AlertDescription>
            The crawler is actively running on schedule
          </AlertDescription>
        </Alert>
      );
    } else {
      return (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Inactive</AlertTitle>
          <AlertDescription>
            Scheduled crawling is currently disabled
          </AlertDescription>
        </Alert>
      );
    }
  };

  return (
    <div className="bg-neutral-100 text-neutral-700 flex h-screen overflow-hidden">
      {/* Sidebar */}
      <SideNav />
      
      {/* Mobile Menu Overlay */}
      {showMobileMenu && (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-40 md:hidden" onClick={toggleMobileMenu}>
          <div className="h-full w-64 bg-white" onClick={e => e.stopPropagation()}>
            <SideNav />
          </div>
        </div>
      )}
      
      {/* Main Content */}
      <main className="flex-grow overflow-hidden flex flex-col h-screen">
        <TopBar title="Schedule Settings" onMobileMenuToggle={toggleMobileMenu} />
        
        {/* Content Container */}
        <div className="flex-grow overflow-y-auto p-4 md:p-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 max-w-4xl mx-auto">
            {/* Schedule Settings Card */}
            <Card>
              <CardHeader>
                <CardTitle>Crawler Schedule</CardTitle>
                <CardDescription>
                  Configure when the crawler should automatically run to check your keyword rankings
                </CardDescription>
              </CardHeader>
              
              <CardContent>
                {isLoading ? (
                  <div className="space-y-4">
                    <Skeleton className="h-8 w-full" />
                    <Skeleton className="h-8 w-full" />
                    <Skeleton className="h-10 w-40" />
                  </div>
                ) : (
                  <Form {...form}>
                    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                      <FormField
                        control={form.control}
                        name="frequency"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Crawl Frequency</FormLabel>
                            <Select 
                              onValueChange={field.onChange} 
                              defaultValue={field.value}
                            >
                              <FormControl>
                                <SelectTrigger>
                                  <SelectValue placeholder="Select frequency" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                <SelectItem value="daily">Daily (4:00 AM)</SelectItem>
                                <SelectItem value="weekly">Weekly (Monday, 4:00 AM)</SelectItem>
                                <SelectItem value="monthly">Monthly (1st, 4:00 AM)</SelectItem>
                              </SelectContent>
                            </Select>
                            <FormDescription>
                              Choose how often you want to check your keyword rankings
                            </FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      
                      <FormField
                        control={form.control}
                        name="isActive"
                        render={({ field }) => (
                          <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                            <div className="space-y-0.5">
                              <FormLabel className="text-base">
                                Enable Scheduled Crawling
                              </FormLabel>
                              <FormDescription>
                                When enabled, the crawler will run automatically based on the schedule
                              </FormDescription>
                            </div>
                            <FormControl>
                              <Switch
                                checked={field.value}
                                onCheckedChange={field.onChange}
                              />
                            </FormControl>
                          </FormItem>
                        )}
                      />
                      
                      <Button type="submit" disabled={isSubmitting}>
                        {isSubmitting ? "Saving..." : "Save Schedule"}
                      </Button>
                    </form>
                  </Form>
                )}
              </CardContent>
            </Card>
            
            {/* Schedule Status Card */}
            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>Schedule Status</CardTitle>
                  <CardDescription>
                    Current status of your scheduled crawls
                  </CardDescription>
                </CardHeader>
                
                <CardContent className="space-y-4">
                  {isLoading ? (
                    <div className="space-y-4">
                      <Skeleton className="h-20 w-full" />
                      <Skeleton className="h-12 w-full" />
                      <Skeleton className="h-12 w-full" />
                    </div>
                  ) : (
                    <>
                      {scheduleStatusContent()}
                      
                      <div className="border rounded-lg p-4">
                        <div className="flex items-start space-x-3">
                          <Clock className="h-5 w-5 text-primary mt-0.5" />
                          <div>
                            <h4 className="font-medium text-sm">Last Crawl</h4>
                            <p className="text-sm text-neutral-600">
                              {formatScheduleDate(schedule?.lastRun)}
                            </p>
                          </div>
                        </div>
                      </div>
                      
                      <div className="border rounded-lg p-4">
                        <div className="flex items-start space-x-3">
                          <Clock className="h-5 w-5 text-accent mt-0.5" />
                          <div>
                            <h4 className="font-medium text-sm">Next Scheduled Crawl</h4>
                            <p className="text-sm text-neutral-600">
                              {schedule?.isActive 
                                ? formatScheduleDate(schedule?.nextRun)
                                : "Scheduled crawling is disabled"}
                            </p>
                          </div>
                        </div>
                      </div>

                      <div className="mt-4">
                        <h4 className="font-medium text-sm mb-2">Run Crawler Manually</h4>
                        <RunCrawlerButton />
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>
              
              <Card>
                <CardHeader>
                  <CardTitle>Schedule Tips</CardTitle>
                </CardHeader>
                
                <CardContent>
                  <ul className="space-y-2">
                    <li className="flex items-start space-x-2">
                      <CheckCircle2 className="h-5 w-5 text-success shrink-0 mt-0.5" />
                      <span className="text-sm">Daily crawls are recommended for the most accurate tracking</span>
                    </li>
                    <li className="flex items-start space-x-2">
                      <CheckCircle2 className="h-5 w-5 text-success shrink-0 mt-0.5" />
                      <span className="text-sm">Crawls run at 4:00 AM server time to get the most accurate results</span>
                    </li>
                    <li className="flex items-start space-x-2">
                      <CheckCircle2 className="h-5 w-5 text-success shrink-0 mt-0.5" />
                      <span className="text-sm">You can also trigger a manual crawl anytime from the sidebar</span>
                    </li>
                    <li className="flex items-start space-x-2">
                      <CheckCircle2 className="h-5 w-5 text-success shrink-0 mt-0.5" />
                      <span className="text-sm">Results from each crawl are saved for historical comparison</span>
                    </li>
                  </ul>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
