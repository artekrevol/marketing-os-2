import React, { useState, useEffect } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { ColumnDef } from '@tanstack/react-table';
import { useDebounce } from '@/hooks/use-debounce';

interface VirtualDataTableProps<TData> {
  data: TData[];
  columns: ColumnDef<TData, any>[];
  searchColumn?: string;
  searchPlaceholder?: string;
  showPagination?: boolean;
  initialPageSize?: number;
  initialPageIndex?: number;
  onPageChange?: (pageIndex: number) => void;
  rowsPerPageOptions?: number[];
}

export function VirtualDataTable<TData>({
  data,
  columns,
  searchColumn,
  searchPlaceholder = "Search...",
  showPagination = true,
  initialPageSize = 25,
  initialPageIndex = 0,
  onPageChange,
  rowsPerPageOptions = [10, 25, 50, 100]
}: VirtualDataTableProps<TData>) {
  const [searchQuery, setSearchQuery] = useState("");
  const [pageSize, setPageSize] = useState(initialPageSize);
  const [currentPage, setCurrentPage] = useState(initialPageIndex);
  const debouncedSearchQuery = useDebounce(searchQuery, 300);
  
  // Filter data based on search query
  const filteredData = React.useMemo(() => {
    if (!debouncedSearchQuery || !searchColumn) return data;
    
    return data.filter((item) => {
      const value = (item as any)[searchColumn];
      if (typeof value === 'string') {
        return value.toLowerCase().includes(debouncedSearchQuery.toLowerCase());
      }
      return false;
    });
  }, [data, debouncedSearchQuery, searchColumn]);
  
  // Calculate pagination
  const totalRows = filteredData.length;
  const totalPages = Math.ceil(totalRows / pageSize);
  
  // Update current page when data changes
  useEffect(() => {
    if (currentPage >= totalPages && totalPages > 0) {
      setCurrentPage(totalPages - 1);
    }
  }, [filteredData, pageSize, currentPage, totalPages]);
  
  // Get data for current page
  const paginatedData = React.useMemo(() => {
    const start = currentPage * pageSize;
    const end = start + pageSize;
    return filteredData.slice(start, end);
  }, [filteredData, currentPage, pageSize]);
  
  // Create a container ref to measure and virtualize
  const tableContainerRef = React.useRef<HTMLDivElement>(null);
  
  // Create virtualizer
  const rowVirtualizer = useVirtualizer({
    count: paginatedData.length,
    getScrollElement: () => tableContainerRef.current,
    estimateSize: () => 48, // Estimate row height
    overscan: 10 // Number of items to render before/after viewport
  });
  
  // Create virtualized items
  const virtualRows = rowVirtualizer.getVirtualItems();
  const paddingTop = virtualRows.length > 0 ? virtualRows[0].start : 0;
  const paddingBottom = virtualRows.length > 0 
    ? rowVirtualizer.getTotalSize() - virtualRows[virtualRows.length - 1].end
    : 0;
  
  // Handle page change
  const handlePageChange = (newPage: number) => {
    setCurrentPage(newPage);
    if (onPageChange) {
      onPageChange(newPage);
    }
    // Scroll to top when page changes
    if (tableContainerRef.current) {
      tableContainerRef.current.scrollTop = 0;
    }
  };
  
  return (
    <div className="space-y-4">
      {/* Search and page size controls */}
      <div className="flex items-center justify-between">
        {searchColumn && (
          <div className="flex items-center space-x-2">
            <Input
              placeholder={searchPlaceholder}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="max-w-sm"
            />
          </div>
        )}
        
        {showPagination && (
          <div className="flex items-center space-x-2">
            <span className="text-sm text-muted-foreground">Rows per page:</span>
            <Select
              value={pageSize.toString()}
              onValueChange={(value) => {
                setPageSize(Number(value));
                setCurrentPage(0);
              }}
            >
              <SelectTrigger className="h-8 w-[70px]">
                <SelectValue placeholder={pageSize} />
              </SelectTrigger>
              <SelectContent side="top">
                {rowsPerPageOptions.map((size) => (
                  <SelectItem key={size} value={size.toString()}>
                    {size}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>
      
      {/* Table with virtualization */}
      <div 
        ref={tableContainerRef} 
        className="overflow-auto border rounded-md"
        style={{ height: 'calc(100vh - 350px)', minHeight: '400px' }}
      >
        <Table>
          <TableHeader className="sticky top-0 bg-background z-10">
            <TableRow>
              {columns.map((column, index) => (
                <TableHead key={index}>
                  {column.header ? (
                    typeof column.header === 'function' 
                      ? column.header({
                          column: { id: column.id || '' } as any,
                          header: { id: column.id || '' } as any,
                          table: { id: 'virtualized-table' } as any
                        })
                      : column.header
                  ) : (
                    (column as any).accessorKey || column.id
                  )}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {paddingTop > 0 && (
              <tr>
                <td style={{ height: `${paddingTop}px` }} colSpan={columns.length} />
              </tr>
            )}
            {virtualRows.map((virtualRow) => {
              const row = paginatedData[virtualRow.index];
              return (
                <TableRow key={virtualRow.index}>
                  {columns.map((column, colIndex) => (
                    <TableCell key={colIndex}>
                      {column.cell && typeof column.cell === 'function'
                        ? column.cell({
                            row: { original: row, index: virtualRow.index } as any,
                            column: { id: column.id || '' } as any,
                            table: {} as any,
                            // Add missing properties to satisfy CellContext type
                            cell: { id: column.id || '' } as any,
                            getValue: () => (row as any)[(column as any).accessorKey as string],
                            renderValue: () => (row as any)[(column as any).accessorKey as string]
                          })
                        : (row as any)[(column as any).accessorKey as string]}
                    </TableCell>
                  ))}
                </TableRow>
              );
            })}
            {paddingBottom > 0 && (
              <tr>
                <td style={{ height: `${paddingBottom}px` }} colSpan={columns.length} />
              </tr>
            )}
          </TableBody>
        </Table>
      </div>
      
      {/* Pagination controls */}
      {showPagination && totalPages > 1 && (
        <div className="flex items-center justify-between">
          <div className="text-sm text-muted-foreground">
            Showing {currentPage * pageSize + 1} to {Math.min((currentPage + 1) * pageSize, totalRows)} of {totalRows} entries
          </div>
          <div className="flex items-center space-x-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => handlePageChange(0)}
              disabled={currentPage === 0}
            >
              <ChevronsLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => handlePageChange(currentPage - 1)}
              disabled={currentPage === 0}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="flex items-center gap-1">
              <div className="text-sm">
                Page {currentPage + 1} of {totalPages}
              </div>
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => handlePageChange(currentPage + 1)}
              disabled={currentPage >= totalPages - 1}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => handlePageChange(totalPages - 1)}
              disabled={currentPage >= totalPages - 1}
            >
              <ChevronsRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}