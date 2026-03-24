"use client";

import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { type LucideIcon } from "lucide-react";

interface StatCardProps {
  title: string;
  value: string;
  subtitle?: string;
  icon: LucideIcon;
  color?: string;
  progress?: number;
}

export function StatCard({ title, value, subtitle, icon: Icon, color = "text-accent", progress }: StatCardProps) {
  return (
    <Card className="bg-surface border-border overflow-hidden">
      <CardContent className="p-4">
        <div className="flex items-start justify-between mb-3 min-w-0">
          <div className="min-w-0 flex-1">
            <p className="text-xs text-text-secondary uppercase tracking-wider">{title}</p>
            <p className={cn("text-xl sm:text-2xl font-mono font-semibold tabular-nums mt-1 truncate", color)}>
              {value}
            </p>
          </div>
          <Icon className={cn("h-5 w-5 shrink-0 ml-2", color)} />
        </div>
        {progress !== undefined && (
          <div className="w-full h-1.5 bg-elevated rounded-full overflow-hidden mb-2">
            <div
              className={cn("h-full rounded-full transition-all duration-500", {
                "bg-success": progress < 60,
                "bg-warning": progress >= 60 && progress < 85,
                "bg-danger": progress >= 85,
              })}
              style={{ width: `${Math.min(progress, 100)}%` }}
            />
          </div>
        )}
        {subtitle && (
          <p className="text-xs text-text-secondary truncate">{subtitle}</p>
        )}
      </CardContent>
    </Card>
  );
}
