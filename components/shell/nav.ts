import type { ComponentType, SVGProps } from "react";
import {
  AlertsIcon,
  ChartIcon,
  DashboardIcon,
  GoalsIcon,
  ImportIcon,
  PlanIcon,
  SettingsIcon,
  SparkIcon,
  TableIcon,
} from "@/components/ui/icons";

export interface NavItem {
  href: string;
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement> & { size?: number }>;
  description: string;
}

export const NAV_ITEMS: NavItem[] = [
  {
    href: "/",
    label: "Dashboard",
    icon: DashboardIcon,
    description: "Where your money went",
  },
  {
    href: "/import",
    label: "Import",
    icon: ImportIcon,
    description: "Load a statement or holdings sheet",
  },
  {
    href: "/interview",
    label: "Your profile",
    icon: SparkIcon,
    description: "The fact-find your plan is built from",
  },
  {
    href: "/goals",
    label: "Goals",
    icon: GoalsIcon,
    description: "What you are saving toward",
  },
  {
    href: "/plan",
    label: "Plan",
    icon: PlanIcon,
    description: "Budget, projections, what-ifs",
  },
  {
    href: "/invest",
    label: "Invest",
    icon: ChartIcon,
    description: "Target allocation and SIPs",
  },
  {
    href: "/portfolio",
    label: "Portfolio",
    icon: TableIcon,
    description: "Holdings, returns, drift",
  },
  {
    href: "/alerts",
    label: "Alerts",
    icon: AlertsIcon,
    description: "What needs your attention",
  },
  {
    href: "/settings",
    label: "Settings",
    icon: SettingsIcon,
    description: "Currency, notifications, your data",
  },
];
