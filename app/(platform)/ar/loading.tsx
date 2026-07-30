import { Skeleton, TableSkeleton } from "@/components/ui/Skeleton";

export default function ArLoading() {
  return (
    <div className="mx-auto max-w-7xl">
      <div className="mb-6">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="mt-2 h-3.5 w-72" />
      </div>
      <TableSkeleton rows={8} columns={7} />
    </div>
  );
}
