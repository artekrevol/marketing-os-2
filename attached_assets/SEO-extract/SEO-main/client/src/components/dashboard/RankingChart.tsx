import { useEffect, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer
} from "recharts";

type TimeRange = "7d" | "30d" | "90d";

export default function RankingChart() {
  const [activeTimeRange, setActiveTimeRange] = useState<TimeRange>("7d");
  const [resultType] = useState<string>("organic"); // Always use organic results

  // Fetch ranking history data with organic result type
  const { data, isLoading } = useQuery({
    queryKey: ["/api/rankings/history", resultType],
    queryFn: async () => {
      const response = await fetch(`/api/rankings/history?resultType=${resultType}`);
      if (!response.ok) {
        throw new Error('Failed to fetch ranking history');
      }
      return response.json();
    },
  });

  // Transform data for the chart
  const chartData = useRef<any[]>([]);

  useEffect(() => {
    if (data) {
      // Calculate date range based on active time range
      const endDate = new Date();
      const startDate = new Date();
      
      if (activeTimeRange === "7d") {
        startDate.setDate(endDate.getDate() - 7);
      } else if (activeTimeRange === "30d") {
        startDate.setDate(endDate.getDate() - 30);
      } else {
        startDate.setDate(endDate.getDate() - 90);
      }

      // Create a map of dates to average positions
      const dateMap = new Map();
      
      // For each keyword
      data.forEach((item: any) => {
        // Filter rankings by date range
        const filteredRankings = item.rankings.filter((r: any) => {
          const rankingDate = new Date(r.date);
          return rankingDate >= startDate && rankingDate <= endDate;
        });

        // Add positions to dates
        filteredRankings.forEach((ranking: any) => {
          const date = new Date(ranking.date).toISOString().split("T")[0];
          
          if (!dateMap.has(date)) {
            dateMap.set(date, { date, positions: [], count: 0, avg: 0 });
          }
          
          const dateData = dateMap.get(date);
          dateData.positions.push(ranking.position);
          dateData.count++;
          dateData.avg = dateData.positions.reduce((a: number, b: number) => a + b, 0) / dateData.count;
        });
      });

      // Convert map to array and sort by date
      const sortedData = Array.from(dateMap.values())
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
        .map(item => ({
          date: new Date(item.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
          avgPosition: Math.round(item.avg * 10) / 10
        }));

      chartData.current = sortedData;
    }
  }, [data, activeTimeRange]);

  const handleTimeRangeChange = (range: TimeRange) => {
    setActiveTimeRange(range);
  };

  // Inverse Y-axis (lower rank is better)
  const yAxisDomain: [number, number] = [100, 1]; // Fixed domain from 1 to 100 (rank positions)

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-4">
          <div className="flex justify-between mb-4">
            <Skeleton className="h-8 w-36" />
            <div className="flex space-x-2">
              <Skeleton className="h-8 w-16" />
              <Skeleton className="h-8 w-16" />
              <Skeleton className="h-8 w-16" />
            </div>
          </div>
          <Skeleton className="h-64 w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex flex-wrap items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">Ranking Trends</h3>
          <div className="flex space-x-2 mt-2 sm:mt-0">
            <Button
              size="sm"
              variant={activeTimeRange === "7d" ? "default" : "outline"}
              onClick={() => handleTimeRangeChange("7d")}
            >
              7 Days
            </Button>
            <Button
              size="sm"
              variant={activeTimeRange === "30d" ? "default" : "outline"}
              onClick={() => handleTimeRangeChange("30d")}
            >
              30 Days
            </Button>
            <Button
              size="sm"
              variant={activeTimeRange === "90d" ? "default" : "outline"}
              onClick={() => handleTimeRangeChange("90d")}
            >
              90 Days
            </Button>
          </div>
        </div>
        
        <div className="w-full h-64">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData.current}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="date" />
              <YAxis 
                domain={yAxisDomain}
                label={{ 
                  value: 'Rank Position', 
                  angle: -90, 
                  position: 'insideLeft',
                  style: { textAnchor: 'middle' }
                }}
              />
              <Tooltip 
                formatter={(value: number) => [`Position ${value}`, 'Average Rank']}
                labelFormatter={(label) => `Date: ${label}`}
              />
              <Legend />
              <Line
                type="monotone"
                dataKey="avgPosition"
                name="Average Position"
                stroke="#0078d4"
                strokeWidth={2}
                dot={{ r: 4 }}
                activeDot={{ r: 6, stroke: '#ffaa44', strokeWidth: 2, fill: '#ffaa44' }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
        
        <div className="flex justify-center mt-4 space-x-8">
          <div className="flex items-center">
            <span className="w-3 h-3 bg-primary rounded-sm mr-2"></span>
            <span className="text-sm text-neutral-600">Average Position</span>
          </div>
          <div className="flex items-center">
            <span className="w-3 h-3 bg-accent rounded-sm mr-2"></span>
            <span className="text-sm text-neutral-600">Today</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
