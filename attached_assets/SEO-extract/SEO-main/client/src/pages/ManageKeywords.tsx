import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import SideNav from "@/components/dashboard/SideNav";
import TopBar from "@/components/dashboard/TopBar";
import { DataTable } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { LocationSelect } from "@/components/ui/location-select";
import { Trash2, Edit, ExternalLink, MapPin, Users, Loader2, FileUp } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
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
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import * as z from "zod";
import AddKeywordForm from "@/components/dashboard/AddKeywordForm";

// Schema for edit form
const keywordFormSchema = z.object({
  keyword: z.string().min(1, "Keyword is required"),
  targetUrl: z.string().optional(),
  locationId: z.number().nullable(),
  group: z.string().optional(),
  trackDaily: z.boolean().default(true),
});

export default function ManageKeywords() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const [selectedLocationId, setSelectedLocationId] = useState<number | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [bulkEditDialogOpen, setBulkEditDialogOpen] = useState(false);
  const [deleteAllDialogOpen, setDeleteAllDialogOpen] = useState(false);
  const [selectedKeyword, setSelectedKeyword] = useState<any>(null);
  const [isDeleteAllLoading, setIsDeleteAllLoading] = useState(false);
  
  // Multi-select state
  const [selectedKeywords, setSelectedKeywords] = useState<any[]>([]);
  const [isBulkUpdating, setIsBulkUpdating] = useState(false);
  
  // Current table page state
  const [currentPage, setCurrentPage] = useState(0);
  
  // Setup form for editing keywords
  const form = useForm<z.infer<typeof keywordFormSchema>>({
    resolver: zodResolver(keywordFormSchema),
    defaultValues: {
      keyword: "",
      targetUrl: "",
      locationId: null,
      group: "",
      trackDaily: true,
    },
  });
  
  // Fetch keywords data
  const { data: keywords, isLoading } = useQuery({
    queryKey: ["/api/keywords"],
  });
  
  // Fetch keyword groups
  const { data: keywordGroups = [] } = useQuery({
    queryKey: ["/api/keyword-groups"],
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      return apiRequest("DELETE", `/api/keywords/${id}`);
    },
    onSuccess: () => {
      toast({
        title: "Keyword Deleted",
        description: "The keyword has been deleted successfully",
      });
      
      setDeleteDialogOpen(false);
      setSelectedKeyword(null);
      
      // Refresh data
      queryClient.invalidateQueries({ queryKey: ["/api/keywords"] });
      queryClient.invalidateQueries({ queryKey: ["/api/keywords/rankings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
    },
    onError: (error) => {
      toast({
        title: "Error Deleting Keyword",
        description: error instanceof Error ? error.message : "An unknown error occurred",
        variant: "destructive",
      });
    }
  });

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: async (data: { id: number, keyword: z.infer<typeof keywordFormSchema> }) => {
      return apiRequest("PUT", `/api/keywords/${data.id}`, data.keyword);
    },
    onSuccess: (_, variables) => {
      toast({
        title: "Keyword Updated",
        description: "The keyword has been updated successfully",
      });
      
      setEditDialogOpen(false);
      setSelectedKeyword(null);
      form.reset();
      
      // Keep track of the updated keyword ID
      const updatedKeywordId = variables.id;
      
      // Refresh data with optimistic update
      queryClient.setQueryData(["/api/keywords"], (oldData: any) => {
        if (!oldData) return oldData;
        
        // Map through the data and update only the specific keyword
        return oldData.map((kw: any) => {
          if (kw.id === updatedKeywordId) {
            return {
              ...kw,
              ...variables.keyword,
            };
          }
          return kw;
        });
      });
      
      // Refresh related data
      queryClient.invalidateQueries({ queryKey: ["/api/keywords/rankings"] });
    },
    onError: (error) => {
      toast({
        title: "Error Updating Keyword",
        description: error instanceof Error ? error.message : "An unknown error occurred",
        variant: "destructive",
      });
      
      // On error, invalidate to get fresh data
      queryClient.invalidateQueries({ queryKey: ["/api/keywords"] });
    }
  });
  
  // Quick location update mutation
  const locationUpdateMutation = useMutation({
    mutationFn: async (data: { keywordId: number, locationId: number | null }) => {
      return apiRequest("PUT", `/api/keywords/${data.keywordId}`, { locationId: data.locationId });
    },
    onSuccess: (_, variables) => {
      const keywordData = keywords?.find((k: any) => k.id === variables.keywordId);
      const keywordName = keywordData?.keyword || "Keyword";
      
      toast({
        title: "Location Updated",
        description: `The location for "${keywordName}" has been updated successfully`,
      });
      
      // Keep track of the updated keyword ID
      const updatedKeywordId = variables.keywordId;
      
      // Refresh data with optimistic update
      queryClient.setQueryData(["/api/keywords"], (oldData: any) => {
        if (!oldData) return oldData;
        
        // Map through the data and update only the specific keyword
        return oldData.map((kw: any) => {
          if (kw.id === updatedKeywordId) {
            return {
              ...kw,
              locationId: variables.locationId,
            };
          }
          return kw;
        });
      });
      
      // Refresh related data
      queryClient.invalidateQueries({ queryKey: ["/api/keywords/rankings"] });
    },
    onError: (error) => {
      toast({
        title: "Error Updating Location",
        description: error instanceof Error ? error.message : "An unknown error occurred",
        variant: "destructive",
      });
      
      // On error, invalidate to get fresh data
      queryClient.invalidateQueries({ queryKey: ["/api/keywords"] });
    }
  });

  // Handle delete action
  const handleDelete = (keyword: any) => {
    setSelectedKeyword(keyword);
    setDeleteDialogOpen(true);
  };

  // Handle edit action
  const handleEdit = (keyword: any) => {
    setSelectedKeyword(keyword);
    form.reset({
      keyword: keyword.keyword,
      targetUrl: keyword.targetUrl || "",
      locationId: keyword.locationId,
      group: keyword.group || "No Group",
      trackDaily: keyword.trackDaily,
    });
    setEditDialogOpen(true);
  };

  // Confirm delete
  const confirmDelete = () => {
    if (selectedKeyword) {
      deleteMutation.mutate(selectedKeyword.id);
    }
  };

  // Submit edit form
  const onSubmit = (values: z.infer<typeof keywordFormSchema>) => {
    if (selectedKeyword) {
      updateMutation.mutate({
        id: selectedKeyword.id,
        keyword: values
      });
    }
  };

  // Delete All Keywords mutation
  const deleteAllMutation = useMutation({
    mutationFn: () => {
      setIsDeleteAllLoading(true);
      return apiRequest("DELETE", "/api/keywords");
    },
    onSuccess: (response) => {
      const count = response?.count || 0;
      toast({
        title: "All Keywords Deleted",
        description: `Successfully deleted ${count} keywords`,
      });
      
      setDeleteAllDialogOpen(false);
      
      // Refresh data
      queryClient.invalidateQueries({ queryKey: ["/api/keywords"] });
      queryClient.invalidateQueries({ queryKey: ["/api/keywords/rankings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
    },
    onError: (error) => {
      toast({
        title: "Error Deleting Keywords",
        description: error instanceof Error ? error.message : "An unknown error occurred",
        variant: "destructive",
      });
    },
    onSettled: () => {
      setIsDeleteAllLoading(false);
    }
  });

  // Confirm delete all keywords
  const confirmDeleteAll = () => {
    deleteAllMutation.mutate();
  };

  // Toggle mobile menu
  const toggleMobileMenu = () => {
    setShowMobileMenu(!showMobileMenu);
  };

  // Filter by location if selected
  const filteredKeywords = selectedLocationId && keywords
    ? keywords.filter((k: any) => k.locationId === selectedLocationId)
    : keywords;

  // Bulk update mutation
  const bulkUpdateMutation = useMutation({
    mutationFn: async (data: { keywordIds: number[], updateData: { group: string } }) => {
      // In a real API, we would have a bulk update endpoint
      // For now, we'll make multiple requests
      const promises = data.keywordIds.map(id => 
        apiRequest("PUT", `/api/keywords/${id}`, { group: data.updateData.group })
      );
      return Promise.all(promises);
    },
    onSuccess: (_, variables) => {
      toast({
        title: "Keywords Updated",
        description: `${selectedKeywords.length} keywords have been updated successfully`,
      });
      
      setBulkEditDialogOpen(false);
      setSelectedKeywords([]);
      setIsBulkUpdating(false);
      
      // Optimistic update for bulk edit
      queryClient.setQueryData(["/api/keywords"], (oldData: any) => {
        if (!oldData) return oldData;
        
        // Map through data and update all selected keywords
        return oldData.map((kw: any) => {
          if (variables.keywordIds.includes(kw.id)) {
            return {
              ...kw,
              group: variables.updateData.group === "No Group" ? null : variables.updateData.group,
            };
          }
          return kw;
        });
      });
      
      // Refresh related data
      queryClient.invalidateQueries({ queryKey: ["/api/keywords/rankings"] });
    },
    onError: (error) => {
      toast({
        title: "Error Updating Keywords",
        description: error instanceof Error ? error.message : "An unknown error occurred",
        variant: "destructive",
      });
      setIsBulkUpdating(false);
      
      // On error, invalidate to get fresh data
      queryClient.invalidateQueries({ queryKey: ["/api/keywords"] });
    }
  });

  // Handle bulk edit action
  const handleBulkEdit = () => {
    if (selectedKeywords.length === 0) {
      toast({
        title: "No Keywords Selected",
        description: "Please select at least one keyword to update",
        variant: "destructive",
      });
      return;
    }
    setBulkEditDialogOpen(true);
  };

  // Perform bulk update
  const performBulkUpdate = (groupId: string) => {
    setIsBulkUpdating(true);
    
    const keywordIds = selectedKeywords.map(kw => kw.id);
    
    bulkUpdateMutation.mutate({
      keywordIds,
      updateData: { group: groupId === "No Group" ? null : groupId }
    });
  };

  // Toggle keyword selection
  const toggleKeywordSelection = (keyword: any) => {
    if (selectedKeywords.some(k => k.id === keyword.id)) {
      setSelectedKeywords(prev => prev.filter(k => k.id !== keyword.id));
    } else {
      setSelectedKeywords(prev => [...prev, keyword]);
    }
  };

  // Table columns
  const columns = [
    {
      id: "select",
      header: ({ table }: any) => (
        <Checkbox
          checked={table.getIsAllPageRowsSelected()}
          onCheckedChange={(value) => {
            table.toggleAllPageRowsSelected(!!value);
            const filteredData = table.getFilteredRowModel().rows;
            if (value) {
              const allPageRows = filteredData.map(row => row.original);
              setSelectedKeywords(allPageRows);
            } else {
              setSelectedKeywords([]);
            }
          }}
        />
      ),
      cell: ({ row }: any) => (
        <Checkbox
          checked={selectedKeywords.some(kw => kw.id === row.original.id)}
          onCheckedChange={() => toggleKeywordSelection(row.original)}
        />
      ),
      className: "px-4 py-3 text-sm w-[40px]"
    },
    {
      header: "Keyword",
      accessorKey: "keyword",
      className: "px-4 py-3 text-sm"
    },
    {
      header: "Target URL",
      id: "targetUrl",
      cell: ({ row }) => (
        <div className="flex items-center">
          <a 
            href={`https://${row.original.targetUrl || "tekrevol.com"}`} 
            target="_blank" 
            rel="noopener noreferrer"
            className="text-primary hover:underline truncate block max-w-[200px] mr-2"
          >
            {row.original.targetUrl || "tekrevol.com"}
          </a>
          <ExternalLink size={16} className="text-neutral-400" />
        </div>
      ),
      className: "px-4 py-3 text-sm"
    },
    {
      header: "Location",
      accessorKey: "locationId",
      cell: ({ row }) => {
        // Fetch locations data
        const { data: locations } = useQuery({
          queryKey: ["/api/locations"],
        });
        
        const locationId = row.original.locationId;
        const location = locations?.find((loc: any) => loc.id === locationId);
        
        // Function to handle location change directly from the table
        const handleLocationChange = (newLocationId: number | null) => {
          locationUpdateMutation.mutate({
            keywordId: row.original.id,
            locationId: newLocationId
          });
        };
        
        return (
          <div className="flex items-center justify-center">
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="ghost" className="flex items-center gap-1 px-2 hover:bg-neutral-100">
                  <span>{location ? location.name : "All Locations"}</span>
                  <MapPin size={14} className="text-neutral-400 ml-1" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-56 p-2">
                <div className="space-y-2">
                  <h4 className="text-sm font-medium py-1">Change Location</h4>
                  <LocationSelect
                    value={locationId}
                    onChange={handleLocationChange}
                    placeholder="Select location"
                  />
                </div>
              </PopoverContent>
            </Popover>
          </div>
        );
      },
      className: "px-4 py-3 text-sm"
    },
    {
      header: "Group",
      accessorKey: "group",
      cell: ({ row }) => <span>{row.original.group || "No Group"}</span>,
      className: "px-4 py-3 text-sm text-center"
    },
    {
      header: "Daily Tracking",
      accessorKey: "trackDaily",
      cell: ({ row }) => (
        <span className={row.original.trackDaily ? "text-success" : "text-neutral-500"}>
          {row.original.trackDaily ? "Enabled" : "Disabled"}
        </span>
      ),
      className: "px-4 py-3 text-sm text-center"
    },
    {
      header: "Actions",
      id: "actions",
      cell: ({ row }) => (
        <div className="flex justify-center space-x-2">
          <Button 
            variant="outline" 
            size="sm"
            onClick={() => handleEdit(row.original)}
          >
            <Edit size={16} />
          </Button>
          <Button 
            variant="outline" 
            size="sm"
            onClick={() => handleDelete(row.original)}
          >
            <Trash2 size={16} className="text-error" />
          </Button>
        </div>
      ),
      className: "px-4 py-3 text-sm text-center"
    }
  ];

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
        <TopBar title="Manage Keywords" onMobileMenuToggle={toggleMobileMenu} />
        
        {/* Content Container */}
        <div className="flex-grow overflow-y-auto p-4 md:p-6">
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
            {/* Keywords Table */}
            <div className="lg:col-span-3">
              <div className="bg-white rounded-lg shadow-sm overflow-hidden">
                <div className="flex items-center justify-between p-4 border-b border-neutral-200">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold">All Keywords</h3>
                    {selectedKeywords.length > 0 && (
                      <Badge variant="secondary" className="ml-2">
                        {selectedKeywords.length} selected
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {selectedKeywords.length > 0 && (
                      <Button 
                        size="sm" 
                        variant="outline" 
                        className="flex items-center gap-1"
                        onClick={handleBulkEdit}
                      >
                        <Users size={14} />
                        Assign to Group
                      </Button>
                    )}
                    <Dialog open={deleteAllDialogOpen} onOpenChange={setDeleteAllDialogOpen}>
                      <DialogTrigger asChild>
                        <Button 
                          size="sm" 
                          variant="destructive"
                          className="flex items-center gap-1 mr-2"
                        >
                          <Trash2 size={14} />
                          Delete All
                        </Button>
                      </DialogTrigger>
                      <DialogContent>
                        <DialogHeader>
                          <DialogTitle>Delete All Keywords</DialogTitle>
                          <DialogDescription>
                            Are you sure you want to delete all keywords? This action cannot be undone.
                          </DialogDescription>
                        </DialogHeader>
                        <DialogFooter>
                          <Button variant="outline" onClick={() => setDeleteAllDialogOpen(false)}>
                            Cancel
                          </Button>
                          <Button 
                            variant="destructive" 
                            onClick={confirmDeleteAll}
                            disabled={isDeleteAllLoading}
                          >
                            {isDeleteAllLoading ? (
                              <div className="flex items-center justify-center gap-2">
                                <Loader2 className="h-4 w-4 animate-spin" />
                                <span>Deleting...</span>
                              </div>
                            ) : (
                              "Delete All"
                            )}
                          </Button>
                        </DialogFooter>
                      </DialogContent>
                    </Dialog>
                    <div className="w-48">
                      <LocationSelect
                        value={selectedLocationId}
                        onChange={setSelectedLocationId}
                        placeholder="Filter by location"
                      />
                    </div>
                  </div>
                </div>
                
                <div className="p-4">
                  {isLoading ? (
                    <Skeleton className="h-[400px] w-full" />
                  ) : (
                    <DataTable 
                      data={filteredKeywords || []} 
                      columns={columns}
                      searchColumn="keyword"
                      searchPlaceholder="Search keywords..."
                      initialPageIndex={currentPage}
                      onPageChange={(page) => setCurrentPage(page)}
                    />
                  )}
                </div>
              </div>
            </div>
            
            {/* Add Keyword Form */}
            <div>
              <AddKeywordForm />
            </div>
          </div>
        </div>
      </main>
      
      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Deletion</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete the keyword "{selectedKeyword?.keyword}"? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmDelete}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      {/* Edit Keyword Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Keyword</DialogTitle>
            <DialogDescription>
              Update the details for this keyword tracking.
            </DialogDescription>
          </DialogHeader>
          
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="keyword"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Keyword</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
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
                      <Input {...field} />
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
                        <SelectItem value="Services">Services</SelectItem>
                        <SelectItem value="Products">Products</SelectItem>
                        <SelectItem value="Blog">Blog</SelectItem>
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
                  <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md">
                    <FormControl>
                      <Checkbox
                        checked={field.value}
                        onCheckedChange={field.onChange}
                      />
                    </FormControl>
                    <div className="space-y-1 leading-none">
                      <FormLabel>
                        Track daily
                      </FormLabel>
                    </div>
                  </FormItem>
                )}
              />
              
              <DialogFooter>
                <Button variant="outline" onClick={() => setEditDialogOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit">
                  Save Changes
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Bulk Edit Dialog */}
      <Dialog open={bulkEditDialogOpen} onOpenChange={setBulkEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Update Multiple Keywords</DialogTitle>
            <DialogDescription>
              Assign {selectedKeywords.length} keywords to a group.
            </DialogDescription>
          </DialogHeader>
          
          <div className="py-4">
            <div className="mb-4">
              <h4 className="text-sm font-medium mb-2">Selected Keywords</h4>
              <div className="bg-neutral-50 p-3 rounded-md max-h-[150px] overflow-y-auto">
                <div className="flex flex-wrap gap-1">
                  {selectedKeywords.map(kw => (
                    <Badge key={kw.id} variant="outline" className="mb-1">
                      {kw.keyword}
                    </Badge>
                  ))}
                </div>
              </div>
            </div>
            
            <div className="space-y-4">
              <div>
                <Label htmlFor="group">Select Group</Label>
                <Select onValueChange={performBulkUpdate} defaultValue="No Group">
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select a group" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="No Group">No Group</SelectItem>
                    {/* Fetch groups from API */}
                    {keywordGroups?.map((group: any) => (
                      <SelectItem key={group.id} value={group.id.toString()}>
                        {group.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkEditDialogOpen(false)}>
              Cancel
            </Button>
            <Button disabled={isBulkUpdating}>
              {isBulkUpdating ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Updating...
                </>
              ) : (
                "Update Keywords"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
