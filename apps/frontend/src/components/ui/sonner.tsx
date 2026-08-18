import { Toaster as Sonner, type ToasterProps } from "sonner";
import { useTheme } from "@/components/theme/theme-provider";

const Toaster = ({ ...props }: ToasterProps) => {
  const { resolvedTheme } = useTheme();
  return (
    <Sonner
      theme={resolvedTheme as ToasterProps["theme"]}
      className="toaster group"
      {...props}
    />
  );
};

export { Toaster };
