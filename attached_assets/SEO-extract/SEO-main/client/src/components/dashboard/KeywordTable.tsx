import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { format } from "date-fns";
import { ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";

interface KeywordRanking {
  id: number;
  keyword: string;
  targetUrl: string | null;
  group: string | null;
  location: string;
  locationId: number;
  trackDaily: boolean;
  createdAt: string;
  change: number;
  latestRanking: {
    id: number;
    keywordId: number;
    position: number;
    previousPosition: number | null;
    positionChange: number | null;
    url: string | null;
    date: string;
    isScheduled: boolean;
  };
}

export default function KeywordTable() {
  const [resultType] = useState<string>("organic"); // Always use organic results
  
  const { data: rankings, isLoading } = useQuery<KeywordRanking[]>({
    queryKey: ['/api/keywords/rankings', resultType],
    queryFn: async () => {
      const response = await fetch(`/api/keywords/rankings?resultType=${resultType}`);
      if (!response.ok) {
        throw new Error('Failed to fetch keyword rankings');
      }
      return response.json();
    },
  });

  // Format position display
  const formatPosition = (position: number) => {
    if (position === 999 || position === 0) {
      return <span className="flex items-center"><Badge variant="outline" className="mr-1">Not Ranked</Badge></span>;
    }
    if (position <= 10) {
      return <span className="flex items-center"><Badge className="bg-green-500 mr-1">#{position}</Badge> 🎉</span>;
    }
    if (position <= 20) {
      return <span className="flex items-center"><Badge className="bg-yellow-500 mr-1">#{position}</Badge></span>;
    }
    return <span className="flex items-center"><Badge className="bg-red-500 mr-1">#{position}</Badge></span>;
  };
  
  // Format position change
  const formatPositionChange = (change: number | null) => {
    if (change === null || change === 0) {
      return <span className="text-muted-foreground">-</span>;
    }
    if (change > 0) {
      return <span className="text-green-500 flex items-center">↑ {change}</span>;
    }
    return <span className="text-red-500 flex items-center">↓ {Math.abs(change)}</span>;
  };

  // Define columns for the data table
  const columns: ColumnDef<KeywordRanking>[] = [
    {
      accessorKey: "keyword",
      header: "Keyword",
      cell: ({ row }) => <span className="font-medium">{row.original.keyword}</span>
    },
    {
      accessorKey: "targetUrl",
      header: "Target",
      cell: ({ row }) => (
        <span className="text-muted-foreground truncate max-w-[200px]">
          {row.original.targetUrl || "-"}
        </span>
      )
    },
    {
      accessorKey: "group",
      header: "Group",
      cell: ({ row }) => <span>{row.original.group || "-"}</span>
    },
    {
      id: "position", // Provide an explicit id for the column
      header: "Position",
      // Simply don't use accessorKey for these columns that access nested properties
      cell: ({ row }) => (
        <span className="text-center">
          {formatPosition(row.original.latestRanking?.position || 0)}
        </span>
      )
    },
    {
      id: "change", // Provide an explicit id for the column
      header: "Change",
      cell: ({ row }) => (
        <span className="text-center">
          {formatPositionChange(row.original.latestRanking?.positionChange)}
        </span>
      )
    },
    {
      id: "date", // Provide an explicit id for the column
      header: "Last Checked",
      // Simply don't use accessorKey for these columns that access nested properties
      cell: ({ row }) => {
        try {
          return (
            <span>
              {row.original.latestRanking?.date ? 
                format(new Date(row.original.latestRanking.date), 'MMM d, yyyy') : 
                '-'}
            </span>
          );
        } catch (error) {
          console.error("Date formatting error:", error);
          return <span>Invalid date</span>;
        }
      }
    }
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent Rankings</CardTitle>
        <CardDescription>
          Current keyword positions in Google search results
        </CardDescription>
      </CardHeader>
      <CardContent className="max-h-[600px] overflow-auto">
        {isLoading ? (
          <div className="flex justify-center items-center h-64">
            <div className="text-lg">Loading rankings data...</div>
          </div>
        ) : (
          <DataTable 
            data={rankings || []}
            columns={columns}
            searchColumn="keyword"
            searchPlaceholder="Filter by keyword..."
          />
        )}
      </CardContent>
    </Card>
  );
}