"use client";

import { ChevronRight, Home } from "lucide-react";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Fragment } from "react";

interface FileBreadcrumbProps {
  path: string;
  rootLabel: string;
  onNavigate: (path: string) => void;
}

export function FileBreadcrumb({
  path,
  rootLabel,
  onNavigate,
}: FileBreadcrumbProps) {
  const segments = path.split("/").filter(Boolean);

  const buildPath = (index: number) => {
    return "/" + segments.slice(0, index + 1).join("/");
  };

  return (
    <Breadcrumb>
      <BreadcrumbList className="text-base sm:text-sm">
        <BreadcrumbItem>
          <BreadcrumbLink
            href="#"
            onClick={(e) => {
              e.preventDefault();
              onNavigate("/");
            }}
            className="flex items-center gap-1"
          >
            <Home className="h-4 w-4 sm:h-3 sm:w-3" />
            <span className="hidden sm:inline">{rootLabel}</span>
          </BreadcrumbLink>
        </BreadcrumbItem>
        {segments.map((segment, index) => (
          <Fragment key={index}>
            <BreadcrumbSeparator>
              <ChevronRight className="h-4 w-4 sm:h-3 sm:w-3" />
            </BreadcrumbSeparator>
            <BreadcrumbItem>
              <BreadcrumbLink
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  onNavigate(buildPath(index));
                }}
              >
                {segment}
              </BreadcrumbLink>
            </BreadcrumbItem>
          </Fragment>
        ))}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
