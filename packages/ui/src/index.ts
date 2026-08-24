import {
  CameraIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronUpIcon,
  CubeIcon,
  DashboardIcon,
  DoubleArrowLeftIcon,
  DoubleArrowRightIcon,
  FileTextIcon,
  GearIcon,
  PersonIcon,
  VideoIcon,
} from "@radix-ui/react-icons";
import { cx } from "class-variance-authority";
import { twMerge } from "tailwind-merge";

export const cn = (...inputs: Parameters<typeof cx>) => twMerge(cx(inputs));

// Re-export commonly used Radix icons
export {
  CameraIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronUpIcon,
  CubeIcon,
  DashboardIcon,
  DoubleArrowLeftIcon,
  DoubleArrowRightIcon,
  FileTextIcon,
  GearIcon,
  PersonIcon,
  VideoIcon,
};
