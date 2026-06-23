import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Location } from "@shared/schema";

interface LocationSelectProps {
  value: number | null;
  onChange: (value: number | null) => void;
  placeholder?: string;
  includeAllOption?: boolean;
}

export function LocationSelect({
  value,
  onChange,
  placeholder = "Select location",
  includeAllOption = true,
}: LocationSelectProps) {
  const { data: locations, isLoading } = useQuery({
    queryKey: ["/api/locations"],
  });

  const handleChange = (value: string) => {
    if (value === "all") {
      onChange(null);
    } else {
      onChange(parseInt(value));
    }
  };

  return (
    <Select
      value={value === null ? "all" : value.toString()}
      onValueChange={handleChange}
      disabled={isLoading}
    >
      <SelectTrigger className="w-full">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectLabel>Locations</SelectLabel>
          {includeAllOption && (
            <SelectItem value="all">All Locations</SelectItem>
          )}
          {locations?.map((location: Location) => (
            <SelectItem key={location.id} value={location.id.toString()}>
              {location.name}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
