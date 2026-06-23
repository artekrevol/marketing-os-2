import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import {
  Form,
  FormControl,
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Plus, Folder, FolderTree, Edit, Trash } from "lucide-react";

// Form schema for creating/editing keyword groups
const formSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  description: z.string().optional(),
  parentId: z.number().nullable(),
});

interface KeywordGroup {
  id: number;
  name: string;
  description: string | null;
  parentId: number | null;
  createdAt: string;
  updatedAt: string;
}

export default function KeywordGroups() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  // State for managing dialog and form
  const [open, setOpen] = useState(false);
  const [selectedParent, setSelectedParent] = useState<number | null>(null);
  const [editingGroup, setEditingGroup] = useState<KeywordGroup | null>(null);
  
  // Form setup
  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      description: "",
      parentId: null,
    },
  });

  // Reset form when dialog opens/closes
  useEffect(() => {
    if (!open) {
      form.reset();
      setEditingGroup(null);
    }
  }, [open, form]);

  // Set form values when editing a group
  useEffect(() => {
    if (editingGroup) {
      form.setValue("name", editingGroup.name);
      form.setValue("description", editingGroup.description || "");
      form.setValue("parentId", editingGroup.parentId);
      setOpen(true);
    }
  }, [editingGroup, form]);

  // Fetch keyword groups
  const { data: keywordGroups = [] } = useQuery<KeywordGroup[]>({
    queryKey: ["keywordGroups"],
    queryFn: async () => {
      const response = await fetch("/api/keyword-groups");
      if (!response.ok) throw new Error("Failed to fetch keyword groups");
      return response.json();
    }
  });

  // Create mutation for adding a new keyword group
  const createMutation = useMutation({
    mutationFn: async (values: z.infer<typeof formSchema>) => {
      const res = await apiRequest("POST", "/api/keyword-groups", values);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["keywordGroups"] });
      toast({
        title: "Success",
        description: "Keyword group created successfully",
        variant: "default",
      });
      setOpen(false);
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: `Failed to create keyword group: ${error.toString()}`,
        variant: "destructive",
      });
    },
  });

  // Update mutation for editing an existing keyword group
  const updateMutation = useMutation({
    mutationFn: async ({ id, values }: { id: number; values: z.infer<typeof formSchema> }) => {
      const res = await apiRequest("PUT", `/api/keyword-groups/${id}`, values);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["keywordGroups"] });
      toast({
        title: "Success",
        description: "Keyword group updated successfully",
        variant: "default",
      });
      setOpen(false);
      setEditingGroup(null);
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: `Failed to update keyword group: ${error.toString()}`,
        variant: "destructive",
      });
    },
  });

  // Delete mutation for removing a keyword group
  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("DELETE", `/api/keyword-groups/${id}`);
      return res;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["keywordGroups"] });
      toast({
        title: "Success",
        description: "Keyword group deleted successfully",
        variant: "default",
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: `Failed to delete keyword group: ${error.toString()}`,
        variant: "destructive",
      });
    },
  });

  // Helper function to get root-level groups
  const getRootGroups = () => {
    return keywordGroups.filter((group: KeywordGroup) => group.parentId === null);
  };

  // Helper function to get subgroups of a parent
  const getSubgroups = (parentId: number) => {
    return keywordGroups.filter((group: KeywordGroup) => group.parentId === parentId);
  };

  // Submit handler for the form
  const onSubmit = (values: z.infer<typeof formSchema>) => {
    if (editingGroup) {
      updateMutation.mutate({ id: editingGroup.id, values });
    } else {
      createMutation.mutate(values);
    }
  };

  // Handle editing a group
  const handleEditGroup = (group: KeywordGroup) => {
    setEditingGroup(group);
  };

  // Handle deleting a group
  const handleDeleteGroup = (id: number) => {
    if (confirm("Are you sure you want to delete this keyword group? All keywords in this group will be orphaned.")) {
      deleteMutation.mutate(id);
    }
  };

  // Helper function to check if a group has subgroups
  const hasSubgroups = (id: number) => {
    return keywordGroups.some((group: KeywordGroup) => group.parentId === id);
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Keyword Groups</h1>
          <p className="text-muted-foreground">
            Organize your keywords into logical groups and subgroups.
          </p>
        </div>
        <Button onClick={() => setOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Add Group
        </Button>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>{editingGroup ? "Edit Group" : "Create New Group"}</DialogTitle>
            <DialogDescription>
              {editingGroup 
                ? "Update the details of this keyword group." 
                : "Create a new group to organize your keywords."}
            </DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Group Name</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="e.g., Local Keywords" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Description</FormLabel>
                    <FormControl>
                      <Textarea 
                        {...field} 
                        placeholder="Optional description for this group"
                        value={field.value || ""}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="parentId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Parent Group (Optional)</FormLabel>
                    <Select
                      onValueChange={(value) => {
                        field.onChange(value === "none" ? null : parseInt(value));
                      }}
                      value={field.value?.toString() || "none"}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select a parent group (optional)" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="none">None (Root Level)</SelectItem>
                        {keywordGroups
                          .filter((g: KeywordGroup) => !editingGroup || g.id !== editingGroup.id)
                          .map((group: KeywordGroup) => (
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
              <DialogFooter>
                <Button 
                  type="button" 
                  variant="outline" 
                  onClick={() => setOpen(false)}
                >
                  Cancel
                </Button>
                <Button 
                  type="submit"
                  disabled={createMutation.isPending || updateMutation.isPending}
                >
                  {createMutation.isPending || updateMutation.isPending ? "Saving..." : "Save"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {getRootGroups().map((group: KeywordGroup) => (
          <Card key={group.id} className="overflow-hidden">
            <CardHeader className="pb-2">
              <div className="flex justify-between items-start">
                <div className="flex items-center">
                  <FolderTree className="h-5 w-5 mr-2 text-primary" />
                  <CardTitle>{group.name}</CardTitle>
                </div>
                <div className="flex space-x-1">
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    onClick={() => handleEditGroup(group)}
                  >
                    <Edit className="h-4 w-4" />
                  </Button>
                  <Button 
                    variant="ghost" 
                    size="icon"
                    onClick={() => handleDeleteGroup(group.id)}
                  >
                    <Trash className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              {group.description && (
                <CardDescription>{group.description}</CardDescription>
              )}
            </CardHeader>
            <CardContent>
              {hasSubgroups(group.id) ? (
                <div className="space-y-3">
                  <div className="text-sm font-medium">Subgroups:</div>
                  <div className="flex flex-wrap gap-2">
                    {getSubgroups(group.id).map((subgroup: KeywordGroup) => (
                      <Button 
                        key={subgroup.id} 
                        variant="outline" 
                        size="sm"
                        className="flex items-center"
                        onClick={() => handleEditGroup(subgroup)}
                      >
                        <Folder className="h-3 w-3 mr-1" />
                        {subgroup.name}
                      </Button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="py-2 text-sm text-muted-foreground">
                  No subgroups. Click "Add Group" to create one.
                </div>
              )}
            </CardContent>
            <CardFooter className="flex justify-end bg-muted/40 pt-2">
              <Button 
                variant="outline" 
                size="sm"
                onClick={() => {
                  setSelectedParent(group.id);
                  form.setValue("parentId", group.id);
                  setOpen(true);
                }}
              >
                <Plus className="h-3 w-3 mr-1" />
                Add Subgroup
              </Button>
            </CardFooter>
          </Card>
        ))}
      </div>
    </div>
  );
}