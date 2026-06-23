import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import SideNav from "@/components/dashboard/SideNav";
import TopBar from "@/components/dashboard/TopBar";
import { DataTable } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { Trash2, Edit, Plus } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import * as z from "zod";
import { Location } from "@shared/schema";

// Schema for location form
const locationFormSchema = z.object({
  name: z.string().min(1, "Location name is required"),
  code: z.string().min(1, "Location code is required"),
  dataForSEOLocationCode: z.string().optional(),
});

export default function ManageLocations() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [selectedLocation, setSelectedLocation] = useState<Location | null>(null);
  
  // Setup form for adding/editing locations
  const addForm = useForm<z.infer<typeof locationFormSchema>>({
    resolver: zodResolver(locationFormSchema),
    defaultValues: {
      name: "",
      code: "",
      dataForSEOLocationCode: "",
    },
  });

  const editForm = useForm<z.infer<typeof locationFormSchema>>({
    resolver: zodResolver(locationFormSchema),
    defaultValues: {
      name: "",
      code: "",
      dataForSEOLocationCode: "",
    },
  });
  
  // Fetch locations data
  const { data: locations, isLoading } = useQuery<Location[]>({
    queryKey: ["/api/locations"],
  });

  // Create mutation
  const createMutation = useMutation({
    mutationFn: async (locationData: z.infer<typeof locationFormSchema>) => {
      return apiRequest("POST", "/api/locations", locationData);
    },
    onSuccess: () => {
      toast({
        title: "Location Added",
        description: "The location has been added successfully",
      });
      
      setAddDialogOpen(false);
      addForm.reset();
      
      // Refresh data
      queryClient.invalidateQueries({ queryKey: ["/api/locations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
    },
    onError: (error) => {
      toast({
        title: "Error Adding Location",
        description: error instanceof Error ? error.message : "An unknown error occurred",
        variant: "destructive",
      });
    }
  });

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: async (data: { id: number, location: z.infer<typeof locationFormSchema> }) => {
      return apiRequest("PUT", `/api/locations/${data.id}`, data.location);
    },
    onSuccess: () => {
      toast({
        title: "Location Updated",
        description: "The location has been updated successfully",
      });
      
      setEditDialogOpen(false);
      setSelectedLocation(null);
      editForm.reset();
      
      // Refresh data
      queryClient.invalidateQueries({ queryKey: ["/api/locations"] });
    },
    onError: (error) => {
      toast({
        title: "Error Updating Location",
        description: error instanceof Error ? error.message : "An unknown error occurred",
        variant: "destructive",
      });
    }
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      return apiRequest("DELETE", `/api/locations/${id}`);
    },
    onSuccess: () => {
      toast({
        title: "Location Deleted",
        description: "The location has been deleted successfully",
      });
      
      setDeleteDialogOpen(false);
      setSelectedLocation(null);
      
      // Refresh data
      queryClient.invalidateQueries({ queryKey: ["/api/locations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
    },
    onError: (error) => {
      toast({
        title: "Error Deleting Location",
        description: error instanceof Error ? error.message : "An unknown error occurred",
        variant: "destructive",
      });
    }
  });

  // Handle actions
  const handleDelete = (location: Location) => {
    setSelectedLocation(location);
    setDeleteDialogOpen(true);
  };

  const handleEdit = (location: Location) => {
    setSelectedLocation(location);
    editForm.reset({
      name: location.name,
      code: location.code,
      dataForSEOLocationCode: location.dataForSEOLocationCode || "",
    });
    setEditDialogOpen(true);
  };

  const handleAdd = () => {
    addForm.reset();
    setAddDialogOpen(true);
  };

  // Confirm delete
  const confirmDelete = () => {
    if (selectedLocation) {
      deleteMutation.mutate(selectedLocation.id);
    }
  };

  // Submit forms
  const onAddSubmit = (values: z.infer<typeof locationFormSchema>) => {
    createMutation.mutate(values);
  };

  const onEditSubmit = (values: z.infer<typeof locationFormSchema>) => {
    if (selectedLocation) {
      updateMutation.mutate({
        id: selectedLocation.id,
        location: values
      });
    }
  };

  // Toggle mobile menu
  const toggleMobileMenu = () => {
    setShowMobileMenu(!showMobileMenu);
  };

  // Table columns
  const columns = [
    {
      header: "Location Name",
      accessorKey: "name",
      className: "px-4 py-3 text-sm"
    },
    {
      header: "Code",
      accessorKey: "code",
      className: "px-4 py-3 text-sm text-center"
    },
    {
      header: "DataForSEO Code",
      accessorKey: "dataForSEOLocationCode",
      className: "px-4 py-3 text-sm text-center"
    },
    {
      header: "Actions",
      id: "actions", // Use id instead of accessorKey for custom cell rendering
      cell: ({ row }: any) => (
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
        <TopBar title="Manage Locations" onMobileMenuToggle={toggleMobileMenu} />
        
        {/* Content Container */}
        <div className="flex-grow overflow-y-auto p-4 md:p-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Locations Table */}
            <div className="lg:col-span-2">
              <div className="bg-white rounded-lg shadow-sm overflow-hidden">
                <div className="flex items-center justify-between p-4 border-b border-neutral-200">
                  <h3 className="font-semibold">Location Settings</h3>
                  <Button onClick={handleAdd}>
                    <Plus className="mr-2 h-4 w-4" />
                    Add Location
                  </Button>
                </div>
                
                <div className="p-4">
                  {isLoading ? (
                    <Skeleton className="h-[400px] w-full" />
                  ) : (
                    <DataTable 
                      data={locations || []} 
                      columns={columns}
                      searchColumn="name" 
                      searchPlaceholder="Search locations..."
                    />
                  )}
                </div>
              </div>
            </div>
            
            {/* Location Info */}
            <div>
              <Card>
                <CardHeader>
                  <CardTitle>Location Information</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <p>Locations allow you to simulate searches from different geographic areas to track how your website ranks in different regions.</p>
                  
                  <div className="bg-neutral-100 p-4 rounded-md mt-4">
                    <h4 className="font-medium mb-2">Format Guidelines</h4>
                    <p className="text-sm mb-2">Format location codes as:</p>
                    <code className="bg-neutral-200 p-1 rounded text-sm">STATE,COUNTRY</code>
                    <p className="text-sm mt-2">Examples:</p>
                    <ul className="list-disc ml-5 text-sm">
                      <li>TX,US (Texas, United States)</li>
                      <li>FL,US (Florida, United States)</li>
                      <li>CA,US (California, United States)</li>
                      <li>ON,CA (Ontario, Canada)</li>
                      <li>LND,UK (London, United Kingdom)</li>
                    </ul>
                  </div>

                  <div className="bg-neutral-100 p-4 rounded-md">
                    <h4 className="font-medium mb-2">DataForSEO Location Codes</h4>
                    <p className="text-sm mb-2">Each location requires a specific DataForSEO location code for precise geographic targeting:</p>
                    <ul className="list-disc ml-5 text-sm">
                      <li>1014221 (San Francisco, CA)</li>
                      <li>1015180 (New York, NY)</li>
                      <li>1013695 (Los Angeles, CA)</li>
                      <li>1013581 (Houston, TX)</li>
                      <li>1012873 (Chicago, IL)</li>
                    </ul>
                  </div>
                  
                  <div className="bg-neutral-100 p-4 rounded-md">
                    <h4 className="font-medium mb-2">Usage Tips</h4>
                    <ul className="list-disc ml-5 text-sm space-y-1">
                      <li>Add locations where your target audience is located</li>
                      <li>Compare rankings across different regions</li>
                      <li>Identify opportunities in specific geographic markets</li>
                      <li>Focus optimization efforts where you need to improve</li>
                    </ul>
                  </div>
                </CardContent>
              </Card>
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
              Are you sure you want to delete the location "{selectedLocation?.name}"? This action cannot be undone.
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
      
      {/* Edit Location Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Location</DialogTitle>
            <DialogDescription>
              Update the details for this location.
            </DialogDescription>
          </DialogHeader>
          
          <Form {...editForm}>
            <form onSubmit={editForm.handleSubmit(onEditSubmit)} className="space-y-4">
              <FormField
                control={editForm.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Location Name</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="e.g. Houston" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              <FormField
                control={editForm.control}
                name="code"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Location Code</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="e.g. TX,US" />
                    </FormControl>
                    <FormDescription>
                      Format as STATE,COUNTRY (e.g. TX,US)
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              <FormField
                control={editForm.control}
                name="dataForSEOLocationCode"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>DataForSEO Location Code</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="e.g. 1014221" />
                    </FormControl>
                    <FormDescription>
                      DataForSEO specific location code (e.g. 1014221 for San Francisco)
                    </FormDescription>
                    <FormMessage />
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
      
      {/* Add Location Dialog */}
      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add New Location</DialogTitle>
            <DialogDescription>
              Enter the details for the new location you want to track.
            </DialogDescription>
          </DialogHeader>
          
          <Form {...addForm}>
            <form onSubmit={addForm.handleSubmit(onAddSubmit)} className="space-y-4">
              <FormField
                control={addForm.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Location Name</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="e.g. Houston" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              <FormField
                control={addForm.control}
                name="code"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Location Code</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="e.g. TX,US" />
                    </FormControl>
                    <FormDescription>
                      Format as STATE,COUNTRY (e.g. TX,US)
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              <FormField
                control={addForm.control}
                name="dataForSEOLocationCode"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>DataForSEO Location Code</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="e.g. 1014221" />
                    </FormControl>
                    <FormDescription>
                      DataForSEO specific location code (e.g. 1014221 for San Francisco)
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              <DialogFooter>
                <Button variant="outline" onClick={() => setAddDialogOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit">
                  Add Location
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
