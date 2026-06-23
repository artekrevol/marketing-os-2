import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { format } from "date-fns";
import { ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { ArrowUp, ArrowDown, Minus } from "lucide-react";

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

export default function RankChangesTable() {
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

  // Filter only keywords with position changes
  const keywordsWithChanges = rankings?.filter(
    keyword => keyword.latestRanking?.positionChange !== null && 
    keyword.latestRanking?.positionChange !== 0
  ) || [];

  // Sort by the magnitude of change (either positive or negative)
  const sortedByChangeImpact = [...keywordsWithChanges].sort((a, b) => {
    const aChange = a.latestRanking?.positionChange || 0;
    const bChange = b.latestRanking?.positionChange || 0;
    return Math.abs(bChange) - Math.abs(aChange);
  });
  
  // Format position display
  const formatPosition = (position: number) => {
    if (position === 999 || position === 0) {
      return <span className="flex items-center"><Badge variant="outline" className="mr-1">Not Ranked</Badge></span>;
    }
    if (position <= 10) {
      return <span className="flex items-center"><Badge className="bg-green-500 mr-1">#{position}</Badge></span>;
    }
    if (position <= 20) {
      return <span className="flex items-center"><Badge className="bg-yellow-500 mr-1">#{position}</Badge></span>;
    }
    return <span className="flex items-center"><Badge className="bg-red-500 mr-1">#{position}</Badge></span>;
  };
  
  // Format position change with better visuals
  const formatPositionChange = (change: number | null) => {
    if (change === null || change === 0) {
      return <span className="text-muted-foreground flex items-center"><Minus size={16} className="mr-1" /> No change</span>;
    }
    if (change > 0) {
      return (
        <span className="text-green-500 flex items-center">
          <ArrowUp size={16} className="mr-1" />
          <Badge variant="outline" className="border-green-500 text-green-500">
            +{change} positions
          </Badge>
        </span>
      );
    }
    return (
      <span className="text-red-500 flex items-center">
        <ArrowDown size={16} className="mr-1" />
        <Badge variant="outline" className="border-red-500 text-red-500">
          -{Math.abs(change)} positions
        </Badge>
      </span>
    );
  };

  // Define columns for the data table
  const columns: ColumnDef<KeywordRanking>[] = [
    {
      accessorKey: "keyword",
      header: "Keyword",
      cell: ({ row }) => <span className="font-medium">{row.original.keyword}</span>
    },
    {
      accessorKey: "location",
      header: "Location",
      cell: ({ row }) => <span>{row.original.location}</span>
    },
    {
      id: "previousPosition",
      header: "Previous Position",
      cell: ({ row }) => {
        const previousPos = row.original.latestRanking?.previousPosition !== null
          ? row.original.latestRanking?.previousPosition
          : row.original.latestRanking?.position - (row.original.latestRanking?.positionChange || 0);
        return formatPosition(previousPos || 0);
      }
    },
    {
      id: "position",
      header: "Current Position",
      cell: ({ row }) => formatPosition(row.original.latestRanking?.position || 0)
    },
    {
      id: "change",
      header: "Change",
      cell: ({ row }) => formatPositionChange(row.original.latestRanking?.positionChange)
    },
    {
      id: "date",
      header: "Date",
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
        <CardTitle>Recent Rank Changes</CardTitle>
        <CardDescription>
          Keywords with significant position changes in Google search results
        </CardDescription>
      </CardHeader>
      <CardContent className="max-h-[600px] overflow-auto">
        {isLoading ? (
          <div className="flex justify-center items-center h-64">
            <div className="text-lg">Loading rank changes data...</div>
          </div>
        ) : sortedByChangeImpact.length > 0 ? (
          <DataTable 
            data={sortedByChangeImpact}
            columns={columns}
            searchColumn="keyword"
            searchPlaceholder="Filter by keyword..."
          />
        ) : (
          <div className="flex justify-center items-center h-64">
            <div className="text-lg text-muted-foreground">No rank changes detected in the latest crawl.</div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}