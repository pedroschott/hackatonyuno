import { DocsShell } from "@/components/docs/DocsShell";

export default function Layout({ children }: { children: React.ReactNode }) {
  return <DocsShell>{children}</DocsShell>;
}
