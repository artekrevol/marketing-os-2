import { Card, CardContent } from "@/components/ui/card";
import { ReactNode } from "react";

interface StatsCardProps {
  title: string;
  value: string | number;
  icon: ReactNode;
  trend?: {
    value: string;
    direction: "up" | "down" | "neutral";
  };
  className?: string;
  iconClassName?: string;
  valueClassName?: string;
}

export default function StatsCard({
  title,
  value,
  icon,
  trend,
  className = "",
  iconClassName = "text-primary",
  valueClassName = "",
}: StatsCardProps) {
  const trendColorClass = 
    trend?.direction === "up" 
      ? "text-success" 
      : trend?.direction === "down" 
        ? "text-error" 
        : "text-neutral-500";

  return (
    <Card className={className}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-neutral-500 text-sm font-medium">{title}</h3>
          <span className={`material-icons ${iconClassName}`}>{icon}</span>
        </div>
        <p className={`text-2xl font-semibold ${valueClassName}`}>{value}</p>
        {trend && (
          <p className={`text-xs mt-1 ${trendColorClass}`}>
            {trend.direction === "up" && "↑ "}
            {trend.direction === "down" && "↓ "}
            {trend.value}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
